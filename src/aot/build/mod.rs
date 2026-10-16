//! From the trees and the types of the type checker to the intermediate representation.
//!
//! What an operation means is never taken from the checker: a property read is a property read by name, and the compiler behind
//! the front end decides how it is done. What it decides by is the checker's types, which are all handed over, and which it takes for
//! facts: of every value, of every storage place (parameter, `this`, result, field, captured variable, module variable), of every
//! object type as a layout with the layouts of the objects that are looked at as it. Where a value is not known to be of the type it
//! is used as, a `Coerce` makes sure: see `fit`. A name that the program does not bind stays a name: what `Math` or `undefined` is, is
//! not known here. JavaScript is held to no type: what the checker infers there is handed over as predictions, which are no facts: see
//! `predict`.
//!
//! Each file is translated by itself, into a `Fragment`: see `FileBuild`. What is the same for all files is in `Shared`. `link` makes the
//! program of the fragments.

mod asked;
mod class;
mod expr;
mod commonjs;
mod comments;
mod constants;
mod fit;
mod imports;
mod intrinsics;
mod jsx;
mod mocks;
mod parts;
mod pattern;
mod predict;
pub mod react;
mod scope;
pub(crate) mod sets_of_strings;
mod stmt;
mod types;

use self::fit::Ty;
pub(crate) use self::imports::ImportSource;
use crate::builder::{FuncBuilder, Var};
use crate::declared::DeclaredTable;
use crate::fragment::{Body, Definition, Fragment, FuncKey, Function, GlobalKey, LayoutKey, Mentioning, Mentions, NO_FILE, Notes, Shape, Variable};
use crate::id::{BlockId, FuncId, GlobalId, LayoutId, ModuleId, StrId, TyId, V};
use crate::ir::{self, Func, FuncKind, Op, Term};
use bun_builtin_syntax::Archive;
use bun_sema::atom::Atom;
use bun_sema::check::{Activation, Capture, Checker, Evaluates, FirstStore, Identity, Program as Checked, Receiver, RunBy};
use bun_sema::hir::{self, ClassId, FileKind, FnId, StmtKind};
use bun_sema::program::{Builtin, FileId, Files, LoadedBy, Sym};
use bun_sema::types::TypeId;
use bun_sema::util::InParallel;
use rustc_hash::{FxHashMap, FxHashSet};
use std::borrow::Cow;
use std::collections::VecDeque;
use std::rc::Rc;
use std::sync::OnceLock;

const FILES_OF_A_CHECKER: usize = 32;
const IMPORTS_OF_A_CHECKER: usize = 256;

/// Something the compiler cannot translate yet.
pub struct Problem {
    pub file: FileId,
    pub pos: u32,
    pub what: Cow<'static, str>,
}

/// Where a variable that is not a local of one function lives.
#[derive(Default)]
pub(crate) struct Undo {
    pub(crate) funcs: Vec<((FileId, FnId), Option<FuncId>)>,
    pub(crate) named_functions: Vec<((FileId, FnId), Option<FuncId>)>,
    pub(crate) activation_layouts: Vec<(Activation, Option<LayoutId>)>,
    pub(crate) this_bindings: Vec<(FnId, Option<LayoutId>)>,
    pub(crate) places: Vec<(Sym, Option<Place>)>,
    pub(crate) parameter_places: Vec<(Sym, Option<(Place, u32, u32)>)>,
}

fn written_sides_of_choice(hir: &hir::File<'_>, e: hir::ExprId, depth: u32, written: &mut Vec<Atom>) {
    match hir[e].kind {
        hir::ExprKind::String(text) if depth > 0 => written.push(text),
        hir::ExprKind::Binary { op: hir::BinOp::Or | hir::BinOp::Nullish, left, right } if depth < 64 => {
            written_sides_of_choice(hir, left, depth + 1, written);
            written_sides_of_choice(hir, right, depth + 1, written);
        }
        hir::ExprKind::Cond { yes, no, .. } if depth < 64 => {
            written_sides_of_choice(hir, yes, depth + 1, written);
            written_sides_of_choice(hir, no, depth + 1, written);
        }
        _ => {}
    }
}

fn put_back<K: Copy + Eq + std::hash::Hash, T>(map: &mut FxHashMap<K, T>, noted: Vec<(K, Option<T>)>) {
    let mut seen = FxHashSet::default();
    for (key, was) in noted {
        if seen.insert(key)
            && let Some(was) = was
        {
            map.insert(key, was);
        }
    }
}

#[derive(Copy, Clone)]
pub(crate) enum Place {
    Global(GlobalId),
    Env(LayoutId, u32),
}

/// What a module imports statically.
#[derive(Copy, Clone)]
enum Dependency {
    Module(FileId),
    /// A module that is not compiled with the program, by its specifier.
    External(Atom),
}

#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum Role {
    Whole,
    Entry,
    Beside,
    Typed,
    Second,
}

/// What a function of the program is made from.
#[derive(Copy, Clone)]
pub(crate) enum Source {
    Module(FileId),
    Function { file: FileId, func: FnId, class: Option<(FileId, ClassId)>, role: Role, root_of_second_body: FnId },
    /// The constructor of a class that declares none.
    DefaultConstructor { file: FileId, class: ClassId },
    /// Yields the object an enum is as a value.
    EnumObject(Sym),
    /// Returns the object for a module namespace or a TypeScript namespace used as a value.
    NamespaceObject(Sym),
    /// `(number) => value`: what the module exports under the name of that number, now.
    ModuleNamespaceReader(FileId),
    /// `import("./file")`: an async function that evaluates the module and returns its namespace object.
    DynamicImport(FileId, bool),
    Required(FileId),
    DynamicImportBody(FileId, bool),
    /// `FileBuild::body_of`
    ModuleBody(FileId),
    ModuleTouch(FileId),
    ModuleSettling(FileId),
    ModuleDriver(FileId),
    ModuleInner(FileId),
    /// `FileBuild::initializer_of`
    Initializer(Sym),
    /// `FileBuild::member_of_exported_object`, as long as nothing is remembered: of a name it is handed; of `default`, as Node.js has it or not.
    MemberOfExportedObject(FileId),
    DefaultOfExportedObject(FileId, bool),
    FilesByPath(FileId),
    EvaluationByNumber(FileId),
    ExportVariablesReader(FileId),
    NamespaceForHost(FileId),
}

impl Source {
    fn key(self) -> FuncKey {
        match self {
            Source::Module(file) => FuncKey::Module(file),
            Source::Function { file, func, role: Role::Typed, .. } => FuncKey::TypedBody(file, func),
            Source::Function { file, func, role: Role::Beside, .. } => FuncKey::EntryBeside(file, func),
            Source::Function { file, func, role: Role::Second, root_of_second_body, .. } => FuncKey::SecondBody(file, func, root_of_second_body),
            Source::Function { file, func, .. } => FuncKey::Function(file, func),
            Source::DefaultConstructor { file, class } => FuncKey::DefaultConstructor(file, class),
            Source::EnumObject(sym) => FuncKey::EnumObject(sym.file, sym.id),
            Source::NamespaceObject(sym) => FuncKey::NamespaceObject(sym.file, sym.id),
            Source::ModuleNamespaceReader(file) => FuncKey::ModuleNamespaceReader(file),
            Source::DynamicImport(file, is_node_mode) => FuncKey::DynamicImport(file, is_node_mode),
            Source::Required(file) => FuncKey::Required(file),
            Source::DynamicImportBody(file, is_node_mode) => FuncKey::DynamicImportBody(file, is_node_mode),
            Source::ModuleBody(file) => FuncKey::ModuleBody(file),
            Source::ModuleTouch(file) => FuncKey::ModuleTouch(file),
            Source::ModuleSettling(file) => FuncKey::ModuleSettling(file),
            Source::ModuleDriver(file) => FuncKey::ModuleDriver(file),
            Source::ModuleInner(file) => FuncKey::ModuleInner(file),
            Source::Initializer(sym) => FuncKey::Initializer(sym.file, sym.id),
            Source::MemberOfExportedObject(file) => FuncKey::MemberOfExportedObject(file),
            Source::DefaultOfExportedObject(file, is_node_mode) => FuncKey::DefaultOfExportedObject(file, is_node_mode),
            Source::FilesByPath(file) => FuncKey::FilesByPath(file),
            Source::EvaluationByNumber(file) => FuncKey::EvaluationByNumber(file),
            Source::ExportVariablesReader(file) => FuncKey::ExportVariablesReader(file),
            Source::NamespaceForHost(file) => FuncKey::NamespaceForHost(file),
        }
    }
}

pub(crate) struct EnvScope {
    pub(crate) layout: LayoutId,
    pub(crate) var: Var,
    pub(crate) shares_activation_with_previous: bool,
}

pub(crate) struct Jump {
    pub(crate) label: Atom,
    pub(crate) break_to: BlockId,
    /// `NONE`: not a loop.
    pub(crate) continue_to: BlockId,
    /// The iterator to close on leaving. `NONE`: none.
    pub(crate) iter: V,
    /// How many of the handlers are outside the statement. Only for a loop with an iterator.
    pub(crate) unwind_depth: usize,
    /// A `break` without a label stops here: a loop or a `switch`.
    pub(crate) is_unlabeled_break_target: bool,
    /// A `try` with a `finally`, which runs on leaving.
    pub(crate) finally_context: Option<FinallyContext>,
}

/// Where control goes once the statements it leaves have been left.
#[derive(Copy, Clone)]
pub(crate) enum Exit {
    Return(V),
    Goto(BlockId),
}

/// The finalizer is built once. Whoever goes through it says in `completion_type` where it is heading.
pub(crate) struct FinallyContext {
    pub(crate) entry: BlockId,
    /// 0: on to what follows. 1: an exception goes on. From 2 on: `exits`.
    pub(crate) completion_type: Var,
    /// What was thrown, if the finalizer looks at it, or what is returned.
    pub(crate) value: Var,
    pub(crate) exception: Var,
    /// The statements still to leave afterwards, from which index on, and where to go then.
    pub(crate) exits: Vec<(usize, Exit)>,
}

/// Where the value of an expression goes straight to, if that holds it to a type that is written down: a variable, a field, a parameter
/// or a result with an annotation, `as`, `!`. The value is held to that type and to no other. `want` is `NONE` where whoever gets the
/// value holds it to the type.
#[derive(Copy, Clone)]
pub(crate) struct Sink {
    pub(crate) e: hir::ExprId,
    pub(crate) want: Ty,
    pub(crate) why: ir::Why,
}

/// The function being built.
pub(crate) struct Fx {
    pub(crate) b: FuncBuilder,
    pub(crate) id: FuncId,
    pub(crate) file: FileId,
    /// `NONE`: the top level of the file.
    pub(crate) func: FnId,
    pub(crate) locals: FxHashMap<Sym, Var>,
    /// For a local `let`, `const`, class or parameter that is referred to where it may be in its dead zone: whether it has been
    /// initialized.
    pub(crate) initialized: FxHashMap<Sym, Var>,
    /// By lazy variable: whether the function has found it to hold its value. See `FileBuild::read_lazy_variable`.
    pub(crate) found_initialized: FxHashMap<GlobalId, Var>,
    /// Those of which that was seen to before the loops around the code that is being translated.
    pub(crate) initialized_before_loops: Vec<GlobalId>,
    pub(crate) modules_asked_for_before_loops: Vec<FileId>,
    /// `true` and `false`, in the entry block. `NONE`: not made yet.
    pub(crate) true_value: V,
    pub(crate) false_value: V,
    pub(crate) envs: Vec<EnvScope>,
    pub(crate) this: V,
    /// The checker's type of `this`. `NONE`: it says nothing.
    pub(crate) this_type: fit::Ty,
    pub(crate) class: Option<(FileId, ClassId)>,
    pub(crate) jumps: Vec<Jump>,
    pub(crate) handlers: Vec<BlockId>,
    /// The label of the statement about to be built.
    pub(crate) label: Atom,
    /// In a constructor where `super()` may come back with another object than it was handed: `this`, which comes about then.
    pub(crate) this_var: Option<Var>,
    /// In a constructor where `Checker::this_may_be_uninitialized`, and in the arrow functions there: the environment that holds `this`.
    pub(crate) this_binding: Option<(LayoutId, V)>,
    /// In the initializer of a static field, and in an arrow function there: the class, whose class object is `this`.
    pub(crate) this_class: Option<(FileId, ClassId)>,
    /// The copies of `this` and of `arguments` objects that the function is handed, its own to see or to hand on.
    pub(crate) receivers: FxHashMap<Receiver, V>,
    pub(crate) captured_arguments: FxHashMap<FnId, V>,
    pub(crate) captured_new_targets: FxHashMap<FnId, V>,
    pub(crate) home_objects: FxHashMap<FnId, V>,
    /// In a constructor: what it is handed for `this`, the object whoever constructs has made, or `undefined`.
    pub(crate) given: V,
    /// `NONE`: the code is not in a constructor that is handed it.
    pub(crate) new_target: V,
    pub(crate) is_in_field_initializer: bool,
    /// It is a constructor that returns what `new` yields in every case.
    pub(crate) returns_this: bool,
    /// It is a static member, so that `super` looks from the class and not from its prototype.
    pub(crate) is_static: bool,
    pub(crate) constructor_params: Vec<V>,
    /// The DisposableStack of the innermost block with `using` declarations.
    pub(crate) disposable_stack: V,
    /// The `arguments` object. `NONE`: the function does not refer to it.
    pub(crate) arguments: V,
    /// The array that all arguments arrive in. `NONE`: each arrives by itself.
    pub(crate) all_arguments: V,
    /// Written in TypeScript: expressions have the checker's types.
    pub(crate) is_typed: bool,
    /// By value and by variable: the checker's type, where it has one.
    pub(crate) checked: CheckedTypes,
    pub(crate) checked_vars: FxHashMap<Var, TypeId>,
    /// By block, value and type: the value as held to the type in that block.
    pub(crate) fitted: FxHashMap<(BlockId, V, TyId), V>,
    /// What a written `as` has yielded with an `undefined` or a `null` that the type after `as` has not: `Builder::coerce`.
    pub(crate) nullish_left_by_cast: FxHashSet<V>,
    /// The operand of the `as` that is being translated: `Checker::is_fresh_graph_by_text`.
    pub(crate) is_coercing_fresh_graph: bool,
    /// The calls in whose place the argument has been put that they hand back: `FileBuild::argument_handed_back`.
    pub(crate) handed_back: FxHashSet<hir::ExprId>,
    pub(crate) calls_in_tail_position: Vec<hir::ExprId>,
    /// By iterator of a loop: there is nothing to close if this holds. See `FileBuild::open_loop_over_table`.
    pub(crate) not_closed_if: FxHashMap<V, V>,
    /// The ordinary objects that no cast makes anything of, with the checker's types of them: a literal with an accessor, what `Object.defineProperties({ .. }, ..)` yields.
    pub(crate) stays_ordinary: FxHashMap<V, TypeId>,
    /// By value that was read from a place other code may have stored to since it was last looked at: the checker's type of the read,
    /// which the value has not been held to. A use that needs it to be of that type holds it to that.
    pub(crate) narrowed: FxHashMap<V, Ty>,
    /// For the expression that is being evaluated.
    pub(crate) sink: Option<Sink>,
    /// By block, value and prediction: the value as looked at with the prediction in that block.
    pub(crate) expected: FxHashMap<(BlockId, V, ir::Prediction), V>,
    /// Of a constructor function: the statements that are translated as one operation, see `FileBuild::initialize`.
    pub(crate) first_stores: Vec<FirstStore>,
    /// What is being stored to a variable is what it has room for besides its type: `let a;`, `a = undefined!`. See `ty_held_by_symbol`.
    pub(crate) is_clearing: bool,
    pub(crate) first_spans: FxHashMap<V, crate::audit::Noted>,
    pub(crate) last_spans: FxHashMap<V, crate::audit::Noted>,
    pub(crate) operand_spans: Vec<ir::Span>,
}

pub(crate) use bun_sema::fold::Defines;

/// What is the same for every file of the program, and stays as it is while the files are translated.
pub struct Shared<'a> {
    pub(crate) defines: Defines,
    /// The manifest's, for the builtin modules.
    pub(crate) builtin_defines: Defines,
    pub(crate) features: FxHashSet<Vec<u8>>,
    pub(crate) constants: &'a crate::Constants,
    /// `None`: there is no bundler.
    pub(crate) bundle: Option<imports::Bundle<'a>>,
    /// The files that the program starts with, whichever entry point that is: each once.
    roots: Vec<FileId>,
    /// By entry point: the files that are run when the program is started with it, in order.
    entry_points: Vec<Vec<FileId>>,
    /// The files of `crate::prelude` that the program was loaded with.
    prelude: Vec<FileId>,
    decorator_helpers: Option<FileId>,
    runtime_helpers: Option<FileId>,
    has_computed_module_names: bool,
    /// The modules that are compiled with the program, in ascending order: what the roots lead to, going by the code that runs for an
    /// import.
    modules: Vec<FileId>,
    is_module: Vec<bool>,
    /// The builtin modules among them, by registry id, ascending.
    builtin_modules: Vec<(u32, FileId)>,
    pub(crate) builtin_functions: commonjs::BuiltinFunctions,
    /// Those whose evaluation may have to wait: they have top-level `await`, or import a module that does.
    async_modules: FxHashSet<FileId>,
    /// By file. It follows from the tree, and is made by whoever asks first.
    pub(crate) using_arguments: Vec<OnceLock<UsingArguments>>,
    said_of_functions: bun_sema::util::ShardedMap<(FileId, FnId, bool), Box<[asked::Said]>>,
    pub(crate) calls_marked_pure: Vec<OnceLock<Vec<u32>>>,
    pub(crate) stars: Vec<OnceLock<imports::Stars>>,
    modules_put_off: FxHashSet<FileId>,
    modules_that_wait_for_their_place: FxHashSet<FileId>,
    pub(crate) modules_deferred: FxHashSet<FileId>,
    pub(crate) json_modules_read_by_name: FxHashSet<FileId>,
    behind_put_off: Vec<OnceLock<Vec<(FileId, Dependency)>>>,
    imports_nobody_resolved: FxHashMap<FileId, Vec<(FileId, Atom)>>,
    pub(crate) exports_may_be_overridden: bool,
    pub(crate) modules_that_may_be_overridden: FxHashSet<FileId>,
    pub(crate) modules_that_may_be_replaced: FxHashSet<FileId>,
}

/// The functions of a file that refer to their `arguments` object, and the arrow functions that refer to that of a function around
/// them.
#[derive(Default)]
pub(crate) struct UsingArguments {
    pub(crate) functions: FxHashSet<FnId>,
    /// Those of them that refer to the object, and not only to how many arguments there are or to one of them (`$argumentCount`, `$argument`).
    pub(crate) objects: FxHashSet<FnId>,
    pub(crate) arrows: FxHashSet<FnId>,
}

