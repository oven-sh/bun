//! Caches the parts of a signature that tsgo stores in fields of the signature: `Signature.resolvedReturnType` and
//! `resolvedTypePredicate`, which it assigns on first use, and `parameters`, `typeParameters` and `thisParameter`,
//! which it sets when it creates the signature.
//!
//! Here a signature is a declaration plus a mapper, and each part is derived from them on every read. Deriving a part
//! reads the signature's record, finds the function in its file, looks up an entry in a per-node table, and
//! instantiates the result. `SignatureLinks` caches the derived part per signature, so the next read is a single load.
//!
//! The rule is the same as in `links`: a part is cached once deriving it again would compute nothing and return the
//! same value for the rest of the task.
//! - All of this belongs to one checker, and therefore to one task. None of it is shared, and no id in it outlives
//!   the task.
//! - A return type is cached if it's in `Program::resolved_return_types`, or if it's `instantiate(declared, mapper)`
//!   with `declared` in `Program::fn_return_types`. Nothing in progress may be about to overwrite the entry: the query
//!   that writes it isn't on the stack, and the mapper passes `is_mapper_idle`. The derivation runs under
//!   `derive_settled`.
//! - A type predicate follows the same rule. Its type is `instantiate(declared, mapper)`, where `declared` is the type
//!   of a type node that passes `is_type_node_settled`, or the type in a `Program::type_predicates_from_body` entry
//!   whose function isn't being analyzed. No mapper may be active.
//! - Parameters are cached once they're in the signature's record or in `Program::sig_params`, which never replaces the
//!   first list stored for a signature (`cached_sig_params`). Type parameters are cached once they're in
//!   `Program::sig_type_params`.
//! - A fact (`fact`) is a function of the signature's interning key and the program, and computing it resolves nothing.
//! - Return types and type predicates aren't read while `index_infos_in_instantiation` is non-empty.
//!
//! A cache hit skips the work that `instantiate` does before it looks anything up. See `links`.

use super::decl::Predicate;
use super::*;
use crate::table::{Id, Packed};

/// Flags in the low bits of the `FACTS` cell.
pub(super) mod fact {
    /// `len(signature.typeParameters) == 0`. Only set for a function that doesn't adopt type parameters from a
    /// contextual signature.
    pub(in super::super) const HAS_NO_TYPE_PARAMETERS: u32 = 1;
    /// `signature.thisParameter == nil`. Only set for a function that doesn't adopt a `this` parameter from a
    /// contextual signature.
    pub(in super::super) const HAS_NO_THIS_PARAMETER: u32 = 1 << 1;
    /// Number of flags.
    pub(super) const BITS: u32 = 2;
}

/// A `Packed` type, or 0 if the return type isn't cached.
const RETURN_TYPE: usize = 0;
/// 0 if the type predicate isn't cached, 1 if the signature doesn't have one, otherwise 2 + its index in
/// `SignatureLinks::type_predicates`.
const TYPE_PREDICATE: usize = 1;
/// The `fact` flags in the low bits. The bits above them are 0 if the type parameters aren't cached, otherwise 1 +
/// their index in `SignatureLinks::type_parameters`.
const FACTS: usize = 2;
/// 0 if the parameters aren't cached, otherwise 1 + their index in `SignatureLinks::parameters`.
const PARAMETERS: usize = 3;

type Row = [u32; 4];

/// Number of published signatures per page.
const PAGE: usize = 64;

/// See the module docs.
#[derive(Default)]
pub(super) struct SignatureLinks<'p> {
    /// Rows of task-local signatures, indexed by `local_number`.
    own: Vec<Row>,
    /// Indexed by a published signature's number divided by `PAGE`. Each entry is 1 + the page's index in `published`,
    /// or 0 if nothing on that page is cached.
    pages: Vec<u32>,
    published: Vec<[Row; PAGE]>,
    type_predicates: Vec<Predicate>,
    parameters: Vec<&'p [SigParam]>,
    type_parameters: Vec<&'p [TypeId]>,
}

impl<'p> SignatureLinks<'p> {
    #[inline]
    fn cell(&self, sig: SigId, at: usize) -> u32 {
        match sig.local_number() {
            Some(index) => self.own.get(index as usize).map_or(0, |row| row[at]),
            None => match self.pages.get(sig.0 as usize / PAGE) {
                Some(&page) if page != 0 => {
                    self.published[page as usize - 1][sig.0 as usize % PAGE][at]
                }
                _ => 0,
            },
        }
    }

    fn cell_mut(&mut self, sig: SigId, at: usize) -> &mut u32 {
        let Some(index) = sig.local_number() else {
            let page = sig.0 as usize / PAGE;
            if page >= self.pages.len() {
                self.pages.resize(page + 1, 0);
            }
            if self.pages[page] == 0 {
                self.published.push([[0; 4]; PAGE]);
                self.pages[page] = self.published.len() as u32;
            }
            return &mut self.published[self.pages[page] as usize - 1][sig.0 as usize % PAGE][at];
        };
        if index as usize >= self.own.len() {
            self.own.resize(index as usize + 1, [0; 4]);
        }
        &mut self.own[index as usize][at]
    }

