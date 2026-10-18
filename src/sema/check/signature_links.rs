//! The parts of a signature that tsgo keeps in fields of the signature: `Signature.resolvedReturnType` and
//! `resolvedTypePredicate`, which it assigns when they are first asked for, and `parameters`, `typeParameters` and
//! `thisParameter`, which it has from the start.
//!
//! Here a signature is a declaration and a mapper, and a part is derived from them each time: the record of the signature,
//! the function in its file, an entry of a table by node, an instantiation. `SignatureLinks` keeps what was derived, by
//! signature, so that the next read is a load.
//!
//! The rule is that of `links`: a part is kept once deriving it again computes nothing and gives the same, for as long as
//! the task runs.
//! - All of this belongs to one checker, and so to one task. Nothing of it goes to a barrier, and no id in it outlives the
//!   task.
//! - A return type is kept if it is in `Program::resolved_return_types`, or if it is `instantiate(declared, mapper)` with
//!   `declared` in `Program::fn_return_types`, and nothing in progress is going to store another one: the query that writes
//!   the entry is not on the stack, and `is_mapper_idle`. The derivation has gone through `derive_settled`.
//! - A type predicate likewise: its type is `instantiate(declared, mapper)`, with `declared` the type of a type node that
//!   `is_type_node_settled`, or of an entry of `Program::type_predicates_from_body` whose function is not being looked at,
//!   and no mapper is active.
//! - The parameters are kept once they are in the record of the signature or in `Program::sig_params`, which keeps the
//!   first list that it is given: `cached_sig_params`. The type parameters once they are in `Program::sig_type_params`.
//! - A fact (`fact`) is a function of the interning key of the signature and of the program, and finding it resolves
//!   nothing.
//! - A return type or a type predicate is not read while `index_infos_in_instantiation` is not empty.
//!
//! What a read of a kept part leaves out is what `instantiate` does before it looks anything up: see `links`.

use super::decl::Predicate;
use super::*;
use crate::table::{Id, Packed};

/// `false`: `sig_return` and `non_circular_return_type_of_signature` derive the return type each time, as before.
pub(super) const KEEPS_RETURN_TYPES: bool = true;
/// The same for `sig_predicate`.
pub(super) const KEEPS_TYPE_PREDICATES: bool = true;
/// The same for `sig_type_params`, and for `sig_this_parameter` of a signature that has none.
pub(super) const KEEPS_FACTS: bool = true;
/// `false`: `sig_params` looks a list up that it has not returned recently, as before.
pub(super) const KEEPS_PARAMETERS: bool = true;

/// Every part that is read from here is derived as well. It is a panic that names the signature and the file if that gives
/// another one, or if it computes anything. For debugging.
pub(super) const CHECKS_RETURN_TYPES: bool = false;
pub(super) const CHECKS_TYPE_PREDICATES: bool = false;
pub(super) const CHECKS_FACTS: bool = false;
pub(super) const CHECKS_PARAMETERS: bool = false;

/// The lowest bits of the cell `FACTS`.
pub(super) mod fact {
    /// `len(signature.typeParameters) == 0`, of the signature of a function that adopts none from a contextual signature.
    pub(in super::super) const HAS_NO_TYPE_PARAMETERS: u32 = 1;
    /// `signature.thisParameter == nil`, likewise.
    pub(in super::super) const HAS_NO_THIS_PARAMETER: u32 = 1 << 1;
    /// How many there are.
    pub(super) const BITS: u32 = 2;
}

/// A `Packed` type, 0 for none.
const RETURN_TYPE: usize = 0;
/// 0: it is not kept. 1: the signature has none. Otherwise 2 + the index in `SignatureLinks::type_predicates`.
const TYPE_PREDICATE: usize = 1;
/// The bits of `fact`. Above them, 0: the type parameters are not kept. Otherwise 1 + the index in
/// `SignatureLinks::type_parameters`.
const FACTS: usize = 2;
/// 0: they are not kept. Otherwise 1 + the index in `SignatureLinks::parameters`.
const PARAMETERS: usize = 3;

type Row = [u32; 4];

