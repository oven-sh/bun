#[cfg(test)]
mod tests;

use crate::builtins::RuntimeModule;
use crate::ir::waiting_lists::AsNumbers;
use crate::ir::{FunctionKey, LayoutKey, VariableKey};
use crate::load::{ProgramFile, ProjectId, Sources};
use crate::modules::{ModuleFailureId, ModuleGraph, ModuleRef};
use bun_ast::Loader;
use bun_sema::atom::{Atom, Interner};
use bun_sema::check::aot::{
    ClassDeclaration, ClassRef, FunctionRef, ObjectOrigin, TypeParameterRef,
};
use bun_sema::hir::{ClassId, FnId, MemberId};
use bun_sema::program::{FileId, Sym};
use core::cmp::Ordering;

#[derive(Copy, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Debug)]
pub struct InProject<K> {
    pub project: ProjectId,
    pub key: K,
}

pub type ProgramFunctionKey = InProject<FunctionKey>;
pub type ProgramLayoutKey = InProject<LayoutKey>;

/// The kind of key together with the project, the file, and what the key names in the file.
impl AsNumbers for ProgramFunctionKey {
    type Numbers = [u32; 3];

    fn to_numbers(self) -> [u32; 3] {
        let (kind, file, named) = match self.key {
            FunctionKey::ModuleBody(file) => (0, file, 0),
            FunctionKey::WrappedModuleBody(file) => (1, file, 0),
            FunctionKey::FaceBody(file) => (2, file, 0),
            FunctionKey::CheckBody(file) => (3, file, 0),
            FunctionKey::Source(FunctionRef { file, function }) => (4, file, function.0),
            FunctionKey::Signature(FunctionRef { file, function }) => (5, file, function.0),
            FunctionKey::ClassSignature(ClassRef { file, class }) => (6, file, class.0),
            FunctionKey::ImplicitConstructor(ClassRef { file, class }) => (7, file, class.0),
            FunctionKey::InstanceInitializer(ClassRef { file, class }) => (8, file, class.0),
            FunctionKey::StaticInitializer(ClassRef { file, class }) => (9, file, class.0),
            FunctionKey::AccessorGetter { file, member } => (10, file, member.0),
            FunctionKey::AccessorSetter { file, member } => (11, file, member.0),
            FunctionKey::PrivateNameTest { file, member } => (12, file, member.0),
        };
        let kind_in_project = kind * ProjectId::COUNT as u32 + self.project as u32;
        [kind_in_project, file.0, named]
    }

