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
fn effective_parent(parent: AstNodes<'_>) -> AstNodes<'_> {
    match parent {
        AstNodes::TSUnionType(ty) | AstNodes::TSIntersectionType(ty) if member_count(ty) <= 1 => {
            effective_parent(parent.parent())
        }
        other => other,
    }
}

pub(crate) fn needs_parentheses<'a>(ty: TypeNode<'a>, _f: &Formatter<'a>) -> bool {
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
        TypeKind::Infer(_) => match effective_parent(ty.ast_parent()) {
            AstNodes::TSIntersectionType(_) | AstNodes::TSUnionType(_) => true,
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
            match return_type.map(TypeNode::kind) {
                Some(TypeKind::Infer(param)) => param.constraint().is_some(),
                Some(TypeKind::Predicate { ty, .. }) => ty.is_some(),
                _ => false,
            }
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
