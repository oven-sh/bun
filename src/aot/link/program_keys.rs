#[cfg(test)]
mod tests;

use super::merged_keys::OrderedKey;
use crate::builtins::RuntimeModule;
use crate::ir::{FunctionKey, LayoutKey, VariableKey};
use crate::load::{ProgramFile, ProjectId, Sources};
use crate::modules::{ModuleGraph, ModuleRef};
use bun_ast::Loader;
use bun_sema::atom::{Atom, Interner};
use bun_sema::check::aot::{ClassDeclaration, FunctionRef, ObjectOrigin, TypeIdentity};
use bun_sema::hir::FnId;
use bun_sort_by_number::number_of_pair;
use core::cmp::Ordering;

#[derive(Copy, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Debug)]
pub struct InProject<K> {
    pub project: ProjectId,
    pub key: K,
}

pub type ProgramFunctionKey = InProject<FunctionKey>;
pub type ProgramLayoutKey = InProject<LayoutKey>;

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum ProgramModule {
    File(ProgramFile),
    Inner {
        file: ProgramFile,
        callback: FnId,
    },
    Facade(ProgramFile),
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
            ProgramModule::Facade(file) => (file.project, ModuleRef::Facade(file.file)),
            ProgramModule::Check(file) => (file.project, ModuleRef::Check(file.file)),
            ProgramModule::Runtime(_) | ProgramModule::External { .. } => return None,
        })
    }

    pub fn body_key(self) -> Option<ProgramFunctionKey> {
        let (file, key) = match self {
            ProgramModule::Inner { file, callback } => {
                let callback = FunctionRef {
                    file: file.file,
                    function: callback,
                };
                (file, FunctionKey::Source(callback))
            }
            ProgramModule::Facade(file) => (file, FunctionKey::FacadeBody(file.file)),
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
    SyntheticExport { module: ProgramModule, name: Atom },
    Copy { module: ProgramModule, name: Atom },
    MockOfRuntimeModule(RuntimeModule),
}

#[derive(Copy, Clone)]
pub struct KeyContext<'a> {
    pub project: ProjectId,
    pub graph: &'a ModuleGraph,
    pub runtime_sources: &'a Sources,
}