impl<'a> Shared<'a> {
    /// Once the program is loaded, before any of it is translated. It goes by the trees and the symbols alone. The checker is told what
    /// is for the bundler to say: where the code of the imports is, and which module evaluates which.
    pub fn new(program: &Checked<'_>, entry_points: &[Vec<FileId>], constants: &'a crate::Constants, in_parallel: InParallel<'_>) -> Shared<'a> {
        let entry_points: Vec<Vec<FileId>> = entry_points.iter().map(|run| run.iter().map(|&file| imports::written_in_the_place_of(program.files, file)).collect()).collect();
        let mut roots: Vec<FileId> = Vec::new();
        for &root in entry_points.iter().flatten() {
            if !roots.contains(&root) {
                roots.push(root);
            }
        }
        let mut builtin_modules: Vec<(u32, FileId)> = (0..program.files.modules.len() as u32)
            .filter_map(|file| match program.files.module(FileId(file)).builtin {
                Some(Builtin::Module(id, _)) => Some((id, FileId(file))),
                _ => None,
            })
            .collect();
        builtin_modules.sort_unstable();
        let has_builtin_files = program.files.modules.iter().any(|module| module.builtin.is_some());
        let builtin_defines = match !has_builtin_files {
            true => Defines::default(),
            false => Defines::new(Archive::embedded().manifest().defines().iter().map(|(name, value)| (&name[..], &value[..])).chain([(&b"IS_BUN_AOT"[..], &b"true"[..])])),
        };
        let mut shared = Shared {
            defines: Defines::new(constants.defines.iter().map(|(name, value)| (&name[..], &value[..]))),
            builtin_defines,
            builtin_modules,
            builtin_functions: commonjs::BuiltinFunctions::new(program.files),
            features: constants.features.iter().cloned().collect(),
            constants,
            bundle: imports::Bundle::new(program.files, &roots, constants),
            roots,
            entry_points: entry_points.to_vec(),
            prelude: (crate::prelude::FILES.iter().filter(|file| file.0 != crate::prelude::RUNTIME_HELPERS.0))
                .filter_map(|&(name, _)| program.files.by_path.get(&crate::prelude::path_of(&constants.root, name)))
                .collect(),
            runtime_helpers: program.files.by_path.get(&crate::prelude::path_of(&constants.root, crate::prelude::RUNTIME_HELPERS.0)),
            has_computed_module_names: program.files.modules.iter().any(|module| matches!(module.builtin, Some(Builtin::Module(_, LoadedBy::ComputedName)))),
            decorator_helpers: program.files.by_path.get(&crate::prelude::path_of(&constants.root, crate::prelude::DECORATORS.0)),
            modules: Vec::new(),
            is_module: Vec::new(),
            async_modules: FxHashSet::default(),
            using_arguments: (0..program.files.modules.len()).map(|_| OnceLock::new()).collect(),
            said_of_functions: Default::default(),
            calls_marked_pure: (0..program.files.modules.len()).map(|_| OnceLock::new()).collect(),
            stars: (0..program.files.modules.len()).map(|_| OnceLock::new()).collect(),
            modules_put_off: FxHashSet::default(),
            modules_that_wait_for_their_place: FxHashSet::default(),
            modules_deferred: FxHashSet::default(),
            json_modules_read_by_name: FxHashSet::default(),
            behind_put_off: (0..program.files.modules.len()).map(|_| OnceLock::new()).collect(),
            imports_nobody_resolved: FxHashMap::default(),
            exports_may_be_overridden: constants.has_test_globals,
            modules_that_may_be_overridden: FxHashSet::default(),
            modules_that_may_be_replaced: FxHashSet::default(),
        };
        let mut c = program.checker();
        c.set_logs_type_errors(constants.logs_type_errors);
        c.set_files_that_only_declare(shared.bundle.iter().flat_map(|bundle| bundle.declaring()));
        if !constants.ignores_dce_annotations && constants.own_paths.is_none() {
            let marked = (0..program.files.modules.len() as u32).map(FileId).map(|file| (file, shared.calls_marked_pure[file.idx()].get_or_init(|| comments::calls_marked_pure(c.hir(file)))));
            c.set_calls_marked_pure(marked.filter(|(_, calls)| !calls.is_empty()).map(|(file, calls)| (file, calls.clone())).collect());
        }
        let (modules, async_modules) = FileBuild::new(&mut c, &shared, NO_FILE).tell_module_graph();
        (shared.modules, shared.async_modules) = (modules, async_modules);
        shared.modules_deferred = FileBuild::new(&mut c, &shared, NO_FILE).modules_imported_deferred();
        shared.json_modules_read_by_name = FileBuild::new(&mut c, &shared, NO_FILE).json_modules_read_by_name();
        shared.imports_nobody_resolved = FileBuild::new(&mut c, &shared, NO_FILE).imports_nobody_resolved();
        shared.is_module = vec![false; program.files.modules.len()];
        for file in &shared.modules {
            shared.is_module[file.idx()] = true;
        }
        shared.exports_may_be_overridden = constants.has_test_globals && (!constants.notes_spans || constants.has_preloads || mocks::may_override_exports(program.files));
        if shared.exports_may_be_overridden {
            let (bindings, modules, replaced) = FileBuild::new(&mut c, &shared, NO_FILE).bindings_that_may_be_overridden();
            c.set_bindings_that_may_be_overridden(bindings);
            c.set_modules_that_may_be_overridden(modules.clone());
            shared.modules_that_may_be_overridden = modules;
            shared.modules_that_may_be_replaced = replaced;
            c.set_members_of_globals_that_may_be_overridden(mocks::spied_members_of_globals(program.files));
        }
        let fits = |file: FileId| constants.own_paths.is_none() && program.files.module(file).builtin.is_none() && !shared.roots.contains(&file) && !shared.prelude.contains(&file) && !shared.async_modules.contains(&file);
        let is_bundled = shared.bundle.is_some();
        let mut is_licensed = |file: FileId| if is_bundled { constants.without_side_effects.contains(program.files.module(file).file_name()) } else { c.is_in_package_without_side_effects(file) } && !c.is_wholly_inert(file);
        let hands_on_what_it_imports = |file: FileId| {
            let hir = program.files.hir(file);
            let imports = || hir.ids(hir.body).filter_map(|stmt| if let StmtKind::Import(import) = hir[stmt].kind { Some(&hir[import]) } else { None });
            let is_imported = |name: Atom| imports().any(|import| import.default == name || import.namespace == name || import.named.iter().any(|named| hir[named].local == name));
            hir.ids(hir.body).any(|stmt| match hir[stmt].kind {
                StmtKind::ExportStar { type_only, .. } => !type_only,
                StmtKind::ExportNamed(export) => !hir[export].type_only && (hir[export].has_module_specifier || hir[export].items.iter().any(|item| !hir[item].type_only && is_imported(hir[item].local))),
                StmtKind::ExportDefault(e) => matches!(hir[e].kind, hir::ExprKind::Ident(name) if is_imported(name)),
                StmtKind::ImportEquals(import) => matches!(hir[import].target, hir::ImportEqualsTarget::Entity(_)),
                _ => false,
            })
        };
        let licensed: Vec<FileId> = shared.modules.iter().copied().filter(|&file| fits(file) && is_licensed(file) && !hands_on_what_it_imports(file)).collect();
        let asks_in_its_body = |file: FileId| {
            let hir = program.files.hir(file);
            program.files.module(file).is_commonjs() || hir.ids(hir.body).any(|stmt| matches!(hir[stmt].kind, StmtKind::ImportEquals(import) if matches!(hir[import].target, hir::ImportEqualsTarget::Require(_))))
        };
        let would_wait: Vec<FileId> = licensed.iter().copied().filter(|&file| !c.runs_before_whoever_imports_it(file) && !asks_in_its_body(file)).collect();
        let waiting: FxHashSet<FileId> = would_wait.iter().copied().filter(|&file| !c.is_in_a_cycle_of_imports(file)).collect();
        let put_off: FxHashSet<FileId> = licensed.iter().copied().filter(|&file| waiting.contains(&file) || c.runs_before_whoever_imports_it(file) && !asks_in_its_body(file)).collect();
        shared.modules_put_off = put_off;
        shared.modules_that_wait_for_their_place = waiting;
        c.set_modules_put_off(&shared.modules_put_off.union(&shared.modules_deferred).copied().collect());
        // It asks which declarations are ambient, which goes by the modules.
        let called = c.imports_that_are_called(in_parallel);
        let code = c.in_slices(called, IMPORTS_OF_A_CHECKER, Some(in_parallel), &|c, imports| FileBuild::new(c, &shared, NO_FILE).code_of_imports(imports));
        c.set_code_of_imports(code.into_iter().flatten());
        let resolved = c.in_slices(&shared.modules, FILES_OF_A_CHECKER, Some(in_parallel), &|c, files| FileBuild::new(c, &shared, NO_FILE).resolved_imports_of(files));
        FileBuild::new(&mut c, &shared, NO_FILE).tell_resolved_imports(resolved.into_iter(), in_parallel);
        shared
    }

    pub fn roots(&self) -> &[FileId] {
        &self.roots
    }

    pub fn entry_points(&self) -> &[Vec<FileId>] {
        &self.entry_points
    }

    pub fn prelude(&self) -> &[FileId] {
        &self.prelude
    }

    pub(crate) fn decorator_helpers(&self) -> Option<FileId> {
        self.decorator_helpers
    }

    pub(crate) fn runtime_helpers(&self) -> Option<FileId> {
        self.runtime_helpers
    }

    pub(crate) fn runtime_helpers_loadable_by_computed_name(&self) -> Option<FileId> {
        self.runtime_helpers.filter(|_| self.has_computed_module_names)
    }

    pub(crate) fn builtin_modules(&self) -> &[(u32, FileId)] {
        &self.builtin_modules
    }

    pub fn is_prelude(&self, file: FileId) -> bool {
        self.prelude.contains(&file)
    }

    /// Whether the file is a module that is compiled with the program.
    pub fn is_compiled(&self, file: FileId) -> bool {
        self.is_module.get(file.idx()) == Some(&true)
    }
}

#[derive(Default)]
pub(crate) struct CheckedTypes {
    by_value: Vec<Option<TypeId>>,
    of_no_value: Option<TypeId>,
}

pub(crate) struct PlaceOfChecked<'a>(&'a mut Option<TypeId>);

impl CheckedTypes {
    #[inline]
    pub(crate) fn get(&self, value: V) -> Option<&TypeId> {
        match value.is_none() {
            true => self.of_no_value.as_ref(),
            false => self.by_value.get(value.idx()).and_then(|checked| checked.as_ref()),
        }
    }

    #[inline]
    fn place_of(&mut self, value: V) -> &mut Option<TypeId> {
        if value.is_none() {
            return &mut self.of_no_value;
        }
        if self.by_value.len() <= value.idx() {
            self.by_value.resize(value.idx() + 1, None);
        }
        &mut self.by_value[value.idx()]
    }

    #[inline]
    pub(crate) fn insert(&mut self, value: V, checked: TypeId) -> Option<TypeId> {
        self.place_of(value).replace(checked)
    }

    pub(crate) fn remove(&mut self, value: V) -> Option<TypeId> {
        self.place_of(value).take()
    }

    #[inline]
    pub(crate) fn entry(&mut self, value: V) -> PlaceOfChecked<'_> {
        PlaceOfChecked(self.place_of(value))
    }
}

impl PlaceOfChecked<'_> {
    #[inline]
    pub(crate) fn or_insert(self, checked: TypeId) {
        self.0.get_or_insert(checked);
    }
}

/// The tables of the fragment that is being made.
#[derive(Default)]
pub(crate) struct Out {
    pub(crate) strs: ir::Strs,
    pub(crate) tys: DeclaredTable,
    pub(crate) layouts: Vec<ir::Layout>,
    pub(crate) funcs: Vec<Func>,
    pub(crate) globals: Vec<ir::Global>,
}

/// The translation of one file. It defines the functions, the classes and the environments of the file, and the layouts of the object
/// types it looks into. Of what another file defines it has what whoever uses it has to know: the header of a function, the layout of a
/// class, what a variable holds. All of that follows from the declaration alone, so that every file that asks finds the same. What it
/// does not look into it only names.
pub(crate) struct FileBuild<'c, 'p, 's> {
    pub(crate) c: &'c mut Checker<'p, 's>,
    pub(crate) files: &'p Files<'s>,
    pub(crate) shared: &'c Shared<'c>,
    /// `NO_FILE`: no file is translated, only types are laid out.
    pub(crate) file: FileId,
    pub(crate) out: Out,
    /// By function, by layout and by variable of `out`: what it is, in terms that hold for every file.
    pub(crate) sources: Vec<Source>,
    layout_keys: Vec<LayoutKey>,
    global_keys: Vec<GlobalKey>,
    /// By function: what goes with it, once it is built.
    bodies: Vec<Option<Box<Body>>>,
    /// How many `LayoutKey::Environment` and `GlobalKey::Hidden` there are.
    environments: u32,
    hidden_variables: u32,
    pub(crate) template_objects: FxHashMap<(FileId, u32), GlobalId>,
    /// What the function that is being built has come by: see `Body`.
    problems: Vec<Problem>,
    declares: Vec<LayoutId>,
    classes_as_values: Vec<LayoutId>,
    checked_default_exports_of: Option<(FuncId, hir::ExprId)>,
    modules_touched: (FuncId, BlockId, Vec<FileId>),
    stored_besides: Vec<StrId>,
    cut: Vec<(u32, u32)>,
    /// An expression of another body is evaluated: nothing of this one is cut by that.
    only_asks: bool,
    /// By `const` that `Checker::constant_held_by` has no value for: what its initializer comes to with what the bundler replaces.
    constants_by_replacement: FxHashMap<Sym, Option<constants::Constant>>,
    dropped: Vec<(u32, u32)>,
    marks: Vec<parts::Mark>,
    /// The scope that is entered next is the top level of a module.
    enters_module_body: bool,
    /// `Definition::problems`, `Definition::constructs`
    problems_of_layouts: FxHashMap<LayoutId, Vec<Problem>>,
    constructs: FxHashMap<LayoutId, LayoutId>,
    modules: FxHashMap<FileId, ModuleId>,
    /// By `ModuleId`.
    files_of_modules: Vec<FileId>,
    /// By module: the function that evaluates it.
    evaluations: FxHashMap<FileId, FuncId>,
    /// `body_of`
    module_bodies: FxHashMap<FileId, FuncId>,
    functions_for_deferred_modules: FxHashMap<FuncKey, FuncId>,
    module_drivers: FxHashMap<FileId, FuncId>,
    module_inners: FxHashMap<FileId, FuncId>,
    /// `is_lazy`
    lazy: FxHashMap<Sym, bool>,
    pub(crate) value_symbols: FxHashMap<Sym, Sym>,
    pub(crate) exports_passed_by_imports: FxHashMap<Sym, Vec<(FileId, Atom)>>,
    pub(crate) ambient: std::cell::RefCell<FxHashMap<Sym, bool>>,
    /// `initializer_of`
    initializers: FxHashMap<Sym, FuncId>,
    /// The module variables that are lazy, as far as they have come up.
    pub(crate) lazy_globals: FxHashMap<GlobalId, Sym>,
    pub(crate) hoisted_functions: FxHashMap<GlobalId, (GlobalId, FileId, FnId)>,
    states_of_lazy_variables: FxHashMap<Sym, Option<GlobalId>>,
    /// `lazy_declarations_of`
    lazy_declarations: FxHashMap<FileId, Rc<Vec<(u32, u32, Sym)>>>,
    /// `uses_of_lazy_variables`
    lazy_uses: Option<Rc<Vec<(u32, FnId, Sym)>>>,
    uses_of_modules_put_off: Option<Rc<Vec<(u32, FnId, FileId, u32)>>>,
    pub(crate) funcs: FxHashMap<(FileId, FnId), FuncId>,
    /// The functions of the source that closures are expected of and that are not declared: see `name_function`.
    named_functions: FxHashMap<(FileId, FnId), FuncId>,
    /// The same for the constructors of classes that declare none: see `name_constructor`.
    named_default_constructors: FxHashMap<(FileId, ClassId), FuncId>,
    pub(crate) classes: FxHashMap<(FileId, ClassId), class::ClassInfo>,
    /// Where each class keeps what it keeps to itself.
    pub(crate) class_variables: FxHashMap<(FileId, ClassId, class::ClassVariable), Place>,
    /// The classes whose layout is being made, and those whose members are being declared.
    classes_in_progress: FxHashSet<(FileId, ClassId)>,
    classes_being_defined: FxHashSet<(FileId, ClassId)>,
    /// The classes whose declaration has been translated, and by class the functions that are built once it has.
    declared_classes: FxHashSet<(FileId, ClassId)>,
    waiting_for_class: FxHashMap<(FileId, ClassId), Vec<FuncId>>,
    pub(crate) enum_objects: FxHashMap<Sym, FuncId>,
    pub(crate) enum_globals: FxHashMap<Sym, GlobalId>,
    pub(crate) namespace_objects: FxHashMap<Sym, FuncId>,
    /// `global_of_namespace`
    pub(crate) namespace_globals: FxHashMap<Sym, GlobalId>,
    pub(crate) dynamic_imports: FxHashMap<(FileId, bool), FuncId>,
    pub(crate) evaluations_by_require: FxHashMap<FileId, FuncId>,
    pub(crate) dynamic_import_bodies: FxHashMap<(FileId, bool), FuncId>,
    /// `export_variable`
    pub(crate) export_variables: FxHashMap<(FileId, Atom), GlobalId>,
    /// `import_of_exported_object`
    pub(crate) imports_of_exported_objects: FxHashMap<(FileId, u8), FuncId>,
    /// By specifier: the global that holds the namespace object of an external module.
    pub(crate) external_modules: Vec<(StrId, GlobalId)>,
    pub(crate) globals_of_modules: FxHashMap<(FileId, &'static str), GlobalId>,
    /// NamedEvaluation: the names anonymous functions and classes take from where they are written.
    pub(crate) given_function_names: FxHashMap<(FileId, FnId), StrId>,
    pub(crate) given_class_names: FxHashMap<(FileId, ClassId), StrId>,
    pub(crate) name_by_key: V,
    pub(crate) import_sources: std::cell::RefCell<FxHashMap<Sym, ImportSource>>,
    pub(crate) entity_aliases: FxHashMap<Sym, self::imports::EntityAlias>,
    pub(crate) places: FxHashMap<Sym, Place>,
    pub(crate) parameter_places: FxHashMap<Sym, (Place, u32, u32)>,
    /// By activation of the file that has an environment, as far as it has come up: the layout of that. And the other way round.
    pub(crate) activation_layouts: FxHashMap<Activation, LayoutId>,
    /// `layout_of_this_binding`
    pub(crate) this_bindings: FxHashMap<FnId, LayoutId>,
    pub(crate) activations: FxHashMap<LayoutId, Activation>,
    /// The fields of environments that keep the closure of a function declaration.
    pub(crate) kept_closures: FxHashSet<(LayoutId, u32)>,
    /// By function that captures anything: what, in the order it is handed it.
    pub(crate) captures: FxHashMap<FuncId, Vec<Capture>>,
    /// By environment of a class: what its first fields hold for the members of the class.
    pub(crate) imports: FxHashMap<LayoutId, Vec<Capture>>,
    captured: FxHashMap<FileId, Rc<FxHashSet<Sym>>>,
    /// By file: the function declarations that are referred to other than to call them.
    function_values: FxHashMap<FileId, Rc<FxHashSet<Sym>>>,
    /// By type, and by how many times over the type that was asked about holds it: see `ty_within`.
    tys: FxHashMap<(TypeId, u8), TyId>,
    tape: asked::Tape,
    pub(crate) records: FxHashMap<TypeId, Option<LayoutId>>,
    pub(crate) known: fit::Known,
    /// The checker's type that a layout is the layout of, and its types of the places of the program.
    pub(crate) layout_types: FxHashMap<LayoutId, TypeId>,
    pub(crate) parts_within: FxHashMap<(TyId, TyId), Option<(Rc<[(LayoutId, LayoutId)]>, bool)>>,
    pub(crate) checked_globals: FxHashMap<GlobalId, TypeId>,
    pub(crate) checked_fields: FxHashMap<(LayoutId, u32), TypeId>,
    /// The fields of objects whose type is written down.
    pub(crate) annotated_fields: FxHashSet<(LayoutId, u32)>,
    /// By the layout of its objects: the class.
    pub(crate) laid_out_classes: FxHashMap<LayoutId, (FileId, ClassId)>,
    /// By the layout of what the parts of a union have in common, where that stands for the union: the layouts of the parts.
    pub(crate) parts_of_views: FxHashMap<LayoutId, Vec<LayoutId>>,
    pub(crate) views_grown: u32,
    pub(crate) cast_targets: FxHashMap<TyId, (u32, TyId)>,
    pub(crate) signatures: FxHashMap<FuncId, fit::Signature>,
    /// The layouts whose fields have their names and not their types: see `type_fields_of`.
    untyped_layouts: FxHashMap<LayoutId, types::FieldTypes>,
    expected_of_composed: FxHashMap<(TypeId, u8), crate::declared::Declared>,
    expected_as_described: FxHashMap<TypeId, TyId>,
    work: VecDeque<FuncId>,
    pub(crate) typed_bodies: FxHashMap<FuncId, FuncId>,
    pub(crate) second_bodies: FxHashMap<FuncId, FuncId>,
    pub(crate) entries_beside: FxHashMap<FuncId, FuncId>,
    pub(crate) second_work: VecDeque<FuncId>,
    pub(crate) second_root: Option<FnId>,
    pub(crate) undo: Option<Box<Undo>>,
}

