//! Implicit `any` under `noImplicitAny`: 7010 7011 7012 7013 7020 7032 7033. The rest of
//! `reportImplicitAny` is in symbols.rs (`report_implicit_any_of_name`) and shape.rs
//! (`report_implicit_any`).

use super::*;
use crate::bind::{FnOwner, MemberOwner, Parent};

impl Checker<'_, '_> {
    /// `checkSignatureDeclaration` (7013 7020), `checkFunctionOrMethodDeclaration` (7010 7011 7012), `getTypeOfAccessors` (7032 7033)
    pub(super) fn check_signature_implicitly_any(&mut self, file: FileId, func: FnId) {
        if !self.p.files.options.no_implicit_any {
            return;
        }
        let (hir, bound) = (self.hir(file), self.bound(file));
        let (decl, owner) = (&hir[func], bound.fns[func.idx()].owner);
        let is_private_ambient = self.is_private_within_ambient(file, func);
        // `getTypeOfAccessors`: the syntax decides, an annotation on either accessor or a body on
        // the getter. The resulting type is irrelevant.
        if matches!(decl.kind, FnKind::Getter | FnKind::Setter) {
            if is_private_ambient || !self.accessor_has_no_type_source(file, func) {
                return;
            }
            let Some(start) = self.start_of_accessor_name(file, func) else {
                return;
            };
            let (code, is_the_one_to_be_told) = if decl.kind == FnKind::Setter {
                let getter = self.sibling_accessor_at_this_moment(file, func, FnKind::Getter);
                (
                    7032,
                    getter.is_none_or(|(of, g)| self.accessor_has_no_type_source(of, g)),
                )
            } else {
                // The error is reported on the setter, if possible.
                let setter = self.sibling_accessor_at_this_moment(file, func, FnKind::Setter);
                (
                    7033,
                    setter.is_none_or(|(of, s)| {
                        self.accessor_has_no_type_source(of, s)
                            && self.is_private_within_ambient(of, s)
                    }),
                )
            };
            if is_the_one_to_be_told {
                let end = self.end_of_name_at(file, start);
                let name = match owner {
                    FnOwner::Member(m) => Arg::Sym(self.symbol_of_member(file, m)),
                    _ => Arg::Bytes(&hir.text[start as usize..end as usize]),
                };
                self.error_at((file, start, end), code, &[name]);
            }
            return;
        }
        if decl.ret.is_some() || has_body(decl) {
            return;
        }
        let start = self.error_range_of_fn(file, func).0;
        match decl.kind {
            FnKind::ConstructSignature => {
                self.error_at((file, start, self.end_of_fn(file, func)), 7013, &[]);
            }
            FnKind::CallSignature => {
                self.error_at((file, start, self.end_of_fn(file, func)), 7020, &[]);
            }
            // `checkObjectLiteralMethod`, unlike `checkFunctionOrMethodDeclaration`, reports
            // nothing for a missing body.
            FnKind::Method if matches!(owner, FnOwner::Expr(_)) => {}
            FnKind::Decl | FnKind::Method if !is_private_ambient => {
                let name = hir.name(hir.node(func));
                // `GetErrorRangeForNode` has no case for a method signature: the error spans the
                // whole node. A missing name has zero length.
                let end = match owner {
                    FnOwner::Member(m)
                        if !matches!(bound.member_owner[m.idx()], MemberOwner::Class(_)) =>
                    {
                        hir[m].loc.end
                    }
                    _ if hir.is_missing(name) => start,
                    FnOwner::Member(m) => self.end_of_member_name(file, m),
                    _ => self.end_of_name_at(file, start),
                };
                let (node, any) = ((file, start, end), Arg::Type(TypeId::ANY));
                // `reportImplicitAny`: one without a name gets the message of a function
                // expression.
                if decl.kind == FnKind::Decl && decl.name.is_none() {
                    self.error_at(node, 7011, &[any]);
                } else if decl.flags.contains(Flags::REPARSED) {
                    self.error_at(node, 7012, &[any]);
                } else {
                    let name = self.declaration_name_to_string(file, name);
                    self.error_at(node, 7010, &[Arg::Bytes(&name), any]);
                }
            }
            _ => {}
        }
    }

