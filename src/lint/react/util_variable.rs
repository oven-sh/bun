//! `lib/util/variable.js` of eslint-plugin-react.
//!
//! `findVariable(variables, name)` and `getVariable(variables, name)` with
//! `variablesInScope` are [`Scope::get_name`] up the [`Scope::chain`].

use bun_lint::prelude::*;

/// `getVariableFromContext`: it also looks into the first scope in each scope, and into the first
/// in that.
pub(crate) fn variable_from_context<'a>(node: Node<'a>, name: Name<'a>) -> Option<Variable<'a>> {
    let from = node.scope();
    from.chain().find_map(|scope| {
        scope.variable(name).or_else(|| {
            let child = scope.children().next()?;
            let symbol =
                (child.get_name(name)).or_else(|| child.children().next()?.get_name(name))?;
            Some(symbol.variable_in(from))
        })
    })
}

/// The same, if the file declares it.
pub(crate) fn get_variable_from_context<'a>(node: Node<'a>, name: Name<'a>) -> Option<Symbol<'a>> {
    variable_from_context(node, name)?.symbol()
}

/// What `findVariableByName` returns.
#[derive(Copy, Clone)]
pub(crate) enum Found<'a> {
    /// `defs[0].node` of an `ImportBinding`: the specifier.
    Import(Declaration<'a>),
    /// `defs[0].node.init`
    Init(Expr<'a>),
}

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

pub(crate) fn get_latest_variable_definition(variable: Symbol<'_>) -> Option<Declaration<'_>> {
    variable.declarations().next_back()
}