/// Translates the file, which is compiled with the program, and which the checker has checked or visited.
pub fn translate_file(c: &mut Checker<'_, '_>, shared: &Shared<'_>, file: FileId) -> Box<Fragment> {
    c.keep_answers_by_expression_of(file);
    let mut build = FileBuild::new(c, shared, file);
    // The tree has a block in its place.
    for &(start, _) in build.hir(file).with_bodies.iter() {
        build.problem(file, start, "a `with` statement");
    }
    // A file of builtin functions is never evaluated.
    match build.files.module(file).builtin {
        Some(Builtin::Functions) => {
            for function in shared.builtin_functions.list.iter().filter(|function| function.file == file) {
                build.declare_function(file, function.func, None);
            }
        }
        _ => {
            build.evaluation_of(file);
            if shared.entry_points.iter().any(|files| files.first() == Some(&file)) && !build.only_declares(file) {
                build.dynamic_import_of(file, false);
            }
            if shared.runtime_helpers_loadable_by_computed_name() == Some(file) && !build.may_be_asked_by_the_host() {
                build.namespace_for_host_of(file);
            }
        }
    }
    build.build_functions();
    build.define_classes_of_file();
    build.build_functions();
    build.finish()
}

/// The files that the file imports or exports from by a declaration, for their code or for their types, as the checker resolves
/// imports. The bundler drops an import that turns out to be of types only, and one whose names only code uses that is cut away. The
/// first counts and the second does not: a declaration that is dropped counts if it says `type`, if one of its names stands for a
/// type and for no value, or if it is `export *`, which names nothing.
pub fn files_imported_by(c: &mut Checker<'_, '_>, shared: &Shared<'_>, file: FileId) -> Vec<FileId> {
    use bun_sema::bind::{Decl, SymFlags};
    let (files, hir, bound) = (c.p.files, c.hir(file), c.bound(file));
    let is_dropped_import = |specifier: Atom| shared.bundle.as_ref().is_some_and(|bundle| bundle.dropped.contains(&(file, c.atoms().bytes(specifier))));
    let is_only_a_type = |decl: Decl| {
        let id = bound.symbol_of_declaration(decl);
        id.is_some()
            && files.resolve_alias(files.sym(file, id)).is_some_and(|target| {
                let flags = files.flags(target);
                flags.intersects(SymFlags::TYPE) && !flags.intersects(SymFlags::VALUE)
            })
    };
    let mut imported = Vec::new();
    for stmt in hir.ids(hir.body) {
        let (spec, is_for_types) = match hir[stmt].kind {
            StmtKind::Import(import) => {
                let it = &hir[import];
                let names_a_type = || it.named.iter().any(|name| hir[name].type_only || is_only_a_type(Decl::ImportSpec(name)));
                (it.spec, it.type_only || it.default.is_some() && is_only_a_type(Decl::ImportDefault(import)) || names_a_type())
            }
            StmtKind::ExportNamed(export) => {
                let it = &hir[export];
                (it.spec, it.type_only || it.items.iter().any(|name| hir[name].type_only || is_only_a_type(Decl::ExportSpec(name))))
            }
            StmtKind::ExportStar { spec, .. } => (spec, true),
            StmtKind::ImportEquals(import) => match hir[import].target {
                hir::ImportEqualsTarget::Require(spec) => (spec, false),
                _ => continue,
            },
            _ => continue,
        };
        if spec.is_some() && (is_for_types || !is_dropped_import(spec)) {
            imported.extend(files.module(file).imported_file(spec));
        }
    }
    imported
}

const MAX_LAYOUTS_DESCRIBED_AT_ONCE: usize = 1 << 16;

/// `link::Describe`
pub fn describe(c: &mut Checker<'_, '_>, shared: &Shared<'_>, missing: &[TypeId], is_defined: &dyn Fn(Identity) -> bool) -> Fragment {
    let mut build = FileBuild::new(c, shared, NO_FILE);
    for &ty in missing {
        if let Some(layout) = build.record_layout(ty) {
            build.type_fields_of(layout);
        }
    }
    // More come about on the way. Types can lead to ever more types: the link ends that.
    let mut next = 0;
    while next < build.out.layouts.len().min(MAX_LAYOUTS_DESCRIBED_AT_ONCE) {
        if let LayoutKey::Record(identity) = build.layout_keys[next]
            && !is_defined(identity)
        {
            build.type_fields_of(LayoutId::new(next));
        }
        next += 1;
    }
    *build.finish()
}

impl<'c, 'p, 's> FileBuild<'c, 'p, 's> {
    fn new(c: &'c mut Checker<'p, 's>, shared: &'c Shared<'c>, file: FileId) -> FileBuild<'c, 'p, 's> {
        let mut out = Out::default();
        let known = fit::Known::new(&mut out.tys);
        FileBuild {
            files: c.p.files,
            c,
            shared,
            file,
            out,
            sources: Vec::new(),
            layout_keys: Vec::new(),
            global_keys: Vec::new(),
            bodies: Vec::new(),
            environments: 0,
            hidden_variables: 0,
            template_objects: FxHashMap::default(),
            problems: Vec::new(),
            declares: Vec::new(),
            classes_as_values: Vec::new(),
            checked_default_exports_of: None,
            modules_touched: (FuncId::NONE, BlockId::NONE, Vec::new()),
            stored_besides: Vec::new(),
            cut: Vec::new(),
            only_asks: false,
            constants_by_replacement: FxHashMap::default(),
            dropped: Vec::new(),
            marks: Vec::new(),
            enters_module_body: false,
            problems_of_layouts: FxHashMap::default(),
            constructs: FxHashMap::default(),
            modules: FxHashMap::default(),
            files_of_modules: Vec::new(),
            evaluations: FxHashMap::default(),
            module_bodies: FxHashMap::default(),
            functions_for_deferred_modules: FxHashMap::default(),
            module_drivers: FxHashMap::default(),
            module_inners: FxHashMap::default(),
            lazy: FxHashMap::default(),
            value_symbols: FxHashMap::default(),
            exports_passed_by_imports: FxHashMap::default(),
            ambient: Default::default(),
            initializers: FxHashMap::default(),
            lazy_globals: FxHashMap::default(),
            hoisted_functions: FxHashMap::default(),
            states_of_lazy_variables: FxHashMap::default(),
            lazy_declarations: FxHashMap::default(),
            lazy_uses: None,
            uses_of_modules_put_off: None,
            funcs: FxHashMap::default(),
            named_functions: FxHashMap::default(),
            named_default_constructors: FxHashMap::default(),
            classes: FxHashMap::default(),
            class_variables: FxHashMap::default(),
            classes_in_progress: FxHashSet::default(),
            classes_being_defined: FxHashSet::default(),
            declared_classes: FxHashSet::default(),
            waiting_for_class: FxHashMap::default(),
            enum_objects: FxHashMap::default(),
            enum_globals: FxHashMap::default(),
            namespace_objects: FxHashMap::default(),
            namespace_globals: FxHashMap::default(),
            dynamic_imports: FxHashMap::default(),
            evaluations_by_require: FxHashMap::default(),
            dynamic_import_bodies: FxHashMap::default(),
            export_variables: FxHashMap::default(),
            imports_of_exported_objects: FxHashMap::default(),
            external_modules: Vec::new(),
            globals_of_modules: FxHashMap::default(),
            given_function_names: FxHashMap::default(),
            given_class_names: FxHashMap::default(),
            name_by_key: V::NONE,
            import_sources: Default::default(),
            entity_aliases: FxHashMap::default(),
            places: FxHashMap::default(),
            parameter_places: FxHashMap::default(),
            activation_layouts: FxHashMap::default(),
            this_bindings: FxHashMap::default(),
            activations: FxHashMap::default(),
            kept_closures: FxHashSet::default(),
            captures: FxHashMap::default(),
            imports: FxHashMap::default(),
            captured: FxHashMap::default(),
            function_values: FxHashMap::default(),
            tys: FxHashMap::default(),
            tape: asked::Tape::Off,
            records: FxHashMap::default(),
            known,
            layout_types: FxHashMap::default(),
            parts_within: FxHashMap::default(),
            checked_globals: FxHashMap::default(),
            checked_fields: FxHashMap::default(),
            annotated_fields: FxHashSet::default(),
            laid_out_classes: FxHashMap::default(),
            parts_of_views: FxHashMap::default(),
            views_grown: 0,
            cast_targets: FxHashMap::default(),
            signatures: FxHashMap::default(),
            untyped_layouts: FxHashMap::default(),
            expected_of_composed: FxHashMap::default(),
            expected_as_described: FxHashMap::default(),
            work: VecDeque::new(),
            typed_bodies: FxHashMap::default(),
            second_bodies: FxHashMap::default(),
            entries_beside: FxHashMap::default(),
            second_work: VecDeque::new(),
            second_root: None,
            undo: None,
        }
    }

    pub(crate) fn hir(&self, file: FileId) -> &'p hir::File<'s> {
        self.c.hir(file)
    }

    pub(crate) fn str(&mut self, atom: Atom) -> StrId {
        if atom.is_none() {
            return self.out.strs.intern(b"");
        }
        // The checker marks a mangled name with a leading 0xFE, which is not UTF-8. `#x` keeps it: by it the engine knows that it is no property key.
        let bytes = self.c.atoms().bytes(atom);
        let is_private = bytes.starts_with(bun_sema::atom::PRIVATE_NAME_PREFIX);
        self.out.strs.intern(if is_private { bytes } else { bytes.strip_prefix(&[0xFE]).unwrap_or(bytes) })
    }

    pub(crate) fn problem(&mut self, file: FileId, pos: u32, what: &'static str) {
        self.problems.push(Problem { file, pos, what: Cow::Borrowed(what) });
    }

    /// Records the problem and yields `undefined` in the place of the value.
    pub(crate) fn unsupported(&mut self, fx: &mut Fx, pos: u32, what: &'static str) -> V {
        self.problem(fx.file, pos, what);
        self.emit(fx, Op::Undefined)
    }

    pub(crate) fn emit(&mut self, fx: &mut Fx, op: Op) -> V {
        if !fx.b.is_open() {
            let dead = fx.b.new_block();
            fx.b.seal(dead);
            fx.b.switch_to(dead);
        }
        if !self.shared.modules_put_off.is_empty() {
            self.touch_module_named_by(fx, &op);
        }
        if let Op::GlobalGet(global) | Op::GlobalSet(global, _) = op
            && let Some(&(is_bound, file, func)) = self.hoisted_functions.get(&global)
        {
            if matches!(op, Op::GlobalGet(_)) {
                self.bind_hoisted_function(fx, global, is_bound, file, func);
            } else {
                let yes = self.emit_as_it_is(fx, Op::Bool(true));
                self.emit_as_it_is(fx, Op::GlobalSet(is_bound, yes));
            }
        }
        if let Op::GlobalGet(global) = op
            && let Some(&sym) = self.lazy_globals.get(&global)
        {
            return self.read_lazy_variable(fx, global, sym, true);
        }
        self.emit_as_it_is(fx, op)
    }

    pub(crate) fn bind_hoisted_function(&mut self, fx: &mut Fx, global: GlobalId, is_bound: GlobalId, file: FileId, func: FnId) {
        let known = self.emit_as_it_is(fx, Op::GlobalGet(is_bound));
        let undefined = self.emit_as_it_is(fx, Op::Undefined);
        let is_first = self.emit_as_it_is(fx, Op::StrictEq { a: known, b: undefined });
        let (binds, goes_on) = (fx.b.new_block(), fx.b.new_block());
        self.branch(fx, is_first, binds, goes_on);
        fx.b.seal(binds);
        fx.b.switch_to(binds);
        let yes = self.emit_as_it_is(fx, Op::Bool(true));
        self.emit_as_it_is(fx, Op::GlobalSet(is_bound, yes));
        let id = self.declare_function(file, func, None);
        let own_scope = if file == fx.file { self.scope_of_function_expression(file, func) } else { None };
        let closure = match own_scope {
            Some((activation, field)) if self.open_activation(fx, activation) => {
                let layout = self.layout_of_activation(activation);
                let env = self.env_of(fx, layout);
                let start = self.hir(file)[func].start;
                let captures = self.capture_values(fx, id, start);
                let closure = self.emit(fx, Op::ClosureOnce { func: id, captures, env, field });
                self.close_env(fx);
                closure
            }
            _ => self.emit_as_it_is(fx, Op::Closure { func: id, captures: ir::Args::new() }),
        };
        self.emit_as_it_is(fx, Op::GlobalSet(global, closure));
        fx.b.jump(goes_on);
        fx.b.seal(goes_on);
        fx.b.switch_to(goes_on);
    }

    pub(crate) fn is_evaluated_when_touched(&self, file: FileId) -> bool {
        self.shared.modules_put_off.contains(&file) && !self.only_declares(file)
    }

    fn waits_for_its_place(&self, file: FileId) -> bool {
        self.shared.modules_that_wait_for_their_place.contains(&file) && !self.only_declares(file)
    }

    fn function_for_deferred_module(&mut self, file: FileId, source: Source) -> FuncId {
        if let Some(&known) = self.functions_for_deferred_modules.get(&source.key()) {
            return known;
        }
        let name = self.name_after_file("module", file);
        let module = self.module_of(file);
        let made = self.add_func(name, module, 0, FuncKind::Module, source);
        self.out.funcs[made.idx()].flags |= ir::func_flags::IS_HIDDEN_IN_STACK_TRACES;
        self.functions_for_deferred_modules.insert(source.key(), made);
        made
    }

    fn state_of_deferred_module(&mut self, file: FileId) -> (GlobalId, GlobalId) {
        let name = self.out.strs.intern(b"ran");
        let ran = self.add_global(name, file, Ty::NONE, GlobalKey::OfModule(file, "ran"));
        self.out.globals[ran.idx()].initialization = ir::Initialization::Undefined;
        let name = self.out.strs.intern(b"thrown");
        let thrown = self.add_global(name, file, Ty::NONE, GlobalKey::OfModule(file, "thrown"));
        self.out.globals[thrown.idx()].initialization = ir::Initialization::Undefined;
        (ran, thrown)
    }

    pub(crate) fn touch_module(&mut self, fx: &mut Fx, file: FileId) {
        if file == fx.file || self.is_builtin_file(fx.file) || !self.is_evaluated_when_touched(file) || fx.modules_asked_for_before_loops.contains(&file) {
            return;
        }
        if (self.modules_touched.0, self.modules_touched.1) != (fx.id, fx.b.block) {
            self.modules_touched = (fx.id, fx.b.block, Vec::new());
        }
        if self.modules_touched.2.contains(&file) {
            return;
        }
        self.modules_touched.2.push(file);
        if self.waits_for_its_place(file) {
            let (ran, _) = self.state_of_deferred_module(file);
            let yes = self.emit(fx, Op::Bool(true));
            let known = self.emit_as_it_is(fx, Op::GlobalGet(ran));
            let has_run = self.emit(fx, Op::StrictEq { a: known, b: yes });
            let (asks, goes_on) = (fx.b.new_block(), fx.b.new_block());
            self.branch(fx, has_run, goes_on, asks);
            fx.b.seal(asks);
            fx.b.switch_to(asks);
            let func = self.function_for_deferred_module(file, Source::ModuleTouch(file));
            self.emit_throwing(fx, Op::CallDirect { func, args: ir::Args::new() });
            fx.b.jump(goes_on);
            fx.b.seal(goes_on);
            fx.b.switch_to(goes_on);
        } else {
            self.emit_module_evaluation(fx, file);
        }
        self.modules_touched.1 = fx.b.block;
    }

    fn touch_module_named_by(&mut self, fx: &mut Fx, op: &Op) {
        if matches!(self.sources[fx.id.idx()], Source::FilesByPath(_) | Source::EvaluationByNumber(_)) {
            return;
        }
        let file = match *op {
            Op::GlobalGet(global) | Op::GlobalSet(global, _) => {
                let module = self.out.globals[global.idx()].module;
                module.is_some().then(|| self.files_of_modules[module.idx()])
            }
            Op::FuncRef(func) | Op::Closure { func, .. } | Op::ClosureOnce { func, .. } | Op::CallDirect { func, .. } => match self.sources[func.idx()] {
                Source::Function { file, .. } | Source::DefaultConstructor { file, .. } | Source::ModuleNamespaceReader(file) | Source::MemberOfExportedObject(file) | Source::DefaultOfExportedObject(file, _) | Source::ExportVariablesReader(file) => Some(file),
                Source::EnumObject(sym) | Source::NamespaceObject(sym) | Source::Initializer(sym) => Some(sym.file),
                Source::Module(_) | Source::DynamicImport(..) | Source::Required(_) | Source::DynamicImportBody(..) | Source::ModuleBody(_) | Source::ModuleDriver(_) | Source::ModuleInner(_) | Source::ModuleTouch(_) | Source::ModuleSettling(_) | Source::FilesByPath(_) | Source::EvaluationByNumber(_) | Source::NamespaceForHost(_) => None,
            },
            _ => None,
        };
        if let Some(file) = file {
            self.touch_module(fx, file);
        }
    }

    fn is_walked_through(&self, file: FileId, imported: FileId) -> bool {
        self.is_evaluated_when_touched(imported) && !self.waits_for_its_place(imported) && !self.is_imported_for_its_effects(file, imported)
    }

    fn what_stands_behind(&self, put_off: FileId) -> &'c [(FileId, Dependency)] {
        let shared = self.shared;
        shared.behind_put_off[put_off.idx()].get_or_init(|| {
            let (mut found, mut walked) = (Vec::new(), FxHashSet::default());
            walked.insert(put_off);
            self.walk_through(put_off, &mut walked, &mut found);
            let (mut seen, mut asked): (FxHashSet<FileId>, FxHashSet<Atom>) = Default::default();
            found.retain(|&(owner, dependency)| match dependency {
                Dependency::Module(imported) => seen.insert(imported),
                Dependency::External(specifier) => asked.insert(self.as_the_host_finds_it(owner, specifier)),
            });
            found
        })
    }

    fn walk_through(&self, file: FileId, walked: &mut FxHashSet<FileId>, found: &mut Vec<(FileId, Dependency)>) {
        for dependency in self.dependencies_of(file) {
            match dependency {
                Dependency::Module(imported) if self.is_walked_through(file, imported) => {
                    if walked.insert(imported) {
                        self.walk_through(imported, walked, found);
                    }
                }
                _ => found.push((file, dependency)),
            }
        }
    }

    fn is_imported_for_its_effects(&self, file: FileId, imported: FileId) -> bool {
        let hir = self.hir(file);
        hir.ids(hir.body).any(|stmt| match hir[stmt].kind {
            StmtKind::Import(import) => {
                let import = &hir[import];
                import.default.is_none() && import.namespace.is_none() && import.named.is_empty() && self.imported_file(file, import.spec) == Some(imported)
            }
            _ => false,
        })
    }

    fn emit_as_it_is(&mut self, fx: &mut Fx, op: Op) -> V {
        let op = if self.is_builtin_file(fx.file) { self.with_private_name(fx, op) } else { op };
        let op = self.fit_operands(fx, op);
        let op = self.with_collection_expected(fx, op);
        let ty = self.type_of_op(fx, &op);
        if let Op::New(layout) | Op::NewWith { layout, .. } = op {
            self.note_allocation(layout);
        }
        if let Op::NewWith { layout, .. } = op
            && let Some(&made) = self.layout_types.get(&layout)
        {
            self.c.note_object_created_with_discriminant(made);
        }
        let made_as = if fx.is_typed { None } else { self.made_as(&op, ty.id) };
        let value = fx.b.emit(op, if made_as.is_some() { self.out.tys.anything } else { ty.id });
        if self.shared.constants.notes_spans
            && let Some(&(Op::Coerce { value: held, .. } | Op::IterOpen(held))) = fx.b.func.op(value)
            && let Some(&span) = fx.last_spans.get(&held)
        {
            fx.first_spans.insert(value, span);
            fx.last_spans.insert(value, span);
        }
        if self.shared.constants.notes_spans {
            let (receiver, stored) = match fx.b.func.op(value) {
                Some(&Op::PropSet { obj, value: stored, .. }) => (obj, stored),
                Some(&Op::PropDelete { obj, .. }) => (obj, V::NONE),
                Some(Op::Call { args, .. } | Op::CallMethod { args, .. }) => (args.first().copied().unwrap_or(V::NONE), V::NONE),
                _ => (V::NONE, V::NONE),
            };
            for (operand, step) in [(receiver, crate::audit::RECEIVER), (stored, crate::audit::STORED)] {
                if let Some(&span) = fx.last_spans.get(&operand) {
                    fx.operand_spans.push(ir::Span { value, start: span.start, end: span.end, step });
                }
            }
        }
        if let Some(made_as) = made_as {
            fx.b.func.values[value.idx()].set_prediction(made_as);
        }
        if ty.checked != TypeId::UNRESOLVED {
            fx.checked.insert(value, ty.checked);
        }
        value
    }

