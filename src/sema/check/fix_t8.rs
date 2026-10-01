//! `getConditionalFlowTypeOfType` for a check type that is no type variable.
//!
//! In the true branch of `number extends T ? X : Y` every `number` written in a covariant place of `X` is a substitution type: a `number`
//! that is known to be a `T`. Substitution types are not represented, and no mapper replaces `number`, so the branch is made again
//! from its syntax with what the substitution type comes to in those places.

use super::*;

/// The check type of a conditional type: where it is written, and what it is as declared.
#[derive(Copy, Clone)]
struct CheckType {
    file: FileId,
    node: TypeNodeId,
    ty: TypeId,
}

/// Whether `func` is a function type without type parameters that returns no type predicate.
fn is_plain_function_type(hir: &File, func: FnId) -> bool {
    let f = &hir[func];
    f.kind == FnKind::FunctionType
        && f.type_params.is_empty()
        && f.ret.is_some()
        && !matches!(hir[f.ret].kind, TypeNodeKind::Predicate { .. })
}

impl<'p> Checker<'p> {
    /// The true branch of a conditional type under `mapper`, with the type nodes in it that `getConditionalFlowTypeOfType` makes
    /// substitution types of replaced by what those come to. `checked`, which is no type variable, is the check type as declared.
    /// The nodes are those of the check type, of what it is checked against, and of the branch. `as_source`: see `substitution`.
    /// `None`: there is no such node, or the substitution type comes to the check type.
    pub(super) fn true_branch_with_check_type_substituted(
        &mut self,
        file: FileId,
        [check, extends, branch]: [TypeNodeId; 3],
        checked: TypeId,
        mapper: MapperId,
        as_source: bool,
    ) -> Option<TypeId> {
        let check = CheckType {
            file,
            node: check,
            ty: checked,
        };
        if !self.is_denoted_covariantly(check, branch, true) {
            return None;
        }
        let constraint = self.type_from_node(file, extends);
        let (base, constraint) = (
            self.instantiate(checked, mapper),
            self.instantiate(constraint, mapper),
        );
        let known = self.substitution(base, constraint, as_source);
        if known == base {
            return None;
        }
        self.with_check_type_substituted(check, branch, known, mapper, true)
    }

    /// `getImpliedConstraint`: whether the type written at `node` is the check type. Only the same kind of syntax is resolved.
    fn denotes_check_type(&mut self, check: CheckType, node: TypeNodeId) -> bool {
        let hir = self.hir(check.file);
        std::mem::discriminant(&hir[node].kind) == std::mem::discriminant(&hir[check.node].kind)
            && self.type_from_node(check.file, node) == check.ty
    }

    /// Whether `with_check_type_substituted` finds something to replace at or below `node`.
    fn is_denoted_covariantly(
        &mut self,
        check: CheckType,
        node: TypeNodeId,
        covariant: bool,
    ) -> bool {
        if node.is_none() {
            return false;
        }
        if covariant && self.denotes_check_type(check, node) {
            return true;
        }
        let hir = self.hir(check.file);
        match hir[node].kind {
            TypeNodeKind::Fn(func) if is_plain_function_type(hir, func) => {
                let f = &hir[func];
                for p in f.params.iter() {
                    if self.is_denoted_covariantly(check, hir[p].ty, !covariant) {
                        return true;
                    }
                }
                self.is_denoted_covariantly(check, f.ret, covariant)
            }
            TypeNodeKind::Array(element) => self.is_denoted_covariantly(check, element, covariant),
            TypeNodeKind::Union(types) | TypeNodeKind::Intersection(types) => {
                for t in hir.ids(types) {
                    if self.is_denoted_covariantly(check, t, covariant) {
                        return true;
                    }
                }
                false
            }
            _ => false,
        }
    }

    /// The type written at `node` under `mapper`, with `known` for the check type wherever it is written in a covariant place: a
    /// parameter turns `covariant` around. `None`: nothing is replaced.
    fn with_check_type_substituted(
        &mut self,
        check: CheckType,
        node: TypeNodeId,
        known: TypeId,
        mapper: MapperId,
        covariant: bool,
    ) -> Option<TypeId> {
        if node.is_none() {
            return None;
        }
        if covariant && self.denotes_check_type(check, node) {
            return Some(known);
        }
        let file = check.file;
        let hir = self.hir(file);
        match hir[node].kind {
            TypeNodeKind::Fn(func) if is_plain_function_type(hir, func) => {
                let f = &hir[func];
                let declared = self.sig_of_fn(file, func);
                let sig = self.instantiate_sig(declared, mapper);
                let mut params = self.sig_params(sig).into_vec();
                let mut is_changed = false;
                for (i, p) in f.params.iter().enumerate() {
                    let Some(ty) = self
                        .with_check_type_substituted(check, hir[p].ty, known, mapper, !covariant)
                    else {
                        continue;
                    };
                    let Some(is_optional) = params.get(i).map(|param| param.optional) else {
                        continue;
                    };
                    params[i].ty = if is_optional { self.optional(ty) } else { ty };
                    is_changed = true;
                }
                let ret = match self
                    .with_check_type_substituted(check, f.ret, known, mapper, covariant)
                {
                    Some(ret) => {
                        is_changed = true;
                        ret
                    }
                    None => self.sig_return(sig),
                };
                if !is_changed {
                    return None;
                }
                let this = self.sig_this_type(sig);
                let substituted = self.p.types.intern_sig(SigData::Synth {
                    type_params: Box::new([]),
                    params: params.into(),
                    ret,
                    this,
                    of: Box::new([]),
                });
                Some(self.synth(Shape {
                    call: vec![substituted],
                    ..Shape::default()
                }))
            }
            TypeNodeKind::Array(element) => {
                let element =
                    self.with_check_type_substituted(check, element, known, mapper, covariant)?;
                Some(self.array_of(element))
            }
            TypeNodeKind::Union(types) | TypeNodeKind::Intersection(types) => {
                let mut parts: Vec<TypeId> = Vec::with_capacity(types.len());
                let mut is_changed = false;
                for t in hir.ids(types) {
                    let part = self.with_check_type_substituted(check, t, known, mapper, covariant);
                    is_changed |= part.is_some();
                    parts.push(match part {
                        Some(part) => part,
                        None => {
                            let declared = self.type_from_node(file, t);
                            self.instantiate(declared, mapper)
                        }
                    });
                }
                if !is_changed {
                    return None;
                }
                Some(if matches!(hir[node].kind, TypeNodeKind::Union(_)) {
                    self.union(&parts)
                } else {
                    self.intersection(&parts)
                })
            }
            _ => None,
        }
    }
}
