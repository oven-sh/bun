//! What JavaScript probably does: predictions, which nothing relies on.
//!
//! Where nobody has written a type down, the checker says `any`: of a parameter of a JavaScript function, and so of all that is computed
//! from it. A prediction says what such a value is likely to be. It starts from the checker's own type of an expression, a variable or a
//! property. Where that says nothing it goes by what the program does: a parameter is what the calls of the function pass, a variable is
//! what is stored to it, a call yields what the function returns, an object made with `new` from a function has what is stored to `this`
//! there. All of it may be wrong, and compiled code has to do the right thing when it is.

use crate::atom::{Atom, known};
use crate::bind::{Decl, Parent, PatParent, SymFlags, SymbolId};
use crate::check::Checker;
use crate::hir::{BinOp, CallId, ExprId, ExprKind, FileKind, Flags, FnBody, FnId, FnKind, MemberKind, ParamId, PatId, PatKind, PropKey, PropKind, StmtKind, UnOp};
use super::kinds::kind;
use crate::program::{FileId, Sym};
use crate::types::{MapperId, Origin, Prop, PropFlags, PropSource, Shape, TypeData, TypeId};
use crate::util::InParallel;
use bun_alloc::vec_from_iter_in;
use bun_threading::Guarded;
use rustc_hash::{FxHashMap, FxHashSet};
use std::rc::Rc;
use super::OnceLock;

const FILES_PER_CHECKER: usize = 32;

/// Of the calls of a function, this many say what its parameters are.
const MAX_CALLS: usize = 32;
/// One prediction asks for another this many times over. Beyond that nothing is found.
const MAX_DEPTH: usize = 48;
const MAX_CYCLE_ROUNDS: usize = 4;
const MAX_CYCLE_MEMBERS: usize = 1 << 14;
const MAX_PREDICTED_UNION_MEMBERS: usize = 1024;

type Function = (FileId, FnId);

/// Where the code of an import is. The checker resolves an import for its types, often to a declaration file. Which code runs is up to
/// the bundler.
#[derive(Copy, Clone)]
pub enum ImportedCode {
    /// The binding of the program that holds its value.
    Binding(Sym),
    /// What the file exports under the name. No name: all that it exports.
    Export(FileId, Option<Atom>),
}

/// What a prediction is made of.
#[derive(Copy, Clone, PartialEq, Eq, Hash)]
enum Subject {
    Expr(FileId, ExprId),
    /// `F.prototype.name`, by what the program stores there.
    Member(FileId, ExprId),
    /// What a parameter, a variable or a part of a pattern is bound to.
    Pat(FileId, PatId),
    /// What a variable or a property holds over its whole life.
    Symbol(Sym),
    /// What a call of the function yields.
    Result(FileId, FnId),
    /// What `new` makes from the function, which is no class.
    Instance(FileId, FnId),
}

/// The key or the value of a keyed store, or what a call passes for it.
#[derive(Copy, Clone, PartialEq, Eq, Hash)]
enum Passed {
    Key(Atom),
    Closure(Function),
    /// What the function is handed for the parameter of that number.
    Parameter(Function, usize),
}

/// A constructor function inherits from another this many times over.
const MAX_INHERITED: usize = 8;

/// A parameter is followed to the calls of its function this many times over.
const MAX_FORWARDED: usize = 4;

/// What one file does with the functions of the program, each list in the order of the file. It takes the types of the file to find. It
/// mentions none, nor anything else that is numbered by task.
#[derive(Default)]
struct FileFunctionUses {
    /// A function, and a call or a `new` expression whose callee the checker takes for it.
    calls: Vec<(Function, ExprId)>,
    /// A function, a call that hands it its arguments, `process.nextTick(f, a, b)`, `f.call(receiver, a, b)`, and the number of the first of them.
    passed_arguments: Vec<(Function, ExprId, usize)>,
    /// A parameter, and a call whose callee is its name.
    parameter_calls: Vec<((FileId, ParamId), ExprId)>,
    /// A function, the function it is passed to, and as which argument.
    passed_to: Vec<(Function, Function, usize)>,
    /// A function of the file, and the `F` on whose `prototype` it is put.
    constructors: Vec<(FnId, Function)>,
    /// `F`, and the name and the value of what is stored to a property of `F.prototype`.
    members: Vec<(Function, Atom, ExprId)>,
    /// The function of the file whose `this` a property is stored to, and the name and the value.
    this_stores: Vec<(FnId, Atom, ExprId)>,
    /// `X.name[key] = value`: the name, the key and the value.
    keyed_stores: Vec<(Atom, Passed, Passed)>,
    /// `S`, and the `F` whose `prototype` that of `S` inherits from.
    heirs: Vec<(Function, Function)>,
}

/// What files do with the functions of the program: all of them, or one.
#[derive(Default)]
struct Uses {
    /// By function: the calls and the `new` expressions whose callee the checker takes for it, in the order of the files. By the
    /// constructor of a class: the `new` expressions and the `super` calls.
    calls: CallSites,
    /// By function: the calls that hand it its arguments, and the number of the first of them.
    passed_arguments: FxHashMap<Function, Vec<(FileId, ExprId, usize)>>,
    /// By parameter: the calls whose callee is its name.
    parameter_calls: FxHashMap<(FileId, ParamId), Vec<(FileId, ExprId)>>,
    /// By function: the functions it is passed to where it is written or named as an argument of a call, and as which argument.
    passed_to: FxHashMap<Function, Vec<(Function, usize)>>,
    /// By function that is stored to a property of `F.prototype`, or is a member of the literal that is stored to `F.prototype`: `F`.
    constructors: FxHashMap<Function, Function>,
    /// By function that is no class: the names and the values of what is stored to the properties of its `prototype`, and to those of
    /// `this` in it and in the functions that `constructors` has for it.
    members: FxHashMap<Function, Vec<(Atom, FileId, ExprId)>>,
    /// `FileFunctionUses::keyed_stores`, in the order of the files.
    keyed_stores: Vec<(Atom, Passed, Passed)>,
    /// By function that is no class: the function whose `prototype` its own inherits from. The first that the program says.
    inherits_from: FxHashMap<Function, Function>,
}

#[derive(Default)]
struct CallSites {
    shards: Vec<FxHashMap<Function, Vec<(FileId, ExprId)>>>,
}

impl CallSites {
    const PARALLEL_SHARDS: usize = 6;
    const MIN_FILES_FOR_PARALLEL_MERGE: usize = 512;

    fn fill_shard(shard: &mut FxHashMap<Function, Vec<(FileId, ExprId)>>, number: usize, shard_count: usize, parts: &[(FileId, &FileFunctionUses)]) {
        for &(file, part) in parts {
            for &(function, e) in &part.calls {
                if function.0.idx() % shard_count == number {
                    shard.entry(function).or_default().push((file, e));
                }
            }
        }
    }

    fn get(&self, function: Function) -> &[(FileId, ExprId)] {
        match self.shards.len() {
            0 => &[],
            shard_count => self.shards[function.0.idx() % shard_count].get(&function).map_or(&[], |calls| calls),
        }
    }
}

impl Uses {
    /// `parts`: in the order that the lists are to be in. `kind_of`: of a function of the program.
    fn new(parts: &[(FileId, &FileFunctionUses)], kind_of: impl Fn(FileId, FnId) -> FnKind) -> Uses {
        let mut uses = Uses::default();
        let shard_count = if parts.len() >= CallSites::MIN_FILES_FOR_PARALLEL_MERGE { CallSites::PARALLEL_SHARDS } else { 1 };
        let mut shards: Vec<FxHashMap<Function, Vec<(FileId, ExprId)>>> = (0..shard_count).map(|_| FxHashMap::default()).collect();
        if shard_count == 1 {
            CallSites::fill_shard(&mut shards[0], 0, 1, parts);
            uses.fill_all_but_calls(parts);
        } else {
            std::thread::scope(|scope| {
                for (number, shard) in shards.iter_mut().enumerate() {
                    scope.spawn(move || CallSites::fill_shard(shard, number, shard_count, parts));
                }
                uses.fill_all_but_calls(parts);
            });
        }
        uses.calls = CallSites { shards };
        // Once it is known which functions are on the `prototype` of which.
        for &(file, part) in parts {
            for &(func, name, value) in &part.this_stores {
                if let Some(constructor) = uses.constructor_for_method(file, func, kind_of(file, func)) {
                    uses.members.entry(constructor).or_default().push((name, file, value));
                }
            }
        }
        uses
    }

    fn fill_all_but_calls(&mut self, parts: &[(FileId, &FileFunctionUses)]) {
        let uses = self;
        for &(file, part) in parts {
            for &(function, e, first) in &part.passed_arguments {
                uses.passed_arguments.entry(function).or_default().push((file, e, first));
            }
            for &(parameter, e) in &part.parameter_calls {
                uses.parameter_calls.entry(parameter).or_default().push((file, e));
            }
            for &(passed, to, position) in &part.passed_to {
                uses.passed_to.entry(passed).or_default().push((to, position));
            }
            for &(method, constructor) in &part.constructors {
                uses.constructors.insert((file, method), constructor);
            }
            for &(constructor, name, value) in &part.members {
                uses.members.entry(constructor).or_default().push((name, file, value));
            }
            uses.keyed_stores.extend_from_slice(&part.keyed_stores);
            for &(heir, base) in &part.heirs {
                uses.inherits_from.entry(heir).or_insert(base);
            }
        }
    }

    /// The calls of the function, and those that hand it its arguments: each with the number of the argument that is the first for the function.
    fn calls_with_arguments(&self, function: Function) -> Vec<(FileId, ExprId, usize)> {
        self.first_calls_with_arguments(function, usize::MAX)
    }

    fn first_calls_with_arguments(&self, function: Function, most: usize) -> Vec<(FileId, ExprId, usize)> {
        let calls = self.calls.get(function).iter().map(|&(file, e)| (file, e, 0));
        calls.chain(self.passed_arguments.get(&function).into_iter().flatten().copied()).take(most).collect()
    }

    /// The function that makes the objects that are `this` in `func`, if `func` is called the way it looks.
    fn constructor_for_method(&self, file: FileId, func: FnId, kind: FnKind) -> Option<Function> {
        match self.constructors.get(&(file, func)) {
            Some(&constructor) => Some(constructor),
            None => matches!(kind, FnKind::Decl | FnKind::Expr).then_some((file, func)),
        }
    }
}