    /// What the language does that is no operation of its own here: the engine knows it by the name.
    pub(crate) fn operation(&mut self, fx: &mut Fx, name: &str, args: &[V]) -> V {
        let name = self.out.strs.intern(name.as_bytes());
        self.emit_throwing(fx, Op::Operation { name, args: args.iter().copied().collect() })
    }

    /// The same for an operation that may throw.
    pub(crate) fn emit_throwing(&mut self, fx: &mut Fx, op: Op) -> V {
        let v = self.emit(fx, op);
        if let Some(&handler) = fx.handlers.last() {
            let next = fx.b.new_block();
            fx.b.terminate(Term::Invoke { normal: ir::Target::new(next), unwind: ir::Target::new(handler) });
            fx.b.seal(next);
            fx.b.switch_to(next);
        }
        v
    }

    /// `module a.ts`: the name of a function that the compiler makes for a module says which, without the directories.
    pub(crate) fn name_after_file(&mut self, what: &str, file: FileId) -> StrId {
        let path = self.files.module(file).file_name();
        let name = path.rsplit(|&byte| byte == b'/').next().unwrap_or(path);
        self.out.strs.intern(&[what.as_bytes(), b" ", name].concat())
    }

    /// The function that evaluates the module. `None`: there is nothing to evaluate.
    pub(crate) fn evaluation_of(&mut self, file: FileId) -> Option<FuncId> {
        if let Some(&known) = self.evaluations.get(&file) {
            return Some(known);
        }
        if self.only_declares(file) {
            return None;
        }
        let name = self.name_after_file("module", file);
        let module = self.module_of(file);
        let kind = if self.builtin_id(file).is_some() || self.is_async_module(file) { FuncKind::Plain } else { FuncKind::Module };
        let evaluation = self.add_func(name, module, 0, kind, Source::Module(file));
        // It has none of the code of the module. Whoever imports the module says the same of it.
        if kind == FuncKind::Module || self.is_async_module(file) {
            self.out.funcs[evaluation.idx()].flags |= ir::func_flags::IS_HIDDEN_IN_STACK_TRACES;
        }
        self.evaluations.insert(file, evaluation);
        Some(evaluation)
    }

    pub(crate) fn evaluation_by_require_of(&mut self, file: FileId) -> Option<FuncId> {
        let evaluation = self.evaluation_of(file)?;
        let path = self.files.module(file).file_name();
        let is_unmarked_script = self.shared.constants.own_paths.is_some() && self.c.is_unmarked_commonjs(file);
        if self.builtin_id(file).is_some() || self.is_async_module(file) || !(self.is_commonjs(file) || path.ends_with(b".cjs") || path.ends_with(b".cts") || is_unmarked_script) {
            return Some(evaluation);
        }
        if let Some(&known) = self.evaluations_by_require.get(&file) {
            return Some(known);
        }
        let name = self.name_after_file("module", file);
        let module = self.module_of(file);
        let by_require = self.add_func(name, module, 0, FuncKind::Plain, Source::Required(file));
        self.out.funcs[by_require.idx()].flags |= ir::func_flags::IS_HIDDEN_IN_STACK_TRACES;
        self.evaluations_by_require.insert(file, by_require);
        Some(by_require)
    }

    /// The function that has the statements of a module that is not one of the runtime's. It takes nothing, and sets and tests nothing: that it
    /// runs once, after what the module imports, is seen to by `evaluation_of`, which calls it, or by the engine where a top-level `await`
    /// is reached from the module (`driver_of`). An async function if the module has a top-level `await` of its own.
    pub(crate) fn body_of(&mut self, file: FileId) -> FuncId {
        if let Some(&known) = self.module_bodies.get(&file) {
            return known;
        }
        let name = self.name_after_file("module", file);
        let module = self.module_of(file);
        let is_async = self.is_async_module(file);
        let body = self.add_func(name, module, 0, if is_async { FuncKind::Plain } else { FuncKind::Module }, Source::ModuleBody(file));
        if is_async {
            let has_await = self.has_top_level_await(file);
            self.out.funcs[body.idx()].flags |= ir::func_flags::IS_CODE_OF_MODULE | if has_await { ir::func_flags::ASYNC } else { 0 };
        }
        if self.c.is_sloppy_function(file, bun_sema::hir::FnId::NONE) {
            self.out.funcs[body.idx()].flags |= ir::func_flags::IS_SLOPPY;
        }
        if self.is_commonjs(file) {
            self.out.funcs[body.idx()].flags |= ir::func_flags::NAME_IS_GIVEN;
        }
        self.module_bodies.insert(file, body);
        body
    }

    fn inner_of(&mut self, file: FileId) -> FuncId {
        if let Some(&known) = self.module_inners.get(&file) {
            return known;
        }
        let name = self.name_after_file("module", file);
        let module = self.module_of(file);
        let inner = self.add_func(name, module, 0, FuncKind::Plain, Source::ModuleInner(file));
        self.out.funcs[inner.idx()].flags |= ir::func_flags::IS_HIDDEN_IN_STACK_TRACES;
        self.module_inners.insert(file, inner);
        inner
    }

    fn driver_of(&mut self, file: FileId) -> FuncId {
        if let Some(&known) = self.module_drivers.get(&file) {
            return known;
        }
        let name = self.name_after_file("module", file);
        let module = self.module_of(file);
        let driver = self.add_func(name, module, 0, FuncKind::Plain, Source::ModuleDriver(file));
        let is_async = self.has_top_level_await(file);
        self.out.funcs[driver.idx()].flags |= ir::func_flags::IS_HIDDEN_IN_STACK_TRACES | if is_async { ir::func_flags::ASYNC } else { 0 };
        self.module_drivers.insert(file, driver);
        driver
    }

    fn is_resolved_by_nobody(&self, file: FileId, dependency: Dependency) -> bool {
        matches!(dependency, Dependency::External(specifier) if !self.is_resolved_by_bundler(file, specifier) && !imports::is_builtin_specifier(self.c.atoms().bytes(self.as_the_host_names_it(specifier))))
    }

    fn imports_nobody_resolved(&self) -> FxHashMap<FileId, Vec<(FileId, Atom)>> {
        let mut found = FxHashMap::default();
        if self.shared.constants.own_paths.is_none() || self.shared.bundle.is_none() {
            return found;
        }
        let modules = || self.shared.modules.iter().copied().filter(|&file| !self.is_builtin_file(file));
        if !modules().any(|file| self.dependencies_of(file).into_iter().any(|dependency| self.is_resolved_by_nobody(file, dependency))) {
            return found;
        }
        let dependencies: FxHashMap<FileId, Vec<Dependency>> = modules().map(|file| (file, self.dependencies_of(file))).collect();
        let mut importers: FxHashMap<FileId, Vec<FileId>> = FxHashMap::default();
        let mut pending: Vec<FileId> = Vec::new();
        for (&file, of_file) in &dependencies {
            for &dependency in of_file {
                match dependency {
                    Dependency::Module(imported) => importers.entry(imported).or_default().push(file),
                    Dependency::External(_) if self.is_resolved_by_nobody(file, dependency) => pending.push(file),
                    Dependency::External(_) => {}
                }
            }
        }
        let mut reaching: FxHashSet<FileId> = FxHashSet::default();
        while let Some(file) = pending.pop() {
            if reaching.insert(file) {
                pending.extend(importers.get(&file).into_iter().flatten().copied());
            }
        }
        for &root in &reaching {
            let (mut met, mut walked) = (Vec::new(), FxHashSet::default());
            self.meet_imports_nobody_resolved(root, &dependencies, &reaching, &mut walked, &mut met);
            found.insert(root, met);
        }
        found
    }

    fn meet_imports_nobody_resolved(&self, file: FileId, dependencies: &FxHashMap<FileId, Vec<Dependency>>, reaching: &FxHashSet<FileId>, walked: &mut FxHashSet<FileId>, met: &mut Vec<(FileId, Atom)>) {
        if !walked.insert(file) {
            return;
        }
        for &dependency in dependencies.get(&file).into_iter().flatten() {
            match dependency {
                Dependency::Module(imported) if reaching.contains(&imported) => self.meet_imports_nobody_resolved(imported, dependencies, reaching, walked, met),
                Dependency::External(specifier) if self.is_resolved_by_nobody(file, dependency) => met.push((file, specifier)),
                _ => {}
            }
        }
    }

    fn emit_resolution_of_imports_nobody_resolved(&mut self, fx: &mut Fx, file: FileId) {
        let shared = self.shared;
        for &(importer, specifier) in shared.imports_nobody_resolved.get(&file).into_iter().flatten() {
            let Some(path) = self.own_path(importer, b"path") else { continue };
            let (path, resolve, specifier) = (self.out.strs.intern(&path), self.out.strs.intern(b"resolveSync"), self.str(specifier));
            let path = self.emit(fx, Op::Str(path));
            let meta = self.operation(fx, "GetImportMeta", &[path]);
            let specifier = self.emit(fx, Op::Str(specifier));
            self.emit_throwing(fx, Op::CallMethod { obj: meta, name: resolve, args: [specifier].into_iter().collect() });
        }
    }

    fn json_modules_read_by_name(&self) -> FxHashSet<FileId> {
        let mut found = FxHashSet::default();
        if !self.shared.modules.iter().any(|&file| self.hir(file).kind == FileKind::Json) {
            return found;
        }
        let runs_in_place = self.shared.constants.own_paths.is_some();
        for &file in &self.shared.modules {
            let hir = self.hir(file);
            for used in hir.specifier_uses.iter().filter(|used| matches!(used.kind, hir::SpecifierKind::Import | hir::SpecifierKind::ImportCall)) {
                let Some(imported) = self.imported_file(file, used.spec).filter(|&imported| self.hir(imported).kind == FileKind::Json) else { continue };
                let takes_a_name = match used.kind {
                    hir::SpecifierKind::ImportCall => runs_in_place,
                    _ => hir.ids(hir.body).any(|stmt| match hir[stmt].kind {
                        StmtKind::Import(import) => {
                            let import = &hir[import];
                            import.spec == used.spec && !import.type_only && (import.namespace.is_some() || import.named.iter().any(|named| hir[named].imported != bun_sema::atom::known::default))
                        }
                        StmtKind::ExportNamed(export) => hir[export].spec == used.spec && !hir[export].type_only,
                        StmtKind::ExportStar { spec, type_only, .. } => spec == used.spec && !type_only,
                        _ => false,
                    }),
                };
                if takes_a_name {
                    found.insert(imported);
                }
            }
        }
        found
    }

    fn modules_imported_deferred(&self) -> FxHashSet<FileId> {
        let mut found = FxHashSet::default();
        for &file in &self.shared.modules {
            for import in self.hir(file).imports.iter().filter(|import| import.is_deferred && !import.type_only) {
                let Some(imported) = self.imported_file(file, import.spec) else { continue };
                let is_evaluated_at_once = self.exports_an_object(imported) || self.is_builtin_file(imported) || self.shared.roots.contains(&imported) || self.shared.prelude.contains(&imported) || self.shared.async_modules.contains(&imported);
                if !is_evaluated_at_once {
                    found.insert(imported);
                }
            }
        }
        found
    }

    /// What the module evaluates before its body, in order.
    fn dependencies_of(&self, file: FileId) -> Vec<Dependency> {
        let hir = self.hir(file);
        let mut specifiers = Vec::new();
        // The implicit import of the JSX runtime comes first. A file without JSX has none.
        if let Some(runtime) = self.jsx_runtime(file)
            && hir.exprs.iter().any(|e| matches!(e.kind, hir::ExprKind::Jsx(_)))
        {
            let key_name = self.c.atoms().lookup(b"key");
            let has_key_behind_spread = |jsx: hir::JsxId| {
                let attributes = hir[jsx].attrs;
                let first_spread = attributes.iter().position(|p| hir[p].kind == hir::PropKind::Spread);
                first_spread.is_some_and(|first| attributes.iter().skip(first).any(|p| hir[p].kind != hir::PropKind::Spread && matches!(hir[p].key, hir::PropKey::Name(name) if Some(name) == key_name)))
            };
            if hir.exprs.iter().any(|e| matches!(e.kind, hir::ExprKind::Jsx(jsx) if !has_key_behind_spread(jsx))) {
                specifiers.push((runtime, false));
            }
            if hir.exprs.iter().any(|e| matches!(e.kind, hir::ExprKind::Jsx(jsx) if has_key_behind_spread(jsx))) {
                let text = self.c.atoms().bytes(runtime);
                let package = text.strip_suffix(b"/jsx-runtime").or_else(|| text.strip_suffix(b"/jsx-dev-runtime")).unwrap_or(text);
                specifiers.push((self.c.atoms().intern(package), false));
            }
        }
        for stmt in hir.ids(hir.body) {
            let specifier = match hir[stmt].kind {
                StmtKind::Import(import) if self.text_imported_as(file, hir[import].spec).is_some() || self.type_told_to_the_host(file, hir[import].spec).is_some() => continue,
                StmtKind::Import(import) if hir[import].is_deferred && self.imported_file(file, hir[import].spec).is_some_and(|imported| self.shared.modules_deferred.contains(&imported)) => continue,
                StmtKind::Import(import) if !hir[import].type_only => hir[import].spec,
                StmtKind::ExportNamed(export) if !hir[export].type_only => hir[export].spec,
                StmtKind::ExportStar { spec, type_only: false, .. } => spec,
                _ => continue,
            };
            if specifier.is_some() && !(imports::names_only_types(hir, stmt) && !self.is_resolved_by_bundler(file, specifier)) {
                specifiers.push((specifier, self.shared.bundle.is_none() && matches!(hir[stmt].kind, StmtKind::Import(_)) && self.is_import_of_asset(file, stmt)));
            }
        }
        let mut dependencies = Vec::new();
        for (specifier, is_asset) in specifiers {
            let text = self.c.atoms().bytes(specifier);
            // `bun:bundle` only exists while bundling: `feature()` is replaced by a constant. For `import "./global.d.ts"` there is
            // nothing to evaluate.
            if !is_asset && (text == b"bun:bundle" || self.is_dropped_import(file, specifier) || text.ends_with(b".d.ts")) {
                continue;
            }
            dependencies.push(match self.imported_file(file, specifier).filter(|_| !is_asset) {
                Some(imported) => Dependency::Module(imported),
                None => Dependency::External(specifier),
            });
        }
        dependencies
    }

    /// Tells the checker which module evaluates which. Yields `Shared::modules` and `Shared::async_modules`.
    fn tell_module_graph(&mut self) -> (Vec<FileId>, FxHashSet<FileId>) {
        let (mut modules, mut edges, mut builtin_requires) = (Vec::new(), Vec::new(), Vec::new());
        let mut seen: FxHashSet<FileId> = FxHashSet::default();
        let mut pending = self.shared.roots.clone();
        pending.extend(&self.shared.prelude);
        pending.extend(self.shared.runtime_helpers_loadable_by_computed_name());
        pending.extend(self.shared.builtin_modules.iter().map(|module| module.1));
        pending.extend(self.shared.builtin_functions.list.iter().map(|function| function.file));
        let mut waiting: Vec<FileId> = Vec::new();
        while let Some(file) = pending.pop() {
            if self.only_declares(file) || !seen.insert(file) {
                continue;
            }
            modules.push(file);
            if self.has_top_level_await(file) {
                waiting.push(file);
            }
            let hir = self.hir(file);
            let first = self.dependencies_of(file).into_iter().filter_map(|dependency| match dependency {
                Dependency::Module(imported) => Some((imported, Evaluates::First)),
                Dependency::External(_) => None,
            });
            let candidates = self.c.create_require_candidates(file).to_vec();
            let texts_of = |e: hir::ExprId| {
                let mut found = Vec::new();
                hir.choice_of_specifiers(e, &mut found).then_some(found)
            };
            let runs_in_place = self.shared.constants.own_paths.is_some();
            let texts_held_by = |e: hir::ExprId| {
                let hir::ExprKind::Ident(name) = hir[e].kind else { return None };
                let held = hir.var_decls.iter().filter(|declaration| runs_in_place && declaration.init.is_some() && matches!(hir[declaration.pat].kind, hir::PatKind::Ident(declared) if declared == name));
                let texts: Vec<Atom> = held.filter_map(|declaration| if let hir::ExprKind::String(text) = hir[declaration.init].kind { Some(text) } else { None }).collect();
                (!texts.is_empty()).then_some((texts, Evaluates::Later))
            };
            let on_demand = hir.exprs.iter().enumerate().filter_map(|(i, e)| match e.kind {
                hir::ExprKind::ImportCall { args } => {
                    let is_in_function = self.c.enclosing_fn_of_expr(file, hir::ExprId(i as u32)).is_some();
                    let argument = hir.ids(args).next()?;
                    match texts_of(argument) {
                        Some(texts) => Some((texts, if is_in_function { Evaluates::Later } else { Evaluates::LaterFromItsBody })),
                        None => texts_held_by(argument),
                    }
                }
                hir::ExprKind::Call(call) if matches!(hir[hir[call].callee].kind, hir::ExprKind::Ident(name) if self.c.atoms().bytes(name) == b"require") => {
                    let is_in_function = self.c.enclosing_fn_of_expr(file, hir::ExprId(i as u32)).is_some();
                    let argument = hir.ids(hir[call].args).next()?;
                    match texts_of(argument) {
                        Some(texts) => Some((texts, if is_in_function { Evaluates::AtOnce } else { Evaluates::InItsBody })),
                        None => {
                            let mut written = Vec::new();
                            if self.shared.constants.own_paths.is_some() {
                                written_sides_of_choice(hir, argument, 0, &mut written);
                            }
                            if written.is_empty() { texts_held_by(argument) } else { Some((written, Evaluates::Later)) }
                        }
                    }
                }
                hir::ExprKind::Call(call) if hir[call].args.len() == 1 && matches!(hir[hir[call].callee].kind, hir::ExprKind::Ident(name) if candidates.contains(&name)) => {
                    let is_in_function = self.c.enclosing_fn_of_expr(file, hir::ExprId(i as u32)).is_some();
                    Some((texts_of(hir.id_at(hir[call].args, 0))?, if is_in_function { Evaluates::AtOnce } else { Evaluates::InItsBody }))
                }
                hir::ExprKind::Call(call) if self.shared.constants.own_paths.is_some() => {
                    if let hir::ExprKind::Ident(name) = hir[hir[call].callee].kind {
                        let says_require = !hir[call].args.is_empty() && bun_core::strings::contains(self.c.atoms().bytes(name), b"quire");
                        return if says_require { Some((texts_of(hir.id_at(hir[call].args, 0))?, Evaluates::Later)) } else { None };
                    }
                    let hir::ExprKind::Dot { obj, name, .. } = hir[hir[call].callee].kind else { return None };
                    let is_module = |e: hir::ExprId| matches!(hir[e].kind, hir::ExprKind::Ident(name) if self.c.atoms().bytes(name) == b"module");
                    let args = hir[call].args;
                    let resolves = |e: hir::ExprId| match hir[e].kind {
                        hir::ExprKind::Ident(name) => bun_core::strings::contains(self.c.atoms().bytes(name), b"equire"),
                        hir::ExprKind::ImportMeta => true,
                        _ => false,
                    };
                    let specifier = match (self.c.atoms().bytes(name), args.len()) {
                        (b"require", 1) if is_module(obj) => hir.id_at(args, 0),
                        (b"call", 2) if is_module(hir.id_at(args, 0)) => hir.id_at(args, 1),
                        (b"resolve", 1..) if resolves(obj) => hir.id_at(args, 0),
                        (b"resolveSync", 1..) if matches!(hir[obj].kind, hir::ExprKind::ImportMeta) => hir.id_at(args, 0),
                        _ => return None,
                    };
                    Some((texts_of(specifier)?, Evaluates::Later))
                }
                _ => None,
            });
            let on_demand = on_demand.flat_map(|(specifiers, how)| specifiers.into_iter().map(move |specifier| (specifier, how)));
            let required = hir.ids(hir.body).filter_map(|stmt| match hir[stmt].kind {
                StmtKind::ImportEquals(import) => match hir[import].target {
                    hir::ImportEqualsTarget::Require(specifier) if specifier.is_some() => Some((specifier, Evaluates::InItsBody)),
                    _ => None,
                },
                _ => None,
            });
            let file_named = |specifier: Atom, how: Evaluates| if matches!(how, Evaluates::AtOnce | Evaluates::InItsBody) { self.required_file(file, specifier) } else { self.imported_file(file, specifier) };
            let on_demand: Vec<(Atom, FileId, Evaluates)> = on_demand.chain(required).filter_map(|(specifier, how)| Some((specifier, file_named(specifier, how)?, how))).collect();
            if self.is_builtin_file(file) {
                builtin_requires.extend(on_demand.iter().map(|&(specifier, imported, _)| ((file, specifier), imported)));
            }
            let again = self.second_form_of(file).map(|second| (second, Evaluates::Later));
            for (imported, how) in first.chain(on_demand.into_iter().map(|(_, imported, how)| (imported, how))).chain(again) {
                edges.push((file, imported, how));
                pending.push(imported);
            }
        }
        modules.sort_unstable();
        edges.sort_unstable();
        edges.dedup();
        let primitives = |defines: &Defines| defines.values.iter().filter(|(_, value)| value.is_primitive()).map(|(name, _)| name.clone()).collect();
        self.c.set_replaced_by_primitives(primitives(&self.shared.defines), primitives(&self.shared.builtin_defines));
        self.c.set_module_graph(&modules, &edges, !waiting.is_empty());
        self.c.set_builtin_requires(builtin_requires);
        let mut importers: FxHashMap<FileId, Vec<FileId>> = FxHashMap::default();
        for &(importer, imported, how) in &edges {
            if how == Evaluates::First {
                importers.entry(imported).or_default().push(importer);
            }
        }
        let mut async_modules = FxHashSet::default();
        while let Some(module) = waiting.pop() {
            if async_modules.insert(module) {
                waiting.extend(importers.get(&module).into_iter().flatten().copied());
            }
        }
        (modules, async_modules)
    }

