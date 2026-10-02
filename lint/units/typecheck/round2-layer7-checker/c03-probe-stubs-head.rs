// Stand-ins with the signatures of the tree: c01_data.rs, c02_program_checker.rs, types.rs, mapper.rs, links.rs, flow.rs and the methods of the checker that c03_init.rs calls.
use crate::ast::flags::define_flags;
use crate::ast::{
    Arg, Ast, CheckFlags, DiagnosticId, Id, NodeId, PatternAmbientModule, SymbolFlags, SymbolId,
    SymbolTableId,
};
use crate::core::{
    CompilerOptions, Link, LinkStore, List, Map, Memo, ModuleKind, ModuleResolutionKind,
    ScriptTarget, Text, Tristate,
};
use crate::diagnostics::MessageId;
use crate::evaluator;
use crate::jsnum::{Number, PseudoBigInt};
use std::marker::PhantomData;
use std::ops::{Index, IndexMut};

macro_rules! define_checker_id {
    ($($name:ident),* $(,)?) => {$(
        #[repr(transparent)]
        #[derive(Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Default, Debug)]
        pub struct $name(pub u32);
        impl $name {
            pub const NIL: Self = Self(0);
            pub const fn is_nil(self) -> bool {
                self.0 == 0
            }
        }
        impl Id for $name {
            fn from_u32(v: u32) -> Self {
                Self(v)
            }
            fn to_u32(self) -> u32 {
                self.0
            }
        }
    )*};
}
define_checker_id!(TypeId, SignatureId, TypeMapperId, IndexInfoId, TypePredicateId);

define_flags!(TypeFlags: u32 {
    ANY = 1 << 0,
    UNKNOWN = 1 << 1,
    UNDEFINED = 1 << 2,
    NULL = 1 << 3,
    VOID = 1 << 4,
    STRING = 1 << 5,
    NUMBER = 1 << 6,
    BIG_INT = 1 << 7,
    ES_SYMBOL = 1 << 9,
    BOOLEAN_LITERAL = 1 << 13,
    NON_PRIMITIVE = 1 << 17,
    NEVER = 1 << 18,
    UNION = 1 << 27,
    PRIMITIVE = 1 << 5 | 1 << 6,
});
define_flags!(ObjectFlags: u32 {
    ANONYMOUS = 1 << 4,
    CONTAINS_WIDENING_TYPE = 1 << 16,
    NON_INFERRABLE_TYPE = 1 << 18,
});
define_flags!(SignatureFlags: u32 { HAS_REST_PARAMETER = 1 << 0 });
define_flags!(VarianceFlags: u32 { COVARIANT = 1 << 0 });
define_flags!(RelationComparisonResult: u32 {
    REPORTS_UNMEASURABLE = 1 << 3,
    REPORTS_UNRELIABLE = 1 << 4,
});
define_flags!(TypePredicateKind: i32 { THIS = 0, IDENTIFIER = 1 });
define_flags!(MembersOrExportsResolutionKind: isize {
    RESOLVED_EXPORTS = 0,
    RESOLVED_MEMBERS = 1,
});
define_flags!(TypeFacts: u32 { TYPEOF_NE_STRING = 1 << 8 });

// flow.rs 1065
pub const TYPEOF_NE_FACTS: [(&[u8], TypeFacts); 8] = [
    (b"bigint", TypeFacts::TYPEOF_NE_STRING),
    (b"boolean", TypeFacts::TYPEOF_NE_STRING),
    (b"function", TypeFacts::TYPEOF_NE_STRING),
    (b"number", TypeFacts::TYPEOF_NE_STRING),
    (b"object", TypeFacts::TYPEOF_NE_STRING),
    (b"string", TypeFacts::TYPEOF_NE_STRING),
    (b"symbol", TypeFacts::TYPEOF_NE_STRING),
    (b"undefined", TypeFacts::TYPEOF_NE_STRING),
];

// types.rs 199
pub struct Records<I, T> {
    items: Vec<T>,
    marker: PhantomData<fn() -> I>,
}
impl<I: Id, T: Default> Default for Records<I, T> {
    fn default() -> Self {
        Self {
            items: vec![T::default()],
            marker: PhantomData,
        }
    }
}
impl<I: Id, T: Default> Records<I, T> {
    pub fn alloc(&mut self, value: T) -> I {
        self.items.push(value);
        I::from_u32(self.items.len() as u32 - 1)
    }
}
impl<I: Id, T: Default> Index<I> for Records<I, T> {
    type Output = T;
    fn index(&self, id: I) -> &T {
        &self.items[id.to_u32() as usize]
    }
}
impl<I: Id, T: Default> IndexMut<I> for Records<I, T> {
    fn index_mut(&mut self, id: I) -> &mut T {
        &mut self.items[id.to_u32() as usize]
    }
}

#[derive(Default)]
pub struct Type<'a> {
    pub flags: TypeFlags,
    pub object_flags: ObjectFlags,
    pub symbol: SymbolId,
    pub name: Text<'a>,
}
#[derive(Clone, Default, PartialEq, Debug)]
pub enum LiteralValue<'a> {
    #[default]
    Nil,
    String(Text<'a>),
    Number(f64),
    Boolean(bool),
    BigInt(PseudoBigInt),
}
#[derive(Default)]
pub struct LiteralType<'a> {
    pub value: LiteralValue<'a>,
    pub fresh_type: TypeId,
    pub regular_type: TypeId,
}
#[derive(Default)]
pub struct ObjectType<'a> {
    pub target: TypeId,
    pub instantiations: Map<u64, TypeId>,
    pub marker: PhantomData<&'a ()>,
}
#[derive(Default)]
pub struct TypeParameter {
    pub constraint: TypeId,
}
#[derive(Default)]
pub struct InterfaceType<'a> {
    pub all_type_parameters: List<'a, TypeId>,
}
impl<'a> InterfaceType<'a> {
    pub fn type_parameters(&self) -> List<'a, TypeId> {
        self.all_type_parameters
    }
}
#[derive(Default)]
pub struct TypePredicate<'a> {
    pub kind: TypePredicateKind,
    pub parameter_index: i32,
    pub parameter_name: Text<'a>,
    pub t: TypeId,
}
#[derive(Default)]
pub struct IndexInfo<'a> {
    pub key_type: TypeId,
    pub value_type: TypeId,
    pub is_readonly: bool,
    pub declaration: NodeId,
    pub index_symbol: SymbolId,
    pub components: List<'a, NodeId>,
}
#[derive(Default)]
pub struct Relation {
    pub results: Map<u64, RelationComparisonResult>,
}
#[derive(Default)]
pub struct TypeAliasLinks<'a> {
    pub declared_type: TypeId,
    pub type_parameters: List<'a, TypeId>,
}
#[derive(Default)]
pub struct ValueSymbolLinks {
    pub resolved_type: TypeId,
}
// mapper.rs 23 and 363
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum FunctionMapper {
    UniqueLiteral,
    ReportUnreliable,
    ReportUnmeasurable,
    Restrictive,
    Permissive,
}
pub fn new_function_type_mapper(c: &mut Checker<'_>, f: FunctionMapper) -> TypeMapperId {
    let _ = (c.id, f);
    TypeMapperId(1)
}
// c02_program_checker.rs 70 and 135
pub trait Program<'p> {
    fn options(&self) -> &'p CompilerOptions;
    fn source_files(&self) -> &'p [NodeId];
    fn bind_source_files(&self);
}
#[derive(Default)]
pub struct CheckerArena<'a> {
    marker: PhantomData<&'a ()>,
}

