#![allow(dead_code)] // until every rule of the plugin is written
//! `sourceCode.isSpaceBetweenTokens`, which ESLint 10 no longer has: eslint-plugin-react gets it
//! from `fixupPluginRules` of @eslint/compat. And `markVariableAsUsed` of `lib/util/eslint.js`.

use crate::util_steps::Way;
use bun_core::strings;
use bun_lint::prelude::*;

/// `nodesOrTokensOverlap`: two that touch overlap.
fn nodes_or_tokens_overlap(first: Span, second: Span) -> bool {
    (first.start <= second.start && first.end >= second.start)
        || (second.start <= first.start && second.end >= first.start)
}

/// `isSpaceBetweenTokens`. Not [`File::is_space_between`]: white space in a `JSXText` between the
/// two counts. It is looked for in the text as written: espree's `value` has `&nbsp;` decoded.
pub(crate) fn is_space_between_tokens<'a>(file: &'a File<'a>, first: Span, second: Span) -> bool {
    if nodes_or_tokens_overlap(first, second) {
        return false;
    }
    let (starting_node_or_token, ending_node_or_token) = match first.end <= second.start {
        true => (first, second),
        false => (second, first),
    };
    let first_token = file.last_token(starting_node_or_token);
    let first_token = first_token.map_or(starting_node_or_token, Token::span);
    let final_token = file.first_token(ending_node_or_token);
    let final_token = final_token.map_or(ending_node_or_token, Token::span);
    let mut current_token = first_token;
    let mut tokens_after = file.tokens_after(first_token).with_comments();
    while current_token != final_token {
        // Upstream throws at the end of the file.
        let Some(next_token) = tokens_after.next() else {
            return false;
        };
        let value = next_token.value();
        if current_token.end != next_token.start()
            || (next_token.span() != final_token
                && next_token.kind() == TokenKind::JsxText
                && (0..value.len()).any(|at| strings::js_whitespace_len(&value[at..]) > 0))
        {
            return true;
        }
        current_token = next_token.span();
    }
    false
}

/// `markVariableAsUsed`: ESLint's `sourceCode.markVariableAsUsed(name, node)`.
pub(crate) fn mark_variable_as_used<'a>(name: Name<'a>, node: Node<'a>) {
    let scope = node.scope();
    let Some(variable) = scope.resolve_name(name) else {
        if node.file().global_in_comments(name.bytes()).is_some() {
            node.file().mark_global_used(name.bytes());
        }
        return;
    };
    // In a class its name is a second variable for ESLint: that one is found, and nobody asks it.
    let (declared_in, way) = (variable.scope(), Way::new(node.file()));
    let mut declarations = variable.declarations().take_while(|_| way.take(1));
    let is_name_of_class_around = declarations.any(|it| match it {
        Declaration::Class(class) => {
            (class.scope()).is_some_and(|inside| inside != declared_in && inside.contains(scope))
        }
        _ => false,
    });
    if !is_name_of_class_around {
        variable.mark_used();
    }
}