#[derive(Default)]
pub(super) struct Shared {
    /// `set_imported_code`
    imported_code: OnceLock<FxHashMap<Sym, ImportedCode>>,
    /// `set_declaration_only_files`
    declaration_only_file_set: OnceLock<FxHashSet<FileId>>,
    /// `called_imports`
    called_imports: OnceLock<Vec<Sym>>,
    /// By file: what `record_function_uses_in` has found last. Emptied by `merge_recorded_function_uses`.
    noted: OnceLock<Box<[Guarded<Option<FileFunctionUses>>]>>,
    /// Of all files, once they are merged.
    uses: OnceLock<Uses>,
}

/// The uses that predictions go by.
enum KnownUses<'p> {
    OfProgram(&'p Uses),
    OfFile(Rc<Uses>),
}

impl std::ops::Deref for KnownUses<'_> {
    type Target = Uses;

    fn deref(&self) -> &Uses {
        match self {
            KnownUses::OfProgram(uses) => uses,
            KnownUses::OfFile(uses) => uses,
        }
    }
}

#[derive(Copy, Clone)]
enum Predicted {
    Known(Option<TypeId>),
    InProgress(usize),
    Provisional(Option<TypeId>, usize),
}

#[derive(Default)]
struct Predictions {
    file: Option<FileId>,
    expr_predictions: Vec<Option<Predicted>>,
    pattern_predictions: Vec<Option<Predicted>>,
    of_symbols: Vec<Option<Predicted>>,
    result_predictions: Vec<Option<Predicted>>,
    instance_predictions: Vec<Option<Predicted>>,
    other_predictions: FxHashMap<Subject, Predicted>,
    other_prediction_files: FxHashSet<FileId>,
    has_other_predictions_for_file: bool,
}

impl Predictions {
    fn switch_to_file(&mut self, file: FileId, expressions: usize, patterns: usize, symbols: usize, functions: usize) {
        if self.file == Some(file) {
            return;
        }
        if let Some(before) = self.file.replace(file) {
            let mut is_any_kept = false;
            for (at, known) in self.expr_predictions.drain(..).enumerate() {
                if let Some(known) = known {
                    self.other_predictions.insert(Subject::Expr(before, ExprId(at as u32)), known);
                    is_any_kept = true;
                }
            }
            for (at, known) in self.pattern_predictions.drain(..).enumerate() {
                if let Some(known) = known {
                    self.other_predictions.insert(Subject::Pat(before, PatId(at as u32)), known);
                    is_any_kept = true;
                }
            }
            for (at, known) in self.of_symbols.drain(..).enumerate() {
                if let Some(known) = known {
                    self.other_predictions.insert(Subject::Symbol(Sym { file: before, id: SymbolId(at as u32) }), known);
                    is_any_kept = true;
                }
            }
            for (at, known) in self.result_predictions.drain(..).enumerate() {
                if let Some(known) = known {
                    self.other_predictions.insert(Subject::Result(before, FnId(at as u32)), known);
                    is_any_kept = true;
                }
            }
            for (at, known) in self.instance_predictions.drain(..).enumerate() {
                if let Some(known) = known {
                    self.other_predictions.insert(Subject::Instance(before, FnId(at as u32)), known);
                    is_any_kept = true;
                }
            }
            if is_any_kept {
                self.other_prediction_files.insert(before);
            }
        }
        self.expr_predictions.resize(expressions, None);
        self.pattern_predictions.resize(patterns, None);
        self.of_symbols.resize(symbols, None);
        self.result_predictions.resize(functions, None);
        self.instance_predictions.resize(functions, None);
        self.has_other_predictions_for_file = self.other_prediction_files.contains(&file);
    }

    #[inline]
    fn place_of(&mut self, subject: &Subject) -> Option<&mut Option<Predicted>> {
        match *subject {
            Subject::Expr(file, e) if Some(file) == self.file => self.expr_predictions.get_mut(e.idx()),
            Subject::Pat(file, pat) if Some(file) == self.file => self.pattern_predictions.get_mut(pat.idx()),
            Subject::Symbol(sym) if Some(sym.file) == self.file => self.of_symbols.get_mut(sym.id.idx()),
            Subject::Result(file, func) if Some(file) == self.file => self.result_predictions.get_mut(func.idx()),
            Subject::Instance(file, func) if Some(file) == self.file => self.instance_predictions.get_mut(func.idx()),
            _ => None,
        }
    }

    #[inline]
    fn get(&self, subject: &Subject) -> Option<&Predicted> {
        let place = match *subject {
            Subject::Expr(file, e) if Some(file) == self.file => self.expr_predictions.get(e.idx()),
            Subject::Pat(file, pat) if Some(file) == self.file => self.pattern_predictions.get(pat.idx()),
            Subject::Symbol(sym) if Some(sym.file) == self.file => self.of_symbols.get(sym.id.idx()),
            Subject::Result(file, func) if Some(file) == self.file => self.result_predictions.get(func.idx()),
            Subject::Instance(file, func) if Some(file) == self.file => self.instance_predictions.get(func.idx()),
            _ => None,
        };
        match place {
            Some(Some(known)) => Some(known),
            Some(None) if !self.has_other_predictions_for_file => None,
            _ => self.other_predictions.get(subject),
        }
    }

    fn insert(&mut self, subject: Subject, predicted: Predicted) {
        if let Some(place) = self.place_of(&subject) {
            *place = Some(predicted);
            return;
        }
        let file = match subject {
            Subject::Expr(file, _) | Subject::Member(file, _) | Subject::Pat(file, _) | Subject::Result(file, _) | Subject::Instance(file, _) => file,
            Subject::Symbol(sym) => sym.file,
        };
        self.other_prediction_files.insert(file);
        self.other_predictions.insert(subject, predicted);
    }

    fn remove(&mut self, subject: &Subject) {
        if let Some(place) = self.place_of(subject)
            && place.is_some()
        {
            *place = None;
            return;
        }
        self.other_predictions.remove(subject);
    }
}

/// What has been predicted so far. It belongs to a checker: the types are its own.
pub(super) struct State {
    /// The file whose uses have been noted last, and those, once they have been asked for. They count until those of all files are
    /// merged.
    last_recorded_file: Option<FileId>,
    current_file_uses: Option<Rc<Uses>>,
    /// `constructor_uses_in`, by file.
    constructor_uses_by_file: FxHashMap<FileId, Rc<Uses>>,
    predictions: Predictions,
    depth: usize,
    provisional: Vec<Subject>,
    deferred: Vec<Subject>,
    previous_round: FxHashMap<Subject, Option<TypeId>>,
    /// The index of the outermost prediction in progress that the innermost one has asked for. `usize::MAX`: none.
    outermost_requested: usize,
    declared: super::ByExpression<bool>,
    predicted: super::ByExpression<Option<TypeId>>,
    calls_passing_arguments: FxHashMap<Function, Rc<[(FileId, ExprId, usize)]>>,
    are_program_calls: bool,
    predicted_by_use: super::ByExpression<Option<TypeId>>,
    property_types: FxHashMap<(TypeId, Atom, bool), Option<TypeId>>,
    index_types: FxHashMap<(TypeId, TypeId), Option<TypeId>>,
    narrowed: FxHashMap<(FileId, ExprId, TypeId), Option<TypeId>>,
}

impl State {
    pub(super) fn is_idle(&self) -> bool {
        self.depth == 0
    }

    pub(super) fn enable_expr_cache_for(&mut self, file: FileId, expressions: usize, patterns: usize, symbols: usize, functions: usize) {
        self.predictions.switch_to_file(file, expressions, patterns, symbols, functions);
        self.declared.switch_to_file(file, expressions, false);
        self.predicted.switch_to_file(file, expressions, None);
        self.predicted_by_use.switch_to_file(file, expressions, None);
    }

    pub(super) fn clear_expr_cache(&mut self) {
        self.declared.clear();
        self.predicted.clear();
        self.predicted_by_use.clear();
    }
}

impl Default for State {
    fn default() -> State {
        State {
            last_recorded_file: None,
            current_file_uses: None,
            constructor_uses_by_file: FxHashMap::default(),
            predictions: Predictions::default(),
            depth: 0,
            provisional: Vec::new(),
            deferred: Vec::new(),
            previous_round: FxHashMap::default(),
            outermost_requested: usize::MAX,
            declared: Default::default(),
            predicted: Default::default(),
            calls_passing_arguments: FxHashMap::default(),
            are_program_calls: false,
            predicted_by_use: Default::default(),
            property_types: FxHashMap::default(),
            index_types: FxHashMap::default(),
            narrowed: FxHashMap::default(),
        }
    }
}

impl<'p, 's> Checker<'p, 's> {
    // ───────────────────────────── what is only inferred ─────────────────────────────

    pub fn is_untyped_file(&self, file: FileId) -> bool {
        self.files.module(file).is_untyped()
    }

    /// Whether the type is that of an object, a function or a class of a JavaScript file: what the checker makes of code that it does not
    /// hold to anything.
    pub fn is_inferred_from_javascript(&self, ty: TypeId) -> bool {
        match self.data(ty) {
            TypeData::Anon { origin, .. } => {
                let file = match *origin {
                    Origin::TypeLiteral(file, _) | Origin::Mapped(file, _) | Origin::ObjectLiteral(file, ..) | Origin::WidenedLiteral(file, ..) => file,
                    Origin::ClassStatic(sym) | Origin::Function(sym) | Origin::EnumObject(sym) | Origin::Module(sym) => sym.file,
                    Origin::Namespace { module, .. } => module.file,
                    Origin::GlobalThis => return false,
                };
                self.is_untyped_file(file)
            }
            TypeData::Fns { decls, .. } => decls.iter().any(|&(file, _)| self.is_untyped_file(file)),
            TypeData::Ref { target, .. } => self.is_untyped_file(target.file),
            TypeData::Union(parts) | TypeData::Intersection(parts) => parts.iter().any(|&part| self.is_inferred_from_javascript(part)),
            _ => false,
        }
    }

    /// Whether the program is held to the checker's type of the expression. In JavaScript nothing is declared: the types are what the
    /// checker infers. That goes for what TypeScript reads from an object or gets from a function of JavaScript too.
    pub fn has_declared_type(&mut self, file: FileId, e: ExprId) -> bool {
        if self.is_untyped_file(file) {
            return false;
        }
        if let Some(&known) = self.aot.javascript.declared.get((file, e)) {
            return known;
        }
        let asked = self.begin_query();
        let found = self.find_has_declared_type(file, e);
        if self.is_assumption_free(asked) {
            self.aot.javascript.declared.insert((file, e), found);
        }
        found
    }