    #[inline]
    pub(super) fn has(&self, sig: SigId, fact: u32) -> bool {
        self.cell(sig, FACTS) & fact != 0
    }

    pub(super) fn add_fact(&mut self, sig: SigId, fact: u32) {
        *self.cell_mut(sig, FACTS) |= fact;
    }

    #[inline]
    pub(super) fn type_parameters(&self, sig: SigId) -> Option<&'p [TypeId]> {
        match self.cell(sig, FACTS) >> fact::BITS {
            0 => None,
            at => Some(self.type_parameters[at as usize - 1]),
        }
    }

    pub(super) fn keep_type_parameters(&mut self, sig: SigId, type_parameters: &'p [TypeId]) {
        if self.cell(sig, FACTS) >> fact::BITS == 0 {
            self.type_parameters.push(type_parameters);
            let place = self.type_parameters.len() as u32;
            *self.cell_mut(sig, FACTS) |= place << fact::BITS;
        }
    }

    #[inline]
    pub(super) fn parameters(&self, sig: SigId) -> Option<&'p [SigParam]> {
        match self.cell(sig, PARAMETERS) {
            0 => None,
            at => Some(self.parameters[at as usize - 1]),
        }
    }

    pub(super) fn keep_parameters(&mut self, sig: SigId, parameters: &'p [SigParam]) {
        if self.cell(sig, PARAMETERS) == 0 {
            self.parameters.push(parameters);
            let place = self.parameters.len() as u32;
            *self.cell_mut(sig, PARAMETERS) = place;
        }
    }

    fn keep_return_type(&mut self, sig: SigId, ty: TypeId, _: Stored) {
        *self.cell_mut(sig, RETURN_TYPE) = ty.pack();
    }

    /// Returns `None` if the type predicate isn't cached.
    #[inline]
    fn type_predicate(&self, sig: SigId) -> Option<Option<Predicate>> {
        match self.cell(sig, TYPE_PREDICATE) {
            0 => None,
            1 => Some(None),
            at => Some(Some(self.type_predicates[at as usize - 2])),
        }
    }

    fn keep_type_predicate(&mut self, sig: SigId, predicate: Option<Predicate>, _: Stored) {
        let raw = match predicate {
            None => 1,
            Some(predicate) => {
                self.type_predicates.push(predicate);
                self.type_predicates.len() as u32 + 1
            }
        };
        *self.cell_mut(sig, TYPE_PREDICATE) = raw;
    }
}

/// Tells where `derive_return_type` reads a signature's return type from.
enum ReturnTypeSource {
    /// `Program::resolved_return_types`
    Signature,
    /// `Program::fn_return_types`, instantiated with the mapper, which maps every type parameter to itself.
    Declaration(FileId, FnId, MapperId),
    /// The signature's record, or a class's declared type. Not cached.
    Other,
}

impl<'p, 's> Checker<'p, 's> {
    /// Returns `signature.resolvedReturnType` if it's cached and safe to read now.
    #[inline]
    pub(super) fn kept_return_type(&mut self, sig: SigId) -> Option<TypeId> {
        let raw = self.signature_links.cell(sig, RETURN_TYPE);
        if raw == 0 || !self.index_infos_in_instantiation.is_empty() {
            return None;
        }
        let kept = TypeId::unpack(raw);

        Some(kept)
    }

    fn return_type_source(&self, sig: SigId) -> ReturnTypeSource {
        match *self.types().sig(sig) {
            SigData::Synth {
                ret: TypeId::UNRESOLVED,
                ref of,
                ..
            } if of.len() > 1 => ReturnTypeSource::Signature,
            SigData::WithReturn {
                sig: of,
                ret: TypeId::UNRESOLVED,
            } if self.is_optional_call_signature_of(of) => ReturnTypeSource::Signature,
            SigData::Decl { mapper, .. } if self.is_instantiating(mapper) => {
                ReturnTypeSource::Signature
            }
            SigData::Decl { file, func, mapper } => {
                ReturnTypeSource::Declaration(file, func, mapper)
            }
            _ => ReturnTypeSource::Other,
        }
    }

    /// `sig_return` on a cache miss.
    #[inline(never)]
    pub(super) fn derive_and_keep_return_type(&mut self, sig: SigId) -> TypeId {
        let source = self.return_type_source(sig);
        if matches!(source, ReturnTypeSource::Other) {
            return self.derive_return_type(sig);
        }
        let is_idle = |c: &Self, q: Query| !(c.may_be_in_flight(q) && c.stack.contains(&q));
        let (ty, stored) = self.derive_settled(
            |c| c.derive_return_type(sig),
            |c, _| match source {
                ReturnTypeSource::Signature => {
                    (c.p.resolved_return_types.get(&c.task, &sig)).is_some()
                        && is_idle(c, Query::ReturnOfSignature(sig))
                }
                ReturnTypeSource::Declaration(file, func, mapper) => {
                    (c.p.fn_return_types.get(&c.task, &(file, func))).is_some()
                        && is_idle(c, Query::Return(file, func))
                        && c.is_mapper_idle(mapper)
                }
                ReturnTypeSource::Other => false,
            },
        );
        if let Some(stored) = stored {
            self.signature_links.keep_return_type(sig, ty, stored);
        }
        ty
    }