    fn from_numbers([kind_in_project, file, named]: [u32; 3]) -> ProgramFunctionKey {
        let file = FileId(file);
        let function = FunctionRef {
            file,
            function: FnId(named),
        };
        let class = ClassRef {
            file,
            class: ClassId(named),
        };
        let member = MemberId(named);
        let key = match kind_in_project / ProjectId::COUNT as u32 {
            0 => FunctionKey::ModuleBody(file),
            1 => FunctionKey::WrappedModuleBody(file),
            2 => FunctionKey::FaceBody(file),
            3 => FunctionKey::CheckBody(file),
            4 => FunctionKey::Source(function),
            5 => FunctionKey::Signature(function),
            6 => FunctionKey::ClassSignature(class),
            7 => FunctionKey::ImplicitConstructor(class),
            8 => FunctionKey::InstanceInitializer(class),
            9 => FunctionKey::StaticInitializer(class),
            10 => FunctionKey::AccessorGetter { file, member },
            11 => FunctionKey::AccessorSetter { file, member },
            12 => FunctionKey::PrivateNameTest { file, member },
            _ => unreachable!("`to_numbers` wrote it"),
        };
        InProject {
            project: ProjectId::ALL[kind_in_project as usize % ProjectId::COUNT],
            key,
        }
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum ProgramModule {
    File(ProgramFile),
    /// The callback of `__commonJS(cb)` or `__esm(fn)` in a bundle.
    Inner {
        file: ProgramFile,
        callback: FnId,
    },
    /// What ES modules request in place of a CommonJS file.
    Face(ProgramFile),
    /// Throws for a name that the ES graph below a file imports and no CommonJS file of it stores.
    Check(ProgramFile),
    Runtime(RuntimeModule),
    External {
        importer: ProgramFile,
        specifier: Atom,
        type_attribute: Option<Loader>,
    },
}

impl ProgramModule {
    pub fn file(self) -> Option<ProgramFile> {
        order_in_file(self).map(|(file, _, _)| file)
    }

    /// As the graph of its project names a module that has its text in a file.
    pub fn in_own_project(self) -> Option<(ProjectId, ModuleRef)> {
        Some(match self {
            ProgramModule::File(file) => (file.project, ModuleRef::File(file.file)),
            ProgramModule::Inner { file, callback } => {
                let module = ModuleRef::Inner {
                    file: file.file,
                    callback,
                };
                (file.project, module)
            }
            ProgramModule::Face(file) => (file.project, ModuleRef::Face(file.file)),
            ProgramModule::Check(file) => (file.project, ModuleRef::Check(file.file)),
            ProgramModule::Runtime(_) | ProgramModule::External { .. } => return None,
        })
    }

    /// The body of a record that a file has beside its own. The fragment of the file names the body of its own record.
    pub fn body_key(self) -> Option<ProgramFunctionKey> {
        let (file, key) = match self {
            ProgramModule::Inner { file, callback } => {
                let callback = FunctionRef {
                    file: file.file,
                    function: callback,
                };
                (file, FunctionKey::Source(callback))
            }
            ProgramModule::Face(file) => (file, FunctionKey::FaceBody(file.file)),
            ProgramModule::Check(file) => (file, FunctionKey::CheckBody(file.file)),
            ProgramModule::File(_) | ProgramModule::Runtime(_) | ProgramModule::External { .. } => {
                return None;
            }
        };
        Some(InProject {
            project: file.project,
            key,
        })
    }

    /// `VariableKey::MockOf`
    pub fn mock_variable_key(self) -> Option<ProgramVariableKey> {
        match self {
            ProgramModule::File(file) => Some(ProgramVariableKey::Declared(InProject {
                project: file.project,
                key: VariableKey::MockOf(file.file),
            })),
            _ => None,
        }
    }

    /// What holds `module.exports` where the exports of the module are one value.
    pub fn exports_variable_key(self) -> Option<ProgramVariableKey> {
        let (file, key) = match self {
            ProgramModule::File(file) => (file, VariableKey::ModuleExports(file.file)),
            ProgramModule::Inner { file, callback } => {
                let callback = FunctionRef {
                    file: file.file,
                    function: callback,
                };
                (file, VariableKey::InnerModuleExports(callback))
            }
            _ => return None,
        };
        Some(ProgramVariableKey::Declared(InProject {
            project: file.project,
            key,
        }))
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum ProgramVariableKey {
    Declared(InProject<VariableKey>),
    SyntheticExport {
        module: ProgramModule,
        name: Atom,
    },
    /// What ES importers hold of a name of the CommonJS file `module`.
    Copy {
        module: ProgramModule,
        name: Atom,
    },
    /// `VariableKey::MockOfRuntimeModule`
    MockOfRuntimeModule(RuntimeModule),
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum ProgramKey {
    Function(ProgramFunctionKey),
    Layout(ProgramLayoutKey),
    Variable(ProgramVariableKey),
    Module(ProgramModule),
}

/// The files of a program that checks a typed package by itself, as the application numbers them.
pub struct Rehoming<'a> {
    /// By file of the package's program: the application's file at the same path.
    pub files: &'a [Option<FileId>],
    pub application_graph: &'a ModuleGraph,
    /// A file that only the package's program has gets a number that no file of the application has.
    pub first_fresh_file: u32,
    /// The first declaration's symbol of a symbol of the package's program.
    pub stable_symbol: &'a (dyn Fn(Sym) -> Sym + Sync),
    /// The whole symbol, in the application, of a symbol that a file declares.
    pub canonical_symbol: &'a (dyn Fn(Sym) -> Sym + Sync),
}

impl Rehoming<'_> {
    pub fn file(&self, file: FileId) -> FileId {
        self.files[file.idx()].unwrap_or(FileId(self.first_fresh_file + file.0))
    }

    pub fn symbol(&self, symbol: Sym) -> Sym {
        let part = (self.stable_symbol)(symbol);
        match self.files[part.file.idx()] {
            Some(file) => (self.canonical_symbol)(Sym { file, id: part.id }),
            None => Sym {
                file: self.file(symbol.file),
                id: symbol.id,
            },
        }
    }

    fn function_key(&self, mut key: FunctionKey) -> FunctionKey {
        match &mut key {
            FunctionKey::ModuleBody(file)
            | FunctionKey::WrappedModuleBody(file)
            | FunctionKey::FaceBody(file)
            | FunctionKey::CheckBody(file)
            | FunctionKey::Source(FunctionRef { file, .. })
            | FunctionKey::Signature(FunctionRef { file, .. })
            | FunctionKey::ClassSignature(ClassRef { file, .. })
            | FunctionKey::ImplicitConstructor(ClassRef { file, .. })
            | FunctionKey::InstanceInitializer(ClassRef { file, .. })
            | FunctionKey::StaticInitializer(ClassRef { file, .. })
            | FunctionKey::AccessorGetter { file, member: _ }
            | FunctionKey::AccessorSetter { file, member: _ }
            | FunctionKey::PrivateNameTest { file, member: _ } => *file = self.file(*file),
        }
        key
    }

    fn layout_key(&self, mut key: LayoutKey) -> LayoutKey {
        match &mut key {
            LayoutKey::Class(ClassRef { file, .. })
            | LayoutKey::ConstructorFunction(FunctionRef { file, .. })
            | LayoutKey::ObjectType {
                origin:
                    ObjectOrigin::TypeLiteral { file, node: _ }
                    | ObjectOrigin::MappedType { file, node: _ }
                    | ObjectOrigin::ObjectLiteral {
                        file,
                        expression: _,
                    },
                instantiation: _,
            }
            | LayoutKey::UntypedLiteral { file, members: _ }
            | LayoutKey::TypeParameter(TypeParameterRef { file, .. })
            | LayoutKey::Environment {
                file,
                environment: _,
            } => *file = self.file(*file),
            LayoutKey::ObjectType {
                origin: ObjectOrigin::Symbol(symbol),
                instantiation: _,
            }
            | LayoutKey::Container(symbol) => *symbol = self.symbol(*symbol),
            LayoutKey::Library(_)
            | LayoutKey::ObjectType {
                origin: ObjectOrigin::Computed,
                instantiation: _,
            } => {}
        }
        key
    }

    // A variable goes by the symbol that its own file declares, also where the application merges that symbol with a declaration of another file: `declare module "package" { interface Class {} }`.
    fn variable_key(&self, mut key: VariableKey) -> VariableKey {
        match &mut key {
            VariableKey::Symbol(symbol)
            | VariableKey::RequiredAnswer(symbol)
            | VariableKey::RequireMadeForOwnFile(symbol)
            | VariableKey::PrivateState {
                state: symbol,
                part: _,
            } => symbol.file = self.file(symbol.file),
            VariableKey::SyntheticExport(_)
            | VariableKey::Copy(_)
            | VariableKey::MockOfRuntimeModule(_) => {}
            VariableKey::ModuleExports(file)
            | VariableKey::MockOf(file)
            | VariableKey::ClassSlot {
                class: ClassRef { file, .. },
                slot: _,
            }
            | VariableKey::InnerModuleExports(FunctionRef { file, .. })
            | VariableKey::ModulePath { file, variable: _ } => *file = self.file(*file),
        }
        key
    }
}

#[derive(Copy, Clone)]
pub struct KeyContext<'a> {
    pub project: ProjectId,
    pub graph: &'a ModuleGraph,
    pub runtime_sources: &'a Sources,
    pub rehoming: Option<&'a Rehoming<'a>>,
}

impl KeyContext<'_> {
    pub fn file(&self, file: FileId) -> FileId {
        self.rehoming.map_or(file, |rehoming| rehoming.file(file))
    }

    pub fn function_key(&self, key: FunctionKey) -> ProgramFunctionKey {
        let key = self
            .rehoming
            .map_or(key, |rehoming| rehoming.function_key(key));
        InProject {
            project: self.project,
            key,
        }
    }

    pub fn layout_key(&self, key: LayoutKey) -> ProgramLayoutKey {
        let key = self
            .rehoming
            .map_or(key, |rehoming| rehoming.layout_key(key));
        let (project, key) = match key {
            LayoutKey::Library(ClassDeclaration::Class(class)) => {
                (ProjectId::Runtime, LayoutKey::Class(class))
            }
            LayoutKey::Library(ClassDeclaration::Function(function)) => {
                (ProjectId::Runtime, LayoutKey::ConstructorFunction(function))
            }
            _ => (self.project, key),
        };
        InProject { project, key }
    }

    pub fn variable_key(&self, key: VariableKey) -> ProgramVariableKey {
        match key {
            VariableKey::SyntheticExport(id) => {
                let export = self.graph.synthetic_export(id);
                ProgramVariableKey::SyntheticExport {
                    module: self.module(export.module),
                    name: export.name,
                }
            }
            VariableKey::Copy(id) => {
                let export = self.graph.synthetic_export(id);
                ProgramVariableKey::Copy {
                    module: self.module(export.module),
                    name: export.name,
                }
            }
            VariableKey::MockOfRuntimeModule(module) => {
                ProgramVariableKey::MockOfRuntimeModule(module)
            }
            _ => ProgramVariableKey::Declared(InProject {
                project: self.project,
                key: self
                    .rehoming
                    .map_or(key, |rehoming| rehoming.variable_key(key)),
            }),
        }
    }

    pub fn module_failure(&self, id: ModuleFailureId) -> ModuleFailureId {
        let Some(rehoming) = self.rehoming else {
            return id;
        };
        let failure = self.graph.failure(id);
        let importer = rehoming.file(failure.importer);
        let mut failures = rehoming.application_graph.failures().iter();
        let position = failures.position(|other| {
            (other.importer, other.site, other.start, other.end)
                == (importer, failure.site, failure.start, failure.end)
        });
        position.map_or(id, |position| ModuleFailureId(position as u32))
    }

    pub fn module(&self, module: ModuleRef) -> ProgramModule {
        let in_project = |file| ProgramFile {
            project: self.project,
            file: self.file(file),
        };
        match module {
            ModuleRef::File(file) => ProgramModule::File(in_project(file)),
            ModuleRef::Inner { file, callback } => ProgramModule::Inner {
                file: in_project(file),
                callback,
            },
            ModuleRef::Face(file) => ProgramModule::Face(in_project(file)),
            ModuleRef::Check(file) => ProgramModule::Check(in_project(file)),
            ModuleRef::Runtime(module) => match self.runtime_sources.runtime_module_file(module) {
                Some(file) => ProgramModule::File(ProgramFile {
                    project: ProjectId::Runtime,
                    file,
                }),
                None => ProgramModule::Runtime(module),
            },
            ModuleRef::External {
                importer,
                specifier,
                type_attribute,
            } => ProgramModule::External {
                importer: in_project(self.graph.importer_of_external(importer, specifier)),
                specifier,
                type_attribute,
            },
        }
    }
}

// The records of a file stand together: its own, its inner modules, its face, its check.
fn order_in_file(module: ProgramModule) -> Option<(ProgramFile, u8, u32)> {
    match module {
        ProgramModule::File(file) => Some((file, 0, 0)),
        ProgramModule::Inner { file, callback } => Some((file, 1, callback.0)),
        ProgramModule::Face(file) => Some((file, 2, 0)),
        ProgramModule::Check(file) => Some((file, 3, 0)),
        ProgramModule::Runtime(_) | ProgramModule::External { .. } => None,
    }
}

pub fn compare_program_modules(
    a: ProgramModule,
    b: ProgramModule,
    atoms: &Interner<'_>,
) -> Ordering {
    use ProgramModule::{External, Runtime};
    match (order_in_file(a), order_in_file(b)) {
        (Some(a), Some(b)) => return a.cmp(&b),
        (Some(_), None) => return Ordering::Less,
        (None, Some(_)) => return Ordering::Greater,
        (None, None) => {}
    }
    match (a, b) {
        (Runtime(a), Runtime(b)) => a.cmp(&b),
        (
            External {
                importer: a_importer,
                specifier: a_specifier,
                type_attribute: a_type,
            },
            External {
                importer: b_importer,
                specifier: b_specifier,
                type_attribute: b_type,
            },
        ) => a_importer
            .cmp(&b_importer)
            .then_with(|| atoms.bytes(a_specifier).cmp(atoms.bytes(b_specifier)))
            .then_with(|| a_type.map(|it| it as u8).cmp(&b_type.map(|it| it as u8))),
        (Runtime(_), _) => Ordering::Less,
        (_, Runtime(_)) => Ordering::Greater,
        _ => unreachable!("a module that has its text in a file is ordered by the file"),
    }
}
