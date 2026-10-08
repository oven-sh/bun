//! `misc.ts`, and `requiresQuoting` of `@typescript-eslint/type-utils`.

use crate::ast::{Expr, ExprKind, Func, KeyKind, Member, MemberKind, Node, Prop, TypeKind, TypeNode};
use crate::semantic::Declaration;
use crate::tokens::{skip_trivia, skip_trivia_back};
use crate::utils::ast_utils::get_static_string_value;
use crate::utils::estree_compat::estree_span;
use crate::utils::text::{code_points, is_identifier_part, is_identifier_start};
use std::borrow::Cow;

/// typescript-eslint's `isDefinitionFile`: `*.d.ts`, `*.d.cts`, `*.d.mts`, `*.d.*.ts`, in any case.
pub fn is_definition_file(file_name: &[u8]) -> bool {
    let ends_with = |text: &[u8], suffix: &[u8]| {
        text.len() >= suffix.len() && text[text.len() - suffix.len()..].eq_ignore_ascii_case(suffix)
    };
    if [b".d.ts".as_slice(), b".d.cts", b".d.mts"].iter().any(|it| ends_with(file_name, it)) {
        return true;
    }
    // `/\.d\..*\.ts$/`
    ends_with(file_name, b".ts")
        && (0..file_name.len().saturating_sub(5))
            .any(|at| file_name[at..at + 3].eq_ignore_ascii_case(b".d."))
}

/// typescript-eslint's `arrayGroupByToMap`: the items by their key, the keys in the order of their
/// first item, as a `Map` iterates. O(items × keys).
pub fn array_group_by_to_map<T, K: PartialEq>(
    array: impl IntoIterator<Item = T>,
    mut get_key: impl FnMut(&T) -> K,
) -> Vec<(K, Vec<T>)> {
    let mut groups: Vec<(K, Vec<T>)> = Vec::new();
    for item in array {
        let key = get_key(&item);
        match groups.iter_mut().find(|group| group.0 == key) {
            Some(group) => group.1.push(item),
            None => groups.push((key, vec![item])),
        }
    }
    groups
}

/// typescript-eslint's `arraysAreEqual`.
pub fn arrays_are_equal<T>(
    a: Option<&[T]>,
    b: Option<&[T]>,
    mut eq: impl FnMut(&T, &T) -> bool,
) -> bool {
    match (a, b) {
        (None, None) => true,
        (Some(a), Some(b)) => a.len() == b.len() && a.iter().zip(b).all(|(x, y)| eq(x, y)),
        _ => false,
    }
}

/// typescript-eslint's `findFirstResult`, which is [`Iterator::find_map`].
#[inline]
pub fn find_first_result<T, U>(
    inputs: impl IntoIterator<Item = T>,
    get_result: impl FnMut(T) -> Option<U>,
) -> Option<U> {
    inputs.into_iter().find_map(get_result)
}

/// typescript-eslint's `findLastIndex`, which is [`Iterator::rposition`]. `None` for upstream's -1.
#[inline]
pub fn find_last_index<T>(members: &[T], predicate: impl FnMut(&T) -> bool) -> Option<usize> {
    members.iter().rposition(predicate)
}

/// typescript-eslint's `getNameFromIndexSignature`: the `key` of `[key: string]: T`.
pub fn get_name_from_index_signature(member: Member<'_>) -> &[u8] {
    let params = member.func().map(Func::params);
    match params.and_then(|params| params.iter().find_map(|param| param.pat().as_ident())) {
        Some(name) => name.bytes(),
        None => b"(index signature)",
    }
}

/// typescript-eslint's `MemberNameType`.
#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub enum MemberNameType {
    Private = 1,
    Quoted = 2,
    Normal = 3,
    Expression = 4,
}

