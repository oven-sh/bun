//! Which types need parentheses where they are.

use crate::prelude::*;

fn member_count(ty: TypeNode<'_>) -> usize {
    match ty.kind() {
        TypeKind::Union(types) | TypeKind::Intersection(types) => types.len(),
        _ => 0,
    }
}

/// `| A` is a union of one type here. Prettier's parsers have it as `A`, so the parent of `A` is
/// what the union is in.
pub(crate) fn effective_parent(mut parent: AstNodes<'_>) -> AstNodes<'_> {
    while let AstNodes::TSUnionType(ty) | AstNodes::TSIntersectionType(ty) = parent
        && member_count(ty) <= 1
    {
        parent = parent.parent();
    }
    parent
}

pub(crate) fn needs_parentheses<'a>(ty: TypeNode<'a>, f: &Formatter<'a>) -> bool {
    if f.file().is_flow() {
        return crate::js::print::flow::needs_parentheses(ty);
    }
    match ty.kind() {
        TypeKind::Fn(func) => {
            let parent = effective_parent(ty.ast_parent());
            // `(): (() => void) => ..`
            if func.kind() != FnKind::ConstructorType
                && matches!(parent, AstNodes::TSTypeAnnotation(_))
                && matches!(parent.parent(), AstNodes::ArrowFunctionExpression(_))
            {
                return true;
            }
            function_like_type_needs_parentheses(ty, parent, func.return_type())
        }
        TypeKind::Infer(param) => match effective_parent(ty.ast_parent()) {
            AstNodes::TSIntersectionType(_) | AstNodes::TSUnionType(_) => param.constraint().is_some(),
            AstNodes::TSRestType(_) => false,
            parent => operator_type_or_higher_needs_parens(ty, parent),
        },
        TypeKind::Union(types) | TypeKind::Intersection(types) => {
            if types.len() <= 1 {
                return false;
            }
            match effective_parent(ty.ast_parent()) {
                AstNodes::TSUnionType(parent) | AstNodes::TSIntersectionType(parent) => member_count(parent) > 1,
                parent => operator_type_or_higher_needs_parens(ty, parent),
            }
        }
        TypeKind::Cond { .. } => match effective_parent(ty.ast_parent()) {
            AstNodes::TSConditionalType(parent) => {
                matches!(parent.kind(), TypeKind::Cond { check, extends, .. } if check == ty || extends == ty)
            }
            // `<A extends (B extends C ? D : E)>() => {}`
            AstNodes::TSTypeParameter(param) => param.constraint() == Some(ty),
            AstNodes::TSUnionType(parent) | AstNodes::TSIntersectionType(parent) => member_count(parent) > 1,
            parent => operator_type_or_higher_needs_parens(ty, parent),
        },
        TypeKind::Keyof(_) | TypeKind::Readonly(_) | TypeKind::UniqueSymbol => {
            operator_type_or_higher_needs_parens(ty, effective_parent(ty.ast_parent()))
        }
        TypeKind::Typeof { .. } | TypeKind::Import { is_typeof: true, .. } => {
            match effective_parent(ty.ast_parent()) {
                AstNodes::TSArrayType(_) => true,
                // `(typeof a)[0]` means the same as `typeof a[0]`, unlike in an expression.
                AstNodes::TSIndexedAccessType(parent) => {
                    matches!(parent.kind(), TypeKind::IndexedAccess { obj, .. } if obj == ty)
                }
                _ => false,
            }
        }
        _ => false,
    }
}

fn function_like_type_needs_parentheses<'a>(
    ty: TypeNode<'a>,
    parent: AstNodes<'a>,
    return_type: Option<TypeNode<'a>>,
) -> bool {
    match parent {
        AstNodes::TSConditionalType(conditional) => {
            let TypeKind::Cond { check, extends, .. } = conditional.kind() else {
                return false;
            };
            if check == ty {
                return true;
            }
            if extends != ty {
                return false;
            }
            let return_type = match return_type.map(TypeNode::kind) {
                Some(TypeKind::Predicate { ty: Some(asserted), .. }) => Some(asserted),
                _ => return_type,
            };
            matches!(return_type.map(TypeNode::kind), Some(TypeKind::Infer(param)) if param.constraint().is_some())
        }
        AstNodes::TSUnionType(parent) | AstNodes::TSIntersectionType(parent) => member_count(parent) > 1,
        _ => operator_type_or_higher_needs_parens(ty, parent),
    }
}

/// Whether `parent` is an operator that binds more tightly than any that `ty` can be.
fn operator_type_or_higher_needs_parens<'a>(ty: TypeNode<'a>, parent: AstNodes<'a>) -> bool {
    match parent {
        AstNodes::TSArrayType(_) | AstNodes::TSTypeOperator(_) | AstNodes::TSRestType(_) | AstNodes::TSOptionalType(_) => {
            true
        }
        AstNodes::TSIndexedAccessType(indexed) => {
            matches!(indexed.kind(), TypeKind::IndexedAccess { obj, .. } if obj == ty)
        }
        _ => false,
    }
}