    /// Whether the initializer of the variable runs when the variable is first read: `Checker::is_lazy_variable`.
    pub(crate) fn is_lazy(&mut self, sym: Sym) -> bool {
        if let Some(&known) = self.lazy.get(&sym) {
            return known;
        }
        let file = sym.file;
        let is_lazy = self.shared.is_compiled(file)
            && !self.c.may_be_overridden(sym)
            && !self.shared.is_prelude(file)
            && !self.is_builtin_file(file)
            && !self.exports_an_object(file)
            && !self.is_async_module(file)
            && self.c.is_lazy_variable(sym);
        self.lazy.insert(sym, is_lazy);
        is_lazy
    }

    fn state_of_lazy_variable(&mut self, sym: Sym) -> Option<GlobalId> {
        if let Some(&known) = self.states_of_lazy_variables.get(&sym) {
            return known;
        }
        let state = self.c.keeps_its_state_apart(sym).then(|| {
            let name = [self.c.atoms().bytes(self.files.symbol(sym).name), b" is initialized"].concat();
            let name = self.out.strs.intern(&name);
            let state = self.add_global(name, sym.file, Ty::NONE, GlobalKey::StateOfLazyVariable(sym.file, sym.id));
            self.out.globals[state.idx()].initialization = ir::Initialization::Undefined;
            state
        });
        self.states_of_lazy_variables.insert(sym, state);
        state
    }

    /// The function that evaluates the initializer of a lazy variable and stores it. It takes nothing. It yields what it has stored, which is neither `undefined` nor `null`, where the
    /// variable has a type and keeps its state in its own slot. Otherwise nothing.
    fn initializer_of(&mut self, sym: Sym) -> FuncId {
        if let Some(&known) = self.initializers.get(&sym) {
            return known;
        }
        let name = self.name_after_file("module", sym.file);
        let module = self.module_of(sym.file);
        let initializer = self.add_func(name, module, 0, FuncKind::Module, Source::Initializer(sym));
        self.initializers.insert(sym, initializer);
        if self.state_of_lazy_variable(sym).is_none() {
            let global = self.global_of(sym);
            let held = self.out.globals[global.idx()].declared;
            let made = self.not_nil(held);
            if made != held {
                self.out.funcs[initializer.idx()].result = made;
            }
        }
        initializer
    }

    /// The lazy variables that the file declares, with where each declaration starts and ends. Ascending.
    pub(crate) fn lazy_declarations_of(&mut self, file: FileId) -> Rc<Vec<(u32, u32, Sym)>> {
        if let Some(known) = self.lazy_declarations.get(&file) {
            return known.clone();
        }
        let hir = self.hir(file);
        let mut found = Vec::new();
        for stmt in hir.ids(hir.body) {
            let hir::StmtKind::Var(decls) = hir[stmt].kind else { continue };
            for d in decls.iter().filter(|&d| hir[d].kind == hir::VarKind::Const && hir[d].init.is_some() && matches!(hir[hir[d].pat].kind, hir::PatKind::Ident(_))) {
                let mut names = Vec::new();
                self.names_of_pat(file, hir[d].pat, &mut names);
                if let [sym] = names[..]
                    && self.is_lazy(sym)
                {
                    found.push((hir[d].loc.pos, hir[d].loc.end, sym));
                }
            }
        }
        let found = Rc::new(found);
        self.lazy_declarations.insert(file, found.clone());
        found
    }

    /// The lazy variable whose declaration the position is in.
    pub(crate) fn lazy_variable_declared_at(&mut self, file: FileId, pos: u32) -> Option<Sym> {
        let declarations = self.lazy_declarations_of(file);
        let next = declarations.partition_point(|&(start, ..)| start <= pos);
        declarations[..next].last().filter(|&&(_, end, _)| pos < end).map(|&(.., sym)| sym)
    }

    /// The slot holds `undefined` while the variable is in its dead zone, `null` once its turn has come, which the declaration stores,
    /// and then the value, which is neither. Where no read can be early the declaration stores nothing, and `undefined` says that its
    /// turn has come. `may_be_early`: this read. Where the initializer is a call marked pure the slot has the value alone, which may be either, and `state_of_lazy_variable` the rest.
    pub(crate) fn read_lazy_variable(&mut self, fx: &mut Fx, global: GlobalId, sym: Sym, may_be_early: bool) -> V {
        self.touch_module(fx, sym.file);
        let found = self.emit_as_it_is(fx, Op::GlobalGet(global));
        if self.initializers.get(&sym) == Some(&fx.id) || fx.initialized_before_loops.contains(&global) {
            return found;
        }
        let is_known = match fx.found_initialized.get(&global) {
            Some(&known) => known,
            None => {
                let is_known = fx.b.new_var(self.known.boolean);
                fx.b.start_var_as(is_known, Op::Bool(false), self.known.no);
                fx.found_initialized.insert(global, is_known);
                is_known
            }
        };
        if fx.true_value.is_none() {
            fx.true_value = fx.b.entry_constant(Op::Bool(true), self.known.yes);
        }
        if fx.b.read(is_known) == fx.true_value {
            return found;
        }
        let func = self.initializer_of(sym);
        // In untyped code a read says nothing of what it yields, whatever the variable is declared to hold.
        let read_as = self.ty(fx, found);
        let made = self.out.funcs[func.idx()].result;
        let is_made_known = made.is_some() && self.not_nil(read_as) == made;
        let value = fx.b.new_var(if is_made_known { made } else { read_as });
        let is_missing = self.emit(fx, Op::IsNullish(found));
        let (initialize, done) = (fx.b.new_block(), fx.b.new_block());
        if is_made_known {
            let present = fx.b.new_block();
            self.branch(fx, is_missing, initialize, present);
            fx.b.seal(present);
            fx.b.switch_to(present);
            let held = self.emit_throwing(fx, Op::Coerce { value: found, to: made, why: ir::Why::NonNull(StrId::NONE) });
            fx.b.write(value, held);
            fx.b.jump(done);
        } else {
            fx.b.write(value, found);
            self.branch(fx, is_missing, initialize, done);
        }
        fx.b.seal(initialize);
        fx.b.switch_to(initialize);
        let state = self.state_of_lazy_variable(sym);
        if let Some(state) = state {
            let state = self.emit_as_it_is(fx, Op::GlobalGet(state));
            let is_there = self.emit(fx, Op::StrictEq { a: state, b: fx.true_value });
            let is_not = fx.b.new_block();
            self.branch(fx, is_there, done, is_not);
            fx.b.seal(is_not);
            fx.b.switch_to(is_not);
            self.throw_if_in_dead_zone(fx, sym, state);
        } else if may_be_early && !self.c.is_never_seen_uninitialized(sym) {
            self.throw_if_in_dead_zone(fx, sym, found);
        }
        let yielded = self.emit_throwing(fx, Op::CallDirect { func, args: ir::Args::new() });
        let stored = if is_made_known { yielded } else { self.emit_as_it_is(fx, Op::GlobalGet(global)) };
        fx.b.write(value, stored);
        fx.b.jump(done);
        fx.b.seal(done);
        fx.b.switch_to(done);
        fx.b.write(is_known, fx.true_value);
        fx.b.read(value)
    }

    /// `f(..)` where `const f = () => ..` is lazy and the function captures nothing: the call needs neither the variable nor a closure.
    pub(crate) fn lazy_function_named_by(&mut self, fx: &Fx, e: hir::ExprId) -> Option<(Sym, FuncId)> {
        let hir::ExprKind::Ident(name) = self.hir(fx.file)[e].kind else { return None };
        let sym = self.c.binding_of_identifier(fx.file, e, name)?;
        let sym = self.value_symbol(sym);
        Some((sym, self.lazy_function_held_by(fx, sym)?))
    }

    pub(crate) fn lazy_function_held_by(&mut self, fx: &Fx, sym: Sym) -> Option<FuncId> {
        if !self.is_lazy(sym) {
            return None;
        }
        let (file, d) = self.c.declaration_of_lazy_variable(sym)?;
        let hir = self.hir(file);
        let hir::ExprKind::Fn(func) = hir[hir[d].init].kind else { return None };
        // A function expression with a name of its own sees its closure under that name.
        if hir[func].kind != hir::FnKind::Arrow && hir[func].name.is_some() {
            return None;
        }
        // NamedEvaluation: it takes its name from the variable, whoever comes by it first: this call, or the initializer.
        if let hir::PatKind::Ident(name) = hir[hir[d].pat].kind
            && hir[func].name.is_none()
        {
            let name = self.str(name);
            self.given_function_names.entry((file, func)).or_insert(name);
        }
        let id = self.function_of_declaration(fx, file, func)?;
        self.captures.get(&id).is_none_or(|captures| captures.is_empty()).then_some(id)
    }

    /// The reference `e` to a lazy variable whose value is not asked for throws if the variable is in its dead zone.
    pub(crate) fn check_turn_of_lazy_variable(&mut self, fx: &mut Fx, sym: Sym, e: hir::ExprId) {
        if self.c.is_never_seen_uninitialized(sym) || !self.may_be_in_dead_zone(fx, sym, e) {
            return;
        }
        let global = match self.state_of_lazy_variable(sym) {
            Some(state) => state,
            None => self.global_of(sym),
        };
        self.touch_module(fx, sym.file);
        let found = self.emit_as_it_is(fx, Op::GlobalGet(global));
        self.throw_if_in_dead_zone(fx, sym, found);
    }

    fn throw_if_in_dead_zone(&mut self, fx: &mut Fx, sym: Sym, found: V) {
        let undefined = self.emit(fx, Op::Undefined);
        let is_early = self.emit(fx, Op::StrictEq { a: found, b: undefined });
        let (early, due) = (fx.b.new_block(), fx.b.new_block());
        self.branch(fx, is_early, early, due);
        fx.b.seal(early);
        fx.b.seal(due);
        fx.b.switch_to(early);
        let name = self.c.atoms().bytes(self.files.symbol(sym).name).to_vec();
        let message = if self.shared.constants.shortens_names { [&[crate::names::MARK_OF_DEAD_ZONE][..], &name].concat() } else { crate::names::message_of_dead_zone(&name) };
        self.throw_error(fx, b"ReferenceError", &message);
        fx.b.switch_to(due);
    }

    pub(crate) fn emit_tdz_check(&mut self, fx: &mut Fx, e: hir::ExprId) {
        self.check_default_exports_passed(fx, e);
        let hir::ExprKind::Ident(name) = self.hir(fx.file)[e].kind else { return };
        let Some(named) = self.c.binding_of_identifier(fx.file, e, name) else { return };
        let named = self.value_symbol(named);
        fx.b.pos = self.hir(fx.file)[e].pos;
        if self.c.may_be_overridden(named) {
            self.read_reference(fx, named, e);
        } else if self.is_lazy(named) {
            self.check_turn_of_lazy_variable(fx, named, e);
        } else if let Some((file, bun_sema::bind::Decl::Class(class))) = self.value_declaration(named) {
            self.check_class_is_declared(fx, file, class, e);
        } else if self.may_be_in_dead_zone(fx, named, e) {
            self.read_reference(fx, named, e);
        }
    }

    /// Where the language has the variable initialized.
    pub(crate) fn declare_lazy_variable(&mut self, fx: &mut Fx, sym: Sym) {
        let global = self.global_of(sym);
        // The fragment of the file is the one that has it, whoever reads the variable.
        self.initializer_of(sym);
        for &named in self.c.names_found_initialized_where_declared(sym).iter() {
            self.find_initialized(fx, named);
        }
        if let Some(state) = self.state_of_lazy_variable(sym) {
            let due = self.emit(fx, Op::Bool(false));
            self.emit(fx, Op::GlobalSet(state, due));
        } else if !self.c.is_never_seen_uninitialized(sym) {
            let due = self.emit(fx, Op::Null);
            self.emit(fx, Op::GlobalSet(global, due));
        }
    }

    fn find_initialized(&mut self, fx: &mut Fx, named: Sym) {
        let named = self.value_symbol(named);
        if self.c.may_be_overridden(named) {
            let pos = fx.b.pos;
            self.read_sym(fx, named, pos);
        } else if self.is_lazy(named) {
            self.check_turn_of_lazy_variable(fx, named, hir::ExprId::NONE);
        } else if let Some((file, bun_sema::bind::Decl::Class(class))) = self.value_declaration(named) {
            self.check_class_is_declared(fx, file, class, hir::ExprId::NONE);
        } else if self.may_be_in_dead_zone(fx, named, hir::ExprId::NONE) {
            let pos = fx.b.pos;
            self.read_sym(fx, named, pos);
        }
    }

    fn emit_initializer(&mut self, fx: &mut Fx, sym: Sym) {
        let Some((file, d)) = self.c.declaration_of_lazy_variable(sym) else { return };
        let decl = self.hir(file)[d];
        fx.b.pos = decl.loc.pos;
        self.global_of(sym);
        let state = self.state_of_lazy_variable(sym);
        if let Some(state) = state {
            let under_way = self.emit(fx, Op::Undefined);
            self.emit(fx, Op::GlobalSet(state, under_way));
        }
        let value = self.initial_value(fx, &decl);
        self.bind_pat(fx, decl.pat, value);
        if let Some(state) = state {
            let there = self.emit(fx, Op::Bool(true));
            self.emit(fx, Op::GlobalSet(state, there));
        }
        let made = self.out.funcs[fx.id.idx()].result;
        if made.is_some() {
            let global = self.global_of(sym);
            let stored = self.emit_as_it_is(fx, Op::GlobalGet(global));
            let held = if self.ty(fx, stored) == made { stored } else { self.emit_throwing(fx, Op::Coerce { value: stored, to: made, why: ir::Why::NonNull(StrId::NONE) }) };
            self.terminate_with_return(fx, held);
        }
    }

    /// Where the code of the file names a lazy variable: the position, the function that runs the code, the variable. Ascending.
    fn uses_of_lazy_variables(&mut self) -> Rc<Vec<(u32, FnId, Sym)>> {
        if let Some(known) = &self.lazy_uses {
            return known.clone();
        }
        let file = self.file;
        let (hir, bound) = (self.hir(file), self.c.bound(file));
        let mut uses = Vec::new();
        for (i, e) in hir.exprs.iter().enumerate() {
            let hir::ExprKind::Ident(name) = e.kind else { continue };
            let (e, pos) = (hir::ExprId(i as u32), e.pos);
            if matches!(bound.expr_parent[e.idx()], bun_sema::bind::Parent::None) || bound.is_in_type_query(e) {
                continue;
            }
            let Some(sym) = self.c.binding_of_identifier(file, e, name) else { continue };
            let sym = self.value_symbol(sym);
            if self.is_lazy(sym) {
                uses.push((pos, self.function_running(file, e), sym));
            }
        }
        uses.sort_unstable_by_key(|&(pos, ..)| pos);
        let uses = Rc::new(uses);
        self.lazy_uses = Some(uses.clone());
        uses
    }

    /// Before a loop: what its code would test each time round is seen to once. Nobody can tell that an initializer ran early. Not for a
    /// variable that may be in its dead zone: the read that finds it there has to throw, and no other.
    fn uses_of_modules_put_off(&mut self) -> Rc<Vec<(u32, FnId, FileId, u32)>> {
        if let Some(known) = &self.uses_of_modules_put_off {
            return known.clone();
        }
        let file = self.file;
        let (hir, bound) = (self.hir(file), self.c.bound(file));
        let mut uses = Vec::new();
        for (i, e) in hir.exprs.iter().enumerate() {
            let hir::ExprKind::Ident(name) = e.kind else { continue };
            let (e, pos) = (hir::ExprId(i as u32), e.pos);
            if matches!(bound.expr_parent[e.idx()], bun_sema::bind::Parent::None) || bound.is_in_type_query(e) {
                continue;
            }
            let Some(sym) = self.c.binding_of_identifier(file, e, name) else { continue };
            let sym = self.value_symbol(sym);
            if sym.file != file && self.is_evaluated_when_touched(sym.file) {
                uses.push((pos, self.function_running(file, e), sym.file, 0));
            }
        }
        uses.sort_unstable_by_key(|&(pos, ..)| pos);
        let mut tries: Vec<(u32, u32)> = hir.stmts.iter().filter(|stmt| matches!(stmt.kind, StmtKind::Try { .. })).map(|stmt| (stmt.start, stmt.loc.end)).collect();
        tries.sort_unstable();
        let (mut next, mut open): (usize, Vec<(u32, u32)>) = (0, Vec::new());
        for (pos, .., innermost) in uses.iter_mut() {
            while next < tries.len() && tries[next].0 <= *pos {
                open.push(tries[next]);
                next += 1;
            }
            open.retain(|&(_, end)| *pos < end);
            *innermost = open.last().map_or(0, |&(start, _)| start + 1);
        }
        let uses = Rc::new(uses);
        self.uses_of_modules_put_off = Some(uses.clone());
        uses
    }

    pub(crate) fn initialize_before_loop(&mut self, fx: &mut Fx, start: u32, end: u32) {
        if fx.file != self.file {
            return;
        }
        if !self.shared.modules_put_off.is_empty() {
            let uses = self.uses_of_modules_put_off();
            let first = uses.partition_point(|&(pos, ..)| pos < start);
            let running = fx.func;
            let in_loop = || uses[first..].iter().take_while(|&&(pos, ..)| pos < end).filter(move |&&(_, by, ..)| by == running);
            let under_a_try: Vec<FileId> = in_loop().filter(|&&(.., innermost_try)| innermost_try > start).map(|&(_, _, module, _)| module).collect();
            for &(_, _, module, _) in in_loop() {
                if !under_a_try.contains(&module) && !fx.modules_asked_for_before_loops.contains(&module) {
                    self.touch_module(fx, module);
                    fx.modules_asked_for_before_loops.push(module);
                }
            }
        }
        let uses = self.uses_of_lazy_variables();
        let first = uses.partition_point(|&(pos, ..)| pos < start);
        for &(_, by, sym) in uses[first..].iter().take_while(|&&(pos, ..)| pos < end) {
            if by != fx.func || !self.c.is_never_seen_uninitialized(sym) || self.c.runs_code_when_initialized(sym) {
                continue;
            }
            let global = self.global_of(sym);
            if !fx.initialized_before_loops.contains(&global) {
                self.read_lazy_variable(fx, global, sym, false);
                fx.initialized_before_loops.push(global);
            }
        }
    }

