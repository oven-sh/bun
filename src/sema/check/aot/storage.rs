//! What a variable, a parameter or a field holds over its whole life, and whether its type is written down.
//!
//! The type of a place says what is stored to it. Before anything is, a `let`, a `const` or a class holds nothing, and a reference to it
//! throws: it is in its temporal dead zone. A `var`, a `let` without a value and a field hold `undefined`, whatever their type says. That
//! is part of what the place holds unless nobody gets to see it: every read comes after a store.
//!
//! Whether it does is read off the control flow graph of the binder, and off nothing else. A path counts even if the types say that it
//! is never taken, past a call that is declared never to return or a `switch` that is declared to cover every case: nothing holds
//! the program to that.

use super::ByFile;
use super::captures::Receiver;
use super::int32_fields::RunBy;
use super::libraries::Vouched;
use crate::atom::Atom;
use crate::bind::{AccessKind, ClassOwner, Decl, Flow, FlowId, FlowTarget, FnOwner, MemberOwner, Parent, PatParent, SymFlags, SymbolId};
use crate::check::decl::{number_operation, to_int32};
use crate::check::errors_names_and_exports::root_declaration;
use crate::check::shape::{self, Found};
use crate::check::sink::Arg;
use crate::check::{Checker, ContextFlags};
use crate::hir::{
    BinOp, CallId, Chain, ClassId, EnumId, ExprId, ExprKind, ExprTag, FileKind, Flags, FnBody, FnId, FnKind, Keyword, MemberId, MemberKind, ModifierId, ModifierKind, ParamId, PatId, PatKind,
    PropKey, PropKind, Span, StmtId, StmtKind, TypeNodeKind, UnOp, VarDeclId, VarKind,
};
use crate::program::{FileId, Sym};
use crate::types::{EnumValue, MapperId, Prop, PropSource, TypeData, TypeId, TypeKey};
use crate::util::{FxHashMap, FxHashSet};
use std::cell::RefCell;
use std::rc::Rc;
use super::OnceLock;

#[derive(Clone, Default)]
pub struct Made {
    pub is_object: bool,
    pub within: Vec<(Atom, Made)>,
    pub anywhere: Option<Box<Made>>,
    pub elements: Option<Box<Made>>,
}

impl Made {
    fn object() -> Made {
        Made { is_object: true, ..Made::default() }
    }

    fn what_it_holds(self) -> Made {
        Made { is_object: false, elements: None, ..self }
    }

    fn anything_it_holds(self) -> Made {
        let mut made = self.elements.map_or_else(Made::object, |elements| *elements);
        for held in self.within.into_iter().map(|held| held.1).chain(self.anywhere.map(|anywhere| *anywhere)) {
            made.join(held);
        }
        made
    }

    fn join(&mut self, other: Made) {
        self.is_object |= other.is_object;
        for (name, held) in other.within {
            match self.within.iter_mut().find(|known| known.0 == name) {
                Some(known) => known.1.join(held),
                None => self.within.push((name, held)),
            }
        }
        join_what_is_held(&mut self.anywhere, other.anywhere);
        join_what_is_held(&mut self.elements, other.elements);
    }
}

fn join_what_is_held(so_far: &mut Option<Box<Made>>, other: Option<Box<Made>>) {
    let Some(other) = other else { return };
    match so_far {
        Some(known) => known.join(*other),
        None => *so_far = Some(other),
    }
}

fn join_what_is_made(so_far: &mut Option<Made>, other: Option<Made>) {
    let Some(other) = other else { return };
    match so_far {
        Some(known) => known.join(other),
        None => *so_far = Some(other),
    }
}

#[derive(Default)]
struct LookedAt {
    functions: Vec<((FileId, FnId), Option<Made>)>,
    variables: Vec<(Sym, Option<Made>)>,
}

#[derive(Default)]
pub(super) struct Shared {
    /// Unset: nobody has said which module evaluates which.
    modules: OnceLock<ModuleGraph>,
    put_off: OnceLock<FxHashSet<FileId>>,
    logs_type_errors: OnceLock<bool>,
    marked_pure: OnceLock<FxHashMap<FileId, Vec<u32>>>,
    /// The dotted names that the bundler puts a primitive in the place of: in the files of the program, in the builtin modules. Unset: none.
    replaced: OnceLock<[FxHashSet<Vec<u8>>; 2]>,
    /// By module: `ModuleGraph::puts_first`.
    put_first: ByFile<bool>,
    /// `storage_facts`
    by_file: ByFile<FileFacts>,
    /// `earliest_runs_in`
    earliest_runs: ByFile<FxHashMap<FnId, u32>>,
    /// `casts_returned_in`
    casts_returned: ByFile<Vec<(FnId, ExprId)>>,
    /// `Checker::is_tainted`
    pub(super) given: OnceLock<super::flows::Given>,
    pub(super) found_at_first: std::sync::Mutex<Option<super::flows::Search>>,
    pub(super) names_stored: OnceLock<std::sync::Arc<Vec<u64>>>,
    pub(super) pairs_compared: std::sync::Mutex<Vec<(super::Identity, super::Identity)>>,
    handed_strangers_by_untyped_code: OnceLock<FxHashSet<Sym>>,
    called_with_what_says_nothing: OnceLock<FxHashSet<Sym>>,
    pub(super) evidence_of_strangers_noted: OnceLock<Box<[std::sync::Mutex<Option<Box<super::alterations::Alterations<Sym>>>>]>>,
    pub(super) evidence_of_strangers: OnceLock<FxHashSet<Sym>>,
    calls_that_may_redefine: OnceLock<Vec<(FileId, ExprId)>>,
}

/// A memoized query whose answer may depend on itself: see `Checker::solve`.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(super) enum Query {
    Stored(Sym),
    Result(FileId, FnId),
    HostCallback(FileId, FnId),
    Claim(FileId, ExprId),
    ArgumentUse(FileId, ParamId),
}

struct InFlight {
    query: Query,
    /// What is assumed of it for now, as the query encodes its answers.
    assumed: u64,
    is_relied_on: bool,
}

/// An index into `State::in_flight`. By default none.
struct Outermost(usize);

impl Default for Outermost {
    fn default() -> Outermost {
        Outermost(usize::MAX)
    }
}

#[derive(Default)]
pub(super) struct State {
    /// By class: see `uses_of_this`.
    uses_of_this: FxHashMap<(FileId, ClassId), Rc<[Use]>>,
    /// By class: see `construction_keeps_this`.
    keeps_this: FxHashMap<(FileId, ClassId), bool>,
    /// By variable: see `where_flow_tells_of`.
    told_of: FxHashMap<Sym, ToldOf>,
    /// By variable: see `type_stored_to`.
    stored: FxHashMap<Sym, TypeId>,
    /// By function whose result is inferred: see `result_of_fn`.
    results: FxHashMap<(FileId, FnId), (TypeId, bool)>,
    /// See `Checker::solve`. Outermost first.
    in_flight: Vec<InFlight>,
    being_told_of: u32,
    /// The outermost query in flight whose assumption has been relied on since the innermost one began.
    outermost_relied_on: Outermost,
    /// By function expression: see `is_host_callback`.
    host_callbacks: FxHashMap<(FileId, FnId), bool>,
    let_out: FxHashMap<(FileId, FnId), bool>,
    mentions: FxHashMap<FileId, Rc<FxHashMap<SymbolId, Vec<ExprId>>>>,
    second_bodies: FxHashMap<(FileId, FnId), bool>,
    second_bodies_for_the_log: FxHashMap<(FileId, FnId), bool>,
    pub(in crate::check) accessed_within: Option<FileId>,
    second_bodies_on: Option<(FileId, Rc<[(u32, u32)]>)>,
    set_aside: Option<Box<SetAside>>,
    untyped_state_is_of: Option<(FileId, Rc<[(u32, u32)]>)>,
    /// By property: see `may_find_field_blank`.
    blank_fields: FxHashMap<Sym, bool>,
    /// By `const`: see `constant_held_by`.
    constants: FxHashMap<Sym, Option<Primitive>>,
    long_string_constants: FxHashMap<Sym, Option<Primitive>>,
    folding_long_strings: bool,
    /// By module: see `end_of_inert_prefix`. 0 while it is being found.
    inert_prefixes: RefCell<FxHashMap<FileId, u32>>,
    /// By module: see `is_deferred_module`.
    deferred_modules: FxHashMap<FileId, bool>,
    /// `declaration_of_lazy_variable`
    lazy_variables: FxHashMap<Sym, Option<(FileId, VarDeclId)>>,
    /// `Checker::only_makes`. `None`: being found out.
    only_makes: FxHashMap<(FileId, FnId), Option<bool>>,
    walked: FxHashMap<(FileId, ExprId), Result<WalkedAs, &'static str>>,
    /// `Checker::declares_lazy_variable`. `None`: being found out.
    lazy_declarations: FxHashMap<(FileId, VarDeclId), Option<bool>>,
    uses_of_top_level: FxHashMap<FileId, Rc<UsesOfTopLevel>>,
    yielded: FxHashMap<(FileId, ExprId), TypeId>,
    reads: FxHashMap<(FileId, ExprId), Option<ReferenceRead>>,
    /// `Checker::is_redefined_somewhere`
    redefinitions: Option<Rc<[Redefinition]>>,
}

#[derive(Default)]
struct SetAside {
    told_of: FxHashMap<Sym, ToldOf>,
    stored: FxHashMap<Sym, TypeId>,
    results: FxHashMap<(FileId, FnId), (TypeId, bool)>,
    trust: super::trust::State,
    integers: super::integers::State,
    kinds: super::kinds::State,
}

/// `Object.defineProperty(target, key, descriptor)`, where the descriptor is not seen to leave a writable, enumerable and configurable data property: the type of `target`, and the names that
/// `key` can be. `None`: any.
type Redefinition = (TypeId, Option<Vec<Atom>>);

/// See `uninitialized_variables_of`.
struct Uninitialized {
    declaration: VarDeclId,
    name: Atom,
    ty: TypeId,
    read: EarlyRead,
}

/// A read of a variable that may come before every store to it.
enum EarlyRead {
    /// By other code than declares the variable: a function, which may be called at any time.
    ByOtherCode(ExprId),
    /// By the code that declares it, on a path that passes no store.
    OnSomePath(ExprId),
    /// None in its file: it is exported.
    ByOtherFiles,
}

/// A value that is no object, no symbol and no bigint.
#[derive(Copy, Clone, PartialEq, Debug)]
pub enum Primitive {
    Undefined,
    Null,
    Bool(bool),
    Number(f64),
    String(Atom),
}

/// Who refers to the variables of a file, as far as it matters to whether the first use of one may come after the module has been evaluated.
#[derive(Default)]
struct UsesOfTopLevel {
    /// A function or the initializer of an instance field refers to it, or it is exported.
    later: FxHashSet<SymbolId>,
    /// Code refers to it that runs while the module is evaluated and is no initializer of a declaration at the top level.
    during: FxHashSet<SymbolId>,
    /// It is named in the initializer of the declaration, which stands at the top level, outside every function.
    in_initializers: Vec<(SymbolId, VarDeclId)>,
}

/// The bindings of the global object that inert code names and that nothing can replace.
const FIXED_GLOBALS: &[&[u8]] = &[
    b"undefined",
    b"NaN",
    b"Infinity",
    b"Object",
    b"Array",
    b"ArrayBuffer",
    b"Map",
    b"Set",
    b"WeakMap",
    b"WeakSet",
    b"Int8Array",
    b"Uint8Array",
    b"Uint8ClampedArray",
    b"Int16Array",
    b"Uint16Array",
    b"Int32Array",
    b"Uint32Array",
    b"Float32Array",
    b"Float64Array",
    b"Error",
    b"AggregateError",
    b"EvalError",
    b"RangeError",
    b"ReferenceError",
    b"SyntaxError",
    b"TypeError",
    b"URIError",
];

#[derive(Copy, Clone, PartialEq, Eq)]
enum Walked {
    Undefined,
    Null,
    Primitive { may_be_nil: bool },
    Anything { may_be_nil: bool },
    Object,
    Function { file: FileId, func: FnId, within: u32 },
    Class(FileId, ClassId),
    Made(u32),
}

impl Walked {
    const VALUE: Walked = Walked::Primitive { may_be_nil: false };

    fn may_be_nil(self) -> bool {
        matches!(self, Walked::Undefined | Walked::Null | Walked::Primitive { may_be_nil: true } | Walked::Anything { may_be_nil: true })
    }

    fn is_primitive(self) -> bool {
        matches!(self, Walked::Undefined | Walked::Null | Walked::Primitive { .. })
    }

    fn is_nil(self) -> bool {
        matches!(self, Walked::Undefined | Walked::Null)
    }

    fn is_object(self) -> bool {
        matches!(self, Walked::Object | Walked::Function { .. } | Walked::Class(..) | Walked::Made(_))
    }

    fn without_nil(self) -> Walked {
        match self {
            Walked::Primitive { .. } => Walked::VALUE,
            Walked::Anything { .. } => Walked::Anything { may_be_nil: false },
            other => other,
        }
    }

    fn join(self, other: Walked) -> Walked {
        if self == other {
            self
        } else if self.is_primitive() && other.is_primitive() {
            Walked::Primitive { may_be_nil: true }
        } else if self.is_object() && other.is_object() {
            Walked::Object
        } else {
            Walked::Anything { may_be_nil: self.may_be_nil() || other.may_be_nil() }
        }
    }
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum MadeAs {
    Record,
    Instance(FileId, ClassId),
    List,
    Collection { has_values: bool, is_weak: bool },
}

struct MadeInWalk {
    made_as: MadeAs,
    fields: Vec<(Atom, Walked)>,
    elements: Option<Walked>,
    holds_lists_made_there: bool,
    is_frozen: bool,
    doubts: u32,
}

struct Activation {
    function: (FileId, FnId),
    serial: u32,
    this: Option<Walked>,
    bound_from: usize,
    doubts_from: u32,
    returned: Option<Walked>,
    constructs: Option<((FileId, ClassId), Option<(FileId, ClassId)>)>,
    has_called_super: bool,
}

struct Walk {
    root: (FileId, u32),
    bound: Vec<((FileId, SymbolId), Walked, u32)>,
    running: Vec<Activation>,
    constructing: Vec<(FileId, ClassId)>,
    made: Vec<MadeInWalk>,
    found_initialized: Vec<Sym>,
    doubts: u32,
    serials: u32,
    steps: u32,
    depth: u32,
    obstacle: &'static str,
}

impl Walk {
    fn new(root: (FileId, u32)) -> Walk {
        Walk { root, bound: Vec::new(), running: Vec::new(), constructing: Vec::new(), made: Vec::new(), found_initialized: Vec::new(), doubts: 0, serials: 0, steps: 0, depth: 0, obstacle: "" }
    }

    fn stops<T>(&mut self, why: &'static str) -> Option<T> {
        if self.obstacle.is_empty() {
            self.obstacle = why;
        }
        None
    }

    fn make(&mut self, made_as: MadeAs, fields: Vec<(Atom, Walked)>, elements: Option<Walked>) -> Walked {
        self.made.push(MadeInWalk { made_as, fields, elements, holds_lists_made_there: false, is_frozen: false, doubts: self.doubts });
        Walked::Made(self.made.len() as u32 - 1)
    }

    fn is_list(&self, value: Walked) -> bool {
        matches!(value, Walked::Made(it) if self.made[it as usize].made_as == MadeAs::List)
    }

    fn serial(&self) -> u32 {
        self.running.last().map_or(0, |activation| activation.serial)
    }

    fn bind(&mut self, file: FileId, symbol: SymbolId, value: Walked) {
        self.bound.push(((file, symbol), value, self.doubts));
    }
}

fn set_walked_field(fields: &mut Vec<(Atom, Walked)>, name: Atom, value: Walked, is_certain: bool) {
    match fields.iter_mut().find(|field| field.0 == name) {
        Some(field) => field.1 = if is_certain { value } else { field.1.join(value) },
        None => fields.push((name, if is_certain { value } else { value.join(Walked::Undefined) })),
    }
}

fn join_walked(so_far: Option<Walked>, other: Option<Walked>) -> Option<Walked> {
    match (so_far, other) {
        (Some(a), Some(b)) => Some(a.join(b)),
        (a, b) => a.or(b),
    }
}

#[derive(Clone)]
struct WalkedAs {
    is_object: bool,
    found_initialized: Rc<[Sym]>,
}

const MOST_STEPS_OF_A_WALK: u32 = 4000;
const MOST_ACTIVATIONS_OF_A_WALK: usize = 16;
const MOST_DEPTH_OF_A_WALK: u32 = 96;

const NAMES_OF_OBJECT_PROTOTYPE: &[&[u8]] = &[
    b"constructor",
    b"__proto__",
    b"__defineGetter__",
    b"__defineSetter__",
    b"__lookupGetter__",
    b"__lookupSetter__",
    b"hasOwnProperty",
    b"isPrototypeOf",
    b"propertyIsEnumerable",
    b"toLocaleString",
    b"toString",
    b"valueOf",
];

/// How a module comes to evaluate another.
#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub enum Evaluates {
    /// `import`, `export .. from`: before its own body runs.
    First,
    /// `require(..)`: where the call is reached, at once.
    AtOnce,
    /// The same, and the call stands outside every function: it is reached while the body of the module runs.
    InItsBody,
    /// `import(..)`: where the call is reached, in a job of its own.
    Later,
    /// The same, and the call stands outside every function: it is reached while the body of the module runs.
    LaterFromItsBody,
}

/// Which module of the program evaluates which, going by the code that runs for an import, which is for the bundler to say.
#[derive(Default)]
struct ModuleGraph {
    /// By module: those that evaluate it first.
    importers: FxHashMap<FileId, Vec<FileId>>,
    /// By module: what it evaluates.
    evaluates: FxHashMap<FileId, Vec<(FileId, Evaluates)>>,
    /// By module of the program: a number that it shares with the modules that evaluate it first and that it evaluates first, by
    /// whatever way.
    cycle: FxHashMap<FileId, u32>,
    /// Those that share theirs with another, or import themselves.
    in_cycles: FxHashSet<FileId>,
    /// What may be evaluated while another module is half evaluated, by code that no import leads to: a callback that calls `require`.
    /// And all that those evaluate in turn.
    exposed: FxHashSet<FileId>,
}

impl ModuleGraph {
    fn new(modules: &[FileId], edges: &[(FileId, FileId, Evaluates)], has_top_level_await: bool) -> ModuleGraph {
        let mut graph = ModuleGraph::default();
        let (mut evaluated, mut first): (FxHashMap<FileId, Vec<FileId>>, FxHashMap<FileId, Vec<FileId>>) = Default::default();
        let mut pending = Vec::new();
        for &(from, to, how) in edges {
            evaluated.entry(from).or_default().push(to);
            graph.evaluates.entry(from).or_default().push((to, how));
            if how == Evaluates::First {
                first.entry(from).or_default().push(to);
                graph.importers.entry(to).or_default().push(from);
                if from == to {
                    graph.in_cycles.insert(from);
                }
            } else if !matches!(how, Evaluates::Later | Evaluates::LaterFromItsBody) || has_top_level_await {
                // A job starts when no code runs, so no module is half evaluated, unless one is waiting.
                pending.push(to);
            }
        }
        while let Some(module) = pending.pop() {
            if graph.exposed.insert(module) {
                pending.extend(evaluated.get(&module).into_iter().flatten());
            }
        }
        // The strongly connected components: the modules in the order in which a walk along the imports leaves them, then from the last
        // one back a walk against the imports.
        let (mut left, mut seen) = (Vec::new(), FxHashSet::default());
        for &root in modules {
            let mut path = if seen.insert(root) { vec![(root, 0)] } else { Vec::new() };
            while let Some(&(module, next)) = path.last() {
                match first.get(&module).and_then(|imported| imported.get(next)) {
                    Some(&imported) => {
                        if let Some(top) = path.last_mut() {
                            top.1 += 1;
                        }
                        if seen.insert(imported) {
                            path.push((imported, 0));
                        }
                    }
                    None => {
                        left.push(module);
                        path.pop();
                    }
                }
            }
        }
        for (number, &root) in left.iter().rev().enumerate() {
            if graph.cycle.contains_key(&root) {
                continue;
            }
            graph.cycle.insert(root, number as u32);
            let (mut members, mut at) = (vec![root], 0);
            while at < members.len() {
                for &importer in graph.importers.get(&members[at]).into_iter().flatten() {
                    if !graph.cycle.contains_key(&importer) {
                        graph.cycle.insert(importer, number as u32);
                        members.push(importer);
                    }
                }
                at += 1;
            }
            if members.len() > 1 {
                graph.in_cycles.extend(members);
            }
        }
        graph
    }

    /// Whether the body of the module runs before any code of a module that gets at it by imports, whichever module is evaluated
    /// first. The body of an importer runs after it if the importer evaluates first the module itself, or one of which that holds, and
    /// that one is not waiting for the importer in turn. A module in a cycle that gets at it only by way of the others in the cycle may
    /// run before it, and may call what the others export.
    fn puts_first(&self, module: FileId) -> bool {
        if !self.cycle.contains_key(&module) || self.in_cycles.contains(&module) || self.exposed.contains(&module) {
            return false;
        }
        let importers_of = |module: FileId| self.importers.get(&module).into_iter().flatten().copied();
        let mut run_after: FxHashSet<FileId> = FxHashSet::default();
        run_after.insert(module);
        let mut pending = vec![module];
        while let Some(at) = pending.pop() {
            for importer in importers_of(at) {
                if self.cycle.get(&importer) != self.cycle.get(&at) && run_after.insert(importer) {
                    pending.push(importer);
                }
            }
        }
        let mut seen: FxHashSet<FileId> = FxHashSet::default();
        pending.push(module);
        while let Some(at) = pending.pop() {
            for importer in importers_of(at) {
                if !run_after.contains(&importer) {
                    return false;
                }
                if seen.insert(importer) {
                    pending.push(importer);
                }
            }
        }
        true
    }
}

/// Where the control flow of the code around a read tells of every store to a variable that can come before the read.
#[derive(Copy, Clone)]
enum ToldOf {
    /// Nothing is stored to it once it is declared.
    Everywhere,
    /// In the code that declares it, which makes all the stores.
    Within(Site),
    Nowhere,
}

/// What a variable, a parameter or a field holds over its whole life.
#[derive(Copy, Clone, Debug)]
pub struct Storage {
    /// The declared or inferred type: what is stored to it.
    pub ty: TypeId,
    /// Besides, it may be found to hold `undefined`: nothing has been stored to it yet, or it is declared with a `?`.
    pub starts_undefined: bool,
}

/// What takes the place of the result of a call that is not of its declared type: see `Checker::recovery_of_call`.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Recovery {
    /// The first argument.
    Argument,
    /// What a call of the first argument yields.
    CallArgument,
}

/// How far the checker's type of a reference, `a`, `a.b` or `a[b]`, goes for the value that a read of it yields.
#[derive(Copy, Clone, Debug)]
pub struct ReferenceRead {
    /// What the place is declared to hold, whatever has been found out about it on the way to the read. `UNRESOLVED`: that is not known.
    pub declared: TypeId,
    /// What a test or a store on the way has shown of the place still holds at the read: no other code can have stored to it since.
    pub is_narrowing_reliable: bool,
    /// The read may yield `undefined` where `declared` leaves that out: nothing has been stored to the variable yet, or there is no such
    /// element or key.
    pub may_be_undefined: bool,
    /// `let a!: T`, which may hold `undefined` where it is read: the `!` says that it does not, so the read makes sure of that, as `a!`
    /// does, whatever `T` is. Then it is not `may_be_undefined`.
    pub is_asserted: bool,
}

/// What one pass over the names, the `this` and the `super` of a file finds.
struct FileFacts {
    /// A bit for each symbol of the file: a variable that holds `undefined` at first, and that a read may find before a store to it.
    read_unassigned: Vec<u64>,
    /// The same: a variable that holds `undefined` at first, and that is cleared: `a = undefined!`, `a = null!`.
    cleared: Vec<u64>,
    /// The same: a variable, a parameter or a class that the code that declares it refers to where it may be in its dead zone.
    referred_to_early: Vec<u64>,
    /// The same: a variable or a class that some code of the file refers to where it may be in its dead zone.
    found_early: Vec<u64>,
    /// The same: a variable or a class that a closure refers to that may be made while it is in its dead zone, or that is `found_early`.
    captured_early: Vec<u64>,
    seen_by_importers: Vec<u64>,
    /// The same: a variable that is stored to as `(a as T) = value`, which is not among `Bound::assignments_to`.
    stored_through_casts: Vec<u64>,
    /// What the constructors and the initializers of instance fields do with `this`, sorted by class.
    this: Vec<(ClassId, At, Access)>,
}

/// The code that something is a part of, which runs from its start to its end in the order of its text, loops aside.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(super) enum Site {
    /// The statements of the file, those of its namespaces among them.
    File,
    Body(FnId),
    /// A default or a computed name in a parameter.
    Parameter(ParamId),
    /// The initializer of a property of a class.
    Initializer(MemberId),
}

/// How a name of a file is declared.
#[derive(Copy, Clone)]
struct Declared {
    /// `None`: it is no variable and no class, or it is not known what evaluates the declaration.
    site: Option<Site>,
    /// See `dead_zone_of`.
    end_of_dead_zone: u32,
    /// It holds `undefined` at first.
    is_blank: bool,
    /// Of a `var` with an initializer that control cannot get past: where the declaration ends. What is evaluated later in the code that
    /// declares it finds what has been stored. 0: it is none.
    end_of_initializer: u32,
}

/// What a walk back through the control flow stops at.
#[derive(Copy, Clone)]
enum Store {
    Variable(SymbolId),
    /// `this.name = value`
    Field(Atom),
    /// `super(..)` has returned.
    Super,
}

/// A walk back from one place after the other, for one `Store`.
#[derive(Default)]
struct Search {
    /// The nodes that have been passed, each with the number of its entry in `reduced`, plus one. 0: none.
    seen: FxHashSet<(FlowId, u32)>,
    /// The `finally` blocks that are walked back through from where control leaves them one way: the label at the start of the block, the
    /// label whose antecedents are those that lead to leaving it that way, and the number of the block around it, as in `seen`.
    reduced: Vec<(FlowId, FlowId, u32)>,
    pending: Vec<(FlowId, u32)>,
}

/// Where the code that constructs an object uses `this`.
#[derive(Copy, Clone)]
enum At {
    /// Among the parameters of the constructor.
    Parameters,
    Initializer(MemberId),
    /// In the body of the constructor, at or after this node of the control flow graph.
    Body(FlowId),
}

/// What it does with it.
#[derive(Copy, Clone)]
enum Access {
    /// `this.name`
    Reads(Atom),
    /// `this.name = value`
    Stores(Atom),
    /// Anything else: from here on any code may have got hold of the object.
    LetsGo,
}

/// A use of `this` other than a store to a field.
#[derive(Copy, Clone)]
struct Use {
    at: At,
    /// The field that is read. `NONE`: `this` is let go of.
    reads: Atom,
}

/// What first stores to a field.
#[derive(Copy, Clone)]
enum Stored {
    ByInitializer(MemberId),
    AsParameter,
    ByConstructor,
}

/// See `makes_object_of_engine`.
const MOST_INERT_LENGTH: f64 = 65536.0;
/// See `constant_held_by`.
const MOST_BYTES_OF_CONSTANT: usize = 64;
const MAX_FOLDED_STRING_PART_LEN: usize = 16384;

fn end_of_substitution(text: &[u8], mut i: usize) -> usize {
    while i < text.len() && text[i] != b'}' {
        match (text[i], text.get(i + 1)) {
            (b'/', Some(b'*')) => {
                i += 2;
                while i < text.len() && !text[i..].starts_with(b"*/") {
                    i += 1;
                }
                i += 2;
            }
            (b'/', Some(b'/')) => {
                while i < text.len() && !matches!(text[i], b'\n' | b'\r') && !text[i..].starts_with(b"\xE2\x80\xA8") && !text[i..].starts_with(b"\xE2\x80\xA9") {
                    i += 1;
                }
            }
            _ => i += 1,
        }
    }
    i + 1
}

fn set(bits: &mut [u64], symbol: SymbolId) {
    if let Some(word) = bits.get_mut(symbol.idx() / 64) {
        *word |= 1 << (symbol.idx() % 64);
    }
}

fn has(bits: &[u64], symbol: SymbolId) -> bool {
    bits.get(symbol.idx() / 64).is_some_and(|word| word >> (symbol.idx() % 64) & 1 != 0)
}

impl<'p, 's> Checker<'p, 's> {
    // ───────────────────────────── what a place holds ─────────────────────────────

    /// `sym`: a variable, a parameter or a static field.
    pub fn storage_of_symbol(&mut self, sym: Sym) -> Storage {
        Storage { ty: self.type_stored_to(sym), starts_undefined: self.starts_undefined(sym) }
    }

    /// The checker's type of the variable, and for one that has its type from its initializer also what that yields.
    pub(super) fn type_stored_to(&mut self, sym: Sym) -> TypeId {
        if let Some(&known) = self.aot.storage.stored.get(&sym) {
            return known;
        }
        // One that is initialized with itself by way of another.
        if let Some(assumed) = self.assumption(Query::Stored(sym)) {
            return TypeId(assumed as u32);
        }
        let declared = self.type_of_symbol(sym);
        let (stored, is_final) = self.solve(Query::Stored(sym), u64::from(declared.0), u64::from(TypeId::UNKNOWN.0), |c| u64::from(c.find_type_stored_to(sym, declared).0));
        let stored = TypeId(stored as u32);
        if is_final {
            self.aot.storage.stored.insert(sym, stored);
        }
        stored
    }

    fn without_number_literals(&mut self, ty: TypeId) -> TypeId {
        self.map_type(ty, |c, part| if matches!(c.data(part), TypeData::NumberLit { .. } | TypeData::BigIntLit { .. } | TypeData::BoolLit { .. }) { c.base_of_literal(part) } else { part })
    }

    pub fn without_number_literals_in_arguments(&mut self, ty: TypeId) -> TypeId {
        self.map_type(ty, |c, part| c.without_number_literals_in_arguments_of(part, 4, false))
    }

    pub fn without_number_literals_given(&mut self, ty: TypeId) -> TypeId {
        let ty = self.without_number_literals(ty);
        self.without_number_literals_in_arguments(ty)
    }

    fn without_number_literals_in_arguments_of(&mut self, part: TypeId, depth: u32, is_under_an_argument: bool) -> TypeId {
        if depth == 0 {
            return part;
        }
        match self.data(part) {
            TypeData::Ref { target, .. } if self.files().module(target.file).is_lib && !self.is_reference_to_global(part, crate::atom::known::ReadonlyArray, 1) => {
                let not_known_before = self.aot.flows.times_not_known;
                let arguments = self.type_arguments(part);
                let mapped: Vec<TypeId> = arguments.iter().map(|&argument| self.argument_without_number_literals(argument, depth - 1)).collect();
                if mapped[..] == *arguments {
                    return part;
                }
                let rebuilt = self.intern_key(TypeKey::Ref { target: *target, args: &mapped });
                self.seen_wider(part, rebuilt, not_known_before)
            }
            TypeData::Tuple { flags, readonly: false, .. } if is_under_an_argument => {
                let not_known_before = self.aot.flows.times_not_known;
                let elements = self.type_arguments(part);
                let mapped: Vec<TypeId> = elements.iter().map(|&element| self.argument_without_number_literals(element, depth - 1)).collect();
                if mapped[..] == *elements {
                    return part;
                }
                let rebuilt = self.normalized_tuple(&mapped, flags, false);
                self.seen_wider(part, rebuilt, not_known_before)
            }
            _ => part,
        }
    }

    fn seen_wider(&mut self, part: TypeId, wider: TypeId, not_known_before: usize) -> TypeId {
        if self.is_provably_assignable(part, wider) {
            wider
        } else if self.aot.flows.times_not_known != not_known_before {
            TypeId::UNKNOWN
        } else {
            part
        }
    }

    fn argument_without_number_literals(&mut self, argument: TypeId, depth: u32) -> TypeId {
        let argument = self.without_number_literals(argument);
        self.map_type(argument, |c, part| c.without_number_literals_in_arguments_of(part, depth, true))
    }

    fn find_type_stored_to(&mut self, sym: Sym, declared: TypeId) -> TypeId {
        if let Some((file, Decl::Param(pat) | Decl::Var(pat))) = self.files().value_declaration(sym)
            && self.is_in_second_body(file, self.hir(file)[pat].pos)
        {
            return TypeId::UNKNOWN;
        }
        if let Some((file, Decl::Param(pat))) = self.files().value_declaration(sym)
            && let PatParent::Param(p) = root_declaration(self.bound(file), pat)
            && self.is_param_predicted(file, p)
        {
            return TypeId::UNKNOWN;
        }
        if let Some((file, Decl::Param(pat))) = self.files().value_declaration(sym)
            && let PatParent::Param(p) = root_declaration(self.bound(file), pat)
            && self.hir(file)[p].ty.is_none()
        {
            return self.without_number_literals(declared);
        }
        let Some((file, Decl::Var(pat))) = self.files().value_declaration(sym) else { return declared };
        let hir = self.hir(file);
        let PatParent::Var(d) = root_declaration(self.bound(file), pat) else { return declared };
        if hir[d].ty.is_some() {
            // What the program is given is not held to what is written where it is kept, where that is a type that is everybody's: it is what the value is expected to be.
            let is_given = hir[d].pat == pat && hir[d].init.is_some() && self.is_laid_out_nowhere(declared) && self.is_predicted(file, hir[d].init);
            return if is_given { TypeId::UNKNOWN } else { declared };
        }
        let is_bound_by_a_loop = hir[d].init.is_none() && self.iterable_of_loop_variable(file, d).is_some();
        let is_literal = hir[d].init.is_some() && matches!(hir[hir[d].init].kind, ExprKind::True | ExprKind::False | ExprKind::Number(_) | ExprKind::BigInt(_) | ExprKind::Unary { .. } | ExprKind::As { .. });
        let declared = if is_bound_by_a_loop || hir[d].pat != pat || matches!(hir[d].kind, VarKind::Let | VarKind::Var) || !is_literal { self.without_number_literals(declared) } else { declared };
        let declared = self.without_number_literals_in_arguments(declared);
        // What a pattern takes out of a prediction, or a loop out of a predicted iterable, is a prediction: `const { size } = fs.statSync(p)`,
        // `for (const name of fs.readdirSync(p))`.
        if hir[d].pat != pat || hir[d].init.is_none() {
            let source = if hir[d].init.is_some() { hir[d].init } else { self.iterable_of_loop_variable(file, d) };
            if source.is_none() {
                return if hir[d].pat == pat { self.type_assigned_to(file, sym).unwrap_or(declared) } else { declared };
            }
            let is_predicted = self.is_predicted(file, source) || (hir[d].init.is_some() && self.takes_predicted_prop(file, pat, source));
            return if is_predicted { TypeId::UNKNOWN } else { declared };
        }
        if self.is_typed_as_handed_on(file, hir[d].init) {
            return declared;
        }
        let handed_on = self.type_handed_on(file, hir[d].init);
        self.union(&[declared, handed_on])
    }

    /// `let x;`, with no type and no value. The checker types every read of it by the stores that reach the read, and the variable itself not at all. It holds what is
    /// stored to it, and every store is by its name, in its file. Only where that is primitives: an array that is stored to it is typed by what is pushed later.
    fn type_assigned_to(&mut self, file: FileId, sym: Sym) -> Option<TypeId> {
        let (values, computed) = self.expressions_stored_to(sym)?;
        let mut stored: Vec<TypeId> = values.into_iter().map(|value| self.type_handed_on(file, value)).collect();
        stored.extend(computed.into_iter().map(|by| self.type_of_expr(file, by)));
        let are_primitives = !stored.is_empty() && stored.iter().all(|&ty| self.every_type(ty, |c, part| c.is_primitive(part)));
        are_primitives.then(|| self.union(&stored))
    }

    // ───────────────────────────── queries that depend on themselves ─────────────────────────────

    /// If the query is in flight: what is assumed of it for now. Whoever asks relies on that.
    pub(super) fn assumption(&mut self, query: Query) -> Option<u64> {
        let state = &mut self.aot.storage;
        let index = state.in_flight.iter().position(|it| it.query == query)?;
        state.in_flight[index].is_relied_on = true;
        state.outermost_relied_on.0 = state.outermost_relied_on.0.min(index);
        Some(state.in_flight[index].assumed)
    }

    /// The answer to a query that may depend on itself: `const a = f(() => a)`, two functions with inferred results that return each
    /// other's, a binding of a module that imports it back. `find` is run with `start` assumed of the query. If it relied on that and
    /// found something else, it is run again with what it found, until the two agree: the fixed point next to `start`, which is the
    /// same whichever query of the cycle is asked first. After `MOST_ROUNDS` the answer is `give_up`, the safe side.
    ///
    /// The second value: the answer relies on no assumption about a query further out, so it may be memoized. What is found inside a
    /// cycle is not: it is found again, from the memoized answer of the outermost query, when it is asked for the next time. Every
    /// cache of something that is derived from these queries has to be a query of this kind itself.
    pub(super) fn solve(&mut self, query: Query, start: u64, give_up: u64, find: impl Fn(&mut Self) -> u64) -> (u64, bool) {
        const MOST_ROUNDS: usize = 8;
        let index = self.aot.storage.in_flight.len();
        self.aot.storage.in_flight.push(InFlight { query, assumed: start, is_relied_on: false });
        let further_out = std::mem::take(&mut self.aot.storage.outermost_relied_on).0;
        let mut rounds = 0;
        let found = loop {
            self.aot.storage.in_flight[index].is_relied_on = false;
            let found = find(self);
            let own = &mut self.aot.storage.in_flight[index];
            if !own.is_relied_on || own.assumed == found {
                break found;
            }
            rounds += 1;
            if rounds == MOST_ROUNDS {
                break give_up;
            }
            own.assumed = found;
        };
        self.aot.storage.in_flight.truncate(index);
        let relied_on = self.aot.storage.outermost_relied_on.0;
        let is_final = relied_on >= index;
        self.aot.storage.outermost_relied_on.0 = if is_final { further_out } else { further_out.min(relied_on) };
        (found, is_final)
    }


