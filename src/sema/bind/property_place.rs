use super::{Binding, Bound, SymbolId};
use crate::atom::{Atom, known};
use crate::hir::{ExprId, ExprKind, File, MemberKey};
use smallvec::SmallVec;

#[derive(Clone, PartialEq, Eq, Hash, Debug)]
pub struct PropertyPlace {
    pub root: SymbolId,
    pub names: SmallVec<[Atom; 4]>,
}

pub fn find_property_place(
    hir: &File<'_>,
    bound: &Bound<'_>,
    mut expression: ExprId,
) -> Option<PropertyPlace> {
    let mut names = SmallVec::new();
    loop {
        expression = hir.skip_type_assertions(expression);
        match hir.member_key(expression) {
            Some((_, MemberKey::Name(known::prototype | known::__proto__))) => return None,
            Some((object, MemberKey::Name(name))) => {
                names.push(name);
                expression = object;
            }
            Some(_) => return None,
            None => break,
        }
    }
    match (hir[expression].kind, bound.binding(expression)) {
        (ExprKind::Ident(_), Binding::Symbol(root)) => Some(PropertyPlace { root, names }),
        _ => None,
    }
}