    fn find_has_declared_type(&mut self, file: FileId, e: ExprId) -> bool {
        let hir = self.hir(file);
        // A declaration without a body is a prediction: see `trust.rs`.
        if self.unverified_claim(file, e).is_some() {
            return false;
        }
        // So is the type of what the program is given. A cast goes by its operand: see `result_type_of`.
        if !matches!(hir[e].kind, ExprKind::As { .. }) {
            let own = self.type_of_expr(file, e);
            if self.has_tainted_part(own) {
                return false;
            }
        }
        let source = match hir[e].kind {
            ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => obj,
            ExprKind::Call(call) | ExprKind::New(call) | ExprKind::TaggedTemplate(call) => hir[call].callee,
            // An import is declared where the module it is resolved to for its types is.
            ExprKind::Ident(name) => {
                let found = self.symbol_of_identifier(file, e, name);
                let import = found.filter(|&found| self.files.flags(found).contains(SymFlags::ALIAS));
                return import.is_none_or(|import| self.files.resolve_alias(import).is_some_and(|target| !self.is_untyped_file(target.file)));
            }
            ExprKind::Object(props) => return !props.iter().any(|p| hir[p].kind == PropKind::Spread && self.spread_type_exceeds_copied_properties(file, hir[p].value)),
            _ => return true,
        };
        let ty = self.type_of_expr(file, source);
        if self.parts(ty).iter().copied().all(|part| self.is_nullish(part)) {
            return false;
        }
        // `C.prototype` is declared to be a `C`, and `Map.prototype` a `Map<any, any>`. Neither is one.
        if matches!(hir[e].kind, ExprKind::Dot { name: known::prototype, .. }) && self.members(ty).is_some_and(|members| !members.shape().construct.is_empty()) {
            return false;
        }
        !self.is_inferred_from_javascript(ty)
    }

    // ───────────────────────────── predictions ─────────────────────────────

    /// What the value of the expression probably is. `None`: nothing is known of it.
    pub fn predicted_expr_type(&mut self, file: FileId, e: ExprId) -> Option<TypeId> {
        if let Some(&known) = self.aot.javascript.predicted.get((file, e)) {
            return known;
        }
        let asked = self.assumes_only_predictions();
        let around = std::mem::replace(&mut self.aot.javascript.outermost_requested, usize::MAX);
        let found = self.find_predicted_expr_type(file, e);
        let rests_on = self.aot.javascript.outermost_requested;
        self.aot.javascript.outermost_requested = around.min(rests_on);
        if rests_on == usize::MAX && self.is_result_cacheable(asked) {
            self.aot.javascript.predicted.insert((file, e), found);
        }
        found
    }

    fn find_predicted_expr_type(&mut self, file: FileId, e: ExprId) -> Option<TypeId> {
        let checked = self.type_of_expr(file, e);
        // What the program stores on a prototype says more than `any`, and more than a declaration without a body.
        if matches!(self.hir(file)[e].kind, ExprKind::Dot { .. })
            && self.function_for_type(checked).is_none()
            && let Some(stored) = self.predict(Subject::Member(file, e))
        {
            return Some(stored);
        }
        match self.informative_type(checked) {
            Some(checked) => Some(checked),
            None => self.predict(Subject::Expr(file, e)).or_else(|| self.predicted_by_use(file, e)),
        }
    }

    /// `fiber.flags & 4`, `a.index < 10`, `-x.n`, `x.lanes |= lane`: what is only good for a number where it stands is expected to be one. Not an operand of `+`, which is as likely a
    /// string.
    fn predicted_by_use(&mut self, file: FileId, e: ExprId) -> Option<TypeId> {
        if let Some(&known) = self.aot.javascript.predicted_by_use.get((file, e)) {
            return known;
        }
        let asked = self.assumes_only_predictions();
        let around = std::mem::replace(&mut self.aot.javascript.outermost_requested, usize::MAX);
        let found = self.find_predicted_by_use(file, e);
        let rests_on = self.aot.javascript.outermost_requested;
        self.aot.javascript.outermost_requested = around.min(rests_on);
        if rests_on == usize::MAX && self.is_result_cacheable(asked) {
            self.aot.javascript.predicted_by_use.insert((file, e), found);
        }
        found
    }