/// What [`get_name_from_member`] returns.
#[derive(Clone, PartialEq, Eq, Hash, Debug)]
pub struct MemberName<'a> {
    /// A `Private` name has its `#`, a `Quoted` one is in double quotes.
    pub name: Cow<'a, [u8]>,
    /// Upstream's `type`.
    pub kind: MemberNameType,
}

/// typescript-eslint's `NodeWithKey`: what has a name that
/// [`get_static_member_access_value`](super::get_static_member_access_value) and
/// [`get_name_from_member`] look at.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum NodeWithKey<'a> {
    /// A member of a class, an interface or a type literal.
    Member(Member<'a>),
    /// A property of an object literal.
    Prop(Prop<'a>),
    /// `a.b`, `a[b]`
    MemberExpression(Expr<'a>),
}

impl<'a> From<Member<'a>> for NodeWithKey<'a> {
    #[inline]
    fn from(member: Member<'a>) -> Self {
        NodeWithKey::Member(member)
    }
}

impl<'a> From<Prop<'a>> for NodeWithKey<'a> {
    #[inline]
    fn from(prop: Prop<'a>) -> Self {
        NodeWithKey::Prop(prop)
    }
}

impl<'a> From<Expr<'a>> for NodeWithKey<'a> {
    #[inline]
    fn from(e: Expr<'a>) -> Self {
        NodeWithKey::MemberExpression(e)
    }
}

impl<'a> NodeWithKey<'a> {
    /// The `key` or the `property` of ESTree. `None` for what has none: a spread, a signature
    /// without a name, an expression that is not a member access.
    pub(super) fn key(self) -> Option<KeyKind<'a>> {
        match self {
            NodeWithKey::Member(member) => member.key().map(|key| key.kind()),
            NodeWithKey::Prop(prop) => prop.key().map(|key| key.kind()),
            NodeWithKey::MemberExpression(e) => match e.kind() {
                ExprKind::Dot { name, .. } => Some(match name.bytes().starts_with(b"#") {
                    true => KeyKind::Private(name.name()),
                    false => KeyKind::Ident(name.name()),
                }),
                ExprKind::Index { index, .. } => Some(KeyKind::Computed(index)),
                _ => None,
            },
        }
    }

    /// The text of the `key` of a `Member` or a `Prop`, without the brackets.
    fn key_text(self) -> &'a [u8] {
        let (key, file) = match self {
            NodeWithKey::Member(member) => (member.key(), member.file()),
            NodeWithKey::Prop(prop) => (prop.key(), prop.file()),
            NodeWithKey::MemberExpression(_) => return b"",
        };
        key.map_or(b"", |key| file.slice(key.inner_span(file)))
    }

    pub(super) fn is_constructor(self) -> bool {
        matches!(self, NodeWithKey::Member(member) if member.kind() == MemberKind::Constructor)
    }
}

