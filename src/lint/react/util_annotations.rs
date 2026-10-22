//! `lib/util/annotations.js` of eslint-plugin-react.

use bun_lint::prelude::*;
use bun_lint::tokens::next_token;

/// `tokens[0].value === "props" || tokens[1].value === "props"`, where `tokens` are the first two
/// tokens of a node that starts at `start` and has more than two.
pub(crate) fn is_props(file: &File<'_>, start: u32) -> bool {
    let first = next_token(file.text(), start);
    let second = next_token(file.text(), first.end);
    [first, second].into_iter().any(|token| {
        let token_text = file.slice(token);
        // The `value` of a `PrivateIdentifier` has no `#`.
        token_text.strip_prefix(b"#").unwrap_or(token_text) == b"props"
    })
}

/// `isAnnotatedFunctionPropsDeclaration`. True if the first parameter has a type annotation and is
/// an object pattern or starts with `props`, which includes `...props` and `[props]`.
pub(crate) fn is_annotated_function_props_declaration(func: Func<'_>) -> bool {
    let Some(param) = func.params_with_this().next() else {
        return false;
    };
    // A `TSParameterProperty` has no `typeAnnotation`.
    if param.ty().is_none() || param.is_parameter_property() {
        return false;
    }
    // The annotation of `...props: Props` belongs to the `RestElement`.
    if param.is_rest() {
        return is_props(func.file(), param.span().start);
    }
    let type_node = param.pat();
    type_node.tag() == PatTag::Object || is_props(func.file(), type_node.span().start)
}