    /// Returns `signature.resolvedTypePredicate` if it's cached and safe to read now.
    #[inline]
    pub(super) fn kept_type_predicate(&mut self, sig: SigId) -> Option<Option<Predicate>> {
        let kept = self.signature_links.type_predicate(sig)?;
        if !self.index_infos_in_instantiation.is_empty() {
            return None;
        }

        Some(kept)
    }

    /// `sig_predicate` on a cache miss.
    #[inline(never)]
    pub(super) fn derive_and_keep_type_predicate(&mut self, sig: SigId) -> Option<Predicate> {
        // Every other kind of signature forwards to another signature, doesn't have a predicate, or combines several
        // predicates.
        let SigData::Decl { file, func, .. } = *self.types().sig(sig) else {
            return self.derive_type_predicate(sig);
        };
        let (predicate, stored) = self.derive_settled(
            |c| c.derive_type_predicate(sig),
            |c, _| c.is_type_predicate_settled(file, func),
        );
        if let Some(stored) = stored {
            (self.signature_links).keep_type_predicate(sig, predicate, stored);
        }
        predicate
    }

    /// True if the entries that `derive_type_predicate` reads for a signature of `func` won't be overwritten. This
    /// check must not create anything, so it can't recompute which mappers `instantiate_result_of_sig` used. It
    /// requires that no mapper is active instead.
    fn is_type_predicate_settled(&self, file: FileId, func: FnId) -> bool {
        let hir = self.hir(file);
        let annotation = hir[func].ret;
        let is_declared_type_settled = if annotation.is_none() {
            self.is_inferred_predicate_settled(file, func)
        } else {
            match hir[annotation].kind {
                TypeNodeKind::Predicate { ty, .. } if ty.is_some() => {
                    self.is_type_node_settled(file, ty)
                }
                _ => true,
            }
        };
        is_declared_type_settled && self.active_mappers.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::{PAGE, SignatureLinks, fact};
    use crate::atom::known;
    use crate::check::decl::Predicate;
    use crate::check::task::Stored;
    use crate::local::LOCAL;
    use crate::types::{SigId, SigParam, TypeId};

    #[test]
    fn a_row_for_each_signature() {
        let page = PAGE as u32;
        let sigs = [0, page - 1, page, 5 * page, LOCAL, LOCAL | 1, LOCAL | 1000].map(SigId);
        let parameters = [SigParam {
            name: known::value,
            ty: TypeId(1),
            optional: false,
            rest: false,
            is_required_rest: false,
            declaration: None,
        }];
        let type_parameters = [TypeId(2)];
        let mut links = SignatureLinks::default();
        let predicate = |at: usize| Predicate {
            param: Some(at),
            name: known::value,
            ty: Some(TypeId(at as u32)),
            asserts: false,
        };
        for sig in sigs {
            assert_eq!(links.cell(sig, super::RETURN_TYPE), 0);
            assert_eq!(links.type_predicate(sig), None);
            assert!(!links.has(sig, fact::HAS_NO_TYPE_PARAMETERS));
        }
        for (at, sig) in sigs.into_iter().enumerate() {
            links.keep_return_type(sig, TypeId(at as u32), Stored::new());
            let kept = (at % 2 == 0).then(|| predicate(at));
            links.keep_type_predicate(sig, kept, Stored::new());
            links.add_fact(sig, fact::HAS_NO_THIS_PARAMETER);
            links.keep_parameters(sig, &parameters[..at % 2]);
            // A second call doesn't replace the first list.
            links.keep_parameters(sig, &parameters[..]);
            if at % 3 == 0 {
                links.keep_type_parameters(sig, &type_parameters[..at % 2]);
                links.keep_type_parameters(sig, &type_parameters[..]);
            }
        }
        for (at, sig) in sigs.into_iter().enumerate() {
            assert_eq!(links.cell(sig, super::RETURN_TYPE), at as u32 + 1);
            let kept = (at % 2 == 0).then(|| predicate(at));
            assert_eq!(links.type_predicate(sig), Some(kept));
            assert!(links.has(sig, fact::HAS_NO_THIS_PARAMETER));
            assert!(!links.has(sig, fact::HAS_NO_TYPE_PARAMETERS));
            assert_eq!(links.parameters(sig), Some(&parameters[..at % 2]));
            let kept = (at % 3 == 0).then_some(&type_parameters[..at % 2]);
            assert_eq!(links.type_parameters(sig), kept);
        }
        for other in [1, page + 1, 6 * page, LOCAL | 2, LOCAL | 1001].map(SigId) {
            assert_eq!(links.cell(other, super::RETURN_TYPE), 0);
            assert_eq!(links.type_predicate(other), None);
            assert!(!links.has(other, fact::HAS_NO_THIS_PARAMETER));
            assert_eq!(links.parameters(other), None);
            assert_eq!(links.type_parameters(other), None);
        }
        // Only pages with a cached row are allocated.
        assert_eq!(links.published.len(), 3);
    }
}