    /// Evaluates what the module imports, in order.
    fn emit_dependencies(&mut self, fx: &mut Fx, file: FileId) {
        self.emit_resolution_of_imports_nobody_resolved(fx, file);
        let hir = self.hir(file);
        let mut types_said: Vec<(Atom, Option<Atom>)> = Vec::new();
        for stmt in hir.ids(hir.body) {
            let specifier = match hir[stmt].kind {
                StmtKind::Import(import) => hir[import].spec,
                StmtKind::ExportNamed(export) => hir[export].spec,
                StmtKind::ExportStar { spec, .. } => spec,
                _ => continue,
            };
            if !hir.import_attributes.is_empty() && self.shared.bundle.is_some() && matches!(hir[stmt].kind, StmtKind::Import(import) if !hir[import].type_only) {
                let said = self.type_attribute(file, stmt);
                match types_said.iter().find(|known| known.0 == specifier) {
                    Some(known) if known.1 != said => self.problem(file, hir[stmt].start, "two imports of one file in one module that do not say the same `type`"),
                    Some(_) => {}
                    None => types_said.push((specifier, said)),
                }
                if self.type_told_to_the_host(file, specifier).is_some() && !self.is_dropped_import(file, specifier) {
                    self.emit_value_of_asset(fx, file, specifier, b"");
                }
            }
            if self.is_dropped_import(file, specifier) {
                self.dropped.push((hir[stmt].start, hir[stmt].loc.end));
            }
        }
        let importer = file;
        let mut in_order: Vec<(FileId, Dependency)> = Vec::new();
        for dependency in self.dependencies_of(importer) {
            match dependency {
                Dependency::Module(imported) if self.is_walked_through(importer, imported) => in_order.extend_from_slice(self.what_stands_behind(imported)),
                _ => in_order.push((importer, dependency)),
            }
        }
        let (mut seen, mut asked): (FxHashSet<FileId>, FxHashSet<Atom>) = Default::default();
        in_order.retain(|&(owner, dependency)| match dependency {
            Dependency::Module(imported) => seen.insert(imported) || owner == importer,
            Dependency::External(specifier) => asked.insert(self.as_the_host_finds_it(owner, specifier)) || owner == importer,
        });
        for (file, dependency) in in_order {
            let is_the_importer = file == importer;
            match dependency {
                Dependency::Module(imported) => {
                    let is_left_to_the_host = self.c.module_may_be_overridden(imported) && self.is_seen_through_the_host(imported);
                    if !is_left_to_the_host
                        && let Some(func) = self.evaluation_of(imported)
                    {
                        let func = if self.is_async_module(imported) { self.inner_of(imported) } else { func };
                        self.emit_throwing(fx, Op::CallDirect { func, args: ir::Args::new() });
                        if self.is_async_module(imported) {
                            let (module, required) = (self.module_record_of(file), self.module_record_of(imported));
                            let (module, required) = (self.emit(fx, Op::GlobalGet(module)), self.emit(fx, Op::GlobalGet(required)));
                            self.operation(fx, "DidEvaluateRequiredModule", &[module, required]);
                        }
                    }
                    if self.waits_for_its_place(imported) && self.is_imported_for_its_effects(file, imported) {
                        let func = self.function_for_deferred_module(imported, Source::ModuleTouch(imported));
                        self.emit_throwing(fx, Op::CallDirect { func, args: ir::Args::new() });
                    }
                    if is_the_importer && self.shared.constants.own_paths.is_none() && !self.has_export_variables(imported) && self.is_namespace_used_as_a_value(file, imported) {
                        self.namespace_of_exported_object(fx, file, imported);
                    }
                    if self.is_seen_through_the_host(imported) {
                        self.namespace_by_the_host(fx, imported);
                    }
                }
                // The host evaluates it the first time it is asked for.
                Dependency::External(specifier) => {
                    let hir = self.hir(file);
                    let is_the_import = |stmt: &hir::StmtId| match hir[*stmt].kind {
                        StmtKind::Import(import) => hir[import].spec == specifier,
                        StmtKind::ExportNamed(export) => hir[export].spec == specifier,
                        StmtKind::ExportStar { spec, .. } => spec == specifier,
                        _ => false,
                    };
                    let stmt = hir.ids(hir.body).find(is_the_import);
                    let pos = stmt.map_or(0, |stmt| hir[stmt].start);
                    if !is_the_importer {
                    } else if self.shared.constants.own_paths.is_none() && self.is_in_the_bundle_only(file, specifier) {
                        self.problem(file, pos, "an import of a file that is neither code nor data the bundler can inline");
                    } else if self.shared.bundle.is_some() && stmt.is_some_and(|stmt| self.is_import_of_asset(file, stmt)) {
                        // The host is asked by the specifier alone.
                        self.problem(file, pos, "an import `with { type: .. }` of a file that is not in the bundle");
                    }
                    let (module, unproven) = if is_the_importer { self.unproven_builtin_imports(file, specifier) } else { (&b""[..], Vec::new()) };
                    // Once for the program: every module that imports it sees the same.
                    let global = self.external_module_global_in(importer, file, specifier);
                    let specifier = self.as_the_host_finds_it(file, specifier);
                    let specifier = self.str(specifier);
                    let known = self.emit(fx, Op::GlobalGet(global));
                    let undefined = self.emit(fx, Op::Undefined);
                    let is_missing = self.emit(fx, Op::StrictEq { a: known, b: undefined });
                    let (first, there) = (fx.b.new_block(), fx.b.new_block());
                    self.branch(fx, is_missing, first, there);
                    fx.b.seal(first);
                    fx.b.switch_to(first);
                    let namespace = self.emit_throwing(fx, Op::ExternalModule(specifier));
                    self.emit(fx, Op::GlobalSet(global, namespace));
                    fx.b.jump(there);
                    fx.b.seal(there);
                    fx.b.switch_to(there);
                    for (name, is_exported_again) in unproven {
                        let namespace = self.emit(fx, Op::GlobalGet(global));
                        let as_the_bundle_names_it = if self.shared.constants.own_paths.is_none() { module.strip_prefix(b"node:").unwrap_or(module) } else { module };
                        let message = match is_exported_again {
                            true => [&b"export '"[..], self.c.atoms().bytes(name), b"' not found in '", as_the_bundle_names_it, b"'"].concat(),
                            false => [&b"Export named '"[..], self.c.atoms().bytes(name), b"' not found in module '", module, b"'."].concat(),
                        };
                        let key = self.str(name);
                        let key = self.emit(fx, Op::Str(key));
                        let is_exported = self.emit_throwing(fx, Op::ElemHas { obj: namespace, key });
                        let is_exported = self.emit(fx, Op::Truthy(is_exported));
                        let (exported, missing) = (fx.b.new_block(), fx.b.new_block());
                        self.branch(fx, is_exported, exported, missing);
                        fx.b.seal(exported);
                        fx.b.seal(missing);
                        fx.b.switch_to(missing);
                        self.throw_error(fx, b"SyntaxError", &message);
                        fx.b.switch_to(exported);
                    }
                }
            }
        }
    }

    fn module_record_of(&mut self, file: FileId) -> GlobalId {
        let name = self.out.strs.intern(b"record");
        let record = self.add_global(name, file, Ty::NONE, GlobalKey::OfModule(file, "record"));
        self.out.globals[record.idx()].initialization = ir::Initialization::Undefined;
        record
    }

    fn emit_module_record(&mut self, fx: &mut Fx, file: FileId) -> V {
        let record = self.module_record_of(file);
        let known = self.emit(fx, Op::GlobalGet(record));
        let undefined = self.emit(fx, Op::Undefined);
        let is_missing = self.emit(fx, Op::StrictEq { a: known, b: undefined });
        let (first, there) = (fx.b.new_block(), fx.b.new_block());
        self.branch(fx, is_missing, first, there);
        fx.b.seal(first);
        fx.b.switch_to(first);
        let has_await = self.has_top_level_await(file);
        let has_await = self.emit(fx, Op::Bool(has_await));
        let driver = self.driver_of(file);
        let driver = self.emit(fx, Op::FuncRef(driver));
        let made = self.operation(fx, "NewModuleRecord", &[has_await, driver]);
        self.emit(fx, Op::GlobalSet(record, made));
        fx.b.jump(there);
        fx.b.seal(there);
        fx.b.switch_to(there);
        self.emit(fx, Op::GlobalGet(record))
    }

    fn emit_evaluate(&mut self, fx: &mut Fx, file: FileId, ticket: V) -> V {
        let record = self.emit_module_record(fx, file);
        let inner = self.inner_of(file);
        let inner = self.emit(fx, Op::FuncRef(inner));
        let ticket = if ticket.is_none() { self.emit(fx, Op::Undefined) } else { ticket };
        let promise = self.operation(fx, "EvaluateModule", &[record, inner, ticket]);
        let name = self.out.strs.intern(b"evaluation");
        let evaluation = self.add_global(name, file, Ty::NONE, GlobalKey::OfModule(file, "evaluation"));
        self.out.globals[evaluation.idx()].initialization = ir::Initialization::Undefined;
        self.emit(fx, Op::GlobalSet(evaluation, promise));
        promise
    }

    fn emit_inner_module_evaluation(&mut self, fx: &mut Fx, file: FileId) {
        let record = self.emit_module_record(fx, file);
        let enters = self.operation(fx, "EnterModule", &[record]);
        let (evaluate, done) = (fx.b.new_block(), fx.b.new_block());
        self.branch(fx, enters, evaluate, done);
        fx.b.seal(evaluate);
        fx.b.seal(done);
        fx.b.switch_to(done);
        self.terminate_with_return(fx, V::NONE);
        fx.b.switch_to(evaluate);
        self.emit_dependencies(fx, file);
        self.operation(fx, "LeaveModule", &[record]);
    }

    fn emit_module_driver(&mut self, fx: &mut Fx, file: FileId) {
        let body = self.body_of(file);
        if !self.has_top_level_await(file) {
            self.emit_throwing(fx, Op::CallDirect { func: body, args: ir::Args::new() });
            self.emit_evaluation_finished(fx, file, false);
            return;
        }
        let record = self.module_record_of(file);
        let rejected = fx.b.new_block();
        fx.handlers.push(rejected);
        let promise = self.emit_throwing(fx, Op::CallDirect { func: body, args: ir::Args::new() });
        let module = self.emit(fx, Op::GlobalGet(record));
        self.operation(fx, "DidStartModuleBody", &[module, promise]);
        self.emit_throwing(fx, Op::Await(promise));
        fx.handlers.pop();
        self.emit_evaluation_finished(fx, file, false);
        let module = self.emit(fx, Op::GlobalGet(record));
        self.operation(fx, "AsyncModuleExecutionFulfilled", &[module]);
        self.terminate_with_return(fx, V::NONE);
        fx.b.seal(rejected);
        fx.b.switch_to(rejected);
        let error = self.emit(fx, Op::Caught);
        self.emit_evaluation_finished(fx, file, true);
        let module = self.emit(fx, Op::GlobalGet(record));
        self.operation(fx, "AsyncModuleExecutionRejected", &[module, error]);
    }

    fn emit_dynamic_import(&mut self, fx: &mut Fx, file: FileId, is_node_mode: bool, ticket: V) {
        let undefined = self.emit(fx, Op::Undefined);
        self.emit_throwing(fx, Op::Await(undefined));
        let later_roots: Vec<FileId> = self.shared.entry_points().iter().filter(|roots| roots.first() == Some(&file)).flat_map(|roots| roots[1..].iter().rev().copied()).collect();
        for root in later_roots.into_iter().filter(|&root| root != file) {
            if !self.is_async_module(root) {
                continue;
            }
            let name = self.out.strs.intern(b"evaluation");
            let evaluation = self.add_global(name, root, Ty::NONE, GlobalKey::OfModule(root, "evaluation"));
            self.out.globals[evaluation.idx()].initialization = ir::Initialization::Undefined;
            let promise = self.emit(fx, Op::GlobalGet(evaluation));
            let undefined = self.emit(fx, Op::Undefined);
            let is_not_started = self.emit(fx, Op::StrictEq { a: promise, b: undefined });
            let (started, next) = (fx.b.new_block(), fx.b.new_block());
            self.branch(fx, is_not_started, next, started);
            fx.b.seal(started);
            fx.b.switch_to(started);
            self.emit_throwing(fx, Op::Await(promise));
            fx.b.jump(next);
            fx.b.seal(next);
            fx.b.switch_to(next);
        }
        if let Some(func) = self.evaluation_of(file) {
            if self.is_async_module(file) {
                let promise = self.emit_evaluate(fx, file, ticket);
                self.emit_throwing(fx, Op::Await(promise));
            } else {
                self.emit_throwing(fx, Op::CallDirect { func, args: ir::Args::new() });
            }
        }
        if self.waits_for_its_place(file) {
            let func = self.function_for_deferred_module(file, Source::ModuleTouch(file));
            self.emit_throwing(fx, Op::CallDirect { func, args: ir::Args::new() });
        }
        let namespace = if self.c.module_with_export_variables(file).is_some() {
            self.emit(fx, Op::NewObject)
        } else if self.exports_an_object(file) {
            self.namespace_of_exported_object_as(fx, is_node_mode, file)
        } else {
            self.read_sym(fx, self.files.file_symbol(file), 0)
        };
        self.terminate_with_return(fx, namespace);
    }

    fn emit_dynamic_import_with_ticket(&mut self, fx: &mut Fx, file: FileId, is_node_mode: bool) {
        let importing = self.variable_of_program("importing");
        let importer = self.emit(fx, Op::GlobalGet(importing));
        let undefined = self.emit(fx, Op::Undefined);
        self.emit(fx, Op::GlobalSet(importing, undefined));
        let ticket = self.operation(fx, "NewImportTicket", &[importer]);
        let func = self.dynamic_import_body_of(file, is_node_mode);
        let promise = self.emit_throwing(fx, Op::CallDirect { func, args: [ticket].into_iter().collect() });
        self.operation(fx, "SetImportPromise", &[ticket, promise]);
        self.terminate_with_return(fx, promise);
    }

    pub(crate) fn variable_of_program(&mut self, name: &'static str) -> GlobalId {
        let root = self.shared.roots()[0];
        let interned = self.out.strs.intern(name.as_bytes());
        let variable = self.add_global(interned, root, Ty::NONE, GlobalKey::OfModule(root, name));
        self.out.globals[variable.idx()].initialization = ir::Initialization::Undefined;
        variable
    }

    pub(crate) fn emit_importer(&mut self, fx: &mut Fx, imported: FileId, is_importing: bool) {
        if self.is_async_module(fx.file) && self.is_async_module(imported) {
            let importing = self.variable_of_program("importing");
            let record = self.module_record_of(fx.file);
            let record = self.emit(fx, if is_importing { Op::GlobalGet(record) } else { Op::Undefined });
            self.emit(fx, Op::GlobalSet(importing, record));
        }
    }

    pub(crate) fn is_part_of_the_host_around_the_body(&mut self, file: FileId) -> bool {
        self.is_commonjs(file) && self.has_export_variables(file) && !self.waits_for_its_place(file) && !self.is_second_form(file) && self.c.is_module_that_only_makes_values(file)
    }

    fn emit_statements(&mut self, fx: &mut Fx, file: FileId) {
        if self.is_commonjs(file) {
            self.emit_commonjs_prologue(fx, file);
        }
        if self.may_be_asked_by_the_host() && !self.is_builtin_file(file) && self.c.names_the_cache_by_its_other_name(file) {
            self.emit_note_that_the_cache_is_read(fx, file);
        }
        // The value of a JSON module is made when it is asked for.
        if self.hir(file).kind != FileKind::Json {
            let body = self.hir(file).body;
            self.enters_module_body = !self.is_async_module(file);
            self.block_body(fx, body);
        }
        if self.is_commonjs(file) && !self.is_part_of_the_host_around_the_body(file) {
            self.emit_commonjs_epilogue(fx, file);
        }
    }

    /// `await`, `for await` or `await using` outside of functions.
    fn has_top_level_await(&self, file: FileId) -> bool {
        let (hir, bound) = (self.hir(file), self.c.bound(file));
        let in_expressions = hir.exprs.iter().enumerate().any(|(i, e)| {
            matches!(e.kind, hir::ExprKind::Await(_)) && bound.expr_parent[i] != bun_sema::bind::Parent::None && self.c.enclosing_fn_of_expr(file, hir::ExprId(i as u32)).is_none()
        });
        let stmt_parent = &bound.stmt_parent;
        let in_statements = hir.stmts.iter().enumerate().any(|(i, stmt)| {
            let awaits = match stmt.kind {
                StmtKind::ForOf { is_await, .. } => is_await,
                StmtKind::Var(decls) => decls.iter().any(|d| hir[d].kind == hir::VarKind::AwaitUsing),
                _ => false,
            };
            awaits && stmt_parent[i] != bun_sema::bind::Parent::None && self.c.enclosing_fn(file, stmt_parent[i]).is_none()
        });
        in_expressions || in_statements
    }

    /// `Shared::async_modules`
    fn is_async_module(&self, file: FileId) -> bool {
        self.shared.async_modules.contains(&file)
    }

    /// `NONE`: the file is not compiled with the program.
    pub(crate) fn module_of(&mut self, file: FileId) -> ModuleId {
        if let Some(&known) = self.modules.get(&file) {
            return known;
        }
        if !self.shared.is_compiled(file) {
            return ModuleId::NONE;
        }
        let module = ModuleId::new(self.files_of_modules.len());
        self.files_of_modules.push(file);
        self.modules.insert(file, module);
        module
    }

    /// What the type is called in a fragment. The type outlives the task.
    pub(crate) fn keep(&mut self, ty: TypeId) -> Identity {
        self.c.keep_type(ty);
        self.c.identity_of_type(ty)
    }

    pub(crate) fn key_of_next_environment(&mut self) -> LayoutKey {
        self.environments += 1;
        LayoutKey::Environment(self.file, self.environments - 1)
    }

    pub(crate) fn key_of_next_hidden_variable(&mut self) -> GlobalKey {
        self.hidden_variables += 1;
        GlobalKey::Hidden(self.file, self.hidden_variables - 1)
    }

    /// Whether the function is built here. What is made from the code of a file is built with that file. What the compiler makes up for
    /// a declaration is built by whoever asks for it, and is the same whoever does.
    fn builds(&self, source: Source) -> bool {
        match source {
            Source::Module(file) | Source::ModuleBody(file) | Source::ModuleDriver(file) | Source::ModuleInner(file) | Source::ModuleTouch(file) | Source::ModuleSettling(file) | Source::Function { file, .. } | Source::DefaultConstructor { file, .. } => file == self.file,
            Source::Initializer(sym) => sym.file == self.file,
            Source::EnumObject(_) | Source::NamespaceObject(_) | Source::ModuleNamespaceReader(_) | Source::DynamicImport(..) | Source::Required(_) | Source::DynamicImportBody(..) | Source::MemberOfExportedObject(_) | Source::DefaultOfExportedObject(..) | Source::FilesByPath(_) | Source::EvaluationByNumber(_) | Source::ExportVariablesReader(_) | Source::NamespaceForHost(_) => true,
        }
    }

    pub(crate) fn add_header(&mut self, name: StrId, module: ModuleId, pos: u32, kind: FuncKind, source: Source) -> FuncId {
        let id = FuncId::new(self.out.funcs.len());
        let place_of_text = self.place_of_text(source);
        self.out.funcs.push(Func { name, module, pos, place_of_text, end_of_text: 0, kind, flags: 0, length: 0, captures: Vec::new(), this_declared: TyId::NONE, params: Vec::new(), annotated: Vec::new(), result: TyId::NONE, blocks: Vec::new(), values: Vec::new(), spans: Vec::new() });
        self.sources.push(source);
        self.bodies.push(None);
        id
    }