    /// `isPrivateWithinAmbient` for the member that `func` is.
    pub(super) fn is_private_within_ambient(&self, file: FileId, func: FnId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let FnOwner::Member(m) = bound.fns[func.idx()].owner else {
            return false;
        };
        let MemberOwner::Class(c) = bound.member_owner[m.idx()] else {
            return false;
        };
        // `parseClassElement`: a member with `declare` is itself ambient.
        (hir[c].flags.contains(Flags::AMBIENT)
            || hir[m].flags.contains(Flags::AMBIENT)
            || hir.kind == FileKind::Declaration)
            && (hir[m].flags.contains(Flags::PRIVATE) || matches!(hir[m].key, PropKey::Private(_)))
    }

    /// Whether the accessor `func` gives `getTypeOfAccessors` no type source: a getter with neither
    /// an annotation nor a body, a setter without a parameter annotation.
    fn accessor_has_no_type_source(&self, file: FileId, func: FnId) -> bool {
        let hir = self.hir(file);
        let f = &hir[func];
        match f.kind {
            FnKind::Getter => f.ret.is_none() && matches!(f.body, FnBody::None),
            _ => f.effective_set_accessor_type_annotation_node(hir).is_none(),
        }
    }

    /// Start of the name of the accessor `func`.
    fn start_of_accessor_name(&self, file: FileId, func: FnId) -> Option<u32> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        match bound.fns[func.idx()].owner {
            FnOwner::Member(m) => Some(hir[m].name_pos),
            FnOwner::Expr(e) => match bound.expr_parent[e.idx()] {
                Parent::Prop(p) => Some(hir[p].pos),
                _ => None,
            },
            _ => None,
        }
    }

    /// `reportImplicitAny`, `case KindParameter`: the name of the parameter `p`, if it is an
    /// identifier and `p.Parent` is a call signature, a method signature or a function type.
    pub(super) fn identifier_of_signature_parameter(
        &self,
        file: FileId,
        p: ParamId,
    ) -> Option<Atom> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let func = bound.param_fn[p.idx()];
        let PatKind::Ident(name) = hir[hir[p].pat].kind else {
            return None;
        };
        let is_signature = func.is_some()
            && match hir[func].kind {
                FnKind::CallSignature | FnKind::FunctionType => true,
                FnKind::Method => matches!(bound.fns[func.idx()].owner, FnOwner::Member(m)
                    if !matches!(bound.member_owner[m.idx()], MemberOwner::Class(_))),
                _ => false,
            };
        is_signature.then_some(name)
    }

    /// `IsTypeNodeKind(IdentifierToKeywordKind(name))`
    pub(super) fn is_type_node_keyword(&self, name: Atom) -> bool {
        const KEYWORDS: [&[u8]; 12] = [
            b"any",
            b"unknown",
            b"number",
            b"bigint",
            b"object",
            b"boolean",
            b"string",
            b"symbol",
            b"void",
            b"undefined",
            b"never",
            b"intrinsic",
        ];
        KEYWORDS.contains(&self.atoms().bytes(name))
    }

    /// `(string) => void` was meant to be `(arg0: string) => void`. `check_unused` notes the use.
    pub(super) fn is_name_of_a_type(&self, file: FileId, func: FnId, name: Atom) -> bool {
        if self.is_type_node_keyword(name) {
            return true;
        }
        let scope = self.bound(file).fns[func.idx()].scope;
        scope.is_some()
            && self
                .files()
                .resolve_name(file, scope, name, SymFlags::TYPE)
                .is_some()
    }
}