/// The name of a key that is a `Literal` whose value, as a string, is `name`.
fn literal_member_name(name: Cow<'_, [u8]>) -> MemberName<'_> {
    match requires_quoting(&name) {
        true => {
            let mut quoted = Vec::with_capacity(name.len() + 2);
            quoted.push(b'"');
            quoted.extend_from_slice(&name);
            quoted.push(b'"');
            MemberName {
                name: Cow::Owned(quoted),
                kind: MemberNameType::Quoted,
            }
        }
        false => MemberName {
            name,
            kind: MemberNameType::Normal,
        },
    }
}

/// typescript-eslint's `getNameFromMember`, for a `Member` or a `Prop`.
///
/// As upstream, brackets make no difference to a key that is an identifier or a literal: `[a]` is
/// the `Normal` name `a`. Any other computed key is an `Expression`, named by its text.
pub fn get_name_from_member<'a>(member: impl Into<NodeWithKey<'a>>) -> MemberName<'a> {
    let member = member.into();
    let normal = |name: &'a [u8]| MemberName {
        name: Cow::Borrowed(name),
        kind: MemberNameType::Normal,
    };
    match member.key() {
        None if member.is_constructor() => normal(b"constructor"),
        None => MemberName {
            name: Cow::Borrowed(b""),
            kind: MemberNameType::Expression,
        },
        Some(KeyKind::Ident(name)) => normal(name.bytes()),
        Some(KeyKind::Private(name)) => MemberName {
            name: Cow::Borrowed(name.bytes()),
            kind: MemberNameType::Private,
        },
        // A template is not a `Literal`.
        Some(KeyKind::ComputedString(_)) if member.key_text().starts_with(b"`") => MemberName {
            name: Cow::Borrowed(member.key_text()),
            kind: MemberNameType::Expression,
        },
        Some(
            KeyKind::String(name)
            | KeyKind::Number(name)
            | KeyKind::ComputedString(name)
            | KeyKind::ComputedNumber(name),
        ) => literal_member_name(Cow::Borrowed(name.bytes())),
        Some(KeyKind::Computed(e)) => match (e.kind(), get_static_string_value(e)) {
            (ExprKind::Ident(name), _) => normal(name.bytes()),
            (ExprKind::Template(_), _) | (_, None) => MemberName {
                name: Cow::Borrowed(e.text()),
                kind: MemberNameType::Expression,
            },
            (_, Some(value)) => literal_member_name(value),
        },
    }
}

/// `requiresQuoting` of `@typescript-eslint/type-utils`: whether `name` is not an identifier name.
/// As upstream, which looks at UTF-16 code units, a character outside the BMP requires quoting.
pub fn requires_quoting(name: &[u8]) -> bool {
    let mut points = code_points(name).map(|it| it.1);
    !points.next().is_some_and(|c| c <= 0xFFFF && is_identifier_start(c))
        || !points.all(|c| c <= 0xFFFF && is_identifier_part(c))
}

/// typescript-eslint's `formatWordList`: `a`, `a and b`, `a, b and c`.
pub fn format_word_list(words: &[impl AsRef<[u8]>]) -> Vec<u8> {
    let mut out = Vec::new();
    for (i, word) in words.iter().enumerate() {
        match i {
            0 => {}
            _ if i + 1 == words.len() => out.extend_from_slice(b" and "),
            _ => out.extend_from_slice(b", "),
        }
        out.extend_from_slice(word.as_ref());
    }
    out
}

/// typescript-eslint's `typeNodeRequiresParentheses`: whether `node`, whose text is `text`, needs
/// parentheses as a constituent of a union or an intersection.
pub fn type_node_requires_parentheses(node: TypeNode<'_>, text: &[u8]) -> bool {
    match node.kind() {
        TypeKind::Fn(_) | TypeKind::Cond { .. } => true,
        TypeKind::Union(_) => text.starts_with(b"|"),
        TypeKind::Intersection(_) => text.starts_with(b"&"),
        _ => false,
    }
}

/// typescript-eslint's `isRestParameterDeclaration`, for a declaration in the file: `...name`.
pub fn is_rest_parameter_declaration(declaration: Declaration<'_>) -> bool {
    matches!(
        declaration,
        Declaration::Param(pat) if matches!(pat.parent(), Node::Param(param) if param.is_rest())
    )
}

/// typescript-eslint's `isParenlessArrowFunction`: `a => b`. As upstream, so is `(a,) => b`: the
/// test is that the one parameter is not directly between a `(` and a `)`.
pub fn is_parenless_arrow_function(func: Func<'_>) -> bool {
    let (params, text) = (func.params(), func.file().text());
    let Some(param) = params.first().filter(|_| params.len() == 1) else {
        return false;
    };
    let span = estree_span(Node::Param(param));
    let before = skip_trivia_back(text, span.start).checked_sub(1);
    let is_parenthesized = before.and_then(|at| text.get(at as usize)) == Some(&b'(')
        && text.get(skip_trivia(text, span.end) as usize) == Some(&b')');
    !is_parenthesized
}
