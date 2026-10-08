//! What the rows of the schema have in common.

use super::Dialect;
use super::value::Nodes;
use super::vnode::{Part, VNode};
use crate::ast::{
    Call, Case, Class, Expr, ExprKind, ExprTag, File, Flags, FnKind, Func, Jsx, Key, KeyKind, List, Member,
    MemberKind, Modifier, Module, Node, Param, Prop, Stmt, StmtKind, StmtTag, TupleElem, TypeKind,
    TypeNode, TypeParam, TypeTag, VarDecl,
};
use crate::rule::NodeTags;

// ───────────────────────────── the handle that a node is made of ─────────────────────────────

macro_rules! handles {
    ($($name:ident $variant:ident $handle:ident,)*) => {$(
        #[inline]
        pub(super) fn $name<'a>(v: VNode<'a>) -> Option<$handle<'a>> {
            match v.base {
                Node::$variant(it) => Some(it),
                _ => None,
            }
        }
    )*};
}

handles! {
    case Case Case,
    var_decl VarDecl VarDecl,
    class Class Class,
    member Member Member,
    param Param Param,
    prop Prop Prop,
    type_param TypeParam TypeParam,
    tuple_elem TupleElem TupleElem,
}

pub(super) fn call<'a>(v: VNode<'a>) -> Option<Call<'a>> {
    match v.expr()?.kind() {
        ExprKind::Call(call) | ExprKind::New(call) | ExprKind::TaggedTemplate(call) => Some(call),
        _ => None,
    }
}

pub(super) fn jsx<'a>(v: VNode<'a>) -> Option<Jsx<'a>> {
    match v.expr()?.kind() {
        ExprKind::Jsx(jsx) => Some(jsx),
        _ => None,
    }
}

/// The function of a function, a method signature or a function type.
pub(super) fn func_of<'a>(v: VNode<'a>) -> Option<Func<'a>> {
    match v.base {
        Node::Func(func) => Some(func),
        Node::Member(member) => member.func(),
        Node::Type(ty) => match ty.kind() {
            TypeKind::Fn(func) => Some(func),
            _ => None,
        },
        _ => None,
    }
}

// ───────────────────────────── the kinds that a type of node is made of ─────────────────────────────

/// What has a name that is not an expression.
pub(super) fn keys() -> NodeTags {
    NodeTags::MEMBER | NodeTags::PROP | NodeTags::PAT_PROP | NodeTags::ENUM_MEMBER
}

/// What an `Identifier` can be made of.
pub(super) fn names() -> NodeTags {
    keys()
        | NodeTags::FUNC
        | NodeTags::CLASS
        | NodeTags::PAT
        | NodeTags::TYPE_PARAM
        | NodeTags::IMPORT_SPEC
        | NodeTags::EXPORT_SPEC
        | NodeTags::TUPLE_ELEM
        | [ExprTag::Ident, ExprTag::Dot, ExprTag::ImportMeta, ExprTag::NewTarget, ExprTag::AsConst].into()
        | [
            StmtTag::Labeled,
            StmtTag::Break,
            StmtTag::Continue,
            StmtTag::Interface,
            StmtTag::TypeAlias,
            StmtTag::Enum,
            StmtTag::Module,
            StmtTag::Import,
            StmtTag::ImportEquals,
            StmtTag::ExportNamed,
            StmtTag::ExportStar,
            StmtTag::ExportAsNamespace,
        ]
        .into()
        | [TypeTag::Ref, TypeTag::Import, TypeTag::Predicate].into()
}

/// What a `Literal` can be made of.
pub(super) fn literals() -> NodeTags {
    keys()
        | NodeTags::IMPORT_SPEC
        | NodeTags::EXPORT_SPEC
        | [
            ExprTag::Null,
            ExprTag::True,
            ExprTag::False,
            ExprTag::Number,
            ExprTag::String,
            ExprTag::BigInt,
            ExprTag::Regex,
        ]
        .into()
        | [
            StmtTag::Module,
            StmtTag::Import,
            StmtTag::ImportEquals,
            StmtTag::ExportNamed,
            StmtTag::ExportStar,
        ]
        .into()
        | [
            TypeTag::StringLit,
            TypeTag::NumberLit,
            TypeTag::BigIntLit,
            TypeTag::BoolLit,
            TypeTag::Import,
        ]
        .into()
}

/// The declarations that `export` can precede.
pub(super) fn exportable() -> NodeTags {
    [
        StmtTag::Fn,
        StmtTag::Var,
        StmtTag::Class,
        StmtTag::TypeAlias,
        StmtTag::Interface,
        StmtTag::Enum,
        StmtTag::Module,
        StmtTag::ImportEquals,
    ]
    .into()
}

