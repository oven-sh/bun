#![allow(dead_code)] // until every rule of the plugin is written
//! `lib/util/variable.js` of eslint-plugin-react.
//!
//! `findVariable(variables, name)` and `getVariable(variables, name)` with
//! `variablesInScope` are [`Scope::get_name`] up the [`Scope::chain`].

use bun_lint::prelude::*;

/// `getVariableFromContext`: it also looks into the first scope in each scope, and into the first
/// in that.
pub(crate) fn get_variable_from_context<'a>(node: Node<'a>, name: Name<'a>) -> Option<Symbol<'a>> {
    node.scope().chain().find_map(|scope| {
        scope.get_name(name).or_else(|| {
            // For ESLint a class declaration declares its name in its own scope as well.
            if let Node::Class(class) = scope.node()
                && class.name().is_some_and(|it| it.name() == name)
            {
                return class.symbol();
            }
            // For ESLint what the configuration defines is a variable of the global scope.
            if scope.parent().is_none() && node.file().global_named(name).is_some() {
                return None;
            }
            let child = scope.children().next()?;
            (child.get_name(name)).or_else(|| child.children().next()?.get_name(name))
        })
    })
}

/// What `findVariableByName` returns.
#[derive(Copy, Clone)]
pub(crate) enum Found<'a> {
    /// `defs[0].node` of an `ImportBinding`: the specifier.
    Import(Declaration<'a>),
    /// `defs[0].node.init`
    Init(Expr<'a>),
}

/// `findVariableByName`
pub(crate) fn find_variable_by_name<'a>(node: Node<'a>, name: Name<'a>) -> Option<Found<'a>> {
    use Declaration::{ImportDefault, ImportEquals, ImportNamespace, ImportSpec};
    let declaration = get_variable_from_context(node, name)?
        .declarations()
        .next()?;
    match declaration {
        ImportDefault(_) | ImportNamespace(_) | ImportSpec(_) | ImportEquals(_) => {
            Some(Found::Import(declaration))
        }
        _ => match declaration.node()? {
            Node::VarDecl(it) => it.init().map(Found::Init),
            _ => None,
        },
    }
}

/// `getLatestVariableDefinition`
pub(crate) fn get_latest_variable_definition(variable: Symbol<'_>) -> Option<Declaration<'_>> {
    variable.declarations().next_back()
}
