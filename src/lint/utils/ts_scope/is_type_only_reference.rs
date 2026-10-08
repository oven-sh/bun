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

/// scope-manager's `definition.isVariableDefinition`: anything but an interface, a type alias and a
/// type parameter. A namespace counts whatever is in it, and an import whatever it imports.
pub fn is_variable_definition(declaration: Declaration) -> bool {
    !matches!(
        declaration,
        Declaration::Interface(_)
            | Declaration::TypeAlias(_)
            | Declaration::TypeParam(_)
            | Declaration::Other
    )
}

/// scope-manager's `variable.isTypeVariable`.
#[inline]
pub fn is_type_variable(variable: Symbol) -> bool {
    variable.is_type_variable()
}

/// scope-manager's `variable.isValueVariable`.
#[inline]
pub fn is_value_variable(variable: Symbol) -> bool {
    variable.is_value_variable()
}

/// scope-manager's `reference.isValueReference`. A `typeof a` in a type and the `x` of `x is T`
/// refer to values.
#[inline]
pub fn is_value_reference(reference: Reference) -> bool {
    reference.is_value()
}

/// scope-manager's `definition.type === DefinitionType.Variable`: bound by `var`, `let`, `const`
/// or `using`, and not by `catch`.
#[inline]
pub fn is_variable_declarator_definition(declaration: Declaration) -> bool {
    declaration.kind() == Some(DeclarationKind::Variable)
}

/// typescript-eslint's `isMergedTypeValueVariable`.
pub fn is_merged_type_value_variable(variable: Symbol) -> bool {
    is_type_variable(variable) && is_value_variable(variable)
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
