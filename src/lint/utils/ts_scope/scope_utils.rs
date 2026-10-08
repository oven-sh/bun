//! typescript-eslint's `util/scopeUtils.ts`.

use crate::ast::{ExprKind, FnKind, KeyKind, Name, Node};
use crate::semantic::Reference;
use smallvec::SmallVec;

/// When typescript-eslint's `Referencer` visits `child` among the children of `parent`, where that
/// is not the order they are written in. Children with the same number are visited in that order.
fn visit_rank<'a>(parent: Node<'a>, child: Node<'a>) -> u8 {
    match (parent, child) {
        (Node::VarDecl(_), Node::Pat(_)) => 0,
        (Node::VarDecl(_), Node::Expr(_)) => 1,
        (Node::VarDecl(_), _) => 2,
        (Node::Param(_), Node::Pat(_)) => 0,
        (Node::Param(param), Node::Expr(e)) if param.default() == Some(e) => 0,
        (Node::Param(_), Node::Type(_)) => 1,
        // Decorators.
        (Node::Param(_), _) => 2,
        // Signatures and function types are visited as they are written.
        (Node::Func(func), _)
            if !matches!(
                func.kind(),
                FnKind::Decl
                    | FnKind::Expr
                    | FnKind::Arrow
                    | FnKind::Method
                    | FnKind::Getter
                    | FnKind::Setter
                    | FnKind::Constructor
            ) || matches!(func.owner(), Node::Member(member) if member.is_signature()) =>
        {
            0
        }
        (Node::Func(_), Node::Param(_)) => 0,
        (Node::Func(_), Node::Type(_)) => 1,
        (Node::Func(_), Node::TypeParam(_)) => 2,
        (Node::Func(_), _) => 3,
        (Node::Class(class), Node::Expr(e)) => u8::from(class.extends() == Some(e)),
        (Node::Class(_), Node::TypeParam(_)) => 2,
        (Node::Class(_), Node::Type(_)) => 3,
        (Node::Class(_), _) => 4,
        (Node::Member(member), Node::Expr(e)) => match member.key().map(|key| key.kind()) {
            Some(KeyKind::Computed(key)) if key == e => 0,
            _ if member.init() == Some(e) => 1,
            // Decorators.
            _ => 2,
        },
        (Node::Member(_), Node::Func(_)) => 1,
        (Node::Member(_), _) => 3,
        (Node::Expr(e), Node::Type(_)) => u8::from(matches!(
            e.kind(),
            ExprKind::Call(_)
                | ExprKind::New(_)
                | ExprKind::TaggedTemplate(_)
                | ExprKind::As { .. }
                | ExprKind::Satisfies { .. }
        )),
        _ => 0,
    }
}

/// Whether typescript-eslint creates the reference `a` before `b`, which is written after it.
fn is_created_before<'a>(a: Reference<'a>, b: Reference<'a>) -> bool {
    let path = |reference: Reference<'a>| -> SmallVec<[Node<'a>; 24]> {
        let node = reference.node();
        std::iter::once(node).chain(node.ancestors()).collect()
    };
    let (path_a, path_b) = (path(a), path(b));
    // From the file down to where the two part.
    let mut down = path_a.iter().rev().zip(path_b.iter().rev());
    let mut parent = None;
    for (&in_a, &in_b) in &mut down {
        if in_a != in_b {
            return parent.is_none_or(|it| visit_rank(it, in_a) <= visit_rank(it, in_b));
        }
        parent = Some(in_a);
    }
    true
}

/// typescript-eslint's `isReferenceToGlobalFunction`. `node` is where `callee_name` is used: the
/// call, the type reference, the identifier.
///
/// As upstream, it looks at the first reference to that name that is directly in the scope of
/// `node`, in the order typescript-eslint creates them: the initializer of a variable before its
/// type, the parameters of a function before its type parameters. `true` if there is none, or if
/// nothing in the file declares what it refers to, which also holds for the implicit `arguments` of
/// a function.
pub fn is_reference_to_global_function<'a>(
    callee_name: Name<'a>,
    node: impl Into<Node<'a>>,
) -> bool {
    let is_global = |reference: &Reference<'a>| {
        reference
            .symbol()
            .is_none_or(|symbol| symbol.declarations().len() == 0)
    };
    let references = node.into().scope().references();
    let references: SmallVec<[Reference<'a>; 8]> = references
        .filter(|reference| reference.name() == callee_name)
        .collect();
    let Some((&(mut first), rest)) = references.split_first() else {
        return true;
    };
    // The order only matters if they do not all refer to the same.
    if rest.iter().any(|it| is_global(it) != is_global(&first)) {
        for &reference in rest {
            if !is_created_before(first, reference) {
                first = reference;
            }
        }
    }
    is_global(&first)
}
