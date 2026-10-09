//! Helpers of the rules of oxlint 1.87, under the names that they have there: for what a rule does
//! with a configuration of oxlint.

use super::ancestor_memo::AncestorMemo;
use super::ast_utils::is_global_reference;
use crate::ast::{
    Expr, ExprKind, File, Flags, FnKind, Func, Ident, Key, KeyKind, Member, MemberKind, ModuleName,
    Node, Prop, PropKind, StmtKind, VarDecl,
};
use crate::span::Span;
use smallvec::SmallVec;

/// [`is_global_reference`] for the rules whose port in oxlint goes by the name and does not ask what it refers to:
/// `Boolean`, `Promise`, `NaN`. With a configuration of oxlint it is enough that `e`, which the caller knows
/// to have the name, is written.
pub fn is_global_by_name(e: Expr) -> bool {
    e.file().language().is_oxlint || is_global_reference(e)
}

/// `GetFunctionHeadLoc` of tsgolint 7.0. Of an arrow function it is the `=>` and what is between it and the token before.
/// Of another function it is from the first modifier that is no decorator, or else from the first token, to the `(`: the
/// key of a property that the function is the value of is not part of it.
pub fn tsgolint_function_head_loc(func: Func) -> Span {
    if let Some(arrow) = func.arrow_span() {
        let start = func.file().end_of_token_before(arrow.start);
        return Span::new(start, arrow.end);
    }
    let whole = func.span();
    let modifier = match func.owner() {
        Node::Member(member) => member
            .modifiers()
            .iter()
            .find(|it| it.decorator().is_none()),
        _ => None,
    };
    let start = modifier.map_or(whole.start, |it| it.span().start);
    match func.open_paren() {
        Some(end) if start <= end => Span::new(start, end),
        _ => whole,
    }
}

/// `has_ambient_typescript_ancestor`, asked of many nodes of a file.
#[derive(Default)]
pub struct AmbientAncestors<'a>(AncestorMemo<'a, ()>);

impl<'a> AmbientAncestors<'a> {
    /// Whether `node` is in a `declare namespace`, a `declare module` or a `global`.
    pub fn has_ambient_typescript_ancestor(&mut self, node: Node<'a>) -> bool {
        let is_ambient = |_, parent: Node<'a>| match parent {
            Node::Stmt(statement) => match statement.kind() {
                StmtKind::Module(module) => {
                    let is_ambient = matches!(module.name(), ModuleName::Global)
                        || statement.flags().contains(Flags::AMBIENT);
                    is_ambient.then_some(())
                }
                _ => None,
            },
            _ => None,
        };
        self.0.find(node, is_ambient).is_some()
    }
}