    fn place_of_text(&self, source: Source) -> u32 {
        if self.shared.constants.own_paths.is_none() && self.shared.constants.function_texts.is_none() {
            return 0;
        }
        if let Source::Function { file, .. } | Source::DefaultConstructor { file, .. } = source
            && bun_sema::direct_eval::text_without_note_of_insertions(&self.hir(file).text).ends_with(b"\n// bun --aot: this file is not UTF-8: read as the runtime reads it")
        {
            return 0;
        }
        let (file, place) = match source {
            Source::Function { file, func, class, .. } => {
                let f = &self.hir(file)[func];
                match (f.kind, class) {
                    (hir::FnKind::Constructor, Some((file, class))) => (file, self.hir(file)[class].body_pos),
                    (hir::FnKind::Constructor, None) => return 0,
                    (hir::FnKind::Arrow, _) => (file, f.start),
                    _ => (file, f.anchor),
                }
            }
            Source::DefaultConstructor { file, class } => (file, self.hir(file)[class].body_pos),
            _ => return 0,
        };
        bun_sema::direct_eval::position_in_source(&self.hir(file).text, place) + 1
    }

    /// A function without a body, which is built later if it is built here.
    pub(crate) fn add_func(&mut self, name: StrId, module: ModuleId, pos: u32, kind: FuncKind, source: Source) -> FuncId {
        let id = self.add_header(name, module, pos, kind, source);
        if self.builds(source) {
            self.work.push_back(id);
        }
        id
    }

    /// The function of the source, of which nothing need be known: closures of it are expected and nothing more. See `Function::func`.
    pub(crate) fn name_function(&mut self, file: FileId, func: FnId) -> FuncId {
        if let Some(&known) = self.funcs.get(&(file, func)).or_else(|| self.named_functions.get(&(file, func))) {
            return known;
        }
        let role = if self.is_written_in_second_body(file, func) { Role::Second } else { Role::Whole };
        let root_of_second_body = self.second_root.filter(|_| role == Role::Second).unwrap_or(FnId::NONE);
        let id = self.add_header(StrId::NONE, ModuleId::NONE, 0, FuncKind::Plain, Source::Function { file, func, class: None, role, root_of_second_body });
        let was = self.named_functions.insert((file, func), id);
        if let Some(undo) = &mut self.undo {
            undo.named_functions.push(((file, func), was));
        }
        id
    }

    fn take_func(&mut self, id: FuncId) -> Func {
        let func = &mut self.out.funcs[id.idx()];
        Func {
            name: func.name,
            module: func.module,
            pos: func.pos,
            place_of_text: func.place_of_text,
            end_of_text: func.end_of_text,
            kind: func.kind,
            flags: func.flags,
            length: func.length,
            captures: func.captures.clone(),
            this_declared: func.this_declared,
            params: func.params.clone(),
            annotated: func.annotated.clone(),
            result: func.result,
            blocks: Vec::new(),
            values: Vec::new(),
            spans: Vec::new(),
        }
    }

    /// Builds the functions that have been declared, and those that come up on the way. Those of a class wait for its declaration.
    fn build_functions(&mut self) {
        loop {
            while let Some(func) = self.work.pop_front() {
                match self.class_awaited_by(func) {
                    Some(class) => self.waiting_for_class.entry(class).or_default().push(func),
                    None => self.build_func(func),
                }
            }
            let Some(root) = self.second_work.pop_front() else { break };
            self.build_second_body(root);
        }
    }

    pub(crate) fn is_written_in_second_body(&self, file: FileId, func: FnId) -> bool {
        let Some(root) = self.second_root else { return false };
        let hir = self.hir(self.file);
        file == self.file && func != root && hir[root].start <= hir[func].start && hir[func].start < self.c.end_of_fn(file, root)
    }

    fn build_second_body(&mut self, id: FuncId) {
        let Source::Function { file, func: root, class, .. } = self.sources[id.idx()] else { return };
        let hir = self.hir(file);
        let (start, end) = (hir[root].start, self.c.end_of_fn(file, root));
        let is_within = |pos: u32| start <= pos && pos < end;
        let is_of_nest = |activation: &Activation| match *activation {
            Activation::Call(func) | Activation::Expression(func) => is_within(hir[func].start),
            Activation::Iteration(stmt) | Activation::Block(stmt) => is_within(hir[stmt].start),
            Activation::Class(class) => is_within(hir[class].start),
            Activation::Partition(_) => false,
        };
        let is_inner = |key: &(FileId, FnId)| key.0 == file && key.1 != root && is_within(hir[key.1].start);
        let mut undo = Box::<Undo>::default();
        for key in self.funcs.keys().copied().filter(is_inner).collect::<Vec<_>>() {
            undo.funcs.push((key, self.funcs.remove(&key)));
        }
        for key in self.named_functions.keys().copied().filter(is_inner).collect::<Vec<_>>() {
            undo.named_functions.push((key, self.named_functions.remove(&key)));
        }
        for key in self.activation_layouts.keys().copied().collect::<Vec<_>>() {
            if is_of_nest(&self.c.activation_of_environment(file, key)) {
                undo.activation_layouts.push((key, self.activation_layouts.remove(&key)));
            }
        }
        for key in self.this_bindings.keys().copied().filter(|&func| is_within(hir[func].start)).collect::<Vec<_>>() {
            undo.this_bindings.push((key, self.this_bindings.remove(&key)));
        }
        self.second_root = Some(root);
        if class.is_some() || matches!(hir[root].kind, hir::FnKind::Method | hir::FnKind::Setter) {
            undo.funcs.push(((file, root), self.funcs.insert((file, root), id)));
        }
        self.undo = Some(undo);
        self.work.push_back(id);
        while let Some(func) = self.work.pop_front() {
            match self.class_awaited_by(func) {
                Some(class) => self.waiting_for_class.entry(class).or_default().push(func),
                None => self.build_func(func),
            }
        }
        self.second_root = None;
        let undo = *self.undo.take().unwrap_or_default();
        for (key, _) in undo.funcs.iter().filter(|noted| is_inner(&noted.0)) {
            self.funcs.remove(key);
        }
        for (key, _) in undo.named_functions.iter().filter(|noted| is_inner(&noted.0)) {
            self.named_functions.remove(key);
        }
        put_back(&mut self.funcs, undo.funcs);
        put_back(&mut self.named_functions, undo.named_functions);
        put_back(&mut self.activation_layouts, undo.activation_layouts);
        put_back(&mut self.this_bindings, undo.this_bindings);
        put_back(&mut self.places, undo.places);
        put_back(&mut self.parameter_places, undo.parameter_places);
    }

    /// Every class that the file declares is defined by its fragment, also one that is declared in code that the build leaves out: a type
    /// in another file may mention it. The functions of such a class stay without a body.
    fn define_classes_of_file(&mut self) {
        let (hir, bound) = (self.hir(self.file), self.c.bound(self.file));
        for class in (0..hir.classes.len() as u32).map(ClassId) {
            // The parser can leave a node that nothing refers to, which has no symbol.
            if !hir[class].flags.contains(hir::Flags::AMBIENT) && bound.class_symbol[class.idx()].is_some() {
                let info = self.define_class(self.file, class);
                self.type_fields_of(info.layout);
            }
        }
    }

    /// A class of another file that has been looked into is defined in full, so that the link can compare it with what its file says.
    /// What a class extends has the smaller number, and is looked into with it.
    fn define_classes_looked_into(&mut self) {
        let mut classes: Vec<(LayoutId, (FileId, ClassId))> = self.classes.iter().map(|(&class, info)| (info.layout, class)).collect();
        classes.sort_unstable_by(|a, b| b.0.cmp(&a.0));
        for (layout, (file, class)) in classes {
            let info = self.classes[&(file, class)];
            if info.ctor.is_some() || info.facts.is_laid_out && self.has_typed_fields(layout) {
                self.define_class(file, class);
                self.type_fields_of(layout);
            }
        }
    }

    /// What the checker has noted since this was last asked for.
    fn take_notes(&mut self) -> Notes {
        let c = &mut *self.c;
        c.take_noted().renamed(|ty| {
            c.keep_type(ty);
            Some(c.identity_of_type(ty))
        })
    }

    fn finish(mut self) -> Box<Fragment> {
        self.define_classes_looked_into();
        let file = self.file;
        let (mut path, mut altered_globals, mut stores_to_methods) = (StrId::NONE, Vec::new(), Vec::new());
        let mut prototype_property_names = Vec::new();
        let mut regexp_literals = Vec::new();
        if file != NO_FILE {
            let hir = self.hir(file);
            for literal in hir.exprs.iter().filter(|e| matches!(e.kind, hir::ExprKind::Regex)) {
                let text: &[u8] = &hir.text[literal.pos as usize..literal.end as usize];
                let close = bun_core::strings::last_index_of_char(text, b'/').unwrap_or(0);
                regexp_literals.push((self.out.strs.intern(&text[1.min(close)..close]), self.out.strs.intern(&text[close + 1..])));
            }
            path = self.out.strs.intern(self.files.module(file).file_name());
            let mut altered = Vec::new();
            self.c.globals_altered_in(file, &mut altered);
            altered_globals = altered.into_iter().map(|name| self.str(name)).collect();
            let mut names = Vec::new();
            self.c.prototype_property_names_in(file, &mut names);
            prototype_property_names = names.into_iter().map(|name| self.str(name)).collect();
            let stores = self.c.stores_to_methods_in(file);
            stores_to_methods = stores.into_iter().filter_map(|store| store.renamed(|ty| Some(self.keep(ty)))).collect();
            for (by, flow) in self.c.number_flows_in(file) {
                let func = match by {
                    RunBy::Module => self.module_bodies.get(&file).or_else(|| self.evaluations.get(&file)).copied(),
                    RunBy::Function(func) => self.funcs.get(&(file, func)).map(|id| self.typed_bodies.get(id).unwrap_or(id)).copied(),
                    RunBy::ConstructorOf(class) => self.classes.get(&(file, class)).map(|info| info.ctor),
                };
                // A function in code that is cut is not translated, and what is cut of a body does not run.
                let Some(func) = func.filter(|func| func.is_some()) else { continue };
                let flow = flow.renamed(|name| self.str(name));
                if let Some(body) = &mut self.bodies[func.idx()]
                    && !body.cut.iter().any(|&(start, end)| start <= flow.pos && flow.pos < end)
                {
                    body.number_flows.push(flow);
                }
            }
        }
        if file != NO_FILE {
            self.c.note_escapes_in(file);
        }
        // What has come up outside of any function goes with the evaluation of the module.
        let (notes, mut problems) = (self.take_notes(), std::mem::take(&mut self.problems));
        if let Some(&evaluation) = self.evaluations.get(&file)
            && let Some(body) = &mut self.bodies[evaluation.idx()]
        {
            body.notes.append_taken(notes);
            body.problems.append(&mut problems);
        }
        if file != NO_FILE {
            for (by, mut expressions) in self.c.code_whose_escapes_are_noted(file) {
                let func = match by {
                    RunBy::Module => self.evaluations.get(&file).copied(),
                    RunBy::Function(func) => self.funcs.get(&(file, func)).map(|id| self.typed_bodies.get(id).unwrap_or(id)).copied(),
                    RunBy::ConstructorOf(class) => self.classes.get(&(file, class)).map(|info| info.ctor),
                };
                let Some(func) = func.filter(|func| func.is_some()) else { continue };
                let Some(body) = &self.bodies[func.idx()] else { continue };
                let hir = self.hir(file);
                expressions.retain(|&e| !body.cut.iter().any(|&(start, end)| start <= hir[e].pos && hir[e].pos < end));
                self.c.note_escapes_of(file, &expressions);
                let notes = self.take_notes();
                if let Some(body) = &mut self.bodies[func.idx()] {
                    body.notes.append_taken(notes);
                }
            }
        }
        for i in 0..self.out.funcs.len() {
            if self.bodies[i].is_none() {
                continue;
            }
            match self.typed_bodies.get(&FuncId::new(i)).copied() {
                Some(typed) => self.note_casts_of_arguments(typed, self.second_bodies.contains_key(&FuncId::new(i))),
                None => self.note_casts_of_arguments(FuncId::new(i), false),
            }
            let notes = self.take_notes();
            if let Some(body) = &mut self.bodies[i] {
                body.notes_if_called_unknown = notes;
            }
        }
        // By layout. `None`: the layout is only named.
        let mut notes_of_layouts: Vec<Option<Option<Box<Notes>>>> = Vec::with_capacity(self.out.layouts.len());
        let mut identities: Vec<Option<Identity>> = Vec::with_capacity(self.out.layouts.len());
        for layout in (0..self.out.layouts.len()).map(LayoutId::new) {
            let is_defined = match self.layout_keys[layout.idx()] {
                LayoutKey::Record(_) => self.has_typed_fields(layout),
                LayoutKey::Instance(file, class) => self.classes[&(file, class)].ctor.is_some(),
                LayoutKey::ClassEnvironment(..) | LayoutKey::Environment(..) => true,
            };
            notes_of_layouts.push(is_defined.then(|| {
                let is_held = self.note_casts_of_fields(layout);
                is_held.then(|| Box::new(self.take_notes()))
            }));
            let ty = self.layout_types.get(&layout).copied();
            identities.push(ty.map(|ty| self.keep(ty)));
        }

        let of_file = self.shared.builtin_functions.list.iter().filter(|function| function.file == file);
        let builtin_functions = of_file.filter_map(|function| Some((function.id?, FuncKey::Function(file, function.func), function.visibility))).collect();
        let inserted_ahead = if file != NO_FILE && self.is_second_form(file) { crate::LENGTH_AHEAD_OF_SECOND_FORM } else { 0 };
        let FileBuild { out, sources, layout_keys, global_keys, bodies, mut problems_of_layouts, constructs, files_of_modules, named_functions, named_default_constructors, parts_of_views, .. } = self;
        let only_named: FxHashSet<FuncId> = named_functions.into_values().chain(named_default_constructors.into_values()).collect();
        let mut mentioning = Mentioning::default();
        let funcs = (out.funcs.into_iter().zip(sources).zip(bodies).enumerate())
            .map(|(i, ((mut func, source), mut body))| {
                if inserted_ahead != 0 && func.module.is_some() && files_of_modules[func.module.idx()] == file {
                    func.pos = func.pos.saturating_sub(inserted_ahead);
                    for value in &mut func.values {
                        value.pos = value.pos.saturating_sub(inserted_ahead);
                    }
                    for block in &mut func.blocks {
                        if let Some(Term::Throw { pos, .. }) = &mut block.term {
                            *pos = pos.saturating_sub(inserted_ahead);
                        }
                    }
                }
                if let Some(body) = &mut body {
                    body.mentions = match body.parts.is_empty() {
                        true => mentioning.of_func(&mut func),
                        false => parts::mentions_apart(&mut mentioning, &mut func, &mut body.parts),
                    };
                    for &param in func.params.iter().filter(|param| param.is_some()) {
                        for part in &out.tys.get(param).parts {
                            let &crate::declared::Part::Class(view) = part else { continue };
                            for &of_union in parts_of_views.get(&view).into_iter().flatten() {
                                body.mentions.add_layout(of_union);
                            }
                        }
                    }
                }
                Function { key: source.key(), func: (!only_named.contains(&FuncId::new(i))).then_some(func), body }
            })
            .collect();
        let layouts = (out.layouts.into_iter().zip(layout_keys).zip(identities).zip(notes_of_layouts).enumerate())
            .map(|(i, (((mut layout, key), ty), notes))| {
                let (id, name) = (LayoutId::new(i), layout.name);
                let definition = notes.map(|notes| {
                    Box::new(Definition {
                        mentions: mentioning.of_layout(&mut layout),
                        layout,
                        constructs: constructs.get(&id).copied().unwrap_or(LayoutId::NONE),
                        notes,
                        problems: problems_of_layouts.remove(&id).unwrap_or_default(),
                    })
                });
                Shape { key, name, ty, definition }
            })
            .collect();
        let globals = out.globals.into_iter().zip(global_keys).map(|(global, key)| Variable { key, global }).collect();
        Box::new(Fragment { file, path, strs: out.strs, tys: out.tys, modules: files_of_modules, globals, layouts, funcs, altered_globals, prototype_property_names, regexp_literals, stores_to_methods, builtin_functions, times_translated: 1, program_ids: Default::default(), summary: Default::default(), outline: Default::default() })
    }