/// How many published signatures share a page.
const PAGE: usize = 64;

/// See the top of the file.
#[derive(Default)]
pub(super) struct SignatureLinks<'p> {
    /// By the index of a signature of the task.
    own: Vec<Row>,
    /// By the number of a published signature divided by `PAGE`: 1 + the index of its page. 0: nothing of the page is kept.
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

    /// `None`: it is not kept.
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

/// Where `derive_return_type` has the return type of a signature from.
enum ReturnTypeSource {
    /// `Program::resolved_return_types`
    Signature,
    /// `Program::fn_return_types`, instantiated with the mapper, which maps no type parameter to another type.
    Declaration(FileId, FnId, MapperId),
    /// It is in the record of the signature, or it is the declared type of a class: it is not kept.
    Other,
}

impl<'p, 's> Checker<'p, 's> {
    /// `signature.resolvedReturnType`, if it is kept and may be read now.
    #[inline]
    pub(super) fn kept_return_type(&mut self, sig: SigId) -> Option<TypeId> {
        if !KEEPS_RETURN_TYPES {
            return None;
        }
        let raw = self.signature_links.cell(sig, RETURN_TYPE);
        if raw == 0 || !self.index_infos_in_instantiation.is_empty() {
            return None;
        }
        let kept = TypeId::unpack(raw);
        if CHECKS_RETURN_TYPES {
            self.check_kept_signature_part(sig, "resolvedReturnType", &kept, |c| {
                c.derive_return_type(sig)
            });
        }
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

    /// `sig_return` for a signature whose return type is not kept.
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

    /// `signature.resolvedTypePredicate`, if it is kept and may be read now.
    #[inline]
    pub(super) fn kept_type_predicate(&mut self, sig: SigId) -> Option<Option<Predicate>> {
        let kept = self.signature_links.type_predicate(sig)?;
        if !self.index_infos_in_instantiation.is_empty() {
            return None;
        }
        if CHECKS_TYPE_PREDICATES {
            self.check_kept_signature_part(sig, "resolvedTypePredicate", &kept, |c| {
                c.derive_type_predicate(sig)
            });
        }
        Some(kept)
    }

    /// `sig_predicate` for a signature whose type predicate is not kept.
    #[inline(never)]
    pub(super) fn derive_and_keep_type_predicate(&mut self, sig: SigId) -> Option<Predicate> {
        // Any other has that of a signature of a declaration, or none, or combines those of several.
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

    /// Whether the entries that `derive_type_predicate` reads for a signature of `func` stay. It creates nothing: which
    /// mappers `instantiate_result_of_sig` has used is not asked, so none may be active.
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

    /// Under a `CHECKS_*` switch: `kept` was read as the part `name` of `sig`, and `derive` is the long way.
    #[cold]
    #[inline(never)]
    pub(super) fn check_kept_signature_part<V: PartialEq + std::fmt::Debug>(
        &mut self,
        sig: SigId,
        name: &str,
        kept: &V,
        derive: impl FnOnce(&mut Self) -> V,
    ) {
        // There, or a few levels further in, the long way fails and reports it.
        if self.instantiation_depth >= 90 || self.instantiation_count >= 4_900_000 {
            return;
        }
        let traces = |c: &Self| {
            (
                c.work,
                c.instantiations_computed,
                c.types().first_new_type_id(),
                c.non_cacheable_mark(),
                c.reported.len(),
            )
        };
        let (before, count) = (traces(self), self.instantiation_count);
        let derived = derive(self);
        self.instantiation_count = count;
        let computed_nothing = traces(self) == before;
        if derived != *kept || !computed_nothing {
            let file =
                (self.task.file).map(|file| bstr::BStr::new(self.files().module(file).file_name()));
            let data = self.types().sig(sig);
            panic!(
                "{name} of {sig:?} ({data:?}), while checking {file:?}: kept {kept:?}, derived {derived:?}, computing nothing: {computed_nothing}"
            )
        }
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
            // The first list stays.
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
        // Only the pages that have a row.
        assert_eq!(links.published.len(), 3);
    }
}