    /// `const { performance } = p`, where `p` is an object literal's own type and its `performance` was initialized with a prediction. `pat`: the
    /// name that is bound, however deep in the pattern. `source`: the initializer.
    fn takes_predicted_prop(&mut self, file: FileId, pat: PatId, source: ExprId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut names = Vec::new();
        let mut at = pat;
        loop {
            match bound.pat_parent[at.idx()] {
                PatParent::Prop(outer, prop) => {
                    match (hir[prop].key, hir[hir[prop].value].kind) {
                        (PropKey::Name(name), _) | (PropKey::None, PatKind::Ident(name)) if !hir[prop].is_rest => names.push(name),
                        _ => return false,
                    }
                    at = outer;
                }
                PatParent::Var(_) => break,
                _ => return false,
            }
        }
        let mut ty = self.type_of_expr(file, source);
        for name in names.into_iter().rev() {
            if self.has_predicted_prop(ty, name) || self.has_member_of_class_without_body(ty, name) {
                return true;
            }
            let object = self.non_nullable(ty);
            let Some(next) = self.type_of_property(object, name) else { return false };
            ty = next;
        }
        false
    }

    pub fn is_taken_out_of_prediction(&mut self, file: FileId, pat: PatId) -> bool {
        let hir = self.hir(file);
        match root_declaration(self.bound(file), pat) {
            PatParent::Var(d) if hir[d].ty.is_none() && hir[d].pat != pat => {
                let source = if hir[d].init.is_some() { hir[d].init } else { self.iterable_of_loop_variable(file, d) };
                source.is_some() && (self.is_predicted(file, source) || (hir[d].init.is_some() && self.takes_predicted_prop(file, pat, source)))
            }
            PatParent::Param(p) => self.is_param_predicted(file, p),
            _ => false,
        }
    }

    /// `xs` of `for (const x of xs)`, for the declaration of `x`.
    fn iterable_of_loop_variable(&self, file: FileId, d: VarDeclId) -> ExprId {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let left = bound.var_stmt[d.idx()];
        if left.is_none() {
            return ExprId::NONE;
        }
        match bound.stmt_parent[left.idx()] {
            Parent::Stmt(parent) => match hir[parent].kind {
                StmtKind::ForOf { left: declares, expr, .. } if declares == left => expr,
                _ => ExprId::NONE,
            },
            _ => ExprId::NONE,
        }
    }

    /// `e`: `x as unknown as T`, `<T><any>x`. What `x` hands on, if that is a type that says something: the casts in between are nothing to it.
    pub fn source_of_double_cast(&mut self, file: FileId, e: ExprId) -> Option<TypeId> {
        let ExprKind::As { expr: mut operand, .. } = self.hir(file)[e].kind else { return None };
        let mut is_double = false;
        while let ExprKind::As { expr, .. } = self.hir(file)[operand].kind {
            let between = self.type_of_expr(file, operand);
            if !between.is_any() && between != TypeId::UNKNOWN {
                break;
            }
            (operand, is_double) = (expr, true);
        }
        let target = self.type_of_expr(file, e);
        let target = self.reduced(target);
        let parts: Vec<TypeId> = self.parts(target).to_vec();
        if !is_double || !parts.into_iter().any(|part| self.can_be_made_of_anything(part)) {
            return None;
        }
        // `{ .. } as any` asks for a dynamic object: it is made an ordinary one, of which the type of the literal says nothing.
        if matches!(self.hir(file)[operand].kind, ExprKind::Object(_) | ExprKind::Array(_)) {
            return None;
        }
        let source = self.type_known_of(file, operand);
        (!self.says_nothing(source) && !self.is_untyped(source)).then_some(source)
    }

    /// Whether the type says nothing of which fields an object of it has: `is_untyped`, or a dictionary: `Record<string, unknown>`, `{ [key: string]: V }`. A cast from such a type is forced:
    /// `d as T` is `d as unknown as T` written short.
    pub fn says_nothing_of_fields(&mut self, ty: TypeId) -> bool {
        if self.says_nothing(ty) || self.is_untyped(ty) {
            return true;
        }
        let ty = self.reduced(ty);
        self.parts(ty).iter().any(|&part| {
            self.members(part).is_some_and(|members| {
                let shape = members.shape();
                shape.props.is_empty() && !shape.index.is_empty() && shape.call.is_empty() && shape.construct.is_empty()
            })
        })
    }

    /// The call `e` is resolved to a function that returns what a forced cast yields, to a type with type parameters: `return built as unknown as Built<D>`, `return dictionary as T`. Nothing can
    /// be tested in there, and the cast at the way out, to what the caller takes the result for, stands for that one. What the operand of the cast is known to be. Also where the function
    /// returns what a call of such a function yields, still of a type with type parameters.
    pub fn operand_of_forced_cast_returned_by(&mut self, file: FileId, e: ExprId) -> Option<TypeId> {
        const MOST_CALLS: u32 = 4;
        self.operand_of_forced_cast_behind(file, e, MOST_CALLS)
    }

    fn operand_of_forced_cast_behind(&mut self, file: FileId, e: ExprId, calls_left: u32) -> Option<TypeId> {
        let (of, func, _) = self.resolved_signature(file, e).sig.and_then(|sig| self.sig_decl(sig))?;
        let returned = self.casts_returned_in(of);
        for &(_, returned) in returned.iter().filter(|returned| returned.0 == func) {
            let to = self.type_of_expr(of, returned);
            if !self.has_type_variables(to) {
                continue;
            }
            match self.hir(of)[returned].kind {
                ExprKind::As { expr, .. } => {
                    let between = self.type_of_expr(of, expr);
                    if !self.says_nothing_of_fields(between) {
                        continue;
                    }
                    let mut operand = expr;
                    while let ExprKind::As { expr, .. } = self.hir(of)[operand].kind {
                        operand = expr;
                    }
                    return Some(self.type_known_of(of, operand));
                }
                _ if calls_left > 0 => {
                    if let Some(operand) = self.operand_of_forced_cast_behind(of, returned, calls_left - 1) {
                        return Some(operand);
                    }
                }
                _ => {}
            }
        }
        None
    }

