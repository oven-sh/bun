use bun_sema::bind::CommonJsVariable;
use bun_sema::check::aot::{ClassDeclaration, ClassRef, FunctionRef, ObjectOrigin, TypeIdentity};
use bun_sema::hir::MemberId;
use bun_sema::program::{FileId, Sym};

use crate::builtins::RuntimeModule;
use crate::modules::SyntheticExportId;

#[derive(Copy, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Debug)]
pub enum FunctionKey {
    ModuleBody(FileId),
    WrappedModuleBody(FileId),
    FaceBody(FileId),
    CheckBody(FileId),
    Instantiation(FileId),
    Source(FunctionRef),
    Signature(FunctionRef),
    ClassSignature(ClassRef),
    ImplicitConstructor(ClassRef),
    InstanceInitializer(ClassRef),
    StaticInitializer(ClassRef),
    AccessorGetter { file: FileId, member: MemberId },
    AccessorSetter { file: FileId, member: MemberId },
    PrivateNameTest { file: FileId, member: MemberId },
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Debug)]
pub enum LayoutKey {
    Class(ClassRef),
    ConstructorFunction(FunctionRef),
    Library(ClassDeclaration),
    ObjectType {
        origin: ObjectOrigin,
        instantiation: TypeIdentity,
    },
    UntypedLiteral {
        file: FileId,
        members: TypeIdentity,
    },
    CreatedObject {
        file: FileId,
        call: u32,
    },
    Container(Sym),
    Environment {
        file: FileId,
        environment: u32,
    },
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Debug)]
pub enum ClassSlot {
    ClassObject,
    ClassToken,
    ComputedKey(MemberId),
    StaticField(MemberId),
    PrivateMethod(MemberId),
    DecoratorState,
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Debug)]
pub enum PrivateStatePart {
    Collection,
    Token,
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Debug)]
pub enum VariableKey {
    Symbol(Sym),
    SyntheticExport(SyntheticExportId),
    Copy(SyntheticExportId),
    ModuleExports(FileId),
    InnerModuleExports(FunctionRef),
    ClassSlot {
        class: ClassRef,
        slot: ClassSlot,
    },
    ModulePath {
        file: FileId,
        variable: CommonJsVariable,
    },
    PrivateState {
        state: Sym,
        part: PrivateStatePart,
    },
    RequiredAnswer(Sym),
    MockOf(FileId),
    InstantiationState(FileId),
    EnvironmentMadeAhead(FileId),
    MockOfRuntimeModule(RuntimeModule),
    RequiresMadeForOwnFile(FileId),
    RequiresMadeForOtherFolders(FileId),
}

impl FunctionKey {
    pub fn home_file(&self) -> FileId {
        match *self {
            FunctionKey::ModuleBody(file)
            | FunctionKey::WrappedModuleBody(file)
            | FunctionKey::FaceBody(file)
            | FunctionKey::CheckBody(file)
            | FunctionKey::Instantiation(file)
            | FunctionKey::AccessorGetter { file, .. }
            | FunctionKey::AccessorSetter { file, .. }
            | FunctionKey::PrivateNameTest { file, .. } => file,
            FunctionKey::Source(function) | FunctionKey::Signature(function) => function.file,
            FunctionKey::ClassSignature(class)
            | FunctionKey::ImplicitConstructor(class)
            | FunctionKey::InstanceInitializer(class)
            | FunctionKey::StaticInitializer(class) => class.file,
        }
    }
}

impl LayoutKey {
    pub fn has_united_definitions(&self) -> bool {
        matches!(
            self,
            LayoutKey::ObjectType {
                origin: ObjectOrigin::Computed,
                ..
            }
        )
    }

    pub fn home_file(&self) -> Option<FileId> {
        match *self {
            LayoutKey::Class(class) => Some(class.file),
            LayoutKey::ConstructorFunction(function) => Some(function.file),
            LayoutKey::Library(_) => None,
            LayoutKey::ObjectType { origin, .. } => match origin {
                ObjectOrigin::Symbol(symbol) => Some(symbol.file),
                ObjectOrigin::TypeLiteral { file, .. }
                | ObjectOrigin::MappedType { file, .. }
                | ObjectOrigin::ObjectLiteral { file, .. } => Some(file),
                ObjectOrigin::Computed => None,
            },
            LayoutKey::UntypedLiteral { file, .. }
            | LayoutKey::CreatedObject { file, .. }
            | LayoutKey::Environment { file, .. } => Some(file),
            LayoutKey::Container(symbol) => Some(symbol.file),
        }
    }
}

