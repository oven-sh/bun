//! `get-function-name-with-kind.mjs`

use super::get_property_name::property_name_of_key;
use crate::ast::{
    Expr, ExprKind, File, Flags, FnKind, Func, Key, KeyKind, MemberKind, Name, Node, PropKind,
    StmtKind,
};
use crate::tokens::{skip_trivia, token_len};
use bun_core::strings;

/// `sourceCode.getText(key)`: without the brackets of a computed key.
fn key_text<'a>(key: Key<'a>, file: &'a File<'a>) -> &'a [u8] {
    match key.kind() {
        KeyKind::Computed(e) => e.text(),
        KeyKind::ComputedString(_) | KeyKind::ComputedNumber(_) => {
            let start = skip_trivia(file.text(), key.span(file).start + 1) as usize;
            let rest = file.text().get(start..).unwrap_or_default();
            rest.get(..token_len(rest)).unwrap_or_default()
        }
        _ => file.slice(key.span(file)),
    }
}

/// The identifier that a function expression is the value or the default value of.
fn assigned_name(e: Expr<'_>) -> Option<Name<'_>> {
    match e.parent() {
        Node::VarDecl(declaration) => declaration.pat().as_ident(),
        Node::Param(param) => param.pat().as_ident(),
        Node::PatElem(element) => element.pat()?.as_ident(),
        Node::PatProp(prop) if prop.default() == Some(e) => prop.value().as_ident(),
        Node::Expr(parent) => match parent.kind() {
            ExprKind::Assign { target, .. } => target.as_ident(),
            _ => None,
        },
        _ => None,
    }
}

/// eslint-utils' `getFunctionNameWithKind`: `"async function 'foo'"`, `"static method 'foo'"`,
/// `"private getter #foo"`, `"arrow function 'foo'"`, `"constructor"`, ..
///
/// This is not ESLint's own `astUtils.getFunctionNameWithKind`, which words some of these
/// differently. typescript-eslint's rules use this one.
///
/// `with_key_text` stands for upstream's optional `sourceCode` argument: a computed key whose
/// value is not known is then shown as it is written, `"method [foo]"`.
pub fn get_function_name_with_kind(func: Func<'_>, with_key_text: bool) -> Vec<u8> {
    let file = func.file();
    let owner = func.owner();
    // The `Property`, `MethodDefinition` or `PropertyDefinition` whose value it is: its key, and
    // how its kind is called.
    let mut property: Option<(Option<Key<'_>>, &str)> = None;
    let mut is_static = false;
    match owner {
        Node::Member(member) if !member.flags().contains(Flags::ABSTRACT) => {
            is_static = member.is_static();
            match member.kind() {
                MemberKind::Constructor if !is_static => return b"constructor".to_vec(),
                MemberKind::Constructor => return b"static method 'constructor'".to_vec(),
                MemberKind::Getter => property = Some((member.key(), "getter")),
                MemberKind::Setter => property = Some((member.key(), "setter")),
                // `"constructor"<T>() {}`
                MemberKind::Method
                    if !is_static && member.key().is_some_and(|key| !key.is_computed() && key.is("constructor")) =>
                {
                    return b"constructor".to_vec();
                }
                MemberKind::Method => property = Some((member.key(), "method")),
                _ => {}
            }
        }
        Node::Expr(e) => match e.parent() {
            Node::Prop(prop) if prop.value() == Some(e) && !prop.is_jsx_attribute() => {
                let kind = match prop.kind() {
                    PropKind::Getter => "getter",
                    PropKind::Setter => "setter",
                    _ => "method",
                };
                property = Some((prop.key(), kind));
            }
            Node::Member(member)
                if member.init() == Some(e) && !member.flags().contains(Flags::ACCESSOR) =>
            {
                is_static = member.is_static();
                property = Some((member.key(), "method"));
            }
            _ => {}
        },
        _ => {}
    }

    let mut words: Vec<u8> = Vec::new();
    let mut word = |text: &[&[u8]]| {
        if !words.is_empty() {
            words.push(b' ');
        }
        text.iter().for_each(|part| words.extend_from_slice(part));
    };
    if is_static {
        word(&[b"static"]);
    }
    if matches!(property, Some((Some(key), _)) if key.is_private()) {
        word(&[b"private"]);
    }
    if func.is_async() {
        word(&[b"async"]);
    }
    if func.is_generator() {
        word(&[b"generator"]);
    }

    if let Some((key, kind)) = property {
        word(&[kind.as_bytes()]);
        let Some(key) = key else {
            return words;
        };
        if let KeyKind::Private(name) = key.kind() {
            word(&[name.bytes()]);
        } else if let Some(name) = property_name_of_key(key, None).filter(|name| !name.is_empty()) {
            word(&[b"'", &name, b"'"]);
        } else if with_key_text {
            let text = key_text(key, file);
            if !strings::contains_char(text, b'\n') {
                word(&[b"[", text, b"]"]);
            }
        }
        return words;
    }

    if func.kind() == FnKind::Arrow {
        word(&[b"arrow"]);
    }
    word(&[b"function"]);
    if let Some(name) = func.name() {
        word(&[b"'", name.bytes(), b"'"]);
    } else if let Node::Expr(e) = owner {
        if let Some(name) = assigned_name(e) {
            word(&[b"'", name.bytes(), b"'"]);
        } else if matches!(e.parent().as_stmt().map(|it| it.kind()), Some(StmtKind::ExportDefault(_))) {
            word(&[b"'default'"]);
        }
    } else if matches!(owner, Node::Stmt(statement) if statement.flags().contains(Flags::DEFAULT)) {
        word(&[b"'default'"]);
    }
    words
}
