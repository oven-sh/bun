//! `sourceCode.isSpaceBetweenTokens`, which ESLint 10 removed. eslint-plugin-react gets it from
//! @eslint/compat's `fixupPluginRules`. Also `markVariableAsUsed` from `lib/util/eslint.js`.

use bun_core::strings;
use bun_lint::prelude::*;

/// `nodesOrTokensOverlap`. Two ranges that touch count as overlapping.
fn nodes_or_tokens_overlap(first: Span, second: Span) -> bool {
    (first.start <= second.start && first.end >= second.start)
        || (second.start <= first.start && second.end >= first.start)
}

/// `isSpaceBetweenTokens`. Unlike [`File::is_space_between`], whitespace inside a `JSXText` between
/// the two counts. Known difference: this checks the raw text, while espree decodes the token's
/// `value`, so with espree upstream also counts an `&nbsp;` as whitespace.
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

/// `markVariableAsUsed`, which is ESLint's `sourceCode.markVariableAsUsed(name, node)`.
pub(crate) fn mark_variable_as_used<'a>(name: Name<'a>, node: Node<'a>) {
    match node.scope().find_variable(name).map(Variable::kind) {
        Some(VariableKind::Declared(symbol)) => symbol.mark_used(),
        // Nothing reads the used flag of the variable that a class declares for its name in its own scope.
        Some(VariableKind::NameInClass { .. } | VariableKind::FileArguments) => {}
        Some(VariableKind::Global(_)) | None => {
            if node.file().global_in_comments(name.bytes()).is_some() {
                node.file().mark_global_used(name.bytes());
            }
        }
    }
}
