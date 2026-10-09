//! `@param` tags are put in the order of the parameters of the function behind the comment.

use super::text::trim_start;
use bun_lint::ast::jsdoc::JSDocTag;
use bun_lint::ast::{
    Expr, ExprKind, File, Flags, FnKind, Func, Key, KeyKind, List, MemberKind, Modifier, Name,
    Node, PropKind, StmtKind,
};

/// `comment_end`: where the comment ends in `file`. Only if every `@param` has a type and a name, and the names
/// are those of the parameters.
pub(super) fn reorder_param_tags<'a>(
    effective_tags: &mut [(JSDocTag<'a>, &'a [u8])],
    file: &'a File<'a>,
    comment_end: u32,
) {
    let Some(param_start) = effective_tags
        .iter()
        .position(|(_, kind)| *kind == b"param")
    else {
        return;
    };
    let param_end = effective_tags[param_start..]
        .iter()
        .position(|(_, kind)| *kind != b"param")
        .map_or(effective_tags.len(), |at| param_start + at);
    if param_end - param_start < 2 {
        return;
    }
    let mut names: Vec<&[u8]> = Vec::with_capacity(param_end - param_start);
    for (tag, _) in &effective_tags[param_start..param_end] {
        match tag.type_name_comment() {
            (Some(_), Some(name), _) => names.push(name.parsed()),
            _ => return,
        }
    }
    let function_params = function_behind(file, comment_end).map_or_else(Vec::new, parameter_names);
    if function_params.len() != names.len()
        || names == function_params
        || !names.iter().all(|name| function_params.contains(name))
    {
        return;
    }
    crate::sort::sort_by_key(&mut effective_tags[param_start..param_end], |(tag, _)| {
        let name = tag
            .type_name_comment()
            .1
            .map_or(&b""[..], |name| name.parsed());
        function_params
            .iter()
            .position(|param| *param == name)
            .unwrap_or(usize::MAX)
    });
}

/// How deep in the tree the function is looked for. A chain of calls can be as long as the file, with a comment
/// in each call.
const MAX_DEPTH: usize = 256;

/// The function whose head starts with what follows the comment that ends at `comment_end`.
fn function_behind<'a>(file: &'a File<'a>, comment_end: u32) -> Option<Func<'a>> {
    let after = file.text().get(comment_end as usize..)?;
    let start = comment_end + (after.len() - trim_start(after).len()) as u32;
    let mut node = Node::File(file);
    for _ in 0..MAX_DEPTH {
        let mut child_at_start = None;
        node.for_each_child_near(start, |child| {
            if child_at_start.is_none() && child.span().contains_offset(start) {
                child_at_start = Some(child);
            }
        });
        node = child_at_start?;
        if node.span().start == start
            && let Some(func) = function_with_known_head(node)
        {
            return Some(func);
        }
    }
    None
}

/// The function that `node` is or declares. oxfmt looks for the `(` of the parameters in the text behind the
/// comment, and finds it behind these heads only.
fn function_with_known_head<'a>(node: Node<'a>) -> Option<Func<'a>> {
    match node {
        Node::Stmt(statement) if are_passed_over(statement.modifiers()) => match statement.kind() {
            StmtKind::Fn(func) => Some(func),
            // `const f = (a, b) => {}`
            StmtKind::Var(declarations) => {
                let first = declarations.first()?;
                let has_plain_name = first.pat().as_ident().is_some_and(is_plain_name);
                arrow_function(first.init()?).filter(|_| has_plain_name && first.ty().is_none())
            }
            // `return (a, b) => {}`
            StmtKind::Return(value) => arrow_function(value?).filter(|it| !it.is_async()),
            _ => None,
        },
        Node::Expr(e) => match e.kind() {
            ExprKind::Fn(func) => (func.kind() == FnKind::Expr).then_some(func),
            // `f = (a, b) => {}`
            ExprKind::Assign {
                op: None,
                target,
                value,
            } => match target.kind() {
                ExprKind::Ident(name) if is_plain_name(name) => arrow_function(value),
                _ => None,
            },
            _ => None,
        },
        Node::Member(member)
            if are_passed_over(member.modifiers()) && !member.flags().contains(Flags::OPTIONAL) =>
        {
            match member.kind() {
                MemberKind::Constructor | MemberKind::ConstructSignature => member.func(),
                MemberKind::Method if is_plain_key(member.key()) => {
                    member.func().filter(|it| !it.is_generator())
                }
                // `f = (a, b) => {}`
                MemberKind::Property if is_plain_key(member.key()) && member.ty().is_none() => {
                    arrow_function(member.init()?)
                }
                _ => None,
            }
        }
        Node::Prop(prop) if prop.kind() == PropKind::Method && is_plain_key(prop.key()) => {
            prop.func().filter(|it| !it.is_generator())
        }
        _ => None,
    }
}

/// Whether there is nothing but `export`, `default` and `async`.
fn are_passed_over<'a>(modifiers: List<'a, Modifier<'a>>) -> bool {
    modifiers.iter().all(|it| {
        it.flag()
            .intersects(Flags::EXPORT | Flags::DEFAULT | Flags::ASYNC)
    })
}

/// `(a, b) => {}` that is not in parentheses and has no type parameters.
fn arrow_function(e: Expr<'_>) -> Option<Func<'_>> {
    e.as_fn()
        .filter(|it| it.is_arrow() && it.type_params().is_empty() && !e.is_parenthesized())
}

fn is_identifier_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'$'
}

/// It is in ASCII, and none of the words that are passed over.
fn is_plain_name(name: Name<'_>) -> bool {
    let name = name.bytes();
    name.iter().all(|&byte| is_identifier_byte(byte))
        && !matches!(name, b"export" | b"default" | b"async")
}

fn is_plain_key(key: Option<Key<'_>>) -> bool {
    matches!(key.map(Key::kind), Some(KeyKind::Ident(name)) if is_plain_name(name))
}

/// What oxfmt takes for the names of the parameters: the word that each starts with, behind `...`. That is a
/// modifier if it has one. A pattern has none.
fn parameter_names(func: Func<'_>) -> Vec<&[u8]> {
    func.params_with_this()
        .filter_map(|param| {
            let text = param.text();
            let text = text.strip_prefix(b"...").unwrap_or(text);
            let len = text
                .iter()
                .take_while(|&&byte| is_identifier_byte(byte))
                .count();
            (len > 0).then(|| &text[..len])
        })
        .collect()
}