impl VariableKey {
    pub fn home_file(&self) -> Option<FileId> {
        match *self {
            VariableKey::Symbol(symbol) => Some(symbol.file),
            VariableKey::ClassSlot { class, .. } => Some(class.file),
            VariableKey::ModuleExports(file)
            | VariableKey::ModulePath { file, .. }
            | VariableKey::MockOf(file)
            | VariableKey::InstantiationState(file)
            | VariableKey::RequiresMadeForOwnFile(file)
            | VariableKey::RequiresMadeForOtherFolders(file)
            | VariableKey::EnvironmentMadeAhead(file) => Some(file),
            VariableKey::InnerModuleExports(callback) => Some(callback.file),
            VariableKey::PrivateState { state, .. } => Some(state.file),
            VariableKey::RequiredAnswer(holder) => Some(holder.file),
            VariableKey::SyntheticExport(_)
            | VariableKey::Copy(_)
            | VariableKey::MockOfRuntimeModule(_) => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use bun_sema::bind::SymbolId;
    use bun_sema::hir::{ClassId, ExprId, FnId, TypeNodeId};

    use super::*;

    const FILE: FileId = FileId(7);
    const MEMBER: MemberId = MemberId(5);
    const IDENTITY: TypeIdentity = TypeIdentity([3, 4]);
    const SYMBOL: Sym = Sym {
        file: FILE,
        id: SymbolId(6),
    };
    const CLASS: ClassRef = ClassRef {
        file: FILE,
        class: ClassId(1),
    };
    const FUNCTION: FunctionRef = FunctionRef {
        file: FILE,
        function: FnId(2),
    };

    #[test]
    fn function_key_home_file() {
        let keys = [
            FunctionKey::ModuleBody(FILE),
            FunctionKey::WrappedModuleBody(FILE),
            FunctionKey::FaceBody(FILE),
            FunctionKey::CheckBody(FILE),
            FunctionKey::Instantiation(FILE),
            FunctionKey::Source(FUNCTION),
            FunctionKey::Signature(FUNCTION),
            FunctionKey::ClassSignature(CLASS),
            FunctionKey::ImplicitConstructor(CLASS),
            FunctionKey::InstanceInitializer(CLASS),
            FunctionKey::StaticInitializer(CLASS),
            FunctionKey::AccessorGetter {
                file: FILE,
                member: MEMBER,
            },
            FunctionKey::AccessorSetter {
                file: FILE,
                member: MEMBER,
            },
            FunctionKey::PrivateNameTest {
                file: FILE,
                member: MEMBER,
            },
        ];
        for key in keys {
            assert_eq!(key.home_file(), FILE, "{key:?}");
        }
    }

    #[test]
    fn layout_key_home_file() {
        let origins = [
            ObjectOrigin::Symbol(SYMBOL),
            ObjectOrigin::TypeLiteral {
                file: FILE,
                node: TypeNodeId(8),
            },
            ObjectOrigin::MappedType {
                file: FILE,
                node: TypeNodeId(8),
            },
            ObjectOrigin::ObjectLiteral {
                file: FILE,
                expression: ExprId(9),
            },
        ];
        let mut keys = vec![
            LayoutKey::Class(CLASS),
            LayoutKey::ConstructorFunction(FUNCTION),
            LayoutKey::UntypedLiteral {
                file: FILE,
                members: IDENTITY,
            },
            LayoutKey::Container(SYMBOL),
            LayoutKey::Environment {
                file: FILE,
                environment: 0,
            },
        ];
        keys.extend(origins.map(|origin| LayoutKey::ObjectType {
            origin,
            instantiation: IDENTITY,
        }));
        for key in keys {
            assert_eq!(key.home_file(), Some(FILE), "{key:?}");
        }
        let computed = LayoutKey::ObjectType {
            origin: ObjectOrigin::Computed,
            instantiation: IDENTITY,
        };
        assert_eq!(computed.home_file(), None);
    }

    #[test]
    fn variable_key_home_file() {
        let slots = [
            ClassSlot::ClassObject,
            ClassSlot::ClassToken,
            ClassSlot::ComputedKey(MEMBER),
            ClassSlot::StaticField(MEMBER),
            ClassSlot::PrivateMethod(MEMBER),
            ClassSlot::DecoratorState,
        ];
        for slot in slots {
            let key = VariableKey::ClassSlot { class: CLASS, slot };
            assert_eq!(key.home_file(), Some(FILE), "{key:?}");
        }
        assert_eq!(VariableKey::Symbol(SYMBOL).home_file(), Some(FILE));
        assert_eq!(VariableKey::ModuleExports(FILE).home_file(), Some(FILE));
        assert_eq!(
            VariableKey::InnerModuleExports(FUNCTION).home_file(),
            Some(FILE)
        );
        assert_eq!(VariableKey::RequiredAnswer(SYMBOL).home_file(), Some(FILE));
        for part in [PrivateStatePart::Collection, PrivateStatePart::Token] {
            let state = SYMBOL;
            let key = VariableKey::PrivateState { state, part };
            assert_eq!(key.home_file(), Some(FILE), "{key:?}");
        }
        let synthetic_export = VariableKey::SyntheticExport(SyntheticExportId(9));
        assert_eq!(synthetic_export.home_file(), None);
        assert_eq!(VariableKey::Copy(SyntheticExportId(9)).home_file(), None);
    }

    #[test]
    fn same_members_in_two_files_are_two_layouts() {
        let first = LayoutKey::UntypedLiteral {
            file: FileId(1),
            members: IDENTITY,
        };
        let second = LayoutKey::UntypedLiteral {
            file: FileId(2),
            members: IDENTITY,
        };
        assert_ne!(first, second);
    }
}