    fn build_func(&mut self, id: FuncId) {
        let source = self.sources[id.idx()];
        let (file, func, class) = match source {
            Source::Module(file) | Source::ModuleTouch(file) | Source::ModuleSettling(file) => (file, FnId::NONE, None),
            Source::Function { file, func, class, .. } => (file, func, class),
            Source::DefaultConstructor { file, class } => (file, FnId::NONE, Some((file, class))),
            Source::EnumObject(sym) | Source::NamespaceObject(sym) | Source::Initializer(sym) => (sym.file, FnId::NONE, None),
            Source::DynamicImport(file, _) | Source::Required(file) | Source::DynamicImportBody(file, _) | Source::ModuleBody(file) | Source::ModuleDriver(file) | Source::ModuleInner(file) | Source::ModuleNamespaceReader(file) | Source::MemberOfExportedObject(file) | Source::DefaultOfExportedObject(file, _) | Source::FilesByPath(file) | Source::EvaluationByNumber(file) | Source::ExportVariablesReader(file) | Source::NamespaceForHost(file) => (file, FnId::NONE, None),
        };
        let role = match source {
            Source::Function { role, .. } => role,
            _ => Role::Whole,
        };
        self.c.translate_second_body(self.second_root.filter(|_| role == Role::Second).map(|root| (file, root)));
        let is_arrow = func.is_some() && self.hir(file)[func].kind == hir::FnKind::Arrow;
        let seen = if is_arrow { self.c.receiver_of_arrow(file, func) } else { Receiver::None };
        let mut fx = Fx {
            b: FuncBuilder::new(self.take_func(id), self.known.undefined),
            id,
            file,
            func,
            locals: FxHashMap::default(),
            initialized: FxHashMap::default(),
            found_initialized: FxHashMap::default(),
            initialized_before_loops: Vec::new(),
            modules_asked_for_before_loops: Vec::new(),
            true_value: V::NONE,
            false_value: V::NONE,
            envs: Vec::new(),
            this: V::NONE,
            // An arrow function sees the `this` of the code around it, which it has a copy of.
            this_type: match seen {
                Receiver::Function(_) | Receiver::Instance(_) => self.ty_of_receiver(seen),
                Receiver::None | Receiver::Static(_) => fit::Ty {
                    id: self.out.funcs[id.idx()].this_declared,
                    checked: self.signatures.get(&id).and_then(|signature| signature.this).unwrap_or(TypeId::UNRESOLVED),
                },
            },
            class,
            jumps: Vec::new(),
            handlers: Vec::new(),
            label: Atom::NONE,
            this_var: None,
            this_binding: None,
            this_class: match seen {
                Receiver::Static(class) => Some((file, class)),
                _ => None,
            },
            receivers: FxHashMap::default(),
            captured_arguments: FxHashMap::default(),
            captured_new_targets: FxHashMap::default(),
            home_objects: FxHashMap::default(),
            given: V::NONE,
            new_target: V::NONE,
            is_in_field_initializer: false,
            returns_this: false,
            is_static: match seen {
                Receiver::Static(_) => true,
                Receiver::Instance(_) => false,
                Receiver::None | Receiver::Function(_) => self.is_in_static_member(file, func),
            },
            constructor_params: Vec::new(),
            disposable_stack: V::NONE,
            arguments: V::NONE,
            all_arguments: V::NONE,
            is_typed: !self.is_untyped_file(file) && matches!(role, Role::Whole | Role::Typed),
            checked: CheckedTypes::default(),
            checked_vars: FxHashMap::default(),
            fitted: FxHashMap::default(),
            nullish_left_by_cast: FxHashSet::default(),
            is_coercing_fresh_graph: false,
            handed_back: FxHashSet::default(),
            calls_in_tail_position: Vec::new(),
            not_closed_if: FxHashMap::default(),
            stays_ordinary: FxHashMap::default(),
            narrowed: FxHashMap::default(),
            sink: None,
            expected: FxHashMap::default(),
            first_stores: Vec::new(),
            is_clearing: false,
            first_spans: FxHashMap::default(),
            last_spans: FxHashMap::default(),
            operand_spans: Vec::new(),
        };
        // What comes before its first statement.
        fx.b.pos = fx.b.func.pos;
        // `function Point(this: Point, x: number) { .. }`: whoever constructs with it, knowing it or not, gets an object of that type.
        if func.is_some() && matches!(self.hir(file)[func].kind, hir::FnKind::Decl | hir::FnKind::Expr) && self.hir(file)[func].this_param.is_some() {
            let this = self.or_anything(fx.this_type.id);
            if let Some(layout) = self.out.tys.get(this).only_layout()
                && self.out.layouts[layout.idx()].kind == ir::LayoutKind::Record
            {
                self.note_allocation(layout);
                fx.first_stores = self.c.first_stores_of(file, func);
            }
            let views = self.types_of_layouts_in(this);
            // Of several types: nobody can say which of them `new` makes. Whoever constructs with it and does not say what it makes hands it an ordinary object, which stays what it is.
            if views.len() > 1 {
                self.c.note_place(file, fx.b.pos);
                for &view in &views {
                    self.c.note_foreign(view, TypeId::OBJECT);
                }
            }
            self.c.note_constructor_function(&views, file, func, &fx.first_stores);
        }
        match source {
            Source::Module(file) if self.builtin_id(file).is_some() => self.emit_builtin_module(&mut fx, file),
            Source::Module(file) if self.is_async_module(file) => {
                if self.may_be_asked_by_the_host() && self.shared.entry_points().iter().any(|files| files.first() == Some(&file)) {
                    self.files_by_path(file);
                }
                self.emit_evaluate(&mut fx, file, V::NONE);
            }
            Source::ModuleInner(file) => self.emit_inner_module_evaluation(&mut fx, file),
            Source::Module(file) => {
                if self.may_be_asked_by_the_host() && self.shared.entry_points().iter().any(|files| files.first() == Some(&file)) {
                    self.files_by_path(file);
                }
                // Evaluated once, after its dependencies, by whichever importer comes first.
                let name = self.out.strs.intern(b"evaluated");
                let flag = self.add_global(name, file, Ty::NONE, GlobalKey::OfModule(file, "evaluated"));
                self.out.globals[flag.idx()].initialization = ir::Initialization::Undefined;
                let known = self.emit(&mut fx, Op::GlobalGet(flag));
                let undefined = self.emit(&mut fx, Op::Undefined);
                let is_first = self.emit(&mut fx, Op::StrictEq { a: known, b: undefined });
                let (evaluate, done) = (fx.b.new_block(), fx.b.new_block());
                self.branch(&mut fx, is_first, evaluate, done);
                fx.b.seal(evaluate);
                fx.b.seal(done);
                let name = self.out.strs.intern(b"evaluation");
                let evaluation = self.add_global(name, file, Ty::NONE, GlobalKey::OfModule(file, "evaluation"));
                self.out.globals[evaluation.idx()].initialization = ir::Initialization::Undefined;
                fx.b.switch_to(done);
                // `false`: evaluation threw, and `evaluation` holds the value.
                let no = self.emit(&mut fx, Op::Bool(false));
                let has_thrown = self.emit(&mut fx, Op::StrictEq { a: known, b: no });
                let (thrown, evaluated) = (fx.b.new_block(), fx.b.new_block());
                self.branch(&mut fx, has_thrown, thrown, evaluated);
                fx.b.seal(thrown);
                fx.b.seal(evaluated);
                fx.b.switch_to(thrown);
                let error = self.emit(&mut fx, Op::GlobalGet(evaluation));
                fx.b.terminate(Term::Throw { value: error, unwind: None, pos: 0 });
                fx.b.switch_to(evaluated);
                self.terminate_with_return(&mut fx, V::NONE);
                fx.b.switch_to(evaluate);
                let yes = self.emit(&mut fx, Op::Bool(true));
                self.emit(&mut fx, Op::GlobalSet(flag, yes));
                let body = if self.waits_for_its_place(file) { self.function_for_deferred_module(file, Source::ModuleSettling(file)) } else { self.body_of(file) };
                // The handler watches calls, and the code of the module is under none: under a handler a block ends at whatever may throw.
                let throwing = fx.b.new_block();
                fx.handlers.push(throwing);
                self.emit_dependencies(&mut fx, file);
                let holds_the_part_of_the_host = self.is_part_of_the_host_around_the_body(file);
                if holds_the_part_of_the_host {
                    self.emit_host_module(&mut fx, file);
                }
                self.emit_throwing(&mut fx, Op::CallDirect { func: body, args: ir::Args::new() });
                if holds_the_part_of_the_host {
                    self.emit_commonjs_epilogue(&mut fx, file);
                }
                fx.handlers.pop();
                self.emit_evaluation_finished(&mut fx, file, false);
                self.terminate_with_return(&mut fx, V::NONE);
                fx.b.seal(throwing);
                fx.b.switch_to(throwing);
                let error = self.emit(&mut fx, Op::Caught);
                self.emit_evaluation_finished(&mut fx, file, true);
                let path = self.files.module(file).file_name();
                let is_wrapped_by_a_bundle = self.shared.constants.own_paths.is_none() && (self.is_commonjs(file) || path.ends_with(b".cjs") || path.ends_with(b".cts")) && !self.c.is_evaluated_again_after_a_failure(file);
                if is_wrapped_by_a_bundle {
                    self.emit_exports_of_a_body_that_never_began(&mut fx, file);
                } else {
                    let no = self.emit(&mut fx, Op::Bool(false));
                    self.emit(&mut fx, Op::GlobalSet(flag, no));
                    self.emit(&mut fx, Op::GlobalSet(evaluation, error));
                }
                fx.b.terminate(Term::Throw { value: error, unwind: None, pos: 0 });
            }
            Source::ModuleTouch(file) => {
                let (ran, thrown) = self.state_of_deferred_module(file);
                let known = self.emit(&mut fx, Op::GlobalGet(ran));
                let yes = self.emit(&mut fx, Op::Bool(true));
                let has_run = self.emit(&mut fx, Op::StrictEq { a: known, b: yes });
                let (done, other) = (fx.b.new_block(), fx.b.new_block());
                self.branch(&mut fx, has_run, done, other);
                fx.b.seal(done);
                fx.b.seal(other);
                fx.b.switch_to(done);
                self.terminate_with_return(&mut fx, V::NONE);
                fx.b.switch_to(other);
                let null = self.emit(&mut fx, Op::Null);
                let is_due = self.emit(&mut fx, Op::StrictEq { a: known, b: null });
                let (evaluate, waits) = (fx.b.new_block(), fx.b.new_block());
                self.branch(&mut fx, is_due, evaluate, waits);
                fx.b.seal(evaluate);
                fx.b.seal(waits);
                fx.b.switch_to(waits);
                let no = self.emit(&mut fx, Op::Bool(false));
                let has_thrown = self.emit(&mut fx, Op::StrictEq { a: known, b: no });
                let (rethrows, early) = (fx.b.new_block(), fx.b.new_block());
                self.branch(&mut fx, has_thrown, rethrows, early);
                fx.b.seal(rethrows);
                fx.b.seal(early);
                fx.b.switch_to(rethrows);
                let error = self.emit(&mut fx, Op::GlobalGet(thrown));
                fx.b.terminate(Term::Throw { value: error, unwind: None, pos: 0 });
                fx.b.switch_to(early);
                let wanted = self.emit(&mut fx, Op::Int(0));
                self.emit(&mut fx, Op::GlobalSet(ran, wanted));
                self.terminate_with_return(&mut fx, V::NONE);
                fx.b.switch_to(evaluate);
                self.emit(&mut fx, Op::GlobalSet(ran, yes));
                let body = self.body_of(file);
                let throwing = fx.b.new_block();
                fx.handlers.push(throwing);
                self.emit_throwing(&mut fx, Op::CallDirect { func: body, args: ir::Args::new() });
                fx.handlers.pop();
                self.terminate_with_return(&mut fx, V::NONE);
                fx.b.seal(throwing);
                fx.b.switch_to(throwing);
                let error = self.emit(&mut fx, Op::Caught);
                let no = self.emit(&mut fx, Op::Bool(false));
                self.emit(&mut fx, Op::GlobalSet(ran, no));
                self.emit(&mut fx, Op::GlobalSet(thrown, error));
                fx.b.terminate(Term::Throw { value: error, unwind: None, pos: 0 });
            }
            Source::ModuleSettling(file) => {
                let (ran, _) = self.state_of_deferred_module(file);
                let known = self.emit(&mut fx, Op::GlobalGet(ran));
                let null = self.emit(&mut fx, Op::Null);
                self.emit(&mut fx, Op::GlobalSet(ran, null));
                let wanted = self.emit(&mut fx, Op::Int(0));
                let is_wanted = self.emit(&mut fx, Op::StrictEq { a: known, b: wanted });
                let (now, later) = (fx.b.new_block(), fx.b.new_block());
                self.branch(&mut fx, is_wanted, now, later);
                fx.b.seal(now);
                fx.b.seal(later);
                fx.b.switch_to(now);
                let touch = self.function_for_deferred_module(file, Source::ModuleTouch(file));
                self.emit_throwing(&mut fx, Op::CallDirect { func: touch, args: ir::Args::new() });
                self.terminate_with_return(&mut fx, V::NONE);
                fx.b.switch_to(later);
                self.terminate_with_return(&mut fx, V::NONE);
            }
            Source::ModuleBody(file) => self.emit_statements(&mut fx, file),
            Source::Required(file) => {
                let name = self.out.strs.intern(b"evaluated");
                let flag = self.add_global(name, file, Ty::NONE, GlobalKey::OfModule(file, "evaluated"));
                self.out.globals[flag.idx()].initialization = ir::Initialization::Undefined;
                let known = self.emit(&mut fx, Op::GlobalGet(flag));
                let yes = self.emit(&mut fx, Op::Bool(true));
                let is_done = self.emit(&mut fx, Op::StrictEq { a: known, b: yes });
                let (done, due) = (fx.b.new_block(), fx.b.new_block());
                self.branch(&mut fx, is_done, done, due);
                fx.b.seal(done);
                fx.b.seal(due);
                fx.b.switch_to(done);
                self.terminate_with_return(&mut fx, V::NONE);
                fx.b.switch_to(due);
                let undefined = self.emit(&mut fx, Op::Undefined);
                let is_first = self.emit(&mut fx, Op::StrictEq { a: known, b: undefined });
                let (first, kept) = (fx.b.new_block(), fx.b.new_block());
                self.branch(&mut fx, is_first, first, kept);
                fx.b.seal(first);
                fx.b.seal(kept);
                let evaluation = self.evaluation_of(file);
                fx.b.switch_to(kept);
                if let Some(func) = evaluation {
                    self.emit_throwing(&mut fx, Op::CallDirect { func, args: ir::Args::new() });
                }
                self.terminate_with_return(&mut fx, V::NONE);
                fx.b.switch_to(first);
                let throwing = fx.b.new_block();
                fx.handlers.push(throwing);
                if let Some(func) = evaluation {
                    self.emit_throwing(&mut fx, Op::CallDirect { func, args: ir::Args::new() });
                }
                fx.handlers.pop();
                self.terminate_with_return(&mut fx, V::NONE);
                fx.b.seal(throwing);
                fx.b.switch_to(throwing);
                let error = self.emit(&mut fx, Op::Caught);
                if self.second_form_of(file).is_some() {
                    self.emit_removal_from_the_cache_of_modules(&mut fx, file);
                } else if self.shared.constants.own_paths.is_some() || self.c.is_evaluated_again_after_a_failure(file) {
                    let undefined = self.emit(&mut fx, Op::Undefined);
                    self.emit(&mut fx, Op::GlobalSet(flag, undefined));
                }
                fx.b.terminate(Term::Throw { value: error, unwind: None, pos: 0 });
            }
            Source::ModuleDriver(file) => self.emit_module_driver(&mut fx, file),
            Source::DynamicImport(file, is_node_mode) if self.is_async_module(file) => self.emit_dynamic_import_with_ticket(&mut fx, file, is_node_mode),
            Source::DynamicImport(file, is_node_mode) => self.emit_dynamic_import(&mut fx, file, is_node_mode, V::NONE),
            Source::DynamicImportBody(file, is_node_mode) => {
                let ticket = self.add_entry_param(&mut fx, Ty::NONE);
                self.emit_dynamic_import(&mut fx, file, is_node_mode, ticket);
            }
            Source::Function { role: Role::Entry | Role::Beside, .. } => self.emit_entry_of_two_bodies(&mut fx),
            Source::Function { .. } if self.out.funcs[id.idx()].kind == FuncKind::Constructor => self.emit_constructor(&mut fx),
            Source::Function { .. } => self.function_body(&mut fx),
            Source::DefaultConstructor { .. } => self.emit_constructor(&mut fx),
            Source::EnumObject(sym) => self.emit_enum_object_getter(&mut fx, sym),
            Source::Initializer(sym) => self.emit_initializer(&mut fx, sym),
            Source::NamespaceObject(sym) => self.emit_namespace_object_getter(&mut fx, sym),
            Source::ModuleNamespaceReader(file) => self.emit_module_namespace_reader(&mut fx, file),
            Source::MemberOfExportedObject(file) => self.emit_member_of_exported_object(&mut fx, file),
            Source::DefaultOfExportedObject(file, is_node_mode) => self.emit_default_of_exported_object(&mut fx, file, is_node_mode),
            Source::FilesByPath(file) => self.emit_files_by_path(&mut fx, file),
            Source::EvaluationByNumber(_) => self.emit_evaluation_by_number(&mut fx),
            Source::ExportVariablesReader(file) => self.emit_export_variables_reader(&mut fx, file),
            Source::NamespaceForHost(file) => self.emit_namespace_for_host(&mut fx, file),
        }
        self.terminate_with_return(&mut fx, V::NONE);
        let flags = self.out.funcs[id.idx()].flags
            | if fx.is_typed { ir::func_flags::IS_TYPED } else { 0 }
            | if self.shared.is_prelude(fx.file) { ir::func_flags::IS_BUILTIN } else { 0 }
            | if self.is_builtin_file(fx.file) { ir::func_flags::IS_OF_BUILTIN_MODULE } else { 0 };
        let noted = std::mem::take(&mut fx.first_spans);
        let mut of_operands = std::mem::take(&mut fx.operand_spans);
        let mut built = fx.b.finish();
        if !noted.is_empty() {
            built.spans = crate::audit::settle(&built, &noted);
            built.spans.append(&mut of_operands);
        }
        if role == Role::Second {
            built.values.iter_mut().for_each(|value| value.set_prediction(ir::Prediction::None));
        }
        built.flags |= flags;
        self.out.funcs[id.idx()] = built;
        let class = match source {
            Source::Function { class, .. } => class,
            Source::DefaultConstructor { file, class } => Some((file, class)),
            _ => None,
        };
        let spans = match source {
            Source::Function { file, func, class, .. } => {
                let is_constructor = self.out.funcs[id.idx()].kind == FuncKind::Constructor;
                let mut spans = class.filter(|_| is_constructor).map_or_else(Vec::new, |(file, class)| self.spans_of_instance_fields(file, class));
                spans.push((self.hir(file)[func].start, self.c.end_of_fn(file, func)));
                spans
            }
            Source::DefaultConstructor { file, class } => self.spans_of_instance_fields(file, class),
            // What a constant cuts out of the initializer is noted with this function, not with the body of the module.
            Source::Initializer(sym) => match self.c.declaration_of_lazy_variable(sym) {
                Some((file, d)) => {
                    let initializer = &self.hir(file)[self.hir(file)[d].init];
                    vec![(initializer.pos, initializer.end)]
                }
                None => Vec::new(),
            },
            _ => Vec::new(),
        };
        match source {
            Source::Function { file, func, role: Role::Whole | Role::Typed, .. } => self.c.note_creations_in(file, func),
            Source::Module(file) if self.builtin_id(file).is_some() => self.c.note_creations_in(file, FnId::NONE),
            Source::ModuleBody(file) => self.c.note_creations_in(file, FnId::NONE),
            _ => {}
        }
        if let Some((file, class)) = class.filter(|_| self.out.funcs[id.idx()].kind == FuncKind::Constructor) {
            self.c.note_construction_of(file, class);
        }
        let mut cut = std::mem::take(&mut self.cut);
        cut.sort_unstable();
        cut.dedup();
        let marks = std::mem::take(&mut self.marks);
        let body = Body {
            parts: self.parts_of(&self.out.funcs[id.idx()], marks),
            spans,
            cut,
            dropped: std::mem::take(&mut self.dropped),
            class: class.and_then(|class| self.classes.get(&class)).map_or(LayoutId::NONE, |class| class.layout),
            declares: std::mem::take(&mut self.declares),
            classes_as_values: std::mem::take(&mut self.classes_as_values),
            stored_besides: std::mem::take(&mut self.stored_besides),
            number_flows: Vec::new(),
            notes: self.take_notes(),
            notes_if_called_unknown: Notes::default(),
            problems: std::mem::take(&mut self.problems),
            mentions: Mentions::default(),
        };
        self.bodies[id.idx()] = Some(Box::new(body));
        self.c.translate_second_body(None);
    }

    /// The variables of a file that another function than the one that declares them refers to, or another file.
    pub(crate) fn captured(&mut self, file: FileId) -> Rc<FxHashSet<Sym>> {
        if let Some(known) = self.captured.get(&file) {
            return known.clone();
        }
        let hir = self.hir(file);
        let bound = self.c.bound(file);
        let mut captured = FxHashSet::default();
        let mut function_values = FxHashSet::default();
        for (i, e) in hir.exprs.iter().enumerate() {
            let hir::ExprKind::Ident(name) = e.kind else { continue };
            let e = hir::ExprId(i as u32);
            // The operand of a `typeof` in a type is not evaluated.
            if matches!(bound.expr_parent[e.idx()], bun_sema::bind::Parent::None) || bound.is_in_type_query(e) {
                continue;
            }
            let Some(sym) = self.c.binding_of_identifier(file, e, name) else { continue };
            let sym = self.value_symbol(sym);
            if sym.file != file {
                continue;
            }
            if self.files.flags(sym).contains(bun_sema::bind::SymFlags::FUNCTION) {
                let is_callee = matches!(bound.expr_parent[e.idx()], bun_sema::bind::Parent::Expr(parent)
                    if matches!(hir[parent].kind, hir::ExprKind::Call(call) if hir[call].callee == e));
                if !is_callee || self.c.is_generator_called_through_its_closure(file, e) {
                    function_values.insert(sym);
                }
            }
            let Some(declared_in) = self.function_declaring(sym) else { continue };
            // The initializer of a lazy variable is run by a function of its own.
            if self.function_running(file, e) != declared_in || self.is_in_instance_field_initializer(file, e) || declared_in.is_none() && self.lazy_variable_declared_at(file, hir[e].pos).is_some() {
                captured.insert(sym);
            }
        }
        if self.jsx_runtime(file).is_none() {
            for (i, e) in hir.exprs.iter().enumerate() {
                if !matches!(e.kind, hir::ExprKind::Jsx(_)) {
                    continue;
                }
                for is_fragment_tag in [false, true] {
                    let (_, Some(sym)) = self.c.classic_jsx_factory(file, hir::ExprId(i as u32), is_fragment_tag) else { continue };
                    let sym = self.value_symbol(sym);
                    if sym.file != file {
                        continue;
                    }
                    captured.insert(sym);
                    if self.files.flags(sym).contains(bun_sema::bind::SymFlags::FUNCTION) {
                        function_values.insert(sym);
                    }
                }
            }
        }
        for sym in self.c.values_named_by_decorators(file) {
            let sym = self.value_symbol(sym);
            if sym.file != file {
                continue;
            }
            captured.insert(sym);
            if self.files.flags(sym).contains(bun_sema::bind::SymFlags::FUNCTION) {
                function_values.insert(sym);
            }
        }
        for &(.., sym) in self.lazy_declarations_of(file).iter() {
            captured.insert(sym);
        }
        for &(_, export) in self.files.exports_of_module(self.files.file_symbol(file)) {
            captured.insert(self.value_symbol(export));
            // `var a = ..; export default a`: other modules read `a`.
            captured.insert(self.value_symbol_of_export(export));
        }
        let captured = Rc::new(captured);
        self.captured.insert(file, captured.clone());
        self.function_values.insert(file, Rc::new(function_values));
        captured
    }

    pub(crate) fn function_values(&mut self, file: FileId) -> Rc<FxHashSet<Sym>> {
        self.captured(file);
        self.function_values[&file].clone()
    }
}