    fn find_predicted_by_use(&mut self, file: FileId, e: ExprId) -> Option<TypeId> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        // Of an array, a string, a function, a typed array.
        if matches!(hir[e].kind, ExprKind::Dot { name, .. } if name == known::length) {
            return Some(TypeId::NUMBER);
        }
        if matches!(hir[e].kind, ExprKind::Ident(_))
            && let Some(id) = bound.expr_symbol[e.idx()].some()
            && self.is_used_as_string(Sym { file, id })
        {
            return Some(TypeId::STRING);
        }
        let Parent::Expr(parent) = bound.expr_parent[e.idx()] else { return None };
        match hir[parent].kind {
            ExprKind::Dot { obj, name, .. } if obj == e && self.is_string_only_method(name) => return Some(TypeId::STRING),
            ExprKind::Call(call) => {
                if let ExprKind::Dot { name, .. } = hir[hir[call].callee].kind
                    && let Some(index) = hir.ids(hir[call].args).position(|arg| arg == e)
                {
                    let takes_number = match self.atoms().bytes(name) {
                        b"charCodeAt" | b"codePointAt" | b"charAt" | b"at" | b"padStart" | b"padEnd" | b"repeat" => index == 0,
                        b"slice" | b"substring" | b"substr" => index < 2,
                        b"indexOf" | b"lastIndexOf" | b"includes" | b"startsWith" | b"endsWith" => index == 1,
                        _ => false,
                    };
                    if takes_number {
                        return Some(TypeId::NUMBER);
                    }
                }
            }
            _ => {}
        }
        if let ExprKind::Index { obj, index, .. } = hir[parent].kind
            && obj == e
            && self.result_kinds_of(file, index) == kind::NUMBER
        {
            // A name goes by all that is done with it: `s[i]` beside `s.charCodeAt(i)` is a string.
            let is_array = match bound.expr_symbol[e.idx()].some() {
                Some(id) => self.is_used_as_array(Sym { file, id }),
                None => true,
            };
            return is_array.then(|| self.array_of(TypeId::ANY));
        }
        let is_for_numbers = |op: BinOp| matches!(op, BinOp::Sub | BinOp::Mul | BinOp::Div | BinOp::Rem | BinOp::Pow | BinOp::Shl | BinOp::Shr | BinOp::UShr | BinOp::BitAnd | BinOp::BitOr | BinOp::BitXor);
        let is_number = match hir[parent].kind {
            ExprKind::Binary { op, .. } if is_for_numbers(op) => true,
            ExprKind::Binary { op: BinOp::Lt | BinOp::Le | BinOp::Gt | BinOp::Ge, left, right } => self.result_kinds_of(file, if left == e { right } else { left }) == kind::NUMBER,
            // Beside a number a number is the likelier.
            ExprKind::Binary { op: BinOp::Add, left, right } => self.result_kinds_of(file, if left == e { right } else { left }) == kind::NUMBER,
            ExprKind::Assign { op: Some(BinOp::Add), target, value } => self.result_kinds_of(file, if target == e { value } else { target }) == kind::NUMBER,
            ExprKind::Assign { op: Some(op), .. } => is_for_numbers(op),
            // `Math.floor(x)` makes a number of whatever it is handed.
            ExprKind::Call(call) => hir[call].callee != e && matches!(hir[hir[call].callee].kind, ExprKind::Dot { obj, .. } if self.refers_to_global_object(file, obj, b"Math")),
            ExprKind::Unary { op: UnOp::Minus | UnOp::BitNot | UnOp::Plus | UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec, .. } => true,
            _ => false,
        };
        is_number.then_some(TypeId::NUMBER)
    }

    /// What the variable or the property probably holds, at any time.
    pub fn predicted_symbol_type(&mut self, sym: Sym) -> Option<TypeId> {
        let sym = match self.files.flags(sym).contains(SymFlags::ALIAS) {
            true => self.files.resolve_alias(sym).unwrap_or(sym),
            false => sym,
        };
        let checked = self.type_of_symbol(sym);
        match self.informative_type(checked) {
            Some(checked) => Some(checked),
            None => self.predict(Subject::Symbol(sym)),
        }
    }

    /// What the function is probably handed for the parameter.
    pub fn predicted_param_type(&mut self, file: FileId, p: ParamId) -> Option<TypeId> {
        let pat = self.hir(file)[p].pat;
        self.predicted_pat_type(file, pat)
    }

    /// What the name or the pattern is probably bound to.
    pub fn predicted_pat_type(&mut self, file: FileId, pat: PatId) -> Option<TypeId> {
        let checked = self.type_of_pat(file, pat);
        match self.informative_type(checked) {
            Some(checked) => Some(checked),
            None => self.predict(Subject::Pat(file, pat)),
        }
    }

    /// The function of the program that the values of the type are closures of, nil aside: the type is that of one function declaration,
    /// function expression or method. Another function may have been stored where the checker has this type, so it is a prediction too.
    pub fn function_for_type(&self, ty: TypeId) -> Option<(FileId, FnId)> {
        let mut parts = self.parts(ty).iter().filter(|&&part| !self.is_nullish(part));
        let &only = parts.next()?;
        if parts.next().is_some() {
            return None;
        }
        let (file, func) = match self.data(only) {
            TypeData::Fns { decls, .. } => self.single_with_body(decls.iter().copied())?,
            // `declare class F { .. }` beside `function F(..) { .. }` too.
            TypeData::Anon { origin: Origin::Function(sym) | Origin::ClassStatic(sym), .. } => {
                let declarations = self.files.decls(*sym).into_iter().filter_map(|(file, decl)| match decl {
                    Decl::Fn(func) => Some((file, func)),
                    _ => None,
                });
                self.single_with_body(declarations)?
            }
            _ => return None,
        };
        matches!(self.hir(file)[func].kind, FnKind::Decl | FnKind::Expr | FnKind::Arrow | FnKind::Method).then_some((file, func))
    }

    /// The function of the program that the value of the expression is probably a closure of.
    pub fn predicted_expr_function(&mut self, file: FileId, e: ExprId) -> Option<(FileId, FnId)> {
        if let Some(code) = self.imported_code_type(file, e)
            && let Some(function) = self.function_for_type(code)
        {
            return Some(function);
        }
        let expected = self.predicted_expr_type(file, e)?;
        self.function_for_type(expected)
    }

    fn single_with_body(&self, functions: impl Iterator<Item = Function>) -> Option<Function> {
        let mut with_body = functions.filter(|&(file, func)| !matches!(self.hir(file)[func].body, FnBody::None));
        let only = with_body.next()?;
        with_body.next().is_none().then_some(only)
    }

    /// What runs when a value of the type is constructed: the constructor that a class of the program declares, or a function.
    fn constructed_function(&self, ty: TypeId) -> Option<Function> {
        let TypeData::Anon { origin: Origin::ClassStatic(sym), .. } = self.data(ty) else {
            return self.function_for_type(ty);
        };
        let constructor = self.files.decls(*sym).into_iter().find_map(|(file, decl)| {
            let Decl::Class(class) = decl else { return None };
            Some((file, self.class_constructor(file, class)?))
        });
        constructor.or_else(|| self.function_for_type(ty))
    }

    fn invoked_function(&self, ty: TypeId, constructs: bool) -> Option<Function> {
        match constructs {
            true => self.constructed_function(ty),
            false => self.function_for_type(ty),
        }
    }

    /// The type, if a value is known for what it is by it.
    fn informative_type(&self, ty: TypeId) -> Option<TypeId> {
        (!self.is_uninformative(ty) && !self.is_any(ty) && self.parts(ty).len() <= MAX_PREDICTED_UNION_MEMBERS).then_some(ty)
    }

    /// Any of the types. Where nothing has been found there is none to give, and that is left out: what is known of the rest stands.
    fn either(&mut self, found: &[TypeId]) -> Option<TypeId> {
        let ty = self.union(found);
        self.informative_type(ty)
    }

    fn add(&mut self, found: &mut Vec<TypeId>, ty: Option<TypeId>) {
        if let Some(ty) = ty {
            let ty = self.regular(ty);
            found.push(ty);
        }
    }

    fn find_prediction(&mut self, subject: Subject) -> Option<TypeId> {
        match subject {
            Subject::Expr(file, e) => self.predict_expr(file, e),
            Subject::Member(file, e) => self.predict_prototype_member(file, e),
            Subject::Pat(file, pat) => self.predict_pat(file, pat),
            Subject::Symbol(sym) => self.predict_symbol(sym),
            Subject::Result(file, func) => self.predict_result(file, func),
            Subject::Instance(file, func) => self.predict_instance(file, func),
        }
    }

    fn predict(&mut self, subject: Subject) -> Option<TypeId> {
        let state = &mut self.aot.javascript;
        match state.predictions.get(&subject) {
            Some(&Predicted::Known(known)) => return known,
            Some(&Predicted::InProgress(at)) => {
                state.outermost_requested = state.outermost_requested.min(at);
                return state.previous_round.get(&subject).copied().flatten();
            }
            Some(&Predicted::Provisional(found, outermost)) => {
                state.outermost_requested = state.outermost_requested.min(outermost);
                return found;
            }
            None => {}
        }
        let depth = state.depth;
        if depth == MAX_DEPTH {
            state.outermost_requested = 0;
            state.deferred.push(subject);
            return state.previous_round.get(&subject).copied().flatten();
        }
        let around = std::mem::replace(&mut state.outermost_requested, usize::MAX);
        let first_member = state.provisional.len();
        state.predictions.insert(subject, Predicted::InProgress(depth));
        state.depth += 1;
        let mut found = self.find_prediction(subject);
        let state = &mut self.aot.javascript;
        state.depth -= 1;
        let outermost = state.outermost_requested;
        if outermost < depth {
            state.predictions.insert(subject, Predicted::Provisional(found, outermost));
            state.provisional.push(subject);
            state.outermost_requested = around.min(outermost);
            return found;
        }
        if outermost != usize::MAX {
            found = self.resolve_cycle(subject, depth, first_member, found);
        }
        let state = &mut self.aot.javascript;
        state.predictions.insert(subject, Predicted::Known(found));
        state.outermost_requested = around;
        if depth == 0 {
            state.previous_round.clear();
        }
        found
    }

    fn resolve_cycle(&mut self, root: Subject, depth: usize, first_member: usize, mut found: Option<TypeId>) -> Option<TypeId> {
        self.predict_deferred(depth, first_member);
        for _ in 1..MAX_CYCLE_ROUNDS {
            let state = &mut self.aot.javascript;
            state.previous_round.insert(root, found);
            for index in first_member..state.provisional.len() {
                let member = state.provisional[index];
                if let Some(&Predicted::Provisional(value, _)) = state.predictions.get(&member) {
                    state.previous_round.insert(member, value);
                    state.predictions.remove(&member);
                }
            }
            state.provisional.truncate(first_member);
            state.depth = depth + 1;
            state.outermost_requested = usize::MAX;
            let recomputed = self.find_prediction(root);
            self.aot.javascript.depth = depth;
            self.predict_deferred(depth, first_member);
            let state = &self.aot.javascript;
            let is_stable = recomputed == found
                && state.provisional[first_member..].iter().all(|member| match state.predictions.get(member) {
                    Some(&Predicted::Provisional(value, _)) => state.previous_round.get(member) == Some(&value),
                    _ => true,
                });
            found = recomputed;
            if is_stable {
                break;
            }
        }
        let state = &mut self.aot.javascript;
        for index in first_member..state.provisional.len() {
            let member = state.provisional[index];
            if let Some(&Predicted::Provisional(value, _)) = state.predictions.get(&member) {
                state.predictions.insert(member, Predicted::Known(value));
            }
        }
        state.provisional.truncate(first_member);
        found
    }

    fn predict_deferred(&mut self, depth: usize, first_member: usize) {
        if depth != 0 {
            return;
        }
        while let Some(subject) = self.aot.javascript.deferred.pop() {
            if self.aot.javascript.provisional.len() - first_member >= MAX_CYCLE_MEMBERS {
                self.aot.javascript.deferred.clear();
                break;
            }
            self.aot.javascript.depth = 1;
            self.predict(subject);
            self.aot.javascript.depth = 0;
        }
    }

    // ───────────────────────────── expressions ─────────────────────────────

    /// For an expression the checker's type says nothing of.
    fn predict_expr(&mut self, file: FileId, e: ExprId) -> Option<TypeId> {
        let hir = self.hir(file);
        match hir[e].kind {
            ExprKind::Ident(name) => {
                let sym = self.symbol_of_identifier(file, e, name)?;
                let held = self.predicted_symbol_type(sym)?;
                self.narrowed_at(file, e, held)
            }
            ExprKind::This => {
                let (of, constructor) = self.this_constructor(file, e)?;
                self.predicted_instance_type(of, constructor)
            }
            ExprKind::Dot { obj, name, .. } => {
                let object = self.predicted_object_type(file, obj)?;
                let held = self.predicted_property_type(object, name)?;
                self.narrowed_at(file, e, held)
            }
            ExprKind::Index { obj, index, .. } => {
                let object = self.predicted_object_type(file, obj)?;
                if let ExprKind::String(name) = hir[index].kind {
                    return self.predicted_property_type(object, name);
                }
                let key = self.predicted_expr_type(file, index)?;
                let kind = match () {
                    _ if self.every_type(key, Self::is_number_like) => TypeId::NUMBER,
                    _ if self.every_type(key, Self::is_string_like) => TypeId::STRING,
                    _ => return None,
                };
                let element = self.cached_index_type(object, kind)?;
                self.informative_type(element)
            }
            ExprKind::Call(call) => self.predict_call(file, call, false),
            ExprKind::New(call) => self.predict_call(file, call, true),
            ExprKind::Binary { op: BinOp::Add, left, right } | ExprKind::Assign { op: Some(BinOp::Add), target: left, value: right } => self.predict_sum(file, left, right),
            ExprKind::Binary { op: op @ (BinOp::And | BinOp::Or | BinOp::Nullish), left, right }
            | ExprKind::Assign { op: Some(op @ (BinOp::And | BinOp::Or | BinOp::Nullish)), target: left, value: right } => {
                let mut found = Vec::new();
                if let Some(left) = self.predicted_expr_type(file, left) {
                    // What of the left operand gets past the operator.
                    let left = match op {
                        BinOp::And => self.definitely_falsy_part(left),
                        BinOp::Or => self.remove_definitely_falsy(left),
                        _ => self.non_nullable(left),
                    };
                    let left = self.informative_type(left);
                    self.add(&mut found, left);
                }
                let right = self.predicted_expr_type(file, right);
                self.add(&mut found, right);
                self.either(&found)
            }
            ExprKind::Binary { op: BinOp::Comma, right: value, .. } | ExprKind::Assign { op: None, value, .. } => self.predicted_expr_type(file, value),
            ExprKind::Cond { yes, no, .. } => {
                let mut found = Vec::new();
                for value in [yes, no] {
                    let value = self.predicted_expr_type(file, value);
                    self.add(&mut found, value);
                }
                self.either(&found)
            }
            // `x as any` is still what `x` is.
            ExprKind::As { expr, .. } | ExprKind::Satisfies { expr, .. } | ExprKind::Instantiation { expr, .. } | ExprKind::AsConst(expr) => self.predicted_expr_type(file, expr),
            ExprKind::NonNull(expr) => {
                let value = self.predicted_expr_type(file, expr)?;
                let value = self.non_nullable(value);
                self.informative_type(value)
            }
            ExprKind::Await(operand) => {
                let operand = self.predicted_expr_type(file, operand)?;
                let awaited = self.awaited(operand);
                self.informative_type(awaited)
            }
            _ => None,
        }
    }

    /// `e`: `X.name`. If `X` is the `prototype` of a function of the program: what the program stores on that under the name.
    fn predict_prototype_member(&mut self, file: FileId, e: ExprId) -> Option<TypeId> {
        let ExprKind::Dot { obj, name, .. } = self.hir(file)[e].kind else { return None };
        let constructor = self.constructor_with_prototype(file, obj, 0)?;
        let constructor = self.function_for_expr_by_name(file, constructor)?;
        let uses = self.constructor_uses_in(constructor.0);
        let stored: Vec<(FileId, ExprId)> = uses.members.get(&constructor)?.iter().filter(|member| member.0 == name).map(|member| (member.1, member.2)).collect();
        let mut found = Vec::new();
        for (of, value) in stored {
            let value = self.predicted_expr_type(of, value);
            self.add(&mut found, value);
        }
        self.either(&found)
    }

    /// `getFlowTypeOfReference` for the reference `e`, were it declared to hold `held`: what the tests and the assignments on the way to
    /// `e` leave of that. The type of what is no reference is left as it is.
    fn narrowed_at(&mut self, file: FileId, e: ExprId, held: TypeId) -> Option<TypeId> {
        if !self.flow_analysis_disabled.is_empty() {
            let narrowed = self.flow_type_of_reference(file, e, held);
            return self.informative_type(narrowed);
        }
        if let Some(&known) = self.aot.javascript.narrowed.get(&(file, e, held)) {
            return known;
        }
        let (scope, mark, careful_before) = (self.begin_scope(), self.non_cacheable_mark(), self.stack_half_used_count());
        let narrowed = self.flow_type_of_reference(file, e, held);
        let is_settled = self.non_cacheable_mark() == mark && self.stack_half_used_count() == careful_before && self.flow_analysis_disabled.is_empty();
        let found = self.informative_type(narrowed);
        if self.end_scope(scope).is_ok() && is_settled {
            self.aot.javascript.narrowed.insert((file, e, held), found);
        }
        found
    }

    /// Of what a property is read from, which is not nil if that goes well.
    fn predicted_object_type(&mut self, file: FileId, obj: ExprId) -> Option<TypeId> {
        // In a member of the literal in `F.prototype = { .. }` the checker takes `this` for the literal.
        if matches!(self.hir(file)[obj].kind, ExprKind::This)
            && let Some((of, constructor)) = self.this_constructor(file, obj)
            && let Some(instance) = self.predicted_instance_type(of, constructor)
        {
            return Some(instance);
        }
        let object = self.predicted_expr_type(file, obj)?;
        let object = self.non_nullable(object);
        self.informative_type(object)
    }

    fn predicted_property_type(&mut self, object: TypeId, name: Atom) -> Option<TypeId> {
        if let Some(found) = self.predicted_declared_property_type(object, name) {
            return Some(found);
        }
        let inherited_from = self.predicted_base_instance(object)?;
        self.predicted_property_type(inherited_from, name)
    }

    /// `class G extends (F as any) { .. }`. `object`: the type of the objects of `G`. What `new F()` probably makes, where `F` is a function of the program and no class.
    fn predicted_base_instance(&mut self, object: TypeId) -> Option<TypeId> {
        // The type of `this` in a method stands for that of the objects of the class.
        let object = self.apparent_type(object);
        let &TypeData::Ref { target, .. } = self.data(object) else { return None };
        let (file, class) = self.files.decls(target).into_iter().find_map(|(file, decl)| match decl {
            Decl::Class(class) => Some((file, class)),
            _ => None,
        })?;
        let extends = self.hir(file)[class].extends.some()?;
        let base = match self.imported_code_type(file, extends) {
            Some(code) => code,
            None => self.predicted_expr_type(file, extends)?,
        };
        let (of, func) = self.function_for_type(base)?;
        self.predicted_instance_type(of, func)
    }

    fn cached_property_type(&mut self, object: TypeId, name: Atom) -> Option<TypeId> {
        let key = (object, name, self.index_may_be_missing(None));
        if let Some(&known) = self.aot.javascript.property_types.get(&key) {
            return known;
        }
        let (scope, mark) = (self.begin_scope(), self.non_cacheable_mark());
        let found = self.type_of_property(object, name);
        let is_settled = self.non_cacheable_mark() == mark;
        if self.end_scope(scope).is_ok() && is_settled {
            self.aot.javascript.property_types.insert(key, found);
        }
        found
    }

    fn cached_index_type(&mut self, object: TypeId, key_type: TypeId) -> Option<TypeId> {
        if let Some(&known) = self.aot.javascript.index_types.get(&(object, key_type)) {
            return known;
        }
        let (scope, mark) = (self.begin_scope(), self.non_cacheable_mark());
        let found = self.index_type_of_type(object, key_type);
        let is_settled = self.non_cacheable_mark() == mark;
        if self.end_scope(scope).is_ok() && is_settled {
            self.aot.javascript.index_types.insert((object, key_type), found);
        }
        found
    }

    fn predicted_declared_property_type(&mut self, object: TypeId, name: Atom) -> Option<TypeId> {
        let checked = self.cached_property_type(object, name)?;
        if let Some(checked) = self.informative_type(checked) {
            return Some(checked);
        }
        let (prop, _) = self.get_property_of_type(object, name)?;
        match prop.source {
            PropSource::Symbol(sym) => self.predicted_symbol_type(sym),
            PropSource::Literal(file, p) => {
                let written = &self.hir(file)[p];
                match written.kind {
                    PropKind::Init | PropKind::Shorthand => self.predicted_expr_type(file, written.value),
                    _ => None,
                }
            }
            _ => None,
        }
    }

    fn predict_call(&mut self, file: FileId, call: CallId, is_new: bool) -> Option<TypeId> {
        let call = &self.hir(file)[call];
        if is_new
            && let Some((of, func)) = self.function_for_expr_by_name(file, call.callee)
            && let Some(instance) = self.predicted_instance_type(of, func)
        {
            return Some(instance);
        }
        let callee = self.predicted_expr_type(file, call.callee)?;
        if let Some((of, func)) = self.function_for_type(callee) {
            return match is_new {
                true => self.predicted_instance_type(of, func),
                false => self.predicted_fn_result(of, func),
            };
        }
        // The receiver is only predicted, so the checker has not resolved the call: the first signature that takes as many arguments.
        let callee = self.non_nullable(callee);
        let signatures = self.signatures(callee, is_new);
        for &signature in signatures.iter() {
            let params = self.sig_params(signature);
            let takes_more = params.last().is_some_and(|last| last.rest);
            if call.args.len() < Self::min_args(&params) || call.args.len() > params.len() && !takes_more {
                continue;
            }
            let erased = self.erased_sig(signature);
            let result = self.sig_return(erased);
            return self.informative_type(result);
        }
        None
    }

    /// What a call of the function probably yields.
    fn predicted_fn_result(&mut self, file: FileId, func: FnId) -> Option<TypeId> {
        let checked = self.return_type_of_fn(file, func);
        if let Some(checked) = self.informative_type(checked) {
            return Some(checked);
        }
        self.predict(Subject::Result(file, func))
    }

    fn predict_result(&mut self, file: FileId, func: FnId) -> Option<TypeId> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        // What is returned there is not what the call yields.
        if hir[func].flags.intersects(Flags::ASYNC | Flags::GENERATOR) {
            return None;
        }
        let mut found = Vec::new();
        if let FnBody::Expr(value) = hir[func].body {
            let value = self.predicted_expr_type(file, value);
            self.add(&mut found, value);
        }
        for stmt in bound.ids(bound.fns[func.idx()].returns) {
            if let StmtKind::Return(value) = hir[stmt].kind
                && value.is_some()
            {
                let value = self.predicted_expr_type(file, value);
                self.add(&mut found, value);
            }
        }
        self.either(&found)
    }

    /// `a + b`: a string if either is one, a number if both are.
    fn predict_sum(&mut self, file: FileId, left: ExprId, right: ExprId) -> Option<TypeId> {
        let mut operands = [None, None];
        for (operand, e) in operands.iter_mut().zip([left, right]) {
            if let Some(ty) = self.predicted_expr_type(file, e) {
                *operand = Some(self.non_nullable(ty));
            }
        }
        let is = |operand: Option<TypeId>, kind: fn(&Self, TypeId) -> bool| operand.is_some_and(|ty| !ty.is_never() && self.every_type(ty, kind));
        let [left, right] = operands;
        if is(left, Self::is_string_like) || is(right, Self::is_string_like) {
            Some(TypeId::STRING)
        } else if is(left, Self::is_number_like) && is(right, Self::is_number_like) {
            Some(TypeId::NUMBER)
        } else if is(left, Self::is_bigint_like) && is(right, Self::is_bigint_like) {
            Some(TypeId::BIGINT)
        } else {
            None
        }
    }

    // ───────────────────────────── variables, parameters, properties ─────────────────────────────

    /// All that is stored to it where the program says so by its name: its declarations, and the assignments to a variable.
    fn predict_symbol(&mut self, sym: Sym) -> Option<TypeId> {
        let mut found = Vec::new();
        let mut variables: Vec<(FileId, SymbolId)> = Vec::new();
        for (file, decl) in self.files.decls(sym) {
            let (hir, bound) = (self.hir(file), self.bound(file));
            let stored = match decl {
                Decl::Var(pat) | Decl::Param(pat) => {
                    let variable = (file, bound.pat_symbol[pat.idx()]);
                    if !variables.contains(&variable) {
                        variables.push(variable);
                    }
                    self.predicted_pat_type(file, pat)
                }
                Decl::ThisProperty(e) | Decl::Expando(e) | Decl::ExportsProperty(e) | Decl::ModuleExports(e) => match hir[e].kind {
                    ExprKind::Assign { value, .. } => self.predicted_expr_type(file, value),
                    _ => None,
                },
                Decl::Property(p) if matches!(hir[p].kind, PropKind::Init | PropKind::Shorthand) => self.predicted_expr_type(file, hir[p].value),
                Decl::Member(member) if hir[member].kind == MemberKind::Property && hir[member].init.is_some() => self.predicted_expr_type(file, hir[member].init),
                Decl::ParameterProperty(p) => self.predicted_param_type(file, p),
                Decl::ExportExpr(stmt) => match hir[stmt].kind {
                    StmtKind::ExportDefault(value) | StmtKind::ExportAssign(value) => self.predicted_expr_type(file, value),
                    _ => None,
                },
                _ => None,
            };
            self.add(&mut found, stored);
        }
        for (file, variable) in variables {
            let (hir, bound) = (self.hir(file), self.bound(file));
            for &(_, target) in bound.assignments_to(variable) {
                // The value of `x = v`, `x += v` and `++x` is what `x` holds from then on. That of `x++` is of the same kind.
                let Parent::Expr(assignment) = bound.expr_parent[target.idx()] else { continue };
                let stores = match hir[assignment].kind {
                    ExprKind::Assign { target: to, .. } => to == target,
                    ExprKind::Unary { op, .. } => matches!(op, UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec),
                    _ => false,
                };
                if stores {
                    let stored = self.predicted_expr_type(file, assignment);
                    self.add(&mut found, stored);
                }
            }
        }
        self.either(&found)
    }

    /// For a name or a pattern the checker's type says nothing of.
    fn predict_pat(&mut self, file: FileId, pat: PatId) -> Option<TypeId> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        match bound.pat_parent[pat.idx()] {
            PatParent::Param(p) => self.predict_param(file, p),
            PatParent::Var(declaration) => {
                let init = hir[declaration].init;
                if init.is_some() {
                    return self.predicted_expr_type(file, init);
                }
                // `for (const x of xs)`
                let stmt = bound.var_stmt[declaration.idx()].some()?;
                let Parent::Stmt(owner) = bound.stmt_parent[stmt.idx()] else { return None };
                let StmtKind::ForOf { left, expr, is_await, .. } = hir[owner].kind else { return None };
                if left != stmt {
                    return None;
                }
                let iterable = self.predicted_expr_type(file, expr)?;
                let element = self.iterated_type(iterable, is_await);
                self.informative_type(element)
            }
            PatParent::Prop(outer, prop) => {
                let prop = &hir[prop];
                let name = match (prop.key, hir[prop.value].kind) {
                    _ if prop.is_rest => return None,
                    (PropKey::Name(name), _) | (PropKey::None, PatKind::Ident(name)) => name,
                    _ => return None,
                };
                let object = self.predicted_pat_type(file, outer)?;
                let object = self.non_nullable(object);
                let member = self.predicted_property_type(object, name);
                self.or_default(file, member, prop.default)
            }
            PatParent::Elem(outer, elem) => {
                let elem = &hir[elem];
                if elem.is_rest {
                    return None;
                }
                let iterable = self.predicted_pat_type(file, outer)?;
                let element = self.iterated_type(iterable, false);
                let element = self.informative_type(element);
                self.or_default(file, element, elem.default)
            }
            PatParent::None => None,
        }
    }

    fn calls_passing_arguments_for(&mut self, file: FileId, func: FnId) -> Rc<[(FileId, ExprId, usize)]> {
        if self.aot.javascript.are_program_calls != self.has_merged_function_uses() {
            self.aot.javascript.are_program_calls = self.has_merged_function_uses();
            self.aot.javascript.calls_passing_arguments.clear();
        }
        if let Some(known) = self.aot.javascript.calls_passing_arguments.get(&(file, func)) {
            return Rc::clone(known);
        }
        let uses = self.function_uses();
        let mut calls: Vec<(FileId, ExprId, usize)> = uses.first_calls_with_arguments((file, func), MAX_CALLS);
        for &((of, taker), position) in uses.passed_to.get(&(file, func)).into_iter().flatten() {
            if calls.len() >= MAX_CALLS {
                break;
            }
            let params = self.hir(of)[taker].params;
            if position < params.len() {
                calls.extend(uses.parameter_calls.get(&(of, params.at(position))).into_iter().flatten().take(MAX_CALLS - calls.len()).map(|&(of, e)| (of, e, 0)));
            }
        }
        calls.truncate(MAX_CALLS);
        let calls: Rc<[(FileId, ExprId, usize)]> = calls.into();
        self.aot.javascript.calls_passing_arguments.insert((file, func), Rc::clone(&calls));
        calls
    }

    /// What the calls of the function pass. A call that passes nothing passes `undefined`. Where the function is itself passed to a
    /// function, `each(list, function (item) { .. })`, the calls of that parameter there are calls of it.
    fn predict_param(&mut self, file: FileId, p: ParamId) -> Option<TypeId> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let func = bound.param_fn[p.idx()].some()?;
        if hir[p].flags.contains(Flags::REST) {
            return None;
        }
        let index = hir[func].params.iter().position(|other| other == p)?;
        let calls = self.calls_passing_arguments_for(file, func);
        let mut found = Vec::new();
        for &(of, e, first) in calls.iter() {
            let index = index + first;
            let caller = self.hir(of);
            let (ExprKind::Call(call) | ExprKind::New(call)) = caller[e].kind else { continue };
            let args = caller[call].args;
            // Which argument comes after a spread depends on what is spread.
            if caller.ids(args).take(index + 1).any(|arg| matches!(caller[arg].kind, ExprKind::Spread(_))) {
                continue;
            }
            let passed = match index < args.len() {
                true => self.predicted_expr_type(of, caller.id_at(args, index)),
                false => Some(TypeId::UNDEFINED),
            };
            self.add(&mut found, passed);
        }
        let mut passed = self.either(&found);
        // Nobody is seen to pass anything: it is expected to be what it is used as.
        if passed.is_none()
            && let Some(id) = bound.pat_symbol[hir[p].pat.idx()].some()
            && self.is_used_as_number(Sym { file, id })
        {
            passed = Some(TypeId::NUMBER);
        }
        if passed.is_none()
            && let Some(id) = bound.pat_symbol[hir[p].pat.idx()].some()
            && self.is_used_as_array(Sym { file, id })
        {
            passed = Some(self.array_of(TypeId::ANY));
        }
        if passed.is_none()
            && let Some(id) = bound.pat_symbol[hir[p].pat.idx()].some()
            && self.is_used_as_string(Sym { file, id })
        {
            passed = Some(TypeId::STRING);
        }
        self.or_default(file, passed, hir[p].default)
    }

    /// `found`, or what the initializer `default` yields, if there is one.
    fn or_default(&mut self, file: FileId, found: Option<TypeId>, default: ExprId) -> Option<TypeId> {
        if default.is_none() {
            return found;
        }
        let mut either = Vec::new();
        self.add(&mut either, found);
        let default = self.predicted_expr_type(file, default);
        self.add(&mut either, default);
        self.either(&either)
    }

    // ───────────────────────────── functions that are used as classes ─────────────────────────────

    /// The function that makes the objects that are `this` at the expression `this`, which is not in a class.
    fn this_constructor(&mut self, file: FileId, this: ExprId) -> Option<Function> {
        let Some(Ok(func)) = self.this_container(file, this) else { return None };
        let kind = self.hir(file)[func].kind;
        self.constructor_uses_in(file).constructor_for_method(file, func, kind)
    }

    /// An object type with a property for each name that is stored to `this` in the function and in the functions on its `prototype`,
    /// and for each of those.
    fn predicted_instance_type(&mut self, file: FileId, func: FnId) -> Option<TypeId> {
        self.predict(Subject::Instance(file, func))
    }

    fn predict_instance(&mut self, file: FileId, func: FnId) -> Option<TypeId> {
        let mut members: Vec<(Atom, Vec<TypeId>)> = Vec::new();
        let mut constructor = (file, func);
        for _ in 0..MAX_INHERITED {
            let uses = self.constructor_uses_in(constructor.0);
            // What the heir stores under a name hides what it inherits.
            let hidden = members.len();
            for &(name, of, value) in uses.members.get(&constructor).into_iter().flatten() {
                let at = match members.iter().position(|member| member.0 == name) {
                    Some(at) if at < hidden => continue,
                    Some(at) => at,
                    None => {
                        members.push((name, Vec::new()));
                        members.len() - 1
                    }
                };
                let stored = self.predicted_expr_type(of, value);
                self.add(&mut members[at].1, stored);
            }
            match uses.inherits_from.get(&constructor) {
                Some(&base) => constructor = base,
                None => break,
            }
        }
        if members.is_empty() {
            return None;
        }
        let mut props = Vec::with_capacity(members.len());
        for (name, stored) in members {
            let ty = self.either(&stored).unwrap_or(TypeId::ANY);
            props.push(Prop { name, flags: PropFlags::empty(), source: PropSource::Type(ty), mapper: MapperId::IDENTITY, name_type: TypeId::UNRESOLVED });
        }
        if let Some(&Some(before)) = self.aot.javascript.previous_round.get(&Subject::Instance(file, func))
            && let TypeData::Synth(shape) = self.data(before)
            && shape.props[..] == props[..]
        {
            return Some(before);
        }
        Some(self.synth(Shape { props: vec_from_iter_in(props, self.arena), ..Shape::new_in(self.arena) }))
    }

    // ───────────────────────────── what the program does with its functions ─────────────────────────────

    /// In their order.
    fn files_with_code(&self) -> Vec<FileId> {
        let files = (0..self.files.modules.len() as u32).map(FileId);
        files.filter(|&file| !matches!(self.hir(file).kind, FileKind::Declaration | FileKind::Json) && !self.bound(file).ran_out_of_stack).collect()
    }

    /// The imports that the program calls or constructs, or a member of which it does, in the order of the files.
    pub fn called_imports(&mut self, in_parallel: InParallel<'_>) -> &'p [Sym] {
        let program = self.p;
        program.aot.javascript.called_imports.get_or_init(|| {
            let files = self.files_with_code();
            let found = self.map_slices(&files, FILES_PER_CHECKER, Some(in_parallel), &|c, files| {
                let mut imports = Vec::new();
                let mut seen = FxHashSet::default();
                for &file in files {
                    let (hir, bound) = (c.hir(file), c.bound(file));
                    for (index, node) in hir.exprs.iter().enumerate() {
                        if let ExprKind::Call(call) | ExprKind::New(call) = node.kind
                            && !matches!(bound.expr_parent[index], Parent::None)
                            && let Some((import, _)) = c.import_for_expr(file, hir[call].callee)
                            && seen.insert(import)
                        {
                            imports.push(import);
                        }
                    }
                }
                imports
            });
            let mut seen = FxHashSet::default();
            found.into_iter().flatten().filter(|&import| seen.insert(import)).collect()
        })
    }

    /// Where the code of each of the imports is. Once for the program, whichever checker is told, before anything is predicted. What is
    /// said after that changes nothing.
    pub fn set_imported_code(&self, code: impl IntoIterator<Item = (Sym, ImportedCode)>) {
        self.p.aot.javascript.imported_code.get_or_init(|| code.into_iter().collect());
    }

    /// The TypeScript files that stand in for declaration files: other code runs in their place. Once for the program, like
    /// `set_imported_code`.
    pub fn set_declaration_only_files(&self, files: impl IntoIterator<Item = FileId>) {
        self.p.aot.javascript.declaration_only_file_set.get_or_init(|| files.into_iter().collect());
    }

    /// Whether the file says what there is and the program has no code for it: a declaration file, or a file that stands in for one.
    pub fn is_declaration_only(&self, file: FileId) -> bool {
        self.hir(file).kind == FileKind::Declaration || self.p.aot.javascript.declaration_only_file_set.get().is_some_and(|files| files.contains(&file))
    }

    /// For `a` or `a.name`, where `a` is an import: the import, and the name.
    fn import_for_expr(&mut self, file: FileId, e: ExprId) -> Option<(Sym, Option<Atom>)> {
        let hir = self.hir(file);
        let (import, member) = match hir[e].kind {
            ExprKind::Dot { obj, name, .. } => (obj, Some(name)),
            _ => (e, None),
        };
        let ExprKind::Ident(name) = hir[import].kind else { return None };
        let import = self.symbol_of_identifier(file, import, name)?;
        self.files.flags(import).contains(SymFlags::ALIAS).then_some((import, member))
    }

    /// The checker's type of the code that `e` stands for, which is an import or a member of one.
    fn imported_code_type(&mut self, file: FileId, e: ExprId) -> Option<TypeId> {
        let (import, member) = self.import_for_expr(file, e)?;
        let code = *self.p.aot.javascript.imported_code.get()?.get(&import)?;
        let whole = match code {
            ImportedCode::Binding(sym) => self.type_of_symbol(sym),
            ImportedCode::Export(of, name) => {
                let module = self.files.file_symbol(of);
                match name.and_then(|name| self.files.module_export(module, name)) {
                    Some(exported) => self.type_of_symbol(exported),
                    // All of it, which is also what an ES module sees as the `default` of a CommonJS module.
                    None if name.is_none_or(|name| name == known::default) => {
                        let value = self.files.module_value(module);
                        self.type_of_symbol(value)
                    }
                    None => return None,
                }
            }
        };
        match member {
            Some(name) => self.type_of_property(whole, name),
            None => Some(whole),
        }
    }

    // A parameter is what the calls of its function pass, wherever they are. Which function a call runs takes the types of the file the
    // call is in. So each file is gone through by the task that has its types, and what comes of the files is put together when all
    // have been: a function of the program, whoever has gone through what. Until then a checker predicts by one file alone.

    fn recorded_function_uses(&self) -> &'p [Guarded<Option<FileFunctionUses>>] {
        let program = self.p;
        program.aot.javascript.noted.get_or_init(|| (0..program.files.modules.len()).map(|_| Guarded::new(None)).collect())
    }

    /// Notes what the file does with the functions of the program, in the place of whatever has been noted of it before. For the task
    /// that has checked or visited the file. From here on, and until `merge_recorded_function_uses`, what this checker predicts goes by
    /// this file alone, and by nothing it has predicted before.
    pub fn record_function_uses_in(&mut self, file: FileId) {
        // What is predicted on the way goes by no file that this checker has noted before.
        self.aot.javascript = State::default();
        self.enable_expr_cache_for(file);
        let found = self.find_function_uses_in(file);
        *self.recorded_function_uses()[file.idx()].lock() = Some(found);
        self.aot.javascript = State { last_recorded_file: Some(file), ..State::default() };
        self.enable_expr_cache_for(file);
    }

    /// Puts together what has been noted of the files, in the order of the program. Once, when no task is running and every file has
    /// been noted that is going to be. From here on every checker predicts by all of it.
    pub fn merge_recorded_function_uses(&self) {
        self.p.aot.javascript.uses.get_or_init(|| {
            let mut files = self.files_with_code();
            files.sort_by_key(|&file| self.files.rank_of_file(file));
            let noted = self.recorded_function_uses();
            let parts: Vec<(FileId, FileFunctionUses)> = files.into_iter().filter_map(|file| Some((file, noted[file.idx()].lock().take()?))).collect();
            let parts: Vec<(FileId, &FileFunctionUses)> = parts.iter().map(|(file, part)| (*file, part)).collect();
            Uses::new(&parts, |file, func| self.hir(file)[func].kind)
        });
    }

    /// Whether what the files do has been merged.
    pub fn has_merged_function_uses(&self) -> bool {
        self.p.aot.javascript.uses.get().is_some()
    }

    fn function_uses(&mut self) -> KnownUses<'p> {
        if let Some(uses) = self.p.aot.javascript.uses.get() {
            return KnownUses::OfProgram(uses);
        }
        if let Some(uses) = &self.aot.javascript.current_file_uses {
            return KnownUses::OfFile(Rc::clone(uses));
        }
        let uses = match self.aot.javascript.last_recorded_file {
            Some(file) => match &*self.recorded_function_uses()[file.idx()].lock() {
                Some(part) => Uses::new(&[(file, part)], |file, func| self.hir(file)[func].kind),
                None => Uses::default(),
            },
            None => Uses::default(),
        };
        let uses = Rc::new(uses);
        self.aot.javascript.current_file_uses = Some(Rc::clone(&uses));
        KnownUses::OfFile(uses)
    }

    /// The uses that say what a function of `file` makes with `new`. Until those of all files are merged a file goes by its own, and has none for the
    /// constructor that it imports: then these are what `file` itself stores on the `prototype` of its functions and to `this` in them. Whichever file is
    /// being translated, by whichever task, they are the same.
    fn constructor_uses_in(&mut self, file: FileId) -> KnownUses<'p> {
        if self.p.aot.javascript.uses.get().is_some() || self.aot.javascript.last_recorded_file == Some(file) {
            return self.function_uses();
        }
        if let Some(uses) = self.aot.javascript.constructor_uses_by_file.get(&file) {
            return KnownUses::OfFile(Rc::clone(uses));
        }
        let mut part = FileFunctionUses::default();
        self.add_stored_members(file, &mut part);
        let uses = Rc::new(Uses::new(&[(file, &part)], |file, func| self.hir(file)[func].kind));
        self.aot.javascript.constructor_uses_by_file.insert(file, Rc::clone(&uses));
        KnownUses::OfFile(uses)
    }

    /// The function of the program that the expression names: by the checker's own type, by the code behind an import, and where those say nothing by the trees. It asks for no prediction of
    /// this file: what predictions rest on is found with it.
    fn function_for_expr_by_name(&mut self, file: FileId, e: ExprId) -> Option<Function> {
        let ty = match self.imported_code_type(file, e) {
            Some(code) => code,
            None => self.type_of_expr(file, e),
        };
        match self.function_for_type(ty) {
            Some(function) => Some(function),
            None => self.function_for_value_expr(file, e),
        }
    }

    /// The `F` whose `prototype` the value of the expression is: `F.prototype`, `(F.prototype = {})`, and `P` after `const P = (F.prototype = {})`.
    fn constructor_with_prototype(&mut self, file: FileId, e: ExprId, depth: usize) -> Option<ExprId> {
        let hir = self.hir(file);
        if depth > 4 {
            return None;
        }
        match hir[e].kind {
            ExprKind::Dot { obj, name: known::prototype, .. } => Some(obj),
            ExprKind::Assign { op: None, target: same, .. } | ExprKind::As { expr: same, .. } | ExprKind::Satisfies { expr: same, .. } | ExprKind::NonNull(same) => self.constructor_with_prototype(file, same, depth + 1),
            ExprKind::Ident(name) => {
                let sym = self.symbol_of_identifier(file, e, name)?;
                let (of, Decl::Var(pat)) = self.files.value_declaration(sym)? else { return None };
                let bound = self.bound(of);
                let PatParent::Var(declaration) = bound.pat_parent[pat.idx()] else { return None };
                if of != file || !bound.assignments_to(bound.pat_symbol[pat.idx()]).is_empty() {
                    return None;
                }
                let init = hir[declaration].init.some()?;
                self.constructor_with_prototype(file, init, depth + 1)
            }
            _ => None,
        }
    }

    /// One pass over the expressions of the file. It asks for the checker's own types, and for what is predicted while no call is known.
    fn find_function_uses_in(&mut self, file: FileId) -> FileFunctionUses {
        let mut uses = FileFunctionUses::default();
        if matches!(self.hir(file).kind, FileKind::Declaration | FileKind::Json) || self.bound(file).ran_out_of_stack {
            return uses;
        }
        let (hir, bound) = (self.hir(file), self.bound(file));
        for (index, node) in hir.exprs.iter().enumerate() {
            let e = ExprId(index as u32);
            // The parser leaves nodes behind that are part of nothing.
            if matches!(bound.expr_parent[e.idx()], Parent::None) {
                continue;
            }
            match node.kind {
                ExprKind::Call(call) | ExprKind::New(call) => {
                    let callee = hir[call].callee;
                    if let ExprKind::Ident(name) = hir[callee].kind
                        && let Some(sym) = self.symbol_of_identifier(file, callee, name)
                        && let Some((of, Decl::Param(pat))) = self.files.value_declaration(sym)
                        && let PatParent::Param(p) = self.bound(of).pat_parent[pat.idx()]
                    {
                        uses.parameter_calls.push(((of, p), e));
                        continue;
                    }
                    if let Some((handed, first)) = self.function_receiving_forwarded_arguments(file, call) {
                        uses.passed_arguments.push((handed, e, first));
                    }
                    let constructs = matches!(node.kind, ExprKind::New(_)) || matches!(hir[callee].kind, ExprKind::Super);
                    let mut function = None;
                    if let Some(code) = self.imported_code_type(file, callee) {
                        function = self.invoked_function(code, constructs);
                    }
                    if function.is_none() {
                        let callee = self.type_of_expr(file, callee);
                        function = self.invoked_function(callee, constructs);
                    }
                    // `e.emit("x", 1)`: a property of what is probably made by `new F()`.
                    if function.is_none()
                        && let Some(callee) = self.predicted_expr_type(file, callee)
                    {
                        function = self.invoked_function(callee, constructs);
                    }
                    let Some(function) = function else { continue };
                    uses.calls.push((function, e));
                    for (position, arg) in hir.ids(hir[call].args).enumerate() {
                        let passed = match hir[arg].kind {
                            ExprKind::Fn(passed) => Some((file, passed)),
                            ExprKind::Ident(_) => {
                                let arg = self.type_of_expr(file, arg);
                                self.function_for_type(arg)
                            }
                            // Which argument comes after it depends on what is spread.
                            ExprKind::Spread(_) => break,
                            _ => None,
                        };
                        if let Some(passed) = passed {
                            uses.passed_to.push((passed, function, position));
                        }
                    }
                }
                ExprKind::Assign { op: None, target, value } => {
                    if let ExprKind::Index { obj, index, .. } = hir[target].kind
                        && let Some(property) = self.holding_property(file, obj, 0)
                        && let Some(key) = self.classify_passed(file, index)
                        && let Some(stored) = self.classify_passed(file, value)
                        && !matches!(key, Passed::Closure(_))
                        && !matches!(stored, Passed::Key(_))
                    {
                        uses.keyed_stores.push((property, key, stored));
                    }
                }
                _ => {}
            }
        }
        self.add_stored_members(file, &mut uses);
        uses
    }

    /// `process.nextTick(f, a, b)`, `f.call(receiver, a, b)`: `f`, and the number of the argument that is its first.
    fn function_receiving_forwarded_arguments(&mut self, file: FileId, call: CallId) -> Option<(Function, usize)> {
        let hir = self.hir(file);
        let args = hir[call].args;
        let (named, receiver) = match hir[hir[call].callee].kind {
            ExprKind::Dot { obj, name, .. } => (name, Some(obj)),
            ExprKind::Ident(name) => (name, None),
            _ => return None,
        };
        let (function, first) = match (self.atoms().bytes(named), receiver) {
            (b"call" | b"$call", Some(function)) => (function, 1),
            (b"nextTick" | b"setImmediate" | b"queueMicrotask", _) if !args.is_empty() => (hir.id_at(args, 0), 1),
            (b"setTimeout" | b"setInterval", _) if !args.is_empty() => (hir.id_at(args, 0), 2),
            _ => return None,
        };
        let expected = self.predicted_expr_type(file, function)?;
        Some((self.function_for_type(expected)?, first))
    }

    /// The name of the property that holds the object that the expression stands for: `X.name`, `(X.name = ..)`, and a variable that is bound to nothing else: `var events = target._events`,
    /// `var { _events: events } = this`, `events = target._events = Object.create(null)`.
    pub fn holding_property(&mut self, file: FileId, e: ExprId, depth: usize) -> Option<Atom> {
        let hir = self.hir(file);
        if depth > 4 {
            return None;
        }
        match hir[e].kind {
            ExprKind::Dot { name, .. } => Some(name),
            ExprKind::Assign { op: None, target: same, .. } | ExprKind::As { expr: same, .. } | ExprKind::Satisfies { expr: same, .. } | ExprKind::NonNull(same) => self.holding_property(file, same, depth + 1),
            ExprKind::Ident(name) => {
                let sym = self.symbol_of_identifier(file, e, name)?;
                let (of, Decl::Var(pat)) = self.files.value_declaration(sym)? else { return None };
                if of != file {
                    return None;
                }
                let bound = self.bound(file);
                let mut preserved_path_if = match bound.pat_parent[pat.idx()] {
                    PatParent::Var(declaration) => match hir[declaration].init.some() {
                        Some(init) => Some(self.holding_property(file, init, depth + 1)?),
                        None => None,
                    },
                    PatParent::Prop(_, prop) if !hir[prop].is_rest && hir[prop].default.is_none() => match (hir[prop].key, hir[hir[prop].value].kind) {
                        (PropKey::Name(name), _) | (PropKey::None, PatKind::Ident(name)) => Some(name),
                        _ => return None,
                    },
                    _ => return None,
                };
                for &(_, target) in bound.assignments_to(bound.pat_symbol[pat.idx()]) {
                    let Parent::Expr(assignment) = bound.expr_parent[target.idx()] else { return None };
                    let ExprKind::Assign { op: None, target: to, value } = hir[assignment].kind else { return None };
                    if to != target || self.target_store(file, target).is_none() {
                        return None;
                    }
                    let stored = self.holding_property(file, value, depth + 1)?;
                    if *preserved_path_if.get_or_insert(stored) != stored {
                        return None;
                    }
                }
                preserved_path_if
            }
            _ => None,
        }
    }

    /// What the expression is, as the key or the value of a keyed store or as an argument that is handed on to one.
    fn classify_passed(&mut self, file: FileId, e: ExprId) -> Option<Passed> {
        let hir = self.hir(file);
        match hir[e].kind {
            ExprKind::String(text) => return Some(Passed::Key(text)),
            ExprKind::Fn(func) => return Some(Passed::Closure((file, func))),
            ExprKind::As { expr, .. } | ExprKind::Satisfies { expr, .. } | ExprKind::NonNull(expr) => return self.classify_passed(file, expr),
            ExprKind::Ident(name) => {
                if let Some(sym) = self.symbol_of_identifier(file, e, name)
                    && let Some((of, Decl::Param(pat))) = self.files.value_declaration(sym)
                    && let PatParent::Param(p) = self.bound(of).pat_parent[pat.idx()]
                {
                    let (declaring, bound) = (self.hir(of), self.bound(of));
                    let func = bound.param_fn[p.idx()].some()?;
                    if declaring[p].flags.contains(Flags::REST) || declaring[p].default.is_some() || !bound.assignments_to(bound.pat_symbol[pat.idx()]).is_empty() {
                        return None;
                    }
                    let index = declaring[func].params.iter().position(|other| other == p)?;
                    return Some(Passed::Parameter((of, func), index));
                }
            }
            _ => {}
        }
        let expected = self.predicted_expr_type(file, e)?;
        self.function_for_type(expected).map(Passed::Closure)
    }

    /// `(name, key, function)`: the one function of the program whose closures are stored under the constant key in the dictionaries that are held under the property `name`, as far as the
    /// trees tell. In the order of the texts of the name and the key. Once the uses of all files are merged.
    pub fn functions_by_key(&mut self) -> Vec<(Atom, Atom, (FileId, FnId))> {
        let uses = self.function_uses();
        let mut pending: Vec<(Atom, Passed, Passed, usize)> = uses.keyed_stores.iter().map(|&(property, key, stored)| (property, key, stored, 0)).collect();
        let mut seen: FxHashSet<(Atom, Passed, Passed)> = pending.iter().map(|&(property, key, stored, _)| (property, key, stored)).collect();
        let mut found: FxHashMap<(Atom, Atom), Option<Function>> = FxHashMap::default();
        while let Some((property, key, stored, forwarded)) = pending.pop() {
            let taking = match (key, stored) {
                (Passed::Key(key), Passed::Closure(function)) => {
                    // A second function leaves none.
                    found.entry((property, key)).and_modify(|only| *only = only.filter(|&only| only == function)).or_insert(Some(function));
                    continue;
                }
                (Passed::Parameter(of_key, _), Passed::Parameter(of_value, _)) if of_key != of_value => continue,
                (Passed::Parameter(taking, _), _) | (_, Passed::Parameter(taking, _)) => taking,
                _ => continue,
            };
            if forwarded == MAX_FORWARDED {
                continue;
            }
            for (of, e, first) in uses.calls_with_arguments(taking) {
                let caller = self.hir(of);
                let (ExprKind::Call(call) | ExprKind::New(call)) = caller[e].kind else { continue };
                let args = caller[call].args;
                let mut at_call = [Some(key), Some(stored)];
                for passed in &mut at_call {
                    if let Some(Passed::Parameter(_, index)) = *passed {
                        let index = index + first;
                        // Which argument comes after a spread depends on what is spread.
                        let is_known = index < args.len() && !caller.ids(args).take(index + 1).any(|arg| matches!(caller[arg].kind, ExprKind::Spread(_)));
                        *passed = if is_known { self.classify_passed(of, caller.id_at(args, index)) } else { None };
                    }
                }
                if let [Some(key), Some(stored)] = at_call
                    && !matches!(key, Passed::Closure(_))
                    && !matches!(stored, Passed::Key(_))
                    && seen.insert((property, key, stored))
                {
                    pending.push((property, key, stored, forwarded + 1));
                }
            }
        }
        let mut table: Vec<(Atom, Atom, Function)> = found.into_iter().filter_map(|((property, key), only)| Some((property, key, only?))).collect();
        table.sort_by(|a, b| (self.atoms().bytes(a.0), self.atoms().bytes(a.1)).cmp(&(self.atoms().bytes(b.0), self.atoms().bytes(b.1))));
        table
    }

    /// `heir`, `base`: expressions of the file that name two functions.
    fn add_subclass(&mut self, file: FileId, heir: ExprId, base: ExprId, uses: &mut FileFunctionUses) {
        let functions = [heir, base].map(|named| self.function_for_expr_by_name(file, named));
        if let [Some(heir), Some(base)] = functions
            && heir != base
        {
            uses.heirs.push((heir, base));
        }
    }

    /// What the file stores on the `prototype` of a function, and to `this`. It asks for the checker's own type of the function only.
    fn add_stored_members(&mut self, file: FileId, uses: &mut FileFunctionUses) {
        if matches!(self.hir(file).kind, FileKind::Declaration | FileKind::Json) || self.bound(file).ran_out_of_stack {
            return;
        }
        let (hir, bound) = (self.hir(file), self.bound(file));
        for (index, node) in hir.exprs.iter().enumerate() {
            if matches!(bound.expr_parent[index], Parent::None) {
                continue;
            }
            if let ExprKind::Call(call) = node.kind {
                let args = hir[call].args;
                let named = match hir[hir[call].callee].kind {
                    ExprKind::Ident(name) | ExprKind::Dot { name, .. } => self.atoms().bytes(name),
                    _ => continue,
                };
                let (heir, base) = match named {
                    b"setPrototypeOf" | b"ObjectSetPrototypeOf" if args.len() == 2 => (self.constructor_with_prototype(file, hir.id_at(args, 0), 0), self.constructor_with_prototype(file, hir.id_at(args, 1), 0)),
                    b"inherits" if args.len() == 2 => (Some(hir.id_at(args, 0)), Some(hir.id_at(args, 1))),
                    b"$toClass" if args.len() == 3 => (Some(hir.id_at(args, 0)), Some(hir.id_at(args, 2))),
                    _ => continue,
                };
                if let (Some(heir), Some(base)) = (heir, base) {
                    self.add_subclass(file, heir, base, uses);
                }
                continue;
            }
            let ExprKind::Assign { op, target, value } = node.kind else { continue };
            let ExprKind::Dot { obj, name, .. } = hir[target].kind else { continue };
            if matches!(hir[obj].kind, ExprKind::This) {
                if matches!(op, None | Some(BinOp::And | BinOp::Or | BinOp::Nullish))
                    && let Some(Ok(func)) = self.this_container(file, obj)
                {
                    uses.this_stores.push((func, name, value));
                }
                continue;
            }
            if op.is_some() {
                continue;
            }
            let mut literal = value;
            while let ExprKind::As { expr, .. } | ExprKind::Satisfies { expr, .. } | ExprKind::NonNull(expr) = hir[literal].kind {
                literal = expr;
            }
            // `S.prototype = Object.create(F.prototype, ..)`, `S.prototype.__proto__ = F.prototype`
            let inherited = match hir[literal].kind {
                ExprKind::Call(call) if name == known::prototype && !hir[call].args.is_empty() => match hir[hir[call].callee].kind {
                    ExprKind::Ident(callee) | ExprKind::Dot { name: callee, .. } if matches!(self.atoms().bytes(callee), b"create" | b"ObjectCreate") => Some((Some(obj), hir.id_at(hir[call].args, 0))),
                    _ => None,
                },
                _ if self.atoms().bytes(name) == b"__proto__" => Some((self.constructor_with_prototype(file, obj, 0), literal)),
                _ => None,
            };
            if let Some((heir, prototype)) = inherited {
                if let (Some(heir), Some(base)) = (heir, self.constructor_with_prototype(file, prototype, 0)) {
                    self.add_subclass(file, heir, base, uses);
                }
                continue;
            }
            let mut stored: Vec<(Atom, ExprId)> = Vec::new();
            let constructor = match hir[literal].kind {
                // `F.prototype = { .. }`
                ExprKind::Object(props) if name == known::prototype => {
                    for p in props.iter() {
                        if let PropKey::Name(name) = hir[p].key
                            && matches!(hir[p].kind, PropKind::Init | PropKind::Method)
                        {
                            stored.push((name, hir[p].value));
                        }
                    }
                    obj
                }
                // `F.prototype.name = value`
                _ => {
                    let Some(constructor) = self.constructor_with_prototype(file, obj, 0) else { continue };
                    stored.push((name, value));
                    constructor
                }
            };
            let Some(constructor) = self.function_for_expr_by_name(file, constructor) else { continue };
            for (name, value) in stored {
                uses.members.push((constructor, name, value));
                if let ExprKind::Fn(method) = hir[value].kind {
                    uses.constructors.push((method, constructor));
                }
            }
        }
    }
}
