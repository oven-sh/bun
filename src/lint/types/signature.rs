//! `ts.Signature`, `ts.TypePredicate`, `ts.IndexInfo`

use super::symbol::SymbolList;
use super::ty::TypeList;
use super::{TsNode, TsSymbol, Type, TypePredicateKind};
use crate::ast::File;
use bun_sema::check::services::{IndexInfoData, SignatureInfo, TypePredicateData};
use bun_sema::types::SigId;

/// `ts.Signature`
#[derive(Copy, Clone)]
pub struct Signature<'a> {
    file: &'a File<'a>,
    id: SigId,
}

impl PartialEq for Signature<'_> {
    #[inline]
    fn eq(&self, other: &Self) -> bool {
        self.id == other.id
    }
}
impl Eq for Signature<'_> {}
impl std::hash::Hash for Signature<'_> {
    #[inline]
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        self.id.hash(state);
    }
}
impl std::fmt::Debug for Signature<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Signature({})", bstr::BStr::new(&self.to_text()))
    }
}

/// A list of signatures.
#[derive(Copy, Clone)]
pub struct SignatureList<'a> {
    file: &'a File<'a>,
    ids: &'a [SigId],
}

impl<'a> SignatureList<'a> {
    #[inline]
    pub(crate) fn new(file: &'a File<'a>, ids: &'a [SigId]) -> Self {
        SignatureList { file, ids }
    }

    #[inline]
    pub fn len(self) -> usize {
        self.ids.len()
    }

    #[inline]
    pub fn is_empty(self) -> bool {
        self.ids.is_empty()
    }

    #[inline]
    pub fn get(self, i: usize) -> Option<Signature<'a>> {
        self.ids.get(i).map(|&id| Signature::new(self.file, id))
    }

    #[inline]
    pub fn first(self) -> Option<Signature<'a>> {
        self.get(0)
    }

    pub fn iter(self) -> SignatureIter<'a> {
        SignatureIter {
            file: self.file,
            ids: self.ids.iter(),
        }
    }
}

impl std::fmt::Debug for SignatureList<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_list().entries(self.iter()).finish()
    }
}

impl<'a> IntoIterator for SignatureList<'a> {
    type Item = Signature<'a>;
    type IntoIter = SignatureIter<'a>;
    #[inline]
    fn into_iter(self) -> SignatureIter<'a> {
        self.iter()
    }
}

#[derive(Clone)]
pub struct SignatureIter<'a> {
    file: &'a File<'a>,
    ids: std::slice::Iter<'a, SigId>,
}

impl<'a> Iterator for SignatureIter<'a> {
    type Item = Signature<'a>;
    #[inline]
    fn next(&mut self) -> Option<Signature<'a>> {
        self.ids.next().map(|&id| Signature::new(self.file, id))
    }
    #[inline]
    fn size_hint(&self) -> (usize, Option<usize>) {
        self.ids.size_hint()
    }
}
impl ExactSizeIterator for SignatureIter<'_> {}

impl<'a> Signature<'a> {
    #[inline]
    pub(crate) fn new(file: &'a File<'a>, id: SigId) -> Self {
        Signature { file, id }
    }

    fn info(self) -> SignatureInfo<'a> {
        self.file.query(|q| q.signature_info(self.id))
    }

    /// `signature.parameters`, `signature.getParameters()`. The `this` parameter is not one.
    /// The type of one is [`TsSymbol::get_type`], already instantiated.
    pub fn parameters(self) -> SymbolList<'a> {
        SymbolList::new(self.file, self.info().parameters)
    }

    /// `signature.getParameters()`
    #[inline]
    pub fn get_parameters(self) -> SymbolList<'a> {
        self.parameters()
    }

    /// `signature.typeParameters`, `signature.getTypeParameters()`. Empty where TypeScript has
    /// `undefined`.
    pub fn type_parameters(self) -> TypeList<'a> {
        TypeList::new(self.file, self.info().type_parameters)
    }

    /// `signature.thisParameter`
    pub fn this_parameter(self) -> Option<TsSymbol<'a>> {
        self.info()
            .this_parameter
            .map(|id| TsSymbol::new(self.file, id))
    }

    /// `signature.declaration`, `signature.getDeclaration()`
    pub fn declaration(self) -> Option<TsNode<'a>> {
        self.info()
            .declaration
            .map(|node| TsNode::of(self.file, node))
    }

    /// `signature.getReturnType()`, `checker.getReturnTypeOfSignature(signature)`
    pub fn get_return_type(self) -> Type<'a> {
        Type::new(
            self.file,
            self.file.query(|q| q.return_type_of_signature(self.id)),
        )
    }

    /// `checker.getTypePredicateOfSignature(signature)`
    pub fn get_type_predicate(self) -> Option<TypePredicate<'a>> {
        let data = self
            .file
            .query(|q| q.type_predicate_of_signature(self.id))?;
        Some(TypePredicate {
            file: self.file,
            data,
        })
    }

    /// `signature.getJsDocTags()`, the text of the `deprecated` one.
    pub fn deprecation(self) -> Option<&'a [u8]> {
        self.file.query(|q| q.deprecation_of_signature(self.id))
    }

    /// `checker.signatureToString(signature)`
    pub fn to_text(self) -> Vec<u8> {
        self.file.query(|q| q.signature_to_string(self.id))
    }
}

/// `ts.TypePredicate`: `x is T`, `asserts x`
#[derive(Copy, Clone)]
pub struct TypePredicate<'a> {
    file: &'a File<'a>,
    data: TypePredicateData<'a>,
}

impl<'a> TypePredicate<'a> {
    /// `predicate.kind`
    #[inline]
    pub fn kind(self) -> TypePredicateKind {
        self.data.kind
    }

    /// `predicate.parameterIndex`. `None` for `this`.
    #[inline]
    pub fn parameter_index(self) -> Option<usize> {
        self.data.parameter_index.map(|index| index as usize)
    }

    /// `predicate.type`. `None` for `asserts x`.
    #[inline]
    pub fn ty(self) -> Option<Type<'a>> {
        self.data.ty.map(|id| Type::new(self.file, id))
    }
}

/// `ts.IndexInfo`: `[key: keyType]: type`
#[derive(Copy, Clone)]
pub struct IndexInfo<'a> {
    file: &'a File<'a>,
    data: IndexInfoData,
}

impl<'a> IndexInfo<'a> {
    #[inline]
    pub(crate) fn new(file: &'a File<'a>, data: IndexInfoData) -> Self {
        IndexInfo { file, data }
    }

    /// `info.keyType`
    #[inline]
    pub fn key_type(self) -> Type<'a> {
        Type::new(self.file, self.data.key_type)
    }

    /// `info.type`
    #[inline]
    pub fn ty(self) -> Type<'a> {
        Type::new(self.file, self.data.ty)
    }

    /// `info.isReadonly`
    #[inline]
    pub fn is_readonly(self) -> bool {
        self.data.is_readonly
    }
}
