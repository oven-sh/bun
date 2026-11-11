use crate::atom::Atom;
use crate::hir::{ClassId, ExprId, FnId, MemberId, ParamId, TypeParamId};
use crate::program::{FileId, Sym};
use crate::types::{EnumValue, SigId, TypeId};

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
#[repr(u8)]
pub enum GaveUp {
    Unresolved,
    ErrorType,
    FlowAnalysisDisabled,
    UnreachedNode,
    OutOfStack,
}

impl GaveUp {
    pub const COUNT: usize = 5;
    #[cfg(test)]
    pub const ALL: [GaveUp; GaveUp::COUNT] = [
        GaveUp::Unresolved,
        GaveUp::ErrorType,
        GaveUp::FlowAnalysisDisabled,
        GaveUp::UnreachedNode,
        GaveUp::OutOfStack,
    ];

    pub(super) fn is_function_of_key(self) -> bool {
        match self {
            GaveUp::Unresolved | GaveUp::FlowAnalysisDisabled | GaveUp::OutOfStack => false,
            GaveUp::ErrorType | GaveUp::UnreachedNode => true,
        }
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
#[repr(u8)]
pub enum QueryLimit {
    ConstructorParentsFollowed,
    FunctionsGivenThis,
    TermsReadForProduct,
    DeclaredSignatureDepth,
}

impl QueryLimit {
    pub const COUNT: usize = 4;
    pub const ALL: [QueryLimit; QueryLimit::COUNT] = [
        QueryLimit::ConstructorParentsFollowed,
        QueryLimit::FunctionsGivenThis,
        QueryLimit::TermsReadForProduct,
        QueryLimit::DeclaredSignatureDepth,
    ];
}

#[derive(Copy, Clone, Debug)]
pub struct QueryLimits(pub [u64; QueryLimit::COUNT]);

impl QueryLimits {
    #[inline]
    pub fn get(&self, limit: QueryLimit) -> u64 {
        self.0[limit as usize]
    }
}

impl Default for QueryLimits {
    fn default() -> QueryLimits {
        QueryLimits(QueryLimit::ALL.map(|limit| match limit {
            QueryLimit::ConstructorParentsFollowed => 64,
            QueryLimit::FunctionsGivenThis => 32,
            QueryLimit::TermsReadForProduct => 16,
            QueryLimit::DeclaredSignatureDepth => 3,
        }))
    }
}

#[derive(Copy, Clone, Default, Debug)]
pub struct QueryStatistics {
    pub asked: u64,
    pub limit_hits: [u32; QueryLimit::COUNT],
    pub gave_up: [u32; GaveUp::COUNT],
    pub members_gave_up: [u32; GaveUp::COUNT],
    pub closed_cycles: u32,
    pub union_members_compared: u64,
    pub types_inferred: u64,
    pub usages_walked: u64,
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum WrittenType {
    Written(TypeId),
    Unwritten,
    GaveUp(GaveUp),
}

impl WrittenType {
    #[inline]
    pub fn written(self) -> Option<TypeId> {
        match self {
            WrittenType::Written(ty) => Some(ty),
            WrittenType::Unwritten | WrittenType::GaveUp(_) => None,
        }
    }

    #[inline]
    pub(super) fn from_result(result: Result<TypeId, GaveUp>) -> WrittenType {
        match result {
            Ok(ty) => WrittenType::Written(ty),
            Err(reason) => WrittenType::GaveUp(reason),
        }
    }

    #[inline]
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
    #[inline]
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

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum MemberName {
    String(Atom),
    Symbol(Atom),
    Private(Atom),
}

impl MemberName {
    #[inline]
    pub(super) fn atom(self) -> Atom {
        let (MemberName::String(name) | MemberName::Symbol(name) | MemberName::Private(name)) =
            self;
        name
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub struct SymbolCreation {
    pub file: FileId,
    pub call_number: u32,
    pub description: Option<Atom>,
    pub is_registered: bool,
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

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct CheckedMember {
    pub name: MemberName,
    pub kind: ObjectMemberKind,
    pub checked: CheckedType,
    pub is_optional: bool,
    pub is_readonly: bool,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct MemberTypedOtherwise {
    pub kind_in_base: ObjectMemberKind,
    pub checked: TypeId,
    pub in_base: TypeId,
    pub is_method_above: bool,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct MethodsAbove {
    pub(super) class: Sym,
    pub count: usize,
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
pub struct WrittenParameter {
    pub written: WrittenType,
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

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum ClassParent {
    Declared(ClassDeclaration),
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
    pub is_made_at_birth: bool,
    pub form: MemberForm,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug, Default)]
pub struct MemberForm {
    pub is_read_only: bool,
    pub is_not_enumerable: bool,
    pub is_not_configurable: bool,
}

pub struct ClassShape<'c> {
    pub declaration: ClassDeclaration,
    pub members: &'c [ClassMember],
    pub names_stored_in_prototype: &'c [MemberName],
    pub has_computed_instance_name: bool,
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
            [
                GaveUp::Unresolved,
                GaveUp::FlowAnalysisDisabled,
                GaveUp::OutOfStack
            ]
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