impl KeyContext<'_> {
    #[inline]
    pub fn function_key(&self, key: FunctionKey) -> ProgramFunctionKey {
        InProject {
            project: self.project,
            key,
        }
    }

    pub fn layout_key(&self, key: LayoutKey) -> ProgramLayoutKey {
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
                key,
            }),
        }
    }

    pub fn module(&self, module: ModuleRef) -> ProgramModule {
        let in_project = |file| ProgramFile {
            project: self.project,
            file,
        };
        match module {
            ModuleRef::File(file) => ProgramModule::File(in_project(file)),
            ModuleRef::Inner { file, callback } => ProgramModule::Inner {
                file: in_project(file),
                callback,
            },
            ModuleRef::Facade(file) => ProgramModule::Facade(in_project(file)),
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

fn order_in_file(module: ProgramModule) -> Option<(ProgramFile, u8, u32)> {
    match module {
        ProgramModule::File(file) => Some((file, 0, 0)),
        ProgramModule::Inner { file, callback } => Some((file, 1, callback.0)),
        ProgramModule::Facade(file) => Some((file, 2, 0)),
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

fn order_of_variant(key: ProgramVariableKey) -> u8 {
    match key {
        ProgramVariableKey::Declared(_) => 0,
        ProgramVariableKey::SyntheticExport { .. } => 1,
        ProgramVariableKey::Copy { .. } => 2,
        ProgramVariableKey::MockOfRuntimeModule(_) => 3,
    }
}

pub(super) fn compare_program_variable_keys(
    a: ProgramVariableKey,
    b: ProgramVariableKey,
    atoms: &Interner<'_>,
) -> Ordering {
    use ProgramVariableKey as Key;
    let by_variant = order_of_variant(a).cmp(&order_of_variant(b));
    by_variant.then_with(|| match (a, b) {
        (Key::Declared(a), Key::Declared(b)) => a.cmp(&b),
        (
            Key::SyntheticExport {
                module: a_module,
                name: a_name,
            },
            Key::SyntheticExport {
                module: b_module,
                name: b_name,
            },
        )
        | (
            Key::Copy {
                module: a_module,
                name: a_name,
            },
            Key::Copy {
                module: b_module,
                name: b_name,
            },
        ) => compare_program_modules(a_module, b_module, atoms)
            .then_with(|| atoms.bytes(a_name).cmp(atoms.bytes(b_name))),
        (Key::MockOfRuntimeModule(a), Key::MockOfRuntimeModule(b)) => a.cmp(&b),
        _ => unreachable!("keys of two variants are ordered by the variant"),
    })
}

#[inline]
fn join_rank(project: ProjectId, variant: u32, words: [u32; 3]) -> u128 {
    let [first, second, third] = words;
    let head = (project as u32) << 16 | variant;
    u128::from(number_of_pair(head, first)) << 64 | u128::from(number_of_pair(second, third))
}

impl OrderedKey for ProgramFunctionKey {
    #[inline]
    fn rank(&self) -> u128 {
        let (variant, file, second) = match self.key {
            FunctionKey::ModuleBody(file) => (0, file, 0),
            FunctionKey::WrappedModuleBody(file) => (1, file, 0),
            FunctionKey::FacadeBody(file) => (2, file, 0),
            FunctionKey::CheckBody(file) => (3, file, 0),
            FunctionKey::Instantiation(file) => (4, file, 0),
            FunctionKey::Source(it) => (5, it.file, it.function.0),
            FunctionKey::Signature(it) => (6, it.file, it.function.0),
            FunctionKey::ClassSignature(it) => (7, it.file, it.class.0),
            FunctionKey::ImplicitConstructor(it) => (8, it.file, it.class.0),
            FunctionKey::InstanceInitializer(it) => (9, it.file, it.class.0),
            FunctionKey::StaticInitializer(it) => (10, it.file, it.class.0),
            FunctionKey::AccessorGetter { file, member } => (11, file, member.0),
            FunctionKey::AccessorSetter { file, member } => (12, file, member.0),
            FunctionKey::PrivateNameTest { file, member } => (13, file, member.0),
        };
        join_rank(self.project, variant, [file.0, second, 0])
    }

    fn compare(&self, other: &Self, _: &Interner<'_>) -> Ordering {
        self.cmp(other)
    }
}

impl OrderedKey for ProgramLayoutKey {
    fn rank(&self) -> u128 {
        let high = |number: u64| (number >> 32) as u32;
        let (variant, words) = match self.key {
            LayoutKey::Class(it) => (0x000, [it.file.0, it.class.0, 0]),
            LayoutKey::ConstructorFunction(it) => (0x100, [it.file.0, it.function.0, 0]),
            LayoutKey::Library(_) => (0x200, [0; 3]),
            LayoutKey::ObjectType {
                origin,
                instantiation: TypeIdentity([first, second]),
            } => match origin {
                ObjectOrigin::Symbol(it) => (0x300, [it.file.0, it.id.0, high(first)]),
                ObjectOrigin::TypeLiteral { file, node } => (0x301, [file.0, node.0, high(first)]),
                ObjectOrigin::MappedType { file, node } => (0x302, [file.0, node.0, high(first)]),
                ObjectOrigin::ObjectLiteral { file, expression } => {
                    (0x303, [file.0, expression.0, high(first)])
                }
                ObjectOrigin::Computed => (0x304, [high(first), first as u32, high(second)]),
            },
            LayoutKey::UntypedLiteral {
                file,
                members: TypeIdentity([first, _]),
            } => (0x400, [file.0, high(first), first as u32]),
            LayoutKey::CreatedObject { file, call } => (0x500, [file.0, call, 0]),
            LayoutKey::Container(it) => (0x600, [it.file.0, it.id.0, 0]),
            LayoutKey::Environment { file, environment } => (0x700, [file.0, environment, 0]),
            LayoutKey::ModuleInstance(file) => (0x800, [file.0, 0, 0]),
        };
        join_rank(self.project, variant, words)
    }

    fn compare(&self, other: &Self, _: &Interner<'_>) -> Ordering {
        self.cmp(other)
    }
}

impl OrderedKey for ProgramVariableKey {
    #[inline]
    fn rank(&self) -> u128 {
        let ProgramVariableKey::Declared(declared) = *self else {
            return u128::from(order_of_variant(*self)) << 120;
        };
        let (variant, first, second) = match declared.key {
            VariableKey::Symbol(it) => (0, it.file.0, it.id.0),
            VariableKey::SyntheticExport(id) => (1, id.0, 0),
            VariableKey::Copy(id) => (2, id.0, 0),
            VariableKey::ModuleExports(file) => (3, file.0, 0),
            VariableKey::InnerModuleExports(it) => (4, it.file.0, it.function.0),
            VariableKey::ClassSlot { class, .. } => (5, class.file.0, class.class.0),
            VariableKey::ModulePath { file, variable } => (6, file.0, variable as u32),
            VariableKey::PrivateState { state, .. } => (7, state.file.0, state.id.0),
            VariableKey::RequiredAnswer(it) => (8, it.file.0, it.id.0),
            VariableKey::MockOf(file) => (10, file.0, 0),
            VariableKey::InstantiationState(file) => (11, file.0, 0),
            VariableKey::EnvironmentMadeAhead(file) => (12, file.0, 0),
            VariableKey::MockOfRuntimeModule(_) => (13, 0, 0),
            VariableKey::RequiresMadeForOwnFile(file) => (14, file.0, 0),
            VariableKey::RequiresMadeForOtherFolders(file) => (15, file.0, 0),
            VariableKey::RequiresMadeForPaths(file) => (16, file.0, 0),
            VariableKey::InstanceOf(file) => (17, file.0, 0),
            VariableKey::InstanceAllocator(file) => (18, file.0, 0),
        };
        join_rank(declared.project, variant, [first, second, 0])
    }

    fn compare(&self, other: &Self, atoms: &Interner<'_>) -> Ordering {
        compare_program_variable_keys(*self, *other, atoms)
    }
}
