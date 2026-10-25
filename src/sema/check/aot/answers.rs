use crate::atom::Atom;
use crate::hir::{ClassId, ExprId, FnId, MemberId, ParamId, TypeParamId};
use crate::program::FileId;
use crate::types::{EnumValue, SigId, TypeId};

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
#[repr(u8)]
pub enum GaveUp {
    Unresolved,
    ErrorType,
    FlowAnalysisDisabled,
    UnreachedNode,
}

impl GaveUp {
    pub const COUNT: usize = 4;
    pub const ALL: [GaveUp; GaveUp::COUNT] = [
        GaveUp::Unresolved,
        GaveUp::ErrorType,
        GaveUp::FlowAnalysisDisabled,
        GaveUp::UnreachedNode,
    ];

    pub(super) fn is_function_of_key(self) -> bool {
        match self {
            GaveUp::Unresolved | GaveUp::FlowAnalysisDisabled => false,
            GaveUp::ErrorType | GaveUp::UnreachedNode => true,
        }
    }
}

#[derive(Copy, Clone, Default, Debug)]
pub struct QueryStatistics {
    pub asked: u64,
    pub gave_up: [u32; GaveUp::COUNT],
    pub members_gave_up: [u32; GaveUp::COUNT],
    /// See `Checker::closed_cycle_count`.
    pub closed_cycles: u32,
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum WrittenType {
    Written(TypeId),
    Unwritten,
    GaveUp(GaveUp),
}

impl WrittenType {
    pub fn written(self) -> Option<TypeId> {
        match self {
            WrittenType::Written(ty) => Some(ty),
            WrittenType::Unwritten | WrittenType::GaveUp(_) => None,
        }
    }

    pub(super) fn from_result(result: Result<TypeId, GaveUp>) -> WrittenType {
        match result {
            Ok(ty) => WrittenType::Written(ty),
            Err(reason) => WrittenType::GaveUp(reason),
        }
    }

