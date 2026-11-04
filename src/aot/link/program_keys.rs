#[cfg(test)]
mod tests;

use super::merged_keys::OrderedKey;
use crate::builtins::RuntimeModule;
use crate::ir::{FunctionKey, LayoutKey, VariableKey};
use crate::load::{ProgramFile, ProjectId, Sources};
use crate::modules::{ModuleGraph, ModuleRef};
use bun_ast::Loader;
use bun_sema::atom::{Atom, Interner};
use bun_sema::check::aot::{ClassDeclaration, FunctionRef};
use bun_sema::hir::FnId;
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

#[derive(Copy, Clone)]
pub struct KeyContext<'a> {
    pub project: ProjectId,
    pub graph: &'a ModuleGraph,
    pub runtime_sources: &'a Sources,
}

impl KeyContext<'_> {
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

fn order_of_variant(key: ProgramVariableKey) -> u8 {
    match key {
        ProgramVariableKey::Declared(_) => 0,
        ProgramVariableKey::SyntheticExport { .. } => 1,
        ProgramVariableKey::Copy { .. } => 2,
        ProgramVariableKey::MockOfRuntimeModule(_) => 3,
    }
}

/// Total, and equal only for equal keys. A name goes by its bytes: the number of an `Atom` differs from run to run.
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

impl OrderedKey for ProgramVariableKey {
    fn compare(&self, other: &Self, atoms: &Interner<'_>) -> Ordering {
        compare_program_variable_keys(*self, *other, atoms)
    }
}
