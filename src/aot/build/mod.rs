mod class;
mod coerce;
mod comments;
mod commonjs;
mod constants;
mod expr;
pub(crate) mod fused_joins;
mod host_classes;
mod imports;
mod intrinsics;
mod jsx;
mod parts;
mod pattern;
mod predict;
mod query_tape;
pub mod react;
mod scalar_url;
mod scope;
mod stmt;
pub(crate) mod string_sets;
mod types;
mod validate;

use self::coerce::Ty;
pub(crate) use self::imports::ImportSource;
use crate::builder::{FuncBuilder, Var};
use crate::builtins_generated::Operation;
use crate::declared::DeclaredTable;
use crate::fragment::{
    Body, Definition, Fragment, FuncKey, Function, GlobalKey, LayoutKey, NO_FILE, Notes,
    ReferenceCollector, ReferencedIds, Shape, Variable,
};
use crate::id::{BlockId, FuncId, GlobalId, LayoutId, ModuleId, StrId, TyId, V};
use crate::ir::{self, Func, FuncKind, Op, Term};
use bun_builtin_syntax::Archive;
use bun_sema::atom::Atom;
use bun_sema::check::{
    Activation, Capture, Checker, CodeOwner, EvaluationTime, FirstStore, Identity,
    Program as Checked, Receiver,
};
use bun_sema::hir::{self, ClassId, FileKind, FnId, StmtKind};
use bun_sema::program::{Builtin, FileId, Files, LoadedBy, Sym};
use bun_sema::types::TypeId;
use bun_sema::util::InParallel;
use rustc_hash::{FxHashMap, FxHashSet};
use std::borrow::Cow;
use std::collections::VecDeque;
use std::rc::Rc;
use std::sync::OnceLock;

const FILES_PER_CHECKER: usize = 32;
const IMPORTS_PER_CHECKER: usize = 256;

pub struct Problem {
    pub file: FileId,
    pub pos: u32,
    pub what: Cow<'static, str>,
}

#[derive(Default)]
pub(crate) struct Undo {
    pub(crate) funcs: Vec<((FileId, FnId), Option<FuncId>)>,
    pub(crate) named_functions: Vec<((FileId, FnId), Option<FuncId>)>,
    pub(crate) activation_layouts: Vec<(Activation, Option<LayoutId>)>,
    pub(crate) this_bindings: Vec<(FnId, Option<LayoutId>)>,
    pub(crate) places: Vec<(Sym, Option<Place>)>,
    pub(crate) parameter_slots: Vec<(Sym, Option<(Place, u32, u32)>)>,
}