/// What oxlint has as the parent of a function. There what is in parentheses has these as its parent.
#[derive(Copy, Clone)]
pub enum FunctionParent<'a> {
    MethodDefinition(Member<'a>),
    /// The function is the value of the field.
    PropertyDefinition(Member<'a>),
    ObjectProperty(Prop<'a>),
    VariableDeclarator(VarDecl<'a>),
    Other,
}

impl<'a> FunctionParent<'a> {
    pub fn of(func: Func<'a>) -> FunctionParent<'a> {
        let is_in_class = |member: Member<'a>| matches!(member.parent(), Node::Class(_));
        match func.owner() {
            Node::Member(member) if is_in_class(member) && func.kind() != FnKind::StaticBlock => {
                FunctionParent::MethodDefinition(member)
            }
            Node::Prop(prop) => FunctionParent::ObjectProperty(prop),
            Node::Expr(e) if !e.is_parenthesized() => match e.parent() {
                Node::Member(member)
                    if is_in_class(member)
                        && member.init() == Some(e)
                        && !member.flags().contains(Flags::ACCESSOR) =>
                {
                    FunctionParent::PropertyDefinition(member)
                }
                Node::Prop(prop) if !prop.is_jsx_attribute() && prop.kind() != PropKind::Spread => {
                    FunctionParent::ObjectProperty(prop)
                }
                Node::VarDecl(declarator) => FunctionParent::VariableDeclarator(declarator),
                _ => FunctionParent::Other,
            },
            _ => FunctionParent::Other,
        }
    }
}

/// The name of a computed key that is a literal, but no string and no number: `[null]`, `[/a/]`, `[1n]`.
fn name_of_computed_literal(e: Expr<'_>) -> Option<&[u8]> {
    match e.kind() {
        _ if e.is_parenthesized() => None,
        ExprKind::Null => Some(&b"null"[..]),
        ExprKind::Regex(_) => Some(e.text()),
        ExprKind::BigInt(_) => e.text().strip_suffix(b"n"),
        _ => None,
    }
}

/// `PropertyKey::name`: of a key that is a name or a literal. That of `#a` is `a`.
pub fn property_key_name(key: Key<'_>) -> Option<&[u8]> {
    match key.kind() {
        KeyKind::Private(name) => {
            let name = name.bytes();
            Some(name.strip_prefix(b"#").unwrap_or(name))
        }
        KeyKind::Ident(name)
        | KeyKind::String(name)
        | KeyKind::Number(name)
        | KeyKind::ComputedString(name)
        | KeyKind::ComputedNumber(name) => Some(name.bytes()),
        KeyKind::Computed(e) => name_of_computed_literal(e),
    }
}

/// [`property_key_name`] of the key of a member of a class, which a constructor has for oxlint.
pub fn member_key_name(member: Member<'_>) -> Option<&[u8]> {
    match member.key() {
        Some(key) => property_key_name(key),
        None => member.constructor_keyword().map(Ident::bytes),
    }
}

/// `get_static_property_name`, of the key. A string and a number have none.
fn get_static_property_name<'a>(key: Key<'a>, file: &File<'a>) -> Option<&'a [u8]> {
    let written = || file.slice(key.inner_span(file));
    match key.kind() {
        KeyKind::Ident(_) | KeyKind::Private(_) => property_key_name(key),
        KeyKind::Number(name) if written().ends_with(b"n") => Some(name.bytes()),
        KeyKind::ComputedString(name) if written().starts_with(b"`") => Some(name.bytes()),
        KeyKind::Computed(e) => name_of_computed_literal(e),
        _ => None,
    }
}

/// `get_function_name_with_kind`: ``function `a` ``, ``private static async method `b` ``. An arrow function is a
/// `function`.
pub fn get_function_name_with_kind(func: Func) -> Vec<u8> {
    let (file, parent) = (func.file(), FunctionParent::of(func));
    let mut tokens: SmallVec<[&[u8]; 6]> = SmallVec::new();
    let mut key_name = None;
    match parent {
        FunctionParent::MethodDefinition(member) | FunctionParent::PropertyDefinition(member) => {
            let flags = member.flags();
            if member.key().is_some_and(Key::is_private) || flags.contains(Flags::PRIVATE) {
                tokens.push(b"private");
            } else if flags.contains(Flags::PROTECTED) {
                tokens.push(b"protected");
            } else if flags.contains(Flags::PUBLIC) {
                tokens.push(b"public");
            }
            if member.is_static() {
                tokens.push(b"static");
            }
            key_name = match member.key() {
                Some(key) => get_static_property_name(key, file),
                None => (member.constructor_keyword())
                    .filter(|it| !it.is_string())
                    .map(Ident::bytes),
            };
        }
        FunctionParent::ObjectProperty(prop) => {
            key_name = prop.key().and_then(|it| get_static_property_name(it, file));
        }
        FunctionParent::VariableDeclarator(_) | FunctionParent::Other => {}
    }
    if func.is_async() {
        tokens.push(b"async");
    }
    if func.is_generator() {
        tokens.push(b"generator");
    }
    tokens.push(match parent {
        FunctionParent::MethodDefinition(member) => match member.kind() {
            _ if member.is_constructor() => b"constructor",
            MemberKind::Getter => b"getter",
            MemberKind::Setter => b"setter",
            _ => b"method",
        },
        FunctionParent::PropertyDefinition(_) => b"method",
        _ => b"function",
    });
    let mut out = tokens.join(&b' ');
    if let Some(name) = key_name.or_else(|| func.name().map(Ident::bytes)) {
        out.extend_from_slice(b" `");
        out.extend_from_slice(name);
        out.push(b'`');
    }
    out
}

/// `format_word_list`: `a`, `a and b`, `a, b, and c`.
pub fn format_word_list(words: &[&[u8]]) -> Vec<u8> {
    let mut out = Vec::new();
    for (i, word) in words.iter().enumerate() {
        match i {
            0 => {}
            _ if i + 1 < words.len() => out.extend_from_slice(b", "),
            _ if words.len() == 2 => out.extend_from_slice(b" and "),
            _ => out.extend_from_slice(b", and "),
        }
        out.extend_from_slice(word);
    }
    out
}