pub(super) fn all_types() -> NodeTags {
    TypeTag::ALL.into()
}

/// What can be in the braces of JSX.
pub(super) fn all_exprs() -> NodeTags {
    use ExprTag::*;
    [
        Missing, Ident, PrivateIdentifier, This, Super, Null, True, False, Number, String, BigInt, Regex,
        Template, TaggedTemplate, Array, Object, Fn, Class, Dot, Index, Call, New, Unary, Binary, Assign, Cond,
        Spread, Await, Yield, As, Satisfies, AsConst, NonNull, Instantiation, Jsx, ImportCall, ImportMeta,
        NewTarget,
    ]
    .into()
}

// ───────────────────────────── statements ─────────────────────────────

/// `Program.sourceType`
pub(super) fn source_type(file: &File) -> &'static str {
    use crate::language::SourceType;
    match (Dialect::of(file), file.language().source_type) {
        (Dialect::Espree, SourceType::Module) => "module",
        (Dialect::Espree, SourceType::Script) => "script",
        (Dialect::Espree, SourceType::CommonJs) => "commonjs",
        (Dialect::TypeScript, _) if file.is_module_program() => "module",
        (Dialect::TypeScript, _) => "script",
    }
}

/// It has the modifier `declare`.
pub(super) fn is_declared(statement: Stmt) -> bool {
    statement.flags().contains(Flags::AMBIENT)
}

/// The first token of `v`.
pub(super) fn first_token<'a>(v: VNode<'a>) -> &'a [u8] {
    let written = v.file().slice(v.span());
    written.get(..crate::tokens::token_len(written)).unwrap_or_default()
}

/// ESTree's `directive`. typescript-estree also has directives at the start of a static block.
pub(super) fn directive<'a>(statement: Stmt<'a>) -> Option<&'a [u8]> {
    if let Some(directive) = statement.directive() {
        return Some(directive);
    }
    let Node::Func(block) = statement.parent() else {
        return None;
    };
    if block.kind() != FnKind::StaticBlock || Dialect::of(statement.file()) != Dialect::TypeScript {
        return None;
    }
    let text = |it: Stmt<'a>| match it.kind() {
        StmtKind::Expr(e) if e.as_string().is_some() && !e.is_parenthesized() => Some(e.span().shrink(1, 1)),
        _ => None,
    };
    let own = text(statement)?;
    let before = block.body_statements()?.iter().take_while(|it| *it != statement);
    before.map(text).all(|it| it.is_some()).then(|| statement.file().slice(own))
}

/// The module specifier in `v`, if it is a string.
pub(super) fn source<'a>(v: VNode<'a>) -> Option<VNode<'a>> {
    let source = v.with(Part::Source);
    source.leaf().map(|_| source)
}

/// The field `attributes` of an import or an export.
pub(super) fn attributes<'a>(v: VNode<'a>) -> Option<Nodes<'a>> {
    Some(match v.stmt()?.import_attributes() {
        Some(attributes) => Nodes::attributes(v.base, attributes.entries()),
        None => Nodes::EMPTY,
    })
}

/// The number of names in `namespace A.B.C`.
pub(super) fn module_depth(module: Module) -> usize {
    std::iter::successors(Some(module), |it| it.nested()).count()
}

// ───────────────────────────── functions ─────────────────────────────

pub(super) fn function_id<'a>(v: VNode<'a>) -> Option<VNode<'a>> {
    v.func()?.name().map(|_| v.with(Part::Name))
}

pub(super) fn type_parameters<'a>(v: VNode<'a>) -> Option<VNode<'a>> {
    let func = func_of(v)?;
    func.type_params().first().map(|_| VNode::new(func, Part::TypeParams))
}

pub(super) fn params<'a>(v: VNode<'a>) -> Option<Nodes<'a>> {
    let func = func_of(v)?;
    Some(Nodes::params(func.this_param(), func.params()))
}

pub(super) fn return_type<'a>(v: VNode<'a>) -> Option<VNode<'a>> {
    func_of(v)?.return_type().map(VNode::annotation)
}

// ───────────────────────────── modifiers ─────────────────────────────

/// The keywords among `modifiers`.
pub(super) fn keywords<'a>(modifiers: List<'a, Modifier<'a>>) -> Flags {
    modifiers.iter().fold(Flags::empty(), |all, it| all | it.flag())
}

pub(super) fn accessibility(keywords: Flags) -> Option<&'static str> {
    if keywords.contains(Flags::PUBLIC) {
        Some("public")
    } else if keywords.contains(Flags::PROTECTED) {
        Some("protected")
    } else if keywords.contains(Flags::PRIVATE) {
        Some("private")
    } else {
        None
    }
}

