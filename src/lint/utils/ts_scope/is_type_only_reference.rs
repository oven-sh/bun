//! typescript-eslint's `util/isTypeOnlyReference.ts`, and the questions it asks of
//! `@typescript-eslint/scope-manager`.

use super::{reference_contains_type_predicate, reference_contains_type_query};
use crate::semantic::{Declaration, DeclarationKind, DeclarationKinds, Reference, Symbol};

/// scope-manager's `definition.isTypeDefinition`: a class, an enum, an enum member, a namespace, an
/// import, an interface, a type alias, a type parameter.
pub fn is_type_definition(declaration: Declaration) -> bool {
    !matches!(
        declaration,
        Declaration::Var(_) | Declaration::Param(_) | Declaration::Fn(_) | Declaration::Other
    )
}

/// scope-manager's `definition.type === DefinitionType.Variable`: bound by `var`, `let`, `const`
/// or `using`, and not by `catch`.
#[inline]
pub fn is_variable_declarator_definition(declaration: Declaration) -> bool {
    declaration.kind() == Some(DeclarationKind::Variable)
}

/// typescript-eslint's `isTypeOnlyReference`: a use of `variable` that does not need its value at
/// run time.
pub fn is_type_only_reference(variable: Symbol, reference: Reference) -> bool {
    let is_in_type = match reference.expr().is_some() {
        true => reference_contains_type_query(reference),
        false => reference_contains_type_predicate(reference),
    };
    is_in_type
        || !reference.is_value()
            && variable
                .declaration_kinds()
                .contains(DeclarationKinds::VARIABLE)
}
