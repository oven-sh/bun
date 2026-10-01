#![allow(dead_code)]
use bun_ast::Ref;

#[derive(Clone, Default)]
pub struct FnOrArrowDataParse { pub allow_await: bool, pub allow_super_call: bool, pub allow_super_property: bool }

#[derive(Default)]
pub struct StmtScope;
impl StmtScope { pub fn is_module(&self) -> bool { false } }
#[derive(Default)]
pub struct ParseStatementOptions { pub is_export: bool, pub scope: StmtScope }

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum SkipTypeParameterResult { DidNotSkipAnything, CouldBeTypeCast, DefinitelyTypeParameters }

#[derive(Clone, Copy, Default)]
pub struct TypeParameterFlag(u8);
impl TypeParameterFlag {
    pub const ALLOW_IN_OUT_VARIANCE_ANNOTATIONS: Self = Self(1);
    pub const ALLOW_CONST_MODIFIER: Self = Self(2);
    pub const ALLOW_EMPTY_TYPE_PARAMETERS: Self = Self(4);
    pub fn contains(self, other: Self) -> bool { self.0 & other.0 == other.0 }
}
impl core::ops::BitOr for TypeParameterFlag { type Output = Self; fn bitor(self, o: Self) -> Self { Self(self.0 | o.0) } }

pub struct FindSymbolResult {
    pub(crate) r#ref: Ref,
    pub(crate) declare_loc: Option<bun_ast::Loc>,
    pub(crate) is_inside_with_scope: bool,
}