fn restore_entries<K: Copy + Eq + std::hash::Hash, T>(
    map: &mut FxHashMap<K, T>,
    recorded: Vec<(K, Option<T>)>,
) {
    let mut seen = FxHashSet::default();
    for (key, was) in recorded {
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

#[derive(Copy, Clone)]
enum Dependency {
    Module(FileId),
    External(Atom),
}

#[derive(Default)]
struct LoadedGraph {
    files: FxHashSet<FileId>,
    builtin_modules: FxHashSet<Atom>,
}

#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum Role {
    Whole,
    Entry,
    Beside,
    Typed,
    Second,
}

#[derive(Copy, Clone)]
pub(crate) enum Source {
    Module(FileId),
    Function {
        file: FileId,
        func: FnId,
        class: Option<(FileId, ClassId)>,
        role: Role,
        untyped_clone_root: FnId,
    },
    DefaultConstructor {
        file: FileId,
        class: ClassId,
    },
    EnumObject(Sym),
    NamespaceObject(Sym),
    ModuleNamespaceReader(FileId),
    DynamicImport(FileId, bool),
    Required(FileId),
    DynamicImportBody(FileId, bool),
    ModuleBody(FileId),
    ModuleTouch(FileId),
    ModuleSettling(FileId),
    ModuleDriver(FileId),
    ModuleInner(FileId),
    Initializer(Sym),
    ExportedObjectMember(FileId),
    ExportedObjectDefault(FileId, bool),
    FilesByPath(FileId),
    EvaluateByIndex(FileId),
    EvaluateSingleFile(FileId, FileId),
    ExportVariablesReader(FileId),
    NamespaceForHost(FileId),
    Validator(FileId, u32),
}

impl Source {
    fn key(self) -> FuncKey {
        match self {
            Source::Module(file) => FuncKey::Module(file),
            Source::Function {
                file,
                func,
                role: Role::Typed,
                ..
            } => FuncKey::TypedBody(file, func),
            Source::Function {
                file,
                func,
                role: Role::Beside,
                ..
            } => FuncKey::GenericEntrypoint(file, func),
            Source::Function {
                file,
                func,
                role: Role::Second,
                untyped_clone_root,
                ..
            } => FuncKey::UntypedClone(file, func, untyped_clone_root),
            Source::Function { file, func, .. } => FuncKey::Function(file, func),
            Source::DefaultConstructor { file, class } => FuncKey::DefaultConstructor(file, class),
            Source::EnumObject(sym) => FuncKey::EnumObject(sym.file, sym.id),
            Source::NamespaceObject(sym) => FuncKey::NamespaceObject(sym.file, sym.id),
            Source::ModuleNamespaceReader(file) => FuncKey::ModuleNamespaceReader(file),
            Source::DynamicImport(file, is_node_mode) => FuncKey::DynamicImport(file, is_node_mode),
            Source::Required(file) => FuncKey::Required(file),
            Source::DynamicImportBody(file, is_node_mode) => {
                FuncKey::DynamicImportBody(file, is_node_mode)
            }
            Source::ModuleBody(file) => FuncKey::ModuleBody(file),
            Source::ModuleTouch(file) => FuncKey::ModuleTouch(file),
            Source::ModuleSettling(file) => FuncKey::ModuleSettling(file),
            Source::ModuleDriver(file) => FuncKey::ModuleDriver(file),
            Source::ModuleInner(file) => FuncKey::ModuleInner(file),
            Source::Initializer(sym) => FuncKey::Initializer(sym.file, sym.id),
            Source::ExportedObjectMember(file) => FuncKey::ExportedObjectMember(file),
            Source::ExportedObjectDefault(file, is_node_mode) => {
                FuncKey::ExportedObjectDefault(file, is_node_mode)
            }
            Source::FilesByPath(file) => FuncKey::FilesByPath(file),
            Source::EvaluateByIndex(file) => FuncKey::EvaluateByIndex(file),
            Source::EvaluateSingleFile(entry, file) => FuncKey::EvaluateSingleFile(entry, file),
            Source::ExportVariablesReader(file) => FuncKey::ExportVariablesReader(file),
            Source::NamespaceForHost(file) => FuncKey::NamespaceForHost(file),
            Source::Validator(file, at) => FuncKey::Validator(file, at),
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
    pub(crate) continue_to: BlockId,
    pub(crate) iter: V,
    pub(crate) unwind_depth: usize,
    pub(crate) is_unlabeled_break_target: bool,
    pub(crate) finally_context: Option<FinallyContext>,
}

#[derive(Copy, Clone)]
pub(crate) enum Exit {
    Return(V),
    Goto(BlockId),
}

pub(crate) struct FinallyContext {
    pub(crate) entry: BlockId,
    pub(crate) completion_type: Var,
    pub(crate) value: Var,
    pub(crate) exception: Var,
    pub(crate) exits: Vec<(usize, Exit)>,
}

#[derive(Copy, Clone)]
pub(crate) struct Sink {
    pub(crate) e: hir::ExprId,
    pub(crate) want: Ty,
    pub(crate) why: ir::CoerceReason,
    pub(crate) keeps_unconvertible_objects: bool,
}

pub(crate) struct Fx {
    pub(crate) b: FuncBuilder,
    pub(crate) id: FuncId,
    pub(crate) file: FileId,
    pub(crate) func: FnId,
    pub(crate) locals: FxHashMap<Sym, Var>,
    pub(crate) initialized: FxHashMap<Sym, Var>,
    pub(crate) known_initialized: FxHashMap<GlobalId, Var>,
    pub(crate) initialized_before_loops: Vec<(GlobalId, V)>,
    pub(crate) modules_touched_before_loops: Vec<FileId>,
    pub(crate) true_value: V,
    pub(crate) false_value: V,
    pub(crate) envs: Vec<EnvScope>,
    pub(crate) this: V,
    pub(crate) this_type: coerce::Ty,
    pub(crate) class: Option<(FileId, ClassId)>,
    pub(crate) jumps: Vec<Jump>,
    pub(crate) handlers: Vec<BlockId>,
    pub(crate) label: Atom,
    pub(crate) this_var: Option<Var>,
    pub(crate) this_binding: Option<(LayoutId, V)>,
    pub(crate) this_class: Option<(FileId, ClassId)>,
    pub(crate) receivers: FxHashMap<Receiver, V>,
    pub(crate) captured_arguments: FxHashMap<FnId, V>,
    pub(crate) captured_new_targets: FxHashMap<FnId, V>,
    pub(crate) home_objects: FxHashMap<FnId, V>,
    pub(crate) given: V,
    pub(crate) new_target: V,
    pub(crate) listed_fields: Option<(V, Atom, bool)>,
    pub(crate) is_in_field_initializer: bool,
    pub(crate) returns_this: bool,
    pub(crate) is_static: bool,
    pub(crate) constructor_params: Vec<V>,
    pub(crate) disposable_stack: V,
    pub(crate) arguments: V,
    pub(crate) all_arguments: V,
    pub(crate) is_typed: bool,
    pub(crate) checked: CheckedTypes,
    pub(crate) checked_vars: FxHashMap<Var, TypeId>,
    pub(crate) fitted: FxHashMap<(BlockId, V, TyId), V>,
    pub(crate) nullish_after_cast: FxHashSet<V>,
    pub(crate) is_coercing_fresh_graph: bool,
    pub(crate) handed_back: Versioned<FxHashSet<hir::ExprId>>,
    pub(crate) unchanged_by_coercion: Option<coerce::CoercionState>,
    pub(crate) coercion_idempotence: coerce::Idempotence,
    pub(crate) calls_in_tail_position: Vec<hir::ExprId>,
    pub(crate) skip_close_if: FxHashMap<V, V>,
    pub(crate) uncoercible_objects: Versioned<FxHashMap<V, TypeId>>,
    pub(crate) narrowed: Versioned<FxHashMap<V, Ty>>,
    pub(crate) sink: Option<Sink>,
    pub(crate) expected: FxHashMap<(BlockId, V, ir::Prediction), V>,
    pub(crate) first_stores: Vec<FirstStore>,
    pub(crate) owes_initialize_without_stores: bool,
    pub(crate) is_storing_default: bool,
    pub(crate) first_spans: FxHashMap<V, crate::audit::RecordedSpan>,
    pub(crate) last_spans: FxHashMap<V, crate::audit::RecordedSpan>,
    pub(crate) operand_spans: Vec<ir::Span>,
}

pub(crate) use bun_sema::fold::Defines;

pub struct Shared<'a> {
    pub(crate) defines: Defines,
    pub(crate) builtin_defines: Defines,
    pub(crate) last_names_of_defines: FxHashSet<Atom>,
    pub(crate) last_names_of_builtin_defines: FxHashSet<Atom>,
    pub(crate) names_of_own_path: [Atom; 2],
    pub(crate) features: FxHashSet<Vec<u8>>,
    pub(crate) constants: &'a crate::Constants,
    pub(crate) bundle: Option<imports::Bundle<'a>>,
    roots: Vec<FileId>,
    entry_points: Vec<Vec<FileId>>,
    prelude: Vec<FileId>,
    decorator_helpers: Option<FileId>,
    host_class_helpers: Option<FileId>,
    promise_helpers: Option<FileId>,
    delegation_helpers: Option<FileId>,
    validation_helpers: Option<FileId>,
    runtime_helpers: Option<FileId>,
    has_computed_module_names: bool,
    modules: Vec<FileId>,
    is_module: Vec<bool>,
    builtin_modules: Vec<(u32, FileId)>,
    pub(crate) builtin_functions: commonjs::BuiltinFunctions,
    async_modules: FxHashSet<FileId>,
    pub(crate) using_arguments: Vec<OnceLock<UsingArguments>>,
    function_facts:
        bun_sema::util::ShardedMap<(FileId, FnId, bool), Box<[query_tape::RecordedAnswer]>>,
    pub(crate) calls_marked_pure: Vec<OnceLock<Vec<u32>>>,
    pub(crate) may_have_requires: Vec<OnceLock<bool>>,
    pub(crate) stars: Vec<OnceLock<imports::Stars>>,
    lazy_modules: FxHashSet<FileId>,
    lazy_modules_with_state: FxHashSet<FileId>,
    pub(crate) modules_deferred: FxHashSet<FileId>,
    pub(crate) json_modules_read_by_name: FxHashSet<FileId>,
    pub(crate) json_modules_loaded_whole: FxHashSet<FileId>,
    lazy_module_dependencies: Vec<OnceLock<Vec<(FileId, Dependency)>>>,
    dependencies: Vec<OnceLock<Vec<Dependency>>>,
    builtin_modules_loaded_by_import: Vec<OnceLock<Vec<Atom>>>,
    loaded_by_every_entry_point: OnceLock<LoadedGraph>,
    unresolved_imports: FxHashMap<FileId, Vec<(FileId, Atom)>>,
}

#[derive(Default)]
pub(crate) struct UsingArguments {
    pub(crate) functions: FxHashSet<FnId>,
    pub(crate) objects: FxHashSet<FnId>,
    pub(crate) arrows: FxHashSet<FnId>,
}

impl<'a> Shared<'a> {
    pub fn new(
        program: &Checked<'_>,
        entry_points: &[Vec<FileId>],
        constants: &'a crate::Constants,
        in_parallel: InParallel<'_>,
    ) -> Shared<'a> {
        let entry_points: Vec<Vec<FileId>> = entry_points
            .iter()
            .map(|run| {
                run.iter()
                    .map(|&file| imports::original_source_of(program.files, file))
                    .collect()
            })
            .collect();
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
        let has_builtin_files = program
            .files
            .modules
            .iter()
            .any(|module| module.builtin.is_some());
        let builtin_defines = match !has_builtin_files {
            true => Defines::default(),
            false => Defines::new(
                Archive::embedded()
                    .manifest()
                    .defines()
                    .iter()
                    .map(|(name, value)| (&name[..], &value[..]))
                    .chain([(&b"IS_BUN_AOT"[..], &b"true"[..])]),
            ),
        };
        let defines = Defines::new(
            constants
                .defines
                .iter()
                .map(|(name, value)| (&name[..], &value[..])),
        );
        let atoms_of = |defines: &Defines| {
            defines
                .last_names
                .iter()
                .filter_map(|name| program.files.atoms.lookup(name))
                .collect()
        };
        let mut shared = Shared {
            last_names_of_defines: atoms_of(&defines),
            last_names_of_builtin_defines: atoms_of(&builtin_defines),
            names_of_own_path: [&b"__filename"[..], b"__dirname"]
                .map(|name| program.files.atoms.lookup(name).unwrap_or(Atom::NONE)),
            defines,
            builtin_defines,
            builtin_modules,
            builtin_functions: commonjs::BuiltinFunctions::new(program.files),
            features: constants.features.iter().cloned().collect(),
            constants,
            bundle: imports::Bundle::new(program.files, &roots, constants),
            roots,
            entry_points: entry_points.to_vec(),
            prelude: (crate::prelude::FILES
                .iter()
                .filter(|file| file.0 != crate::prelude::RUNTIME_HELPERS.0))
            .filter_map(|&(name, _)| {
                program
                    .files
                    .by_path
                    .get(&crate::prelude::path_of(&constants.root, name))
            })
            .collect(),
            runtime_helpers: program.files.by_path.get(&crate::prelude::path_of(
                &constants.root,
                crate::prelude::RUNTIME_HELPERS.0,
            )),
            has_computed_module_names: program.files.modules.iter().any(|module| {
                matches!(
                    module.builtin,
                    Some(Builtin::Module(
                        _,
                        LoadedBy::ComputedName | LoadedBy::RuntimeModulesOrComputedName
                    ))
                )
            }),
            decorator_helpers: program.files.by_path.get(&crate::prelude::path_of(
                &constants.root,
                crate::prelude::DECORATORS.0,
            )),
            host_class_helpers: program.files.by_path.get(&crate::prelude::path_of(
                &constants.root,
                crate::prelude::HOST_CLASSES.0,
            )),
            promise_helpers: program
                .files
                .by_path
                .get(&crate::prelude::path_of(&constants.root, "promise.ts")),
            delegation_helpers: program
                .files
                .by_path
                .get(&crate::prelude::path_of(&constants.root, "promise.ts")),
            validation_helpers: program.files.by_path.get(&crate::prelude::path_of(
                &constants.root,
                crate::prelude::VALIDATION.0,
            )),
            modules: Vec::new(),
            is_module: Vec::new(),
            async_modules: FxHashSet::default(),
            using_arguments: (0..program.files.modules.len())
                .map(|_| OnceLock::new())
                .collect(),
            function_facts: Default::default(),
            calls_marked_pure: (0..program.files.modules.len())
                .map(|_| OnceLock::new())
                .collect(),
            may_have_requires: (0..program.files.modules.len())
                .map(|_| OnceLock::new())
                .collect(),
            stars: (0..program.files.modules.len())
                .map(|_| OnceLock::new())
                .collect(),
            lazy_modules: FxHashSet::default(),
            lazy_modules_with_state: FxHashSet::default(),
            modules_deferred: FxHashSet::default(),
            json_modules_read_by_name: FxHashSet::default(),
            json_modules_loaded_whole: FxHashSet::default(),
            lazy_module_dependencies: (0..program.files.modules.len())
                .map(|_| OnceLock::new())
                .collect(),
            dependencies: (0..program.files.modules.len())
                .map(|_| OnceLock::new())
                .collect(),
            builtin_modules_loaded_by_import: (0..program.files.modules.len())
                .map(|_| OnceLock::new())
                .collect(),
            loaded_by_every_entry_point: OnceLock::new(),
            unresolved_imports: FxHashMap::default(),
        };
        let mut c = program.checker();
        c.set_logs_type_errors(constants.logs_type_errors);
        c.set_declaration_only_files(shared.bundle.iter().flat_map(|bundle| bundle.declaring()));
        if !constants.ignores_dce_annotations && constants.source_path_to_url.is_none() {
            let marked = (0..program.files.modules.len() as u32)
                .map(FileId)
                .map(|file| {
                    (
                        file,
                        shared.calls_marked_pure[file.idx()]
                            .get_or_init(|| comments::calls_marked_pure(c.hir(file))),
                    )
                });
            c.set_calls_marked_pure(
                marked
                    .filter(|(_, calls)| !calls.is_empty())
                    .map(|(file, calls)| (file, calls.clone()))
                    .collect(),
            );
        }
        let (modules, async_modules) =
            FileBuild::new(&mut c, &shared, NO_FILE).report_module_graph();
        (shared.modules, shared.async_modules) = (modules, async_modules);
        shared.modules_deferred =
            FileBuild::new(&mut c, &shared, NO_FILE).deferred_import_modules();
        shared.json_modules_read_by_name =
            FileBuild::new(&mut c, &shared, NO_FILE).json_modules_read_by_name();
        shared.json_modules_loaded_whole =
            FileBuild::new(&mut c, &shared, NO_FILE).json_modules_loaded_whole();
        shared.unresolved_imports = FileBuild::new(&mut c, &shared, NO_FILE).unresolved_imports();
        shared.is_module = vec![false; program.files.modules.len()];
        for file in &shared.modules {
            shared.is_module[file.idx()] = true;
        }
        let fits = |file: FileId| {
            constants.source_path_to_url.is_none()
                && program.files.module(file).builtin.is_none()
                && !shared.roots.contains(&file)
                && !shared.prelude.contains(&file)
                && !shared.async_modules.contains(&file)
        };
        let is_bundled = shared.bundle.is_some();
        let mut is_licensed = |file: FileId| if is_bundled { constants.side_effect_free_files.contains(program.files.module(file).file_name()) } else { c.is_in_side_effect_free_package(file) } && !c.is_entirely_pure(file);
        let reexports_imports = |file: FileId| {
            let hir = program.files.hir(file);
            let imports = || {
                hir.ids(hir.body).filter_map(|stmt| {
                    if let StmtKind::Import(import) = hir[stmt].kind {
                        Some(&hir[import])
                    } else {
                        None
                    }
                })
            };
            let is_imported = |name: Atom| {
                imports().any(|import| {
                    import.default == name
                        || import.namespace == name
                        || import.named.iter().any(|named| hir[named].local == name)
                })
            };
            hir.ids(hir.body).any(|stmt| match hir[stmt].kind {
                StmtKind::ExportStar { type_only, .. } => !type_only,
                StmtKind::ExportNamed(export) => {
                    !hir[export].type_only
                        && (hir[export].has_module_specifier
                            || hir[export]
                                .items
                                .iter()
                                .any(|item| !hir[item].type_only && is_imported(hir[item].local)))
                }
                StmtKind::ExportDefault(e) => {
                    matches!(hir[e].kind, hir::ExprKind::Ident(name) if is_imported(name))
                }
                StmtKind::ImportEquals(import) => {
                    matches!(hir[import].target, hir::ImportEqualsTarget::Entity(_))
                }
                _ => false,
            })
        };
        let licensed: Vec<FileId> = shared
            .modules
            .iter()
            .copied()
            .filter(|&file| fits(file) && is_licensed(file) && !reexports_imports(file))
            .collect();
        let queries_in_body = |file: FileId| {
            let hir = program.files.hir(file);
            program.files.module(file).is_commonjs() || hir.ids(hir.body).any(|stmt| matches!(hir[stmt].kind, StmtKind::ImportEquals(import) if matches!(hir[import].target, hir::ImportEqualsTarget::Require(_))))
        };
        let would_wait: Vec<FileId> = licensed
            .iter()
            .copied()
            .filter(|&file| !c.runs_before_importers(file) && !queries_in_body(file))
            .collect();
        let waiting: FxHashSet<FileId> = would_wait
            .iter()
            .copied()
            .filter(|&file| !c.is_in_import_cycle(file))
            .collect();
        let lazy_modules: FxHashSet<FileId> = licensed
            .iter()
            .copied()
            .filter(|&file| {
                waiting.contains(&file) || c.runs_before_importers(file) && !queries_in_body(file)
            })
            .collect();
        shared.lazy_modules = lazy_modules;
        shared.lazy_modules_with_state = waiting;
        c.set_lazy_modules(
            &shared
                .lazy_modules
                .union(&shared.modules_deferred)
                .copied()
                .collect(),
        );
        let called = c.called_imports(in_parallel);
        let code = c.map_slices(
            called,
            IMPORTS_PER_CHECKER,
            Some(in_parallel),
            &|c, imports| FileBuild::new(c, &shared, NO_FILE).imported_code(imports),
        );
        c.set_imported_code(code.into_iter().flatten());
        let resolved = c.map_slices(
            &shared.modules,
            FILES_PER_CHECKER,
            Some(in_parallel),
            &|c, files| FileBuild::new(c, &shared, NO_FILE).resolve_imports_for(files),
        );
        FileBuild::new(&mut c, &shared, NO_FILE)
            .report_resolved_imports(resolved.into_iter(), in_parallel);
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

    pub(crate) fn delegation_helpers(&self) -> Option<FileId> {
        self.delegation_helpers
    }

    pub(crate) fn promise_helpers(&self) -> Option<FileId> {
        self.promise_helpers
    }

    pub(crate) fn validation_helpers(&self) -> Option<FileId> {
        self.validation_helpers
    }

    pub(crate) fn host_class_helpers(&self) -> Option<FileId> {
        self.host_class_helpers
    }

    pub(crate) fn runtime_helpers(&self) -> Option<FileId> {
        self.runtime_helpers
    }

    pub(crate) fn dynamically_loadable_runtime_helpers(&self) -> Option<FileId> {
        self.runtime_helpers
            .filter(|_| self.has_computed_module_names)
    }

    pub(crate) fn builtin_modules(&self) -> &[(u32, FileId)] {
        &self.builtin_modules
    }

    pub fn is_prelude(&self, file: FileId) -> bool {
        self.prelude.contains(&file)
    }

    pub fn is_compiled(&self, file: FileId) -> bool {
        self.is_module.get(file.idx()) == Some(&true)
    }
}

#[derive(Default)]
pub(crate) struct Versioned<T> {
    inner: T,
    version: u32,
}

impl<T> Versioned<T> {
    #[inline]
    pub(crate) fn version(&self) -> u32 {
        self.version
    }
}

impl<T> std::ops::Deref for Versioned<T> {
    type Target = T;
    #[inline]
    fn deref(&self) -> &T {
        &self.inner
    }
}

impl<T> std::ops::DerefMut for Versioned<T> {
    #[inline]
    fn deref_mut(&mut self) -> &mut T {
        self.version = self.version.wrapping_add(1);
        &mut self.inner
    }
}

#[derive(Default)]
pub(crate) struct CheckedTypes {
    by_value: Vec<Option<TypeId>>,
    none_value_type: Option<TypeId>,
}

pub(crate) struct CheckedTypeSlot<'a>(&'a mut Option<TypeId>);

impl CheckedTypes {
    #[inline]
    pub(crate) fn get(&self, value: V) -> Option<&TypeId> {
        match value.is_none() {
            true => self.none_value_type.as_ref(),
            false => self
                .by_value
                .get(value.idx())
                .and_then(|checked| checked.as_ref()),
        }
    }

    #[inline]
    fn place_of(&mut self, value: V) -> &mut Option<TypeId> {
        if value.is_none() {
            return &mut self.none_value_type;
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
    pub(crate) fn entry(&mut self, value: V) -> CheckedTypeSlot<'_> {
        CheckedTypeSlot(self.place_of(value))
    }
}

impl CheckedTypeSlot<'_> {
    #[inline]
    pub(crate) fn or_insert(self, checked: TypeId) {
        self.0.get_or_insert(checked);
    }
}

#[derive(Default)]
pub(crate) struct Out {
    pub(crate) strs: ir::Strs,
    pub(crate) tys: DeclaredTable,
    pub(crate) layouts: Vec<ir::Layout>,
    pub(crate) funcs: Vec<Func>,
    pub(crate) globals: Vec<ir::Global>,
}

pub(crate) struct FileBuild<'c, 'p, 's> {
    pub(crate) c: &'c mut Checker<'p, 's>,
    pub(crate) files: &'p Files<'s>,
    pub(crate) shared: &'c Shared<'c>,
    pub(crate) file: FileId,
    pub(crate) out: Out,
    pub(crate) sources: Vec<Source>,
    layout_keys: Vec<LayoutKey>,
    global_keys: Vec<GlobalKey>,
    bodies: Vec<Option<Box<Body>>>,
    environments: u32,
    hidden_variables: u32,
    pub(crate) template_objects: FxHashMap<(FileId, u32), GlobalId>,
    problems: Vec<Problem>,
    declares: Vec<LayoutId>,
    classes_as_values: Vec<LayoutId>,
    classes_as_values_set: FxHashSet<LayoutId>,
    last_default_export_check: Option<(FuncId, hir::ExprId)>,
    modules_touched: (FuncId, BlockId, Vec<FileId>),
    implicit_stores: Vec<StrId>,
    cut: Vec<(u32, u32)>,
    is_query_only: bool,
    constants_after_defines: FxHashMap<Sym, Option<constants::Constant>>,
    dropped: Vec<(u32, u32)>,
    marks: Vec<parts::Mark>,
    enters_module_body: bool,
    layout_problems: FxHashMap<LayoutId, Vec<Problem>>,
    constructs: FxHashMap<LayoutId, LayoutId>,
    modules: FxHashMap<FileId, ModuleId>,
    module_files: Vec<FileId>,
    evaluations: FxHashMap<FileId, FuncId>,
    module_bodies: FxHashMap<FileId, FuncId>,
    deferred_module_functions: FxHashMap<FuncKey, FuncId>,
    module_drivers: FxHashMap<FileId, FuncId>,
    module_inners: FxHashMap<FileId, FuncId>,
    lazy: FxHashMap<Sym, bool>,
    pub(crate) value_symbols: FxHashMap<Sym, Sym>,
    ident_cache: Vec<scope::CachedIdent>,
    pub(crate) ambient: std::cell::RefCell<FxHashMap<Sym, bool>>,
    initializers: FxHashMap<Sym, FuncId>,
    pub(crate) lazy_globals: FxHashMap<GlobalId, Sym>,
    pub(crate) hoisted_functions: FxHashMap<GlobalId, (GlobalId, FileId, FnId)>,
    lazy_variable_states: FxHashMap<Sym, Option<GlobalId>>,
    lazy_declarations: FxHashMap<FileId, Rc<Vec<(u32, u32, Sym)>>>,
    lazy_uses: Option<Rc<Vec<(u32, FnId, Sym)>>>,
    scalar_class_by_symbol: FxHashMap<Sym, Option<scalar_url::ScalarClass>>,
    scalar_urls: FxHashMap<(FileId, hir::ExprId), scalar_url::ScalarUrl>,
    scalar_url_variables: FxHashMap<Sym, [Var; 3]>,
    preevaluated_operands: Vec<(FileId, hir::ExprId, V)>,
    lazy_module_uses: Option<Rc<Vec<(u32, FnId, FileId, u32)>>>,
    pub(crate) funcs: FxHashMap<(FileId, FnId), FuncId>,
    named_functions: FxHashMap<(FileId, FnId), FuncId>,
    named_default_constructors: FxHashMap<(FileId, ClassId), FuncId>,
    pub(crate) classes: FxHashMap<(FileId, ClassId), class::ClassInfo>,
    pub(crate) class_variables: FxHashMap<(FileId, ClassId, class::ClassVariable), Place>,
    classes_in_progress: FxHashSet<(FileId, ClassId)>,
    classes_being_defined: FxHashSet<(FileId, ClassId)>,
    declared_classes: FxHashSet<(FileId, ClassId)>,
    waiting_for_class: FxHashMap<(FileId, ClassId), Vec<FuncId>>,
    pub(crate) enum_objects: FxHashMap<Sym, FuncId>,
    pub(crate) validators: validate::Validators,
    pub(crate) enum_globals: FxHashMap<Sym, GlobalId>,
    pub(crate) namespace_objects: FxHashMap<Sym, FuncId>,
    pub(crate) namespace_globals: FxHashMap<Sym, GlobalId>,
    pub(crate) dynamic_imports: FxHashMap<(FileId, bool), FuncId>,
    pub(crate) require_evaluations: FxHashMap<FileId, FuncId>,
    pub(crate) required_es_modules: FxHashMap<FileId, self::commonjs::RequiredEsModule>,
    pub(crate) files_with_requires: FxHashMap<FileId, bool>,
    pub(crate) dynamic_import_bodies: FxHashMap<(FileId, bool), FuncId>,
    pub(crate) export_variables: FxHashMap<(FileId, Atom), GlobalId>,
    pub(crate) exported_object_imports: FxHashMap<(FileId, u8), FuncId>,
    pub(crate) external_modules: Vec<(StrId, GlobalId)>,
    pub(crate) module_globals: FxHashMap<(FileId, &'static str), GlobalId>,
    pub(crate) inferred_function_names: FxHashMap<(FileId, FnId), StrId>,
    pub(crate) inferred_class_names: FxHashMap<(FileId, ClassId), StrId>,
    pub(crate) key_name_value: V,
    pub(crate) import_sources: std::cell::RefCell<FxHashMap<Sym, ImportSource>>,
    pub(crate) entity_aliases: FxHashMap<Sym, self::imports::EntityAlias>,
    pub(crate) places: FxHashMap<Sym, Place>,
    pub(crate) parameter_slots: FxHashMap<Sym, (Place, u32, u32)>,
    pub(crate) activation_layouts: FxHashMap<Activation, LayoutId>,
    activation_layout_positions: std::collections::BTreeSet<(u32, Activation)>,
    pub(crate) this_bindings: FxHashMap<FnId, LayoutId>,
    pub(crate) activations: FxHashMap<LayoutId, Activation>,
    pub(crate) cached_closures: FxHashSet<(LayoutId, u32)>,
    pub(crate) captures: FxHashMap<FuncId, Vec<Capture>>,
    pub(crate) imports: FxHashMap<LayoutId, Vec<Capture>>,
    captured: FxHashMap<FileId, Rc<FxHashSet<Sym>>>,
    function_values: FxHashMap<FileId, Rc<FxHashSet<Sym>>>,
    tys: FxHashMap<(TypeId, u8), TyId>,
    description_is_layout_free: bool,
    description_is_leaf: bool,
    tape: query_tape::Tape<'c>,
    pub(crate) records: FxHashMap<TypeId, Option<LayoutId>>,
    pub(crate) known: coerce::Known,
    pub(crate) layout_types: FxHashMap<LayoutId, TypeId>,
    pub(crate) layout_subset_pairs:
        FxHashMap<(TyId, TyId), Option<(Rc<[(LayoutId, LayoutId)]>, bool)>>,
    pub(crate) checked_globals: FxHashMap<GlobalId, TypeId>,
    pub(crate) checked_fields: FxHashMap<(LayoutId, u32), TypeId>,
    pub(crate) annotated_fields: FxHashSet<(LayoutId, u32)>,
    pub(crate) fixed_layout_classes: FxHashMap<LayoutId, (FileId, ClassId)>,
    pub(crate) union_part_layouts: FxHashMap<LayoutId, Vec<LayoutId>>,
    pub(crate) layout_growth_epoch: u32,
    pub(crate) cast_targets: FxHashMap<TyId, (u32, TyId)>,
    pub(crate) signatures: FxHashMap<FuncId, coerce::Signature>,
    layouts_pending_field_types: FxHashMap<LayoutId, types::FieldTypes>,
    predicted_composed_cache: FxHashMap<(TypeId, u8), crate::declared::Declared>,
    predicted_description_cache: FxHashMap<TypeId, TyId>,
    work: VecDeque<FuncId>,
    pub(crate) typed_bodies: FxHashMap<FuncId, FuncId>,
    pub(crate) untyped_clones: FxHashMap<FuncId, FuncId>,
    pub(crate) generic_entrypoints: FxHashMap<FuncId, FuncId>,
    pub(crate) generic_entrypoint_ids: FxHashSet<FuncId>,
    pub(crate) untyped_clone_worklist: VecDeque<FuncId>,
    pub(crate) untyped_clone_root: Option<FnId>,
    pub(crate) undo: Option<Box<Undo>>,
}

pub fn translate_file(c: &mut Checker<'_, '_>, shared: &Shared<'_>, file: FileId) -> Box<Fragment> {
    c.enable_expr_cache_for(file);
    let mut build = FileBuild::new(c, shared, file);
    for &(start, _) in build.hir(file).with_bodies.iter() {
        build.problem(file, start, "a `with` statement");
    }
    match build.files.module(file).builtin {
        Some(Builtin::Functions) => {
            for function in shared
                .builtin_functions
                .list
                .iter()
                .filter(|function| function.file == file)
            {
                build.declare_function(file, function.func, None);
            }
        }
        _ => {
            build.evaluation_function(file);
            if shared
                .entry_points
                .iter()
                .any(|files| files.first() == Some(&file))
                && !build.is_declaration_only(file)
            {
                build.dynamic_import_function(file, false);
                if !build.is_async_module(file) {
                    build.host_namespace_function(file);
                }
            }
            if shared.dynamically_loadable_runtime_helpers() == Some(file)
                && !build.host_may_request_modules()
            {
                build.host_namespace_function(file);
            }
        }
    }
    build.build_functions();
    build.define_file_classes();
    build.build_functions();
    build.finish()
}

pub fn builtin_modules_of_entry_points(
    c: &mut Checker<'_, '_>,
    shared: &Shared<'_>,
) -> Vec<Vec<Box<[u8]>>> {
    let build = FileBuild::new(c, shared, NO_FILE);
    let of_entry_point = |roots: &Vec<FileId>| {
        let mut in_order = Vec::new();
        build.load_graph(
            roots,
            &LoadedGraph::default(),
            &mut LoadedGraph::default(),
            &mut in_order,
        );
        in_order
            .into_iter()
            .map(|specifier| build.c.atoms().bytes(specifier).into())
            .collect()
    };
    shared.entry_points.iter().map(of_entry_point).collect()
}

pub fn files_imported_by(
    c: &mut Checker<'_, '_>,
    shared: &Shared<'_>,
    file: FileId,
) -> Vec<FileId> {
    use bun_sema::bind::{Decl, SymFlags};
    let (files, hir, bound) = (c.p.files, c.hir(file), c.bound(file));
    let is_dropped_import = |specifier: Atom| {
        shared
            .bundle
            .as_ref()
            .is_some_and(|bundle| bundle.dropped.contains(&(file, c.atoms().bytes(specifier))))
    };
    let is_only_a_type = |decl: Decl| {
        let id = bound.symbol_of_declaration(decl);
        id.is_some()
            && files
                .resolve_alias(files.sym(file, id))
                .is_some_and(|target| {
                    let flags = files.flags(target);
                    flags.intersects(SymFlags::TYPE) && !flags.intersects(SymFlags::VALUE)
                })
    };
    let mut imported = Vec::new();
    for stmt in hir.ids(hir.body) {
        let (spec, is_for_types) = match hir[stmt].kind {
            StmtKind::Import(import) => {
                let it = &hir[import];
                let references_type = || {
                    it.named
                        .iter()
                        .any(|name| hir[name].type_only || is_only_a_type(Decl::ImportSpec(name)))
                };
                (
                    it.spec,
                    it.type_only
                        || it.default.is_some() && is_only_a_type(Decl::ImportDefault(import))
                        || references_type(),
                )
            }
            StmtKind::ExportNamed(export) => {
                let it = &hir[export];
                (
                    it.spec,
                    it.type_only
                        || it.items.iter().any(|name| {
                            hir[name].type_only || is_only_a_type(Decl::ExportSpec(name))
                        }),
                )
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

pub fn describe(
    c: &mut Checker<'_, '_>,
    shared: &Shared<'_>,
    missing: &[TypeId],
    is_defined: &dyn Fn(Identity) -> bool,
) -> Fragment {
    let mut build = FileBuild::new(c, shared, NO_FILE);
    for &ty in missing {
        if let Some(layout) = build.record_layout(ty) {
            build.resolve_field_types(layout);
        }
    }
    let mut next = 0;
    while next < build.out.layouts.len().min(MAX_LAYOUTS_DESCRIBED_AT_ONCE) {
        if let LayoutKey::Record(identity) = build.layout_keys[next]
            && !is_defined(identity)
        {
            build.resolve_field_types(LayoutId::new(next));
        }
        next += 1;
    }
    *build.finish()
}

impl<'c, 'p, 's> FileBuild<'c, 'p, 's> {
    fn new(
        c: &'c mut Checker<'p, 's>,
        shared: &'c Shared<'c>,
        file: FileId,
    ) -> FileBuild<'c, 'p, 's> {
        let mut out = Out::default();
        let known = coerce::Known::new(&mut out.tys);
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
            classes_as_values_set: FxHashSet::default(),
            last_default_export_check: None,
            modules_touched: (FuncId::NONE, BlockId::NONE, Vec::new()),
            implicit_stores: Vec::new(),
            cut: Vec::new(),
            is_query_only: false,
            constants_after_defines: FxHashMap::default(),
            dropped: Vec::new(),
            marks: Vec::new(),
            enters_module_body: false,
            layout_problems: FxHashMap::default(),
            constructs: FxHashMap::default(),
            modules: FxHashMap::default(),
            module_files: Vec::new(),
            evaluations: FxHashMap::default(),
            module_bodies: FxHashMap::default(),
            deferred_module_functions: FxHashMap::default(),
            module_drivers: FxHashMap::default(),
            module_inners: FxHashMap::default(),
            lazy: FxHashMap::default(),
            value_symbols: FxHashMap::default(),
            ident_cache: Vec::new(),
            ambient: Default::default(),
            initializers: FxHashMap::default(),
            lazy_globals: FxHashMap::default(),
            hoisted_functions: FxHashMap::default(),
            lazy_variable_states: FxHashMap::default(),
            lazy_declarations: FxHashMap::default(),
            lazy_uses: None,
            scalar_class_by_symbol: FxHashMap::default(),
            scalar_urls: FxHashMap::default(),
            scalar_url_variables: FxHashMap::default(),
            preevaluated_operands: Vec::new(),
            lazy_module_uses: None,
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
            validators: validate::Validators::default(),
            enum_globals: FxHashMap::default(),
            namespace_objects: FxHashMap::default(),
            namespace_globals: FxHashMap::default(),
            dynamic_imports: FxHashMap::default(),
            require_evaluations: FxHashMap::default(),
            required_es_modules: FxHashMap::default(),
            files_with_requires: FxHashMap::default(),
            dynamic_import_bodies: FxHashMap::default(),
            export_variables: FxHashMap::default(),
            exported_object_imports: FxHashMap::default(),
            external_modules: Vec::new(),
            module_globals: FxHashMap::default(),
            inferred_function_names: FxHashMap::default(),
            inferred_class_names: FxHashMap::default(),
            key_name_value: V::NONE,
            import_sources: Default::default(),
            entity_aliases: FxHashMap::default(),
            places: FxHashMap::default(),
            parameter_slots: FxHashMap::default(),
            activation_layouts: FxHashMap::default(),
            activation_layout_positions: Default::default(),
            this_bindings: FxHashMap::default(),
            activations: FxHashMap::default(),
            cached_closures: FxHashSet::default(),
            captures: FxHashMap::default(),
            imports: FxHashMap::default(),
            captured: FxHashMap::default(),
            function_values: FxHashMap::default(),
            tys: FxHashMap::default(),
            description_is_layout_free: true,
            description_is_leaf: true,
            tape: query_tape::Tape::Off,
            records: FxHashMap::default(),
            known,
            layout_types: FxHashMap::default(),
            layout_subset_pairs: FxHashMap::default(),
            checked_globals: FxHashMap::default(),
            checked_fields: FxHashMap::default(),
            annotated_fields: FxHashSet::default(),
            fixed_layout_classes: FxHashMap::default(),
            union_part_layouts: FxHashMap::default(),
            layout_growth_epoch: 0,
            cast_targets: FxHashMap::default(),
            signatures: FxHashMap::default(),
            layouts_pending_field_types: FxHashMap::default(),
            predicted_composed_cache: FxHashMap::default(),
            predicted_description_cache: FxHashMap::default(),
            work: VecDeque::new(),
            typed_bodies: FxHashMap::default(),
            untyped_clones: FxHashMap::default(),
            generic_entrypoints: FxHashMap::default(),
            generic_entrypoint_ids: FxHashSet::default(),
            untyped_clone_worklist: VecDeque::new(),
            untyped_clone_root: None,
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
        if self.c.atoms().is_symbol_name(atom)
            && let Some(symbol) = self.c.constant_symbol_of_property(atom)
        {
            return self.constant_symbol_name(symbol);
        }
        let bytes = self.c.atoms().bytes(atom);
        let is_private = bytes.starts_with(bun_sema::atom::PRIVATE_NAME_PREFIX);
        self.out.strs.intern(if is_private {
            bytes
        } else {
            bytes.strip_prefix(&[0xFE]).unwrap_or(bytes)
        })
    }

    pub(crate) fn constant_symbol_name(
        &mut self,
        symbol: bun_sema::check::ConstantSymbol,
    ) -> StrId {
        let text = self.c.constant_symbol_text(symbol);
        self.out.strs.intern(&text)
    }

    pub(crate) fn emit_key(&mut self, fx: &mut Fx, name: StrId) -> V {
        let is_symbol = self.out.strs.get(name).first() == Some(&0xFC);
        self.emit(
            fx,
            if is_symbol {
                Op::Symbol(name)
            } else {
                Op::Str(name)
            },
        )
    }

    pub(crate) fn problem(&mut self, file: FileId, pos: u32, what: &'static str) {
        self.problems.push(Problem {
            file,
            pos,
            what: Cow::Borrowed(what),
        });
    }

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
        if !self.shared.lazy_modules.is_empty() {
            self.touch_module_for_op(fx, &op);
        }
        if let Op::GlobalGet(global) | Op::GlobalSet(global, _) = op
            && let Some(&(is_bound, file, func)) = self.hoisted_functions.get(&global)
        {
            if matches!(op, Op::GlobalGet(_)) {
                self.bind_hoisted_function(fx, global, is_bound, file, func);
            } else {
                let yes = self.emit_raw(fx, Op::Bool(true));
                self.emit_raw(fx, Op::GlobalSet(is_bound, yes));
            }
        }
        if let Op::GlobalGet(global) = op
            && let Some(&sym) = self.lazy_globals.get(&global)
        {
            return self.read_lazy_variable(fx, global, sym, true);
        }
        self.emit_raw(fx, op)
    }

    pub(crate) fn bind_hoisted_function(
        &mut self,
        fx: &mut Fx,
        global: GlobalId,
        is_bound: GlobalId,
        file: FileId,
        func: FnId,
    ) {
        let known = self.emit_raw(fx, Op::GlobalGet(is_bound));
        let undefined = self.emit_raw(fx, Op::Undefined);
        let is_first = self.emit_raw(
            fx,
            Op::StrictEq {
                a: known,
                b: undefined,
            },
        );
        let (binds, goes_on) = (fx.b.new_block(), fx.b.new_block());
        self.branch(fx, is_first, binds, goes_on);
        fx.b.seal(binds);
        fx.b.switch_to(binds);
        let yes = self.emit_raw(fx, Op::Bool(true));
        self.emit_raw(fx, Op::GlobalSet(is_bound, yes));
        let id = self.declare_function(file, func, None);
        let own_scope = if file == fx.file {
            self.function_expression_scope(file, func)
        } else {
            None
        };
        let closure = match own_scope {
            Some((activation, field)) => {
                let is_opened_here = self.open_activation(fx, activation);
                let layout = self.activation_layout(activation);
                let env = self.env_for_layout(fx, layout);
                let start = self.hir(file)[func].start;
                let captures = self.capture_values(fx, id, start);
                let closure = self.emit(
                    fx,
                    Op::ClosureOnce {
                        func: id,
                        captures,
                        env,
                        field,
                    },
                );
                if is_opened_here {
                    self.close_env(fx);
                }
                closure
            }
            None => self.emit_raw(
                fx,
                Op::Closure {
                    func: id,
                    captures: ir::Args::new(),
                },
            ),
        };
        self.emit_raw(fx, Op::GlobalSet(global, closure));
        fx.b.jump(goes_on);
        fx.b.seal(goes_on);
        fx.b.switch_to(goes_on);
    }

    pub(crate) fn is_lazily_evaluated(&self, file: FileId) -> bool {
        self.shared.lazy_modules.contains(&file) && !self.is_declaration_only(file)
    }

    fn has_lazy_module_state(&self, file: FileId) -> bool {
        self.shared.lazy_modules_with_state.contains(&file) && !self.is_declaration_only(file)
    }

    fn deferred_module_function(&mut self, file: FileId, source: Source) -> FuncId {
        if let Some(&known) = self.deferred_module_functions.get(&source.key()) {
            return known;
        }
        let name = self.name_with_file("module", file);
        let module = self.module_of(file);
        let created = self.add_func(name, module, 0, FuncKind::Module, source);
        self.out.funcs[created.idx()].flags |= ir::func_flags::IS_HIDDEN_IN_STACK_TRACES;
        self.deferred_module_functions.insert(source.key(), created);
        created
    }

    fn deferred_module_state(&mut self, file: FileId) -> (GlobalId, GlobalId) {
        let name = self.out.strs.intern(b"ran");
        let ran = self.add_global(name, file, Ty::NONE, GlobalKey::ModuleInternal(file, "ran"));
        self.out.globals[ran.idx()].initialization = ir::Initialization::Undefined;
        let name = self.out.strs.intern(b"thrown");
        let thrown = self.add_global(
            name,
            file,
            Ty::NONE,
            GlobalKey::ModuleInternal(file, "thrown"),
        );
        self.out.globals[thrown.idx()].initialization = ir::Initialization::Undefined;
        (ran, thrown)
    }

    pub(crate) fn touch_module(&mut self, fx: &mut Fx, file: FileId) {
        if file == fx.file
            || self.is_builtin_file(fx.file)
            || !self.is_lazily_evaluated(file)
            || fx.modules_touched_before_loops.contains(&file)
        {
            return;
        }
        if (self.modules_touched.0, self.modules_touched.1) != (fx.id, fx.b.block) {
            self.modules_touched = (fx.id, fx.b.block, Vec::new());
        }
        if self.modules_touched.2.contains(&file) {
            return;
        }
        self.modules_touched.2.push(file);
        if self.has_lazy_module_state(file) {
            let (ran, _) = self.deferred_module_state(file);
            let yes = self.emit(fx, Op::Bool(true));
            let known = self.emit_raw(fx, Op::GlobalGet(ran));
            let has_run = self.emit(fx, Op::StrictEq { a: known, b: yes });
            let (asks, goes_on) = (fx.b.new_block(), fx.b.new_block());
            self.branch(fx, has_run, goes_on, asks);
            fx.b.seal(asks);
            fx.b.switch_to(asks);
            let func = self.deferred_module_function(file, Source::ModuleTouch(file));
            self.emit_throwing(
                fx,
                Op::CallDirect {
                    func,
                    args: ir::Args::new(),
                },
            );
            fx.b.jump(goes_on);
            fx.b.seal(goes_on);
            fx.b.switch_to(goes_on);
        } else {
            self.emit_module_evaluation(fx, file);
        }
        self.modules_touched.1 = fx.b.block;
    }

    fn touch_module_for_op(&mut self, fx: &mut Fx, op: &Op) {
        if matches!(
            self.sources[fx.id.idx()],
            Source::FilesByPath(_) | Source::EvaluateByIndex(_) | Source::EvaluateSingleFile(..)
        ) {
            return;
        }
        let file = match *op {
            Op::GlobalGet(global) | Op::GlobalSet(global, _) => {
                let module = self.out.globals[global.idx()].module;
                module.is_some().then(|| self.module_files[module.idx()])
            }
            Op::FuncRef(func)
            | Op::Closure { func, .. }
            | Op::ClosureOnce { func, .. }
            | Op::CallDirect { func, .. } => match self.sources[func.idx()] {
                Source::Function { file, .. }
                | Source::DefaultConstructor { file, .. }
                | Source::ModuleNamespaceReader(file)
                | Source::ExportedObjectMember(file)
                | Source::ExportedObjectDefault(file, _)
                | Source::ExportVariablesReader(file) => Some(file),
                Source::EnumObject(sym)
                | Source::NamespaceObject(sym)
                | Source::Initializer(sym) => Some(sym.file),
                Source::Module(_)
                | Source::DynamicImport(..)
                | Source::Required(_)
                | Source::DynamicImportBody(..)
                | Source::ModuleBody(_)
                | Source::ModuleDriver(_)
                | Source::ModuleInner(_)
                | Source::ModuleTouch(_)
                | Source::ModuleSettling(_)
                | Source::FilesByPath(_)
                | Source::EvaluateByIndex(_)
                | Source::EvaluateSingleFile(..)
                | Source::NamespaceForHost(_)
                | Source::Validator(..) => None,
            },
            _ => None,
        };
        if let Some(file) = file {
            self.touch_module(fx, file);
        }
    }

    fn is_transparent_lazy_import(&self, file: FileId, imported: FileId) -> bool {
        self.is_lazily_evaluated(imported)
            && !self.has_lazy_module_state(imported)
            && !self.is_side_effect_import(file, imported)
    }

    fn lazy_module_dependencies(&self, lazy_module: FileId) -> &'c [(FileId, Dependency)] {
        let shared = self.shared;
        shared.lazy_module_dependencies[lazy_module.idx()].get_or_init(|| {
            let (mut found, mut walked) = (Vec::new(), FxHashSet::default());
            walked.insert(lazy_module);
            self.collect_dependencies_through_lazy(lazy_module, &mut walked, &mut found);
            let (mut seen, mut asked): (FxHashSet<FileId>, FxHashSet<Atom>) = Default::default();
            found.retain(|&(owner, dependency)| match dependency {
                Dependency::Module(imported) => seen.insert(imported),
                Dependency::External(specifier) => {
                    asked.insert(self.host_resolved_specifier(owner, specifier))
                }
            });
            found
        })
    }

    fn collect_dependencies_through_lazy(
        &self,
        file: FileId,
        walked: &mut FxHashSet<FileId>,
        found: &mut Vec<(FileId, Dependency)>,
    ) {
        for &dependency in self.cached_dependencies_of(file) {
            match dependency {
                Dependency::Module(imported) if self.is_transparent_lazy_import(file, imported) => {
                    if walked.insert(imported) {
                        self.collect_dependencies_through_lazy(imported, walked, found);
                    }
                }
                _ => found.push((file, dependency)),
            }
        }
    }

    fn cached_dependencies_of(&self, file: FileId) -> &'c [Dependency] {
        let shared = self.shared;
        shared.dependencies[file.idx()].get_or_init(|| self.dependencies_of(file))
    }

    fn load_graph(
        &self,
        roots: &[FileId],
        already_loaded: &LoadedGraph,
        loaded: &mut LoadedGraph,
        builtin_modules_in_order: &mut Vec<Atom>,
    ) {
        let mut pending: Vec<FileId> = roots.iter().rev().copied().collect();
        while let Some(file) = pending.pop() {
            if self.is_declaration_only(file)
                || already_loaded.files.contains(&file)
                || !loaded.files.insert(file)
            {
                continue;
            }
            let first_imported = pending.len();
            for &dependency in self.cached_dependencies_of(file) {
                match dependency {
                    Dependency::Module(imported) => pending.push(imported),
                    Dependency::External(specifier) => {
                        let specifier = self.host_specifier(specifier);
                        if imports::is_builtin_specifier(self.c.atoms().bytes(specifier))
                            && !already_loaded.builtin_modules.contains(&specifier)
                            && loaded.builtin_modules.insert(specifier)
                        {
                            builtin_modules_in_order.push(specifier);
                        }
                    }
                }
            }
            pending[first_imported..].reverse();
        }
    }

    fn loaded_by_every_entry_point(&self) -> &'c LoadedGraph {
        let shared = self.shared;
        shared.loaded_by_every_entry_point.get_or_init(|| {
            let mut common: Option<LoadedGraph> = None;
            for roots in shared.entry_points() {
                let mut loaded = LoadedGraph::default();
                self.load_graph(roots, &LoadedGraph::default(), &mut loaded, &mut Vec::new());
                common = Some(match common {
                    Some(common) => LoadedGraph {
                        files: &common.files & &loaded.files,
                        builtin_modules: &common.builtin_modules & &loaded.builtin_modules,
                    },
                    None => loaded,
                });
            }
            common.unwrap_or_default()
        })
    }

    fn builtin_modules_loaded_by_import(&self, imported: FileId) -> &'c [Atom] {
        let shared = self.shared;
        shared.builtin_modules_loaded_by_import[imported.idx()].get_or_init(|| {
            let mut in_order = Vec::new();
            self.load_graph(
                &[imported],
                self.loaded_by_every_entry_point(),
                &mut LoadedGraph::default(),
                &mut in_order,
            );
            in_order
        })
    }

    fn is_side_effect_import(&self, file: FileId, imported: FileId) -> bool {
        let hir = self.hir(file);
        hir.ids(hir.body).any(|stmt| match hir[stmt].kind {
            StmtKind::Import(import) => {
                let import = &hir[import];
                import.default.is_none()
                    && import.namespace.is_none()
                    && import.named.is_empty()
                    && self.imported_file(file, import.spec) == Some(imported)
            }
            _ => false,
        })
    }

    fn emit_raw(&mut self, fx: &mut Fx, op: Op) -> V {
        let op = if self.is_builtin_file(fx.file) {
            self.with_private_name(fx, op)
        } else {
            op
        };
        let op = self.coerce_operands(fx, op);
        let op = self.with_predicted_collection(fx, op);
        let ty = self.op_result_type(fx, &op);
        if let Op::New(layout) | Op::NewWith { layout, .. } = op {
            self.record_allocation(layout);
        }
        if let Op::NewWith { layout, .. } = op
            && let Some(&created) = self.layout_types.get(&layout)
        {
            self.c.record_object_created_with_discriminant(created);
        }
        let allocated_as = if fx.is_typed {
            None
        } else {
            self.allocated_as(&op, ty.id)
        };
        let value = fx.b.emit(
            op,
            if allocated_as.is_some() {
                self.out.tys.anything
            } else {
                ty.id
            },
        );
        if self.shared.constants.records_spans
            && let Some(&(Op::Coerce { value: held, .. } | Op::IterOpen(held))) =
                fx.b.func.op(value)
            && let Some(&span) = fx.last_spans.get(&held)
        {
            fx.first_spans.insert(value, span);
            fx.last_spans.insert(value, span);
        }
        if self.shared.constants.records_spans {
            let (receiver, stored) = match fx.b.func.op(value) {
                Some(
                    &(Op::PropSet {
                        obj, value: stored, ..
                    }
                    | Op::ElemSet {
                        obj, value: stored, ..
                    }),
                ) => (obj, stored),
                Some(&Op::PropDelete { obj, .. }) => (obj, V::NONE),
                Some(Op::Call { args, .. } | Op::CallMethod { args, .. }) => {
                    (args.first().copied().unwrap_or(V::NONE), V::NONE)
                }
                _ => (V::NONE, V::NONE),
            };
            for (operand, step) in [
                (receiver, crate::audit::RECEIVER),
                (stored, crate::audit::STORED),
            ] {
                if let Some(&span) = fx.last_spans.get(&operand) {
                    fx.operand_spans.push(ir::Span {
                        value,
                        start: span.start,
                        end: span.end,
                        step,
                    });
                }
            }
        }
        if let Some(allocated_as) = allocated_as {
            fx.b.func.values[value.idx()].set_prediction(allocated_as);
        }
        if ty.checked != TypeId::UNRESOLVED {
            fx.checked.insert(value, ty.checked);
        }
        value
    }

    pub(crate) fn operation(&mut self, fx: &mut Fx, which: Operation, args: &[V]) -> V {
        self.emit_throwing(
            fx,
            Op::Operation {
                which,
                args: args.iter().copied().collect(),
            },
        )
    }

    pub(crate) fn constant_key_name(&self, fx: &Fx, key: V) -> Option<StrId> {
        match fx.b.func.op(key) {
            Some(&Op::Str(name))
                if Self::is_field_name(self.out.strs.get(name))
                    && !matches!(
                        self.out.strs.get(name),
                        [b'-' | b'#', ..] | b"Infinity" | b"NaN"
                    ) =>
            {
                Some(name)
            }
            Some(&Op::Symbol(name)) => Some(name),
            _ => None,
        }
    }

    pub(crate) fn emit_throwing(&mut self, fx: &mut Fx, op: Op) -> V {
        let op = match op {
            Op::ElemGet { obj, key } => self
                .constant_key_name(fx, key)
                .map_or(Op::ElemGet { obj, key }, |name| Op::PropGet { obj, name }),
            Op::ElemDelete { obj, key } => {
                self.constant_key_name(fx, key)
                    .map_or(Op::ElemDelete { obj, key }, |name| Op::PropDelete {
                        obj,
                        name,
                    })
            }
            Op::ElemHas { obj, key } => match fx.b.func.op(key) {
                Some(&Op::Symbol(name)) => Op::PropHas { obj, name },
                _ => Op::ElemHas { obj, key },
            },
            Op::ToKey(key) if matches!(fx.b.func.op(key), Some(Op::Symbol(_))) => return key,
            op => op,
        };
        let v = self.emit(fx, op);
        if let Some(&handler) = fx.handlers.last() {
            let next = fx.b.new_block();
            fx.b.terminate(Term::Invoke {
                normal: ir::Target::new(next),
                unwind: ir::Target::new(handler),
            });
            fx.b.seal(next);
            fx.b.switch_to(next);
        }
        v
    }

    pub(crate) fn name_with_file(&mut self, what: &str, file: FileId) -> StrId {
        let path = self.files.module(file).file_name();
        let name = path.rsplit(|&byte| byte == b'/').next().unwrap_or(path);
        self.out
            .strs
            .intern(&[what.as_bytes(), b" ", name].concat())
    }

    pub(crate) fn evaluation_function(&mut self, file: FileId) -> Option<FuncId> {
        if let Some(&known) = self.evaluations.get(&file) {
            return Some(known);
        }
        if self.is_declaration_only(file) {
            return None;
        }
        let name = self.name_with_file("module", file);
        let module = self.module_of(file);
        let kind = if self.builtin_id(file).is_some() || self.is_async_module(file) {
            FuncKind::Plain
        } else {
            FuncKind::Module
        };
        let evaluation = self.add_func(name, module, 0, kind, Source::Module(file));
        if kind == FuncKind::Module || self.is_async_module(file) {
            self.out.funcs[evaluation.idx()].flags |= ir::func_flags::IS_HIDDEN_IN_STACK_TRACES;
        }
        self.evaluations.insert(file, evaluation);
        Some(evaluation)
    }

    pub(crate) fn has_separate_require_evaluation(&mut self, file: FileId) -> bool {
        let path = self.files.module(file).file_name();
        let is_unmarked_script =
            self.shared.constants.source_path_to_url.is_some() && self.c.is_unmarked_commonjs(file);
        self.builtin_id(file).is_none()
            && !self.is_async_module(file)
            && (self.is_commonjs(file)
                || path.ends_with(b".cjs")
                || path.ends_with(b".cts")
                || is_unmarked_script)
    }

    pub(crate) fn required_module_function(&mut self, file: FileId) -> FuncId {
        if let Some(&known) = self.require_evaluations.get(&file) {
            return known;
        }
        let name = self.name_with_file("module", file);
        let module = self.module_of(file);
        let marking = self.add_func(name, module, 0, FuncKind::Module, Source::Required(file));
        self.out.funcs[marking.idx()].flags |= ir::func_flags::IS_HIDDEN_IN_STACK_TRACES;
        self.require_evaluations.insert(file, marking);
        marking
    }

    pub(crate) fn require_evaluation_function(&mut self, file: FileId) -> Option<FuncId> {
        let evaluation = self.evaluation_function(file)?;
        if !self.has_separate_require_evaluation(file) {
            return Some(evaluation);
        }
        if let Some(&known) = self.require_evaluations.get(&file) {
            return Some(known);
        }
        let name = self.name_with_file("module", file);
        let module = self.module_of(file);
        let by_require = self.add_func(name, module, 0, FuncKind::Plain, Source::Required(file));
        self.out.funcs[by_require.idx()].flags |= ir::func_flags::IS_HIDDEN_IN_STACK_TRACES;
        self.require_evaluations.insert(file, by_require);
        Some(by_require)
    }

    pub(crate) fn body_of(&mut self, file: FileId) -> FuncId {
        if let Some(&known) = self.module_bodies.get(&file) {
            return known;
        }
        let name = self.name_with_file("module", file);
        let module = self.module_of(file);
        let is_async = self.is_async_module(file);
        let body = self.add_func(
            name,
            module,
            0,
            if is_async {
                FuncKind::Plain
            } else {
                FuncKind::Module
            },
            Source::ModuleBody(file),
        );
        if is_async {
            let has_await = self.has_top_level_await(file);
            self.out.funcs[body.idx()].flags |=
                ir::func_flags::IS_MODULE_BODY | if has_await { ir::func_flags::ASYNC } else { 0 };
        }
        if self.c.is_sloppy_function(file, bun_sema::hir::FnId::NONE) {
            self.out.funcs[body.idx()].flags |= ir::func_flags::IS_SLOPPY;
        }
        if self.is_commonjs(file) {
            self.out.funcs[body.idx()].flags |= ir::func_flags::HAS_EXPLICIT_NAME;
        }
        self.module_bodies.insert(file, body);
        body
    }

    fn module_inner(&mut self, file: FileId) -> FuncId {
        if let Some(&known) = self.module_inners.get(&file) {
            return known;
        }
        let name = self.name_with_file("module", file);
        let module = self.module_of(file);
        let inner = self.add_func(name, module, 0, FuncKind::Plain, Source::ModuleInner(file));
        self.out.funcs[inner.idx()].flags |= ir::func_flags::IS_HIDDEN_IN_STACK_TRACES;
        self.module_inners.insert(file, inner);
        inner
    }

    fn module_driver(&mut self, file: FileId) -> FuncId {
        if let Some(&known) = self.module_drivers.get(&file) {
            return known;
        }
        let name = self.name_with_file("module", file);
        let module = self.module_of(file);
        let driver = self.add_func(name, module, 0, FuncKind::Plain, Source::ModuleDriver(file));
        let is_async = self.has_top_level_await(file);
        self.out.funcs[driver.idx()].flags |= ir::func_flags::IS_HIDDEN_IN_STACK_TRACES
            | if is_async { ir::func_flags::ASYNC } else { 0 };
        self.module_drivers.insert(file, driver);
        driver
    }

    fn is_unresolved_import(&self, file: FileId, dependency: Dependency) -> bool {
        matches!(dependency, Dependency::External(specifier) if !self.is_resolved_by_bundler(file, specifier) && !imports::is_builtin_specifier(self.c.atoms().bytes(self.host_specifier(specifier))))
    }

    fn unresolved_imports(&self) -> FxHashMap<FileId, Vec<(FileId, Atom)>> {
        let mut found = FxHashMap::default();
        if self.shared.constants.source_path_to_url.is_none() || self.shared.bundle.is_none() {
            return found;
        }
        let modules = || {
            self.shared
                .modules
                .iter()
                .copied()
                .filter(|&file| !self.is_builtin_file(file))
        };
        if !modules().any(|file| {
            self.dependencies_of(file)
                .into_iter()
                .any(|dependency| self.is_unresolved_import(file, dependency))
        }) {
            return found;
        }
        let dependencies: FxHashMap<FileId, Vec<Dependency>> = modules()
            .map(|file| (file, self.dependencies_of(file)))
            .collect();
        let mut importers: FxHashMap<FileId, Vec<FileId>> = FxHashMap::default();
        let mut pending: Vec<FileId> = Vec::new();
        for (&file, of_file) in &dependencies {
            for &dependency in of_file {
                match dependency {
                    Dependency::Module(imported) => {
                        importers.entry(imported).or_default().push(file)
                    }
                    Dependency::External(_) if self.is_unresolved_import(file, dependency) => {
                        pending.push(file)
                    }
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
            self.collect_unresolved_imports(root, &dependencies, &reaching, &mut walked, &mut met);
            found.insert(root, met);
        }
        found
    }

    fn collect_unresolved_imports(
        &self,
        file: FileId,
        dependencies: &FxHashMap<FileId, Vec<Dependency>>,
        reaching: &FxHashSet<FileId>,
        walked: &mut FxHashSet<FileId>,
        met: &mut Vec<(FileId, Atom)>,
    ) {
        if !walked.insert(file) {
            return;
        }
        for &dependency in dependencies.get(&file).into_iter().flatten() {
            match dependency {
                Dependency::Module(imported) if reaching.contains(&imported) => {
                    self.collect_unresolved_imports(imported, dependencies, reaching, walked, met)
                }
                Dependency::External(specifier) if self.is_unresolved_import(file, dependency) => {
                    met.push((file, specifier))
                }
                _ => {}
            }
        }
    }

    fn emit_unresolved_import_resolution(&mut self, fx: &mut Fx, file: FileId) {
        let shared = self.shared;
        for &(importer, specifier) in shared.unresolved_imports.get(&file).into_iter().flatten() {
            let Some(path) = self.import_meta_path_constant(importer, b"path") else {
                continue;
            };
            let (path, resolve, specifier) = (
                self.out.strs.intern(&path),
                self.out.strs.intern(b"resolveSync"),
                self.str(specifier),
            );
            let path = self.emit(fx, Op::Str(path));
            let meta = self.operation(fx, Operation::GetImportMeta, &[path]);
            let specifier = self.emit(fx, Op::Str(specifier));
            self.emit_throwing(
                fx,
                Op::CallMethod {
                    obj: meta,
                    name: resolve,
                    args: [specifier].into_iter().collect(),
                },
            );
        }
    }

    fn json_modules_read_by_name(&self) -> FxHashSet<FileId> {
        let mut found = FxHashSet::default();
        if !self
            .shared
            .modules
            .iter()
            .any(|&file| self.hir(file).kind == FileKind::Json)
        {
            return found;
        }
        let runs_in_place = self.shared.constants.source_path_to_url.is_some();
        for &file in &self.shared.modules {
            let hir = self.hir(file);
            for used in hir.specifier_uses.iter().filter(|used| {
                matches!(
                    used.kind,
                    hir::SpecifierKind::Import | hir::SpecifierKind::ImportCall
                )
            }) {
                let Some(imported) = self
                    .imported_file(file, used.spec)
                    .filter(|&imported| self.hir(imported).kind == FileKind::Json)
                else {
                    continue;
                };
                let accepts_name = match used.kind {
                    hir::SpecifierKind::ImportCall => runs_in_place,
                    _ => hir.ids(hir.body).any(|stmt| match hir[stmt].kind {
                        StmtKind::Import(import) => {
                            let import = &hir[import];
                            import.spec == used.spec
                                && !import.type_only
                                && (import.namespace.is_some()
                                    || import.named.iter().any(|named| {
                                        hir[named].imported != bun_sema::atom::known::default
                                    }))
                        }
                        StmtKind::ExportNamed(export) => {
                            hir[export].spec == used.spec && !hir[export].type_only
                        }
                        StmtKind::ExportStar {
                            spec, type_only, ..
                        } => spec == used.spec && !type_only,
                        _ => false,
                    }),
                };
                if accepts_name {
                    found.insert(imported);
                }
            }
        }
        found
    }

    fn json_modules_loaded_whole(&self) -> FxHashSet<FileId> {
        let mut found = FxHashSet::default();
        if self.shared.json_modules_read_by_name.is_empty() {
            return found;
        }
        for file in (0..self.files.modules.len() as u32).map(FileId) {
            let loads = self.hir(file).specifier_uses.iter().filter(|used| {
                matches!(
                    used.kind,
                    hir::SpecifierKind::Require
                        | hir::SpecifierKind::RequireCall
                        | hir::SpecifierKind::ImportCall
                )
            });
            found.extend(
                loads
                    .filter_map(|used| self.required_file(file, used.spec))
                    .filter(|&loaded| self.hir(loaded).kind == FileKind::Json),
            );
        }
        found
    }

    fn deferred_import_modules(&self) -> FxHashSet<FileId> {
        let mut found = FxHashSet::default();
        for &file in &self.shared.modules {
            for import in self
                .hir(file)
                .imports
                .iter()
                .filter(|import| import.is_deferred && !import.type_only)
            {
                let Some(imported) = self.imported_file(file, import.spec) else {
                    continue;
                };
                let is_evaluated_eagerly = self.has_exports_object(imported)
                    || self.is_builtin_file(imported)
                    || self.shared.roots.contains(&imported)
                    || self.shared.prelude.contains(&imported)
                    || self.shared.async_modules.contains(&imported);
                if !is_evaluated_eagerly {
                    found.insert(imported);
                }
            }
        }
        found
    }

    fn dependencies_of(&self, file: FileId) -> Vec<Dependency> {
        let hir = self.hir(file);
        let mut specifiers = Vec::new();
        if let Some(runtime) = self.jsx_runtime(file)
            && hir
                .exprs
                .iter()
                .any(|e| matches!(e.kind, hir::ExprKind::Jsx(_)))
        {
            let key_name = self.c.atoms().lookup(b"key");
            let has_key_after_spread = |jsx: hir::JsxId| {
                let attributes = hir[jsx].attrs;
                let first_spread = attributes
                    .iter()
                    .position(|p| hir[p].kind == hir::PropKind::Spread);
                first_spread.is_some_and(|first| attributes.iter().skip(first).any(|p| hir[p].kind != hir::PropKind::Spread && matches!(hir[p].key, hir::PropKey::Name(name) if Some(name) == key_name)))
            };
            if hir
                .exprs
                .iter()
                .any(|e| matches!(e.kind, hir::ExprKind::Jsx(jsx) if !has_key_after_spread(jsx)))
            {
                specifiers.push((runtime, false));
            }
            if hir
                .exprs
                .iter()
                .any(|e| matches!(e.kind, hir::ExprKind::Jsx(jsx) if has_key_after_spread(jsx)))
            {
                let text = self.c.atoms().bytes(runtime);
                let package = text
                    .strip_suffix(b"/jsx-runtime")
                    .or_else(|| text.strip_suffix(b"/jsx-dev-runtime"))
                    .unwrap_or(text);
                specifiers.push((self.c.atoms().intern(package), false));
            }
        }
        for stmt in hir.ids(hir.body) {
            let specifier =
                match hir[stmt].kind {
                    StmtKind::Import(import)
                        if self.imported_text(file, hir[import].spec).is_some()
                            || self.import_attribute_type(file, hir[import].spec).is_some() =>
                    {
                        continue;
                    }
                    StmtKind::Import(import)
                        if hir[import].is_deferred
                            && self.imported_file(file, hir[import].spec).is_some_and(
                                |imported| self.shared.modules_deferred.contains(&imported),
                            ) =>
                    {
                        continue;
                    }
                    StmtKind::Import(import) if !hir[import].type_only => hir[import].spec,
                    StmtKind::ExportNamed(export) if !hir[export].type_only => hir[export].spec,
                    StmtKind::ExportStar {
                        spec,
                        type_only: false,
                        ..
                    } => spec,
                    _ => continue,
                };
            if specifier.is_some()
                && !(imports::is_type_only_statement(hir, stmt)
                    && !self.is_resolved_by_bundler(file, specifier))
            {
                specifiers.push((
                    specifier,
                    self.shared.bundle.is_none()
                        && matches!(hir[stmt].kind, StmtKind::Import(_))
                        && self.is_asset_import(file, stmt),
                ));
            }
        }
        let mut dependencies = Vec::new();
        for (specifier, is_asset) in specifiers {
            let text = self.c.atoms().bytes(specifier);
            if !is_asset
                && (text == b"bun:bundle"
                    || self.is_dropped_import(file, specifier)
                    || text.ends_with(b".d.ts"))
            {
                continue;
            }
            dependencies.push(
                match self.imported_file(file, specifier).filter(|_| !is_asset) {
                    Some(imported) => Dependency::Module(imported),
                    None => Dependency::External(specifier),
                },
            );
        }
        dependencies
    }

    fn report_module_graph(&mut self) -> (Vec<FileId>, FxHashSet<FileId>) {
        let (mut modules, mut edges, mut builtin_requires) = (Vec::new(), Vec::new(), Vec::new());
        let mut seen: FxHashSet<FileId> = FxHashSet::default();
        let mut pending = self.shared.roots.clone();
        pending.extend(&self.shared.prelude);
        pending.extend(self.shared.dynamically_loadable_runtime_helpers());
        pending.extend(self.shared.builtin_modules.iter().map(|module| module.1));
        pending.extend(
            self.shared
                .builtin_functions
                .list
                .iter()
                .map(|function| function.file),
        );
        let mut waiting: Vec<FileId> = Vec::new();
        while let Some(file) = pending.pop() {
            if self.is_declaration_only(file) || !seen.insert(file) {
                continue;
            }
            modules.push(file);
            if self.has_top_level_await(file) {
                waiting.push(file);
            }
            let hir = self.hir(file);
            let first = self
                .dependencies_of(file)
                .into_iter()
                .filter_map(|dependency| match dependency {
                    Dependency::Module(imported) => Some((imported, EvaluationTime::First)),
                    Dependency::External(_) => None,
                });
            let holders = self.c.create_require_result_variables(file);
            let symbols = &self.c.bound(file).expr_symbol;
            let created_requires: Vec<hir::ExprId> = hir
                .calls
                .iter()
                .map(|call| call.callee)
                .filter(|&callee| {
                    matches!(hir[callee].kind, hir::ExprKind::Ident(_))
                        && holders.contains(&symbols[callee.idx()])
                })
                .collect();
            let sources_by_file = |e: hir::ExprId| {
                let mut found = Vec::new();
                hir.specifier_choices(e, &mut found).then_some(found)
            };
            let on_demand = hir
                .exprs
                .iter()
                .enumerate()
                .filter_map(|(i, e)| match e.kind {
                    hir::ExprKind::ImportCall { args } => {
                        let is_in_function = self
                            .c
                            .enclosing_fn_of_expr(file, hir::ExprId(i as u32))
                            .is_some();
                        let argument = hir.ids(args).next()?;
                        Some((
                            sources_by_file(argument)?,
                            if is_in_function {
                                EvaluationTime::Later
                            } else {
                                EvaluationTime::DeferredFromModuleBody
                            },
                        ))
                    }
                    hir::ExprKind::Call(call) if hir.is_require_callee(hir[call].callee) => {
                        let is_in_function = self
                            .c
                            .enclosing_fn_of_expr(file, hir::ExprId(i as u32))
                            .is_some();
                        let argument = hir.ids(hir[call].args).next()?;
                        Some((
                            sources_by_file(argument)?,
                            if is_in_function {
                                EvaluationTime::Immediately
                            } else {
                                EvaluationTime::InModuleBody
                            },
                        ))
                    }
                    hir::ExprKind::Call(call)
                        if hir[call].args.len() == 1
                            && created_requires.contains(&hir[call].callee) =>
                    {
                        let is_in_function = self
                            .c
                            .enclosing_fn_of_expr(file, hir::ExprId(i as u32))
                            .is_some();
                        Some((
                            sources_by_file(hir.id_at(hir[call].args, 0))?,
                            if is_in_function {
                                EvaluationTime::Immediately
                            } else {
                                EvaluationTime::InModuleBody
                            },
                        ))
                    }
                    _ => None,
                });
            let on_demand = on_demand.flat_map(|(specifiers, how)| {
                specifiers
                    .into_iter()
                    .map(move |specifier| (specifier, how))
            });
            let required = hir.ids(hir.body).filter_map(|stmt| match hir[stmt].kind {
                StmtKind::ImportEquals(import) => match hir[import].target {
                    hir::ImportEqualsTarget::Require(specifier) if specifier.is_some() => {
                        Some((specifier, EvaluationTime::InModuleBody))
                    }
                    _ => None,
                },
                _ => None,
            });
            let file_named = |specifier: Atom, how: EvaluationTime| {
                if matches!(
                    how,
                    EvaluationTime::Immediately | EvaluationTime::InModuleBody
                ) {
                    self.required_file(file, specifier)
                } else {
                    self.imported_file(file, specifier)
                }
            };
            let on_demand: Vec<(Atom, FileId, EvaluationTime)> = on_demand
                .chain(required)
                .filter_map(|(specifier, how)| Some((specifier, file_named(specifier, how)?, how)))
                .collect();
            if self.is_builtin_file(file) {
                builtin_requires.extend(
                    on_demand
                        .iter()
                        .map(|&(specifier, imported, _)| ((file, specifier), imported)),
                );
            }
            let again = self
                .required_again_form(file)
                .map(|second| (second, EvaluationTime::Later));
            for (imported, how) in first
                .chain(
                    on_demand
                        .into_iter()
                        .map(|(_, imported, how)| (imported, how)),
                )
                .chain(again)
            {
                edges.push((file, imported, how));
                pending.push(imported);
            }
        }
        modules.sort_unstable();
        edges.sort_unstable();
        edges.dedup();
        let primitives = |defines: &Defines| {
            defines
                .values
                .iter()
                .filter(|(_, value)| value.is_primitive())
                .map(|(name, _)| name.clone())
                .collect()
        };
        self.c.set_defined_primitives(
            primitives(&self.shared.defines),
            primitives(&self.shared.builtin_defines),
        );
        self.c
            .set_module_graph(&modules, &edges, !waiting.is_empty());
        self.c.set_builtin_requires(builtin_requires);
        let mut importers: FxHashMap<FileId, Vec<FileId>> = FxHashMap::default();
        for &(importer, imported, how) in &edges {
            if how == EvaluationTime::First {
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

    pub(crate) fn is_lazy(&mut self, sym: Sym) -> bool {
        if let Some(&known) = self.lazy.get(&sym) {
            return known;
        }
        let file = sym.file;
        let is_lazy = self.shared.is_compiled(file)
            && !self.shared.is_prelude(file)
            && !self.is_builtin_file(file)
            && !self.has_exports_object(file)
            && !self.is_async_module(file)
            && self.c.is_lazy_variable(sym);
        self.lazy.insert(sym, is_lazy);
        is_lazy
    }

    fn lazy_variable_state(&mut self, sym: Sym) -> Option<GlobalId> {
        if let Some(&known) = self.lazy_variable_states.get(&sym) {
            return known;
        }
        let state = self.c.has_separate_state(sym).then(|| {
            let name = [
                self.c.atoms().bytes(self.files.symbol(sym).name),
                b" is initialized",
            ]
            .concat();
            let name = self.out.strs.intern(&name);
            let state = self.add_global(
                name,
                sym.file,
                Ty::NONE,
                GlobalKey::LazyVariableState(sym.file, sym.id),
            );
            self.out.globals[state.idx()].initialization = ir::Initialization::Undefined;
            state
        });
        self.lazy_variable_states.insert(sym, state);
        state
    }

    fn lazy_initializer(&mut self, sym: Sym) -> FuncId {
        if let Some(&known) = self.initializers.get(&sym) {
            return known;
        }
        let name = self.name_with_file("module", sym.file);
        let module = self.module_of(sym.file);
        let initializer =
            self.add_func(name, module, 0, FuncKind::Module, Source::Initializer(sym));
        self.initializers.insert(sym, initializer);
        if self.lazy_variable_state(sym).is_none() {
            let global = self.symbol_global(sym);
            let held = self.out.globals[global.idx()].declared;
            let created = self.strip_nullish(held);
            if created != held {
                self.out.funcs[initializer.idx()].result = created;
            }
        }
        initializer
    }

    pub(crate) fn lazy_declarations_in(&mut self, file: FileId) -> Rc<Vec<(u32, u32, Sym)>> {
        if let Some(known) = self.lazy_declarations.get(&file) {
            return known.clone();
        }
        let hir = self.hir(file);
        let mut found = Vec::new();
        for stmt in hir.ids(hir.body) {
            let hir::StmtKind::Var(decls) = hir[stmt].kind else {
                continue;
            };
            for d in decls.iter().filter(|&d| {
                hir[d].kind == hir::VarKind::Const
                    && hir[d].init.is_some()
                    && matches!(hir[hir[d].pat].kind, hir::PatKind::Ident(_))
            }) {
                let mut names = Vec::new();
                self.pattern_names(file, hir[d].pat, &mut names);
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

    pub(crate) fn lazy_variable_declared_at(&mut self, file: FileId, pos: u32) -> Option<Sym> {
        let declarations = self.lazy_declarations_in(file);
        let next = declarations.partition_point(|&(start, ..)| start <= pos);
        declarations[..next]
            .last()
            .filter(|&&(_, end, _)| pos < end)
            .map(|&(.., sym)| sym)
    }

    pub(crate) fn read_lazy_variable(
        &mut self,
        fx: &mut Fx,
        global: GlobalId,
        sym: Sym,
        may_be_early: bool,
    ) -> V {
        self.touch_module(fx, sym.file);
        if let Some(&(_, value)) = fx
            .initialized_before_loops
            .iter()
            .find(|&&(known, _)| known == global)
        {
            return value;
        }
        let found = self.emit_raw(fx, Op::GlobalGet(global));
        if self.initializers.get(&sym) == Some(&fx.id) {
            return found;
        }
        let is_known = match fx.known_initialized.get(&global) {
            Some(&known) => known,
            None => {
                let is_known = fx.b.new_var(self.known.boolean);
                fx.b.set_var_initial_value(is_known, Op::Bool(false), self.known.no);
                fx.known_initialized.insert(global, is_known);
                is_known
            }
        };
        if fx.true_value.is_none() {
            fx.true_value = fx.b.entry_constant(Op::Bool(true), self.known.yes);
        }
        if fx.b.read(is_known) == fx.true_value {
            return found;
        }
        let func = self.lazy_initializer(sym);
        let read_as = self.ty(fx, found);
        let created = self.out.funcs[func.idx()].result;
        let is_announced = created.is_some() && self.strip_nullish(read_as) == created;
        let value = fx.b.new_var(if is_announced { created } else { read_as });
        let is_missing = self.emit(fx, Op::IsNullish(found));
        let (initialize, done) = (fx.b.new_block(), fx.b.new_block());
        if is_announced {
            let present = fx.b.new_block();
            self.branch(fx, is_missing, initialize, present);
            fx.b.seal(present);
            fx.b.switch_to(present);
            let held = self.emit_throwing(
                fx,
                Op::Coerce {
                    value: found,
                    to: created,
                    why: ir::CoerceReason::NonNull(StrId::NONE),
                },
            );
            fx.b.write(value, held);
            fx.b.jump(done);
        } else {
            fx.b.write(value, found);
            self.branch(fx, is_missing, initialize, done);
        }
        fx.b.seal(initialize);
        fx.b.switch_to(initialize);
        let state = self.lazy_variable_state(sym);
        if let Some(state) = state {
            let state = self.emit_raw(fx, Op::GlobalGet(state));
            let is_there = self.emit(
                fx,
                Op::StrictEq {
                    a: state,
                    b: fx.true_value,
                },
            );
            let is_not = fx.b.new_block();
            self.branch(fx, is_there, done, is_not);
            fx.b.seal(is_not);
            fx.b.switch_to(is_not);
            self.emit_throw_if_tdz(fx, sym, state);
        } else if may_be_early && !self.c.is_never_read_uninitialized(sym) {
            self.emit_throw_if_tdz(fx, sym, found);
        }
        let produced = self.emit_throwing(
            fx,
            Op::CallDirect {
                func,
                args: ir::Args::new(),
            },
        );
        let stored = if is_announced {
            produced
        } else {
            self.emit_raw(fx, Op::GlobalGet(global))
        };
        fx.b.write(value, stored);
        fx.b.jump(done);
        fx.b.seal(done);
        fx.b.switch_to(done);
        fx.b.write(is_known, fx.true_value);
        fx.b.read(value)
    }

    pub(crate) fn lazy_function_for_ident(
        &mut self,
        fx: &Fx,
        e: hir::ExprId,
    ) -> Option<(Sym, FuncId)> {
        let hir::ExprKind::Ident(name) = self.hir(fx.file)[e].kind else {
            return None;
        };
        let sym = self.ident_symbol(fx.file, e, name)?;
        let sym = self
            .copied_export(sym)
            .filter(|&exported| self.has_declared_export_type(fx, e, exported))
            .unwrap_or(sym);
        Some((sym, self.lazy_function_for_symbol(fx, sym)?))
    }

    pub(crate) fn lazy_function_for_symbol(&mut self, fx: &Fx, sym: Sym) -> Option<FuncId> {
        if !self.is_lazy(sym) {
            return None;
        }
        let (file, d) = self.c.lazy_variable_declaration(sym)?;
        let hir = self.hir(file);
        let hir::ExprKind::Fn(func) = hir[hir[d].init].kind else {
            return None;
        };
        if hir[func].kind != hir::FnKind::Arrow && hir[func].name.is_some() {
            return None;
        }
        if let hir::PatKind::Ident(name) = hir[hir[d].pat].kind
            && hir[func].name.is_none()
        {
            let name = self.str(name);
            self.inferred_function_names
                .entry((file, func))
                .or_insert(name);
        }
        let id = self.function_of_declaration(fx, file, func)?;
        self.captures
            .get(&id)
            .is_none_or(|captures| captures.is_empty())
            .then_some(id)
    }

    pub(crate) fn emit_lazy_tdz_check(&mut self, fx: &mut Fx, sym: Sym, e: hir::ExprId) {
        if self.c.is_never_read_uninitialized(sym) || !self.may_be_in_tdz(fx, sym, e) {
            return;
        }
        let global = match self.lazy_variable_state(sym) {
            Some(state) => state,
            None => self.symbol_global(sym),
        };
        self.touch_module(fx, sym.file);
        let found = self.emit_raw(fx, Op::GlobalGet(global));
        self.emit_throw_if_tdz(fx, sym, found);
    }

    fn emit_throw_if_tdz(&mut self, fx: &mut Fx, sym: Sym, found: V) {
        let undefined = self.emit(fx, Op::Undefined);
        let is_early = self.emit(
            fx,
            Op::StrictEq {
                a: found,
                b: undefined,
            },
        );
        let (early, due) = (fx.b.new_block(), fx.b.new_block());
        self.branch(fx, is_early, early, due);
        fx.b.seal(early);
        fx.b.seal(due);
        fx.b.switch_to(early);
        let name = self.c.atoms().bytes(self.files.symbol(sym).name).to_vec();
        let message = if self.shared.constants.minifies_identifiers {
            [&[crate::names::TDZ_MARKER][..], &name].concat()
        } else {
            crate::names::tdz_error_message(&name)
        };
        self.throw_error(fx, b"ReferenceError", &message);
        fx.b.switch_to(due);
    }

    pub(crate) fn emit_tdz_check(&mut self, fx: &mut Fx, e: hir::ExprId) {
        self.emit_default_export_tdz_check(fx, e);
        let hir::ExprKind::Ident(name) = self.hir(fx.file)[e].kind else {
            return;
        };
        let Some(named) = self.ident_symbol(fx.file, e, name) else {
            return;
        };
        fx.b.pos = self.hir(fx.file)[e].pos;
        if self.is_lazy(named) {
            self.emit_lazy_tdz_check(fx, named, e);
        } else if let Some((file, bun_sema::bind::Decl::Class(class))) =
            self.value_declaration(named)
        {
            self.emit_class_tdz_check(fx, file, class, e);
        } else if self.may_be_in_tdz(fx, named, e) {
            self.read_reference(fx, named, e);
        }
    }

    pub(crate) fn declare_lazy_variable(&mut self, fx: &mut Fx, sym: Sym) {
        let global = self.symbol_global(sym);
        self.lazy_initializer(sym);
        for &named in self.c.names_initialized_at_declaration(sym).iter() {
            self.mark_lazy_initialized(fx, named);
        }
        if let Some(state) = self.lazy_variable_state(sym) {
            let due = self.emit(fx, Op::Bool(false));
            self.emit(fx, Op::GlobalSet(state, due));
        } else if !self.c.is_never_read_uninitialized(sym) {
            let due = self.emit(fx, Op::Null);
            self.emit(fx, Op::GlobalSet(global, due));
        }
    }

    fn mark_lazy_initialized(&mut self, fx: &mut Fx, named: Sym) {
        let named = self.value_symbol(named);
        if self.is_lazy(named) {
            self.emit_lazy_tdz_check(fx, named, hir::ExprId::NONE);
        } else if let Some((file, bun_sema::bind::Decl::Class(class))) =
            self.value_declaration(named)
        {
            self.emit_class_tdz_check(fx, file, class, hir::ExprId::NONE);
        } else if self.may_be_in_tdz(fx, named, hir::ExprId::NONE) {
            let pos = fx.b.pos;
            self.read_sym(fx, named, pos);
        }
    }

    fn emit_initializer(&mut self, fx: &mut Fx, sym: Sym) {
        let Some((file, d)) = self.c.lazy_variable_declaration(sym) else {
            return;
        };
        let decl = self.hir(file)[d];
        fx.b.pos = decl.loc.pos;
        self.symbol_global(sym);
        let state = self.lazy_variable_state(sym);
        if let Some(state) = state {
            let in_progress = self.emit(fx, Op::Undefined);
            self.emit(fx, Op::GlobalSet(state, in_progress));
        }
        let value = self.initial_value(fx, &decl);
        self.bind_pat(fx, decl.pat, value);
        if let Some(state) = state {
            let there = self.emit(fx, Op::Bool(true));
            self.emit(fx, Op::GlobalSet(state, there));
        }
        let created = self.out.funcs[fx.id.idx()].result;
        if created.is_some() {
            let global = self.symbol_global(sym);
            let stored = self.emit_raw(fx, Op::GlobalGet(global));
            let held = if self.ty(fx, stored) == created {
                stored
            } else {
                self.emit_throwing(
                    fx,
                    Op::Coerce {
                        value: stored,
                        to: created,
                        why: ir::CoerceReason::NonNull(StrId::NONE),
                    },
                )
            };
            self.terminate_with_return(fx, held);
        }
    }

    fn lazy_variable_uses(&mut self) -> Rc<Vec<(u32, FnId, Sym)>> {
        if let Some(known) = &self.lazy_uses {
            return known.clone();
        }
        let file = self.file;
        let (hir, bound) = (self.hir(file), self.c.bound(file));
        let mut uses = Vec::new();
        let mut is_lazy_by_symbol: Vec<Option<bool>> = vec![None; bound.symbols.len()];
        for (i, e) in hir.exprs.iter().enumerate() {
            let hir::ExprKind::Ident(name) = e.kind else {
                continue;
            };
            let (e, pos) = (hir::ExprId(i as u32), e.pos);
            if matches!(bound.expr_parent[e.idx()], bun_sema::bind::Parent::None)
                || bound.is_in_type_query(e)
            {
                continue;
            }
            let Some(sym) = self.ident_symbol(file, e, name) else {
                continue;
            };
            let is_lazy = match is_lazy_by_symbol
                .get(sym.id.idx())
                .copied()
                .flatten()
                .filter(|_| sym.file == file)
            {
                Some(known) => known,
                None => {
                    let found = self.is_lazy(sym);
                    if sym.file == file {
                        is_lazy_by_symbol[sym.id.idx()] = Some(found);
                    }
                    found
                }
            };
            if is_lazy {
                uses.push((pos, self.enclosing_function(file, e), sym));
            }
        }
        uses.sort_unstable_by_key(|&(pos, ..)| pos);
        let uses = Rc::new(uses);
        self.lazy_uses = Some(uses.clone());
        uses
    }

    fn lazy_module_uses(&mut self) -> Rc<Vec<(u32, FnId, FileId, u32)>> {
        if let Some(known) = &self.lazy_module_uses {
            return known.clone();
        }
        let file = self.file;
        let (hir, bound) = (self.hir(file), self.c.bound(file));
        let mut uses = Vec::new();
        for (i, e) in hir.exprs.iter().enumerate() {
            let hir::ExprKind::Ident(name) = e.kind else {
                continue;
            };
            let (e, pos) = (hir::ExprId(i as u32), e.pos);
            if matches!(bound.expr_parent[e.idx()], bun_sema::bind::Parent::None)
                || bound.is_in_type_query(e)
            {
                continue;
            }
            let Some(sym) = self.ident_symbol(file, e, name) else {
                continue;
            };
            if sym.file != file && self.is_lazily_evaluated(sym.file) {
                uses.push((pos, self.enclosing_function(file, e), sym.file, 0));
            }
        }
        uses.sort_unstable_by_key(|&(pos, ..)| pos);
        let mut tries: Vec<(u32, u32)> = hir
            .stmts
            .iter()
            .filter(|stmt| matches!(stmt.kind, StmtKind::Try { .. }))
            .map(|stmt| (stmt.start, stmt.loc.end))
            .collect();
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
        self.lazy_module_uses = Some(uses.clone());
        uses
    }

    pub(crate) fn initialize_before_loop(&mut self, fx: &mut Fx, start: u32, end: u32) {
        if fx.file != self.file {
            return;
        }
        if !self.shared.lazy_modules.is_empty() {
            let uses = self.lazy_module_uses();
            let first = uses.partition_point(|&(pos, ..)| pos < start);
            let running = fx.func;
            let in_loop = || {
                uses[first..]
                    .iter()
                    .take_while(|&&(pos, ..)| pos < end)
                    .filter(move |&&(_, by, ..)| by == running)
            };
            let is_inside_try: Vec<FileId> = in_loop()
                .filter(|&&(.., innermost_try)| innermost_try > start)
                .map(|&(_, _, module, _)| module)
                .collect();
            for &(_, _, module, _) in in_loop() {
                if !is_inside_try.contains(&module)
                    && !fx.modules_touched_before_loops.contains(&module)
                {
                    self.touch_module(fx, module);
                    fx.modules_touched_before_loops.push(module);
                }
            }
        }
        let uses = self.lazy_variable_uses();
        let first = uses.partition_point(|&(pos, ..)| pos < start);
        for &(_, by, sym) in uses[first..].iter().take_while(|&&(pos, ..)| pos < end) {
            if by != fx.func
                || !self.c.is_never_read_uninitialized(sym)
                || self.c.runs_code_when_initialized(sym)
            {
                continue;
            }
            let global = self.symbol_global(sym);
            if !fx
                .initialized_before_loops
                .iter()
                .any(|&(known, _)| known == global)
            {
                self.read_lazy_variable(fx, global, sym, false);
                let value = self.emit_raw(fx, Op::GlobalGet(global));
                fx.initialized_before_loops.push((global, value));
            }
        }
    }

    fn emit_dependencies(&mut self, fx: &mut Fx, file: FileId) {
        self.emit_unresolved_import_resolution(fx, file);
        let hir = self.hir(file);
        let mut declared_types: Vec<(Atom, Option<Atom>)> = Vec::new();
        for stmt in hir.ids(hir.body) {
            let specifier = match hir[stmt].kind {
                StmtKind::Import(import) => hir[import].spec,
                StmtKind::ExportNamed(export) => hir[export].spec,
                StmtKind::ExportStar { spec, .. } => spec,
                _ => continue,
            };
            if !hir.import_attributes.is_empty()
                && self.shared.bundle.is_some()
                && matches!(hir[stmt].kind, StmtKind::Import(import) if !hir[import].type_only)
            {
                let said = self.type_attribute(file, stmt);
                match declared_types.iter().find(|known| known.0 == specifier) {
                    Some(known) if known.1 != said => self.problem(
                        file,
                        hir[stmt].start,
                        "two imports of one file in one module that do not say the same `type`",
                    ),
                    Some(_) => {}
                    None => declared_types.push((specifier, said)),
                }
                if self.import_attribute_type(file, specifier).is_some()
                    && !self.is_dropped_import(file, specifier)
                {
                    self.emit_asset_value(fx, file, specifier, b"");
                }
            }
            if self.is_dropped_import(file, specifier) {
                self.dropped.push((hir[stmt].start, hir[stmt].loc.end));
            }
        }
        let importer = file;
        let mut in_order: Vec<(FileId, Dependency)> = Vec::new();
        for &dependency in self.cached_dependencies_of(importer) {
            match dependency {
                Dependency::Module(imported)
                    if self.is_transparent_lazy_import(importer, imported) =>
                {
                    in_order.extend_from_slice(self.lazy_module_dependencies(imported))
                }
                _ => in_order.push((importer, dependency)),
            }
        }
        let (mut seen, mut asked): (FxHashSet<FileId>, FxHashSet<Atom>) = Default::default();
        in_order.retain(|&(owner, dependency)| match dependency {
            Dependency::Module(imported) => seen.insert(imported) || owner == importer,
            Dependency::External(specifier) => {
                asked.insert(self.host_resolved_specifier(owner, specifier)) || owner == importer
            }
        });
        for (file, dependency) in in_order {
            let is_importer = file == importer;
            match dependency {
                Dependency::Module(imported) => {
                    if let Some(func) = self.evaluation_function(imported) {
                        let func = if self.is_async_module(imported) {
                            self.module_inner(imported)
                        } else {
                            func
                        };
                        self.emit_throwing(
                            fx,
                            Op::CallDirect {
                                func,
                                args: ir::Args::new(),
                            },
                        );
                        if self.is_async_module(imported) {
                            let (module, required) = (
                                self.module_record_global(file),
                                self.module_record_global(imported),
                            );
                            let (module, required) = (
                                self.emit(fx, Op::GlobalGet(module)),
                                self.emit(fx, Op::GlobalGet(required)),
                            );
                            self.operation(
                                fx,
                                Operation::DidEvaluateRequiredModule,
                                &[module, required],
                            );
                        }
                    }
                    if self.has_lazy_module_state(imported)
                        && self.is_side_effect_import(file, imported)
                    {
                        let func =
                            self.deferred_module_function(imported, Source::ModuleTouch(imported));
                        self.emit_throwing(
                            fx,
                            Op::CallDirect {
                                func,
                                args: ir::Args::new(),
                            },
                        );
                    }
                    if is_importer
                        && self.shared.constants.source_path_to_url.is_none()
                        && !self.has_export_variables(imported)
                        && self.is_namespace_used_as_value(file, imported)
                    {
                        self.exported_object_namespace(fx, file, imported);
                    }
                    if self.is_read_through_host(imported) {
                        self.host_namespace(fx, imported);
                    }
                }
                Dependency::External(specifier) => {
                    let hir = self.hir(file);
                    let is_import_call = |stmt: &hir::StmtId| match hir[*stmt].kind {
                        StmtKind::Import(import) => hir[import].spec == specifier,
                        StmtKind::ExportNamed(export) => hir[export].spec == specifier,
                        StmtKind::ExportStar { spec, .. } => spec == specifier,
                        _ => false,
                    };
                    let stmt = hir.ids(hir.body).find(is_import_call);
                    let pos = stmt.map_or(0, |stmt| hir[stmt].start);
                    if !is_importer {
                    } else if self.shared.constants.source_path_to_url.is_none()
                        && self.is_bundle_only_import(file, specifier)
                    {
                        self.problem(file, pos, "an import of a file that is neither code nor data the bundler can inline");
                    } else if self.shared.bundle.is_some()
                        && stmt.is_some_and(|stmt| self.is_asset_import(file, stmt))
                    {
                        self.problem(
                            file,
                            pos,
                            "an import `with { type: .. }` of a file that is not in the bundle",
                        );
                    }
                    let (module, unproven) = if is_importer {
                        self.unproven_builtin_imports(file, specifier)
                    } else {
                        (&b""[..], Vec::new())
                    };
                    let global = self.external_module_global_in(importer, file, specifier);
                    self.load_external_module(fx, global, file, specifier);
                    for (name, is_reexported) in unproven {
                        let namespace = self.emit(fx, Op::GlobalGet(global));
                        let bundle_name = if self.shared.constants.source_path_to_url.is_none() {
                            module.strip_prefix(b"node:").unwrap_or(module)
                        } else {
                            module
                        };
                        let message = match is_reexported {
                            true => [
                                &b"export '"[..],
                                self.c.atoms().bytes(name),
                                b"' not found in '",
                                bundle_name,
                                b"'",
                            ]
                            .concat(),
                            false => [
                                &b"Export named '"[..],
                                self.c.atoms().bytes(name),
                                b"' not found in module '",
                                module,
                                b"'.",
                            ]
                            .concat(),
                        };
                        let key = self.str(name);
                        let key = self.emit(fx, Op::Str(key));
                        let is_exported = self.emit_throwing(
                            fx,
                            Op::ElemHas {
                                obj: namespace,
                                key,
                            },
                        );
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

    fn module_record_global(&mut self, file: FileId) -> GlobalId {
        let name = self.out.strs.intern(b"record");
        let record = self.add_global(
            name,
            file,
            Ty::NONE,
            GlobalKey::ModuleInternal(file, "record"),
        );
        self.out.globals[record.idx()].initialization = ir::Initialization::Undefined;
        record
    }

    fn emit_module_record(&mut self, fx: &mut Fx, file: FileId) -> V {
        let record = self.module_record_global(file);
        let known = self.emit(fx, Op::GlobalGet(record));
        let undefined = self.emit(fx, Op::Undefined);
        let is_missing = self.emit(
            fx,
            Op::StrictEq {
                a: known,
                b: undefined,
            },
        );
        let (first, there) = (fx.b.new_block(), fx.b.new_block());
        self.branch(fx, is_missing, first, there);
        fx.b.seal(first);
        fx.b.switch_to(first);
        let has_await = self.has_top_level_await(file);
        let has_await = self.emit(fx, Op::Bool(has_await));
        let driver = self.module_driver(file);
        let driver = self.emit(fx, Op::FuncRef(driver));
        let created = self.operation(fx, Operation::NewModuleRecord, &[has_await, driver]);
        self.emit(fx, Op::GlobalSet(record, created));
        fx.b.jump(there);
        fx.b.seal(there);
        fx.b.switch_to(there);
        self.emit(fx, Op::GlobalGet(record))
    }

    fn emit_evaluate(&mut self, fx: &mut Fx, file: FileId, ticket: V) -> V {
        let record = self.emit_module_record(fx, file);
        let inner = self.module_inner(file);
        let inner = self.emit(fx, Op::FuncRef(inner));
        let ticket = if ticket.is_none() {
            self.emit(fx, Op::Undefined)
        } else {
            ticket
        };
        let promise = self.operation(fx, Operation::EvaluateModule, &[record, inner, ticket]);
        let name = self.out.strs.intern(b"evaluation");
        let evaluation = self.add_global(
            name,
            file,
            Ty::NONE,
            GlobalKey::ModuleInternal(file, "evaluation"),
        );
        self.out.globals[evaluation.idx()].initialization = ir::Initialization::Undefined;
        self.emit(fx, Op::GlobalSet(evaluation, promise));
        promise
    }

    fn emit_inner_module_evaluation(&mut self, fx: &mut Fx, file: FileId) {
        let record = self.emit_module_record(fx, file);
        let enters = self.operation(fx, Operation::EnterModule, &[record]);
        let (evaluate, done) = (fx.b.new_block(), fx.b.new_block());
        self.branch(fx, enters, evaluate, done);
        fx.b.seal(evaluate);
        fx.b.seal(done);
        fx.b.switch_to(done);
        self.terminate_with_return(fx, V::NONE);
        fx.b.switch_to(evaluate);
        self.emit_dependencies(fx, file);
        self.operation(fx, Operation::LeaveModule, &[record]);
    }

    fn emit_module_driver(&mut self, fx: &mut Fx, file: FileId) {
        let body = self.body_of(file);
        if !self.has_top_level_await(file) {
            self.emit_throwing(
                fx,
                Op::CallDirect {
                    func: body,
                    args: ir::Args::new(),
                },
            );
            self.emit_evaluation_finished(fx, file, false);
            return;
        }
        let record = self.module_record_global(file);
        let rejected = fx.b.new_block();
        fx.handlers.push(rejected);
        let promise = self.emit_throwing(
            fx,
            Op::CallDirect {
                func: body,
                args: ir::Args::new(),
            },
        );
        let module = self.emit(fx, Op::GlobalGet(record));
        self.operation(fx, Operation::DidStartModuleBody, &[module, promise]);
        self.emit_throwing(fx, Op::Await(promise));
        fx.handlers.pop();
        self.emit_evaluation_finished(fx, file, false);
        let module = self.emit(fx, Op::GlobalGet(record));
        self.operation(fx, Operation::AsyncModuleExecutionFulfilled, &[module]);
        self.terminate_with_return(fx, V::NONE);
        fx.b.seal(rejected);
        fx.b.switch_to(rejected);
        let error = self.emit(fx, Op::Caught);
        self.emit_evaluation_finished(fx, file, true);
        let module = self.emit(fx, Op::GlobalGet(record));
        self.operation(
            fx,
            Operation::AsyncModuleExecutionRejected,
            &[module, error],
        );
    }

    fn emit_dynamic_import(&mut self, fx: &mut Fx, file: FileId, is_node_mode: bool, ticket: V) {
        for &specifier in self.builtin_modules_loaded_by_import(file) {
            let global = self.external_module_global(file, specifier);
            self.load_external_module(fx, global, file, specifier);
        }
        let undefined = self.emit(fx, Op::Undefined);
        self.emit_throwing(fx, Op::Await(undefined));
        let later_roots: Vec<FileId> = self
            .shared
            .entry_points()
            .iter()
            .filter(|roots| roots.first() == Some(&file))
            .flat_map(|roots| roots[1..].iter().rev().copied())
            .collect();
        for root in later_roots.into_iter().filter(|&root| root != file) {
            if !self.is_async_module(root) {
                continue;
            }
            let name = self.out.strs.intern(b"evaluation");
            let evaluation = self.add_global(
                name,
                root,
                Ty::NONE,
                GlobalKey::ModuleInternal(root, "evaluation"),
            );
            self.out.globals[evaluation.idx()].initialization = ir::Initialization::Undefined;
            let promise = self.emit(fx, Op::GlobalGet(evaluation));
            let undefined = self.emit(fx, Op::Undefined);
            let is_not_started = self.emit(
                fx,
                Op::StrictEq {
                    a: promise,
                    b: undefined,
                },
            );
            let (started, next) = (fx.b.new_block(), fx.b.new_block());
            self.branch(fx, is_not_started, next, started);
            fx.b.seal(started);
            fx.b.switch_to(started);
            self.emit_throwing(fx, Op::Await(promise));
            fx.b.jump(next);
            fx.b.seal(next);
            fx.b.switch_to(next);
        }
        if let Some(func) = self.evaluation_function(file) {
            if self.is_async_module(file) {
                let promise = self.emit_evaluate(fx, file, ticket);
                self.emit_throwing(fx, Op::Await(promise));
            } else {
                self.emit_throwing(
                    fx,
                    Op::CallDirect {
                        func,
                        args: ir::Args::new(),
                    },
                );
            }
        }
        if self.has_lazy_module_state(file) {
            let func = self.deferred_module_function(file, Source::ModuleTouch(file));
            self.emit_throwing(
                fx,
                Op::CallDirect {
                    func,
                    args: ir::Args::new(),
                },
            );
        }
        let namespace = if self.c.module_with_export_variables(file).is_some() {
            self.emit(fx, Op::NewObject)
        } else if self.has_exports_object(file) {
            self.exported_object_namespace_as(fx, is_node_mode, file)
        } else {
            self.read_sym(fx, self.files.file_symbol(file), 0)
        };
        self.terminate_with_return(fx, namespace);
    }

    fn emit_dynamic_import_with_ticket(&mut self, fx: &mut Fx, file: FileId, is_node_mode: bool) {
        let importing = self.program_global("importing");
        let importer = self.emit(fx, Op::GlobalGet(importing));
        let undefined = self.emit(fx, Op::Undefined);
        self.emit(fx, Op::GlobalSet(importing, undefined));
        let ticket = self.operation(fx, Operation::NewImportTicket, &[importer]);
        let func = self.dynamic_import_body_function(file, is_node_mode);
        let promise = self.emit_throwing(
            fx,
            Op::CallDirect {
                func,
                args: [ticket].into_iter().collect(),
            },
        );
        self.operation(fx, Operation::SetImportPromise, &[ticket, promise]);
        self.terminate_with_return(fx, promise);
    }

    pub(crate) fn program_global(&mut self, name: &'static str) -> GlobalId {
        let root = self.shared.roots()[0];
        let interned = self.out.strs.intern(name.as_bytes());
        let variable = self.add_global(
            interned,
            root,
            Ty::NONE,
            GlobalKey::ModuleInternal(root, name),
        );
        self.out.globals[variable.idx()].initialization = ir::Initialization::Undefined;
        variable
    }

    pub(crate) fn emit_importer(&mut self, fx: &mut Fx, imported: FileId, is_importing: bool) {
        if self.is_async_module(fx.file) && self.is_async_module(imported) {
            let importing = self.program_global("importing");
            let record = self.module_record_global(fx.file);
            let record = self.emit(
                fx,
                if is_importing {
                    Op::GlobalGet(record)
                } else {
                    Op::Undefined
                },
            );
            self.emit(fx, Op::GlobalSet(importing, record));
        }
    }

    pub(crate) fn skips_host_module_object(&mut self, file: FileId) -> bool {
        self.is_commonjs(file)
            && self.has_export_variables(file)
            && !self.has_lazy_module_state(file)
            && !self.is_required_again_form(file)
            && self.c.is_value_only_module(file)
    }

    fn emit_statements(&mut self, fx: &mut Fx, file: FileId) {
        if self.is_commonjs(file) {
            self.emit_commonjs_prologue(fx, file);
        }
        if self.host_may_request_modules()
            && !self.is_builtin_file(file)
            && self.c.references_module_cache_alias(file)
        {
            self.emit_mark_require_cache_read(fx, file);
        }
        if self.hir(file).kind != FileKind::Json {
            let body = self.hir(file).body;
            self.enters_module_body = !self.is_async_module(file);
            self.block_body(fx, body);
        }
        if self.is_commonjs(file) && !self.skips_host_module_object(file) {
            self.emit_commonjs_epilogue(fx, file);
        }
    }

    fn has_top_level_await(&self, file: FileId) -> bool {
        let (hir, bound) = (self.hir(file), self.c.bound(file));
        let in_expressions = hir.exprs.iter().enumerate().any(|(i, e)| {
            matches!(e.kind, hir::ExprKind::Await(_))
                && bound.expr_parent[i] != bun_sema::bind::Parent::None
                && self
                    .c
                    .enclosing_fn_of_expr(file, hir::ExprId(i as u32))
                    .is_none()
        });
        let stmt_parent = &bound.stmt_parent;
        let in_statements = hir.stmts.iter().enumerate().any(|(i, stmt)| {
            let awaits = match stmt.kind {
                StmtKind::ForOf { is_await, .. } => is_await,
                StmtKind::Var(decls) => decls
                    .iter()
                    .any(|d| hir[d].kind == hir::VarKind::AwaitUsing),
                _ => false,
            };
            awaits
                && stmt_parent[i] != bun_sema::bind::Parent::None
                && self.c.enclosing_fn(file, stmt_parent[i]).is_none()
        });
        in_expressions || in_statements
    }

    fn is_async_module(&self, file: FileId) -> bool {
        self.shared.async_modules.contains(&file)
    }

    pub(crate) fn module_of(&mut self, file: FileId) -> ModuleId {
        if let Some(&known) = self.modules.get(&file) {
            return known;
        }
        if !self.shared.is_compiled(file) {
            return ModuleId::NONE;
        }
        let module = ModuleId::new(self.module_files.len());
        self.module_files.push(file);
        self.modules.insert(file, module);
        module
    }

    pub(crate) fn retain_type(&mut self, ty: TypeId) -> Identity {
        self.c.keep_type(ty);
        self.c.type_identity(ty)
    }

    pub(crate) fn next_environment_key(&mut self) -> LayoutKey {
        self.environments += 1;
        LayoutKey::Environment(self.file, self.environments - 1)
    }

    pub(crate) fn next_hidden_variable_key(&mut self) -> GlobalKey {
        self.hidden_variables += 1;
        GlobalKey::Hidden(self.file, self.hidden_variables - 1)
    }

    fn owns_source(&self, source: Source) -> bool {
        match source {
            Source::Module(file)
            | Source::ModuleBody(file)
            | Source::ModuleDriver(file)
            | Source::ModuleInner(file)
            | Source::ModuleTouch(file)
            | Source::ModuleSettling(file)
            | Source::Function { file, .. }
            | Source::DefaultConstructor { file, .. } => file == self.file,
            Source::Initializer(sym) => sym.file == self.file,
            Source::EnumObject(_)
            | Source::NamespaceObject(_)
            | Source::ModuleNamespaceReader(_)
            | Source::DynamicImport(..)
            | Source::Required(_)
            | Source::DynamicImportBody(..)
            | Source::ExportedObjectMember(_)
            | Source::ExportedObjectDefault(..)
            | Source::FilesByPath(_)
            | Source::EvaluateByIndex(_)
            | Source::EvaluateSingleFile(..)
            | Source::ExportVariablesReader(_)
            | Source::NamespaceForHost(_)
            | Source::Validator(..) => true,
        }
    }

    pub(crate) fn add_header(
        &mut self,
        name: StrId,
        module: ModuleId,
        pos: u32,
        kind: FuncKind,
        source: Source,
    ) -> FuncId {
        let id = FuncId::new(self.out.funcs.len());
        let source_start = self.source_start(source);
        self.out.funcs.push(Func {
            name,
            module,
            pos,
            source_start,
            source_end: 0,
            kind,
            flags: 0,
            length: 0,
            captures: Vec::new(),
            declared_this_type: TyId::NONE,
            params: Vec::new(),
            annotated: Vec::new(),
            result: TyId::NONE,
            blocks: Vec::new(),
            values: Vec::new(),
            spans: Vec::new(),
        });
        self.sources.push(source);
        self.bodies.push(None);
        id
    }

    fn source_start(&self, source: Source) -> u32 {
        if self.shared.constants.source_path_to_url.is_none()
            && self.shared.constants.function_sources.is_none()
            && !self.shared.constants.records_spans
        {
            return 0;
        }
        if let Source::Function { file, .. } | Source::DefaultConstructor { file, .. } = source
            && self.c.bound(file).is_non_utf8
        {
            return 0;
        }
        let (file, place) = match source {
            Source::Function {
                file, func, class, ..
            } => {
                let f = &self.hir(file)[func];
                match (f.kind, class) {
                    (hir::FnKind::Constructor, Some((file, class))) => {
                        (file, self.hir(file)[class].body_pos)
                    }
                    (hir::FnKind::Constructor, None) => return 0,
                    (hir::FnKind::Arrow, _) => (file, f.start),
                    _ => (file, f.anchor),
                }
            }
            Source::DefaultConstructor { file, class } => (file, self.hir(file)[class].body_pos),
            _ => return 0,
        };
        let ahead = if self.is_required_again_form(file) {
            crate::REQUIRED_AGAIN_PROLOGUE_LEN
        } else {
            0
        };
        bun_sema::direct_eval::position_in_source(&self.c.bound(file).inserted, place)
            .saturating_sub(ahead)
            + 1
    }

    pub(crate) fn add_func(
        &mut self,
        name: StrId,
        module: ModuleId,
        pos: u32,
        kind: FuncKind,
        source: Source,
    ) -> FuncId {
        let id = self.add_header(name, module, pos, kind, source);
        if self.owns_source(source) {
            self.work.push_back(id);
        }
        id
    }

    pub(crate) fn forward_declare_function(&mut self, file: FileId, func: FnId) -> FuncId {
        if let Some(&known) = self
            .funcs
            .get(&(file, func))
            .or_else(|| self.named_functions.get(&(file, func)))
        {
            return known;
        }
        let role = if self.is_in_untyped_clone(file, func) {
            Role::Second
        } else {
            Role::Whole
        };
        let untyped_clone_root = self
            .untyped_clone_root
            .filter(|_| role == Role::Second)
            .unwrap_or(FnId::NONE);
        let id = self.add_header(
            StrId::NONE,
            ModuleId::NONE,
            0,
            FuncKind::Plain,
            Source::Function {
                file,
                func,
                class: None,
                role,
                untyped_clone_root,
            },
        );
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
            source_start: func.source_start,
            source_end: func.source_end,
            kind: func.kind,
            flags: func.flags,
            length: func.length,
            captures: func.captures.clone(),
            declared_this_type: func.declared_this_type,
            params: func.params.clone(),
            annotated: func.annotated.clone(),
            result: func.result,
            blocks: Vec::new(),
            values: Vec::new(),
            spans: Vec::new(),
        }
    }

    fn build_functions(&mut self) {
        loop {
            while let Some(func) = self.work.pop_front() {
                match self.pending_class_for(func) {
                    Some(class) => self.waiting_for_class.entry(class).or_default().push(func),
                    None => self.build_func(func),
                }
            }
            let Some(root) = self.untyped_clone_worklist.pop_front() else {
                break;
            };
            self.build_untyped_clone(root);
        }
    }

    pub(crate) fn is_in_untyped_clone(&self, file: FileId, func: FnId) -> bool {
        let Some(root) = self.untyped_clone_root else {
            return false;
        };
        let hir = self.hir(self.file);
        file == self.file
            && func != root
            && hir[root].start <= hir[func].start
            && hir[func].start < self.c.end_of_fn(file, root)
    }

    pub(crate) fn index_activation_layout(&mut self, key: Activation) {
        let hir = self.hir(self.file);
        let start = match self.c.environment_activation(self.file, key) {
            Activation::Call(func) | Activation::Expression(func) => hir[func].start,
            Activation::Iteration(stmt) | Activation::Block(stmt) => hir[stmt].start,
            Activation::Class(class) => hir[class].start,
            Activation::Partition(_) => return,
        };
        self.activation_layout_positions.insert((start, key));
    }

    fn build_untyped_clone(&mut self, id: FuncId) {
        let Source::Function {
            file,
            func: root,
            class,
            ..
        } = self.sources[id.idx()]
        else {
            return;
        };
        let hir = self.hir(file);
        let (start, end) = (hir[root].start, self.c.end_of_fn(file, root));
        let is_within = |pos: u32| start <= pos && pos < end;
        let is_inner =
            |key: &(FileId, FnId)| key.0 == file && key.1 != root && is_within(hir[key.1].start);
        let mut undo = Box::<Undo>::default();
        let functions_in_nest = self.c.functions_starting_within(file, start, end);
        for key in functions_in_nest
            .iter()
            .map(|&(_, func)| (file, func))
            .filter(|key| key.1 != root)
        {
            if let Some(declared) = self.funcs.remove(&key) {
                undo.funcs.push((key, Some(declared)));
            }
            if let Some(named) = self.named_functions.remove(&key) {
                undo.named_functions.push((key, Some(named)));
            }
        }
        let first_activation = Activation::Call(FnId(0));
        for (_, key) in self
            .activation_layout_positions
            .range((start, first_activation)..(end, first_activation))
            .copied()
            .collect::<Vec<_>>()
        {
            if let Some(layout) = self.activation_layouts.remove(&key) {
                undo.activation_layouts.push((key, Some(layout)));
            }
        }
        for &(_, func) in functions_in_nest {
            if let Some(layout) = self.this_bindings.remove(&func) {
                undo.this_bindings.push((func, Some(layout)));
            }
        }
        self.untyped_clone_root = Some(root);
        if class.is_some() || matches!(hir[root].kind, hir::FnKind::Method | hir::FnKind::Setter) {
            undo.funcs
                .push(((file, root), self.funcs.insert((file, root), id)));
        }
        self.undo = Some(undo);
        self.work.push_back(id);
        while let Some(func) = self.work.pop_front() {
            match self.pending_class_for(func) {
                Some(class) => self.waiting_for_class.entry(class).or_default().push(func),
                None => self.build_func(func),
            }
        }
        self.untyped_clone_root = None;
        let undo = *self.undo.take().unwrap_or_default();
        for (key, _) in undo.funcs.iter().filter(|recorded| is_inner(&recorded.0)) {
            self.funcs.remove(key);
        }
        for (key, _) in undo
            .named_functions
            .iter()
            .filter(|recorded| is_inner(&recorded.0))
        {
            self.named_functions.remove(key);
        }
        restore_entries(&mut self.funcs, undo.funcs);
        restore_entries(&mut self.named_functions, undo.named_functions);
        restore_entries(&mut self.activation_layouts, undo.activation_layouts);
        restore_entries(&mut self.this_bindings, undo.this_bindings);
        restore_entries(&mut self.places, undo.places);
        restore_entries(&mut self.parameter_slots, undo.parameter_slots);
    }

    fn define_file_classes(&mut self) {
        let (hir, bound) = (self.hir(self.file), self.c.bound(self.file));
        for class in (0..hir.classes.len() as u32).map(ClassId) {
            if !hir[class].flags.contains(hir::Flags::AMBIENT)
                && bound.class_symbol[class.idx()].is_some()
            {
                let info = self.define_class(self.file, class);
                self.resolve_field_types(info.layout);
            }
        }
    }

    fn define_referenced_classes(&mut self) {
        let mut classes: Vec<(LayoutId, (FileId, ClassId))> = self
            .classes
            .iter()
            .map(|(&class, info)| (info.layout, class))
            .collect();
        classes.sort_unstable_by(|a, b| b.0.cmp(&a.0));
        for (layout, (file, class)) in classes {
            let info = self.classes[&(file, class)];
            if info.ctor.is_some()
                || info.facts.has_fixed_layout && self.has_resolved_field_types(layout)
            {
                self.define_class(file, class);
                self.resolve_field_types(layout);
            }
        }
    }

    fn take_notes(&mut self) -> Notes {
        let c = &mut *self.c;
        c.take_notes_recorded().renamed(|ty| {
            c.keep_type(ty);
            Some(c.type_identity(ty))
        })
    }

    fn finish(mut self) -> Box<Fragment> {
        self.define_referenced_classes();
        let file = self.file;
        let (mut path, mut mutated_globals, mut method_stores) =
            (StrId::NONE, Vec::new(), Vec::new());
        let mut prototype_property_names = Vec::new();
        let mut regexp_literals = Vec::new();
        if file != NO_FILE {
            let hir = self.hir(file);
            for literal in hir
                .exprs
                .iter()
                .filter(|e| matches!(e.kind, hir::ExprKind::Regex))
            {
                let text: &[u8] = &hir.text[literal.pos as usize..literal.end as usize];
                let close = bun_core::strings::last_index_of_char(text, b'/').unwrap_or(0);
                regexp_literals.push((
                    self.out.strs.intern(&text[1.min(close)..close]),
                    self.out.strs.intern(&text[close + 1..]),
                ));
            }
            path = self.out.strs.intern(self.files.module(file).file_name());
            let mut altered = Vec::new();
            self.c.mutated_globals_in(file, &mut altered);
            mutated_globals = altered.into_iter().map(|name| self.str(name)).collect();
            let mut names = Vec::new();
            self.c.prototype_property_names_in(file, &mut names);
            prototype_property_names = names.into_iter().map(|name| self.str(name)).collect();
            let stores = self.c.method_stores_in(file);
            method_stores = stores
                .into_iter()
                .filter_map(|store| store.renamed(|ty| Some(self.retain_type(ty))))
                .collect();
            for (by, flow) in self.c.number_flows_in(file) {
                let func = match by {
                    CodeOwner::Module => self
                        .module_bodies
                        .get(&file)
                        .or_else(|| self.evaluations.get(&file))
                        .copied(),
                    CodeOwner::Function(func) => self
                        .funcs
                        .get(&(file, func))
                        .map(|id| self.typed_bodies.get(id).unwrap_or(id))
                        .copied(),
                    CodeOwner::ClassConstructor(class) => {
                        self.classes.get(&(file, class)).map(|info| info.ctor)
                    }
                };
                let Some(func) = func.filter(|func| func.is_some()) else {
                    continue;
                };
                let flow = flow.renamed(|name| self.str(name));
                if let Some(body) = &mut self.bodies[func.idx()]
                    && !body
                        .cut
                        .iter()
                        .any(|&(start, end)| start <= flow.pos && flow.pos < end)
                {
                    body.number_flows.push(flow);
                }
            }
        }
        if file != NO_FILE {
            self.c.record_escapes_in(file);
        }
        let (notes, mut problems) = (self.take_notes(), std::mem::take(&mut self.problems));
        if let Some(&evaluation) = self.evaluations.get(&file)
            && let Some(body) = &mut self.bodies[evaluation.idx()]
        {
            body.notes.append_taken(notes);
            body.problems.append(&mut problems);
        }
        if file != NO_FILE {
            for (by, mut expressions) in self.c.code_with_recorded_escapes(file) {
                let func = match by {
                    CodeOwner::Module => self.evaluations.get(&file).copied(),
                    CodeOwner::Function(func) => self
                        .funcs
                        .get(&(file, func))
                        .map(|id| self.typed_bodies.get(id).unwrap_or(id))
                        .copied(),
                    CodeOwner::ClassConstructor(class) => {
                        self.classes.get(&(file, class)).map(|info| info.ctor)
                    }
                };
                let Some(func) = func.filter(|func| func.is_some()) else {
                    continue;
                };
                let Some(body) = &self.bodies[func.idx()] else {
                    continue;
                };
                let hir = self.hir(file);
                expressions.retain(|&e| {
                    !body
                        .cut
                        .iter()
                        .any(|&(start, end)| start <= hir[e].pos && hir[e].pos < end)
                });
                self.c.record_escapes_of(file, &expressions);
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
                Some(typed) => self.record_argument_casts(
                    typed,
                    self.untyped_clones.contains_key(&FuncId::new(i)),
                ),
                None => self.record_argument_casts(FuncId::new(i), false),
            }
            let notes = self.take_notes();
            if let Some(body) = &mut self.bodies[i] {
                body.notes_for_unknown_callers = notes;
            }
        }
        let mut layout_notes: Vec<Option<Option<Box<Notes>>>> =
            Vec::with_capacity(self.out.layouts.len());
        let mut identities: Vec<Option<Identity>> = Vec::with_capacity(self.out.layouts.len());
        for layout in (0..self.out.layouts.len()).map(LayoutId::new) {
            let is_defined = match self.layout_keys[layout.idx()] {
                LayoutKey::Record(_) => self.has_resolved_field_types(layout),
                LayoutKey::Instance(file, class) => self.classes[&(file, class)].ctor.is_some(),
                LayoutKey::ClassEnvironment(..) | LayoutKey::Environment(..) => true,
            };
            layout_notes.push(is_defined.then(|| {
                let is_held = self.record_field_casts(layout);
                is_held.then(|| Box::new(self.take_notes()))
            }));
            let ty = self.layout_types.get(&layout).copied();
            identities.push(ty.map(|ty| self.retain_type(ty)));
        }

        let of_file = self
            .shared
            .builtin_functions
            .list
            .iter()
            .filter(|function| function.file == file);
        let builtin_functions = of_file
            .filter_map(|function| {
                Some((
                    function.id?,
                    FuncKey::Function(file, function.func),
                    function.visibility,
                ))
            })
            .collect();
        let inserted_before = if file != NO_FILE && self.is_required_again_form(file) {
            crate::REQUIRED_AGAIN_PROLOGUE_LEN
        } else {
            0
        };
        let FileBuild {
            out,
            sources,
            layout_keys,
            global_keys,
            bodies,
            mut layout_problems,
            constructs,
            module_files,
            named_functions,
            named_default_constructors,
            union_part_layouts,
            ..
        } = self;
        let only_named: FxHashSet<FuncId> = named_functions
            .into_values()
            .chain(named_default_constructors.into_values())
            .collect();
        let mut mentioning = ReferenceCollector::default();
        let funcs = (out.funcs.into_iter().zip(sources).zip(bodies).enumerate())
            .map(|(i, ((mut func, source), mut body))| {
                if inserted_before != 0
                    && func.module.is_some()
                    && module_files[func.module.idx()] == file
                {
                    func.pos = func.pos.saturating_sub(inserted_before);
                    for value in &mut func.values {
                        value.pos = value.pos.saturating_sub(inserted_before);
                    }
                    for block in &mut func.blocks {
                        if let Some(Term::Throw { pos, .. }) = &mut block.term {
                            *pos = pos.saturating_sub(inserted_before);
                        }
                    }
                }
                if let Some(body) = &mut body {
                    body.mentions = match body.parts.is_empty() {
                        true => mentioning.collect_func(&mut func),
                        false => {
                            parts::split_referenced_ids(&mut mentioning, &mut func, &mut body.parts)
                        }
                    };
                    for &param in func.params.iter().filter(|param| param.is_some()) {
                        for part in &out.tys.get(param).parts {
                            let &crate::declared::Part::Class(view) = part else {
                                continue;
                            };
                            for &of_union in union_part_layouts.get(&view).into_iter().flatten() {
                                body.mentions.add_layout(of_union);
                            }
                        }
                    }
                }
                Function {
                    key: source.key(),
                    func: (!only_named.contains(&FuncId::new(i))).then_some(func),
                    body,
                }
            })
            .collect();
        let layouts = (out
            .layouts
            .into_iter()
            .zip(layout_keys)
            .zip(identities)
            .zip(layout_notes)
            .enumerate())
        .map(|(i, (((mut layout, key), ty), notes))| {
            let (id, name) = (LayoutId::new(i), layout.name);
            let definition = notes.map(|notes| {
                Box::new(Definition {
                    mentions: mentioning.of_layout(&mut layout),
                    layout,
                    constructs: constructs.get(&id).copied().unwrap_or(LayoutId::NONE),
                    notes,
                    problems: layout_problems.remove(&id).unwrap_or_default(),
                })
            });
            Shape {
                key,
                name,
                ty,
                definition,
            }
        })
        .collect();
        let globals = out
            .globals
            .into_iter()
            .zip(global_keys)
            .map(|(global, key)| Variable { key, global })
            .collect();
        Box::new(Fragment {
            file,
            path,
            strs: out.strs,
            tys: out.tys,
            modules: module_files,
            globals,
            layouts,
            funcs,
            mutated_globals,
            prototype_property_names,
            regexp_literals,
            method_stores,
            builtin_functions,
            translation_count: 1,
            program_ids: Default::default(),
            summary: Default::default(),
        })
    }

    fn build_func(&mut self, id: FuncId) {
        let source = self.sources[id.idx()];
        let (file, func, class) = match source {
            Source::Module(file) | Source::ModuleTouch(file) | Source::ModuleSettling(file) => {
                (file, FnId::NONE, None)
            }
            Source::Function {
                file, func, class, ..
            } => (file, func, class),
            Source::DefaultConstructor { file, class } => (file, FnId::NONE, Some((file, class))),
            Source::EnumObject(sym) | Source::NamespaceObject(sym) | Source::Initializer(sym) => {
                (sym.file, FnId::NONE, None)
            }
            Source::DynamicImport(file, _)
            | Source::Required(file)
            | Source::DynamicImportBody(file, _)
            | Source::ModuleBody(file)
            | Source::ModuleDriver(file)
            | Source::ModuleInner(file)
            | Source::ModuleNamespaceReader(file)
            | Source::ExportedObjectMember(file)
            | Source::ExportedObjectDefault(file, _)
            | Source::FilesByPath(file)
            | Source::EvaluateByIndex(file)
            | Source::EvaluateSingleFile(file, _)
            | Source::ExportVariablesReader(file)
            | Source::NamespaceForHost(file)
            | Source::Validator(file, _) => (file, FnId::NONE, None),
        };
        let role = match source {
            Source::Function { role, .. } => role,
            _ => Role::Whole,
        };
        self.c.translate_untyped_clone(
            self.untyped_clone_root
                .filter(|_| role == Role::Second)
                .map(|root| (file, root)),
        );
        let is_arrow = func.is_some() && self.hir(file)[func].kind == hir::FnKind::Arrow;
        let seen = if is_arrow {
            self.c.arrow_receiver(file, func)
        } else {
            Receiver::None
        };
        let mut fx = Fx {
            b: FuncBuilder::new(self.take_func(id), self.known.undefined),
            id,
            file,
            func,
            locals: FxHashMap::default(),
            initialized: FxHashMap::default(),
            known_initialized: FxHashMap::default(),
            initialized_before_loops: Vec::new(),
            modules_touched_before_loops: Vec::new(),
            true_value: V::NONE,
            false_value: V::NONE,
            envs: Vec::new(),
            this: V::NONE,
            this_type: match seen {
                Receiver::Function(_) | Receiver::Instance(_) => self.receiver_ty(seen),
                Receiver::None | Receiver::Static(_) => coerce::Ty {
                    id: self.out.funcs[id.idx()].declared_this_type,
                    checked: self
                        .signatures
                        .get(&id)
                        .and_then(|signature| signature.this)
                        .unwrap_or(TypeId::UNRESOLVED),
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
            listed_fields: None,
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
            nullish_after_cast: FxHashSet::default(),
            is_coercing_fresh_graph: false,
            handed_back: Versioned::default(),
            unchanged_by_coercion: None,
            coercion_idempotence: coerce::Idempotence::Unknown,
            calls_in_tail_position: Vec::new(),
            skip_close_if: FxHashMap::default(),
            uncoercible_objects: Versioned::default(),
            narrowed: Versioned::default(),
            sink: None,
            expected: FxHashMap::default(),
            first_stores: Vec::new(),
            owes_initialize_without_stores: false,
            is_storing_default: false,
            first_spans: FxHashMap::default(),
            last_spans: FxHashMap::default(),
            operand_spans: Vec::new(),
        };
        fx.b.pos = fx.b.func.pos;
        if func.is_some()
            && matches!(
                self.hir(file)[func].kind,
                hir::FnKind::Decl | hir::FnKind::Expr
            )
            && self.hir(file)[func].this_param.is_some()
        {
            let this = self.or_anything(fx.this_type.id);
            if let Some(layout) = self.out.tys.get(this).single_layout()
                && self.out.layouts[layout.idx()].kind == ir::LayoutKind::Record
            {
                if self.c.allocates_for_unknown_callers(file, func) {
                    self.record_allocation(layout);
                    fx.first_stores = self.c.first_stores_for(file, func);
                    fx.owes_initialize_without_stores = fx.first_stores.is_empty();
                }
            }
            let views = self.layout_types_in(this);
            if views.len() > 1 {
                self.c.set_current_site(file, fx.b.pos);
                for &view in &views {
                    self.c.record_untyped(view, TypeId::OBJECT);
                }
            }
            self.c
                .record_constructor_function(&views, file, func, &fx.first_stores);
        }
        match source {
            Source::Module(file) if self.builtin_id(file).is_some() => {
                self.emit_builtin_module(&mut fx, file)
            }
            Source::Module(file) if self.is_async_module(file) => {
                if self.host_may_request_modules()
                    && self
                        .shared
                        .entry_points()
                        .iter()
                        .any(|files| files.first() == Some(&file))
                {
                    self.files_by_path(file);
                }
                self.emit_evaluate(&mut fx, file, V::NONE);
            }
            Source::ModuleInner(file) => self.emit_inner_module_evaluation(&mut fx, file),
            Source::Module(file) => {
                if self.host_may_request_modules()
                    && self
                        .shared
                        .entry_points()
                        .iter()
                        .any(|files| files.first() == Some(&file))
                {
                    self.files_by_path(file);
                }
                let name = self.out.strs.intern(b"evaluated");
                let flag = self.add_global(
                    name,
                    file,
                    Ty::NONE,
                    GlobalKey::ModuleInternal(file, "evaluated"),
                );
                self.out.globals[flag.idx()].initialization = ir::Initialization::Undefined;
                let known = self.emit(&mut fx, Op::GlobalGet(flag));
                let undefined = self.emit(&mut fx, Op::Undefined);
                let is_first = self.emit(
                    &mut fx,
                    Op::StrictEq {
                        a: known,
                        b: undefined,
                    },
                );
                let (evaluate, done) = (fx.b.new_block(), fx.b.new_block());
                self.branch(&mut fx, is_first, evaluate, done);
                fx.b.seal(evaluate);
                fx.b.seal(done);
                let name = self.out.strs.intern(b"evaluation");
                let evaluation = self.add_global(
                    name,
                    file,
                    Ty::NONE,
                    GlobalKey::ModuleInternal(file, "evaluation"),
                );
                self.out.globals[evaluation.idx()].initialization = ir::Initialization::Undefined;
                fx.b.switch_to(done);
                let no = self.emit(&mut fx, Op::Bool(false));
                let has_thrown = self.emit(&mut fx, Op::StrictEq { a: known, b: no });
                let (thrown, evaluated) = (fx.b.new_block(), fx.b.new_block());
                self.branch(&mut fx, has_thrown, thrown, evaluated);
                fx.b.seal(thrown);
                fx.b.seal(evaluated);
                fx.b.switch_to(thrown);
                let error = self.emit(&mut fx, Op::GlobalGet(evaluation));
                fx.b.terminate(Term::Throw {
                    value: error,
                    unwind: None,
                    pos: 0,
                });
                fx.b.switch_to(evaluated);
                self.terminate_with_return(&mut fx, V::NONE);
                fx.b.switch_to(evaluate);
                let yes = self.emit(&mut fx, Op::Bool(true));
                self.emit(&mut fx, Op::GlobalSet(flag, yes));
                let body = if self.has_lazy_module_state(file) {
                    self.deferred_module_function(file, Source::ModuleSettling(file))
                } else {
                    self.body_of(file)
                };
                let throwing = fx.b.new_block();
                fx.handlers.push(throwing);
                self.emit_dependencies(&mut fx, file);
                let includes_host_wrapper = self.skips_host_module_object(file);
                if includes_host_wrapper {
                    self.emit_host_module(&mut fx, file);
                }
                self.emit_throwing(
                    &mut fx,
                    Op::CallDirect {
                        func: body,
                        args: ir::Args::new(),
                    },
                );
                if includes_host_wrapper {
                    self.emit_commonjs_epilogue(&mut fx, file);
                }
                fx.handlers.pop();
                self.emit_evaluation_finished(&mut fx, file, false);
                self.terminate_with_return(&mut fx, V::NONE);
                fx.b.seal(throwing);
                fx.b.switch_to(throwing);
                let error = self.emit(&mut fx, Op::Caught);
                self.emit_evaluation_finished(&mut fx, file, true);
                let no = self.emit(&mut fx, Op::Bool(false));
                self.emit(&mut fx, Op::GlobalSet(flag, no));
                self.emit(&mut fx, Op::GlobalSet(evaluation, error));
                fx.b.terminate(Term::Throw {
                    value: error,
                    unwind: None,
                    pos: 0,
                });
            }
            Source::ModuleTouch(file) => {
                let (ran, thrown) = self.deferred_module_state(file);
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
                fx.b.terminate(Term::Throw {
                    value: error,
                    unwind: None,
                    pos: 0,
                });
                fx.b.switch_to(early);
                let wanted = self.emit(&mut fx, Op::Int(0));
                self.emit(&mut fx, Op::GlobalSet(ran, wanted));
                self.terminate_with_return(&mut fx, V::NONE);
                fx.b.switch_to(evaluate);
                self.emit(&mut fx, Op::GlobalSet(ran, yes));
                let body = self.body_of(file);
                let throwing = fx.b.new_block();
                fx.handlers.push(throwing);
                self.emit_throwing(
                    &mut fx,
                    Op::CallDirect {
                        func: body,
                        args: ir::Args::new(),
                    },
                );
                fx.handlers.pop();
                self.terminate_with_return(&mut fx, V::NONE);
                fx.b.seal(throwing);
                fx.b.switch_to(throwing);
                let error = self.emit(&mut fx, Op::Caught);
                let no = self.emit(&mut fx, Op::Bool(false));
                self.emit(&mut fx, Op::GlobalSet(ran, no));
                self.emit(&mut fx, Op::GlobalSet(thrown, error));
                fx.b.terminate(Term::Throw {
                    value: error,
                    unwind: None,
                    pos: 0,
                });
            }
            Source::ModuleSettling(file) => {
                let (ran, _) = self.deferred_module_state(file);
                let known = self.emit(&mut fx, Op::GlobalGet(ran));
                let null = self.emit(&mut fx, Op::Null);
                self.emit(&mut fx, Op::GlobalSet(ran, null));
                let wanted = self.emit(&mut fx, Op::Int(0));
                let is_wanted = self.emit(
                    &mut fx,
                    Op::StrictEq {
                        a: known,
                        b: wanted,
                    },
                );
                let (now, later) = (fx.b.new_block(), fx.b.new_block());
                self.branch(&mut fx, is_wanted, now, later);
                fx.b.seal(now);
                fx.b.seal(later);
                fx.b.switch_to(now);
                let touch = self.deferred_module_function(file, Source::ModuleTouch(file));
                self.emit_throwing(
                    &mut fx,
                    Op::CallDirect {
                        func: touch,
                        args: ir::Args::new(),
                    },
                );
                self.terminate_with_return(&mut fx, V::NONE);
                fx.b.switch_to(later);
                self.terminate_with_return(&mut fx, V::NONE);
            }
            Source::ModuleBody(file) => self.emit_statements(&mut fx, file),
            Source::Required(file) if !self.has_separate_require_evaluation(file) => {
                self.emit_required_module_marker(&mut fx, file)
            }
            Source::Required(file) => {
                let name = self.out.strs.intern(b"evaluated");
                let flag = self.add_global(
                    name,
                    file,
                    Ty::NONE,
                    GlobalKey::ModuleInternal(file, "evaluated"),
                );
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
                let is_first = self.emit(
                    &mut fx,
                    Op::StrictEq {
                        a: known,
                        b: undefined,
                    },
                );
                let (first, retained) = (fx.b.new_block(), fx.b.new_block());
                self.branch(&mut fx, is_first, first, retained);
                fx.b.seal(first);
                fx.b.seal(retained);
                let evaluation = self.evaluation_function(file);
                fx.b.switch_to(retained);
                if let Some(func) = evaluation {
                    self.emit_throwing(
                        &mut fx,
                        Op::CallDirect {
                            func,
                            args: ir::Args::new(),
                        },
                    );
                }
                self.terminate_with_return(&mut fx, V::NONE);
                fx.b.switch_to(first);
                let throwing = fx.b.new_block();
                fx.handlers.push(throwing);
                if let Some(func) = evaluation {
                    self.emit_throwing(
                        &mut fx,
                        Op::CallDirect {
                            func,
                            args: ir::Args::new(),
                        },
                    );
                }
                fx.handlers.pop();
                self.terminate_with_return(&mut fx, V::NONE);
                fx.b.seal(throwing);
                fx.b.switch_to(throwing);
                let error = self.emit(&mut fx, Op::Caught);
                if self.required_again_form(file).is_some() {
                    self.emit_require_cache_delete(&mut fx, file);
                } else {
                    let undefined = self.emit(&mut fx, Op::Undefined);
                    self.emit(&mut fx, Op::GlobalSet(flag, undefined));
                }
                fx.b.terminate(Term::Throw {
                    value: error,
                    unwind: None,
                    pos: 0,
                });
            }
            Source::ModuleDriver(file) => self.emit_module_driver(&mut fx, file),
            Source::DynamicImport(file, is_node_mode) if self.is_async_module(file) => {
                self.emit_dynamic_import_with_ticket(&mut fx, file, is_node_mode)
            }
            Source::DynamicImport(file, is_node_mode) => {
                self.emit_dynamic_import(&mut fx, file, is_node_mode, V::NONE)
            }
            Source::DynamicImportBody(file, is_node_mode) => {
                let ticket = self.add_entry_param(&mut fx, Ty::NONE);
                self.emit_dynamic_import(&mut fx, file, is_node_mode, ticket);
            }
            Source::Function {
                role: Role::Entry | Role::Beside,
                ..
            } => self.emit_generic_entrypoint(&mut fx),
            Source::Function { .. } if self.out.funcs[id.idx()].kind == FuncKind::Constructor => {
                self.emit_constructor(&mut fx)
            }
            Source::Function { .. } => self.function_body(&mut fx),
            Source::DefaultConstructor { .. } => self.emit_constructor(&mut fx),
            Source::EnumObject(sym) => self.emit_enum_object_getter(&mut fx, sym),
            Source::Initializer(sym) => self.emit_initializer(&mut fx, sym),
            Source::NamespaceObject(sym) => self.emit_namespace_object_getter(&mut fx, sym),
            Source::ModuleNamespaceReader(file) => self.emit_module_namespace_reader(&mut fx, file),
            Source::ExportedObjectMember(file) => self.emit_exported_object_member(&mut fx, file),
            Source::ExportedObjectDefault(file, is_node_mode) => {
                self.emit_exported_object_default(&mut fx, file, is_node_mode)
            }
            Source::FilesByPath(file) => self.emit_files_by_path(&mut fx, file),
            Source::EvaluateByIndex(entry) => self.emit_evaluate_by_index(&mut fx, entry),
            Source::EvaluateSingleFile(_, file) => self.emit_evaluate_single_file(&mut fx, file),
            Source::ExportVariablesReader(file) => self.emit_export_variables_reader(&mut fx, file),
            Source::NamespaceForHost(file) => self.emit_namespace_for_host(&mut fx, file),
            Source::Validator(_, at) => self.emit_validator(&mut fx, at),
        }
        self.terminate_with_return(&mut fx, V::NONE);
        let flags = self.out.funcs[id.idx()].flags
            | if fx.is_typed {
                ir::func_flags::IS_TYPED
            } else {
                0
            }
            | if self.shared.is_prelude(fx.file) {
                ir::func_flags::IS_BUILTIN
            } else {
                0
            }
            | if self.is_builtin_file(fx.file) {
                ir::func_flags::IS_IN_BUILTIN_MODULE
            } else {
                0
            };
        let recorded = std::mem::take(&mut fx.first_spans);
        let mut of_operands = std::mem::take(&mut fx.operand_spans);
        let mut built = fx.b.finish();
        if !recorded.is_empty() {
            built.spans = crate::audit::settle(&built, &recorded);
            built.spans.append(&mut of_operands);
        }
        if role == Role::Second {
            built
                .values
                .iter_mut()
                .for_each(|value| value.set_prediction(ir::Prediction::None));
        }
        built.flags |= flags;
        self.out.funcs[id.idx()] = built;
        let class = match source {
            Source::Function { class, .. } => class,
            Source::DefaultConstructor { file, class } => Some((file, class)),
            _ => None,
        };
        let spans = match source {
            Source::Function {
                file, func, class, ..
            } => {
                let is_constructor = self.out.funcs[id.idx()].kind == FuncKind::Constructor;
                let mut spans = class
                    .filter(|_| is_constructor)
                    .map_or_else(Vec::new, |(file, class)| {
                        self.instance_field_spans(file, class)
                    });
                let hir = self.hir(file);
                let after_decorators = match self.c.bound(file).fns[func.idx()].owner {
                    bun_sema::bind::FnOwner::Member(member) => hir
                        .modifier_list(hir[member].modifiers)
                        .iter()
                        .filter_map(|modifier| match modifier.kind {
                            hir::ModifierKind::Decorator(decorator) => Some(hir[decorator].end),
                            hir::ModifierKind::Keyword(_) => None,
                        })
                        .max(),
                    _ => None,
                };
                spans.push((
                    after_decorators.unwrap_or(hir[func].start),
                    self.c.end_of_fn(file, func),
                ));
                spans
            }
            Source::DefaultConstructor { file, class } => self.instance_field_spans(file, class),
            Source::Initializer(sym) => match self.c.lazy_variable_declaration(sym) {
                Some((file, d)) => {
                    let initializer = &self.hir(file)[self.hir(file)[d].init];
                    vec![(initializer.pos, initializer.end)]
                }
                None => Vec::new(),
            },
            _ => Vec::new(),
        };
        match source {
            Source::Function {
                file,
                func,
                role: Role::Whole | Role::Typed,
                ..
            } => self.c.record_creations_in(file, func),
            Source::Module(file) if self.builtin_id(file).is_some() => {
                self.c.record_creations_in(file, FnId::NONE)
            }
            Source::ModuleBody(file) => self.c.record_creations_in(file, FnId::NONE),
            _ => {}
        }
        if let Some((file, class)) =
            class.filter(|_| self.out.funcs[id.idx()].kind == FuncKind::Constructor)
        {
            self.c.record_construction_of(file, class);
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
            class: class
                .and_then(|class| self.classes.get(&class))
                .map_or(LayoutId::NONE, |class| class.layout),
            declares: std::mem::take(&mut self.declares),
            classes_as_values: {
                self.classes_as_values_set.clear();
                std::mem::take(&mut self.classes_as_values)
            },
            implicit_stores: std::mem::take(&mut self.implicit_stores),
            number_flows: Vec::new(),
            notes: self.take_notes(),
            notes_for_unknown_callers: Notes::default(),
            problems: std::mem::take(&mut self.problems),
            mentions: ReferencedIds::default(),
        };
        self.bodies[id.idx()] = Some(Box::new(body));
        self.c.translate_untyped_clone(None);
    }

    pub(crate) fn captured(&mut self, file: FileId) -> Rc<FxHashSet<Sym>> {
        if let Some(known) = self.captured.get(&file) {
            return known.clone();
        }
        let hir = self.hir(file);
        let bound = self.c.bound(file);
        let mut captured = FxHashSet::default();
        let mut function_values = FxHashSet::default();
        let mut bindings: Vec<Option<(Sym, bool, Option<FnId>)>> = vec![None; bound.symbols.len()];
        for (i, e) in hir.exprs.iter().enumerate() {
            let hir::ExprKind::Ident(name) = e.kind else {
                continue;
            };
            let e = hir::ExprId(i as u32);
            if matches!(bound.expr_parent[e.idx()], bun_sema::bind::Parent::None)
                || bound.is_in_type_query(e)
            {
                continue;
            }
            let local = bound.expr_symbol[e.idx()];
            let (sym, is_function, declared_in) = match bindings.get(local.idx()).copied().flatten()
            {
                Some(known) => known,
                None => {
                    let Some(binding) = self.ident_binding(file, e, name) else {
                        continue;
                    };
                    let sym = self.value_symbol(binding);
                    let found = (
                        sym,
                        self.files
                            .flags(sym)
                            .contains(bun_sema::bind::SymFlags::FUNCTION),
                        self.declaring_function(sym),
                    );
                    if self.is_binding_independent_of_use(file, local, binding) {
                        bindings[local.idx()] = Some(found);
                    }
                    found
                }
            };
            if sym.file != file {
                continue;
            }
            if is_function {
                let is_callee = matches!(bound.expr_parent[e.idx()], bun_sema::bind::Parent::Expr(parent)
                    if matches!(hir[parent].kind, hir::ExprKind::Call(call) if hir[call].callee == e));
                if !is_callee || self.c.is_generator_called_through_closure(file, e) {
                    function_values.insert(sym);
                }
            }
            let Some(declared_in) = declared_in else {
                continue;
            };
            if self.enclosing_function(file, e) != declared_in
                || self.is_in_instance_field_initializer(file, e)
                || declared_in.is_none()
                    && self.lazy_variable_declared_at(file, hir[e].pos).is_some()
            {
                captured.insert(sym);
            }
        }
        if self.jsx_runtime(file).is_none() {
            for (i, e) in hir.exprs.iter().enumerate() {
                if !matches!(e.kind, hir::ExprKind::Jsx(_)) {
                    continue;
                }
                for is_fragment_tag in [false, true] {
                    let (_, Some(sym)) =
                        self.c
                            .classic_jsx_factory(file, hir::ExprId(i as u32), is_fragment_tag)
                    else {
                        continue;
                    };
                    let sym = self.value_symbol(sym);
                    if sym.file != file {
                        continue;
                    }
                    captured.insert(sym);
                    if self
                        .files
                        .flags(sym)
                        .contains(bun_sema::bind::SymFlags::FUNCTION)
                    {
                        function_values.insert(sym);
                    }
                }
            }
        }
        for sym in self.c.decorator_referenced_values(file) {
            let sym = self.value_symbol(sym);
            if sym.file != file {
                continue;
            }
            captured.insert(sym);
            if self
                .files
                .flags(sym)
                .contains(bun_sema::bind::SymFlags::FUNCTION)
            {
                function_values.insert(sym);
            }
        }
        for &(.., sym) in self.lazy_declarations_in(file).iter() {
            captured.insert(sym);
        }
        for &(_, export) in self.files.exports_of_module(self.files.file_symbol(file)) {
            captured.insert(self.value_symbol(export));
            captured.insert(self.export_value_symbol(export));
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
