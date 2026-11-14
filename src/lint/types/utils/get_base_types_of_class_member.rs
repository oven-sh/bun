//! `getBaseTypesOfClassMember.ts`

use crate::ast::{Member, Node};
use crate::types::{SyntaxKind, TsNode, Type};
use smallvec::SmallVec;

/// An item of [`get_base_types_of_class_member`]'s result.
#[derive(Copy, Clone, Debug)]
pub struct BaseTypeOfClassMember<'a> {
    /// A type the class extends or implements.
    pub base_type: Type<'a>,
    /// The member's type in `base_type`.
    pub base_member_type: Type<'a>,
    /// `ExtendsKeyword` or `ImplementsKeyword`
    pub heritage_token: SyntaxKind,
}

/// `getBaseTypesOfClassMember(services, memberNode)`: for a class member, the member with the same name in each type
/// the class extends or implements.
pub fn get_base_types_of_class_member(
    member_node: Member<'_>,
) -> SmallVec<[BaseTypeOfClassMember<'_>; 2]> {
    let mut found = SmallVec::new();
    if let Node::Class(class) = member_node.parent()
        && class.extends().is_none()
        && class.implements().is_empty()
    {
        return found;
    }
    let member_ts_node = member_node.ts_node();
    let Some(member_symbol) = member_ts_node
        .name()
        .and_then(|name| name.get_symbol_at_location())
    else {
        return found;
    };
    let Some(class_node) = member_ts_node.parent() else {
        return found;
    };
    // The heritage clauses are consecutive and come before the members.
    let is_heritage_clause = |child: &TsNode| child.kind() == SyntaxKind::HeritageClause;
    let children = class_node
        .children()
        .skip_while(|child| !is_heritage_clause(child));
    for clause_node in children.take_while(is_heritage_clause) {
        for base_type_node in clause_node.children() {
            let base_type = base_type_node.get_type_at_location();
            let Some(base_member_symbol) = base_type.get_property(member_symbol.name()) else {
                continue;
            };
            found.push(BaseTypeOfClassMember {
                base_type,
                base_member_type: base_member_symbol.get_type_at_location(member_ts_node),
                heritage_token: clause_node.token(),
            });
        }
    }
    found
}
