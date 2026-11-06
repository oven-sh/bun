use super::generated::{FunctionReferenceKind, ModuleReferenceKind};
use super::ids::{
    DataId, EvalScopeId, ExpectedResultId, FunctionId, Id, LayoutId, ModuleFailureId, ModuleId,
    PropertyKeyId, StringId, TypeId, TypeSiteId, VariableId,
};
use crate::builtins::id::BuiltinId;

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum ReferenceKind {
    String,
    PropertyKey,
    Type,
    TypeSite,
    ExpectedResult,
    Layout,
    Variable,
    Module(ModuleReferenceKind),
    ModuleFailure,
    EvalScope,
    Function(FunctionReferenceKind),
    Data,
    Builtin,
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum Reference {
    String(StringId),
    PropertyKey(PropertyKeyId),
    Type(TypeId),
    TypeSite(TypeSiteId),
    ExpectedResult(ExpectedResultId),
    Layout(LayoutId),
    Variable(VariableId),
    Module(ModuleId, ModuleReferenceKind),
    ModuleFailure(ModuleFailureId),
    EvalScope(EvalScopeId),
    Function(FunctionId, FunctionReferenceKind),
    Data(DataId),
    Builtin(BuiltinId),
}

impl Reference {
    pub fn from_word(kind: ReferenceKind, word: u32) -> Option<Reference> {
        Some(match kind {
            ReferenceKind::String => Reference::String(StringId::from_word(word)),
            ReferenceKind::PropertyKey => Reference::PropertyKey(PropertyKeyId::from_word(word)),
            ReferenceKind::Type => Reference::Type(TypeId::from_word(word)),
            ReferenceKind::TypeSite => Reference::TypeSite(TypeSiteId::from_word(word)),
            ReferenceKind::ExpectedResult => {
                Reference::ExpectedResult(ExpectedResultId::from_word(word))
            }
            ReferenceKind::Layout => Reference::Layout(LayoutId::from_word(word)),
            ReferenceKind::Variable => Reference::Variable(VariableId::from_word(word)),
            ReferenceKind::Module(role) => Reference::Module(ModuleId::from_word(word), role),
            ReferenceKind::ModuleFailure => {
                Reference::ModuleFailure(ModuleFailureId::from_word(word))
            }
            ReferenceKind::EvalScope => Reference::EvalScope(EvalScopeId::from_word(word)),
            ReferenceKind::Function(role) => Reference::Function(FunctionId::from_word(word), role),
            ReferenceKind::Data => Reference::Data(DataId::from_word(word)),
            ReferenceKind::Builtin => Reference::Builtin(BuiltinId::from_wire(word)?),
        })
    }
}

#[derive(Copy, Clone)]
pub struct IdMap<'a> {
    pub strings: &'a [Option<StringId>],
    pub property_keys: &'a [Option<PropertyKeyId>],
    pub types: &'a [Option<TypeId>],
    pub type_sites: &'a [Option<TypeSiteId>],
    pub expected_results: &'a [Option<ExpectedResultId>],
    pub layouts: &'a [Option<LayoutId>],
    pub variables: &'a [Option<VariableId>],
    pub modules: &'a [Option<ModuleId>],
    pub module_failures: &'a [Option<ModuleFailureId>],
    pub eval_scopes: &'a [Option<EvalScopeId>],
    pub functions: &'a [Option<FunctionId>],
    pub data: &'a [Option<DataId>],
}

#[inline]
pub fn remap<I: Id>(id: &mut I, map: &[Option<I>]) {
    *id = map[id.index()].expect("retained code names a dropped item");
}

#[inline]
pub fn remap_optional<I: Id>(id: &mut Option<I>, map: &[Option<I>]) {
    if let Some(id) = id {
        remap(id, map);
    }
}

#[inline]
fn remap_word<I: Id>(word: u32, map: &[Option<I>]) -> u32 {
    let mut id = I::from_word(word);
    remap(&mut id, map);
    id.to_word()
}

impl IdMap<'_> {
    pub fn remap_word(&self, kind: ReferenceKind, word: u32) -> u32 {
        match kind {
            ReferenceKind::String => remap_word(word, self.strings),
            ReferenceKind::PropertyKey => remap_word(word, self.property_keys),
            ReferenceKind::Type => remap_word(word, self.types),
            ReferenceKind::TypeSite => remap_word(word, self.type_sites),
            ReferenceKind::ExpectedResult => remap_word(word, self.expected_results),
            ReferenceKind::Layout => remap_word(word, self.layouts),
            ReferenceKind::Variable => remap_word(word, self.variables),
            ReferenceKind::Module(_) => remap_word(word, self.modules),
            ReferenceKind::ModuleFailure => remap_word(word, self.module_failures),
            ReferenceKind::EvalScope => remap_word(word, self.eval_scopes),
            ReferenceKind::Function(_) => remap_word(word, self.functions),
            ReferenceKind::Data => remap_word(word, self.data),
            ReferenceKind::Builtin => word,
        }
    }
}