    pub(super) fn and_then(
        self,
        next: impl FnOnce(TypeId) -> Result<TypeId, GaveUp>,
    ) -> WrittenType {
        match self {
            WrittenType::Written(ty) => WrittenType::from_result(next(ty)),
            WrittenType::Unwritten | WrittenType::GaveUp(_) => self,
        }
    }
}

pub type CheckedType = Result<TypeId, GaveUp>;

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub struct PositionTypes {
    pub written: WrittenType,
    pub checked: CheckedType,
}

impl PositionTypes {
    pub(super) fn unwritten(checked: CheckedType) -> PositionTypes {
        PositionTypes {
            written: WrittenType::Unwritten,
            checked,
        }
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Debug)]
pub struct ClassRef {
    pub file: FileId,
    pub class: ClassId,
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Debug)]
pub struct FunctionRef {
    pub file: FileId,
    pub function: FnId,
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Debug)]
pub struct TypeParameterRef {
    pub file: FileId,
    pub parameter: TypeParamId,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct TypeArgument {
    pub parameter: TypeId,
    pub argument: TypeId,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct EnumConstant {
    pub value: EnumValue,
    pub reads_other_file_or_variable: bool,
    pub rests_on_inexact_power: bool,
}

impl EnumConstant {
    pub fn value_known_to_build(self) -> Option<EnumValue> {
        let is_known = !self.reads_other_file_or_variable && !self.rests_on_inexact_power;
        is_known.then_some(self.value)
    }
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub struct TypeDisplayName {
    pub text: Vec<u8>,
    pub file: FileId,
    pub position: u32,
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum MemberName {
    String(Atom),
    Symbol(Atom),
    Private(Atom),
}

/// The call `Symbol(description)` that makes the symbol of a `const`.
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub struct SymbolCreation {
    pub file: FileId,
    /// Of the callee.
    pub position: u32,
    pub description: Option<Atom>,
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Debug)]
#[repr(u8)]
pub enum ObjectMemberKind {
    Field,
    Method,
    Getter,
    Setter,
    GetterAndSetter,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct ObjectMember {
    pub name: MemberName,
    pub kind: ObjectMemberKind,
    pub types: PositionTypes,
    pub is_optional: bool,
    pub is_readonly: bool,
}

/// An `ObjectMember` for whoever does not ask what was written.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct CheckedMember {
    pub name: MemberName,
    pub kind: ObjectMemberKind,
    pub checked: CheckedType,
    pub is_optional: bool,
    pub is_readonly: bool,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct ListedMember {
    pub name: MemberName,
    pub kind: ObjectMemberKind,
    pub is_optional: bool,
    pub property_index: u32,
}

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Debug)]
#[repr(u8)]
pub enum IndexKey {
    String,
    Number,
    Symbol,
    Pattern,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct IndexSignature {
    pub key: IndexKey,
    pub types: PositionTypes,
    pub is_readonly: bool,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum MemberLookup {
    Member(ObjectMember),
    Index(IndexSignature),
    Absent,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct CallTarget {
    pub signature: SigId,
    pub declaration: Option<FunctionRef>,
    pub result: PositionTypes,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct SignatureParameter {
    pub types: PositionTypes,
    pub is_optional: bool,
    pub is_rest: bool,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct SignatureShape<'c> {
    pub declaration: Option<FunctionRef>,
    pub this_type: PositionTypes,
    pub parameters: &'c [SignatureParameter],
    pub result: PositionTypes,
    pub has_type_parameters: bool,
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Debug)]
pub enum ClassDeclaration {
    Class(ClassRef),
    Function(FunctionRef),
}

impl ClassDeclaration {
    pub fn file(self) -> FileId {
        match self {
            ClassDeclaration::Class(class) => class.file,
            ClassDeclaration::Function(function) => function.file,
        }
    }
}

/// What a class or a constructor function inherits from.
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum ClassParent {
    Declared(ClassDeclaration),
    /// A class or a function of Bun's own modules, where the program is another one. Its file is one of theirs.
    Library(ClassDeclaration),
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum ClassMemberSource {
    Member(MemberId),
    ParameterProperty(ParamId),
    ThisStore(ExprId),
    PrototypeStore(ExprId),
    StaticStore(ExprId),
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct ClassMember {
    pub name: MemberName,
    pub kind: ObjectMemberKind,
    pub source: ClassMemberSource,
    pub types: PositionTypes,
    pub is_static: bool,
    pub is_optional: bool,
}

pub struct ClassShape<'c> {
    pub declaration: ClassDeclaration,
    pub members: &'c [ClassMember],
    /// The names that stores put into the prototype object, also where `members` lists the name as a field of the instances.
    pub names_stored_in_prototype: &'c [MemberName],
    pub has_computed_instance_name: bool,
    pub has_computed_static_name: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gave_up_count_matches_all() {
        assert_eq!(GaveUp::ALL.len(), GaveUp::COUNT);
        for (index, reason) in GaveUp::ALL.into_iter().enumerate() {
            assert_eq!(reason as usize, index);
        }
    }

    #[test]
    fn only_cut_answers_are_not_memoized() {
        let not_memoized: Vec<GaveUp> = GaveUp::ALL
            .into_iter()
            .filter(|reason| !reason.is_function_of_key())
            .collect();
        assert_eq!(
            not_memoized,
            [GaveUp::Unresolved, GaveUp::FlowAnalysisDisabled]
        );
    }

    #[test]
    fn type_parameters_are_ordered_by_file_then_by_declaration() {
        let at = |file, parameter| TypeParameterRef {
            file: FileId(file),
            parameter: TypeParamId(parameter),
        };
        let mut parameters = [at(2, 0), at(1, 3), at(1, 0)];
        parameters.sort();
        assert_eq!(parameters, [at(1, 0), at(1, 3), at(2, 0)]);
    }

    #[test]
    fn written_type_keeps_its_state() {
        let next = |_| Ok(TypeId::NUMBER);
        assert_eq!(
            WrittenType::Written(TypeId::STRING).and_then(next),
            WrittenType::Written(TypeId::NUMBER)
        );
        assert_eq!(
            WrittenType::Unwritten.and_then(next),
            WrittenType::Unwritten
        );
        let gave_up = WrittenType::GaveUp(GaveUp::ErrorType);
        assert_eq!(gave_up.and_then(next), gave_up);
        assert_eq!(gave_up.written(), None);
    }
}
