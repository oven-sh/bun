pub mod answers;
pub mod builtin_types;
mod call_target;
mod class_shape;
mod class_stores;
pub(in crate::check) mod compiled_file;
mod const_inlining;
mod constructor_evidence;
mod constructor_function_parents;
pub(in crate::check) mod constructor_functions;
mod dead_code;
mod declared_signatures;
pub mod diagnostic_class;
pub mod diagnostic_effect;
mod diagnostic_location;
pub mod diagnostic_subject;
pub(in crate::check) mod early_errors;
pub(in crate::check) mod enum_constants;
mod inferred_from_use;
mod kept_answers;
mod left_out_bodies;
mod member_types;
mod object_members;
mod program_symbols;
mod prototype_links;
pub mod queries;
pub mod query_writer;
pub mod trust;
mod type_arguments;
pub mod type_identity;
mod type_relations;
pub mod type_shape;
mod written_type;

pub use answers::{
    CallTarget, CheckedMember, CheckedType, ClassDeclaration, ClassMember, ClassMemberSource,
    ClassParent, ClassRef, ClassShape, EnumConstant, FunctionRef, GaveUp, IndexKey, IndexSignature,
    ListedMember, MemberLookup, MemberName, ObjectMember, ObjectMemberKind, PositionTypes,
    QueryStatistics, SignatureParameter, SignatureShape, SymbolCreation, TypeArgument,
    TypeDisplayName, TypeParameterRef, WrittenType,
};
pub use builtin_types::{
    BuiltinClassIndex, BuiltinTypeClass, BuiltinTypePath, BuiltinTypeSymbols, BuiltinValueIndex,
    BuiltinValuePath, Denotation,
};
pub use diagnostic_class::DiagnosticClass;
pub use diagnostic_effect::{Effect, FileOrigin, effect_of};
pub use diagnostic_subject::{DiagnosticSubject, containers_completed_by_bun_types};
pub(crate) use kept_answers::KeptAnswers;
pub use kept_answers::KeptFact;
pub use left_out_bodies::LeftOutBodies;
pub use program_symbols::COMPILER_DECLARATIONS_PATH;
pub use prototype_links::{NamedValue, NamedValues, PrototypeOperation};
pub use queries::{Queries, QueryInputs};
pub use query_writer::write_queries;
pub use trust::Trust;
pub use type_identity::{ObjectOrigin, TypeIdentity};
pub use type_relations::MemberPresence;
pub use type_shape::{
    AnythingReason, BuiltinShape, PrimitiveKinds, ShapeKind, TupleElement, TupleElementKind,
    TypeShape,
};
pub use written_type::declares_type_alone;

pub(in crate::check) use class_stores::StoreIndex;
pub(in crate::check) use dead_code::DeadCodeRanges;
pub(in crate::check) use left_out_bodies::LeftOutOfCheck;
pub(in crate::check) use program_symbols::ProgramSymbols;
pub(in crate::check) use prototype_links::PrototypeLinks;

pub use crate::program::FileRole;