// ───────────────────────────── members ─────────────────────────────

pub(super) fn member_keywords(v: VNode) -> Option<Flags> {
    Some(keywords(member(v)?.modifiers()))
}

pub(super) fn member_decorators<'a>(v: VNode<'a>) -> Option<Nodes<'a>> {
    let member = member(v)?;
    Some(match member.kind() {
        MemberKind::Constructor => Nodes::EMPTY,
        _ => Nodes::decorators(member, member.modifiers()),
    })
}

pub(super) fn member_key<'a>(v: VNode<'a>) -> Option<Option<VNode<'a>>> {
    let member = member(v)?;
    Some(match member.key() {
        Some(key) => VNode::of_key(member, key),
        None => member.constructor_keyword().map(|_| v.with(Part::Key)),
    })
}

pub(super) fn is_computed(key: Option<Key>) -> bool {
    key.is_some_and(Key::is_computed)
}

pub(super) fn method_kind(member: Member) -> &'static str {
    let is_quoted_constructor =
        |key: Key| matches!(key.kind(), KeyKind::String(name) if name.is("constructor"));
    match member.kind() {
        MemberKind::Getter => "get",
        MemberKind::Setter => "set",
        MemberKind::Constructor if member.is_constructor() => "constructor",
        // `"constructor"<T>() {}`
        MemberKind::Method if !member.is_static() && member.key().is_some_and(is_quoted_constructor) => {
            "constructor"
        }
        _ => "method",
    }
}

// ───────────────────────────── patterns ─────────────────────────────

/// What typescript-estree adds to the node of a pattern from what is around it.
pub(super) struct Binding<'a> {
    pub(super) decorators: Nodes<'a>,
    pub(super) is_optional: bool,
    pub(super) ty: Option<TypeNode<'a>>,
}

pub(super) fn binding<'a>(v: VNode<'a>) -> Binding<'a> {
    let mut binding = Binding {
        decorators: Nodes::EMPTY,
        is_optional: false,
        ty: None,
    };
    // The decorators are on the outermost node of a parameter, `?` and the type on the pattern, or
    // on the `RestElement`.
    let (param, is_outermost, is_annotated) = match (v.base, v.part) {
        (Node::Param(param), Part::Inner) => (param, !VNode::has_keywords(param), param.is_rest()),
        (Node::Pat(pat), _) => match pat.parent() {
            Node::Param(param) if !param.is_rest() => {
                (param, !VNode::has_keywords(param) && param.default().is_none(), true)
            }
            Node::VarDecl(declaration) => {
                binding.ty = declaration.ty();
                return binding;
            }
            _ => return binding,
        },
        _ => return binding,
    };
    if is_outermost {
        binding.decorators = Nodes::decorators(param, param.modifiers());
    }
    if is_annotated {
        binding.is_optional = param.is_optional();
        binding.ty = param.ty();
    }
    binding
}

// ───────────────────────────── expressions ─────────────────────────────

/// The `e` of `e as T`, `<T>e`, `e satisfies T`.
pub(super) fn asserted<'a>(v: VNode<'a>) -> Option<Expr<'a>> {
    match v.expr()?.kind() {
        ExprKind::As { expr, .. } | ExprKind::Satisfies { expr, .. } | ExprKind::AsConst(expr) => Some(expr),
        _ => None,
    }
}

/// The `T`.
pub(super) fn assertion_type<'a>(v: VNode<'a>) -> Option<VNode<'a>> {
    match v.expr()?.kind() {
        ExprKind::As { ty, .. } | ExprKind::Satisfies { ty, .. } => Some(VNode::of_type(ty)),
        ExprKind::AsConst(_) => Some(v.with(Part::ConstType)),
        _ => None,
    }
}

/// The type arguments in `v`, whatever its part.
pub(super) fn type_argument_list<'a>(v: VNode<'a>) -> Option<List<'a, TypeNode<'a>>> {
    Some(match v.base {
        Node::Class(class) => class.extends_args(),
        Node::Expr(e) => match e.kind() {
            ExprKind::Call(call) | ExprKind::New(call) | ExprKind::TaggedTemplate(call) => call.type_args(),
            ExprKind::Instantiation { type_args, .. } => type_args,
            ExprKind::Jsx(jsx) => jsx.type_args(),
            _ => return None,
        },
        Node::Type(ty) => match ty.kind() {
            TypeKind::Ref { args, .. }
            | TypeKind::Heritage { args, .. }
            | TypeKind::Typeof { args, .. }
            | TypeKind::Import { args, .. } => args,
            _ => return None,
        },
        _ => return None,
    })
}