    /// The casts and the calls that the functions of the file return, each with its function.
    fn casts_returned_in(&self, file: FileId) -> &'p Vec<(FnId, ExprId)> {
        let program = self.p;
        program.aot.storage.casts_returned.get_or_init(program.files.modules.len(), file, || {
            let (hir, bound) = (self.hir(file), self.bound(file));
            let by_kind = self.exprs_by_kind_of(file);
            (by_kind.of(ExprTag::As).iter().chain(by_kind.of(ExprTag::Call)))
                .filter_map(|&cast| match bound.expr_parent[cast.idx()] {
                    Parent::Stmt(stmt) if matches!(hir[stmt].kind, StmtKind::Return(value) if value == cast) => match self.code_running(file, Parent::Stmt(stmt)) {
                        Some(RunBy::Function(func)) => Some((func, cast)),
                        _ => None,
                    },
                    Parent::FnBody(func) => Some((func, cast)),
                    _ => None,
                })
                .collect()
        })
    }

    /// What the expression hands on. `Object.assign(target, ..)` and the like yield an object of the program itself, looked at as the type of the call says: `Builder::as_handed_back`.
    fn type_known_of(&mut self, file: FileId, e: ExprId) -> TypeId {
        let handed_on = self.type_handed_on(file, e);
        if !self.says_nothing(handed_on) {
            return handed_on;
        }
        let Some(first) = self.argument_handed_back_by(file, e) else { return handed_on };
        let of_first = self.type_known_of(file, first);
        if self.says_nothing(of_first) || self.is_untyped(of_first) { handed_on } else { self.type_of_expr(file, e) }
    }

    /// The type of what the expression yields. That is the checker's type of it, but for what the checker makes of a type that has no
    /// `undefined`, no `null` and nothing else that is falsy: `a ?? b` and `a || b` are `a`, `a && b` is `b`, `!a` is `false`. Here a
    /// reference may be nil whatever its type says, and there may be no such element or key. So `!a` is a boolean, `a ?? b` and
    /// `a || b` may yield `b`, and `a && b` may yield `undefined`. What the checker leaves out of `a` because the operator has tested
    /// for it stays out.
    pub fn type_yielded_by(&mut self, file: FileId, e: ExprId) -> TypeId {
        if let Some(&known) = self.aot.storage.yielded.get(&(file, e)) {
            return known;
        }
        let asked = self.nothing_is_assumed();
        let found = self.find_type_yielded_by(file, e);
        let found = self.without_number_literals_in_arguments(found);
        if self.may_be_kept(asked) {
            self.aot.storage.yielded.insert((file, e), found);
        }
        found
    }

    pub fn is_held_to_the_fixed_set(&self, file: FileId) -> bool {
        self.files().module(file).is_held_to_the_fixed_set()
    }

    pub(super) fn nothing_is_assumed(&self) -> Option<u32> {
        (self.aot.storage.in_flight.is_empty() && self.aot.storage.being_told_of == 0 && self.aot.javascript.nothing_is_in_progress() && self.aot.kinds.nothing_grows()).then(|| self.times_half_of_stack_was_in_use())
    }

    pub(in crate::check) fn may_miss_at_an_index(&self, within: Option<FileId>) -> bool {
        self.p.files.options.no_unchecked_indexed_access && !within.or(self.aot.storage.accessed_within).is_some_and(|file| self.is_held_to_the_fixed_set(file))
    }

    pub(super) fn may_be_kept(&self, asked: Option<u32>) -> bool {
        asked == Some(self.times_half_of_stack_was_in_use())
    }

    pub fn forget_answers_by_expression(&mut self) {
        self.aot.storage.yielded.clear();
        self.aot.storage.reads.clear();
        self.aot.javascript.forget_answers_by_expression();
    }

    fn find_type_yielded_by(&mut self, file: FileId, e: ExprId) -> TypeId {
        if self.is_half_of_stack_in_use() {
            return TypeId::ANY;
        }
        let (operator, left, right) = match self.hir(file)[e].kind {
            ExprKind::Unary { op: UnOp::Not, .. } => return TypeId::BOOLEAN,
            ExprKind::Binary { op: op @ (BinOp::And | BinOp::Or | BinOp::Nullish), left, right } | ExprKind::Assign { op: Some(op @ (BinOp::And | BinOp::Or | BinOp::Nullish)), target: left, value: right } => (Some(op), left, right),
            ExprKind::Cond { yes, no, .. } => (None, yes, no),
            ExprKind::Binary { op: BinOp::Comma, right: expr, .. } | ExprKind::Assign { op: None, value: expr, .. } | ExprKind::Satisfies { expr, .. } | ExprKind::AsConst(expr) => {
                let yielded = self.type_yielded_by(file, expr);
                return match self.held_besides_what_flow_tells(file, expr) {
                    Some(held) => self.union(&[yielded, held]),
                    None => yielded,
                };
            }
            // Of an operand that other code may have stored to since it was narrowed, only what it is declared to be is known.
            ExprKind::Binary { op, left, right } | ExprKind::Assign { op: Some(op), target: left, value: right }
                if matches!(op, BinOp::Add | BinOp::Sub | BinOp::Mul | BinOp::Div | BinOp::Rem | BinOp::Pow | BinOp::Shl | BinOp::Shr | BinOp::UShr | BinOp::BitAnd | BinOp::BitOr | BinOp::BitXor) =>
            {
                return self.type_computed_from(file, e, &[left, right], op == BinOp::Add);
            }
            ExprKind::Unary { op: UnOp::Minus | UnOp::BitNot | UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec, operand } => {
                return self.type_computed_from(file, e, &[operand], false);
            }
            ExprKind::This if self.this_container_of(file, e).is_some_and(|func| self.is_this_predicted(file, func)) => return TypeId::UNKNOWN,
            // What a function whose result is inferred returns may be more than the checker infers: see `result_of_fn`.
            ExprKind::Call(_) if self.has_declared_type(file, e) => {
                let own = self.type_of_expr(file, e);
                let own = match self.resolved_signature(file, e).sig {
                    Some(sig) => match self.sig_decl(sig) {
                        Some((of, func, _)) if self.return_type_of_fn(of, func) == self.sig_return(sig) => own,
                        _ if self.parts(own).iter().all(|part| part.is_null() || part.is_undefined()) => TypeId::UNKNOWN,
                        _ => self.without_number_literals_given(own),
                    },
                    None => own,
                };
                // What a callback of the host returns is held to nothing, whoever calls it.
                if let Some(sig) = self.resolved_signature(file, e).sig
                    && let Some((of, func, _)) = self.sig_decl(sig)
                    && self.hir(of)[func].ret.is_none()
                    && !self.hir(of)[func].flags.intersects(Flags::ASYNC | Flags::GENERATOR)
                    && self.is_host_callback(of, func)
                {
                    return TypeId::UNKNOWN;
                }
                if let Some(sig) = self.resolved_signature(file, e).sig
                    && let Some((of, func, _)) = self.sig_decl(sig)
                    && !self.is_untyped_file(of)
                    && self.is_compiled(of)
                    && self.hir(of)[func].ret.is_none()
                    && let (compiled, false) = self.result_of_fn(of, func)
                    && compiled != self.return_type_of_fn(of, func)
                    // What comes out of a generic function is held to what the call puts in for its type parameters: there an object that
                    // `createBaseNode<T>(kind)` has made as a `Node` becomes what it is.
                    && self.return_type_of_fn(of, func) == self.sig_return(sig)
                    && !self.is_result_of_call_annotated(file, e)
                {
                    return self.union(&[own, compiled]);
                }
                return own;
            }
            // `C.prototype`, what is read from JavaScript: the program is not held to the checker's type.
            _ if !self.is_untyped_file(file) && !self.has_declared_type(file, e) => return TypeId::UNKNOWN,
            // `as` coerces and does not assert: an object that cannot be made one of the type stays what it was.
            ExprKind::As { expr, .. } => {
                let source = match self.source_of_double_cast(file, e) {
                    Some(source) => source,
                    None => self.type_handed_on(file, expr),
                };
                let target = self.type_of_expr(file, e);
                // What the program is given stays what it is, and the type is what it is expected to be. What the program has made is known for what it is.
                if (self.has_tainted_part(target) || self.is_given(file, expr)) && (self.says_nothing(source) || self.is_untyped(source)) {
                    return TypeId::UNKNOWN;
                }
                return self.type_coerced(source, target);
            }
            // A variable of which nothing has been found out on the way holds what is stored to it, which may be more than the checker
            // takes it for: `const p = node.parent as BinaryExpression`.
            ExprKind::Ident(name) => {
                let own = self.type_of_expr(file, e);
                let sym = self.symbol_named_by(file, e, name);
                let Some(sym) = sym.filter(|&sym| matches!(self.declaration_of_variable(sym), Some((_, Decl::Var(_) | Decl::Param(_))))) else { return own };
                // Narrowing that only drops union members drops them from what is stored too, and leaves the rest: an object that a cast
                // let through is still there. `const p = n as Named | undefined; if (p) p.name`; `const d = n as A | B; d.kind === K_A ||
                // d.kind === K_B`, where the second `d` is a `B` to the checker and may be any `n`.
                let declared = self.type_of_symbol(sym);
                let gone: Vec<TypeId> = self.parts(declared).iter().copied().filter(|part| !self.parts(own).contains(part)).collect();
                if !self.parts(own).iter().all(|part| self.parts(declared).contains(part)) {
                    return own;
                }
                let stored = self.type_stored_to(sym);
                if gone.is_empty() {
                    return stored;
                }
                // What a type guard proves is its own type, not the union members the checker keeps.
                if let Some(proved) = self.type_proved_by_guard(file, e, stored, own) {
                    return if self.parts(proved) == self.parts(own) { own } else { proved };
                }
                return if stored == declared { own } else { self.filter(stored, |_, part| !gone.contains(&part)) };
            }
            // `!` asserts that there is something, and nothing of what it is.
            ExprKind::NonNull(expr) => {
                let yielded = self.type_yielded_by(file, expr);
                let without_nil = if yielded == self.type_of_expr(file, expr) { self.type_of_expr(file, e) } else { self.non_nullable(yielded) };
                return match self.held_besides_what_flow_tells(file, e) {
                    Some(held) => self.union(&[without_nil, held]),
                    None => without_nil,
                };
            }
            ExprKind::Dot { .. } => {
                return match self.property_read_of_coerced(file, e) {
                    Some((found, target)) => self.type_coerced(found, target),
                    None => self.type_of_expr(file, e),
                };
            }
            _ => return self.type_of_expr(file, e),
        };
        let own = self.type_of_expr(file, e);
        let mut parts = vec![own];
        for operand in [left, right] {
            let yielded = self.type_yielded_by(file, operand);
            let is_tested = operand == left && operator.is_some() && yielded == self.type_of_expr(file, left);
            if !is_tested && !self.is_provably_assignable(yielded, own) {
                parts.push(yielded);
            }
            // The checker has the type of the whole from the narrowed types of the operands.
            if let Some(held) = self.held_besides_what_flow_tells(file, operand) {
                let is_left_without_nil = operand == left && matches!(operator, Some(BinOp::Or | BinOp::Nullish));
                parts.push(if is_left_without_nil { self.non_nullable(held) } else { held });
            }
        }
        if operator == Some(BinOp::And) && !self.contains_undefined(own) {
            let (tested, may_be_undefined) = self.type_held_to(file, left);
            if may_be_undefined || !self.every_type(tested, |c, part| c.is_number_like(part) || c.is_boolean_like(part)) {
                parts.push(TypeId::UNDEFINED);
            }
        }
        if parts.len() == 1 { own } else { self.union(&parts) }
    }

    /// `NONE` is.
    fn is_typed_as_it_yields(&mut self, file: FileId, e: ExprId) -> bool {
        e.is_none() || self.type_yielded_by(file, e) == self.type_of_expr(file, e)
    }

    /// What a place has to have room for that takes its type from the expression: a variable from its initializer, the result of a
    /// function from what is returned. That is what the expression yields, and for a reference whose narrowing is not reliable what the
    /// place it reads is declared to hold. And the `undefined` that a variable holds before anything is stored to it: `function early() {
    /// return v }`, called above `var v = 7`. Not the `undefined` of a missing element: a place for a number asserts that there is one.
    fn type_handed_on(&mut self, file: FileId, e: ExprId) -> TypeId {
        // `const o = (x as P).o`: the read is a coercion, and what it yields is not what `P` declares.
        if self.property_read_of_coerced(file, e).is_some() {
            return self.type_yielded_by(file, e);
        }
        let handed_on = match self.reference_read_by(file, e) {
            Some(read) if !read.is_narrowing_reliable && read.declared != TypeId::UNRESOLVED => read.declared,
            _ => self.type_yielded_by(file, e),
        };
        if self.may_yield_blank_variable(file, e) { self.union(&[handed_on, TypeId::UNDEFINED]) } else { handed_on }
    }

    /// Numbers and booleans are kept unboxed, in a place that has room for `undefined` only if its type says so.
    fn has_unboxed_part(&self, ty: TypeId) -> bool {
        self.parts(ty).iter().any(|&part| self.is_number_like(part) || self.is_boolean_like(part))
    }

    /// Whether what the expression yields may be what a variable holds that nothing has been stored to yet: an `undefined` that the
    /// checker's type of the expression leaves out.
    pub fn may_yield_blank_variable(&mut self, file: FileId, e: ExprId) -> bool {
        match self.hir(file)[e].kind {
            // A reference may be nil as it is kept: there the type leaves nothing out.
            ExprKind::Ident(_) => self.reference_read_by(file, e).is_some_and(|read| read.may_be_undefined && self.has_unboxed_part(read.declared)),
            ExprKind::Cond { yes: left, no: right, .. } | ExprKind::Binary { op: BinOp::And, left, right } | ExprKind::Assign { op: Some(BinOp::And), target: left, value: right } => {
                self.may_yield_blank_variable(file, left) || self.may_yield_blank_variable(file, right)
            }
            // `undefined` on the left does not come out.
            ExprKind::Binary { op: BinOp::Or | BinOp::Nullish | BinOp::Comma, right: expr, .. }
            | ExprKind::Assign { op: None | Some(BinOp::Or | BinOp::Nullish), value: expr, .. }
            | ExprKind::Satisfies { expr, .. }
            | ExprKind::AsConst(expr)
            | ExprKind::As { expr, .. } => self.may_yield_blank_variable(file, expr),
            _ => false,
        }
    }

    /// `NONE` is.
    fn is_typed_as_handed_on(&mut self, file: FileId, e: ExprId) -> bool {
        e.is_none() || self.type_handed_on(file, e) == self.type_of_expr(file, e)
    }

    /// `sym`: an instance field. `extended`: see `field_starts_undefined`.
    pub fn storage_of_field(&mut self, sym: Sym, extended: &[(FileId, ClassId)]) -> Storage {
        Storage { ty: self.type_of_symbol(sym), starts_undefined: self.field_starts_undefined(sym, extended) }
    }

    /// What arrives for the parameter. An argument that may be left out arrives as `undefined`.
    pub fn storage_of_param(&mut self, file: FileId, p: ParamId) -> Storage {
        let param = &self.hir(file)[p];
        let ty = if self.is_param_predicted(file, p) { TypeId::UNKNOWN } else { self.type_of_param(file, p) };
        let ty = if param.ty.is_none() { self.without_number_literals(ty) } else { ty };
        Storage { ty, starts_undefined: param.default.is_some() || param.flags.contains(Flags::OPTIONAL) }
    }

    // ───────────────────────────── callbacks of the host ─────────────────────────────

    /// Whether the function expression is handed to code that a declaration without a body stands for, see trust.rs, so that only that
    /// declaration says what the function is called with: `fs.readFile(path, (error, data) => ..)`, `Bun.serve({ fetch(request) { .. } })`,
    /// `socket.onmessage = event => ..`, `<button onClick={event => ..}>`, and a function that such a function returns. Not
    /// `list.sort((a, b) => ..)`, which the engine implements, nor `useState(() => ..)`, which `libraries.rs` vouches for. Not where the
    /// program writes the type down on the way: `(request => ..) satisfies Handler`.
    pub fn is_host_callback(&mut self, file: FileId, func: FnId) -> bool {
        if let Some(&known) = self.aot.storage.host_callbacks.get(&(file, func)) {
            return known;
        }
        // One that is handed to what it yields itself.
        if let Some(assumed) = self.assumption(Query::HostCallback(file, func)) {
            return assumed != 0;
        }
        let (found, is_final) = self.solve(Query::HostCallback(file, func), 1, 1, |c| u64::from(c.find_is_host_callback(file, func)));
        if is_final {
            self.aot.storage.host_callbacks.insert((file, func), found != 0);
        }
        found != 0
    }

    fn is_named_by_the_library_alone(&mut self, file: FileId, literal: ExprId, key: PropKey) -> bool {
        let Some(name) = self.declared_member_name(file, key) else { return false };
        self.prepare_enclosing(file, literal);
        let Some(expected) = self.apparent_type_of_contextual_type(file, literal, ContextFlags::SIGNATURE) else { return false };
        let mut is_found = false;
        for &part in self.parts(expected) {
            let Some(members) = self.members(part) else { continue };
            if members.resolved.prop(name).is_some() {
                return false;
            }
            is_found |= self.property_in_type(part, &members, name).is_some();
        }
        is_found
    }

    fn find_is_host_callback(&mut self, file: FileId, func: FnId) -> bool {
        let FnOwner::Expr(e) = self.bound(file).fns[func.idx()].owner else { return false };
        !self.is_untyped_file(file) && self.is_handed_to_host(file, e)
    }

    fn symbol_naming_function(&self, file: FileId, func: FnId) -> SymbolId {
        let (hir, bound) = (self.hir(file), self.bound(file));
        match bound.fns[func.idx()].owner {
            FnOwner::Stmt(_) => bound.symbol_of_declaration(Decl::Fn(func)),
            FnOwner::Expr(e) => match bound.expr_parent[e.idx()] {
                Parent::VarInit(d) if matches!(hir[hir[d].pat].kind, PatKind::Ident(_)) => bound.pat_symbol[hir[d].pat.idx()],
                _ => SymbolId::NONE,
            },
            _ => SymbolId::NONE,
        }
    }

    fn is_handed_to_host_by_name(&mut self, file: FileId, func: FnId) -> bool {
        let symbol = self.symbol_naming_function(file, func);
        !self.is_untyped_file(file) && self.mentions_of(file, symbol).into_iter().any(|mention| self.is_handed_to_host(file, mention))
    }

    fn is_handed_to_host(&mut self, file: FileId, mut e: ExprId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        loop {
            let parent = match bound.expr_parent[e.idx()] {
                Parent::Prop(prop) if hir[prop].kind != PropKind::Spread => {
                    let owner = bound.prop_owner[prop.idx()];
                    if owner.is_none() {
                        return false;
                    }
                    match (hir[owner].kind, hir[prop].key) {
                        (ExprKind::Object(_), key) if self.is_named_by_the_library_alone(file, owner, key) => return true,
                        (ExprKind::Object(_), _) => {}
                        (ExprKind::Jsx(_), PropKey::Name(name)) => return self.is_jsx_prop_for_host(file, owner, Some(name)),
                        _ => return false,
                    }
                    e = owner;
                    continue;
                }
                Parent::FnBody(outer) => return hir[outer].ret.is_none() && self.is_host_callback(file, outer),
                Parent::Stmt(stmt) if stmt.is_some() && matches!(hir[stmt].kind, StmtKind::Return(_)) => {
                    return matches!(self.site_of(file, Parent::Stmt(stmt)), Some(Site::Body(outer)) if hir[outer].ret.is_none() && self.is_host_callback(file, outer));
                }
                Parent::Expr(parent) if parent.is_some() => parent,
                _ => return false,
            };
            match hir[parent].kind {
                ExprKind::Call(call) | ExprKind::New(call) => {
                    let callee = hir[call].callee;
                    if callee == e || matches!(hir[callee].kind, ExprKind::Super) {
                        return false;
                    }
                    return match self.vouched_export(file, callee) {
                        Some(export) => hir.ids(hir[call].args).position(|argument| argument == e).is_some_and(|at| export.host_callbacks.contains(&at)),
                        None => self.is_predicted(file, callee),
                    };
                }
                ExprKind::Assign { op: None, target, value } if value == e => return self.is_predicted(file, target),
                ExprKind::Jsx(_) => return self.is_jsx_prop_for_host(file, parent, None),
                ExprKind::Array(_) => {}
                ExprKind::Cond { test, .. } if test != e => {}
                ExprKind::Binary { op: BinOp::And | BinOp::Or | BinOp::Nullish | BinOp::Comma, right, .. } if right == e => {}
                _ => return false,
            }
            e = parent;
        }
    }

    /// Whether host code, and no component of the program, gets the prop `name` of the JSX element, or its children for `None`. An
    /// intrinsic element is host code, and so is a component that only a declaration without a body stands for. A component of the
    /// program gets the props that it declares. The JSX runtime keeps the others to itself: `ref` on a class component.
    fn is_jsx_prop_for_host(&mut self, file: FileId, element: ExprId, name: Option<Atom>) -> bool {
        let hir = self.hir(file);
        let ExprKind::Jsx(jsx) = hir[element].kind else { return false };
        let tag = hir[jsx].tag;
        // A fragment calls nothing.
        if tag.is_none() {
            return false;
        }
        let is_intrinsic = match hir[tag].kind {
            ExprKind::Ident(tag) => crate::hir::is_intrinsic_jsx_name(self.atoms().bytes(tag)),
            ExprKind::String(_) => true,
            _ => false,
        };
        if is_intrinsic || self.is_predicted(file, tag) {
            return true;
        }
        let (Some(name), Some(sig)) = (name, self.resolved_signature(file, element).sig) else { return false };
        let Some(props) = self.sig_params(sig).first().map(|props| props.ty) else { return false };
        let apparent = self.apparent_type(props);
        self.property_type(props, apparent, name, shape::Access::Read).is_none()
    }

    /// A call of a cache that the toolchain vouches for, see `libraries.rs`, with a function expression `f` for its first argument:
    /// `useMemo(f, deps)` and `useCallback(f, deps)` of React. What it yields is tested, like what comes out of any container. But a cache
    /// may forget what it kept at any time, and then `useMemo` yields `f()` and `useCallback` yields `f`. So where the test fails the
    /// program goes on with that, and nothing throws. Either way what the call yields is of the checker's type of the call for a fact.
    /// `None`: there is nothing to go on with.
    pub fn recovery_of_call(&mut self, file: FileId, e: ExprId) -> Option<Recovery> {
        let hir = self.hir(file);
        let ExprKind::Call(call) = hir[e].kind else { return None };
        if self.is_untyped_file(file) || hir[call].chain != Chain::No {
            return None;
        }
        let ExprKind::Fn(func) = hir[hir.ids(hir[call].args).next()?].kind else { return None };
        let Vouched::Cache(recovery) = self.vouched_export(file, hir[call].callee)?.what else { return None };
        let is_called_as_it_is = hir[func].params.len() == 0 && !hir[func].flags.intersects(Flags::ASYNC | Flags::GENERATOR);
        (recovery == Recovery::Argument || is_called_as_it_is).then_some(recovery)
    }

    /// Whether only a declaration without a body says what arrives for the parameter: it has no annotation of its own.
    fn is_param_predicted(&mut self, file: FileId, p: ParamId) -> bool {
        let func = self.bound(file).param_fn[p.idx()];
        if self.is_in_second_body(file, self.hir(file)[self.hir(file)[p].pat].pos) {
            return true;
        }
        self.hir(file)[p].ty.is_none() && func.is_some() && self.is_host_callback(file, func)
    }

    fn is_in_second_body(&self, file: FileId, pos: u32) -> bool {
        let Some((of, spans)) = &self.aot.storage.second_bodies_on else { return false };
        *of == file && spans[..spans.partition_point(|span| span.0 <= pos)].last().is_some_and(|span| pos < span.1)
    }

    fn spans_of_second_bodies_in(&mut self, file: FileId) -> Rc<[(u32, u32)]> {
        let functions: Vec<FnId> = (0..self.hir(file).fns.len() as u32).map(FnId).filter(|&func| self.has_second_body(file, func) || self.method_has_second_body(file, func) || self.has_second_body_for_the_log(file, func)).collect();
        let mut spans: Vec<(u32, u32)> = functions.into_iter().map(|func| (self.hir(file)[func].start, self.end_of_fn(file, func))).collect();
        spans.sort_unstable();
        let mut apart: Vec<(u32, u32)> = Vec::with_capacity(spans.len());
        for span in spans {
            match apart.last_mut() {
                Some(last) if span.0 < last.1 => last.1 = last.1.max(span.1),
                _ => apart.push(span),
            }
        }
        apart.into()
    }

    fn swap_with_what_is_set_aside(&mut self) {
        let aside = self.aot.storage.set_aside.get_or_insert_with(Default::default);
        std::mem::swap(&mut self.aot.storage.told_of, &mut aside.told_of);
        std::mem::swap(&mut self.aot.storage.stored, &mut aside.stored);
        std::mem::swap(&mut self.aot.storage.results, &mut aside.results);
        std::mem::swap(&mut self.aot.trust, &mut aside.trust);
        std::mem::swap(&mut self.aot.integers, &mut aside.integers);
        std::mem::swap(&mut self.aot.kinds, &mut aside.kinds);
    }

    pub fn translate_second_body(&mut self, root: Option<(FileId, FnId)>) {
        let file = root.map(|root| root.0);
        if file == self.aot.storage.second_bodies_on.as_ref().map(|on| on.0) {
            return;
        }
        self.forget_answers_by_expression();
        if self.aot.storage.second_bodies_on.take().is_some() {
            self.swap_with_what_is_set_aside();
        }
        let Some(file) = file else { return };
        let spans = match &self.aot.storage.untyped_state_is_of {
            Some((of, spans)) if *of == file => Rc::clone(spans),
            _ => {
                let spans = self.spans_of_second_bodies_in(file);
                self.aot.storage.untyped_state_is_of = Some((file, Rc::clone(&spans)));
                self.aot.storage.set_aside = None;
                spans
            }
        };
        self.swap_with_what_is_set_aside();
        self.aot.storage.second_bodies_on = Some((file, spans));
    }

    pub fn has_second_body(&mut self, file: FileId, func: FnId) -> bool {
        if func.is_none() || self.is_untyped_file(file) || !self.is_compiled(file) {
            return false;
        }
        if let Some(&known) = self.aot.storage.second_bodies.get(&(file, func)) {
            return known;
        }
        let found = self.find_has_second_body(file, func);
        self.aot.storage.second_bodies.insert((file, func), found);
        found
    }

    fn names_private_member_within(&mut self, file: FileId, func: FnId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let (start, end) = (hir[func].start, self.end_of_fn(file, func));
        bound.private_class.iter().any(|(&e, _)| start <= hir[e].pos && hir[e].pos < end)
    }

    pub fn has_second_body_for_the_log(&mut self, file: FileId, func: FnId) -> bool {
        if !self.logs_type_errors() || func.is_none() || self.is_untyped_file(file) || !self.is_compiled(file) || self.files().module(file).builtin.is_some() {
            return false;
        }
        if let Some(&known) = self.aot.storage.second_bodies_for_the_log.get(&(file, func)) {
            return known;
        }
        let found = !self.has_second_body(file, func) && self.could_have_second_body(file, func) && (self.is_reached_by_who_does_not_know_it(file, func) || self.is_called_with_what_says_nothing(file, func));
        self.aot.storage.second_bodies_for_the_log.insert((file, func), found);
        found
    }

    fn find_has_second_body(&mut self, file: FileId, func: FnId) -> bool {
        self.could_have_second_body(file, func) && !self.places_taking_objects(file, func).is_empty() && self.is_reached_by_who_does_not_know_it(file, func)
    }

    fn is_reached_by_who_does_not_know_it(&mut self, file: FileId, func: FnId) -> bool {
        self.is_host_callback(file, func) || self.is_let_out(file, func) || self.is_handed_strangers_by_untyped_code(file, func) || self.is_handed_to_host_by_name(file, func)
    }

    fn could_have_second_body(&mut self, file: FileId, func: FnId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let f = &hir[func];
        if !matches!(bound.fns[func.idx()].owner, FnOwner::Expr(_) | FnOwner::Stmt(_)) || matches!(f.body, FnBody::None) {
            return false;
        }
        if f.this_param.is_some() || f.flags.intersects(Flags::ASYNC | Flags::GENERATOR) || f.params.iter().any(|p| hir[p].flags.contains(Flags::REST)) {
            return false;
        }
        let sees_nothing_of_a_call = match f.kind {
            FnKind::Arrow => match self.receiver_of_arrow(file, func) {
                Receiver::None => true,
                Receiver::Function(around) => !self.mentions_new_target(file, around) && !self.mentions_super(file, around) && !self.mentions_arguments_object(file, around) && !self.names_private_member_within(file, func),
                Receiver::Instance(_) | Receiver::Static(_) => false,
            },
            FnKind::Decl => !bound.fns[func.idx()].contains_this,
            FnKind::Expr => !bound.fns[func.idx()].contains_this && f.name.is_none(),
            _ => false,
        };
        if !sees_nothing_of_a_call || self.mentions_new_target(file, func) {
            return false;
        }
        let (start, end) = (f.start, self.end_of_fn(file, func));
        if (0..hir.classes.len() as u32).map(ClassId).any(|class| start <= hir[class].start && hir[class].start < end) {
            return false;
        }
        true
    }

    pub fn method_has_second_body(&mut self, file: FileId, func: FnId) -> bool {
        if func.is_none() || self.is_untyped_file(file) || !self.is_compiled(file) {
            return false;
        }
        let (hir, bound) = (self.hir(file), self.bound(file));
        let f = &hir[func];
        if !matches!(f.kind, FnKind::Method | FnKind::Getter | FnKind::Setter) || matches!(f.body, FnBody::None) {
            return false;
        }
        if f.this_param.is_some() || f.flags.contains(Flags::GENERATOR) || f.params.iter().any(|p| hir[p].flags.contains(Flags::REST)) {
            return false;
        }
        if self.mentions_new_target(file, func) || self.mentions_arguments_object(file, func) {
            return false;
        }
        let (start, end) = (f.start, self.end_of_fn(file, func));
        let is_within = |pos: u32| start <= pos && pos < end;
        !(0..hir.classes.len() as u32).map(ClassId).any(|class| is_within(hir[class].start)) && !bound.private_class.iter().any(|(&e, _)| is_within(hir[e].pos))
    }

    pub fn what_the_written_type_leaves_out(&mut self, file: FileId, p: ParamId) -> (bool, bool, bool) {
        let written = self.type_of_param(file, p);
        let parameter = &self.hir(file)[p];
        let may_be_left_out = parameter.default.is_some() || parameter.flags.contains(Flags::OPTIONAL);
        let parts: Vec<TypeId> = self.parts(written).to_vec();
        let may_be_anything = self.admits_nil(written) || parts.iter().any(|&part| part.is_any() || matches!(part, TypeId::UNKNOWN | TypeId::UNRESOLVED) || self.is_instantiable(part));
        let no_undefined = !may_be_left_out && !self.admits_undefined(written);
        let no_null = !may_be_anything && !parts.iter().any(|part| part.is_null());
        let no_objects = !may_be_anything && !parts.is_empty() && parts.into_iter().all(|part| self.has_primitive_flag(part));
        (no_undefined, no_null, no_objects)
    }

    fn places_taking_objects(&mut self, file: FileId, func: FnId) -> Vec<usize> {
        let parameters: Vec<ParamId> = self.hir(file)[func].params.iter().collect();
        (parameters.into_iter().enumerate())
            .filter(|&(_, p)| {
                self.hir(file)[p].ty.is_some() && {
                    let written = self.type_of_param(file, p);
                    !self.says_nothing(written) && !self.every_type(written, |c, part| c.is_primitive(part) || c.is_nullish(part))
                }
            })
            .map(|(index, _)| index)
            .collect()
    }

    fn is_handed_strangers_by_untyped_code(&mut self, file: FileId, func: FnId) -> bool {
        let program = self.p;
        program.aot.storage.handed_strangers_by_untyped_code.get_or_init(|| self.find_handed_strangers_by_untyped_code());
        let (hir, bound) = (self.hir(file), self.bound(file));
        let symbol = match bound.fns[func.idx()].owner {
            FnOwner::Stmt(_) => bound.symbol_of_declaration(Decl::Fn(func)),
            FnOwner::Expr(e) => match bound.expr_parent[e.idx()] {
                Parent::VarInit(d) if matches!(hir[hir[d].pat].kind, PatKind::Ident(_)) => bound.pat_symbol[hir[d].pat.idx()],
                _ => return false,
            },
            _ => return false,
        };
        if symbol.is_none() {
            return false;
        }
        let sym = self.files().sym(file, symbol);
        let exported = self.files().export_symbol_of_value_symbol_if_exported(sym);
        program.aot.storage.handed_strangers_by_untyped_code.get().is_some_and(|handed| handed.contains(&sym) || handed.contains(&exported))
    }

    fn is_called_with_what_says_nothing(&mut self, file: FileId, func: FnId) -> bool {
        let program = self.p;
        program.aot.storage.called_with_what_says_nothing.get_or_init(|| self.find_called_with_what_says_nothing());
        let (hir, bound) = (self.hir(file), self.bound(file));
        let symbol = match bound.fns[func.idx()].owner {
            FnOwner::Stmt(_) => bound.symbol_of_declaration(Decl::Fn(func)),
            FnOwner::Expr(e) => match bound.expr_parent[e.idx()] {
                Parent::VarInit(d) if matches!(hir[hir[d].pat].kind, PatKind::Ident(_)) => bound.pat_symbol[hir[d].pat.idx()],
                _ => return false,
            },
            _ => return false,
        };
        if symbol.is_none() {
            return false;
        }
        let sym = self.files().sym(file, symbol);
        let exported = self.files().export_symbol_of_value_symbol_if_exported(sym);
        program.aot.storage.called_with_what_says_nothing.get().is_some_and(|called| called.contains(&sym) || called.contains(&exported))
    }

    fn find_called_with_what_says_nothing(&mut self) -> FxHashSet<Sym> {
        let mut found: FxHashSet<Sym> = FxHashSet::default();
        for other in (0..self.files().modules.len() as u32).map(FileId) {
            if !self.is_compiled(other) {
                continue;
            }
            let (hir, bound) = (self.hir(other), self.bound(other));
            let is_untyped = self.is_untyped_file(other);
            for &name in self.exprs_by_kind_of(other).of(ExprTag::Ident) {
                let local = bound.expr_symbol[name.idx()];
                if local.is_none() {
                    continue;
                }
                let call = match bound.expr_parent[name.idx()] {
                    Parent::Expr(parent) if parent.is_some() => match hir[parent].kind {
                        ExprKind::Call(call) if hir[call].callee == name => Some(call),
                        _ => None,
                    },
                    _ => None,
                };
                if call.is_none() && !is_untyped {
                    continue;
                }
                let local = self.files().sym(other, local);
                let target = if self.files().flags(local).contains(SymFlags::ALIAS) { self.files().resolve_alias(local) } else { Some(local) };
                let Some(target) = target else { continue };
                if self.is_untyped_file(target.file) || found.contains(&target) {
                    continue;
                }
                let says_nothing = is_untyped
                    || call.is_some_and(|call| {
                        let arguments: Vec<ExprId> = hir.ids(hir[call].args).collect();
                        arguments.into_iter().any(|argument| {
                            let given = self.type_of_expr(other, argument);
                            given.is_any()
                        })
                    });
                if says_nothing {
                    found.insert(target);
                }
            }
        }
        found
    }

    fn find_handed_strangers_by_untyped_code(&mut self) -> FxHashSet<Sym> {
        let mut found: FxHashSet<Sym> = FxHashSet::default();
        for other in (0..self.files().modules.len() as u32).map(FileId) {
            if !self.is_compiled(other) || !self.is_untyped_file(other) {
                continue;
            }
            let (hir, bound) = (self.hir(other), self.bound(other));
            for &name in self.exprs_by_kind_of(other).of(ExprTag::Ident) {
                let local = bound.expr_symbol[name.idx()];
                if local.is_none() {
                    continue;
                }
                let local = self.files().sym(other, local);
                if !self.files().flags(local).contains(SymFlags::ALIAS) {
                    continue;
                }
                let Some(target) = self.files().resolve_alias(local) else { continue };
                if self.is_untyped_file(target.file) || found.contains(&target) {
                    continue;
                }
                let declared = match self.files().value_declaration(target) {
                    Some((of, Decl::Fn(func))) => Some((of, func)),
                    Some((of, Decl::Var(pat))) => match root_declaration(self.bound(of), pat) {
                        PatParent::Var(d) if self.hir(of)[d].pat == pat && self.hir(of)[d].init.is_some() => match self.hir(of)[self.hir(of)[d].init].kind {
                            ExprKind::Fn(func) => Some((of, func)),
                            _ => None,
                        },
                        _ => None,
                    },
                    _ => None,
                };
                let Some((of, func)) = declared else { continue };
                if !self.is_compiled(of) {
                    continue;
                }
                let call = match bound.expr_parent[name.idx()] {
                    Parent::Expr(parent) if parent.is_some() => match hir[parent].kind {
                        ExprKind::Call(call) if hir[call].callee == name => Some(call),
                        _ => None,
                    },
                    _ => None,
                };
                let is_handed_strangers = match call {
                    None => true,
                    Some(call) => {
                        let arguments: Vec<ExprId> = hir.ids(hir[call].args).collect();
                        arguments.iter().any(|&argument| matches!(hir[argument].kind, ExprKind::Spread(_)))
                            || self.places_taking_objects(of, func).into_iter().any(|place| {
                                arguments.get(place).is_some_and(|&argument| !matches!(hir[argument].kind, ExprKind::Object(_) | ExprKind::Array(_) | ExprKind::Fn(_) | ExprKind::Null))
                            })
                    }
                };
                if is_handed_strangers {
                    found.insert(target);
                }
            }
        }
        found
    }

    pub fn is_let_out(&mut self, file: FileId, func: FnId) -> bool {
        if let Some(&known) = self.aot.storage.let_out.get(&(file, func)) {
            return known;
        }
        let found = self.find_is_let_out(file, func);
        self.aot.storage.let_out.insert((file, func), found);
        found
    }

    fn find_is_let_out(&mut self, file: FileId, func: FnId) -> bool {
        let bound = self.bound(file);
        if self.is_untyped_file(file) {
            return false;
        }
        let mentions: Vec<ExprId> = match bound.fns[func.idx()].owner {
            FnOwner::Expr(e) => {
                let named = self.symbol_naming_function(file, func);
                std::iter::once(e).chain(self.mentions_of(file, named)).collect()
            }
            FnOwner::Stmt(_) => self.mentions_of(file, bound.symbol_of_declaration(Decl::Fn(func))),
            _ => return false,
        };
        mentions.into_iter().any(|mention| self.enters_place_that_says_nothing(file, mention))
    }

    fn mentions_of(&mut self, file: FileId, symbol: SymbolId) -> Vec<ExprId> {
        if symbol.is_none() {
            return Vec::new();
        }
        if !self.aot.storage.mentions.contains_key(&file) {
            let bound = self.bound(file);
            let mut by_symbol: FxHashMap<SymbolId, Vec<ExprId>> = FxHashMap::default();
            for &name in self.exprs_by_kind_of(file).of(ExprTag::Ident) {
                let named = bound.expr_symbol[name.idx()];
                if named.is_some() {
                    by_symbol.entry(named).or_default().push(name);
                }
            }
            self.aot.storage.mentions.insert(file, Rc::new(by_symbol));
        }
        self.aot.storage.mentions[&file].get(&symbol).cloned().unwrap_or_default()
    }

    fn enters_place_that_says_nothing(&mut self, file: FileId, mut e: ExprId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        loop {
            let parent = match bound.expr_parent[e.idx()] {
                Parent::Expr(parent) if parent.is_some() => parent,
                Parent::VarInit(d) if hir[d].ty.is_some() => {
                    let written = self.type_from_node(file, hir[d].ty);
                    return self.says_nothing(written);
                }
                Parent::VarInit(d) if matches!(hir[hir[d].pat].kind, PatKind::Ident(_)) && matches!(hir[e].kind, ExprKind::Fn(_)) => {
                    let mentions = self.mentions_of(file, bound.pat_symbol[hir[d].pat.idx()]);
                    return mentions.into_iter().any(|mention| self.enters_place_that_says_nothing(file, mention));
                }
                Parent::Stmt(stmt) if stmt.is_some() => return matches!(hir[stmt].kind, StmtKind::Throw(_)),
                _ => return false,
            };
            match hir[parent].kind {
                ExprKind::Call(call) | ExprKind::New(call) => {
                    if hir[call].callee == e {
                        return false;
                    }
                    self.prepare_enclosing(file, e);
                    return self.contextual_type(file, e, ContextFlags::empty()).is_none_or(|expected| self.says_nothing(expected));
                }
                ExprKind::Assign { op: None, target, value } if value == e => {
                    let held = self.type_of_expr(file, target);
                    return self.says_nothing(held);
                }
                ExprKind::As { .. } => {
                    let seen_as = self.type_of_expr(file, parent);
                    if self.says_nothing(seen_as) {
                        return true;
                    }
                }
                ExprKind::Array(_) | ExprKind::NonNull(_) | ExprKind::Satisfies { .. } => {}
                ExprKind::Cond { test, .. } if test != e => {}
                ExprKind::Binary { op: BinOp::And | BinOp::Or | BinOp::Nullish | BinOp::Comma, right, .. } if right == e => {}
                _ => return false,
            }
            e = parent;
        }
    }

    /// The same for the `this` of a function that is no arrow function.
    fn is_this_predicted(&mut self, file: FileId, func: FnId) -> bool {
        self.hir(file)[func].this_param.is_none() && (self.is_host_callback(file, func) || self.is_member_of_literal_written_under_any(file, func) || self.is_member_of_literal_left_ordinary(file, func))
    }

    fn is_member_of_literal_left_ordinary(&mut self, file: FileId, func: FnId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let FnOwner::Expr(member) = bound.fns[func.idx()].owner else { return false };
        let Parent::Prop(prop) = bound.expr_parent[member.idx()] else { return false };
        let literal = bound.prop_owner[prop.idx()];
        if literal.is_none() {
            return false;
        }
        let ExprKind::Object(props) = hir[literal].kind else { return false };
        let has_accessor = props.iter().any(|p| matches!(hir[p].kind, PropKind::Getter | PropKind::Setter));
        let is_plain = props.iter().all(|p| hir[p].kind != PropKind::Spread && matches!(hir[p].key, PropKey::Name(name) if self.atoms().bytes(name) != b"__proto__"));
        let has_accessors_alone = props.iter().all(|p| matches!(hir[p].kind, PropKind::Getter | PropKind::Setter)) && !self.initializes_member_of_inferred_type(file, literal);
        has_accessor && (!is_plain || has_accessors_alone) || self.is_literal_assigned_onto(file, literal) || self.is_only_copied_from(file, literal)
    }

    pub fn initializes_member_of_inferred_type(&self, file: FileId, e: ExprId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut at = e;
        loop {
            at = match bound.expr_parent[at.idx()] {
                Parent::Expr(parent) => parent,
                Parent::Prop(prop) if bound.prop_owner[prop.idx()].is_some() => bound.prop_owner[prop.idx()],
                Parent::MemberInit(member) => return hir[member].ty.is_none(),
                _ => return false,
            };
        }
    }

    pub fn is_literal_assigned_onto(&mut self, file: FileId, e: ExprId) -> bool {
        let hir = self.hir(file);
        if !matches!(hir[e].kind, ExprKind::Object(_)) {
            return false;
        }
        let Parent::Expr(parent) = self.bound(file).expr_parent[e.idx()] else { return false };
        matches!(hir[parent].kind, ExprKind::Call(call) if hir.ids(hir[call].args).next() == Some(e)) && self.is_overlay_onto_first_argument(file, parent)
    }

    pub fn is_only_copied_from(&mut self, file: FileId, e: ExprId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut at = e;
        loop {
            let parent = match bound.expr_parent[at.idx()] {
                Parent::Prop(prop) => return hir[prop].kind == PropKind::Spread,
                Parent::Expr(parent) => parent,
                _ => return false,
            };
            match hir[parent].kind {
                ExprKind::Satisfies { .. } | ExprKind::AsConst(_) | ExprKind::Binary { op: BinOp::And | BinOp::Or | BinOp::Nullish, .. } => {}
                ExprKind::Cond { test, .. } if test != at => {}
                ExprKind::Binary { op: BinOp::Comma, right, .. } if right == at => {}
                ExprKind::Call(call) => {
                    let place = hir.ids(hir[call].args).position(|argument| argument == at);
                    return place.is_some_and(|place| place > 0) && self.is_object_assign(file, parent)
                        || place == Some(0) && self.is_call_of_library(file, parent, b"ObjectConstructor", &[b"create"])
                        || place == Some(1) && self.is_call_of_library(file, parent, b"ObjectConstructor", &[b"setPrototypeOf"]);
                }
                _ => return false,
            }
            at = parent;
        }
    }

    fn is_member_of_literal_written_under_any(&mut self, file: FileId, func: FnId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let FnOwner::Expr(member) = bound.fns[func.idx()].owner else { return false };
        let Parent::Prop(prop) = bound.expr_parent[member.idx()] else { return false };
        let literal = bound.prop_owner[prop.idx()];
        literal.is_some() && matches!(hir[literal].kind, ExprKind::Object(_)) && self.is_written_under_any(file, literal)
    }

    pub fn is_written_under_any(&mut self, file: FileId, e: ExprId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut outermost = e;
        loop {
            outermost = match bound.expr_parent[outermost.idx()] {
                Parent::Prop(prop) if bound.prop_owner[prop.idx()].is_some() => bound.prop_owner[prop.idx()],
                Parent::Expr(parent) if matches!(hir[parent].kind, ExprKind::Array(_)) => parent,
                _ => break,
            };
        }
        let outer = match bound.expr_parent[outermost.idx()] {
            Parent::VarInit(decl) if hir[decl].ty.is_some() => self.contextual_type_of_literal(file, outermost),
            Parent::Expr(parent) if matches!(hir[parent].kind, ExprKind::As { .. }) => Some(self.type_of_expr(file, parent)),
            _ => None,
        };
        outer.is_some_and(|ty| self.is_any(ty))
    }

    /// The function whose `this` the expression sees: the nearest one around it that is no arrow function.
    fn this_container_of(&self, file: FileId, e: ExprId) -> Option<FnId> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut parent = bound.expr_parent[e.idx()];
        loop {
            let func = match self.site_of(file, parent)? {
                Site::Body(func) => func,
                Site::Parameter(p) => bound.param_fn[p.idx()],
                Site::File | Site::Initializer(_) => return None,
            };
            if func.is_none() {
                return None;
            }
            if hir[func].kind != FnKind::Arrow {
                return Some(func);
            }
            let FnOwner::Expr(arrow) = bound.fns[func.idx()].owner else { return None };
            parent = bound.expr_parent[arrow.idx()];
        }
    }

    /// What the function, which is no arrow function, is compiled to take for `this`. `None`: anything, as for a method that does not look
    /// at it: whatever finds it on its prototype chain may call it.
    pub fn this_taken_by_fn(&mut self, file: FileId, func: FnId) -> Option<TypeId> {
        if self.is_this_predicted(file, func) || !self.uses_this(file, func) { None } else { self.this_type_in_fn(file, func) }
    }

    // ───────────────────────────── what the options of the project say ─────────────────────────────

    /// Whether `undefined` and `null` are of the type though it does not name them. Without `strictNullChecks` they are of every type:
    /// that is what the checker has held the program to, so no place of the program has less room.
    pub fn admits_nil(&self, ty: TypeId) -> bool {
        !self.p.files.options.strict_null_checks && !ty.is_never()
    }

    /// The `let` and `var` of a file of TypeScript that are declared with a type, without a value and without `!`, whose type has numbers
    /// or booleans, which are kept unboxed, and no `undefined`, and that may be found to hold `undefined` all the same. With a read that
    /// may come before every store. The checker reports such a read only in the function that declares the variable (2454). A
    /// reference may be nil as it is kept here, so a variable of strings or objects is not among them. In the order of the symbols.
    fn uninitialized_variables_of(&mut self, file: FileId) -> Vec<Uninitialized> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut found = Vec::new();
        if self.is_untyped_file(file) || hir.kind == FileKind::Declaration {
            return found;
        }
        let index = self.exprs_by_kind(file);
        for (local, symbol) in bound.symbols.iter().enumerate() {
            let local = SymbolId(local as u32);
            let Some(&Decl::Var(pat)) = symbol.decls.iter().next() else { continue };
            let PatParent::Var(d) = root_declaration(bound, pat) else { continue };
            if hir[d].pat != pat || hir[d].ty.is_none() || hir[d].flags.intersects(Flags::DEFINITE | Flags::AMBIENT) || !self.is_declared_without_value(file, d) {
                continue;
            }
            let sym = self.files().sym(file, local);
            let ty = self.type_of_symbol(sym);
            if !self.has_unboxed_part(ty) || self.contains_undefined(ty) || self.admits_nil(ty) || !self.may_find_variable_unassigned(sym, file, pat) {
                continue;
            }
            let site = self.dead_zone_of(file, Decl::Var(pat)).map(|found| found.0);
            let reads = || index.of(ExprTag::Ident).iter().copied().filter(|&e| bound.expr_symbol[e.idx()] == local && !bound.is_in_type_query(e) && bound.access_kind(hir, e) != AccessKind::Write);
            let mut search = Search::default();
            let read = match reads().find(|&e| self.site_of(file, bound.expr_parent[e.idx()]) != site) {
                Some(e) => EarlyRead::ByOtherCode(e),
                None => match reads().find(|&e| self.is_reached_without(file, bound.expr_flow[e.idx()], Store::Variable(local), &mut search)) {
                    Some(e) => EarlyRead::OnSomePath(e),
                    None => EarlyRead::ByOtherFiles,
                },
            };
            found.push(Uninitialized { declaration: d, name: symbol.name, ty, read });
        }
        found
    }

    /// 100001, under `strictVariableInitialization`: what `strictPropertyInitialization` is for properties.
    pub(in crate::check) fn check_variable_initialization(&mut self, file: FileId) {
        let hir = self.hir(file);
        for variable in self.uninitialized_variables_of(file) {
            let name = &hir[hir[variable.declaration].pat];
            let at = |e: ExprId| (file, hir[e].pos, hir[e].end);
            let related = match variable.read {
                EarlyRead::ByOtherCode(e) => self.new_diagnostic(at(e), 100002, &[]),
                EarlyRead::OnSomePath(e) => self.new_diagnostic(at(e), 100003, &[]),
                EarlyRead::ByOtherFiles => self.new_diagnostic((file, name.pos, name.end), 100004, &[]),
            };
            self.error_at((file, name.pos, name.end), 100001, &[Arg::Atom(variable.name)]).add_related_info(related);
        }
    }

    /// A line for each of those in the program, whether or not they are reported: the declaration, the type, the read. In the order of
    /// the files.
    pub fn explain_uninitialized(&mut self) -> Vec<String> {
        let mut modules: Vec<FileId> = self.p.aot.storage.modules.get().map(|modules| modules.cycle.keys().copied().collect()).unwrap_or_default();
        modules.sort_unstable();
        let mut lines = Vec::new();
        for file in modules {
            let hir = self.hir(file);
            for variable in self.uninitialized_variables_of(file) {
                let why = match variable.read {
                    EarlyRead::ByOtherCode(e) => format!("read by other code than declares it at {}", self.line_for_people(file, hir[e].pos)),
                    EarlyRead::OnSomePath(e) => format!("not stored to on every way to the read at {}", self.line_for_people(file, hir[e].pos)),
                    EarlyRead::ByOtherFiles => "seen by other files".to_owned(),
                };
                let d = variable.declaration;
                let keyword = if hir[d].kind == VarKind::Var { "var" } else { "let" };
                let (name, ty) = (String::from_utf8_lossy(self.atoms().bytes(variable.name)).into_owned(), self.type_to_string(variable.ty));
                lines.push(format!("uninitialized: {}: {keyword} {name}: {}; {why}", self.line_for_people(file, hir[d].loc.end), String::from_utf8_lossy(&ty)));
            }
        }
        lines
    }

    pub(super) fn line_for_people(&self, file: FileId, pos: u32) -> String {
        let name = self.files().module(file).file_name();
        let name = name.rsplit(|&byte| byte == b'/').next().unwrap_or(name);
        let text = &self.hir(file).text;
        let line = text[..(pos as usize).min(text.len())].iter().filter(|&&byte| byte == b'\n').count() + 1;
        format!("{}:{line}", String::from_utf8_lossy(name))
    }

    // ───────────────────────────── whether a type is written down ─────────────────────────────

    /// Whether the type of the variable, the parameter or the property is written down, and not inferred from what is stored to it.
    pub fn is_annotated(&mut self, sym: Sym) -> bool {
        let Some((file, decl)) = self.files().value_declaration(sym) else { return false };
        let (hir, bound) = (self.hir(file), self.bound(file));
        match decl {
            // What a pattern binds has its type from the annotation of the whole.
            Decl::Var(pat) => matches!(root_declaration(bound, pat), PatParent::Var(d) if hir[d].ty.is_some()),
            Decl::Param(pat) => match root_declaration(bound, pat) {
                PatParent::Param(p) => self.is_param_annotated(file, p),
                _ => false,
            },
            Decl::Member(m) => hir[m].ty.is_some(),
            Decl::ParameterProperty(p) => hir[p].ty.is_some(),
            _ => false,
        }
    }

    /// The parameter of a callback has its type from the signature that the callback is checked against, which is written down. Not by
    /// the program where it is a callback of the host.
    pub fn is_param_annotated(&mut self, file: FileId, p: ParamId) -> bool {
        let hir = self.hir(file);
        if hir[p].ty.is_some() {
            return true;
        }
        let func = self.bound(file).param_fn[p.idx()];
        if func.is_none() || !hir[func].params.range().contains(&p.idx()) {
            return false;
        }
        // What is called where it is written has the types of its parameters from the arguments.
        let index = p.idx() - hir[func].params.start as usize;
        hir[func].kind != FnKind::Setter && !self.is_immediately_invoked(file, func) && !self.is_host_callback(file, func) && self.contextual_param_type(file, func, index).is_some()
    }

    /// The same for a property of a type.
    pub fn is_prop_annotated(&mut self, prop: &Prop) -> bool {
        match &prop.source {
            PropSource::Symbol(sym) => self.is_annotated(*sym),
            // The template of a mapped type is.
            PropSource::Mapped(..) => true,
            PropSource::Intersected(_, parts) | PropSource::Copy(_, parts, _) => !parts.is_empty() && parts.iter().all(|part| self.is_prop_annotated(part)),
            PropSource::Type(_) | PropSource::Literal(..) | PropSource::ReverseMapped(..) => false,
        }
    }

    // ───────────────────────────── what a function returns and takes ─────────────────────────────

    /// The type of what a call of the function yields, as the function is compiled, and whether that type is written down. It is by an
    /// annotation, by the signature that a function expression is checked against, and for one that is called where it is written by
    /// what the call is checked against. That is also what a literal in a `return` is checked against, and so what it is made as. A
    /// signature that returns `unknown` or `void` leaves open what the function returns: whoever calls it by that signature expects
    /// nothing of it. One that returns a type parameter has that from the function. There, and where nothing is written down, the type is
    /// inferred from what is returned. An async function and a generator make what they yield themselves.
    ///
    /// The inferred type also has room for what the returned expressions hand on beyond their types: see `type_handed_on`.
    pub fn result_of_fn(&mut self, file: FileId, func: FnId) -> (TypeId, bool) {
        if let Some(&known) = self.aot.storage.results.get(&(file, func)) {
            return known;
        }
        // A function that returns what it yields itself.
        if let Some(assumed) = self.assumption(Query::Result(file, func)) {
            return (TypeId(assumed as u32), false);
        }
        let f = &self.hir(file)[func];
        let inferred = self.return_type_of_fn(file, func);
        if f.ret.is_some() || f.flags.intersects(Flags::ASYNC | Flags::GENERATOR) {
            return (inferred, f.ret.is_some());
        }
        // The host goes by nothing that is known here, and what it is declared to expect is no claim of the program.
        if self.is_host_callback(file, func) {
            return (TypeId::UNKNOWN, true);
        }
        self.prepare_fn(file, func);
        let is_part = matches!(self.bound(file).fns[func.idx()].owner, FnOwner::Expr(written) if self.is_part_that_is_spread(file, written));
        if !is_part
            && !self.is_called_for_assignment_pattern(file, func)
            && let Some(expected) = self.declared_or_contextual_return_type(file, func, ContextFlags::SKIP_BINDING_PATTERNS)
            && !expected.is_never()
            && expected != TypeId::UNRESOLVED
            && !self.is_instantiable(expected)
        {
            return (self.without_number_literals_given(expected), true);
        }
        let (found, is_final) = self.solve(Query::Result(file, func), u64::from(inferred.0), u64::from(TypeId::UNKNOWN.0), |c| u64::from(c.find_result_of_fn(file, func, inferred).0));
        let found = (TypeId(found as u32), false);
        if is_final {
            self.aot.storage.results.insert((file, func), found);
        }
        found
    }

    fn is_called_for_assignment_pattern(&self, file: FileId, func: FnId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let FnOwner::Expr(mut yielded) = bound.fns[func.idx()].owner else { return false };
        loop {
            let Parent::Expr(parent) = bound.expr_parent[yielded.idx()] else { return false };
            match hir[parent].kind {
                ExprKind::Assign { op: None, target, value } if value == yielded => return matches!(hir[target].kind, ExprKind::Array(_) | ExprKind::Object(_)),
                ExprKind::Call(call) if hir[call].callee == yielded => {}
                ExprKind::Await(_) | ExprKind::NonNull(_) | ExprKind::Satisfies { .. } | ExprKind::Binary { op: BinOp::Or | BinOp::Nullish, .. } => {}
                ExprKind::Cond { yes, no, .. } if yes == yielded || no == yielded => {}
                ExprKind::Binary { op: BinOp::And | BinOp::Comma, right, .. } if right == yielded => {}
                _ => return false,
            }
            yielded = parent;
        }
    }

    fn find_result_of_fn(&mut self, file: FileId, func: FnId, inferred: TypeId) -> TypeId {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let f = &hir[func];
        let mut parts = vec![inferred];
        let of_statements = bound.ids(bound.fns[func.idx()].returns).filter_map(|stmt| match hir[stmt].kind {
            StmtKind::Return(value) if value.is_some() => Some(value),
            _ => None,
        });
        let of_body = match f.body {
            FnBody::Expr(value) => Some(value),
            _ => None,
        };
        for value in of_body.into_iter().chain(of_statements) {
            if !self.is_typed_as_handed_on(file, value) {
                parts.push(self.type_handed_on(file, value));
            }
        }
        if parts.len() == 1 { inferred } else { self.union(&parts) }
    }

    /// Whether the type of what the call `e` yields is written down beyond what the function that is called makes sure of itself: the
    /// call gives type arguments, or a function of the program is annotated to return a type that mentions its type parameters, which
    /// only the call puts something in for.
    pub fn is_result_of_call_annotated(&mut self, file: FileId, e: ExprId) -> bool {
        let hir = self.hir(file);
        let ExprKind::Call(call) = hir[e].kind else { return false };
        if !hir[call].type_args.is_empty() {
            return true;
        }
        let Some(sig) = self.resolved_signature(file, e).sig else { return false };
        let Some((declared_in, func, _)) = self.sig_decl(sig) else { return false };
        let of = self.hir(declared_in);
        if self.is_untyped_file(declared_in) || !self.is_compiled(declared_in) || of[func].flags.intersects(Flags::ASYNC | Flags::GENERATOR) {
            return false;
        }
        let (declared, is_annotated) = self.result_of_fn(declared_in, func);
        is_annotated && declared != self.sig_return(sig)
    }

    pub fn what_a_generic_function_may_have_made(&mut self, file: FileId, e: ExprId) -> Option<Made> {
        if !matches!(self.hir(file)[e].kind, ExprKind::Call(_)) {
            return None;
        }
        let sig = self.resolved_signature(file, e).sig?;
        let (declared_in, func, _) = self.sig_decl(sig)?;
        if self.return_type_of_fn(declared_in, func) == self.sig_return(sig) {
            return None;
        }
        self.what_is_made_by_function(declared_in, func, &mut LookedAt::default())
    }

    fn what_is_made_by_function(&mut self, file: FileId, func: FnId, looked_at: &mut LookedAt) -> Option<Made> {
        let (file, func) = if matches!(self.hir(file)[func].body, FnBody::None) { self.implementation_of(file, func).unwrap_or((file, func)) } else { (file, func) };
        let (hir, bound) = (self.hir(file), self.bound(file));
        if self.is_untyped_file(file) || !self.is_compiled(file) || hir[func].flags.intersects(Flags::ASYNC | Flags::GENERATOR) {
            return None;
        }
        if let Some(known) = looked_at.functions.iter().find(|known| known.0 == (file, func)) {
            return known.1.clone();
        }
        looked_at.functions.push(((file, func), None));
        let returned: Vec<ExprId> = match hir[func].body {
            FnBody::None => Vec::new(),
            FnBody::Expr(body) => vec![body],
            FnBody::Block(_) => bound.ids(bound.fns[func.idx()].returns).filter_map(|stmt: StmtId| if let StmtKind::Return(value) = hir[stmt].kind { Some(value) } else { None }).collect(),
        };
        let mut made = None;
        for value in returned {
            if value.is_some() {
                let yielded = self.what_is_made_by(file, value, looked_at);
                join_what_is_made(&mut made, yielded);
            }
        }
        if let Some(known) = looked_at.functions.iter_mut().find(|known| known.0 == (file, func)) {
            known.1 = made.clone();
        }
        made
    }

    fn what_is_made_by_either(&mut self, file: FileId, one: ExprId, other: ExprId, looked_at: &mut LookedAt) -> Option<Made> {
        let mut made = self.what_is_made_by(file, one, looked_at);
        let yielded = self.what_is_made_by(file, other, looked_at);
        join_what_is_made(&mut made, yielded);
        made
    }

    fn what_is_made_by(&mut self, file: FileId, e: ExprId, looked_at: &mut LookedAt) -> Option<Made> {
        match self.hir(file)[e].kind {
            ExprKind::Object(props) => {
                let hir = self.hir(file);
                let props: Vec<(PropKind, PropKey, ExprId)> = props.iter().map(|p| (hir[p].kind, hir[p].key, hir[p].value)).collect();
                let mut made = Made::object();
                for (kind, key, value) in props {
                    if !matches!(kind, PropKind::Init | PropKind::Shorthand | PropKind::Spread) {
                        continue;
                    }
                    let Some(held) = self.what_is_made_by(file, value, looked_at) else { continue };
                    made.join(match (kind, key) {
                        (PropKind::Spread, _) => held.what_it_holds(),
                        (_, PropKey::Name(name)) => Made { within: vec![(name, held)], ..Made::default() },
                        _ => Made { anywhere: Some(Box::new(held)), ..Made::default() },
                    });
                }
                Some(made)
            }
            ExprKind::As { expr, .. } | ExprKind::Satisfies { expr, .. } | ExprKind::NonNull(expr) | ExprKind::AsConst(expr) => self.what_is_made_by(file, expr, looked_at),
            ExprKind::Cond { yes, no, .. } => self.what_is_made_by_either(file, yes, no, looked_at),
            ExprKind::Binary { op: BinOp::Or | BinOp::And | BinOp::Nullish, left, right } => self.what_is_made_by_either(file, left, right, looked_at),
            ExprKind::Binary { op: BinOp::Comma, right, .. } | ExprKind::Assign { op: None, value: right, .. } => self.what_is_made_by(file, right, looked_at),
            ExprKind::Assign { op: Some(BinOp::Or | BinOp::And | BinOp::Nullish), target, value } => self.what_is_made_by_either(file, target, value, looked_at),
            ExprKind::Dot { obj, name, .. } => {
                let holder = self.what_is_made_by(file, obj, looked_at)?;
                let mut made = holder.within.into_iter().find(|held| held.0 == name).map_or_else(Made::object, |held| held.1);
                if let Some(anywhere) = holder.anywhere {
                    made.join(*anywhere);
                }
                Some(made)
            }
            ExprKind::Index { obj, .. } | ExprKind::Spread(obj) => {
                self.what_is_made_by(file, obj, looked_at).map(Made::anything_it_holds)
            }
            ExprKind::Array(elements) => {
                let elements: Vec<ExprId> = self.hir(file).ids(elements).collect();
                let mut of_elements = None;
                for element in elements {
                    let yielded = self.what_is_made_by(file, element, looked_at);
                    join_what_is_made(&mut of_elements, yielded);
                }
                of_elements.map(|elements| Made { elements: Some(Box::new(elements)), ..Made::default() })
            }
            ExprKind::Ident(name) => {
                let sym = self.symbol_named_by(file, e, name)?;
                let Some((of, decl @ (Decl::Var(pat) | Decl::Param(pat)))) = self.declaration_of_variable(sym) else { return None };
                let (declaring, bound) = (self.hir(of), self.bound(of));
                let first = match root_declaration(bound, pat) {
                    PatParent::Var(d) => declaring[d].init,
                    PatParent::Param(p) => declaring[p].default,
                    _ => return None,
                };
                if let Some(known) = looked_at.variables.iter().find(|known| known.0 == sym) {
                    return known.1.clone();
                }
                looked_at.variables.push((sym, None));
                let is_out_of_a_pattern = !matches!(bound.pat_parent[pat.idx()], PatParent::Var(_) | PatParent::Param(_));
                let mut stored = vec![first];
                for &(_, target) in bound.assignments_to(bound.symbol_of_declaration(decl)) {
                    if let Some(super::integers::Store::Value(value)) = self.store_to_target(of, target) {
                        stored.push(value);
                    }
                }
                let mut made = None;
                for (index, value) in stored.into_iter().enumerate() {
                    if value.is_some() {
                        let yielded = self.what_is_made_by(of, value, looked_at);
                        join_what_is_made(&mut made, if index == 0 && is_out_of_a_pattern { yielded.map(Made::anything_it_holds) } else { yielded });
                    }
                }
                if let Some(known) = looked_at.variables.iter_mut().find(|known| known.0 == sym) {
                    known.1 = made.clone();
                }
                made
            }
            ExprKind::Call(call) => {
                if let Some(handed_back) = self.argument_handed_back_by(file, e) {
                    let mut made = self.what_is_made_by(file, handed_back, looked_at)?;
                    let hir = self.hir(file);
                    let arguments: Vec<ExprId> = hir.ids(hir[call].args).collect();
                    for argument in arguments {
                        if argument != handed_back
                            && let Some(copied) = self.what_is_made_by(file, argument, looked_at)
                        {
                            made.join(copied.what_it_holds());
                        }
                    }
                    return Some(made);
                }
                let sig = self.resolved_signature(file, e).sig?;
                let (declared_in, func, _) = self.sig_decl(sig)?;
                self.what_is_made_by_function(declared_in, func, looked_at)
            }
            _ => None,
        }
    }

    /// The type that is written down for the parameter that takes `e`, an argument of a call or a `new`, as the call is resolved. `None`:
    /// there is none, or it is not known which parameter takes it.
    ///
    /// Of an overload: the parameter of the implementation. Which overload the checker takes says little of the value: for an argument of
    /// type `any` it is the first. Where no code of the program stands behind the declaration, what it says is a prediction: `None`.
    pub fn type_taking_argument(&mut self, file: FileId, e: ExprId) -> Option<TypeId> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let Parent::Expr(parent) = bound.expr_parent[e.idx()] else { return None };
        let (ExprKind::Call(call) | ExprKind::New(call)) = hir[parent].kind else { return None };
        let mut index = None;
        for (i, argument) in hir.ids(hir[call].args).enumerate() {
            if argument == e {
                index = Some(i);
                break;
            }
            if matches!(hir[argument].kind, ExprKind::Spread(_)) {
                return None;
            }
        }
        let index = index?;
        let sig = self.resolved_signature(file, parent).sig?;
        let (declared_in, func, _) = self.sig_decl(sig)?;
        let of = self.hir(declared_in);
        if self.is_untyped_file(declared_in) || !self.is_compiled(declared_in) || self.is_predicted(file, hir[call].callee) {
            return None;
        }
        if let Some(expected) = self.contextual_type_of_literal(file, e)
            && self.is_checked_against_what_is_inferred(file, e, expected)
        {
            return None;
        }
        let (sig, func) = match self.implementation_of(declared_in, func) {
            Some((_, implementation)) if implementation != func => (self.sig_of_fn(declared_in, implementation), implementation),
            _ => (sig, func),
        };
        let declared = of[func].params;
        let p = if index < declared.len() { declared.at(index) } else { declared.iter().next_back()? };
        if !self.is_param_annotated(declared_in, p) {
            return None;
        }
        let params = self.sig_params(sig);
        self.param_type_at(&params, index)
    }

    /// Whether the call is one of the global `Object.assign`, under whatever name: that is what the signature it is resolved to declares.
    pub fn is_object_assign(&mut self, file: FileId, e: ExprId) -> bool {
        self.is_call_of_library(file, e, b"ObjectConstructor", &[b"assign"])
    }

    /// The same for `Array.from`.
    pub fn is_array_from(&mut self, file: FileId, e: ExprId) -> bool {
        self.is_call_of_library(file, e, b"ArrayConstructor", &[b"from"])
    }

    /// Whether the call gives its first argument properties, or a prototype, of which the type of that argument says nothing: `Object.assign`, `Object.defineProperties`,
    /// `Object.defineProperty`, `Object.setPrototypeOf`.
    pub fn is_overlay_onto_first_argument(&mut self, file: FileId, e: ExprId) -> bool {
        self.is_call_of_library(file, e, b"ObjectConstructor", &[b"assign", b"defineProperties", b"defineProperty", b"setPrototypeOf"])
    }

    /// `Object.defineProperties({ .. }, descriptors)`: whether the call installs in a literal, which nobody else has seen, what the type of the literal says nothing of. It yields the literal.
    pub fn redefines_literal(&mut self, file: FileId, e: ExprId) -> bool {
        let hir = self.hir(file);
        let ExprKind::Call(call) = hir[e].kind else { return false };
        hir.ids(hir[call].args).next().is_some_and(|first| matches!(hir[first].kind, ExprKind::Object(_)))
            && self.is_call_of_library(file, e, b"ObjectConstructor", &[b"defineProperties", b"defineProperty", b"setPrototypeOf"])
    }

    /// Whether the expression yields such a literal: the call itself, or one that hands it back.
    pub fn yields_redefined_literal(&mut self, file: FileId, e: ExprId) -> bool {
        self.redefines_literal(file, e) || self.argument_handed_back_by(file, e).is_some_and(|first| self.yields_redefined_literal(file, first))
    }

    /// Whether the program may make an accessor of a declared property of an object of the type, or give such a property other attributes: `Object.defineProperty(item, key, { get })`, where
    /// `item` is of a type that `ty` is assignable to and `key` may name a property of `ty`. An object with a layout keeps its declared properties as they are, so such a type gets none.
    /// An object of a class is made by the classes that it extends: those as well.
    ///
    /// Not seen: a target of which its type says nothing, and the built-in where it goes somewhere as a value.
    pub fn is_redefined_somewhere(&mut self, ty: TypeId) -> bool {
        let redefinitions = self.redefinitions();
        let is_of_class = self.is_type_of_instances(ty);
        redefinitions.iter().any(|(target, names)| {
            names.as_ref().is_none_or(|names| names.iter().any(|&name| self.get_property_of_type(ty, name).is_some()))
                && (self.is_assignable(ty, *target) || is_of_class && self.is_assignable(*target, ty))
        })
    }

    fn redefinitions(&mut self) -> Rc<[Redefinition]> {
        if let Some(known) = &self.aot.storage.redefinitions {
            return known.clone();
        }
        let program = self.p;
        let calls = program.aot.storage.calls_that_may_redefine.get_or_init(|| {
            let mut calls = Vec::new();
            for file in (0..self.files().modules.len() as u32).map(FileId) {
                if !self.is_compiled(file) || self.is_untyped_file(file) || self.hir(file).kind == FileKind::Json {
                    continue;
                }
                let hir = self.hir(file);
                for &e in self.exprs_by_kind_of(file).of(ExprTag::Call) {
                    if let ExprKind::Call(call) = hir[e].kind
                        && let ExprKind::Dot { name, .. } | ExprKind::Ident(name) = hir[hir[call].callee].kind
                        && name.is_some()
                        && matches!(self.atoms().bytes(name), b"defineProperty" | b"defineProperties")
                    {
                        calls.push((file, e));
                    }
                }
            }
            calls
        });
        let mut found = Vec::new();
        for &(file, e) in calls {
            self.find_redefinition_by(file, e, &mut found);
        }
        let found: Rc<[Redefinition]> = found.into();
        self.aot.storage.redefinitions = Some(found.clone());
        found
    }

    fn find_redefinition_by(&mut self, file: FileId, e: ExprId, found: &mut Vec<Redefinition>) {
        let hir = self.hir(file);
        let ExprKind::Call(call) = hir[e].kind else { return };
        let (ExprKind::Dot { name, .. } | ExprKind::Ident(name)) = hir[hir[call].callee].kind else { return };
        if name.is_none() {
            return;
        }
        let takes_key = match self.atoms().bytes(name) {
            b"defineProperty" => true,
            b"defineProperties" => false,
            _ => return,
        };
        let is_of_library = self.resolved_signature(file, e).sig.and_then(|signature| self.sig_decl(signature)).is_some_and(|(declared_in, ..)| self.hir(declared_in).kind == FileKind::Declaration);
        let mut arguments = hir.ids(hir[call].args);
        let Some(target) = arguments.next().filter(|&target| is_of_library && !matches!(hir[target].kind, ExprKind::Object(_)) && !self.holds_what_object_create_made(file, target)) else { return };
        let mut of_target = self.type_of_expr(file, target);
        if self.is_instantiable(of_target) {
            of_target = self.base_constraint(of_target);
        }
        let of_target = self.non_nullable(of_target);
        let names = if takes_key {
            let Some(key) = arguments.next() else { return };
            let descriptor = arguments.next();
            if descriptor.is_some_and(|descriptor| self.is_plain_data_descriptor(file, descriptor, true)) {
                return;
            }
            let names = self.names_of_key(file, key);
            if !names.is_empty() && descriptor.is_some_and(|descriptor| self.is_plain_data_descriptor(file, descriptor, false)) && names.iter().all(|&name| self.is_required_by(of_target, name)) {
                return;
            }
            let of_key = self.type_of_expr(file, key);
            if names.is_empty() && self.every_type(of_key, |c, part| c.is_symbol_like(part) || c.is_number_like(part)) {
                return;
            }
            (!names.is_empty()).then_some(names)
        } else {
            match arguments.next().map(|descriptors| hir[descriptors].kind) {
                Some(ExprKind::Object(props)) if props.iter().all(|prop| hir[prop].kind == PropKind::Init && matches!(hir[prop].key, PropKey::Name(_))) => {
                    let mut redefined: Vec<Atom> = Vec::new();
                    for prop in props.iter() {
                        let (PropKey::Name(name), descriptor) = (hir[prop].key, hir[prop].value) else { continue };
                        if !self.is_plain_data_descriptor(file, descriptor, true) && !(self.is_plain_data_descriptor(file, descriptor, false) && self.is_required_by(of_target, name)) {
                            redefined.push(name);
                        }
                    }
                    if redefined.is_empty() {
                        return;
                    }
                    Some(redefined)
                }
                _ => None,
            }
        };
        let parts: Vec<TypeId> = self.parts(of_target).to_vec();
        for part in parts {
            if self.is_object_type(part) && !self.says_nothing_of_objects(part) && !self.says_nothing_of_fields(part) {
                found.push((part, names.clone()));
            }
        }
    }

    /// `const node: SourceFile = Object.create(target)`, and `e` is `node`: an ordinary object, whatever it is looked at as.
    fn holds_what_object_create_made(&mut self, file: FileId, e: ExprId) -> bool {
        let ExprKind::Ident(name) = self.hir(file)[e].kind else { return false };
        let Some(sym) = self.symbol_named_by(file, e, name) else { return false };
        let Some((of, Decl::Var(pat))) = self.declaration_of_variable(sym) else { return false };
        let PatParent::Var(declaration) = self.bound(of).pat_parent[pat.idx()] else { return false };
        let declaration = &self.hir(of)[declaration];
        declaration.kind == VarKind::Const && declaration.init.is_some() && self.is_call_of_library(of, declaration.init, b"ObjectConstructor", &[b"create"])
    }

    /// Whether every object of the type has the property: no part of it lacks the name or has it optional.
    fn is_required_by(&mut self, ty: TypeId, name: Atom) -> bool {
        let parts: Vec<TypeId> = self.parts(ty).to_vec();
        parts.into_iter().all(|part| self.get_property_of_type(part, name).is_some_and(|(prop, _)| !prop.flags.contains(crate::types::PropFlags::OPTIONAL)))
    }

    /// `{ value: .., writable: true, enumerable: true, configurable: true }`: what a store leaves. Not `is_complete`: some of the three may be left out: a property that is there keeps what it has
    /// of them, so for such a one that is a store too.
    fn is_plain_data_descriptor(&self, file: FileId, descriptor: ExprId, is_complete: bool) -> bool {
        let hir = self.hir(file);
        let ExprKind::Object(props) = hir[descriptor].kind else { return false };
        let mut seen = [false; 4];
        for prop in props.iter() {
            let PropKey::Name(name) = hir[prop].key else { return false };
            let at = match self.atoms().bytes(name) {
                b"value" if matches!(hir[prop].kind, PropKind::Init | PropKind::Shorthand | PropKind::Method) => 0,
                b"writable" => 1,
                b"enumerable" => 2,
                b"configurable" => 3,
                _ => return false,
            };
            if at != 0 && !(hir[prop].kind == PropKind::Init && matches!(hir[hir[prop].value].kind, ExprKind::True)) {
                return false;
            }
            seen[at] = true;
        }
        seen[0] && (!is_complete || seen == [true; 4])
    }

    /// Whether the signature the call is resolved to is declared by the interface `holder` of a declaration file under one of the names.
    fn is_call_of_library(&mut self, file: FileId, e: ExprId, holder: &[u8], names: &[&[u8]]) -> bool {
        let Some(sig) = self.resolved_signature(file, e).sig else { return false };
        let Some((declared_in, func, _)) = self.sig_decl(sig) else { return false };
        let (hir, bound) = (self.hir(declared_in), self.bound(declared_in));
        let FnOwner::Member(member) = bound.fns[func.idx()].owner else { return false };
        let MemberOwner::Interface(interface) = bound.member_owner[member.idx()] else { return false };
        hir.kind == FileKind::Declaration
            && hir[func].name.is_some()
            && names.contains(&self.atoms().bytes(hir[func].name))
            && self.atoms().bytes(hir[interface].name) == holder
    }

    // ───────────────────────────── what a read yields ─────────────────────────────

    /// `e`: `a`, `a.b` or `a[b]`, which is read. `None`: it does not refer to a variable, a parameter, a property or an element.
    ///
    /// The checker keeps what it has found out about a place across a call, though what is called may store to the place. For a
    /// property or an element any code that has got hold of the object may. For a variable only the code in its scope can.
    pub fn reference_read_by(&mut self, file: FileId, e: ExprId) -> Option<ReferenceRead> {
        if let Some(&known) = self.aot.storage.reads.get(&(file, e)) {
            return known;
        }
        let asked = self.nothing_is_assumed();
        let found = self.find_reference_read_by(file, e);
        if self.may_be_kept(asked) {
            self.aot.storage.reads.insert((file, e), found);
        }
        found
    }

    fn find_reference_read_by(&mut self, file: FileId, e: ExprId) -> Option<ReferenceRead> {
        let hir = self.hir(file);
        match hir[e].kind {
            ExprKind::Ident(name) => {
                let sym = self.symbol_named_by(file, e, name)?;
                let (of, Decl::Var(_) | Decl::Param(_)) = self.declaration_of_variable(sym)? else { return None };
                let is_narrowing_reliable = match self.where_flow_tells_of(sym) {
                    ToldOf::Everywhere => true,
                    ToldOf::Within(site) => of == file && self.site_of(file, self.bound(file).expr_parent[e.idx()]) == Some(site),
                    ToldOf::Nowhere => false,
                };
                let is_definite = matches!(self.declaration_of_variable(sym), Some((of, Decl::Var(pat))) if matches!(root_declaration(self.bound(of), pat), PatParent::Var(d) if self.hir(of)[d].flags.contains(Flags::DEFINITE)));
                let starts_undefined = self.starts_undefined(sym);
                Some(ReferenceRead { declared: self.type_stored_to(sym), is_narrowing_reliable, may_be_undefined: starts_undefined && !is_definite, is_asserted: starts_undefined && is_definite })
            }
            ExprKind::Dot { obj, name, .. } if !matches!(hir[obj].kind, ExprKind::Super) => {
                // `(node as NamedDeclaration).name`: the object may be any node, and then there need be no such property.
                let object = if self.is_asserted_where_it_is_used(file, obj) { self.type_of_expr(file, obj) } else { self.type_yielded_by(file, obj) };
                let mut object = self.non_nullable(object);
                if self.is_union(object) && self.property_type(object, object, name, shape::Access::Read).is_none() {
                    object = self.view_of_either(object);
                }
                let found = self.property_type_within(object, object, name, shape::Access::Read, Some(file));
                let mut declared = found.map_or(TypeId::UNRESOLVED, |found| found.0);
                let apparent = self.apparent_type(object);
                let field = self.prop_ref(apparent, name).and_then(|(prop, _)| match prop.source {
                    PropSource::Symbol(field) => Some(field),
                    _ => None,
                });
                if declared != TypeId::UNRESOLVED
                    && let Some((prop, mapper)) = self.prop_ref(apparent, name)
                    && self.type_of_prop(prop, MapperId::IDENTITY) != self.type_of_prop(prop, mapper)
                {
                    declared = self.without_number_literals_given(declared);
                }
                if declared != TypeId::UNRESOLVED
                    && let Some((prop, mapper)) = self.prop_ref(apparent, name)
                    && matches!(prop.source, PropSource::Literal(..))
                {
                    let held = self.type_held_by_prop(prop, mapper);
                    declared = self.union(&[declared, held]);
                }
                if declared != TypeId::UNRESOLVED && self.has_predicted_prop(object, name) {
                    declared = TypeId::UNKNOWN;
                }
                let may_be_undefined = matches!(found, Some((_, Found::ByIndex))) || field.is_some_and(|field| self.may_find_field_blank(field));
                Some(ReferenceRead { declared, is_narrowing_reliable: false, may_be_undefined, is_asserted: false })
            }
            ExprKind::Index { obj, index, .. } if !matches!(hir[obj].kind, ExprKind::Super) => {
                let object = self.type_of_expr(file, obj);
                let object = self.non_nullable(object);
                let object = self.without_number_literals_in_arguments(object);
                let key = self.type_of_expr(file, index);
                let outer = self.aot.storage.accessed_within.replace(file);
                let declared = if object == TypeId::UNKNOWN { TypeId::UNKNOWN } else { self.indexed_access_if_any(object, key, true).unwrap_or(TypeId::UNRESOLVED) };
                self.aot.storage.accessed_within = outer;
                Some(ReferenceRead { declared, is_narrowing_reliable: false, may_be_undefined: true, is_asserted: false })
            }
            _ => None,
        }
    }

    /// `let id: string | undefined = undefined; run(() => { id = "a" }); const row = { id, other: id ?? null }`. The checker narrows a place by
    /// what was last stored to it and by the tests on the way, and does not see what other code stores in between (microsoft/TypeScript
    /// 9998). The read has the type of the place: `is_narrowing_reliable`. This is for the types that the checker INFERS from the
    /// narrowed one, for places that nobody has written a type for: what the value of the expression may be besides, through the
    /// operators that hand a value on. `None`: nothing.
    pub fn held_besides_what_flow_tells(&mut self, file: FileId, e: ExprId) -> Option<TypeId> {
        if self.is_half_of_stack_in_use() {
            return Some(TypeId::ANY);
        }
        let (first, second) = match self.hir(file)[e].kind {
            ExprKind::Ident(_) | ExprKind::Dot { .. } | ExprKind::Index { .. } => {
                let read = self.reference_read_by(file, e).filter(|read| !read.is_narrowing_reliable && read.declared != TypeId::UNRESOLVED)?;
                let own = self.type_of_expr(file, e);
                return (read.declared != own && !self.is_provably_assignable(read.declared, own)).then_some(read.declared);
            }
            ExprKind::Binary { op: BinOp::And | BinOp::Or | BinOp::Nullish, left, right } => (left, right),
            ExprKind::Cond { yes, no, .. } => (yes, no),
            ExprKind::Binary { op: BinOp::Comma, right: inner, .. } | ExprKind::Assign { op: None, value: inner, .. } | ExprKind::Satisfies { expr: inner, .. } | ExprKind::AsConst(inner) => (inner, ExprId::NONE),
            ExprKind::NonNull(inner) => return self.held_besides_what_flow_tells(file, inner).map(|held| self.non_nullable(held)),
            _ => return None,
        };
        let first = self.held_besides_what_flow_tells(file, first);
        let second = if second.is_some() { self.held_besides_what_flow_tells(file, second) } else { None };
        match (first, second) {
            (Some(first), Some(second)) => Some(self.union(&[first, second])),
            (first, second) => first.or(second),
        }
    }

    /// What a property holds. That is the checker's type of it, but for a property of an object literal that nothing is written down for: it
    /// has room for what its initializer may be: `held_besides_what_flow_tells`.
    pub fn type_held_by_prop(&mut self, prop: &Prop, mapper: MapperId) -> TypeId {
        let own = self.type_of_prop(prop, mapper);
        let PropSource::Literal(file, written) = prop.source else { return own };
        let value = self.hir(file)[written].value;
        let is_written_out = value.is_some()
            && match self.hir(file)[value].kind {
                ExprKind::Number(_) | ExprKind::BigInt(_) => true,
                ExprKind::Unary { op: UnOp::Minus, operand } => matches!(self.hir(file)[operand].kind, ExprKind::Number(_) | ExprKind::BigInt(_)),
                _ => false,
            };
        let own = if is_written_out || prop.flags.contains(crate::types::PropFlags::READONLY) { own } else { self.without_number_literals_given(own) };
        match if value.is_some() { self.held_besides_what_flow_tells(file, value) } else { None } {
            Some(held) => self.union(&[own, held]),
            None => own,
        }
    }

    /// `starts_undefined` of a property, which knows nothing of what the class extends.
    fn may_find_field_blank(&mut self, field: Sym) -> bool {
        if let Some(&known) = self.aot.storage.blank_fields.get(&field) {
            return known;
        }
        let found = self.starts_undefined(field);
        self.aot.storage.blank_fields.insert(field, found);
        found
    }

    /// The type that the value of the expression is of as soon as it is evaluated, and whether it may be `undefined` besides. That is the
    /// checker's type of the expression, except for a reference whose narrowing is not reliable: nothing is made sure of at the read
    /// but what the place is declared to hold. And except for a cast, which converts and does not assert: `5 as 1 | 2` is a number.
    pub(super) fn type_held_to(&mut self, file: FileId, e: ExprId) -> (TypeId, bool) {
        let is_left_out = self.is_optional_chain(file, e) || self.may_yield_blank_variable(file, e);
        let (held, may_be_undefined) = match self.reference_read_by(file, e) {
            Some(read) if !read.is_narrowing_reliable => (read.declared, read.may_be_undefined || is_left_out),
            Some(read) => (self.type_of_expr(file, e), read.may_be_undefined || is_left_out),
            None if matches!(self.hir(file)[e].kind, ExprKind::As { .. } | ExprKind::NonNull(_) | ExprKind::Satisfies { .. } | ExprKind::AsConst(_) | ExprKind::Assign { op: None, .. } | ExprKind::Binary { op: BinOp::Comma, .. }) => (self.type_yielded_by(file, e), is_left_out),
            None => (self.type_of_expr(file, e), is_left_out),
        };
        (held, may_be_undefined || self.admits_nil(held))
    }

    /// `a?.b`, `a?.[b]`, `a?.()` and what goes on from there, `a?.b.c`. It yields `undefined` where `a` is missing, which the checker's
    /// type leaves out where it takes `a` to be there: an element of an array, an entry of a dictionary.
    pub fn is_optional_chain(&self, file: FileId, e: ExprId) -> bool {
        let hir = self.hir(file);
        match hir[e].kind {
            ExprKind::Dot { chain, .. } | ExprKind::Index { chain, .. } => chain != Chain::No,
            ExprKind::Call(call) => hir[call].chain != Chain::No,
            _ => false,
        }
    }

    pub fn catch_parameter_named_again_by(&self, file: FileId, pat: PatId) -> Option<SymbolId> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let PatKind::Ident(name) = hir[pat].kind else { return None };
        let PatParent::Var(d) = root_declaration(bound, pat) else { return None };
        if hir[d].kind != VarKind::Var {
            return None;
        }
        let mut inner = bound.var_stmt[d.idx()];
        let mut parent = Parent::Stmt(inner);
        loop {
            parent = match parent {
                Parent::Stmt(at) if at.is_some() => {
                    if let StmtKind::Try { param, handler, .. } = hir[at].kind
                        && handler == inner
                        && param.is_some()
                        && matches!(hir[hir[param].pat].kind, PatKind::Ident(caught) if caught == name)
                    {
                        return bound.pat_symbol[hir[param].pat.idx()].some();
                    }
                    inner = at;
                    bound.stmt_parent[at.idx()]
                }
                Parent::Case(_) => self.parent_of_node(file, parent),
                _ => return None,
            };
        }
    }

    /// Whether the variable is stored to as `(a as T) = value`, which is not among `Bound::assignments_to`.
    pub(super) fn is_stored_through_casts(&self, file: FileId, local: SymbolId) -> bool {
        has(&self.storage_facts(file).stored_through_casts, local)
    }

    pub fn is_member_of_declared_enum(&self, declared: Sym, file: FileId, member: crate::hir::EnumMemberId) -> bool {
        self.files().decls_of(declared).iter().any(|&(of, decl)| {
            matches!(decl, Decl::Enum(declaration) if of == file
                && self.hir(of)[declaration].members.iter().any(|it| it == member)
                && !self.hir(of)[declaration].flags.contains(Flags::CONST)
                && (!self.is_compiled(of) || self.hir(of)[declaration].flags.contains(Flags::AMBIENT)))
        })
    }

    fn where_flow_tells_of(&mut self, sym: Sym) -> ToldOf {
        if let Some(&known) = self.aot.storage.told_of.get(&sym) {
            return known;
        }
        // For a variable that is stored to itself by way of another.
        self.aot.storage.told_of.insert(sym, ToldOf::Nowhere);
        self.aot.storage.being_told_of += 1;
        let found = self.find_where_flow_tells_of(sym);
        self.aot.storage.being_told_of -= 1;
        self.aot.storage.told_of.insert(sym, found);
        found
    }

    fn find_where_flow_tells_of(&mut self, sym: Sym) -> ToldOf {
        let Some((file, decl)) = self.declaration_of_variable(sym) else { return ToldOf::Nowhere };
        let (hir, bound) = (self.hir(file), self.bound(file));
        let local = bound.symbol_of_declaration(decl);
        let Some(symbol) = bound.symbols.get(local.idx()) else { return ToldOf::Nowhere };
        if symbol.flags.contains(SymFlags::MERGED) || symbol.decls.iter().count() != 1 || self.files().sym(file, local) != sym {
            return ToldOf::Nowhere;
        }
        let (site, first) = match decl {
            Decl::Var(pat) => match root_declaration(bound, pat) {
                PatParent::Var(d) => (self.dead_zone_of(file, decl).map(|found| found.0), if hir[d].pat == pat { hir[d].init } else { ExprId::NONE }),
                _ => return ToldOf::Nowhere,
            },
            Decl::Param(pat) => match root_declaration(bound, pat) {
                PatParent::Param(p) => (Some(Site::Body(bound.param_fn[p.idx()])), if hir[p].pat == pat { hir[p].default } else { ExprId::NONE }),
                _ => return ToldOf::Nowhere,
            },
            _ => return ToldOf::Nowhere,
        };
        let Some(site) = site else { return ToldOf::Nowhere };
        // The other scripts of the program see what a script declares.
        if site == Site::File && !self.files().module(file).is_module() {
            return ToldOf::Nowhere;
        }
        let targets = bound.assignments_to(local);
        if has(&self.storage_facts(file).stored_through_casts, local) || !targets.iter().all(|&(_, target)| self.site_of(file, bound.expr_parent[target.idx()]) == Some(site) && !self.is_in_default_of_assignment_pattern(file, target)) {
            return ToldOf::Nowhere;
        }
        // The checker's type of the variable is that of its initializer.
        if !self.is_typed_as_handed_on(file, first) {
            return ToldOf::Nowhere;
        }
        // A store narrows a union to the type of what is stored, which has to be what the value is held to.
        let declared = self.type_of_symbol(sym);
        if self.is_union(declared) {
            let mut stored = vec![first];
            for &(_, target) in targets {
                let Parent::Expr(parent) = bound.expr_parent[target.idx()] else { return ToldOf::Nowhere };
                match hir[parent].kind {
                    ExprKind::Assign { target: to, value, .. } if to == target && self.store_to_target(file, target).is_some() => stored.push(value),
                    ExprKind::Unary { .. } => {}
                    _ => return ToldOf::Nowhere,
                }
            }
            if !stored.into_iter().all(|value| self.is_held_to_its_type(file, value)) {
                return ToldOf::Nowhere;
            }
        }
        if targets.is_empty() { ToldOf::Everywhere } else { ToldOf::Within(site) }
    }

    /// What the operator `e` yields: the checker's type of `e` where its operands are held to the checker's types of them, and those say
    /// something: the checker has `any * any` and `any++` be numbers. Of any others it makes a number, a bigint if all of them may be
    /// bigints or objects, which convert to what they like, and `+` a string.
    fn type_computed_from(&mut self, file: FileId, e: ExprId, operands: &[ExprId], may_concatenate: bool) -> TypeId {
        let own = self.type_of_expr(file, e);
        let held: Vec<TypeId> = operands.iter().map(|&operand| self.type_held_to(file, operand).0).collect();
        if operands.iter().zip(&held).all(|(&operand, &held)| !self.says_nothing(held) && (held == self.type_of_expr(file, operand) || self.is_asserted_as_operand(file, operand, held))) {
            return own;
        }
        let mut parts = vec![own, TypeId::NUMBER];
        if may_concatenate {
            parts.push(TypeId::STRING);
        }
        if held.iter().all(|&held| self.says_nothing(held) || self.some_type(held, |c, part| c.is_bigint_like(part) || !c.has_primitive_flag(part))) {
            parts.push(TypeId::BIGINT);
        }
        self.union(&parts)
    }

    /// `(x as number) + 1`: `held` is the checker's type of the operand and besides only what a cast lets through: nil, which the operator converts, and objects, of which the operand
    /// is asserted to be none: `has_no_objects_by_its_type`.
    pub fn yields_nil_that_a_cast_left(&mut self, file: FileId, e: ExprId) -> bool {
        self.yields_nil_that_a_cast_left_but_by(file, e, &mut Vec::new())
    }

    fn yields_nil_that_a_cast_left_but_by(&mut self, file: FileId, e: ExprId, seen: &mut Vec<Sym>) -> bool {
        match self.hir(file)[e].kind {
            ExprKind::As { .. } => true,
            ExprKind::Satisfies { expr, .. } => self.yields_nil_that_a_cast_left_but_by(file, expr, seen),
            ExprKind::Cond { yes, no, .. } => self.yields_nil_that_a_cast_left_but_by(file, yes, seen) || self.yields_nil_that_a_cast_left_but_by(file, no, seen),
            ExprKind::Binary { op: BinOp::And | BinOp::Or | BinOp::Nullish, left, right } => {
                self.yields_nil_that_a_cast_left_but_by(file, left, seen) || self.yields_nil_that_a_cast_left_but_by(file, right, seen)
            }
            ExprKind::Binary { op: BinOp::Comma, right, .. } => self.yields_nil_that_a_cast_left_but_by(file, right, seen),
            ExprKind::Assign { op: None, value, .. } => self.yields_nil_that_a_cast_left_but_by(file, value, seen),
            ExprKind::Ident(name) => {
                let Some(sym) = self.symbol_named_by(file, e, name) else { return false };
                if seen.contains(&sym) {
                    return false;
                }
                seen.push(sym);
                let Some((of, Decl::Var(pat))) = self.declaration_of_variable(sym) else { return false };
                let mut stored: Vec<ExprId> = Vec::new();
                if let PatParent::Var(d) = root_declaration(self.bound(of), pat)
                    && self.hir(of)[d].pat == pat
                    && self.hir(of)[d].init.is_some()
                {
                    stored.push(self.hir(of)[d].init);
                }
                let targets: Vec<ExprId> = self.bound(of).assignments_to(sym.id).iter().map(|assignment| assignment.1).collect();
                stored.extend(targets.into_iter().filter_map(|target| match self.store_to_target(of, target) {
                    Some(super::integers::Store::Value(value)) => Some(value),
                    _ => None,
                }));
                stored.into_iter().any(|value| self.yields_nil_that_a_cast_left_but_by(of, value, seen))
            }
            _ => false,
        }
    }

    fn is_asserted_as_operand(&mut self, file: FileId, operand: ExprId, held: TypeId) -> bool {
        let declared = self.type_of_expr(file, operand);
        if !self.is_asserted_where_it_is_used(file, operand) {
            return false;
        }
        let (of_declared, of_held): (Vec<TypeId>, Vec<TypeId>) = (self.parts(declared).to_vec(), self.parts(held).to_vec());
        of_held.into_iter().all(|part| of_declared.contains(&part) || matches!(part, TypeId::UNDEFINED | TypeId::NULL) || !self.has_primitive_flag(part))
    }

    /// Whether the value of the expression is of the checker's type of the expression as soon as it is evaluated.
    fn is_held_to_its_type(&mut self, file: FileId, e: ExprId) -> bool {
        if e.is_none() {
            return true;
        }
        match self.hir(file)[e].kind {
            ExprKind::Satisfies { expr, .. } | ExprKind::Assign { op: None, value: expr, .. } => self.is_held_to_its_type(file, expr),
            _ => match self.reference_read_by(file, e) {
                Some(read) => !read.may_be_undefined && (read.is_narrowing_reliable || read.declared == self.type_of_expr(file, e)),
                None => self.is_typed_as_it_yields(file, e),
            },
        }
    }

    // ───────────────────────────── the temporal dead zone ─────────────────────────────

    /// `symbol.ValueDeclaration`, also of `const a = require("a")` in JavaScript, which is an alias here and a variable when it runs.
    pub(super) fn declaration_of_variable(&self, sym: Sym) -> Option<(FileId, Decl)> {
        let files = self.files();
        files.value_declaration(sym).or_else(|| {
            files.decls_of(sym).iter().find_map(|&(file, decl)| match decl {
                Decl::Require(pat) => Some((file, Decl::Var(pat))),
                _ => None,
            })
        })
    }

    /// Whether there is a time at which the name is in scope and stands for nothing yet: a `let`, a `const`, a `using`, a class.
    pub fn has_dead_zone(&self, sym: Sym) -> bool {
        let Some((file, decl)) = self.declaration_of_variable(sym) else { return false };
        let hir = self.hir(file);
        matches!(decl, Decl::Var(_) | Decl::Class(_))
            && self.is_compiled(file)
            && !self.bound(file).modifier_flags(hir, decl).contains(Flags::AMBIENT)
            && !matches!(self.dead_zone_of(file, decl), Some((_, 0)))
    }

    /// Whether the variable is `undefined` from the start: a `var`, and what a builtin module declares at its top level.
    pub fn is_hoisted(&self, sym: Sym) -> bool {
        matches!(self.declaration_of_variable(sym), Some((file, decl @ Decl::Var(_))) if matches!(self.dead_zone_of(file, decl), Some((_, 0))))
    }

    /// A `const` or a `using`: an assignment to it throws.
    pub fn is_constant(&self, sym: Sym) -> bool {
        let Some((file, Decl::Var(pat))) = self.declaration_of_variable(sym) else { return false };
        matches!(root_declaration(self.bound(file), pat), PatParent::Var(d) if matches!(self.hir(file)[d].kind, VarKind::Const | VarKind::Using | VarKind::AwaitUsing))
    }

    /// Whether the expression `e` of `file`, which refers to `sym`, may be evaluated while that is in its temporal dead zone. `NONE`: a
    /// reference that is not in the source.
    pub fn may_be_in_dead_zone(&mut self, sym: Sym, file: FileId, e: ExprId) -> bool {
        let Some((of, decl)) = self.declaration_of_variable(sym) else { return true };
        match decl {
            Decl::Fn(_) => false,
            Decl::Param(pat) => of != file || e.is_none() || self.may_find_parameter_unbound(file, pat, e),
            Decl::Var(_) | Decl::Class(_) => match self.dead_zone_of(of, decl) {
                Some((_, 0)) => false,
                // The body of a module that is put first has run to its end before any code of another module that gets at it.
                Some((Site::File, _)) if of != file && self.is_put_first(of) && !self.p.aot.storage.put_off.get().is_some_and(|put_off| put_off.contains(&of)) => false,
                Some((site, end)) => !self.is_initialized_before_any_code(sym) && (of != file || e.is_none() || !self.is_evaluated_after(file, e, site, end)),
                None => true,
            },
            _ => true,
        }
    }

    /// Whether the expression is evaluated only once control has passed the position `end` in the text of `site`: it comes later in that
    /// code, or is part of a function or a class that is made later in that code, or of a function declaration that is first referred
    /// to later in that code, so that nobody can call it before.
    fn is_evaluated_after(&self, file: FileId, e: ExprId, site: Site, end: u32) -> bool {
        self.comes_after(file, e, site, end, true)
    }

    /// The same, and the closure that the expression is evaluated by is made that late as well. That of a function declaration may be
    /// made where its scope is entered.
    fn is_made_after(&self, file: FileId, e: ExprId, site: Site, end: u32) -> bool {
        self.comes_after(file, e, site, end, false)
    }

    fn comes_after(&self, file: FileId, e: ExprId, site: Site, end: u32, goes_by_earliest_run: bool) -> bool {
        let (mut pos, mut parent) = (self.hir(file)[e].pos, self.bound(file).expr_parent[e.idx()]);
        loop {
            match self.site_of(file, parent) {
                Some(at) if at == site => return pos >= end,
                Some(at) => match self.where_made(file, at).or_else(|| self.earliest_run_of(file, at).filter(|_| goes_by_earliest_run)) {
                    Some(made) => (pos, parent) = made,
                    None => return false,
                },
                None => return false,
            }
        }
    }

    /// `site`: the body or a parameter of a function declaration. The position in the code that declares the function before which it does
    /// not run, with the parent of the declaration. `None`: that is not known.
    fn earliest_run_of(&self, file: FileId, site: Site) -> Option<(u32, Parent)> {
        let bound = self.bound(file);
        let func = match site {
            Site::Body(func) => func,
            Site::Parameter(p) => bound.param_fn[p.idx()],
            Site::File | Site::Initializer(_) => return None,
        };
        let &pos = self.earliest_runs_in(file).get(&func)?;
        let FnOwner::Stmt(stmt) = bound.fns[func.idx()].owner else { return None };
        Some((pos, bound.stmt_parent[stmt.idx()]))
    }

    /// By function declaration: the position in the text of the code that declares it before which it does not run. `u32::MAX`: it never
    /// runs. The checker that asks first finds them, from the tree and the symbols of the file alone.
    ///
    /// A function declaration is there from the start of its scope, but there is no way to its closure other than its name. So its
    /// code runs only once a reference to the name has been evaluated. A reference in the code that declares it is evaluated where it
    /// stands; one in a function or a class that is made there, no earlier than that is made; one in another function that is declared
    /// there, no earlier than that one runs.
    ///
    /// Not for a function that other code can name: one that is exported, merged with something, assigned to, or declared at the top of
    /// a script. Not in JavaScript, where a function in a block is a `var` besides, nor in a file with a direct `eval`, which names what it likes.
    fn earliest_runs_in(&self, file: FileId) -> &'p FxHashMap<FnId, u32> {
        let program = self.p;
        program.aot.storage.earliest_runs.get_or_init(program.files.modules.len(), file, || self.find_earliest_runs_in(file))
    }

    fn find_earliest_runs_in(&self, file: FileId) -> FxHashMap<FnId, u32> {
        let (hir, bound, index) = (self.hir(file), self.bound(file), self.exprs_by_kind_of(file));
        let mut runs: FxHashMap<FnId, u32> = FxHashMap::default();
        if hir.is_js || matches!(hir.kind, FileKind::Declaration | FileKind::Json) || bound.ran_out_of_stack || self.has_direct_eval(file) {
            return runs;
        }
        // By symbol: the declaration with the body, and the code that declares it.
        let mut declared: FxHashMap<SymbolId, (FnId, Site)> = FxHashMap::default();
        for (func, f) in hir.fns.iter().enumerate() {
            let func = FnId(func as u32);
            let FnOwner::Stmt(stmt) = bound.fns[func.idx()].owner else { continue };
            let id = bound.fn_symbol[func.idx()];
            let Some(symbol) = bound.symbols.get(id.idx()) else { continue };
            let is_more = SymFlags::VALUE.difference(SymFlags::FUNCTION) | SymFlags::MERGED | SymFlags::ASSIGNED | SymFlags::ALIAS;
            let bodies = symbol.decls.iter().filter(|decl| matches!(**decl, Decl::Fn(it) if !matches!(hir[it].body, FnBody::None))).count();
            let is_named_elsewhere = f.flags.intersects(Flags::EXPORT | Flags::DEFAULT | Flags::AMBIENT)
                || symbol.flags.intersects(is_more)
                || bodies != 1
                || !symbol.decls.iter().all(|decl| matches!(decl, Decl::Fn(_)))
                || hir.exports.iter().any(|export| export.spec.is_none() && export.items.iter().any(|item| hir[item].local == f.name));
            if f.kind != FnKind::Decl || matches!(f.body, FnBody::None) || is_named_elsewhere {
                continue;
            }
            let Some(site) = self.site_of(file, bound.stmt_parent[stmt.idx()]) else { continue };
            if site != Site::File || self.files().module(file).is_module() {
                declared.insert(id, (func, site));
                runs.insert(func, u32::MAX);
            }
        }
        // `(a, b)`: `b` is referred to in `a`, and one code declares both.
        let mut referred_to_in: Vec<(FnId, FnId)> = Vec::new();
        for &e in index.of(ExprTag::Ident) {
            let Some(&(func, home)) = declared.get(&bound.expr_symbol[e.idx()]) else { continue };
            let (mut pos, mut parent) = (hir[e].pos, bound.expr_parent[e.idx()]);
            if parent == Parent::None || bound.is_in_type_query(e) {
                continue;
            }
            let earliest = loop {
                match self.site_of(file, parent) {
                    Some(at) if at == home => break pos,
                    Some(at) => {
                        let around = match at {
                            Site::Body(around) => around,
                            Site::Parameter(p) => bound.param_fn[p.idx()],
                            Site::File | Site::Initializer(_) => FnId::NONE,
                        };
                        if let Some(made) = self.where_made(file, at) {
                            (pos, parent) = made;
                        } else if around.is_some()
                            && runs.contains_key(&around)
                            && let FnOwner::Stmt(stmt) = bound.fns[around.idx()].owner
                        {
                            if self.site_of(file, bound.stmt_parent[stmt.idx()]) == Some(home) {
                                referred_to_in.push((around, func));
                                break u32::MAX;
                            }
                            // It is declared further in, and runs no earlier than the code that declares it.
                            (pos, parent) = (hir[stmt].start, bound.stmt_parent[stmt.idx()]);
                        } else {
                            break 0;
                        }
                    }
                    None => break 0,
                }
            };
            let so_far = runs.entry(func).or_insert(u32::MAX);
            *so_far = earliest.min(*so_far);
        }
        // The least over whatever leads to it. From the earliest on, so that each is settled when it is first come by.
        referred_to_in.sort_unstable_by_key(|&(from, to)| (from.0, to.0));
        referred_to_in.dedup();
        let mut by_position: Vec<(u32, FnId)> = runs.iter().map(|(&func, &pos)| (pos, func)).collect();
        by_position.sort_unstable_by_key(|&(pos, func)| (pos, func.0));
        let mut is_settled: FxHashSet<FnId> = FxHashSet::default();
        for (pos, first) in by_position {
            let mut pending = vec![first];
            while let Some(from) = pending.pop() {
                if !is_settled.insert(from) {
                    continue;
                }
                runs.insert(from, pos);
                let start = referred_to_in.partition_point(|edge| edge.0.0 < from.0);
                pending.extend(referred_to_in[start..].iter().take_while(|edge| edge.0 == from).map(|edge| edge.1));
            }
        }
        runs
    }

    /// Where the function or the class is made that the code is a part of. `None`: a function declaration, which is there from the
    /// start of its scope.
    pub(super) fn where_made(&self, file: FileId, site: Site) -> Option<(u32, Parent)> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let func = match site {
            Site::File => return None,
            Site::Body(func) => func,
            Site::Parameter(p) => bound.param_fn[p.idx()],
            Site::Initializer(_) => FnId::NONE,
        };
        let member = match site {
            Site::Initializer(member) => member,
            _ => match bound.fns.get(func.idx())?.owner {
                FnOwner::Expr(e) => return Some((hir[e].pos, bound.expr_parent[e.idx()])),
                FnOwner::Member(member) => member,
                _ => return None,
            },
        };
        let MemberOwner::Class(class) = bound.member_owner[member.idx()] else { return None };
        Some(match bound.class_owner[class.idx()] {
            ClassOwner::Expr(e) => (hir[e].pos, bound.expr_parent[e.idx()]),
            ClassOwner::Stmt(stmt) => (hir[stmt].start, bound.stmt_parent[stmt.idx()]),
        })
    }

    /// Whether no reference anywhere finds the `let`, the `const` or the class in its dead zone.
    pub fn is_never_seen_uninitialized(&mut self, sym: Sym) -> bool {
        self.is_never_early(sym, |facts| &facts.found_early)
    }

    /// The same, and no closure that refers to it is made while it is in its dead zone: what the closure finds when it is made is what
    /// it finds whenever it runs, if nothing is stored to the variable.
    pub(super) fn is_never_captured_uninitialized(&mut self, sym: Sym) -> bool {
        self.is_never_early(sym, |facts| &facts.captured_early)
    }

    fn is_never_early(&mut self, sym: Sym, early: impl Fn(&FileFacts) -> &Vec<u64>) -> bool {
        if self.is_initialized_before_any_code(sym) {
            return true;
        }
        let Some((file, decl @ (Decl::Var(_) | Decl::Class(_)))) = self.declaration_of_variable(sym) else { return false };
        let bound = self.bound(file);
        let local = bound.symbol_of_declaration(decl);
        let Some(symbol) = bound.symbols.get(local.idx()) else { return false };
        // What other files see is referred to by code that is not looked at here.
        let is_seen_by_importers = bound.modifier_flags(self.hir(file), decl).contains(Flags::EXPORT) || self.files().sym(file, local) != sym || has(&self.storage_facts(file).seen_by_importers, local);
        let is_seen_elsewhere = symbol.flags.contains(SymFlags::MERGED)
            || is_seen_by_importers
            || !self.files().module(file).is_module() && matches!(self.dead_zone_of(file, decl), Some((Site::File, _)));
        !is_seen_elsewhere && self.dead_zone_of(file, decl).is_some() && !has(early(self.storage_facts(file)), local)
    }

    // ───────────────────────────── constants ─────────────────────────────

    /// The value of a `const` whose initializer is a constant expression of primitives. A reference to it stands for the value wherever
    /// it is. Where the language has it throw because the declaration has not been evaluated yet, whoever translates the reference sees to
    /// that. A long string stays a variable: each reference would be a copy of it.
    pub fn constant_held_by(&mut self, sym: Sym) -> Option<Primitive> {
        if self.aot.storage.folding_long_strings {
            if let Some(&known) = self.aot.storage.long_string_constants.get(&sym) {
                return known;
            }
            self.aot.storage.long_string_constants.insert(sym, None);
            let found = self.initializer_of_const(sym).and_then(|(file, init)| self.constant_value_of(file, init)).filter(|value| !matches!(*value, Primitive::String(text) if self.atoms().bytes(text).len() > MAX_FOLDED_STRING_PART_LEN));
            self.aot.storage.long_string_constants.insert(sym, found);
            return found;
        }
        if let Some(&known) = self.aot.storage.constants.get(&sym) {
            return known;
        }
        // For one that is initialized with itself by way of another.
        self.aot.storage.constants.insert(sym, None);
        let found = self.find_constant_held_by(sym);
        self.aot.storage.constants.insert(sym, found);
        found
    }

    /// The initializer of a `const` of the program that declares the one name.
    pub fn initializer_of_const(&mut self, sym: Sym) -> Option<(FileId, ExprId)> {
        let (file, Decl::Var(pat)) = self.declaration_of_variable(sym)? else { return None };
        let hir = self.hir(file);
        let PatParent::Var(d) = root_declaration(self.bound(file), pat) else { return None };
        // What a declaration file says a constant is, other code has to make true.
        let is_code = self.is_compiled(file) && !hir[d].flags.contains(Flags::AMBIENT);
        if !is_code || hir[d].kind != VarKind::Const || hir[d].pat != pat || hir[d].init.is_none() {
            return None;
        }
        Some((file, hir[d].init))
    }

    fn find_constant_held_by(&mut self, sym: Sym) -> Option<Primitive> {
        let (file, init) = self.initializer_of_const(sym)?;
        self.constant_value_of(file, init).filter(|value| !matches!(*value, Primitive::String(text) if self.atoms().bytes(text).len() > MOST_BYTES_OF_CONSTANT))
    }

    /// The value of a constant expression: literals of numbers, strings and booleans, `null`, `undefined`, operators on them that neither
    /// convert an operand nor throw, constants, members of enums. By value and not by type: `-0` is not `0`. The arithmetic is that of
    /// `evaluate`, which has the values of the members of enums.
    pub fn constant_value_of(&mut self, file: FileId, e: ExprId) -> Option<Primitive> {
        if self.is_half_of_stack_in_use() {
            return None;
        }
        let hir = self.hir(file);
        Some(match hir[e].kind {
            ExprKind::Null => Primitive::Null,
            ExprKind::True => Primitive::Bool(true),
            ExprKind::False => Primitive::Bool(false),
            ExprKind::Number(index) => Primitive::Number(hir.numbers[index as usize]),
            ExprKind::String(text) => Primitive::String(text),
            ExprKind::Template { exprs } => {
                let texts = hir.template_texts(exprs);
                let mut text = self.atoms().bytes(hir.id_at(texts, 0)).to_vec();
                for (i, substitution) in hir.ids(exprs).enumerate() {
                    let value = self.constant_value_of(file, substitution)?;
                    text.extend_from_slice(self.text_of_primitive(value));
                    text.extend_from_slice(self.atoms().bytes(hir.id_at(texts, i + 1)));
                }
                Primitive::String(self.atoms().intern(&text))
            }
            ExprKind::TaggedTemplate(call) if self.is_string_raw_tag(file, call) => {
                let raw = self.template_raw_strings(file, call);
                let mut text = raw.first()?.clone();
                for (i, substitution) in hir.ids(hir[call].args).enumerate() {
                    let value = self.constant_value_of(file, substitution)?;
                    text.extend_from_slice(self.text_of_primitive(value));
                    text.extend_from_slice(raw.get(i + 1)?);
                }
                Primitive::String(self.atoms().intern(&text))
            }
            ExprKind::Ident(name) if self.names_global_constant(file, e, name) => match self.atoms().bytes(name) {
                b"NaN" => Primitive::Number(f64::NAN),
                b"Infinity" => Primitive::Number(f64::INFINITY),
                _ => Primitive::Undefined,
            },
            ExprKind::Ident(name) => {
                let named = self.symbol_named_by(file, e, name)?;
                self.constant_held_by(named)?
            }
            ExprKind::Dot { obj, name, chain: Chain::No, .. } => {
                let ExprKind::Ident(object) = hir[obj].kind else { return None };
                let declared = self.symbol_named_by(file, obj, object).filter(|&declared| self.files().flags(declared).intersects(SymFlags::ENUM))?;
                let member = self.files().export(declared, name)?;
                let (of, member) = self.files().decls_of(member).iter().find_map(|&(of, decl)| match decl {
                    Decl::EnumMember(member) => Some((of, member)),
                    _ => None,
                })?;
                if self.is_member_of_declared_enum(declared, of, member) {
                    return None;
                }
                match self.enum_member_value(of, member)? {
                    EnumValue::Number(bits) => Primitive::Number(f64::from_bits(bits)),
                    EnumValue::String(text) => Primitive::String(text),
                }
            }
            ExprKind::Unary { op, operand } => match (op, self.constant_value_of(file, operand)?) {
                (UnOp::Not, value) => Primitive::Bool(match value {
                    Primitive::Undefined | Primitive::Null => true,
                    Primitive::Bool(value) => !value,
                    Primitive::Number(value) => value == 0.0 || value.is_nan(),
                    Primitive::String(text) => self.atoms().bytes(text).is_empty(),
                }),
                (UnOp::Minus, Primitive::Number(value)) => Primitive::Number(-value),
                (UnOp::Plus, Primitive::Number(value)) => Primitive::Number(value),
                (UnOp::BitNot, Primitive::Number(value)) => Primitive::Number(f64::from(!to_int32(value))),
                _ => return None,
            },
            ExprKind::Binary { op, left, right } => {
                let (a, b) = (self.constant_value_of(file, left)?, self.constant_value_of(file, right)?);
                let is_equality = matches!(op, BinOp::EqEq | BinOp::EqEqEq);
                if !is_equality && !matches!(op, BinOp::NotEq | BinOp::NotEqEq) {
                    return match (a, b) {
                        (Primitive::Number(a), Primitive::Number(b)) => number_operation(op, a, b).map(Primitive::Number).or(match op {
                            BinOp::Lt => Some(Primitive::Bool(a < b)),
                            BinOp::Le => Some(Primitive::Bool(a <= b)),
                            BinOp::Gt => Some(Primitive::Bool(a > b)),
                            BinOp::Ge => Some(Primitive::Bool(a >= b)),
                            _ => None,
                        }),
                        (Primitive::Number(_) | Primitive::String(_), Primitive::Number(_) | Primitive::String(_)) if op == BinOp::Add => {
                            let text = [self.text_of_primitive(a), self.text_of_primitive(b)].concat();
                            Some(Primitive::String(self.atoms().intern(&text)))
                        }
                        _ => None,
                    };
                }
                let are_equal = match (a, b) {
                    (Primitive::Number(a), Primitive::Number(b)) => a == b,
                    (Primitive::String(a), Primitive::String(b)) => a == b,
                    (Primitive::Bool(a), Primitive::Bool(b)) => a == b,
                    (Primitive::Undefined | Primitive::Null, Primitive::Undefined | Primitive::Null) => a == b || matches!(op, BinOp::EqEq | BinOp::NotEq),
                    _ => return None,
                };
                Primitive::Bool(are_equal == is_equality)
            }
            ExprKind::Satisfies { expr, .. } | ExprKind::AsConst(expr) => self.constant_value_of(file, expr)?,
            // To the type of primitives that it is of, which makes nothing of it.
            ExprKind::As { expr, ty } => match (self.constant_value_of(file, expr)?, hir[ty].kind) {
                (value @ Primitive::Number(_), TypeNodeKind::Keyword(Keyword::Number)) | (value @ Primitive::String(_), TypeNodeKind::Keyword(Keyword::String)) | (value @ Primitive::Bool(_), TypeNodeKind::Keyword(Keyword::Boolean)) => value,
                _ => return None,
            },
            _ => return None,
        })
    }

    /// ToString
    fn text_of_primitive(&self, value: Primitive) -> &'p [u8] {
        match value {
            Primitive::Undefined => b"undefined",
            Primitive::Null => b"null",
            Primitive::Bool(true) => b"true",
            Primitive::Bool(false) => b"false",
            Primitive::Number(value) => self.constant_text(EnumValue::Number(value.to_bits())),
            Primitive::String(text) => self.constant_text(EnumValue::String(text)),
        }
    }

    // ───────────────────────────── what a module does before any of its code can be called ─────────────────────────────

    /// Which module evaluates which. `modules`: all that are compiled with the program. Once for the program, whichever checker is told,
    /// before anything is asked. What is said after that changes nothing.
    pub fn set_module_graph(&self, modules: &[FileId], edges: &[(FileId, FileId, Evaluates)], has_top_level_await: bool) {
        self.p.aot.storage.modules.get_or_init(|| ModuleGraph::new(modules, edges, has_top_level_await));
    }

    pub fn set_logs_type_errors(&self, logs: bool) {
        self.p.aot.storage.logs_type_errors.get_or_init(|| logs);
    }

    pub fn logs_type_errors(&self) -> bool {
        self.p.aot.storage.logs_type_errors.get().copied().unwrap_or(false)
    }

    pub fn set_modules_put_off(&self, modules: &FxHashSet<FileId>) {
        self.p.aot.storage.put_off.get_or_init(|| modules.clone());
    }

    pub fn set_calls_marked_pure(&self, calls: FxHashMap<FileId, Vec<u32>>) {
        self.p.aot.storage.marked_pure.get_or_init(|| calls);
    }

    /// `--define` and what a build for one target defines. Once for the program, before anything is asked.
    pub fn set_replaced_by_primitives(&self, in_program: FxHashSet<Vec<u8>>, in_builtin_modules: FxHashSet<Vec<u8>>) {
        self.p.aot.storage.replaced.get_or_init(|| [in_program, in_builtin_modules]);
    }

    /// `a.b.c`, where nothing in the program declares `a`, that is not evaluated: a primitive stands in its place.
    fn is_replaced_by_primitive(&mut self, file: FileId, e: ExprId) -> bool {
        let p = self.p;
        let Some(replaced) = p.aot.storage.replaced.get() else { return false };
        let replaced = &replaced[usize::from(self.files().module(file).builtin.is_some())];
        if replaced.is_empty() {
            return false;
        }
        let hir = self.hir(file);
        let (mut names, mut at) = (Vec::new(), e);
        loop {
            match hir[at].kind {
                ExprKind::Dot { obj, name, chain: Chain::No, .. } => {
                    names.push(name);
                    at = obj;
                }
                ExprKind::Ident(name) => {
                    if self.bound(file).expr_symbol[at.idx()].is_some() || self.symbol_of_identifier(file, at, name).is_some_and(|found| self.hir(found.file).kind != FileKind::Declaration) {
                        return false;
                    }
                    names.push(name);
                    break;
                }
                _ => return false,
            }
        }
        let path = names.iter().rev().map(|&name| self.atoms().bytes(name)).collect::<Vec<_>>().join(&b'.');
        replaced.contains(&path)
    }

    /// Whether the file is a module that is compiled with the program. As long as nobody has said which are, none is.
    pub(super) fn is_compiled(&self, file: FileId) -> bool {
        self.hir(file).kind != FileKind::Declaration && self.p.aot.storage.modules.get().is_some_and(|modules| modules.cycle.contains_key(&file))
    }

    /// Whether the `let`, the `const` or the class, declared at the top level of a module, is initialized before any code runs that
    /// could refer to it. Up to the end of its declaration the body of the module runs no code of the program and cannot throw, and the
    /// body runs before any code of the modules that get at the module: see `ModuleGraph::puts_first`.
    pub fn is_initialized_before_any_code(&mut self, sym: Sym) -> bool {
        let Some((file, decl)) = self.declaration_of_variable(sym) else { return false };
        match self.dead_zone_of(file, decl) {
            Some((Site::File, end)) if end != 0 => end <= self.end_of_inert_prefix(file) && self.is_put_first(file) && !self.p.aot.storage.put_off.get().is_some_and(|put_off| put_off.contains(&file)),
            _ => false,
        }
    }

    /// Whether the body of the module may run when something it declares is first used, and not where the language has it run, without
    /// anybody being able to tell. All of it is inert; no code can look at the module before its body would have run; and it finds the
    /// same whenever it runs: of other modules it reads only constants, of the global object only what cannot be replaced, and it
    /// freezes nothing that another module has made. What the module's own code stores to later does not count: that code runs the body first.
    pub fn is_deferred_module(&mut self, file: FileId) -> bool {
        if let Some(&known) = self.aot.storage.deferred_modules.get(&file) {
            return known;
        }
        let is_deferred = self.is_put_first(file) && self.end_of_inert_prefix(file) == u32::MAX && self.is_timeless(file);
        self.aot.storage.deferred_modules.insert(file, is_deferred);
        is_deferred
    }

    /// Of a module that is inert: see `is_deferred_module`.
    fn is_timeless(&mut self, file: FileId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        (0..hir.exprs.len() as u32).map(ExprId).all(|e| {
            let ExprKind::Ident(name) = hir[e].kind else { return true };
            if matches!(bound.expr_parent[e.idx()], Parent::None) || bound.is_in_type_query(e) || self.enclosing_fn_of_expr(file, e).is_some() {
                return true;
            }
            if bound.expr_symbol[e.idx()].is_none() {
                return FIXED_GLOBALS.contains(&self.atoms().bytes(name));
            }
            let Some(sym) = self.symbol_named_by(file, e, name) else { return false };
            let is_operand_of_call = matches!(bound.expr_parent[e.idx()], Parent::Expr(parent) if matches!(hir[parent].kind, ExprKind::Call(_)));
            !matches!(self.declaration_of_variable(sym), Some((of, Decl::Var(_))) if of != file && (is_operand_of_call || !self.is_constant(sym)))
        })
    }

    /// `--aot-explain=deferred`: how many modules are evaluated before the first statement of an entry point runs, and how many stand behind a `require(..)` in a function or an `import(..)`. Numbers alone.
    pub fn explain_modules(&mut self, roots: &[FileId], modules: &[FileId]) -> Vec<String> {
        let Some(graph) = self.p.aot.storage.modules.get() else { return Vec::new() };
        let closure = |from: Vec<FileId>, follows: &dyn Fn(Evaluates) -> bool| {
            let (mut seen, mut pending) = (FxHashSet::default(), from);
            while let Some(module) = pending.pop() {
                if seen.insert(module) {
                    pending.extend(graph.evaluates.get(&module).into_iter().flatten().filter(|edge| follows(edge.1)).map(|edge| edge.0));
                }
            }
            seen
        };
        let at_start = closure(roots.to_vec(), &|how| matches!(how, Evaluates::First | Evaluates::InItsBody));
        let without_import_calls = closure(roots.to_vec(), &|how| !matches!(how, Evaluates::Later | Evaluates::LaterFromItsBody));
        let reached = closure(roots.to_vec(), &|_| true);
        let mut counts = [[0u32; 6]; 4];
        let mut does: FxHashMap<FileId, u32> = FxHashMap::default();
        for &file in modules {
            let hir = self.hir(file);
            if hir.kind == FileKind::Declaration {
                continue;
            }
            let module = self.files().module(file);
            let kind = match () {
                _ if module.builtin.is_some() => 4,
                _ if hir.kind == FileKind::Json => 3,
                _ if module.is_commonjs() => 2,
                _ if module.is_untyped() => 1,
                _ => 0,
            };
            let place = if at_start.contains(&file) { 0 } else if without_import_calls.contains(&file) { 1 } else if reached.contains(&file) { 2 } else { 3 };
            counts[place][kind] += 1;
            let mut statements = 0;
            if kind < 2 {
                for stmt in hir.ids(hir.body) {
                    statements += u32::from(self.obstacle_to_inertness(file, stmt).is_some());
                }
            }
            counts[place][5] += statements;
            if kind != 4 {
                does.insert(file, statements);
            }
        }
        let is_static = |how: Evaluates| matches!(how, Evaluates::First | Evaluates::InItsBody);
        let size_of = |members: &FxHashSet<FileId>| members.iter().filter_map(|module| does.get(module)).fold((0u32, 0u32), |sum, &statements| (sum.0 + 1, sum.1 + statements));
        let (mut evaluated, mut level, mut levels, mut targets): (FxHashSet<FileId>, _, Vec<String>, FxHashSet<FileId>) = (FxHashSet::default(), at_start, Vec::new(), FxHashSet::default());
        while !level.is_empty() {
            evaluated.extend(level.iter().copied());
            let doors: Vec<(FileId, Evaluates)> = level.iter().flat_map(|module| graph.evaluates.get(module).into_iter().flatten()).filter(|edge| !is_static(edge.1)).copied().collect();
            targets.extend(doors.iter().map(|door| door.0));
            let ((modules, statements), outside) = (size_of(&level), doors.iter().filter(|door| door.1 == Evaluates::LaterFromItsBody).count());
            levels.push(format!("{}: modules {modules}, statements {statements}, doors {} ({outside} outside every function)", levels.len(), doors.len()));
            level = closure(doors.into_iter().map(|door| door.0).collect(), &is_static).into_iter().filter(|module| !evaluated.contains(module)).collect();
        }
        let mut sizes: Vec<(u32, u32)> = targets.iter().map(|&target| size_of(&closure(vec![target], &is_static))).collect();
        sizes.sort_unstable_by(|a, b| b.cmp(a));
        let line = |what: &str, of: [u32; 6]| format!("deferred: modules {what} {}: typed {}, untyped {}, CommonJS {}, JSON {}, of the runtime {}", of[..5].iter().sum::<u32>(), of[0], of[1], of[2], of[3], of[4]);
        vec![
            line("at the start", counts[0]),
            line("behind require(..) in a function", counts[1]),
            line("behind import(..)", counts[2]),
            line("that no import of the program leads to", counts[3]),
            format!("deferred: statements that do something, in ES modules at the start {}, behind require(..) in a function {}, behind import(..) {}", counts[0][5], counts[1][5], counts[2][5]),
            format!("deferred: levels: {}", levels.join("; ")),
            format!("deferred: targets of a door {}: the largest by what they import without passing another door, modules / statements: {}", sizes.len(), sizes.iter().take(10).map(|size| format!("{} / {}", size.0, size.1)).collect::<Vec<_>>().join(", ")),
        ]
    }

    /// `--aot-explain=deferred`: how much of what the modules do when they are evaluated may be deferred, and what stands in the way. Numbers alone.
    pub fn explain_deferred(&mut self, modules: &[FileId]) -> Vec<String> {
        let [mut all, mut deferred, mut on_demand, mut not_first, mut not_inert, mut not_timeless] = [0u32; 6];
        let [mut statements, mut inert, mut in_prefix, mut in_deferred, mut where_first, mut in_inert_not_first] = [0u32; 6];
        let (mut first, mut every): (FxHashMap<&'static str, u32>, FxHashMap<&'static str, u32>) = Default::default();
        for &file in modules {
            let hir = self.hir(file);
            if self.files().module(file).builtin.is_some() || hir.kind == FileKind::Declaration {
                continue;
            }
            all += 1;
            if self.files().module(file).is_commonjs() || hir.kind == FileKind::Json {
                on_demand += 1;
                continue;
            }
            let (is_deferred, end, is_first_of_all) = (self.is_deferred_module(file), self.end_of_inert_prefix(file), self.is_put_first(file));
            match (is_deferred, end == u32::MAX, is_first_of_all) {
                (true, ..) => deferred += 1,
                (_, false, _) => not_inert += 1,
                (_, _, false) => not_first += 1,
                _ => not_timeless += 1,
            }
            let mut is_first = true;
            for stmt in hir.ids(hir.body) {
                let Some(obstacle) = self.obstacle_to_inertness(file, stmt) else { continue };
                statements += 1;
                match obstacle {
                    None => {
                        inert += 1;
                        in_prefix += u32::from(hir[stmt].loc.pos < end);
                        in_deferred += u32::from(is_deferred);
                        where_first += u32::from(is_first_of_all);
                        in_inert_not_first += u32::from(end == u32::MAX && !is_first_of_all);
                    }
                    Some(what) => {
                        *every.entry(what).or_default() += 1;
                        if std::mem::take(&mut is_first) {
                            *first.entry(what).or_default() += 1;
                        }
                    }
                }
            }
        }
        let [mut declarations, mut lazy] = [0u32; 2];
        for &file in modules {
            let hir = self.hir(file);
            if self.files().module(file).builtin.is_some() || hir.kind == FileKind::Declaration {
                continue;
            }
            for stmt in hir.ids(hir.body) {
                let StmtKind::Var(decls) = hir[stmt].kind else { continue };
                for d in decls.iter().filter(|&d| !hir[d].flags.contains(Flags::AMBIENT) && hir[d].init.is_some()) {
                    declarations += 1;
                    lazy += u32::from(self.declares_lazy_variable(file, d));
                }
            }
        }
        let by_count = |counts: FxHashMap<&'static str, u32>| {
            let mut counts: Vec<(&'static str, u32)> = counts.into_iter().collect();
            counts.sort_unstable_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(b.0)));
            counts.into_iter().map(|(what, count)| format!("{what} {count}")).collect::<Vec<_>>().join(", ")
        };
        vec![
            format!("deferred: modules {all}: deferred {deferred}, evaluated on demand anyway {on_demand}, not put first {not_first}, not inert {not_inert}, not timeless {not_timeless}"),
            format!("deferred: statements that do something {statements}: inert {inert}, of them where the module is put first {where_first}, in the inert prefix of their module {in_prefix}, in deferred modules {in_deferred}, in modules that are inert but not put first {in_inert_not_first}"),
            format!("deferred: first: {}", by_count(first)),
            format!("deferred: every: {}", by_count(every)),
            format!("deferred: top-level variables with an initializer {declarations}: lazy {lazy}"),
        ]
    }

    /// `None`: the statement does nothing when it runs. `Some(None)`: it is inert. Else what in it is not.
    fn obstacle_to_inertness(&mut self, file: FileId, stmt: StmtId) -> Option<Option<&'static str>> {
        let hir = self.hir(file);
        Some(match hir[stmt].kind {
            StmtKind::Empty
            | StmtKind::Interface(_)
            | StmtKind::TypeAlias(_)
            | StmtKind::Fn(_)
            | StmtKind::Enum(_)
            | StmtKind::Import(_)
            | StmtKind::ExportNamed(_)
            | StmtKind::ExportStar { .. }
            | StmtKind::ExportAsNamespace(_) => return None,
            StmtKind::Var(decls) => {
                if decls.iter().all(|d| hir[d].flags.contains(Flags::AMBIENT)) {
                    return None;
                }
                decls.iter().find_map(|d| match hir[hir[d].pat].kind {
                    PatKind::Ident(_) => (!self.is_inert(file, hir[d].init)).then(|| self.part_that_is_not_inert(file, hir[d].init)),
                    _ => Some("a pattern"),
                })
            }
            StmtKind::Expr(e) | StmtKind::ExportDefault(e) => (!self.is_inert(file, e)).then(|| self.part_that_is_not_inert(file, e)),
            StmtKind::Class(class) if hir[class].flags.contains(Flags::AMBIENT) => return None,
            StmtKind::Class(class) => (!self.is_inert_class(file, class)).then(|| self.part_of_class_that_is_not_inert(file, class)),
            StmtKind::Module(module) if hir[module].flags.contains(Flags::AMBIENT) => return None,
            StmtKind::Module(_) => Some("a namespace"),
            _ => Some("control flow"),
        })
    }

    fn part_that_is_not_inert(&mut self, file: FileId, e: ExprId) -> &'static str {
        let hir = self.hir(file);
        let parts: Vec<ExprId> = match hir[e].kind {
            ExprKind::Array(elements) => hir.ids(elements).collect(),
            ExprKind::Object(props) => props.iter().map(|p| hir[p].value).collect(),
            ExprKind::Cond { test, yes, no } => vec![test, yes, no],
            ExprKind::Binary { left, right, .. } => vec![left, right],
            ExprKind::Unary { operand: part, .. } | ExprKind::Satisfies { expr: part, .. } | ExprKind::AsConst(part) | ExprKind::As { expr: part, .. } => vec![part],
            _ => Vec::new(),
        };
        if let Some(part) = parts.into_iter().find(|&part| !self.is_inert(file, part)) {
            return self.part_that_is_not_inert(file, part);
        }
        match hir[e].kind {
            ExprKind::Call(call) | ExprKind::New(call) => {
                let label = self.label_of_callee(file, hir[call].callee, matches!(hir[e].kind, ExprKind::New(_)));
                match self.walked(file, e) {
                    _ if !matches!(label, "f(..): a typed function of the program" | "new C(..): a typed class of the program") => label,
                    Ok(_) => "walk: fine, but for names that may be early",
                    Err("") => label,
                    Err(why) => why,
                }
            }
            ExprKind::TaggedTemplate(_) => "a tagged template",
            ExprKind::Dot { .. } | ExprKind::Index { .. } => "a property read",
            ExprKind::Template { .. } => "a template",
            ExprKind::Spread(_) => "a spread",
            ExprKind::Assign { .. } => "an assignment",
            ExprKind::Await(_) => "await",
            ExprKind::As { .. } | ExprKind::NonNull(_) => "a cast",
            ExprKind::Ident(_) => "a name",
            ExprKind::Jsx(_) => "JSX",
            ExprKind::Object(_) => "a member of a literal",
            ExprKind::Class(class) => self.part_of_class_that_is_not_inert(file, class),
            ExprKind::ImportCall { .. } => "import(..)",
            ExprKind::ImportMeta => "import.meta",
            _ => "another expression",
        }
    }

    /// Whether the initializer of the variable may run when the variable is first read, and not where the language has it run, without
    /// anybody being able to tell.
    pub fn is_lazy_variable(&mut self, sym: Sym) -> bool {
        self.declaration_of_lazy_variable(sym).is_some()
    }

    /// Of a `const` at the top level of a module, bound by name, whose first use may come after the module has been evaluated. Its initializer is inert where it stands. It finds the same whenever it
    /// runs. And by its form it makes something, so the variable never holds `undefined` or `null`: those say in it that it is in its
    /// dead zone, or that its turn has come. Or its initializer is a call marked pure, which stands in for all three: `keeps_its_state_apart`.
    pub fn declaration_of_lazy_variable(&mut self, sym: Sym) -> Option<(FileId, VarDeclId)> {
        if let Some(&known) = self.aot.storage.lazy_variables.get(&sym) {
            return known;
        }
        let found = self.find_declaration_of_lazy_variable(sym);
        self.aot.storage.lazy_variables.insert(sym, found);
        found
    }

    fn find_declaration_of_lazy_variable(&mut self, sym: Sym) -> Option<(FileId, VarDeclId)> {
        let (file, Decl::Var(pat)) = self.files().value_declaration(sym)? else { return None };
        let PatParent::Var(d) = self.bound(file).pat_parent[pat.idx()] else { return None };
        self.declares_lazy_variable(file, d).then_some((file, d))
    }

    fn declares_lazy_variable(&mut self, file: FileId, d: VarDeclId) -> bool {
        if let Some(&known) = self.aot.storage.lazy_declarations.get(&(file, d)) {
            return known.unwrap_or(false);
        }
        self.aot.storage.lazy_declarations.insert((file, d), None);
        let found = self.has_initializer_that_may_run_later(file, d) && self.is_used_after_evaluation(file, d) && !self.is_used_during_evaluation(file, d);
        self.aot.storage.lazy_declarations.insert((file, d), Some(found));
        found
    }

    /// Whether the first use of the variable may come after its module has been evaluated. If nothing refers to it but the top-level code of
    /// the module, there is nothing to defer.
    fn is_used_after_evaluation(&mut self, file: FileId, d: VarDeclId) -> bool {
        let local = self.bound(file).symbol_of_declaration(Decl::Var(self.hir(file)[d].pat));
        let uses = self.uses_of_top_level(file);
        uses.later.contains(&local) || uses.in_initializers.iter().any(|&(named, by)| named == local && self.declares_lazy_variable(file, by))
    }

    /// Whether code that runs while the module is evaluated refers to the variable. Then its initializer runs at that time whatever is done, and whoever
    /// reads the variable later would test for nothing.
    fn is_used_during_evaluation(&mut self, file: FileId, d: VarDeclId) -> bool {
        let local = self.bound(file).symbol_of_declaration(Decl::Var(self.hir(file)[d].pat));
        let uses = self.uses_of_top_level(file);
        uses.during.contains(&local) || uses.in_initializers.iter().any(|&(named, by)| named == local && !self.declares_lazy_variable(file, by))
    }

    fn uses_of_top_level(&mut self, file: FileId) -> Rc<UsesOfTopLevel> {
        if let Some(known) = self.aot.storage.uses_of_top_level.get(&file) {
            return known.clone();
        }
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut uses = UsesOfTopLevel::default();
        for &e in self.exprs_by_kind_of(file).of(ExprTag::Ident) {
            let (symbol, mut parent) = (bound.expr_symbol[e.idx()], bound.expr_parent[e.idx()]);
            if symbol.is_none() || parent == Parent::None || bound.is_in_type_query(e) {
                continue;
            }
            // `export default a`: other modules read `a`.
            if matches!(parent, Parent::Stmt(stmt) if matches!(hir[stmt].kind, StmtKind::ExportDefault(_))) {
                uses.later.insert(symbol);
                continue;
            }
            loop {
                parent = match parent {
                    Parent::Expr(outer) if outer.is_some() => bound.expr_parent[outer.idx()],
                    Parent::Stmt(stmt) if stmt.is_some() => bound.stmt_parent[stmt.idx()],
                    Parent::FnBody(_) | Parent::ParamDefault(_) => {
                        uses.later.insert(symbol);
                        break;
                    }
                    Parent::MemberInit(member) if !hir[member].flags.contains(Flags::STATIC) => {
                        uses.later.insert(symbol);
                        break;
                    }
                    Parent::VarInit(by) if matches!(bound.stmt_parent[bound.var_stmt[by.idx()].idx()], Parent::File) => {
                        uses.in_initializers.push((symbol, by));
                        break;
                    }
                    Parent::File => {
                        uses.during.insert(symbol);
                        break;
                    }
                    Parent::None => break,
                    _ => self.parent_of_node(file, parent),
                };
            }
        }
        // `export const a`: the declaration and whoever names it go by the symbol of the export.
        for symbol in bound.symbols.iter().filter(|symbol| symbol.flags.contains(SymFlags::EXPORT_VALUE) && symbol.export_symbol.is_some()) {
            uses.later.insert(symbol.export_symbol);
        }
        for (i, export) in hir.exports.iter().enumerate().filter(|export| export.1.spec.is_none()) {
            for item in export.items.iter() {
                if let Some(exported) = self.files().resolve_name(file, bound.export_scope[i], hir[item].local, SymFlags::VALUE)
                    && exported.file == file
                {
                    uses.later.insert(exported.id);
                }
            }
        }
        let uses = Rc::new(uses);
        self.aot.storage.uses_of_top_level.insert(file, uses.clone());
        uses
    }

    fn has_initializer_that_may_run_later(&mut self, file: FileId, d: VarDeclId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let stmt = bound.var_stmt[d.idx()];
        hir[d].kind == VarKind::Const
            && !hir[d].flags.contains(Flags::AMBIENT)
            && matches!(hir[hir[d].pat].kind, PatKind::Ident(_))
            && stmt.is_some()
            && matches!(hir[stmt].kind, StmtKind::Var(_))
            && matches!(bound.stmt_parent[stmt.idx()], Parent::File)
            && self.files().module(file).is_module()
            && (self.may_run_later_by_its_form(file, hir[d].init) || self.is_licensed_to_run_later(file, hir[d].init))
    }

    fn may_run_later_by_its_form(&mut self, file: FileId, e: ExprId) -> bool {
        self.may_run_later_as_it_is_written(file, e) || self.walked(file, e).is_ok_and(|walked| walked.is_object)
    }

    fn may_run_later_as_it_is_written(&mut self, file: FileId, e: ExprId) -> bool {
        self.makes_something(file, e) && self.is_inert(file, e) && self.finds_the_same_whenever(file, e)
    }

    fn is_licensed_to_run_later(&mut self, file: FileId, e: ExprId) -> bool {
        let hir = self.hir(file);
        match hir[e].kind {
            ExprKind::Satisfies { expr, .. } | ExprKind::AsConst(expr) | ExprKind::As { expr, .. } | ExprKind::NonNull(expr) => self.is_licensed_to_run_later(file, expr),
            ExprKind::Call(call) | ExprKind::New(call) => {
                hir[call].chain == Chain::No
                    && self.p.aot.storage.marked_pure.get().and_then(|marked| marked.get(&file)).is_some_and(|calls| calls.binary_search(&e.0).is_ok())
                    && self.is_callee_there_whenever(file, hir[call].callee)
                    && hir.ids(hir[call].args).all(|argument| {
                        !matches!(hir[argument].kind, ExprKind::Spread(_)) && (self.is_licensed_to_run_later(file, argument) || self.is_inert(file, argument) && self.finds_the_same_whenever(file, argument))
                    })
            }
            _ => false,
        }
    }

    fn is_callee_there_whenever(&mut self, file: FileId, callee: ExprId) -> bool {
        let hir = self.hir(file);
        match hir[callee].kind {
            ExprKind::Ident(name) => self.is_inert(file, callee) && self.names_the_same_whenever(file, callee, name),
            ExprKind::Dot { obj, chain: Chain::No, .. } => self.is_callee_there_whenever(file, obj),
            ExprKind::Fn(_) => true,
            _ => false,
        }
    }

    pub fn keeps_its_state_apart(&mut self, sym: Sym) -> bool {
        let Some((file, d)) = self.declaration_of_lazy_variable(sym) else { return false };
        let hir = self.hir(file);
        let mut e = hir[d].init;
        while let ExprKind::Satisfies { expr, .. } | ExprKind::AsConst(expr) | ExprKind::As { expr, .. } | ExprKind::NonNull(expr) = hir[e].kind {
            e = expr;
        }
        self.p.aot.storage.marked_pure.get().and_then(|marked| marked.get(&file)).is_some_and(|calls| calls.binary_search(&e.0).is_ok())
    }

    pub fn marked_initializers_of(&mut self, file: FileId) -> (u32, u32) {
        let hir = self.hir(file);
        let Some(calls) = self.p.aot.storage.marked_pure.get().and_then(|marked| marked.get(&file)) else { return (0, 0) };
        let (mut marked, mut lazy) = (0, 0);
        for stmt in hir.ids(hir.body) {
            let StmtKind::Var(decls) = hir[stmt].kind else { continue };
            for d in decls.iter().filter(|&d| hir[d].init.is_some()) {
                let mut e = hir[d].init;
                while let ExprKind::Satisfies { expr, .. } | ExprKind::AsConst(expr) | ExprKind::As { expr, .. } | ExprKind::NonNull(expr) = hir[e].kind {
                    e = expr;
                }
                if calls.binary_search(&e.0).is_ok() {
                    marked += 1;
                    lazy += u32::from(self.declares_lazy_variable(file, d));
                }
            }
        }
        (marked, lazy)
    }

    pub fn runs_code_when_initialized(&mut self, sym: Sym) -> bool {
        self.reaches_what_is_licensed(sym, &mut Vec::new())
    }

    fn reaches_what_is_licensed(&mut self, sym: Sym, seen: &mut Vec<VarDeclId>) -> bool {
        let Some((file, d)) = self.declaration_of_lazy_variable(sym) else { return false };
        if seen.contains(&d) {
            return false;
        }
        seen.push(d);
        let initializer = self.hir(file)[d].init;
        if !self.may_run_later_by_its_form(file, initializer) {
            return true;
        }
        let uses = self.uses_of_top_level(file);
        uses.in_initializers.iter().any(|&(named, by)| by == d && self.reaches_what_is_licensed(Sym { file, id: named }, seen))
    }

    /// Going by how the expression is written, not by its type: it yields an object or a string.
    fn makes_something(&mut self, file: FileId, e: ExprId) -> bool {
        let hir = self.hir(file);
        match hir[e].kind {
            ExprKind::Object(_) | ExprKind::Array(_) | ExprKind::Fn(_) | ExprKind::New(_) | ExprKind::Regex | ExprKind::String(_) => true,
            ExprKind::Template { exprs } => exprs.is_empty(),
            ExprKind::Satisfies { expr, .. } | ExprKind::AsConst(expr) | ExprKind::As { expr, .. } => self.makes_something(file, expr),
            // Of the calls that are inert `Object.freeze(..)` yields its argument, `Object.entries(..)` and the like an array.
            ExprKind::Call(call) => match self.calls_what_only_makes(file, call) {
                Some((of, func)) => match self.hir(of)[func].body {
                    FnBody::Expr(returned) => self.makes_something(of, returned),
                    FnBody::Block(statements) => self.hir(of).ids(statements).last().is_some_and(|last| matches!(self.hir(of)[last].kind, StmtKind::Return(returned) if self.makes_something(of, returned))),
                    FnBody::None => false,
                },
                None => match self.walked(file, e) {
                    Ok(walked) => walked.is_object,
                    Err(_) => hir[call].args.len() == 1 && hir.ids(hir[call].args).all(|argument| self.makes_something(file, argument)),
                },
            },
            _ => false,
        }
    }

    /// Of an expression that is inert: whatever it names stands for the same at all times, and it changes nothing that is there already.
    fn finds_the_same_whenever(&mut self, file: FileId, e: ExprId) -> bool {
        if e.is_none() {
            return true;
        }
        let hir = self.hir(file);
        match hir[e].kind {
            ExprKind::Ident(name) => self.names_the_same_whenever(file, e, name),
            ExprKind::Array(elements) => hir.ids(elements).all(|element| self.finds_the_same_whenever(file, element)),
            ExprKind::Object(props) => props.iter().all(|p| self.finds_the_same_whenever(file, hir[p].value)),
            ExprKind::Class(class) => {
                let extends = hir[class].extends;
                (extends.is_none() || matches!(hir[extends].kind, ExprKind::Ident(name) if self.bound(file).expr_symbol[extends.idx()].is_none() || self.names_class_or_function(file, extends, name, false)))
                    && self.finds_the_same_whenever(file, extends)
                    && hir[class].members.iter().all(|member| hir[member].kind != MemberKind::Property || !hir[member].flags.contains(Flags::STATIC) || self.finds_the_same_whenever(file, hir[member].init))
            }
            ExprKind::New(call) => self.walked(file, e).is_ok() || self.finds_the_same_whenever(file, hir[call].callee) && hir.ids(hir[call].args).all(|argument| self.finds_the_same_whenever(file, argument)),
            // What `Object.freeze` freezes it has made itself. A function that only makes something keeps what an argument stands for and looks at nothing in it.
            ExprKind::Call(call) => {
                let only_makes = self.calls_what_only_makes(file, call).is_some();
                self.walked(file, e).is_ok() || hir.ids(hir[call].args).all(|argument| (only_makes || self.makes_something(file, argument)) && self.finds_the_same_whenever(file, argument))
            }
            ExprKind::Unary { operand, .. } => self.finds_the_same_whenever(file, operand),
            ExprKind::Binary { left, right, .. } => self.finds_the_same_whenever(file, left) && self.finds_the_same_whenever(file, right),
            ExprKind::Cond { test, yes, no } => self.finds_the_same_whenever(file, test) && self.finds_the_same_whenever(file, yes) && self.finds_the_same_whenever(file, no),
            ExprKind::Satisfies { expr, .. } | ExprKind::AsConst(expr) | ExprKind::As { expr, .. } => self.finds_the_same_whenever(file, expr),
            // The code of a function runs when it is called, as ever. A member of an enum is a constant.
            _ => true,
        }
    }

    fn names_the_same_whenever(&mut self, file: FileId, e: ExprId, name: Atom) -> bool {
        if self.bound(file).expr_symbol[e.idx()].is_none() {
            return FIXED_GLOBALS.contains(&self.atoms().bytes(name));
        }
        let Some(sym) = self.symbol_named_by(file, e, name) else { return false };
        match self.declaration_of_variable(sym) {
            Some((_, Decl::Var(_))) => self.is_constant(sym),
            Some((of, decl @ (Decl::Fn(_) | Decl::Class(_)))) => {
                let local = self.bound(of).symbol_of_declaration(decl);
                local.is_some() && self.bound(of).assignments_to(local).is_empty() && !self.is_stored_through_casts(of, local)
            }
            Some((_, Decl::Enum(_))) => true,
            _ => false,
        }
    }

    fn label_of_callee(&mut self, file: FileId, callee: ExprId, is_new: bool) -> &'static str {
        let hir = self.hir(file);
        let pick = |call: &'static str, new: &'static str| if is_new { new } else { call };
        match hir[callee].kind {
            ExprKind::Ident(name) => {
                if self.bound(file).expr_symbol[callee.idx()].is_none() {
                    return match self.atoms().bytes(name) {
                        b"Map" | b"Set" | b"WeakMap" | b"WeakSet" if is_new => "new <collection>(..) with arguments",
                        b"Error" | b"TypeError" | b"RangeError" | b"SyntaxError" | b"ReferenceError" | b"EvalError" | b"URIError" | b"AggregateError" if is_new => "new <error>(..)",
                        _ => pick("f(..): a global", "new C(..): another global"),
                    };
                }
                let Some(sym) = self.symbol_named_by(file, callee, name) else { return pick("f(..): not resolved", "new C(..): not resolved") };
                let Some((of, decl)) = self.declaration_of_variable(sym) else { return pick("f(..): not resolved", "new C(..): not resolved") };
                if self.hir(of).kind == FileKind::Declaration {
                    return pick("f(..): of a module that is only declared", "new C(..): of a module that is only declared");
                }
                let is_untyped = self.files().module(of).is_untyped();
                let known = match decl {
                    Decl::Fn(_) | Decl::Class(_) => true,
                    Decl::Var(pat) => matches!(root_declaration(self.bound(of), pat), PatParent::Var(d) if self.hir(of)[d].kind == VarKind::Const && self.hir(of)[d].pat == pat && matches!(self.hir(of)[self.hir(of)[d].init].kind, ExprKind::Fn(_) | ExprKind::Class(_))),
                    Decl::Param(_) => return pick("f(..): a parameter", "new C(..): a parameter"),
                    _ => false,
                };
                match (known, is_untyped) {
                    (true, false) => pick("f(..): a typed function of the program", "new C(..): a typed class of the program"),
                    (true, true) => pick("f(..): an untyped function of the program", "new C(..): an untyped class of the program"),
                    (false, false) => pick("f(..): a variable of typed code", "new C(..): a variable of typed code"),
                    (false, true) => pick("f(..): a variable of untyped code", "new C(..): a variable of untyped code"),
                }
            }
            ExprKind::Dot { obj, .. } => match hir[obj].kind {
                ExprKind::Ident(name) => {
                    if self.bound(file).expr_symbol[obj.idx()].is_none() {
                        return pick("o.m(..): on a global", "new o.C(..): on a global");
                    }
                    let Some(sym) = self.symbol_named_by(file, obj, name) else { return pick("o.m(..): not resolved", "new o.C(..): not resolved") };
                    let declared = self.files().value_declaration(sym);
                    let Some((of, decl)) = declared else { return pick("o.m(..): not resolved", "new o.C(..): not resolved") };
                    if self.hir(of).kind == FileKind::Declaration {
                        return pick("o.m(..): on a module or value that is only declared", "new o.C(..): on a module or value that is only declared");
                    }
                    let is_untyped = self.files().module(of).is_untyped();
                    match (decl, is_untyped) {
                        (Decl::File | Decl::Module(_), false) => pick("o.m(..): on a namespace of typed code", "new o.C(..): on a namespace of typed code"),
                        (Decl::File | Decl::Module(_), true) => pick("o.m(..): on a namespace of untyped code", "new o.C(..): on a namespace of untyped code"),
                        (Decl::Class(_), false) => pick("o.m(..): on a typed class", "new o.C(..): on a typed class"),
                        (Decl::Class(_), true) => pick("o.m(..): on an untyped class", "new o.C(..): on an untyped class"),
                        (_, false) => pick("o.m(..): on a variable of typed code", "new o.C(..): on a variable of typed code"),
                        (_, true) => pick("o.m(..): on a variable of untyped code", "new o.C(..): on a variable of untyped code"),
                    }
                }
                ExprKind::Call(_) | ExprKind::New(_) => pick("o.m(..): on the result of a call", "new o.C(..): on the result of a call"),
                ExprKind::Dot { .. } => pick("o.m(..): on a property", "new o.C(..): on a property"),
                _ => pick("o.m(..): on something else", "new o.C(..): on something else"),
            },
            ExprKind::Fn(_) => pick("a function that is called where it stands", "another new"),
            _ => pick("another call", "another new"),
        }
    }

    fn part_of_class_that_is_not_inert(&mut self, file: FileId, class: ClassId) -> &'static str {
        let hir = self.hir(file);
        let is_decorated = |modifiers: Span<ModifierId>| modifiers.iter().any(|modifier| matches!(hir[modifier].kind, ModifierKind::Decorator(_)));
        let extends = hir[class].extends;
        if is_decorated(hir[class].modifiers) || hir[class].members.iter().any(|member| is_decorated(hir[member].modifiers)) {
            return "a class: a decorator";
        }
        if extends.is_some() && !matches!(hir[extends].kind, ExprKind::Ident(name) if self.is_inert_name(file, extends, name) || self.names_global(file, extends, name)) {
            return if matches!(hir[extends].kind, ExprKind::Ident(_)) { "a class: extends a name that is not inert" } else { "a class: extends an expression" };
        }
        for member in hir[class].members.iter() {
            let m = &hir[member];
            if matches!(m.key, PropKey::Computed(_)) {
                return "a class: a computed key";
            }
            if m.kind == MemberKind::StaticBlock {
                return "a class: a static block";
            }
            if m.flags.contains(Flags::ACCESSOR) {
                return "a class: an `accessor`";
            }
            if m.kind == MemberKind::Property && m.flags.contains(Flags::STATIC) && !self.is_inert(file, m.init) {
                return "a class: a static field that is not inert";
            }
        }
        "a class"
    }

    pub fn is_default_export_as_good_as_binding(&mut self, file: FileId, e: ExprId, sym: Sym) -> bool {
        if self.is_put_first(file) && !self.p.aot.storage.put_off.get().is_some_and(|put_off| put_off.contains(&file)) {
            return true;
        }
        let (hir, bound) = (self.hir(file), self.bound(file));
        let Parent::Stmt(export) = bound.expr_parent[e.idx()] else { return false };
        let from = match self.declaration_of_variable(sym) {
            Some((of, decl @ (Decl::Var(_) | Decl::Class(_)))) if of == file => match self.dead_zone_of(file, decl) {
                Some((Site::File, end)) if end != u32::MAX => end,
                _ => return false,
            },
            Some((of, Decl::Fn(_))) if of == file => 0,
            _ => return false,
        };
        let to = hir[export].loc.pos;
        for stmt in hir.ids(hir.body) {
            let at = hir[stmt].loc;
            if at.pos >= to || at.end <= from {
                continue;
            }
            let is_inert = match hir[stmt].kind {
                StmtKind::Var(decls) => decls.iter().filter(|&d| hir[d].loc.pos >= from).all(|d| matches!(hir[hir[d].pat].kind, PatKind::Ident(_)) && self.is_inert(file, hir[d].init)),
                _ if at.pos < from => true,
                _ => self.is_inert_statement(file, stmt),
            };
            if !is_inert {
                return false;
            }
        }
        from <= to
    }

    fn is_put_first(&self, module: FileId) -> bool {
        let shared = &self.p.aot.storage;
        shared.modules.get().is_some_and(|modules| *shared.put_first.get_or_init(self.p.files.modules.len(), module, || modules.puts_first(module)))
    }

    /// Where in the text of the module the first statement of its top level, or the first declaration of a `const` or `let` statement,
    /// starts that is not inert: it may run code of the program, or throw.
    fn end_of_inert_prefix(&mut self, file: FileId) -> u32 {
        if let Some(&known) = self.aot.storage.inert_prefixes.borrow().get(&file) {
            return known;
        }
        self.aot.storage.inert_prefixes.borrow_mut().insert(file, 0);
        let hir = self.hir(file);
        let mut end = u32::MAX;
        'statements: for stmt in hir.ids(hir.body) {
            match hir[stmt].kind {
                StmtKind::Var(decls) => {
                    for d in decls.iter() {
                        let is_inert = hir[d].flags.contains(Flags::AMBIENT)
                            || matches!(hir[d].kind, VarKind::Var | VarKind::Let | VarKind::Const) && matches!(hir[hir[d].pat].kind, PatKind::Ident(_)) && self.is_inert(file, hir[d].init);
                        if !is_inert {
                            end = hir[d].loc.pos;
                            break 'statements;
                        }
                    }
                }
                _ if self.is_inert_statement(file, stmt) => {}
                _ => {
                    end = hir[stmt].loc.pos;
                    break;
                }
            }
        }
        self.aot.storage.inert_prefixes.borrow_mut().insert(file, end);
        end
    }

    pub fn is_wholly_inert(&mut self, file: FileId) -> bool {
        self.end_of_inert_prefix(file) == u32::MAX
    }

    pub fn runs_before_whoever_imports_it(&self, file: FileId) -> bool {
        self.is_put_first(file)
    }

    pub fn is_in_a_cycle_of_imports(&self, file: FileId) -> bool {
        self.p.aot.storage.modules.get().is_some_and(|modules| modules.in_cycles.contains(&file))
    }

    fn is_inert_statement(&mut self, file: FileId, stmt: StmtId) -> bool {
        let hir = self.hir(file);
        match hir[stmt].kind {
            StmtKind::Empty
            | StmtKind::Interface(_)
            | StmtKind::TypeAlias(_)
            | StmtKind::Fn(_)
            | StmtKind::Import(_)
            | StmtKind::ExportNamed(_)
            | StmtKind::ExportStar { .. }
            | StmtKind::ExportAsNamespace(_) => true,
            StmtKind::Expr(e) | StmtKind::ExportDefault(e) => self.is_inert(file, e),
            StmtKind::Class(class) => hir[class].flags.contains(Flags::AMBIENT) || self.is_inert_class(file, class),
            StmtKind::Enum(declared) => hir[declared].flags.intersects(Flags::AMBIENT | Flags::CONST) || self.has_primitive_members(file, declared),
            StmtKind::Module(module) => hir[module].flags.contains(Flags::AMBIENT),
            _ => false,
        }
    }

    fn has_primitive_members(&mut self, file: FileId, declared: EnumId) -> bool {
        let hir = self.hir(file);
        hir[declared].members.iter().all(|member| hir[member].computed_name.is_none() && (hir[member].init.is_none() || self.yields_primitive(file, hir[member].init)))
    }

    /// The definition of the class runs nothing but the engine: no decorator, no computed key, no static block, and what it extends and
    /// what its static fields start as is inert.
    fn is_inert_class(&mut self, file: FileId, class: ClassId) -> bool {
        let hir = self.hir(file);
        let is_decorated = |modifiers: Span<ModifierId>| modifiers.iter().any(|modifier| matches!(hir[modifier].kind, ModifierKind::Decorator(_)));
        let extends = hir[class].extends;
        !is_decorated(hir[class].modifiers)
            && (extends.is_none() || matches!(hir[extends].kind, ExprKind::Ident(name) if self.is_inert_name(file, extends, name) && self.names_class_or_function(file, extends, name, true) || self.names_global(file, extends, name)))
            && hir[class].members.iter().all(|member| {
                let m = &hir[member];
                !is_decorated(m.modifiers)
                    && !matches!(m.key, PropKey::Computed(_))
                    && m.kind != MemberKind::StaticBlock
                    && !m.flags.contains(Flags::ACCESSOR)
                    && (m.kind != MemberKind::Property || !m.flags.contains(Flags::STATIC) || self.is_inert(file, m.init))
            })
    }

    fn names_class_or_function(&mut self, file: FileId, e: ExprId, name: Atom, or_function: bool) -> bool {
        let Some(sym) = self.symbol_named_by(file, e, name) else { return false };
        match self.declaration_of_variable(sym) {
            Some((_, Decl::Class(_))) => true,
            Some((_, Decl::Fn(_))) => or_function,
            _ => self.class_held_by_constant(sym).is_some(),
        }
    }

    fn makes_typed_array(&self, file: FileId, e: ExprId) -> bool {
        let hir = self.hir(file);
        match hir[e].kind {
            ExprKind::Satisfies { expr, .. } | ExprKind::AsConst(expr) | ExprKind::As { expr, .. } => self.makes_typed_array(file, expr),
            ExprKind::New(call) => matches!(hir[hir[call].callee].kind, ExprKind::Ident(name) if self.atoms().bytes(name).len() > 5 && self.atoms().bytes(name).ends_with(b"Array")),
            ExprKind::Call(_) => true,
            ExprKind::Cond { yes, no, .. } => self.makes_typed_array(file, yes) || self.makes_typed_array(file, no),
            ExprKind::Binary { left, right, .. } => self.makes_typed_array(file, left) || self.makes_typed_array(file, right),
            _ => false,
        }
    }

    /// Whether evaluating the expression, at the top level of its module, runs no code of the program and cannot throw. `NONE` is.
    fn is_inert(&mut self, file: FileId, e: ExprId) -> bool {
        if e.is_none() {
            return true;
        }
        if self.is_half_of_stack_in_use() {
            return false;
        }
        let hir = self.hir(file);
        match hir[e].kind {
            ExprKind::Missing | ExprKind::Null | ExprKind::True | ExprKind::False | ExprKind::Number(_) | ExprKind::String(_) | ExprKind::BigInt(_) | ExprKind::Regex | ExprKind::Fn(_) => true,
            ExprKind::Template { exprs } => exprs.is_empty(),
            ExprKind::Ident(name) => self.names_global_constant(file, e, name) || self.is_inert_name(file, e, name),
            ExprKind::Array(elements) => hir.ids(elements).all(|element| self.is_inert(file, element)),
            // One with an accessor is no plain data: a place whose type is written down may refuse it.
            ExprKind::Object(props) => props.iter().all(|p| {
                matches!(hir[p].kind, PropKind::Init | PropKind::Shorthand | PropKind::Method)
                    && matches!(hir[p].key, PropKey::Name(name) if self.atoms().bytes(name) != b"__proto__")
                    && self.is_inert(file, hir[p].value)
            }),
            ExprKind::Class(class) => self.is_inert_class(file, class),
            ExprKind::New(call) => self.makes_object_of_engine(file, call) || self.is_walked_without_a_throw(file, e),
            // `Object.freeze(..)`
            ExprKind::Call(call) => {
                if self.lists_object_literal(file, call).is_some() || self.calls_what_only_makes(file, call).is_some() || self.is_walked_without_a_throw(file, e) {
                    return true;
                }
                let ExprKind::Dot { obj, name, chain: Chain::No, .. } = hir[hir[call].callee].kind else { return false };
                hir[call].chain == Chain::No
                    && self.atoms().bytes(name) == b"freeze"
                    && matches!(hir[obj].kind, ExprKind::Ident(object) if self.atoms().bytes(object) == b"Object" && self.names_global(file, obj, object))
                    && hir[call].args.len() == 1
                    && hir.ids(hir[call].args).all(|argument| self.is_inert(file, argument) && !self.makes_typed_array(file, argument))
            }
            ExprKind::Unary { op: UnOp::Not | UnOp::Typeof | UnOp::Void, operand } => self.is_inert(file, operand),
            ExprKind::Binary { op: BinOp::And | BinOp::Or | BinOp::Nullish | BinOp::Comma, left, right } => self.is_inert(file, left) && self.is_inert(file, right),
            ExprKind::Cond { test, yes, no } => self.is_inert(file, test) && self.is_inert(file, yes) && self.is_inert(file, no),
            ExprKind::Satisfies { expr, .. } | ExprKind::AsConst(expr) => self.is_inert(file, expr),
            // A cast to the type that the operand has does nothing.
            ExprKind::As { expr, ty } => self.is_inert(file, expr) && self.type_of_expr(file, expr) == self.type_from_node(file, ty),
            _ => self.yields_primitive(file, e),
        }
    }

    /// Whether the expression is inert and yields a number, a string, a boolean, `null` or `undefined`, going by how it is written. An
    /// operator on such neither calls anything nor throws.
    pub(super) fn yields_primitive(&mut self, file: FileId, e: ExprId) -> bool {
        if self.is_half_of_stack_in_use() {
            return false;
        }
        let hir = self.hir(file);
        match hir[e].kind {
            ExprKind::Null | ExprKind::True | ExprKind::False | ExprKind::Number(_) | ExprKind::String(_) => true,
            ExprKind::Template { exprs } => exprs.is_empty(),
            ExprKind::Ident(name) => self.names_global_constant(file, e, name) || self.is_inert_name(file, e, name) && self.constant_named_by(file, e, name).is_some_and(|(of, init)| self.yields_primitive(of, init)),
            ExprKind::Unary { op: UnOp::Not | UnOp::Typeof | UnOp::Void, operand } => self.is_inert(file, operand),
            ExprKind::Unary { op: UnOp::Minus | UnOp::Plus | UnOp::BitNot, operand } => self.yields_primitive(file, operand),
            ExprKind::Binary { op, left, right } => !matches!(op, BinOp::In | BinOp::Instanceof) && self.yields_primitive(file, left) && self.yields_primitive(file, right),
            ExprKind::Cond { test, yes, no } => self.is_inert(file, test) && self.yields_primitive(file, yes) && self.yields_primitive(file, no),
            ExprKind::Satisfies { expr, .. } | ExprKind::AsConst(expr) => self.yields_primitive(file, expr),
            ExprKind::Dot { .. } if self.is_replaced_by_primitive(file, e) => true,
            // A member of an enum, which is read as the constant it is.
            ExprKind::Dot { obj, chain: Chain::No, .. } => {
                let ExprKind::Ident(name) = hir[obj].kind else { return false };
                let Some(named) = self.symbol_named_by(file, obj, name) else { return false };
                self.files().flags(named).intersects(SymFlags::ENUM)
                    && self.files().decls_of(named).iter().all(|&(of, decl)| matches!(decl, Decl::Enum(declared) if self.has_primitive_members(of, declared)))
            }
            _ => false,
        }
    }

    /// What the name stands for, through imports.
    pub(super) fn symbol_named_by(&mut self, file: FileId, e: ExprId, name: Atom) -> Option<Sym> {
        let sym = self.symbol_of_identifier(file, e, name)?;
        if self.files().flags(sym).contains(SymFlags::ALIAS) { self.files().resolve_alias(sym) } else { Some(sym) }
    }

    /// `undefined`, `NaN`, `Infinity`: nothing can be stored to those of the global object.
    fn names_global_constant(&self, file: FileId, e: ExprId, name: Atom) -> bool {
        self.bound(file).expr_symbol[e.idx()].is_none() && matches!(self.atoms().bytes(name), b"undefined" | b"NaN" | b"Infinity")
    }

    /// Whether the name is that of a global that a declaration file declares and nothing in the program does.
    pub(super) fn names_global(&mut self, file: FileId, e: ExprId, name: Atom) -> bool {
        self.bound(file).expr_symbol[e.idx()].is_none() && self.symbol_of_identifier(file, e, name).is_some_and(|found| self.hir(found.file).kind == FileKind::Declaration)
    }

    /// Whether a read of the name, at the top level of its module after nothing but inert code, finds it initialized: a function
    /// declaration, what the module has declared further up, or what another module has initialized before any code runs. What is
    /// declared `any` or `unknown` may fail to fit where it goes, and so may the `undefined` of a variable without initializer, which
    /// the read of `let a!: T` throws for.
    fn is_inert_name(&mut self, file: FileId, e: ExprId, name: Atom) -> bool {
        let Some(sym) = self.symbol_named_by(file, e, name) else { return false };
        let Some((of, decl)) = self.declaration_of_variable(sym) else { return false };
        let hir = self.hir(of);
        if !self.p.aot.storage.modules.get().is_some_and(|modules| modules.cycle.contains_key(&of)) || self.bound(of).modifier_flags(hir, decl).contains(Flags::AMBIENT) {
            return false;
        }
        if let Decl::Var(pat) = decl
            && let PatParent::Var(d) = root_declaration(self.bound(of), pat)
            && (hir[d].init.is_none() || hir[d].ty.is_some() && matches!(hir[hir[d].ty].kind, TypeNodeKind::Keyword(Keyword::Any | Keyword::Unknown)))
        {
            return false;
        }
        match decl {
            Decl::Fn(_) => true,
            Decl::Var(_) | Decl::Class(_) if of == file => matches!(self.dead_zone_of(of, decl), Some((Site::File, end)) if end <= self.hir(file)[e].pos),
            // The import has to be one that the bundler has lead to the same module.
            Decl::Var(_) | Decl::Class(_) => {
                let is_imported = self.p.aot.storage.modules.get().is_some_and(|modules| modules.importers.get(&of).is_some_and(|importers| importers.contains(&file)));
                is_imported && self.is_initialized_before_any_code(sym)
            }
            _ => false,
        }
    }

    /// The initializer of the `const` that the name stands for.
    fn constant_named_by(&mut self, file: FileId, e: ExprId, name: Atom) -> Option<(FileId, ExprId)> {
        let sym = self.symbol_named_by(file, e, name)?;
        let (of, Decl::Var(pat)) = self.declaration_of_variable(sym)? else { return None };
        let hir = self.hir(of);
        let PatParent::Var(d) = root_declaration(self.bound(of), pat) else { return None };
        (hir[d].kind == VarKind::Const && hir[d].pat == pat && hir[d].init.is_some()).then_some((of, hir[d].init))
    }

    /// `f(a, b)`, where `f` only makes something of its parameters (`only_makes`) and the arguments are inert: the function.
    fn calls_what_only_makes(&mut self, file: FileId, call: CallId) -> Option<(FileId, FnId)> {
        let hir = self.hir(file);
        let ExprKind::Ident(name) = hir[hir[call].callee].kind else { return None };
        if hir[call].chain != Chain::No {
            return None;
        }
        let (of, func) = self.function_named_at_all_times(file, hir[call].callee, name)?;
        (self.only_makes(of, func) && hir.ids(hir[call].args).all(|argument| self.is_inert(file, argument))).then_some((of, func))
    }

    /// The function of the program that the name stands for from before any code runs: a declaration at the top level of a module, with a body, that nothing is stored to.
    fn function_named_at_all_times(&mut self, file: FileId, e: ExprId, name: Atom) -> Option<(FileId, FnId)> {
        if self.bound(file).expr_symbol[e.idx()].is_none() {
            return None;
        }
        let sym = self.symbol_named_by(file, e, name)?;
        let (of, decl @ Decl::Fn(func)) = self.declaration_of_variable(sym)? else { return None };
        let (hir, bound) = (self.hir(of), self.bound(of));
        let local = bound.symbol_of_declaration(decl);
        (hir.kind != FileKind::Declaration
            && self.is_compiled(of)
            && hir[func].kind == FnKind::Decl
            && !matches!(hir[func].body, FnBody::None)
            && bound.fns[func.idx()].enclosing.is_none()
            && local.is_some()
            && bound.symbols[local.idx()].decls.len() == 1
            && bound.assignments_to(local).is_empty()
            && !self.is_stored_through_casts(of, local))
        .then_some((of, func))
    }

    /// Whether a call of the function sees nothing but its arguments, changes nothing but what it makes, runs no other code than functions of which the same holds, and cannot
    /// throw. Going by its text: `const` locals and one `return`, of values as `only_makes_value` admits them.
    fn only_makes(&mut self, file: FileId, func: FnId) -> bool {
        if let Some(&known) = self.aot.storage.only_makes.get(&(file, func)) {
            return known.unwrap_or(false);
        }
        self.aot.storage.only_makes.insert((file, func), None);
        let hir = self.hir(file);
        let f = &hir[func];
        let has_plain_parameters = f.params.iter().all(|p| {
            matches!(hir[hir[p].pat].kind, PatKind::Ident(_)) && !hir[p].flags.contains(Flags::REST) && self.only_makes_value(file, func, hir[p].default)
        });
        let found = has_plain_parameters
            && !f.flags.intersects(Flags::ASYNC | Flags::GENERATOR)
            && f.this_param.is_none()
            && match f.body {
                FnBody::Expr(returned) => self.only_makes_value(file, func, returned),
                FnBody::Block(statements) => {
                    let all: Vec<StmtId> = hir.ids(statements).collect();
                    all.split_last().is_some_and(|(&last, before)| {
                        before.iter().all(|&stmt| {
                            matches!(hir[stmt].kind, StmtKind::Var(decls) if decls.iter().all(|d| {
                                hir[d].kind == VarKind::Const && matches!(hir[hir[d].pat].kind, PatKind::Ident(_)) && hir[d].init.is_some() && self.only_makes_value(file, func, hir[d].init)
                            }))
                        }) && matches!(hir[last].kind, StmtKind::Return(returned) if self.only_makes_value(file, func, returned))
                    })
                }
                FnBody::None => false,
            };
        self.aot.storage.only_makes.insert((file, func), Some(found));
        found
    }

    /// Of an expression in the function `func`: see `only_makes`.
    fn only_makes_value(&mut self, file: FileId, func: FnId, e: ExprId) -> bool {
        if e.is_none() {
            return true;
        }
        if self.is_half_of_stack_in_use() {
            return false;
        }
        let hir = self.hir(file);
        match hir[e].kind {
            ExprKind::Null | ExprKind::True | ExprKind::False | ExprKind::Number(_) | ExprKind::String(_) | ExprKind::BigInt(_) | ExprKind::Regex | ExprKind::Fn(_) => true,
            ExprKind::Template { exprs } => exprs.is_empty(),
            ExprKind::Ident(name) => self.names_global_constant(file, e, name) || self.is_bound_in(file, func, e) || self.function_named_at_all_times(file, e, name).is_some(),
            ExprKind::Array(elements) => hir.ids(elements).all(|element| self.only_makes_value(file, func, element)),
            ExprKind::Object(props) => props.iter().all(|p| {
                matches!(hir[p].kind, PropKind::Init | PropKind::Shorthand | PropKind::Method)
                    && matches!(hir[p].key, PropKey::Name(name) if self.atoms().bytes(name) != b"__proto__")
                    && self.only_makes_value(file, func, hir[p].value)
            }),
            ExprKind::Unary { op: UnOp::Not | UnOp::Typeof | UnOp::Void, operand } => self.only_makes_value(file, func, operand),
            ExprKind::Binary { op: BinOp::And | BinOp::Or | BinOp::Nullish | BinOp::Comma, left, right } => self.only_makes_value(file, func, left) && self.only_makes_value(file, func, right),
            ExprKind::Cond { test, yes, no } => self.only_makes_value(file, func, test) && self.only_makes_value(file, func, yes) && self.only_makes_value(file, func, no),
            ExprKind::Satisfies { expr, .. } | ExprKind::AsConst(expr) => self.only_makes_value(file, func, expr),
            ExprKind::Call(call) => {
                let ExprKind::Ident(name) = hir[hir[call].callee].kind else { return false };
                hir[call].chain == Chain::No
                    && self.function_named_at_all_times(file, hir[call].callee, name).is_some_and(|(of, called)| self.only_makes(of, called))
                    && hir.ids(hir[call].args).all(|argument| self.only_makes_value(file, func, argument))
            }
            ExprKind::New(call) => self.makes_object_of_engine(file, call),
            _ => false,
        }
    }

    fn walked(&mut self, file: FileId, e: ExprId) -> Result<WalkedAs, &'static str> {
        if let Some(known) = self.aot.storage.walked.get(&(file, e)) {
            return known.clone();
        }
        if self.is_half_of_stack_in_use() {
            return Err("walk: too long");
        }
        let asked = self.times_half_of_stack_was_in_use();
        self.aot.storage.walked.insert((file, e), Err("walk: itself"));
        let found = self.find_walked(file, e);
        if asked == self.times_half_of_stack_was_in_use() {
            self.aot.storage.walked.insert((file, e), found.clone());
        } else {
            self.aot.storage.walked.remove(&(file, e));
        }
        found
    }

    fn find_walked(&mut self, file: FileId, e: ExprId) -> Result<WalkedAs, &'static str> {
        if !self.is_walked_file(file) || self.site_of(file, self.bound(file).expr_parent[e.idx()]) != Some(Site::File) {
            return Err("");
        }
        let mut cx = Walk::new((file, self.hir(file)[e].pos));
        match self.walk(&mut cx, file, e) {
            Some(made) => Ok(WalkedAs { is_object: made.is_object(), found_initialized: cx.found_initialized.into() }),
            None => Err(cx.obstacle),
        }
    }

    fn is_walked_without_a_throw(&mut self, file: FileId, e: ExprId) -> bool {
        self.walked(file, e).is_ok_and(|walked| walked.found_initialized.is_empty())
    }

    fn is_walked_file(&self, file: FileId) -> bool {
        let module = self.files().module(file);
        self.is_compiled(file) && module.builtin.is_none() && module.is_module() && !module.is_commonjs() && !module.is_untyped()
    }

    pub fn names_found_initialized_where_declared(&mut self, sym: Sym) -> Rc<[Sym]> {
        let none = || Rc::from(Vec::new());
        let Some((file, d)) = self.declaration_of_lazy_variable(sym) else { return none() };
        let initializer = self.hir(file)[d].init;
        if self.may_run_later_as_it_is_written(file, initializer) || self.is_licensed_to_run_later(file, initializer) {
            return none();
        }
        self.walked(file, initializer).map_or_else(|_| none(), |walked| walked.found_initialized)
    }

    fn walk(&mut self, cx: &mut Walk, file: FileId, e: ExprId) -> Option<Walked> {
        if e.is_none() {
            return Some(Walked::Undefined);
        }
        cx.steps += 1;
        if cx.steps > MOST_STEPS_OF_A_WALK || cx.depth >= MOST_DEPTH_OF_A_WALK {
            return cx.stops("walk: too long");
        }
        cx.depth += 1;
        let walked = self.walk_expression(cx, file, e);
        cx.depth -= 1;
        walked
    }

    fn walk_expression(&mut self, cx: &mut Walk, file: FileId, e: ExprId) -> Option<Walked> {
        let hir = self.hir(file);
        match hir[e].kind {
            ExprKind::Null => Some(Walked::Null),
            ExprKind::True | ExprKind::False | ExprKind::Number(_) | ExprKind::String(_) => Some(Walked::VALUE),
            ExprKind::BigInt(_) => Some(Walked::Anything { may_be_nil: false }),
            ExprKind::Regex => Some(Walked::Object),
            ExprKind::Template { exprs } => {
                for part in hir.ids(exprs) {
                    if !self.walk(cx, file, part)?.is_primitive() {
                        return cx.stops("walk: a conversion of what may be an object");
                    }
                }
                Some(Walked::VALUE)
            }
            ExprKind::Ident(name) => self.walk_name(cx, file, e, name),
            ExprKind::This => {
                let by = self.enclosing_fn_of_expr(file, e).unwrap_or(FnId::NONE);
                match cx.running.last() {
                    Some(activation) if activation.function == (file, by) && activation.this.is_some() => activation.this,
                    _ => cx.stops("walk: this"),
                }
            }
            ExprKind::Fn(func) => Some(Walked::Function { file, func, within: cx.serial() }),
            ExprKind::Array(elements) => {
                let (mut held, mut holds_lists) = (None, true);
                for element in hir.ids(elements) {
                    let part = match hir[element].kind {
                        ExprKind::Missing => Some(Walked::Undefined),
                        ExprKind::Spread(list) => match self.walk(cx, file, list)? {
                            Walked::Made(it) if cx.made[it as usize].made_as == MadeAs::List => {
                                holds_lists &= cx.made[it as usize].holds_lists_made_there;
                                cx.made[it as usize].elements
                            }
                            _ => return cx.stops("walk: a spread of what is no list made there"),
                        },
                        _ => Some(self.walk(cx, file, element)?),
                    };
                    holds_lists &= matches!(hir[element].kind, ExprKind::Spread(_)) || part.is_some_and(|part| cx.is_list(part));
                    held = join_walked(held, part);
                }
                let list = cx.make(MadeAs::List, Vec::new(), held);
                cx.made.last_mut()?.holds_lists_made_there = holds_lists;
                Some(list)
            }
            ExprKind::Object(props) => {
                let mut fields = Vec::new();
                for p in props.iter() {
                    let prop = &hir[p];
                    match (prop.kind, prop.key) {
                        (PropKind::Init | PropKind::Shorthand | PropKind::Method, PropKey::Name(name)) if self.atoms().bytes(name) != b"__proto__" => {
                            let value = self.walk(cx, file, prop.value)?;
                            set_walked_field(&mut fields, name, value, true);
                        }
                        (PropKind::Spread, _) => self.walk_spread(cx, file, prop.value, &mut fields, true)?,
                        _ => return cx.stops("walk: a member of a literal"),
                    }
                }
                Some(cx.make(MadeAs::Record, fields, None))
            }
            ExprKind::Dot { .. } if self.yields_primitive(file, e) => Some(Walked::Primitive { may_be_nil: true }),
            ExprKind::Dot { obj, name, chain, .. } => {
                let on = self.walk(cx, file, obj)?;
                match on {
                    Walked::Undefined | Walked::Null if chain == Chain::Start => Some(Walked::Undefined),
                    Walked::Primitive { may_be_nil } if !may_be_nil || chain == Chain::Start => Some(if self.atoms().bytes(name) == b"length" { Walked::Primitive { may_be_nil: true } } else { Walked::Anything { may_be_nil: true } }),
                    _ => self.walk_read(cx, on, name),
                }
            }
            ExprKind::Call(call) => self.walk_call(cx, file, call),
            ExprKind::New(call) => self.walk_new(cx, file, call),
            ExprKind::Unary { op: UnOp::Not | UnOp::Typeof, operand } => {
                self.walk(cx, file, operand)?;
                Some(Walked::VALUE)
            }
            ExprKind::Unary { op: UnOp::Void, operand } => {
                self.walk(cx, file, operand)?;
                Some(Walked::Undefined)
            }
            ExprKind::Unary { op: UnOp::Minus | UnOp::Plus | UnOp::BitNot, operand } => {
                if !self.walk(cx, file, operand)?.is_primitive() {
                    return cx.stops("walk: a conversion of what may be an object");
                }
                Some(Walked::VALUE)
            }
            ExprKind::Unary { op: UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec, operand } => {
                let Some(at) = self.walk_variable(cx, file, operand) else { return cx.stops("walk: a store to a variable not its own") };
                if !cx.bound[at].1.is_primitive() {
                    return cx.stops("walk: a conversion of what may be an object");
                }
                cx.bound[at].1 = if cx.bound[at].2 == cx.doubts { Walked::VALUE } else { cx.bound[at].1.join(Walked::VALUE) };
                Some(Walked::VALUE)
            }
            ExprKind::Binary { op: BinOp::Comma, left, right } => {
                self.walk(cx, file, left)?;
                self.walk(cx, file, right)
            }
            ExprKind::Binary { op: op @ (BinOp::And | BinOp::Or | BinOp::Nullish), left, right } => {
                let first = self.walk(cx, file, left)?;
                self.walk_second_operand(cx, file, op, first, right)
            }
            ExprKind::Binary { op: BinOp::EqEqEq | BinOp::NotEqEq, left, right } => {
                self.walk(cx, file, left)?;
                self.walk(cx, file, right)?;
                Some(Walked::VALUE)
            }
            ExprKind::Binary { op: BinOp::In | BinOp::Instanceof, .. } => cx.stops("walk: in, instanceof"),
            ExprKind::Binary { op, left, right } => {
                let (a, b) = (self.walk(cx, file, left)?, self.walk(cx, file, right)?);
                let compares_with_nil = matches!(op, BinOp::EqEq | BinOp::NotEq) && (a.is_nil() || b.is_nil());
                if !compares_with_nil && !(a.is_primitive() && b.is_primitive()) {
                    return cx.stops("walk: a conversion of what may be an object");
                }
                Some(Walked::VALUE)
            }
            ExprKind::Assign { op, target, value } => self.walk_assignment(cx, file, op, target, value),
            ExprKind::Cond { test, yes, no } => match self.walk_test(cx, file, test)? {
                Some(true) => self.walk(cx, file, yes),
                Some(false) => self.walk(cx, file, no),
                None => {
                    cx.doubts += 1;
                    let (a, b) = (self.walk(cx, file, yes)?, self.walk(cx, file, no)?);
                    cx.doubts -= 1;
                    Some(a.join(b))
                }
            },
            ExprKind::Satisfies { expr, .. } | ExprKind::AsConst(expr) | ExprKind::Instantiation { expr, .. } => self.walk(cx, file, expr),
            ExprKind::As { expr, ty } => {
                let value = self.walk(cx, file, expr)?;
                if self.type_of_expr(file, expr) != self.type_from_node(file, ty) {
                    return cx.stops("walk: a cast");
                }
                Some(value)
            }
            ExprKind::NonNull(expr) => {
                let value = self.walk(cx, file, expr)?;
                if value.may_be_nil() {
                    return cx.stops("walk: ! on what may be nil");
                }
                Some(value)
            }
            ExprKind::Index { .. } => cx.stops("walk: a read by a key"),
            ExprKind::Class(_) => cx.stops("walk: a class expression"),
            ExprKind::TaggedTemplate(_) => cx.stops("walk: a tagged template"),
            ExprKind::Await(_) | ExprKind::Yield { .. } => cx.stops("walk: a coroutine"),
            ExprKind::Jsx(_) => cx.stops("walk: JSX"),
            ExprKind::ImportCall { .. } | ExprKind::ImportMeta => cx.stops("walk: import"),
            _ => cx.stops("walk: another expression"),
        }
    }

    fn walk_second_operand(&mut self, cx: &mut Walk, file: FileId, op: BinOp, first: Walked, second: ExprId) -> Option<Walked> {
        let decided = match op {
            BinOp::And if first.is_nil() => Some(false),
            BinOp::And if first.is_object() => Some(true),
            BinOp::Or if first.is_nil() => Some(true),
            BinOp::Or if first.is_object() => Some(false),
            BinOp::Nullish if first.is_nil() => Some(true),
            BinOp::Nullish if !first.may_be_nil() => Some(false),
            _ => None,
        };
        match decided {
            Some(true) => self.walk(cx, file, second),
            Some(false) => Some(first),
            None => {
                cx.doubts += 1;
                let other = self.walk(cx, file, second)?;
                cx.doubts -= 1;
                Some(if op == BinOp::And { first.join(other) } else { first.without_nil().join(other) })
            }
        }
    }

    fn walk_test(&mut self, cx: &mut Walk, file: FileId, e: ExprId) -> Option<Option<bool>> {
        let hir = self.hir(file);
        match hir[e].kind {
            ExprKind::True => Some(Some(true)),
            ExprKind::False => Some(Some(false)),
            ExprKind::Unary { op: UnOp::Not, operand } => Some(self.walk_test(cx, file, operand)?.map(|holds| !holds)),
            ExprKind::Binary { op: op @ (BinOp::EqEqEq | BinOp::NotEqEq | BinOp::EqEq | BinOp::NotEq), left, right } => {
                let (a, b) = (self.walk(cx, file, left)?, self.walk(cx, file, right)?);
                let is_loose = matches!(op, BinOp::EqEq | BinOp::NotEq);
                if is_loose && !a.is_nil() && !b.is_nil() && !(a.is_primitive() && b.is_primitive()) {
                    return cx.stops("walk: a conversion of what may be an object");
                }
                let are_equal = if a.is_nil() && b.is_nil() {
                    Some(is_loose || a == b)
                } else if a.is_nil() && !b.may_be_nil() || b.is_nil() && !a.may_be_nil() {
                    Some(false)
                } else {
                    None
                };
                Some(are_equal.map(|are_equal| are_equal == matches!(op, BinOp::EqEqEq | BinOp::EqEq)))
            }
            _ => {
                let value = self.walk(cx, file, e)?;
                Some(if value.is_object() { Some(true) } else if value.is_nil() { Some(false) } else { None })
            }
        }
    }

    fn walk_spread(&mut self, cx: &mut Walk, file: FileId, e: ExprId, fields: &mut Vec<(Atom, Walked)>, is_certain: bool) -> Option<()> {
        let hir = self.hir(file);
        match hir[e].kind {
            ExprKind::Binary { op: BinOp::And, left, right } => match self.walk_test(cx, file, left)? {
                Some(true) => self.walk_spread(cx, file, right, fields, is_certain),
                Some(false) => Some(()),
                None => {
                    cx.doubts += 1;
                    self.walk_spread(cx, file, right, fields, false)?;
                    cx.doubts -= 1;
                    Some(())
                }
            },
            ExprKind::Cond { test, yes, no } => match self.walk_test(cx, file, test)? {
                Some(true) => self.walk_spread(cx, file, yes, fields, is_certain),
                Some(false) => self.walk_spread(cx, file, no, fields, is_certain),
                None => {
                    cx.doubts += 1;
                    self.walk_spread(cx, file, yes, fields, false)?;
                    self.walk_spread(cx, file, no, fields, false)?;
                    cx.doubts -= 1;
                    Some(())
                }
            },
            ExprKind::Satisfies { expr, .. } | ExprKind::AsConst(expr) => self.walk_spread(cx, file, expr, fields, is_certain),
            _ => match self.walk(cx, file, e)? {
                Walked::Undefined | Walked::Null => Some(()),
                Walked::Made(it) if cx.made[it as usize].made_as == MadeAs::Record => {
                    for &(name, value) in &cx.made[it as usize].fields {
                        set_walked_field(fields, name, value, is_certain && !value.may_be_nil());
                    }
                    Some(())
                }
                _ => cx.stops("walk: a spread of what is no literal made there"),
            },
        }
    }

    fn walk_name(&mut self, cx: &mut Walk, file: FileId, e: ExprId, name: Atom) -> Option<Walked> {
        let local = self.bound(file).expr_symbol[e.idx()];
        if local.is_none() {
            let is_fixed = FIXED_GLOBALS.contains(&self.atoms().bytes(name));
            return match self.atoms().bytes(name) {
                b"undefined" => Some(Walked::Undefined),
                b"NaN" | b"Infinity" => Some(Walked::VALUE),
                _ if is_fixed => Some(Walked::Object),
                _ => cx.stops("walk: a global"),
            };
        }
        if let Some(bound) = cx.bound.iter().rev().find(|bound| bound.0 == (file, local)) {
            return Some(bound.1);
        }
        let Some(sym) = self.symbol_named_by(file, e, name) else { return cx.stops("walk: a name that is not resolved") };
        let Some((of, decl)) = self.declaration_of_variable(sym) else { return cx.stops("walk: a name that is not resolved") };
        if !self.is_walked_file(of) || self.bound(of).modifier_flags(self.hir(of), decl).contains(Flags::AMBIENT) {
            return cx.stops("walk: a name of untyped code, or only declared");
        }
        if let Decl::Fn(_) = decl {
            return match self.function_named_at_all_times(file, e, name) {
                Some((of, func)) => Some(Walked::Function { file: of, func, within: 0 }),
                None => cx.stops("walk: a function that is not the same at all times"),
            };
        }
        if !matches!(decl, Decl::Var(_) | Decl::Class(_)) {
            return cx.stops("walk: another name");
        }
        let Some((Site::File, end)) = self.dead_zone_of(of, decl) else { return cx.stops("walk: a variable of a call that has ended") };
        let value = match decl {
            Decl::Var(pat) => self.walk_constant(sym, of, pat),
            _ => self.class_held_by_variable(sym).map(|(of, class)| Walked::Class(of, class)),
        };
        let Some(value) = value else { return cx.stops("walk: a variable that is no constant, or says nothing") };
        let is_initialized = if of == cx.root.0 {
            end <= cx.root.1
        } else if self.is_put_first(of) {
            !self.may_be_in_dead_zone(sym, file, e)
        } else {
            of == file && self.is_evaluated_after(file, e, Site::File, end)
        };
        if !is_initialized && !cx.found_initialized.contains(&sym) {
            if cx.doubts > 0 {
                return cx.stops("walk: a name that may be early, under a condition");
            }
            cx.found_initialized.push(sym);
        }
        Some(value)
    }

    fn walk_constant(&mut self, sym: Sym, of: FileId, pat: PatId) -> Option<Walked> {
        let hir = self.hir(of);
        let PatParent::Var(d) = root_declaration(self.bound(of), pat) else { return None };
        if hir[d].kind != VarKind::Const || hir[d].init.is_none() {
            return None;
        }
        if hir[d].pat == pat {
            if let Some(constant) = self.constant_held_by(sym) {
                return Some(match constant {
                    Primitive::Undefined => Walked::Undefined,
                    Primitive::Null => Walked::Null,
                    _ => Walked::VALUE,
                });
            }
            let mut init = hir[d].init;
            while let ExprKind::Satisfies { expr, .. } | ExprKind::AsConst(expr) = hir[init].kind {
                init = expr;
            }
            match hir[init].kind {
                ExprKind::Fn(func) => return Some(Walked::Function { file: of, func, within: 0 }),
                ExprKind::Class(_) => return Some(self.class_held_by_variable(sym).map_or(Walked::Object, |(of, class)| Walked::Class(of, class))),
                ExprKind::Object(_) | ExprKind::Array(_) | ExprKind::New(_) | ExprKind::Regex => return Some(Walked::Object),
                _ => {}
            }
        }
        let ty = self.type_of_symbol(sym);
        (!self.says_nothing(ty)).then_some(Walked::Anything { may_be_nil: true })
    }

    fn walk_variable(&mut self, cx: &Walk, file: FileId, target: ExprId) -> Option<usize> {
        let ExprKind::Ident(_) = self.hir(file)[target].kind else { return None };
        let local = self.bound(file).expr_symbol[target.idx()];
        cx.bound.iter().rposition(|bound| local.is_some() && bound.0 == (file, local))
    }

    fn walk_read(&mut self, cx: &mut Walk, on: Walked, name: Atom) -> Option<Walked> {
        let Walked::Made(it) = on else { return cx.stops("walk: a read of what it has not made") };
        let held = cx.made[it as usize].fields.iter().find(|field| field.0 == name).map(|field| field.1);
        match cx.made[it as usize].made_as {
            MadeAs::Record => match held {
                Some(held) => Some(held),
                None if NAMES_OF_OBJECT_PROTOTYPE.contains(&self.atoms().bytes(name)) => cx.stops("walk: a read of Object.prototype"),
                None => Some(Walked::Undefined),
            },
            MadeAs::Instance(of, class) => match (self.finds_no_accessor(of, class, name), held) {
                (true, Some(held)) => Some(held),
                _ => cx.stops("walk: a read of an instance that finds no field"),
            },
            MadeAs::List if self.atoms().bytes(name) == b"length" => Some(Walked::VALUE),
            MadeAs::Collection { is_weak: false, .. } if self.atoms().bytes(name) == b"size" => Some(Walked::VALUE),
            _ => cx.stops("walk: a read of an object of the engine"),
        }
    }

    fn walk_store(&mut self, cx: &mut Walk, it: u32, name: Atom, value: Walked) -> Option<()> {
        let is_plain = self.atoms().bytes(name) != b"__proto__"
            && match cx.made[it as usize].made_as {
                MadeAs::Record => true,
                MadeAs::Instance(of, class) => self.finds_no_accessor(of, class, name),
                _ => false,
            };
        if !is_plain || cx.made[it as usize].is_frozen {
            return cx.stops("walk: a store that is no plain store");
        }
        let is_certain = cx.made[it as usize].doubts == cx.doubts;
        set_walked_field(&mut cx.made[it as usize].fields, name, value, is_certain);
        Some(())
    }

    fn class_extended_by(&mut self, of: FileId, class: ClassId) -> Option<Option<(FileId, ClassId)>> {
        let hir = self.hir(of);
        let extends = hir[class].extends;
        if extends.is_none() {
            return Some(None);
        }
        let ExprKind::Ident(name) = hir[extends].kind else { return None };
        let sym = self.symbol_named_by(of, extends, name)?;
        let extended = self.class_held_by_variable(sym)?;
        self.is_walked_file(extended.0).then_some(Some(extended))
    }

    fn finds_no_accessor(&mut self, of: FileId, class: ClassId, name: Atom) -> bool {
        let mut at = (of, class);
        for _ in 0..32 {
            let hir = self.hir(at.0);
            let is_in_the_way = hir[at.1].members.iter().any(|member| {
                let m = &hir[member];
                !m.flags.contains(Flags::STATIC) && (matches!(m.key, PropKey::Computed(_)) || m.key.name() == Some(name) && (m.kind != MemberKind::Property || m.flags.contains(Flags::ACCESSOR)))
            });
            if is_in_the_way {
                return false;
            }
            match self.class_extended_by(at.0, at.1) {
                Some(Some(extended)) => at = extended,
                Some(None) => return true,
                None => return false,
            }
        }
        false
    }

    fn walk_assignment(&mut self, cx: &mut Walk, file: FileId, op: Option<BinOp>, target: ExprId, value: ExprId) -> Option<Walked> {
        let hir = self.hir(file);
        match hir[target].kind {
            ExprKind::Ident(_) => {
                let Some(at) = self.walk_variable(cx, file, target) else { return cx.stops("walk: a store to a variable not its own") };
                let stored = self.walk_stored(cx, file, op, cx.bound[at].1, value)?;
                cx.bound[at].1 = if cx.bound[at].2 == cx.doubts { stored } else { cx.bound[at].1.join(stored) };
                Some(stored)
            }
            ExprKind::Dot { obj, name, chain: Chain::No, .. } => {
                let on = self.walk(cx, file, obj)?;
                let Walked::Made(it) = on else { return cx.stops("walk: a store to what it has not made") };
                let held = if op.is_some() { self.walk_read(cx, on, name)? } else { Walked::Undefined };
                let stored = self.walk_stored(cx, file, op, held, value)?;
                self.walk_store(cx, it, name, stored)?;
                Some(stored)
            }
            _ => cx.stops("walk: another store"),
        }
    }

    fn walk_stored(&mut self, cx: &mut Walk, file: FileId, op: Option<BinOp>, held: Walked, value: ExprId) -> Option<Walked> {
        match op {
            None => self.walk(cx, file, value),
            Some(op @ (BinOp::And | BinOp::Or | BinOp::Nullish)) => self.walk_second_operand(cx, file, op, held, value),
            Some(_) => {
                if !held.is_primitive() || !self.walk(cx, file, value)?.is_primitive() {
                    return cx.stops("walk: a conversion of what may be an object");
                }
                Some(Walked::VALUE)
            }
        }
    }

    fn walk_arguments(&mut self, cx: &mut Walk, file: FileId, call: CallId) -> Option<Vec<Walked>> {
        let hir = self.hir(file);
        let mut arguments = Vec::new();
        for argument in hir.ids(hir[call].args) {
            if matches!(hir[argument].kind, ExprKind::Spread(_)) {
                return cx.stops("walk: a spread of arguments");
            }
            arguments.push(self.walk(cx, file, argument)?);
        }
        Some(arguments)
    }

    fn walk_call(&mut self, cx: &mut Walk, file: FileId, call: CallId) -> Option<Walked> {
        let hir = self.hir(file);
        let callee = hir[call].callee;
        if hir[call].chain != Chain::No {
            return cx.stops("walk: an optional call");
        }
        let (called, this) = match hir[callee].kind {
            ExprKind::Super => return self.walk_super_call(cx, file, call),
            ExprKind::Dot { obj, name, chain: Chain::No, .. } => {
                if matches!(hir[obj].kind, ExprKind::Ident(object) if self.atoms().bytes(object) == b"Object" && self.names_global(file, obj, object)) {
                    return self.walk_call_on_object(cx, file, call, name);
                }
                let on = self.walk(cx, file, obj)?;
                match on {
                    Walked::Made(it) if cx.made[it as usize].made_as == MadeAs::Record => (self.walk_read(cx, on, name)?, Some(on)),
                    Walked::Made(it) if !matches!(cx.made[it as usize].made_as, MadeAs::Instance(..)) => return self.walk_call_on_made(cx, file, call, it, name),
                    Walked::Made(_) => return cx.stops("walk: a method of an instance"),
                    Walked::Class(..) => return cx.stops("walk: a static method"),
                    _ => return cx.stops("walk: a method of what it has not made"),
                }
            }
            _ => (self.walk(cx, file, callee)?, None),
        };
        let Walked::Function { file: of, func, within } = called else { return cx.stops("walk: a call of what is no one function of the program") };
        let arguments = self.walk_arguments(cx, file, call)?;
        self.walk_activation(cx, of, func, within, this, &arguments, None)
    }

    fn walk_call_on_object(&mut self, cx: &mut Walk, file: FileId, call: CallId, name: Atom) -> Option<Walked> {
        let arguments = self.walk_arguments(cx, file, call)?;
        let [Walked::Made(it)] = arguments[..] else { return cx.stops("walk: a function of Object") };
        let made_as = cx.made[it as usize].made_as;
        let is_record = made_as == MadeAs::Record;
        match self.atoms().bytes(name) {
            b"freeze" if is_record || made_as == MadeAs::List => {
                cx.made[it as usize].is_frozen = true;
                Some(arguments[0])
            }
            b"keys" if is_record => Some(cx.make(MadeAs::List, Vec::new(), Some(Walked::VALUE))),
            b"values" if is_record => {
                let held = cx.made[it as usize].fields.iter().fold(None, |held, field| join_walked(held, Some(field.1)));
                Some(cx.make(MadeAs::List, Vec::new(), held))
            }
            b"entries" if is_record => {
                let list = cx.make(MadeAs::List, Vec::new(), Some(Walked::Object));
                cx.made.last_mut()?.holds_lists_made_there = true;
                Some(list)
            }
            _ => cx.stops("walk: a function of Object"),
        }
    }

    fn walk_call_on_made(&mut self, cx: &mut Walk, file: FileId, call: CallId, it: u32, name: Atom) -> Option<Walked> {
        let arguments = self.walk_arguments(cx, file, call)?;
        let made_as = cx.made[it as usize].made_as;
        match (made_as, self.atoms().bytes(name), &arguments[..]) {
            (MadeAs::List, b"push", pushed) if !cx.made[it as usize].is_frozen => {
                let held = pushed.iter().fold(cx.made[it as usize].elements, |held, &value| join_walked(held, Some(value)));
                let holds_lists = pushed.iter().all(|&value| cx.is_list(value));
                cx.made[it as usize].elements = held;
                cx.made[it as usize].holds_lists_made_there &= holds_lists;
                Some(Walked::VALUE)
            }
            (MadeAs::Collection { has_values: true, is_weak }, b"set", [key, _]) if !is_weak || key.is_object() => Some(Walked::Made(it)),
            (MadeAs::Collection { has_values: false, is_weak }, b"add", [key]) if !is_weak || key.is_object() => Some(Walked::Made(it)),
            (MadeAs::Collection { .. }, b"has", [_]) => Some(Walked::VALUE),
            _ => cx.stops("walk: a method of an object of the engine"),
        }
    }

    fn walk_new(&mut self, cx: &mut Walk, file: FileId, call: CallId) -> Option<Walked> {
        let hir = self.hir(file);
        let callee = hir[call].callee;
        if let ExprKind::Ident(name) = hir[callee].kind
            && self.names_global(file, callee, name)
        {
            let collection = match self.atoms().bytes(name) {
                b"Map" => Some((true, false)),
                b"Set" => Some((false, false)),
                b"WeakMap" => Some((true, true)),
                b"WeakSet" => Some((false, true)),
                _ => None,
            };
            let Some((has_values, is_weak)) = collection else {
                return if cx.running.is_empty() && self.makes_object_of_engine(file, call) { Some(Walked::Object) } else { cx.stops("walk: new of a global") };
            };
            let arguments = self.walk_arguments(cx, file, call)?;
            let is_filled_plainly = match arguments[..] {
                [] | [Walked::Undefined | Walked::Null] => true,
                [Walked::Made(it)] => !is_weak && cx.made[it as usize].made_as == MadeAs::List && (!has_values || cx.made[it as usize].holds_lists_made_there),
                _ => false,
            };
            if !is_filled_plainly {
                return cx.stops("walk: a collection filled with what is no list made there");
            }
            return Some(cx.make(MadeAs::Collection { has_values, is_weak }, Vec::new(), None));
        }
        let Walked::Class(of, class) = self.walk(cx, file, callee)? else { return cx.stops("walk: new of what is no one class of the program") };
        let arguments = self.walk_arguments(cx, file, call)?;
        let instance = cx.make(MadeAs::Instance(of, class), Vec::new(), None);
        self.walk_construction(cx, of, class, instance, &arguments)?;
        Some(instance)
    }

    fn walk_construction(&mut self, cx: &mut Walk, of: FileId, class: ClassId, instance: Walked, arguments: &[Walked]) -> Option<()> {
        let hir = self.hir(of);
        let is_decorated = |modifiers: Span<ModifierId>| modifiers.iter().any(|modifier| matches!(hir[modifier].kind, ModifierKind::Decorator(_)));
        if !self.is_walked_file(of) || hir[class].flags.contains(Flags::AMBIENT) || is_decorated(hir[class].modifiers) || hir[class].members.iter().any(|member| is_decorated(hir[member].modifiers)) {
            return cx.stops("walk: a class that is decorated, untyped or only declared");
        }
        if cx.constructing.contains(&(of, class)) || cx.constructing.len() >= MOST_ACTIVATIONS_OF_A_WALK {
            return cx.stops("walk: recursion");
        }
        let Some(extended) = self.class_extended_by(of, class) else { return cx.stops("walk: a class that extends what is no one class of the program") };
        cx.constructing.push((of, class));
        match self.constructor_of_class(of, class) {
            Some(constructor) => {
                if extended.is_none() {
                    self.walk_fields(cx, of, class, instance)?;
                }
                self.walk_activation(cx, of, constructor, 0, Some(instance), arguments, Some(((of, class), extended)))?;
            }
            None => {
                if let Some(extended) = extended {
                    self.walk_construction(cx, extended.0, extended.1, instance, arguments)?;
                }
                self.walk_fields(cx, of, class, instance)?;
            }
        }
        cx.constructing.pop();
        Some(())
    }

    fn walk_fields(&mut self, cx: &mut Walk, of: FileId, class: ClassId, instance: Walked) -> Option<()> {
        let hir = self.hir(of);
        let Walked::Made(it) = instance else { return None };
        cx.serials += 1;
        cx.running.push(Activation { function: (of, FnId::NONE), serial: cx.serials, this: Some(instance), bound_from: cx.bound.len(), doubts_from: cx.doubts, returned: None, constructs: None, has_called_super: false });
        for member in hir[class].members.iter() {
            let m = &hir[member];
            if m.kind != MemberKind::Property || m.flags.intersects(Flags::STATIC | Flags::AMBIENT | Flags::ABSTRACT) || self.is_field_left_out(of, member) {
                continue;
            }
            let Some(name) = m.key.name() else { return cx.stops("walk: a field with a computed key") };
            let value = self.walk(cx, of, m.init)?;
            self.walk_store(cx, it, name, value)?;
        }
        cx.running.pop();
        Some(())
    }

    fn walk_super_call(&mut self, cx: &mut Walk, file: FileId, call: CallId) -> Option<Walked> {
        let arguments = self.walk_arguments(cx, file, call)?;
        let Some(activation) = cx.running.last_mut() else { return cx.stops("walk: super") };
        let (Some((own, Some(extended))), Some(instance), false) = (activation.constructs, activation.this, activation.has_called_super) else { return cx.stops("walk: super") };
        if activation.doubts_from != cx.doubts {
            return cx.stops("walk: super(..) under a condition");
        }
        activation.has_called_super = true;
        let function = activation.function;
        self.walk_construction(cx, extended.0, extended.1, instance, &arguments)?;
        self.walk_fields(cx, own.0, own.1, instance)?;
        self.walk_parameter_properties(cx, function.0, function.1, instance)?;
        Some(instance)
    }

    fn walk_parameter_properties(&mut self, cx: &mut Walk, of: FileId, constructor: FnId, instance: Walked) -> Option<()> {
        let (hir, bound) = (self.hir(of), self.bound(of));
        let Walked::Made(it) = instance else { return None };
        for p in hir[constructor].params.iter().filter(|&p| hir[p].flags.contains(Flags::PARAMETER_PROPERTY)) {
            let PatKind::Ident(name) = hir[hir[p].pat].kind else { return cx.stops("walk: a pattern") };
            let symbol = bound.pat_symbol[hir[p].pat.idx()];
            let Some(handed) = cx.bound.iter().rev().find(|bound| bound.0 == (of, symbol)).map(|bound| bound.1) else { return cx.stops("walk: a pattern") };
            self.walk_store(cx, it, name, handed)?;
        }
        Some(())
    }

    fn walk_activation(
        &mut self,
        cx: &mut Walk,
        of: FileId,
        func: FnId,
        within: u32,
        this: Option<Walked>,
        arguments: &[Walked],
        constructs: Option<((FileId, ClassId), Option<(FileId, ClassId)>)>,
    ) -> Option<Walked> {
        let hir = self.hir(of);
        let f = &hir[func];
        if !self.is_walked_file(of) {
            return cx.stops("walk: a function of untyped code");
        }
        if f.flags.intersects(Flags::ASYNC | Flags::GENERATOR) {
            return cx.stops("walk: a coroutine");
        }
        if f.this_param.is_some() || cx.running.len() >= MOST_ACTIVATIONS_OF_A_WALK || cx.running.iter().any(|activation| activation.function == (of, func)) {
            return cx.stops("walk: recursion");
        }
        if within != 0 && !cx.running.iter().any(|activation| activation.serial == within) {
            return cx.stops("walk: a closure of a call that has ended");
        }
        cx.serials += 1;
        let this = this.filter(|_| f.kind != FnKind::Arrow);
        cx.running.push(Activation { function: (of, func), serial: cx.serials, this, bound_from: cx.bound.len(), doubts_from: cx.doubts, returned: None, constructs, has_called_super: false });
        for (index, p) in f.params.iter().enumerate() {
            let parameter = &hir[p];
            let says_nothing = parameter.ty.is_some() && matches!(hir[parameter.ty].kind, TypeNodeKind::Keyword(Keyword::Any));
            if parameter.flags.contains(Flags::REST) || says_nothing {
                return cx.stops("walk: a rest parameter, or one that is any");
            }
            let value = match arguments.get(index).copied().unwrap_or(Walked::Undefined) {
                handed if parameter.default.is_none() || !handed.may_be_nil() || handed == Walked::Null => handed,
                Walked::Undefined => self.walk(cx, of, parameter.default)?,
                handed => {
                    cx.doubts += 1;
                    let otherwise = self.walk(cx, of, parameter.default)?;
                    cx.doubts -= 1;
                    handed.join(otherwise)
                }
            };
            self.walk_binding(cx, of, parameter.pat, value)?;
        }
        if let (Some((_, None)), Some(instance)) = (constructs, this) {
            self.walk_parameter_properties(cx, of, func, instance)?;
        }
        let falls_off = match f.body {
            FnBody::Expr(returned) => {
                let value = self.walk(cx, of, returned)?;
                cx.running.last_mut()?.returned = Some(value);
                false
            }
            FnBody::Block(statements) => self.walk_statements(cx, of, hir.ids(statements).collect())?,
            FnBody::None => return cx.stops("walk: a function without a body"),
        };
        let activation = cx.running.pop()?;
        cx.bound.truncate(activation.bound_from);
        cx.doubts = activation.doubts_from;
        if matches!(activation.constructs, Some((_, Some(_)))) && !activation.has_called_super {
            return cx.stops("walk: super");
        }
        Some(if falls_off { activation.returned.map_or(Walked::Undefined, |returned| returned.join(Walked::Undefined)) } else { activation.returned.unwrap_or(Walked::Undefined) })
    }

    fn walk_binding(&mut self, cx: &mut Walk, file: FileId, pat: PatId, value: Walked) -> Option<()> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        match hir[pat].kind {
            PatKind::Ident(_) => {
                cx.bind(file, bound.pat_symbol[pat.idx()], value);
                Some(())
            }
            PatKind::Object(props) => {
                if !matches!(value, Walked::Made(it) if cx.made[it as usize].made_as == MadeAs::Record) {
                    return cx.stops("walk: a pattern on what is no literal made there");
                }
                for prop in props.iter() {
                    let p = &hir[prop];
                    let PropKey::Name(name) = p.key else { return cx.stops("walk: a pattern") };
                    if p.is_rest {
                        return cx.stops("walk: a pattern");
                    }
                    let mut held = self.walk_read(cx, value, name)?;
                    if p.default.is_some() && held == Walked::Undefined {
                        held = self.walk(cx, file, p.default)?;
                    } else if p.default.is_some() && held.may_be_nil() && held != Walked::Null {
                        cx.doubts += 1;
                        held = held.join(self.walk(cx, file, p.default)?);
                        cx.doubts -= 1;
                    }
                    self.walk_binding(cx, file, p.value, held)?;
                }
                Some(())
            }
            _ => cx.stops("walk: a pattern"),
        }
    }

    fn walk_statements(&mut self, cx: &mut Walk, file: FileId, statements: Vec<StmtId>) -> Option<bool> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        for &stmt in &statements {
            if let StmtKind::Fn(func) = hir[stmt].kind
                && !matches!(hir[func].body, FnBody::None)
            {
                let declared = Walked::Function { file, func, within: cx.serial() };
                cx.bind(file, bound.fn_symbol[func.idx()], declared);
            }
        }
        for stmt in statements {
            if !self.walk_statement(cx, file, stmt)? {
                return Some(false);
            }
        }
        Some(true)
    }

    fn walk_statement(&mut self, cx: &mut Walk, file: FileId, stmt: StmtId) -> Option<bool> {
        let hir = self.hir(file);
        match hir[stmt].kind {
            StmtKind::Empty | StmtKind::Interface(_) | StmtKind::TypeAlias(_) | StmtKind::Fn(_) => Some(true),
            StmtKind::Expr(e) => {
                self.walk(cx, file, e)?;
                Some(true)
            }
            StmtKind::Var(decls) => {
                for d in decls.iter().filter(|&d| !hir[d].flags.contains(Flags::AMBIENT)) {
                    let says_nothing = hir[d].ty.is_some() && matches!(hir[hir[d].ty].kind, TypeNodeKind::Keyword(Keyword::Any));
                    if !matches!(hir[d].kind, VarKind::Let | VarKind::Const) || says_nothing {
                        return cx.stops("walk: a var, a using, or a variable that is any");
                    }
                    let value = self.walk(cx, file, hir[d].init)?;
                    self.walk_binding(cx, file, hir[d].pat, value)?;
                }
                Some(true)
            }
            StmtKind::Return(e) => {
                let value = self.walk(cx, file, e)?;
                let Some(activation) = cx.running.last_mut() else { return None };
                if activation.constructs.is_some() && e.is_some() {
                    return cx.stops("walk: a constructor that returns something");
                }
                activation.returned = join_walked(activation.returned, Some(value));
                Some(false)
            }
            StmtKind::Block(statements) => self.walk_statements(cx, file, hir.ids(statements).collect()),
            StmtKind::If { test, yes, no } => match self.walk_test(cx, file, test)? {
                Some(true) => self.walk_statement(cx, file, yes),
                Some(false) if no.is_some() => self.walk_statement(cx, file, no),
                Some(false) => Some(true),
                None => {
                    cx.doubts += 1;
                    let first = self.walk_statement(cx, file, yes)?;
                    let second = no.is_none() || self.walk_statement(cx, file, no)?;
                    if first == second {
                        cx.doubts -= 1;
                    }
                    Some(first || second)
                }
            },
            StmtKind::Throw(_) => cx.stops("walk: throw"),
            StmtKind::Try { .. } => cx.stops("walk: try"),
            StmtKind::For { .. } | StmtKind::ForIn { .. } | StmtKind::ForOf { .. } | StmtKind::While { .. } | StmtKind::DoWhile { .. } => cx.stops("walk: a loop"),
            StmtKind::Switch { .. } => cx.stops("walk: switch"),
            _ => cx.stops("walk: another statement"),
        }
    }

    /// Whether the name is that of a parameter of the function, or of a `const` of its body whose declaration stands before.
    fn is_bound_in(&self, file: FileId, func: FnId, e: ExprId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let Some(symbol) = bound.symbols.get(bound.expr_symbol[e.idx()].idx()) else { return false };
        !symbol.decls.is_empty()
            && symbol.decls.iter().all(|&decl| match decl {
                Decl::Param(pat) => matches!(bound.pat_parent[pat.idx()], PatParent::Param(p) if bound.param_fn[p.idx()] == func) && !self.may_find_parameter_unbound(file, pat, e),
                Decl::Var(pat) => matches!(bound.pat_parent[pat.idx()], PatParent::Var(d) if {
                    let stmt = bound.var_stmt[d.idx()];
                    hir[d].kind == VarKind::Const && stmt.is_some() && self.enclosing_fn(file, Parent::Stmt(stmt)) == Some(func) && hir[stmt].loc.end <= hir[e].pos
                }),
                _ => false,
            })
    }

    /// `[a, b]`, with `of_pairs` `[[k, v], ..]`, or what `Object.entries` and the like make of an object literal: a list that is written out where it
    /// stands, without a hole or a spread, of parts that are inert. `Map` and `Set` go through it by the iterator of arrays and store by `set`
    /// and `add`. A program can replace none of those, nor give `Array.prototype` an element: no code of it runs, and nothing throws.
    fn is_list_written_out(&mut self, file: FileId, e: ExprId, of_pairs: bool) -> bool {
        let hir = self.hir(file);
        let is_there = |part: ExprId| !matches!(hir[part].kind, ExprKind::Missing);
        match hir[e].kind {
            ExprKind::Satisfies { expr, .. } | ExprKind::AsConst(expr) => self.is_list_written_out(file, expr, of_pairs),
            ExprKind::Array(elements) if !of_pairs => hir.ids(elements).all(|element| is_there(element) && self.is_inert(file, element)),
            ExprKind::Array(elements) => hir.ids(elements).all(|element| {
                let mut pair = element;
                while let ExprKind::Satisfies { expr, .. } | ExprKind::AsConst(expr) = hir[pair].kind {
                    pair = expr;
                }
                matches!(hir[pair].kind, ExprKind::Array(parts) if parts.len() == 2 && hir.ids(parts).all(|part| is_there(part) && self.is_inert(file, part)))
            }),
            ExprKind::Call(call) => self.lists_object_literal(file, call).is_some_and(|yields_pairs| yields_pairs || !of_pairs),
            _ => false,
        }
    }

    /// `Object.entries({ .. })`, `Object.keys({ .. })`, `Object.values({ .. })` of an object literal that is inert and is written there: what a name stands
    /// for may have an accessor, and may change. Whether it yields pairs.
    fn lists_object_literal(&mut self, file: FileId, call: CallId) -> Option<bool> {
        let hir = self.hir(file);
        let ExprKind::Dot { obj, name, chain: Chain::No, .. } = hir[hir[call].callee].kind else { return None };
        let yields_pairs = match self.atoms().bytes(name) {
            b"entries" => true,
            b"keys" | b"values" => false,
            _ => return None,
        };
        let is_of_object = hir[call].chain == Chain::No && matches!(hir[obj].kind, ExprKind::Ident(object) if self.atoms().bytes(object) == b"Object" && self.names_global(file, obj, object));
        let mut literal = hir.ids(hir[call].args).next()?;
        while let ExprKind::Satisfies { expr, .. } | ExprKind::AsConst(expr) = hir[literal].kind {
            literal = expr;
        }
        (is_of_object && hir[call].args.len() == 1 && matches!(hir[literal].kind, ExprKind::Object(_)) && self.is_inert(file, literal)).then_some(yields_pairs)
    }

    pub fn fold_constant_string(&mut self, file: FileId, e: ExprId) -> Option<(Atom, Vec<ExprId>)> {
        let around = std::mem::replace(&mut self.aot.storage.folding_long_strings, true);
        let value = self.constant_value_of(file, e);
        self.aot.storage.folding_long_strings = around;
        let Some(Primitive::String(text)) = value else { return None };
        if self.atoms().bytes(text).len() > 4 * MAX_FOLDED_STRING_PART_LEN {
            return None;
        }
        let mut names = Vec::new();
        self.collect_identifiers(file, e, &mut names);
        Some((text, names))
    }

    fn collect_identifiers(&self, file: FileId, e: ExprId, names: &mut Vec<ExprId>) {
        let hir = self.hir(file);
        match hir[e].kind {
            ExprKind::Ident(_) if self.bound(file).expr_symbol[e.idx()].is_some() => names.push(e),
            ExprKind::Template { exprs } => hir.ids(exprs).for_each(|hole| self.collect_identifiers(file, hole, names)),
            ExprKind::TaggedTemplate(call) => hir.ids(hir[call].args).for_each(|hole| self.collect_identifiers(file, hole, names)),
            ExprKind::Unary { operand, .. } => self.collect_identifiers(file, operand, names),
            ExprKind::Binary { left, right, .. } => {
                self.collect_identifiers(file, left, names);
                self.collect_identifiers(file, right, names);
            }
            ExprKind::Satisfies { expr, .. } | ExprKind::AsConst(expr) | ExprKind::As { expr, .. } => self.collect_identifiers(file, expr, names),
            _ => {}
        }
    }

    fn is_string_raw_tag(&mut self, file: FileId, call: CallId) -> bool {
        let hir = self.hir(file);
        let ExprKind::Dot { obj, name, chain: Chain::No, .. } = hir[hir[call].callee].kind else { return false };
        hir[call].close_pos == u32::MAX && self.atoms().bytes(name) == b"raw" && matches!(hir[obj].kind, ExprKind::Ident(string) if self.atoms().bytes(string) == b"String" && self.names_global(file, obj, string))
    }

    pub fn template_raw_strings(&self, file: FileId, call: CallId) -> Vec<Vec<u8>> {
        let hir = self.hir(file);
        let start = hir[hir[call].template].pos as usize;
        let (text, mut ends) = (&hir.text[start..], hir.ids(hir[call].args).map(|substitution| hir[substitution].end as usize));
        let (mut pieces, mut piece, mut i) = (Vec::new(), Vec::new(), 1);
        while i < text.len() {
            match text[i] {
                b'`' => break,
                b'\\' if i + 1 < text.len() && text[i + 1] != b'\r' => {
                    piece.extend_from_slice(&text[i..i + 2]);
                    i += 2;
                }
                b'$' if text.get(i + 1) == Some(&b'{') => {
                    let Some(end) = ends.next() else { return Vec::new() };
                    pieces.push(std::mem::take(&mut piece));
                    i = end_of_substitution(text, end.saturating_sub(start));
                }
                b'\r' => {
                    piece.push(b'\n');
                    i += if text.get(i + 1) == Some(&b'\n') { 2 } else { 1 };
                }
                byte => {
                    piece.push(byte);
                    i += 1;
                }
            }
        }
        pieces.push(piece);
        pieces
    }

    /// `new Map()`, `new Int32Array(8)`, `new Set([a, b])`: a class of the engine, with no argument, with a length that is written down and small enough
    /// for the allocation not to fail while anything else works, or with its contents written out.
    fn makes_object_of_engine(&mut self, file: FileId, call: CallId) -> bool {
        let hir = self.hir(file);
        let ExprKind::Ident(name) = hir[hir[call].callee].kind else { return false };
        if !self.names_global(file, hir[call].callee, name) {
            return false;
        }
        let takes_pairs = match self.atoms().bytes(name) {
            b"Map" => Some(true),
            b"Set" => Some(false),
            _ => None,
        };
        let takes_length = match self.atoms().bytes(name) {
            b"Map" | b"Set" | b"WeakMap" | b"WeakSet" => false,
            b"Array" | b"ArrayBuffer" | b"Int8Array" | b"Uint8Array" | b"Uint8ClampedArray" | b"Int16Array" | b"Uint16Array" | b"Int32Array" | b"Uint32Array" | b"Float32Array" | b"Float64Array" => true,
            _ => return false,
        };
        let mut arguments = hir.ids(hir[call].args);
        match (arguments.next(), arguments.next()) {
            (None, _) => true,
            (Some(contents), None) if takes_pairs.is_some() => self.is_list_written_out(file, contents, takes_pairs == Some(true)),
            (Some(length), None) if takes_length => {
                let written = match hir[length].kind {
                    ExprKind::Ident(name) if self.is_inert_name(file, length, name) => self.constant_named_by(file, length, name),
                    _ => Some((file, length)),
                };
                written.is_some_and(|(of, length)| matches!(self.hir(of)[length].kind, ExprKind::Number(index) if {
                    let length = self.hir(of).numbers[index as usize];
                    length.fract() == 0.0 && (0.0..=MOST_INERT_LENGTH).contains(&length)
                }))
            }
            _ => false,
        }
    }

    /// Whether some reference by the code that declares it may find the variable, the parameter or the class in its dead zone. If
    /// none does, that code need not keep track of whether the declaration has been evaluated.
    pub fn is_referred_to_in_dead_zone(&mut self, sym: Sym) -> bool {
        let Some((file, decl)) = self.declaration_of_variable(sym) else { return false };
        let local = self.bound(file).symbol_of_declaration(decl);
        has(&self.storage_facts(file).referred_to_early, local)
    }

    fn site_run_by(&self, file: FileId, mut parent: Parent) -> Option<Site> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        loop {
            parent = match parent {
                Parent::MemberInit(member) if !hir[member].flags.contains(Flags::STATIC) => return Some(Site::Initializer(member)),
                Parent::MemberInit(member) | Parent::MemberKey(member) => match bound.member_owner[member.idx()] {
                    MemberOwner::Class(class) => bound.class_owner[class.idx()].to_parent(),
                    _ => return self.site_of(file, parent),
                },
                Parent::Expr(e) if e.is_some() => bound.expr_parent[e.idx()],
                Parent::Stmt(s) if s.is_some() => bound.stmt_parent[s.idx()],
                Parent::FnBody(_) | Parent::ParamDefault(_) | Parent::File | Parent::None => return self.site_of(file, parent),
                _ => self.parent_of_node(file, parent),
            };
        }
    }

    /// What a direct child of `parent` is a part of. `None`: that is not known.
    pub(super) fn site_of(&self, file: FileId, mut parent: Parent) -> Option<Site> {
        let bound = self.bound(file);
        loop {
            parent = match parent {
                Parent::Expr(e) if e.is_some() => bound.expr_parent[e.idx()],
                Parent::Stmt(s) if s.is_some() => bound.stmt_parent[s.idx()],
                Parent::FnBody(func) => return Some(Site::Body(func)),
                Parent::ParamDefault(p) => return Some(Site::Parameter(p)),
                Parent::MemberInit(m) => return Some(Site::Initializer(m)),
                Parent::File => return Some(Site::File),
                Parent::None => return None,
                _ => self.parent_of_node(file, parent),
            };
        }
    }

    /// The code that evaluates the declaration of a variable or a class, and where in the text the dead zone ends for that code: what
    /// comes later in the text comes later in time. 0: there is no dead zone, it is a `var`. `u32::MAX`: control can get past the
    /// declaration without evaluating it, as in a `case`. `None`: it is not known what evaluates it.
    pub(super) fn dead_zone_of(&self, file: FileId, decl: Decl) -> Option<(Site, u32)> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let (stmt, end) = match decl {
            Decl::Var(pat) => {
                let PatParent::Var(d) = root_declaration(bound, pat) else { return None };
                let stmt = bound.var_stmt[d.idx()];
                let is_hoisted = hir[d].kind == VarKind::Var
                    || self.files().module(file).builtin.is_some() && matches!(hir[d].kind, VarKind::Let | VarKind::Const) && stmt.is_some() && matches!(bound.stmt_parent[stmt.idx()], Parent::File);
                (stmt, if is_hoisted { 0 } else { hir[d].loc.end })
            }
            Decl::Class(class) => match bound.class_owner[class.idx()] {
                ClassOwner::Stmt(stmt) => (stmt, hir[stmt].loc.end),
                ClassOwner::Expr(_) => return None,
            },
            _ => return None,
        };
        if stmt.is_none() {
            return None;
        }
        let end = match bound.stmt_parent[stmt.idx()] {
            _ if end == 0 => 0,
            // The variable of a `catch` clause, which belongs to the `try` statement.
            _ if matches!(hir[stmt].kind, StmtKind::Try { .. }) => end,
            Parent::FnBody(_) | Parent::File | Parent::Module(_) => end,
            Parent::Stmt(around) if around.is_some() => match hir[around].kind {
                StmtKind::Block(_) => end,
                StmtKind::For { init, .. } if init == stmt => end,
                // What is looped over is evaluated with the variable in scope.
                StmtKind::ForIn { left, expr, .. } | StmtKind::ForOf { left, expr, .. } if left == stmt => hir[expr].end,
                _ => u32::MAX,
            },
            _ => u32::MAX,
        };
        Some((self.site_of(file, Parent::Stmt(stmt))?, end))
    }

    /// Parameters are bound from left to right, before the body runs. A function within one of them may be called by a later one.
    fn may_find_parameter_unbound(&self, file: FileId, pat: PatId, e: ExprId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let PatParent::Param(declared) = root_declaration(bound, pat) else { return true };
        let func = bound.param_fn[declared.idx()];
        match self.site_of(file, bound.expr_parent[e.idx()]) {
            Some(Site::Body(body)) if body == func => false,
            Some(Site::Parameter(at)) if bound.param_fn[at.idx()] == func => at <= declared,
            _ => hir[func].params.iter().any(|p| hir[p].default.is_some() || !matches!(hir[hir[p].pat].kind, PatKind::Ident(_))),
        }
    }

    // ───────────────────────────── what a place holds before anything is stored to it ─────────────────────────────

    /// Whether the variable or the field may be found to hold `undefined` without anything having stored that to it. An instance field
    /// of a class that extends something: see `field_starts_undefined`, which this takes to know nothing of what is extended.
    pub fn starts_undefined(&mut self, sym: Sym) -> bool {
        match self.files().value_declaration(sym) {
            Some((file, Decl::Var(pat))) => self.variable_starts_undefined(sym, file, pat),
            Some((_, Decl::Member(_) | Decl::ParameterProperty(_))) => self.field_starts_undefined(sym, &[]),
            // A parameter is bound when the function is entered. Anything else stands for one thing, or for nothing yet.
            _ => false,
        }
    }

    /// `let a;`, and not the variable of a loop or of a `catch` clause, which is bound whenever it is in scope.
    fn is_declared_without_value(&self, file: FileId, d: VarDeclId) -> bool {
        let (hir, stmt) = (self.hir(file), self.bound(file).var_stmt[d.idx()]);
        hir[d].init.is_none() && stmt.is_some() && matches!(hir[stmt].kind, StmtKind::Var(_)) && !self.declares_loop_variable(file, stmt)
    }

    /// Whether `a = undefined!` throws does not depend on what is found out about the reads: a variable that has room for `undefined` by
    /// how it is declared, and that is cleared, keeps the room.
    fn variable_starts_undefined(&mut self, sym: Sym, file: FileId, pat: PatId) -> bool {
        self.may_find_variable_unassigned(sym, file, pat) || has(&self.storage_facts(file).cleared, self.bound(file).pat_symbol[pat.idx()])
    }

    /// Whether a read may find the variable before anything is stored to it.
    fn may_find_variable_unassigned(&mut self, sym: Sym, file: FileId, pat: PatId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let PatParent::Var(d) = root_declaration(bound, pat) else { return false };
        // Up to its declaration it holds nothing, and from there on what the declaration gives it. Unless it is there from the start: a `var`,
        // and what a builtin module declares at its top level.
        let is_hoisted = hir[d].kind == VarKind::Var || matches!(self.dead_zone_of(file, Decl::Var(pat)), Some((_, 0)));
        if !is_hoisted && !self.is_declared_without_value(file, d) {
            return false;
        }
        let local = bound.pat_symbol[pat.idx()];
        let Some(symbol) = bound.symbols.get(local.idx()) else { return true };
        // What other files see is read by code that is not looked at here.
        let is_seen_elsewhere = symbol.flags.contains(SymFlags::MERGED)
            || hir[d].flags.contains(Flags::EXPORT)
            || self.files().sym(file, local) != sym
            || !self.files().module(file).is_module() && self.site_of(file, Parent::Stmt(bound.var_stmt[d.idx()])) == Some(Site::File);
        if is_seen_elsewhere || !symbol.decls.iter().all(|decl| matches!(decl, Decl::Var(_))) || self.dead_zone_of(file, Decl::Var(pat)).is_none() {
            return true;
        }
        has(&self.storage_facts(file).read_unassigned, local)
    }

    fn how_declared(&self, file: FileId, symbol: SymbolId) -> Declared {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let nothing = Declared { site: None, end_of_dead_zone: 0, is_blank: false, end_of_initializer: 0 };
        let of = &bound.symbols[symbol.idx()];
        if of.flags.intersects(SymFlags::MERGED | SymFlags::PARAMETER) {
            return nothing;
        }
        let declaration = of.decls.iter().find_map(|&decl| match decl {
            Decl::Require(pat) => Some(Decl::Var(pat)),
            Decl::Var(_) | Decl::Class(_) => Some(decl),
            _ => None,
        });
        let Some(decl) = declaration else { return nothing };
        let Some((site, end_of_dead_zone)) = self.dead_zone_of(file, decl) else { return nothing };
        let is_blank = matches!(decl, Decl::Var(pat) if end_of_dead_zone == 0 || matches!(root_declaration(bound, pat), PatParent::Var(d) if self.is_declared_without_value(file, d)));
        let end_of_initializer = match decl {
            Decl::Var(pat) if is_blank && of.decls.len() == 1 => match root_declaration(bound, pat) {
                PatParent::Var(d) if hir[d].init.is_some() && matches!(bound.stmt_parent[bound.var_stmt[d.idx()].idx()], Parent::FnBody(_) | Parent::File) => hir[d].loc.end,
                _ => 0,
            },
            _ => 0,
        };
        Declared { site: Some(site), end_of_dead_zone, is_blank, end_of_initializer }
    }

    /// The checker that asks first finds them, from the tree and the symbols of the file alone.
    fn storage_facts(&self, file: FileId) -> &'p FileFacts {
        let program = self.p;
        program.aot.storage.by_file.get_or_init(program.files.modules.len(), file, || self.find_storage_facts(file))
    }

    fn find_storage_facts(&self, file: FileId) -> FileFacts {
        let index = self.exprs_by_kind_of(file);
        let (hir, bound, files) = (self.hir(file), self.bound(file), self.files());
        let words = bound.symbols.len() / 64 + 1;
        let mut found = FileFacts { read_unassigned: vec![0; words], cleared: vec![0; words], referred_to_early: vec![0; words], found_early: vec![0; words], captured_early: vec![0; words], seen_by_importers: vec![0; words], stored_through_casts: vec![0; words], this: Vec::new() };
        let mut declared: Vec<Option<Declared>> = vec![None; bound.symbols.len()];
        // The reads of variables that hold `undefined` at first, by the code that declares them.
        let mut reads: Vec<(SymbolId, ExprId)> = Vec::new();
        for &e in index.of(ExprTag::Ident) {
            let (symbol, parent) = (bound.expr_symbol[e.idx()], bound.expr_parent[e.idx()]);
            if parent == Parent::None || bound.is_in_type_query(e) {
                continue;
            }
            let Some(how) = declared.get_mut(symbol.idx()) else { continue };
            let how = *how.get_or_insert_with(|| self.how_declared(file, symbol));
            if matches!(parent, Parent::Stmt(stmt) if matches!(hir[stmt].kind, StmtKind::ExportDefault(_))) {
                set(&mut found.read_unassigned, symbol);
                set(&mut found.seen_by_importers, symbol);
            }
            if how.end_of_dead_zone != 0
                && let Some(site) = how.site
                && !self.is_made_after(file, e, site, how.end_of_dead_zone)
            {
                set(&mut found.captured_early, symbol);
                if !self.is_evaluated_after(file, e, site, how.end_of_dead_zone) {
                    set(&mut found.found_early, symbol);
                }
            }
            if how.is_blank
                && let Parent::Expr(assignment) = parent
                && matches!(hir[assignment].kind, ExprKind::Assign { op: None, target, value } if target == e && self.is_plain_nil(file, value))
            {
                set(&mut found.cleared, symbol);
            }
            let is_early = hir[e].pos < how.end_of_dead_zone;
            let is_read = how.is_blank && bound.access_kind(hir, e) != AccessKind::Write;
            if !is_early && !is_read {
                continue;
            }
            let is_in_place = self.site_of(file, parent) == how.site;
            if is_early && (is_in_place || self.site_run_by(file, parent) == how.site) {
                set(&mut found.referred_to_early, symbol);
            }
            if is_read && is_in_place {
                reads.push((symbol, e));
            } else if is_read && !(how.end_of_initializer != 0 && how.site.is_some_and(|site| self.is_evaluated_after(file, e, site, how.end_of_initializer))) {
                set(&mut found.read_unassigned, symbol);
            }
        }
        for tag in [ExprTag::As, ExprTag::Satisfies] {
            for &cast in index.of(tag) {
                if bound.get_assignment_target(hir, cast).is_none() {
                    continue;
                }
                let mut target = cast;
                while let ExprKind::As { expr, .. } | ExprKind::Satisfies { expr, .. } | ExprKind::NonNull(expr) = hir[target].kind {
                    target = expr;
                }
                let symbol = bound.expr_symbol[target.idx()];
                if matches!(hir[target].kind, ExprKind::Ident(_)) && symbol.idx() < bound.symbols.len() {
                    set(&mut found.stored_through_casts, symbol);
                }
            }
        }
        for name in [crate::atom::known::exports, crate::atom::known::module] {
            if let Some(declared_again) = self.commonjs_variable_declared_again(file, name) {
                set(&mut found.stored_through_casts, declared_again.id);
            }
        }
        for &symbol in self.variables_of_reified_namespaces(file) {
            set(&mut found.stored_through_casts, symbol);
        }
        for pat in 0..hir.pats.len() {
            if let Some(symbol) = self.catch_parameter_named_again_by(file, PatId(pat as u32)) {
                set(&mut found.stored_through_casts, symbol);
                set(&mut found.stored_through_casts, bound.pat_symbol[pat]);
            }
        }
        for &(e, ..) in bound.identifiers_in_parameters.iter() {
            let symbol = bound.expr_symbol[e.idx()];
            if let Some(of) = bound.symbols.get(symbol.idx())
                && of.flags.contains(SymFlags::PARAMETER)
                && let Some(&Decl::Param(pat)) = of.decls.iter().find(|decl| matches!(decl, Decl::Param(_)))
                && self.may_find_parameter_unbound(file, pat, e)
            {
                set(&mut found.referred_to_early, symbol);
            }
        }
        if files.jsx_runtime(file).is_none() {
            for &e in index.of(ExprTag::Jsx) {
                for is_fragment_tag in [false, true] {
                    if let (_, Some(named)) = self.classic_jsx_factory(file, e, is_fragment_tag)
                        && named.file == file
                    {
                        set(&mut found.stored_through_casts, named.id);
                        set(&mut found.read_unassigned, named.id);
                        set(&mut found.found_early, named.id);
                        set(&mut found.captured_early, named.id);
                    }
                }
            }
        }
        for named in self.values_named_by_decorators(file) {
            if named.file == file {
                set(&mut found.stored_through_casts, named.id);
                set(&mut found.read_unassigned, named.id);
                set(&mut found.found_early, named.id);
                set(&mut found.captured_early, named.id);
            }
        }
        // `export { a }`: other files read it.
        for (i, export) in hir.exports.iter().enumerate() {
            if export.spec.is_some() {
                continue;
            }
            for item in export.items.iter() {
                if let Some(exported) = files.resolve_name(file, bound.export_scope[i], hir[item].local, SymFlags::VALUE)
                    && exported.file == file
                {
                    set(&mut found.read_unassigned, exported.id);
                    set(&mut found.seen_by_importers, exported.id);
                }
            }
        }
        reads.sort_unstable();
        let mut search = Search::default();
        let mut searched_for = SymbolId::NONE;
        for (symbol, e) in reads {
            if has(&found.read_unassigned, symbol) {
                continue;
            }
            if searched_for != symbol {
                (searched_for, search) = (symbol, Search::default());
            }
            if self.is_reached_without(file, bound.expr_flow[e.idx()], Store::Variable(symbol), &mut search) {
                set(&mut found.read_unassigned, symbol);
            }
        }
        // The objects of a class in JavaScript have no fields that could be typed.
        if !self.is_untyped_file(file) && !hir.classes.is_empty() {
            for tag in [ExprTag::This, ExprTag::Super] {
                found.this.extend(index.of(tag).iter().filter_map(|&e| self.use_of_this(file, e)));
            }
            found.this.sort_by_key(|&(class, ..)| class);
        }
        found
    }

    /// Whether control may get from the start of the function to `from` without passing such a store. A loop is entered before it is
    /// gone around, so the way in says all about its head.
    fn is_reached_without(&self, file: FileId, from: FlowId, store: Store, search: &mut Search) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        search.pending.clear();
        search.pending.push((from, 0));
        while let Some((mut flow, mut block)) = search.pending.pop() {
            loop {
                if flow.is_none() {
                    return true;
                }
                // What was passed before led to no start, or the search would have ended there.
                if !search.seen.insert((flow, block)) {
                    break;
                }
                flow = match bound.flow[flow.idx()] {
                    Flow::Unreachable => break,
                    Flow::Start { .. } => return true,
                    // What is called where it is written starts where the code around it has got to.
                    Flow::StartInvoked { outer, .. } => outer,
                    Flow::Assign { before, target } => {
                        let is_store = match (target, store) {
                            (FlowTarget::Var(d), Store::Variable(symbol)) => bound.pat_symbol[hir[d].pat.idx()] == symbol,
                            (FlowTarget::Pat(pat), Store::Variable(symbol)) => bound.pat_symbol[pat.idx()] == symbol,
                            (FlowTarget::Expr(e), Store::Variable(symbol)) => matches!(hir[e].kind, ExprKind::Ident(_)) && bound.expr_symbol[e.idx()] == symbol,
                            (FlowTarget::Expr(e), Store::Field(field)) => {
                                matches!(hir[e].kind, ExprKind::Dot { obj, name, .. } if name == field && matches!(hir[obj].kind, ExprKind::This))
                            }
                            _ => false,
                        };
                        if is_store && !matches!(target, FlowTarget::Expr(e) if self.is_in_default_of_assignment_pattern(file, e)) {
                            break;
                        }
                        before
                    }
                    Flow::Call { before, call } => {
                        if matches!(store, Store::Super) && matches!(hir[call].kind, ExprKind::Call(c) if matches!(hir[hir[c].callee].kind, ExprKind::Super)) {
                            break;
                        }
                        before
                    }
                    Flow::Cond { before, .. } | Flow::Switch { before, .. } | Flow::ArrayMutation { before, .. } => before,
                    Flow::Reduce { before, label, instead } => {
                        search.reduced.push((label, instead, block));
                        block = search.reduced.len() as u32;
                        before
                    }
                    Flow::Loop { start, len } => match bound.edges(start, len).first() {
                        Some(&entry) => entry,
                        None => break,
                    },
                    Flow::Label { start, len } => {
                        let mut edges = bound.edges(start, len);
                        if let Some(&(label, instead, around)) = (block as usize).checked_sub(1).and_then(|number| search.reduced.get(number))
                            && label == flow
                        {
                            edges = match bound.flow[instead.idx()] {
                                Flow::Label { start, len } => bound.edges(start, len),
                                _ => &[],
                            };
                            block = around;
                        }
                        search.pending.extend(edges.iter().map(|&edge| (edge, block)));
                        break;
                    }
                };
            }
        }
        false
    }

    // ───────────────────────────── fields ─────────────────────────────

    /// Whether the field of a class may be found to hold `undefined` though its type leaves that out. It is declared with a `?`, or
    /// somebody may read it before it is first stored to. Nobody can who has not got hold of the object, so what matters is what the
    /// code that constructs it does with `this` up to the store.
    ///
    /// `extended`: the classes of the program that the class extends, the nearest first, up to one that extends nothing. Empty for a
    /// class with an `extends` clause: it is not known what that stands for.
    ///
    /// The order: what the class extends constructs the object, then the initializers in the order of their declaration, then the
    /// parameter properties (with `assigns_fields` those come first), then what follows `super(..)`. What is answered holds for both.
    pub fn field_starts_undefined(&mut self, sym: Sym, extended: &[(FileId, ClassId)]) -> bool {
        let Some((file, decl)) = self.files().value_declaration(sym) else { return true };
        let (hir, bound) = (self.hir(file), self.bound(file));
        let (class, name, stored) = match decl {
            Decl::Member(m) => {
                let member = &hir[m];
                let MemberOwner::Class(class) = bound.member_owner[m.idx()] else { return false };
                if member.kind != MemberKind::Property {
                    return false;
                }
                if member.flags.contains(Flags::OPTIONAL) {
                    return true;
                }
                // Up to the definition of the class there is no such property.
                if member.flags.contains(Flags::STATIC) {
                    return member.init.is_none();
                }
                let (PropKey::Name(name) | PropKey::Private(name)) = member.key else { return true };
                if member.flags.intersects(Flags::ACCESSOR | Flags::AMBIENT | Flags::ABSTRACT) || self.is_field_left_out(file, m) {
                    return true;
                }
                (class, name, if member.init.is_some() { Stored::ByInitializer(m) } else { Stored::ByConstructor })
            }
            Decl::ParameterProperty(p) => {
                let Some(class) = self.class_constructed_by(file, bound.param_fn[p.idx()]) else { return true };
                let PatKind::Ident(name) = hir[hir[p].pat].kind else { return true };
                if hir[p].flags.contains(Flags::OPTIONAL) {
                    return true;
                }
                (class, name, Stored::AsParameter)
            }
            _ => return false,
        };
        if !self.is_constructed_as_written(file, class, extended) || !self.construction_keeps_this(extended) {
            return true;
        }
        // What has to have happened by the time the body of the constructor looks at the field or lets go of the object.
        let store = match stored {
            Stored::ByConstructor => Some(Store::Field(name)),
            _ if !extended.is_empty() => Some(Store::Super),
            _ => None,
        };
        let mut search = Search::default();
        for use_of_this in self.uses_of_this(file, class, extended).iter() {
            if use_of_this.reads.is_some() && use_of_this.reads != name {
                continue;
            }
            let is_early = match (use_of_this.at, stored) {
                (At::Parameters, _) => true,
                (At::Initializer(other), Stored::ByInitializer(own)) => other <= own,
                (At::Initializer(_), _) => true,
                (At::Body(flow), _) => store.is_some_and(|store| self.is_reached_without(file, flow, store, &mut search)),
            };
            if is_early {
                return true;
            }
        }
        if !matches!(stored, Stored::ByConstructor) {
            return false;
        }
        // All ways out of the constructor.
        let Some(constructor) = self.constructor_of_class(file, class) else { return true };
        self.is_reached_without(file, bound.fns[constructor.idx()].exit, Store::Field(name), &mut search)
    }

    /// The class whose constructor the function is.
    fn class_constructed_by(&self, file: FileId, func: FnId) -> Option<ClassId> {
        let bound = self.bound(file);
        if func.is_none() || self.hir(file)[func].kind != FnKind::Constructor {
            return None;
        }
        match bound.fns[func.idx()].owner {
            FnOwner::Member(m) => match bound.member_owner[m.idx()] {
                MemberOwner::Class(class) => Some(class),
                _ => None,
            },
            _ => None,
        }
    }

    /// Whether the text of the class says all that runs while it constructs an object: it is TypeScript of the program, what it extends
    /// is known, and no decorator adds to it.
    fn is_constructed_as_written(&self, file: FileId, class: ClassId, extended: &[(FileId, ClassId)]) -> bool {
        let hir = self.hir(file);
        let is_decorated = |modifiers: Span<ModifierId>| modifiers.iter().any(|modifier| matches!(hir[modifier].kind, ModifierKind::Decorator(_)));
        !self.is_untyped_file(file)
            && self.is_compiled(file)
            && !hir[class].flags.contains(Flags::AMBIENT)
            && hir[class].extends.is_some() != extended.is_empty()
            && !is_decorated(hir[class].modifiers)
            && !hir[class].members.iter().any(|member| is_decorated(hir[member].modifiers))
    }

    /// Whether nobody gets hold of an object while the first of the classes, each of which extends the next, constructs it.
    pub(super) fn construction_keeps_this(&mut self, classes: &[(FileId, ClassId)]) -> bool {
        let Some((&(file, class), extended)) = classes.split_first() else { return true };
        if let Some(&known) = self.aot.storage.keeps_this.get(&(file, class)) {
            return known;
        }
        let keeps_this = self.is_constructed_as_written(file, class, extended)
            && self.construction_keeps_this(extended)
            && self.uses_of_this(file, class, extended).iter().all(|use_of_this| use_of_this.reads.is_some());
        self.aot.storage.keeps_this.insert((file, class), keeps_this);
        keeps_this
    }

    /// What the constructor of the class and the initializers of its instance fields do with `this`, stores to fields aside.
    fn uses_of_this(&mut self, file: FileId, class: ClassId, extended: &[(FileId, ClassId)]) -> Rc<[Use]> {
        if let Some(known) = self.aot.storage.uses_of_this.get(&(file, class)) {
            return Rc::clone(known);
        }
        let found = self.storage_facts(file);
        let first = found.this.partition_point(|&(of, ..)| of < class);
        let uses: Rc<[Use]> = (found.this[first..].iter())
            .take_while(|&&(of, ..)| of == class)
            .filter_map(|&(_, at, access)| match access {
                // An access to anything but a field may run an accessor.
                Access::Reads(name) if self.is_data_field(file, class, extended, name) => Some(Use { at, reads: name }),
                Access::Stores(name) if self.is_data_field(file, class, extended, name) => None,
                _ => Some(Use { at, reads: Atom::NONE }),
            })
            .collect();
        self.aot.storage.uses_of_this.insert((file, class), Rc::clone(&uses));
        uses
    }

    /// Whether what an object of the class has by the name is a field, which is read and stored to without running any code. A class
    /// that extends this one cannot make an accessor of it: that is an error.
    fn is_data_field(&self, file: FileId, class: ClassId, extended: &[(FileId, ClassId)], name: Atom) -> bool {
        for &(file, class) in std::iter::once(&(file, class)).chain(extended) {
            let hir = self.hir(file);
            // `declare name: T` declares nothing of its own.
            let member = (hir[class].members.iter())
                .filter(|&member| !self.is_field_left_out(file, member))
                .map(|member| &hir[member])
                .find(|m| !m.flags.intersects(Flags::STATIC | Flags::AMBIENT) && matches!(m.key, PropKey::Name(key) | PropKey::Private(key) if key == name));
            if let Some(member) = member {
                return member.kind == MemberKind::Property && !member.flags.intersects(Flags::ACCESSOR | Flags::ABSTRACT);
            }
            let is_parameter_property = self.constructor_of_class(file, class).is_some_and(|constructor| {
                hir[constructor].params.iter().any(|p| hir[p].flags.contains(Flags::PARAMETER_PROPERTY) && matches!(hir[hir[p].pat].kind, PatKind::Ident(key) if key == name))
            });
            if is_parameter_property {
                return true;
            }
        }
        false
    }

    /// What the `this` or the `super` is used for, if it is that of an object under construction: the one of a constructor or of the
    /// initializer of an instance field, also from within an arrow function. `None` as well for the `super` of `super(..)`.
    fn use_of_this(&self, file: FileId, e: ExprId) -> Option<(ClassId, At, Access)> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let parent = bound.expr_parent[e.idx()];
        let is_this = matches!(hir[e].kind, ExprKind::This);
        if !is_this && matches!(parent, Parent::Expr(call) if call.is_some() && matches!(hir[call].kind, ExprKind::Call(c) if hir[c].callee == e)) {
            return None;
        }
        // An arrow function may be called as soon as it is made, which is while the statement around it runs.
        let mut is_in_arrow = false;
        let mut statement = StmtId::NONE;
        let mut at = parent;
        let (class, at) = loop {
            at = match at {
                Parent::Expr(x) if x.is_some() => bound.expr_parent[x.idx()],
                Parent::Stmt(s) if s.is_some() => {
                    if statement.is_none() {
                        statement = s;
                    }
                    bound.stmt_parent[s.idx()]
                }
                Parent::FnBody(func) if hir[func].kind == FnKind::Arrow => {
                    (is_in_arrow, statement) = (true, StmtId::NONE);
                    self.parent_of_node(file, at)
                }
                Parent::ParamDefault(p) if hir[bound.param_fn[p.idx()]].kind == FnKind::Arrow => {
                    (is_in_arrow, statement) = (true, StmtId::NONE);
                    self.parent_of_node(file, at)
                }
                Parent::FnBody(func) => {
                    let class = self.class_constructed_by(file, func)?;
                    break match statement.some() {
                        _ if !is_in_arrow => (class, At::Body(bound.expr_flow[e.idx()])),
                        Some(statement) => (class, At::Body(bound.stmt_flow[statement.idx()])),
                        None => (class, At::Parameters),
                    };
                }
                Parent::ParamDefault(p) => break (self.class_constructed_by(file, bound.param_fn[p.idx()])?, At::Parameters),
                Parent::MemberInit(m) => match bound.member_owner[m.idx()] {
                    MemberOwner::Class(class) if !hir[m].flags.contains(Flags::STATIC) => break (class, At::Initializer(m)),
                    _ => return None,
                },
                // The code around a class or a literal evaluates the names of its members, and what a class extends and is decorated with.
                Parent::MemberKey(m) => match bound.member_owner[m.idx()] {
                    MemberOwner::Class(class) => bound.class_owner[class.idx()].to_parent(),
                    _ => return None,
                },
                Parent::Decorator(class, _) | Parent::ClassExtends(class) => bound.class_owner[class.idx()].to_parent(),
                Parent::MethodKey(p) => Parent::Expr(bound.prop_owner[p.idx()]),
                Parent::None | Parent::File | Parent::Module(_) => return None,
                _ => self.parent_of_node(file, at),
            };
        };
        let access = match parent {
            Parent::Expr(access) if access.is_some() && is_this && !is_in_arrow => access,
            _ => return Some((class, at, Access::LetsGo)),
        };
        let ExprKind::Dot { name, .. } = hir[access].kind else { return Some((class, at, Access::LetsGo)) };
        // `this.name(..)`, also as `this.name!(..)`, hands `this` to what is called.
        let mut callee = access;
        while let Parent::Expr(outer) = bound.expr_parent[callee.idx()]
            && outer.is_some()
            && matches!(hir[outer].kind, ExprKind::NonNull(_) | ExprKind::As { .. } | ExprKind::Satisfies { .. })
        {
            callee = outer;
        }
        let is_called = matches!(bound.expr_parent[callee.idx()], Parent::Expr(call)
            if call.is_some() && matches!(hir[call].kind, ExprKind::Call(c) | ExprKind::TaggedTemplate(c) if hir[c].callee == callee));
        let access = match bound.access_kind(hir, access) {
            _ if is_called => Access::LetsGo,
            AccessKind::Write => Access::Stores(name),
            AccessKind::Read | AccessKind::ReadWrite => Access::Reads(name),
        };
        Some((class, at, access))
    }
}
