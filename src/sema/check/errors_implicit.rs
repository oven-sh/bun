//! What is `any` for want of anything that says what it is, under `noImplicitAny`: 7010 7011 7012 7013 7020 7032 7033. The rest of
//! `reportImplicitAny` is in symbols.rs (`report_implicit_any_of_name`) and shape.rs (`report_implicit_any`).

use super::*;
use crate::bind::{FnOwner, MemberOwner, Parent};

impl Checker<'_> {
    /// `checkSignatureDeclaration` (7013 7020), `checkFunctionOrMethodDeclaration` (7010 7011 7012), `getTypeOfAccessors` (7032 7033)
    pub(super) fn check_signature_implicitly_any(&mut self, file: FileId, func: FnId) {
        if !self.p.files.options.no_implicit_any {
            return;
        }
        let (hir, bound) = (self.hir(file), self.bound(file));
        let (decl, owner) = (&hir[func], bound.fns[func.idx()].owner);
        let is_private_ambient = self.is_private_within_ambient(file, func);
        // `getTypeOfAccessors`: what is written decides, a type on either or a body of the getter. What that comes to plays no part.
        if matches!(decl.kind, FnKind::Getter | FnKind::Setter) {
            if is_private_ambient || !self.accessor_says_nothing(file, func) {
                return;
            }
            let Some(start) = self.start_of_accessor_name(file, func) else {
                return;
            };
            let (code, is_the_one_to_be_told) = if decl.kind == FnKind::Setter {
                let getter = self.sibling_accessor(file, func, FnKind::Getter);
                (
                    7032,
                    getter.is_none_or(|g| self.accessor_says_nothing(file, g)),
                )
            } else {
                // The setter is the one to be told, if it can be.
                let setter = self.sibling_accessor(file, func, FnKind::Setter);
                (
                    7033,
                    setter.is_none_or(|s| {
                        self.accessor_says_nothing(file, s)
                            && self.is_private_within_ambient(file, s)
                    }),
                )
            };
            if is_the_one_to_be_told {
                let end = self.end_of_name_at(file, start);
                let name = Arg::Bytes(&hir.text[start as usize..end as usize]);
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
            // `checkObjectLiteralMethod`, unlike `checkFunctionOrMethodDeclaration`, says nothing of a missing body.
            FnKind::Method if matches!(owner, FnOwner::Expr(_)) => {}
            FnKind::Decl | FnKind::Method if !is_private_ambient => {
                let is_missing = match owner {
                    FnOwner::Member(m) => {
                        matches!(hir[m].key, PropKey::None | PropKey::Name(known::empty))
                    }
                    _ => decl.name == known::empty,
                };
                // `GetErrorRangeForNode` has no case for a method signature: the error is on the whole of it. A name that is
                // missing takes no room.
                let (name_end, end) = match owner {
                    FnOwner::Member(m) => {
                        let name_end = self.end_of_member_name(file, m);
                        match bound.member_owner[m.idx()] {
                            MemberOwner::Class(_) if is_missing => (name_end, start),
                            MemberOwner::Class(_) => (name_end, name_end),
                            _ => (name_end, hir[m].loc.end),
                        }
                    }
                    _ if is_missing => (start, start),
                    _ => {
                        let end = self.end_of_name_at(file, start);
                        (end, end)
                    }
                };
                let (node, any) = ((file, start, end), Arg::Type(TypeId::ANY));
                // `reportImplicitAny`: one without a name is spoken of as a function expression is.
                if decl.kind == FnKind::Decl && decl.name.is_none() {
                    self.error_at(node, 7011, &[any]);
                } else if decl.flags.contains(Flags::REPARSED) {
                    self.error_at(node, 7012, &[any]);
                } else if is_missing {
                    self.error_at(node, 7010, &[Arg::Bytes(b"(Missing)"), any]);
                } else {
                    let name = Arg::Bytes(&hir.text[start as usize..name_end as usize]);
                    self.error_at(node, 7010, &[name, any]);
                }
            }
            _ => {}
        }
    }

    /// `isPrivateWithinAmbient`, of the member `func` is.
    pub(super) fn is_private_within_ambient(&self, file: FileId, func: FnId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let FnOwner::Member(m) = bound.fns[func.idx()].owner else {
            return false;
        };
        let MemberOwner::Class(c) = bound.member_owner[m.idx()] else {
            return false;
        };
        // `parseClassElement`: a member that says `declare` is ambient by itself.
        (hir[c].flags.contains(Flags::AMBIENT)
            || hir[m].flags.contains(Flags::AMBIENT)
            || hir.kind == FileKind::Declaration)
            && (hir[m].flags.contains(Flags::PRIVATE) || matches!(hir[m].key, PropKey::Private(_)))
    }

    /// Whether the accessor `func` gives `getTypeOfAccessors` nothing to go by: a getter neither a type nor a body, a setter no type
    /// for what it takes.
    fn accessor_says_nothing(&self, file: FileId, func: FnId) -> bool {
        let hir = self.hir(file);
        let f = &hir[func];
        match f.kind {
            FnKind::Getter => f.ret.is_none() && matches!(f.body, FnBody::None),
            _ => f.params.iter().next().is_none_or(|p| hir[p].ty.is_none()),
        }
    }

    /// Where the name of the accessor `func` starts. `None`: which property it is cannot be told.
    pub(super) fn start_of_accessor_name(&mut self, file: FileId, func: FnId) -> Option<u32> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let (key, pos) = match bound.fns[func.idx()].owner {
            FnOwner::Member(m) => (hir[m].key, hir[m].name_pos),
            FnOwner::Expr(e) => match bound.expr_parent[e.idx()] {
                Parent::Prop(p) => (hir[p].key, hir[p].pos),
                _ => return None,
            },
            _ => return None,
        };
        if key == PropKey::None {
            return None;
        }
        Some(pos)
    }

    /// `(string) => void` was meant to be `(arg0: string) => void`. `IsTypeNodeKind`
    pub(super) fn is_name_of_a_type(&self, file: FileId, func: FnId, name: Atom) -> bool {
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
        if KEYWORDS.contains(&self.atoms().bytes(name)) {
            return true;
        }
        let scope = self.bound(file).fns[func.idx()].scope;
        scope.is_some()
            && self
                .files()
                .resolve_name(file, scope, name, SymFlags::TYPE)
                .is_some()
    }

    /// `checkVariableLikeDeclaration` returns before it asks for the type of a renamed element in a function without a body. 7031
    /// comes from `getTypeFromBindingPattern`, which only runs once the type of the parameter is asked for: by another element of
    /// the pattern, by a call, or by a comparison with another signature.
    pub(super) fn is_type_of_parameter_never_asked_for(
        &self,
        file: FileId,
        func: FnId,
        p: ParamId,
    ) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let (f, symbol) = (&hir[func], bound.fn_symbol[func.idx()]);
        f.kind == FnKind::Decl
            && matches!(f.body, FnBody::None)
            && matches!(hir[hir[p].pat].kind, PatKind::Object(props) if props.iter().all(|q| self.is_renamed_binding_element(file, q)))
            && symbol.is_some()
            && bound.symbols[symbol.idx()].decls.len() == 1
            && !bound.expr_symbol.contains(&symbol)
    }
}