/// The field `typeArguments`.
pub(super) fn type_arguments<'a>(v: VNode<'a>) -> Option<VNode<'a>> {
    type_argument_list(v)?.first().map(|_| v.with(Part::TypeArgs))
}

/// The `A.B` of `implements A.B<T>`.
pub(super) fn heritage_expression<'a>(v: VNode<'a>) -> Option<Option<VNode<'a>>> {
    Some(match v.ty()?.kind() {
        TypeKind::Ref { name, .. } => VNode::of_entity_name(v.base, name.len(), true),
        TypeKind::Heritage { expr, .. } => VNode::of_expr(expr),
        _ => return None,
    })
}

/// A `TemplateElement`.
pub(super) struct Quasi<'a> {
    pub(super) is_tail: bool,
    pub(super) cooked: Option<&'a [u8]>,
    pub(super) raw: &'a [u8],
}

pub(super) fn quasi<'a>(v: VNode<'a>) -> Option<Quasi<'a>> {
    let whole = |cooked: Option<&'a [u8]>| Quasi {
        is_tail: true,
        cooked,
        raw: v.file().slice(v.span().shrink(1, 1)),
    };
    let key = |key: Option<Key<'a>>| key?.name().map(|it| it.bytes());
    Some(match (v.base, v.part) {
        (Node::Expr(e), Part::Quasi(i)) => {
            let ExprKind::Template(template) = e.kind() else {
                return None;
            };
            let i = i as usize;
            let cooked = match Dialect::of(e.file()) {
                // It only looks for `\u` and `\x`, also after a `\`.
                Dialect::TypeScript => {
                    let is_tagged = matches!(e.parent(), Node::Expr(it) if it.tag() == ExprTag::TaggedTemplate);
                    template.text_of_scanner(i).filter(|_| !is_tagged || has_valid_escapes(template.raw(i)))
                }
                Dialect::Espree => template.cooked(i),
            };
            // In the raw text of ECMAScript every line break is a line feed.
            let raw = match (Dialect::of(e.file()), template.raw(i)) {
                (Dialect::Espree, raw) if bun_core::strings::contains_char(raw, b'\r') => {
                    let mut text = Vec::with_capacity(raw.len());
                    for (at, &byte) in raw.iter().enumerate() {
                        match byte {
                            b'\r' if raw.get(at + 1) == Some(&b'\n') => {}
                            b'\r' => text.push(b'\n'),
                            _ => text.push(byte),
                        }
                    }
                    e.file().intern(&text).bytes()
                }
                (_, raw) => raw,
            };
            Quasi {
                is_tail: i + 1 == template.quasi_count(),
                cooked: cooked.map(|it| it.bytes()),
                raw,
            }
        }
        (Node::Type(ty), Part::Quasi(i)) => match (ty.as_template(), ty.kind()) {
            (Some(template), _) => Quasi {
                is_tail: i as usize + 1 == template.quasi_count(),
                cooked: template.cooked(i as usize).map(|it| it.bytes()),
                raw: template.raw(i as usize),
            },
            (None, TypeKind::StringLit(value)) => whole(Some(value.bytes())),
            _ => return None,
        },
        (Node::Member(member), Part::KeyQuasi) => whole(key(member.key())),
        (Node::Prop(prop), Part::KeyQuasi) => whole(key(prop.key())),
        (Node::PatProp(prop), Part::KeyQuasi) => whole(key(prop.key())),
        (Node::EnumMember(member), Part::KeyQuasi) => whole(key(member.key())),
        _ => return None,
    })
}

/// ESTree's `value` of a `JSXText`. What `&amp;` and the like stand for is not in the source text: it
/// is interned.
pub(super) fn jsx_text_value<'a>(e: Expr<'a>) -> Option<&'a [u8]> {
    Some(match e.jsx_text_value()? {
        std::borrow::Cow::Borrowed(text) => text,
        std::borrow::Cow::Owned(text) => e.file().intern(&text).bytes(),
    })
}

/// `#isValidEscape` of typescript-estree
fn has_valid_escapes(raw: &[u8]) -> bool {
    let is_hex = |bytes: Option<&[u8]>| bytes.is_some_and(|it| it.iter().all(u8::is_ascii_hexdigit));
    let mut rest = raw;
    while let Some(at) = bun_core::strings::index_of_char_usize(rest, b'\\') {
        let is_valid = match rest.get(at + 1) {
            Some(b'u') => rest.get(at + 2) == Some(&b'{') || is_hex(rest.get(at + 2..at + 6)),
            Some(b'x') => is_hex(rest.get(at + 2..at + 4)),
            _ => true,
        };
        if !is_valid {
            return false;
        }
        rest = &rest[at + 1..];
    }
    true
}
