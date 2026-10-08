//! What only Flow has. Prettier's `print/flow.js`, and what the printers that it shares with
//! TypeScript do for the nodes of Flow.
//!
//! The tree has the nodes of TypeScript (`flow.rs` of `bun_sema_parser` has the table), so most of a
//! file of Flow is written by the functions for those. They call these where `File::is_flow`.

use super::class::FormatClassImplements;
use super::function::FormatFunctionBody;
use super::function_type::{write_ts_call_signature_declaration, write_ts_method_signature};
use super::import_declaration::FormatStringLiteral;
use super::object_like::ObjectLike;
use super::parameters::FormatFormalParameters;
use super::semicolon::OptionalSemicolon;
use super::ts_types::{write_ts_interface_signatures, write_ts_signatures};
use super::type_parameters::{type_arguments, type_parameters};
use crate::js::format::{FormatTypeAnnotation, identifier};
use crate::js::utils::object::format_computed_or_property_key;
use crate::js::utils::typescript::is_simple_type;
use crate::prelude::*;
use crate::{format_args, write};
use bun_lint::tokens::skip_trivia;
use smallvec::SmallVec;

// ───────────────────────────── modifiers ─────────────────────────────

/// `static`, `proto`, `readonly`, `+`: as they are written, in the order of the source.
struct FormatModifiers<'a>(List<'a, Modifier<'a>>);

impl<'a> Format<'a> for FormatModifiers<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        for modifier in self.0.iter() {
            let span = modifier.token_span();
            write!(f, [source_text(span), (span.len() > 1).then_some(space())]);
        }
    }
}

/// The `+` or `-` of a property of a class.
pub(crate) fn write_variance_sign<'a>(modifiers: List<'a, Modifier<'a>>, f: &mut Formatter<'a>) {
    for modifier in modifiers
        .iter()
        .filter(|it| it.flag().intersects(Flags::IN | Flags::OUT))
    {
        write!(f, source_text(modifier.token_span()));
    }
}

/// Whether the word `word`, which TypeScript has no flag for, is among `modifiers`.
fn has_word<'a>(modifiers: List<'a, Modifier<'a>>, word: &[u8], f: &Formatter<'a>) -> bool {
    modifiers.iter().any(|it| {
        it.decorator().is_none() && it.flag().is_empty() && f.file().slice(it.token_span()) == word
    })
}

fn is_declared<'a>(modifiers: List<'a, Modifier<'a>>) -> bool {
    modifiers.iter().any(|it| it.flag() == Flags::AMBIENT)
}

/// `declare export`: the `declare` has no flag, so that what is exported is written without it.
pub(crate) fn is_declare_export<'a>(statement: Stmt<'a>, f: &Formatter<'a>) -> bool {
    has_word(statement.modifiers(), b"declare", f)
}

// ───────────────────────────── expressions ─────────────────────────────

/// `(e: T)`
pub(crate) fn write_type_cast_expression<'a>(e: Expr<'a>, f: &mut Formatter<'a>) {
    if let ExprKind::As { expr, ty } = e.kind() {
        write!(f, ["(", expr, FormatTypeAnnotation(ty), ")"]);
    }
}

// ───────────────────────────── parentheses ─────────────────────────────

/// `interface { }` as a type, which is an intersection in the tree.
pub(crate) fn is_interface_type(ty: TypeNode<'_>) -> bool {
    ty.tag() == TypeTag::Intersection && ty.first_token() == b"interface"
}

/// `hook` or `component`, if the function type `ty` starts with the word.
fn keyword_of_function_type<'a>(ty: TypeNode<'a>, func: Func<'a>) -> Option<&'static str> {
    // In `hook => void` it is the type of the parameter.
    if func.open_paren() == Some(ty.span().start) {
        return None;
    }
    match ty.first_token() {
        b"hook" => Some("hook"),
        b"component" => Some("component"),
        _ => None,
    }
}

/// Whether `ty` is an `OptionalIndexedAccessType`: `A?.[B]`, or the `A?.[B][C]` around it.
fn is_optional_indexed_access(mut ty: TypeNode<'_>) -> bool {
    while let TypeKind::IndexedAccess { obj, .. } = ty.kind() {
        if ty.has_flow_optional_token(obj) {
            return true;
        }
        if obj.is_parenthesized() {
            return false;
        }
        ty = obj;
    }
    false
}

/// A parameter of a function type, of a signature or of a function that is declared: Flow's
/// `FunctionTypeParam`, as opposed to a pattern with a type annotation.
fn is_function_type_param(param: Param<'_>) -> bool {
    param
        .func()
        .is_some_and(|func| !func.has_body() && !func.is_arrow())
}

/// Prettier's `needsParentheses` for the types of Flow.
pub(crate) fn needs_parentheses(ty: TypeNode<'_>) -> bool {
    let parent = match ty.parent() {
        Node::Type(parent) => Some(parent),
        _ => None,
    };
    let parent_tag = parent.map(TypeNode::tag);
    let is_object_type = parent
        .is_some_and(|it| matches!(it.kind(), TypeKind::IndexedAccess { obj, .. } if obj == ty));
    match ty.tag() {
        TypeTag::Unique => {
            is_object_type
                || matches!(
                    parent_tag,
                    Some(TypeTag::Array | TypeTag::JSDoc | TypeTag::Unique)
                )
        }
        TypeTag::Typeof | TypeTag::Keyof => is_object_type || parent_tag == Some(TypeTag::Array),
        TypeTag::Array => parent_tag == Some(TypeTag::JSDoc),
        TypeTag::Intersection if is_interface_type(ty) => false,
        TypeTag::Union | TypeTag::Intersection => {
            is_object_type
                || matches!(
                    parent_tag,
                    Some(
                        TypeTag::Unique
                            | TypeTag::Keyof
                            | TypeTag::Array
                            | TypeTag::JSDoc
                            | TypeTag::Intersection
                            | TypeTag::Union
                    )
                )
        }
        TypeTag::Infer | TypeTag::JSDoc => is_object_type || parent_tag == Some(TypeTag::Array),
        TypeTag::Cond => match ty.parent() {
            Node::Type(parent) => match parent.kind() {
                TypeKind::Cond { check, extends, .. } => check == ty || extends == ty,
                TypeKind::Union(_) | TypeKind::Intersection(_) => true,
                _ => false,
            },
            Node::TypeParam(param) => param.constraint() == Some(ty) && !param.has_flow_colon(),
            _ => false,
        },
        TypeTag::Fn => match ty.kind() {
            TypeKind::Fn(func) => function_type_needs_parentheses(ty, func),
            _ => false,
        },
        // `(A?.[B])[C]`
        TypeTag::IndexedAccess => {
            is_object_type
                && ty.is_parenthesized()
                && is_optional_indexed_access(ty)
                && !parent.is_some_and(|it| it.has_flow_optional_token(ty))
        }
        _ => false,
    }
}

fn function_type_needs_parentheses<'a>(ty: TypeNode<'a>, func: Func<'a>) -> bool {
    match keyword_of_function_type(ty, func) {
        Some("hook") => return false,
        Some(_) if func.return_type().is_none() => return false,
        _ => {}
    }
    let is_return_type_of_arrow = |it: TypeNode<'a>| matches!(it.parent(), Node::Func(owner) if owner.is_arrow() && owner.return_type() == Some(it));
    if is_return_type_of_arrow(ty) {
        return true;
    }
    let parent = ty.parent();
    let mut ancestor = parent;
    if let Node::Type(parent) = parent {
        // The inner `=>` would be taken for that of the arrow function.
        if matches!(parent.tag(), TypeTag::JSDoc | TypeTag::Predicate)
            && is_return_type_of_arrow(parent)
        {
            return true;
        }
        match parent.kind() {
            TypeKind::IndexedAccess { obj, .. } if obj == ty => return true,
            TypeKind::Cond { check, .. } if check == ty => return true,
            TypeKind::Cond { extends, .. } if extends == ty => {
                return matches!(
                    func.return_type().map(TypeNode::kind),
                    Some(TypeKind::Infer(param)) if param.constraint().is_some()
                );
            }
            _ => {}
        }
        if parent.tag() == TypeTag::JSDoc {
            ancestor = parent.parent();
        }
    }
    match (ancestor, parent) {
        (Node::Type(ancestor), _) if !is_interface_type(ancestor) => {
            matches!(
                ancestor.tag(),
                TypeTag::Union | TypeTag::Intersection | TypeTag::Array | TypeTag::JSDoc
            )
        }
        (_, Node::Param(param)) => {
            param.pat().tag() == PatTag::Missing
                && is_function_type_param(param)
                && func
                    .params_with_this()
                    .any(|it| it.ty().is_some_and(|it| it.tag() == TypeTag::JSDoc))
        }
        _ => false,
    }
}

/// Writes `content`, which is `ty` without parentheses, in those that it needs.
fn write_in_parentheses<'a>(ty: TypeNode<'a>, content: &impl Format<'a>, f: &mut Formatter<'a>) {
    match needs_parentheses(ty) {
        true => write!(f, ["(", content, ")"]),
        false => write!(f, content),
    }
}

// ───────────────────────────── types ─────────────────────────────

/// `?T`, `renders T`. Returns whether `ty` is one of them.
pub(crate) fn write_nullable_type_or_type_operator<'a>(
    ty: TypeNode<'a>,
    f: &mut Formatter<'a>,
) -> bool {
    if let Some(operand) = ty.flow_nullable_operand() {
        write_in_parentheses(ty, &format_args!("?", operand), f);
        return true;
    }
    let Some(operand) = ty.flow_type_operator_operand() else {
        return false;
    };
    // `renders T`, `renders? T`, `renders* T`
    let operator = match ty.text().get(b"renders".len()) {
        Some(b'?') => "renders?",
        Some(b'*') => "renders*",
        _ => "renders",
    };
    write_in_parentheses(ty, &format_args!(operator, space(), operand), f);
    true
}

/// `T[]`
pub(crate) fn write_array_type<'a>(ty: TypeNode<'a>, element: TypeNode<'a>, f: &mut Formatter<'a>) {
    write_in_parentheses(ty, &format_args!(element, "[]"), f);
}

/// `T[K]`, `T?.[K]`
pub(crate) fn write_indexed_access_type<'a>(
    ty: TypeNode<'a>,
    obj: TypeNode<'a>,
    index: TypeNode<'a>,
    f: &mut Formatter<'a>,
) {
    let optional = ty.has_flow_optional_token(obj).then_some("?.");
    write_in_parentheses(ty, &format_args!(obj, optional, "[", index, "]"), f);
}

/// `: T %checks` as a return type. Returns whether the predicate `ty` is that.
pub(crate) fn write_checks_predicate<'a>(ty: TypeNode<'a>, f: &mut Formatter<'a>) -> bool {
    match ty.kind() {
        TypeKind::Predicate { param, ty, .. } if param.is("%checks") => {
            write!(f, [ty, ty.map(|_| space()), "%checks"]);
            true
        }
        _ => false,
    }
}

/// `implies`, if the predicate `ty` starts with it, in place of `asserts`.
pub(crate) fn predicate_prefix(ty: TypeNode<'_>) -> &'static str {
    match ty.first_token() {
        b"implies" => "implies ",
        _ => "asserts ",
    }
}

/// `: T %checks(e)` as a return type. Returns whether the type query `ty` is that.
pub(crate) fn write_declared_predicate<'a>(
    ty: TypeNode<'a>,
    expr: Expr<'a>,
    args: List<'a, TypeNode<'a>>,
    f: &mut Formatter<'a>,
) -> bool {
    if ty.first_token() == b"typeof" {
        return false;
    }
    write!(
        f,
        [
            args.first(),
            args.first().map(|_| space()),
            "%checks(",
            expr,
            ")"
        ]
    );
    true
}

/// `interface { }`, `interface extends A, B { }`. `parts`: `A`, `B` and the object type.
pub(crate) fn write_interface_type<'a>(parts: List<'a, TypeNode<'a>>, f: &mut Formatter<'a>) {
    let count = parts.len().saturating_sub(1);
    let extends = format_with(|f| {
        f.join_with(soft_line_break_or_space())
            .entries_with_trailing_separator(
                parts.iter().take(count),
                ",",
                TrailingSeparator::Disallowed,
            );
    });
    write!(f, "interface");
    match count {
        0 => {}
        1 => write!(f, [" extends ", extends]),
        _ => write!(
            f,
            group(&indent(&format_args!(
                soft_line_break_or_space(),
                "extends",
                group(&indent(&format_args!(soft_line_break_or_space(), extends)))
            )))
        ),
    }
    write!(f, [space(), parts.last()]);
}

/// `hook (A) => B` starts with the word. `component(a: A) renders B` is written here: returns
/// whether `ty` is one.
pub(crate) fn write_function_type_keyword<'a>(
    ty: TypeNode<'a>,
    func: Func<'a>,
    f: &mut Formatter<'a>,
) -> bool {
    match keyword_of_function_type(ty, func) {
        Some("hook") => {
            write!(f, "hook ");
            false
        }
        Some(_) => {
            write!(
                f,
                [
                    "component",
                    type_parameters(func.type_params(), Node::Func(func))
                ]
            );
            write_component_parameters_and_renders(func, f);
            true
        }
        None => false,
    }
}

fn write_component_parameters_and_renders<'a>(func: Func<'a>, f: &mut Formatter<'a>) {
    let renders = func.return_type();
    write!(
        f,
        group(&format_args!(
            FormatFormalParameters(func),
            renders.map(|_| space()),
            renders
        ))
    );
}

// ───────────────────────────── parameters ─────────────────────────────

fn is_component<'a>(func: Func<'a>, f: &Formatter<'a>) -> bool {
    match func.owner() {
        Node::Stmt(statement) => has_word(statement.modifiers(), b"component", f),
        Node::Type(ty) => keyword_of_function_type(ty, func) == Some("component"),
        _ => false,
    }
}

/// Writes a parameter without a name, which is a type, and returns true. Of any other parameter it
/// writes what only Flow has before it: the `a as` of a component.
pub(crate) fn write_parameter_start<'a>(param: Param<'a>, f: &mut Formatter<'a>) -> bool {
    let is_unnamed = param.pat().tag() == PatTag::Missing;
    let outer_name = match param.modifiers().is_empty() {
        true => param
            .flow_outer_name()
            .filter(|_| param.func().is_some_and(|func| is_component(func, f))),
        false => None,
    };
    if let Some(span) = outer_name {
        match f.source_text().text_for(&span).first() {
            Some(b'"' | b'\'') => write!(
                f,
                FormatStringLiteral {
                    span,
                    parent: param.as_ast_nodes()
                }
            ),
            _ => write!(f, source_text(span)),
        }
        match is_unnamed {
            true => write!(f, [param.is_optional().then_some("?"), ": "]),
            false => write!(f, " as "),
        }
    }
    if is_unnamed {
        write!(f, [param.is_rest().then_some("..."), param.ty()]);
    }
    is_unnamed
}

/// Prettier's `isFlowShorthandWithOneArg`: `A => B`, where it is written without a place to break
/// at, and with parentheses only if arrow functions have them.
pub(crate) fn is_shorthand_function_type(func: Func<'_>) -> bool {
    let (Node::Type(ty), Some(only)) = (func.owner(), func.params().first()) else {
        return false;
    };
    if func.params().len() != 1
        || func.this_param().is_some()
        || !func.type_params().is_empty()
        || only.is_rest()
        || only.pat().tag() != PatTag::Missing
        || only.flow_outer_name().is_some()
        || !only.ty().is_some_and(is_simple_type)
    {
        return false;
    }
    match ty.parent() {
        Node::Member(member) => !member.is_static(),
        Node::Param(param) => !is_function_type_param(param),
        Node::VarDecl(_) | Node::Func(_) => true,
        Node::Stmt(statement) => {
            statement.tag() == StmtTag::TypeAlias && !is_declared(statement.modifiers())
        }
        Node::Type(parent) => matches!(parent.tag(), TypeTag::Union | TypeTag::Intersection),
        Node::Expr(e) => e.is_flow_type_cast(),
        _ => false,
    }
}

/// The parameter of a function type for which [`is_shorthand_function_type`] holds.
pub(crate) fn write_shorthand_parameter<'a>(func: Func<'a>, f: &mut Formatter<'a>) {
    let is_hook =
        matches!(func.owner(), Node::Type(ty) if keyword_of_function_type(ty, func).is_some());
    let has_parentheses = is_hook || !f.options().arrow_parentheses.is_as_needed();
    write!(
        f,
        [
            has_parentheses.then_some("("),
            func.params().first(),
            has_parentheses.then_some(")")
        ]
    );
}

/// The modifiers of a type parameter: `const`, `+`, `in`.
pub(crate) fn write_type_parameter_modifiers<'a>(param: TypeParam<'a>, f: &mut Formatter<'a>) {
    write!(f, FormatModifiers(param.modifiers()));
}

/// `: Bound`, ` extends Bound`
pub(crate) fn write_type_parameter_bound<'a>(
    param: TypeParam<'a>,
    bound: TypeNode<'a>,
    f: &mut Formatter<'a>,
) {
    match param.has_flow_colon() {
        true => write!(f, [": ", bound]),
        false => write!(f, [" extends ", bound]),
    }
}

/// `+a?: T`, `...a: T`, `...T`, `...`
pub(crate) fn write_tuple_element<'a>(element: TupleElem<'a>, f: &mut Formatter<'a>) {
    let (variance, label) = element.flow_variance_and_label();
    write!(f, element.is_rest().then_some("..."));
    if let Some(span) = variance {
        write!(f, [source_text(span), (span.len() > 1).then_some(space())]);
    }
    if let Some(label) = label {
        let label = identifier(label, AstNodes::TSNamedTupleMember(element));
        write!(f, [label, element.is_optional().then_some("?"), ": "]);
    }
    write!(f, element.flow_type());
}

/// The `...` that ends an inexact tuple type, after which there is no comma.
pub(crate) fn is_inexact_tuple<'a>(elements: List<'a, TupleElem<'a>>) -> bool {
    elements.last().is_some_and(|it| it.flow_type().is_none())
}

// ───────────────────────────── object types ─────────────────────────────

/// The `...` that ends an inexact object type, after which there is no comma.
pub(crate) fn is_inexact_mark(member: Member<'_>) -> bool {
    member.is_flow_spread() && member.ty().is_none()
}

/// `{ a: A }`, `{| a: A |}`, `{ a: A, ... }`. Prettier's `printClassBody` for an object type that is
/// not the body of an interface or a class.
pub(crate) fn write_object_type<'a>(
    ty: TypeNode<'a>,
    members: List<'a, Member<'a>>,
    f: &mut Formatter<'a>,
) {
    let (open, close) = match ty.is_flow_exact_object() {
        true => ("{|", "|}"),
        false => ("{", "}"),
    };
    write!(f, open);
    match members.first() {
        None => write!(
            f,
            format_dangling_comments(ty.span()).with_soft_block_indent()
        ),
        Some(first) => {
            let should_expand = f.options().expand == Expand::Auto
                && !is_inexact_mark(first)
                && f.source_text()
                    .contains_newline_between(ty.span().start, first.span().start);
            let content = format_with(|f| write_ts_signatures(members, f));
            let inner =
                soft_block_indent_with_maybe_space(&content, f.options().bracket_spacing.value());
            match ObjectLike::TSTypeLiteral(ty, members).should_hug(f) {
                true => write!(f, inner),
                false => write!(f, group(&inner).should_expand(should_expand)),
            }
        }
    }
    write!(f, close);
}

/// A member of an object type, of an interface or of a class that is declared, without the
/// separator after it.
pub(crate) fn write_object_type_member<'a>(member: Member<'a>, f: &mut Formatter<'a>) {
    if member.is_flow_spread() {
        return write!(f, ["...", member.ty()]);
    }
    let node = member.as_ast_nodes();
    write!(f, FormatModifiers(member.modifiers()));
    let optional = member.flags().contains(Flags::OPTIONAL).then_some("?");
    match (member.kind(), member.func()) {
        (MemberKind::IndexSignature, Some(signature)) => {
            write!(
                f,
                [
                    "[",
                    signature.params().first(),
                    "]: ",
                    signature.return_type()
                ]
            );
        }
        (MemberKind::CallSignature, Some(func)) => write_ts_call_signature_declaration(func, f),
        (_, Some(func)) => match member.flow_internal_slot() {
            Some(slot) => {
                write!(f, ["[[", identifier(slot, node), "]]"]);
                write_ts_call_signature_declaration(func, f);
            }
            None => write_ts_method_signature(member, func, f),
        },
        (_, None) => {
            if let Some(TypeKind::Mapped(mapped)) = member.ty().map(|it| it.kind()) {
                return write_mapped_type_property(mapped, f);
            }
            match (member.flow_internal_slot(), member.key()) {
                (Some(slot), _) => write!(f, ["[[", identifier(slot, node), "]]"]),
                (None, Some(key)) => format_computed_or_property_key(key, node, f),
                (None, None) => {}
            }
            write!(f, [optional, ": ", member.ty()]);
        }
    }
}

/// `[K in T]?: V`. Prettier's `printFlowMappedTypeProperty`.
fn write_mapped_type_property<'a>(mapped: Mapped<'a>, f: &mut Formatter<'a>) {
    let param = mapped.param();
    let key = format_args!(source_text(param.name().span()), " in ", param.constraint());
    let optional = match mapped.optional() {
        MappedModifier::None => "",
        MappedModifier::Add if mapped.is_optional_with_plus() => "+?",
        MappedModifier::Add => "?",
        MappedModifier::Remove => "-?",
    };
    write!(
        f,
        group(&format_args!(
            group(&format_args!("[", soft_block_indent(&key), "]")),
            optional,
            ": ",
            mapped.ty()
        ))
    );
}

// ───────────────────────────── declarations ─────────────────────────────

/// Whether the interface `statement` stands for `opaque type A = B`.
pub(crate) fn is_opaque_type<'a>(statement: Stmt<'a>, f: &Formatter<'a>) -> bool {
    has_word(statement.modifiers(), b"opaque", f)
}

/// `opaque type A<T>: B = C`, `opaque type A super B extends C = D`
pub(crate) fn write_opaque_type<'a>(
    statement: Stmt<'a>,
    interface: Interface<'a>,
    f: &mut Formatter<'a>,
) {
    let node = AstNodes::TSInterfaceDeclaration(statement);
    write!(
        f,
        [
            is_declared(statement.modifiers()).then_some("declare "),
            "opaque type ",
            identifier(interface.name(), node),
            type_parameters(interface.type_params(), Node::Stmt(statement))
        ]
    );
    let (bounds, file) = (interface.extends(), f.file());
    // What is before a bound: `:`, `super` or `extends`.
    let follows = |bound: TypeNode<'a>, word: &[u8]| {
        let end = file.end_of_token_before(bound.outer_span().start) as usize;
        file.text().get(..end).is_some_and(|it| it.ends_with(word))
    };
    match bounds.first() {
        Some(supertype) if follows(supertype, b":") => write!(f, [": ", supertype]),
        Some(_) => {
            let keywords: SmallVec<[&'static str; 2]> = bounds
                .iter()
                .map(|it| {
                    if follows(it, b"super") {
                        "super "
                    } else {
                        "extends "
                    }
                })
                .collect();
            let content = format_with(|f| {
                for (bound, keyword) in bounds.iter().zip(keywords.iter().copied()) {
                    write!(
                        f,
                        indent(&format_args!(soft_line_break_or_space(), keyword, bound))
                    );
                }
            });
            write!(f, group(&content));
        }
        None => {}
    }
    if let Some(ty) = interface.flow_opaque_type() {
        write!(f, [" = ", ty]);
    }
    write!(f, OptionalSemicolon);
}

/// `declare module.exports: T`, and the `T` of `declare export default T`. Returns whether the type
/// alias stands for one of them.
pub(crate) fn write_what_is_no_type_alias<'a>(
    statement: Stmt<'a>,
    alias: Alias<'a>,
    f: &mut Formatter<'a>,
) -> bool {
    if alias.name().name().is("module.exports") {
        write!(
            f,
            [
                "declare module.exports",
                FormatTypeAnnotation(alias.ty()),
                OptionalSemicolon
            ]
        );
        return true;
    }
    if statement.is_default_export() {
        write!(f, [alias.ty(), OptionalSemicolon]);
        return true;
    }
    false
}

/// Whether `class` is `declare class`, whose members are those of an object type.
#[inline]
pub(crate) fn is_declared_class(class: Class<'_>) -> bool {
    class.file().is_flow() && class.flags().contains(Flags::AMBIENT)
}

/// `declare class A<T> extends B<T> mixins C implements D { }`. Prettier's `printClass`.
pub(crate) fn write_declared_class<'a>(class: Class<'a>, f: &mut Formatter<'a>) {
    let node = AstNodes::Class(class);
    let (mixins, implements) = (class.flow_mixins(), class.implements());
    let count = usize::from(class.extends().is_some()) + mixins.len() + implements.len();
    let has_multiple_heritage = count > 1;
    // The first is `A.B` without type arguments.
    let is_qualified = |ty: TypeNode<'a>| matches!(ty.kind(), TypeKind::Ref { name, args } if name.len() > 1 && args.is_empty());
    let group_mode = has_multiple_heritage
        || match (class.extends(), mixins.first()) {
            (Some(extends), _) => extends.tag() == ExprTag::Dot && class.extends_args().is_empty(),
            (None, Some(first)) => is_qualified(first),
            (None, None) => false,
        };

    let format_extends = format_with(|f| {
        let mut names: SmallVec<[Ident<'a>; 4]> = SmallVec::new();
        let mut leftmost = class.extends();
        while let Some(ExprKind::Dot { obj, name, .. }) = leftmost.map(|it| it.kind()) {
            names.push(name);
            leftmost = Some(obj);
        }
        write!(f, leftmost);
        for &name in names.iter().rev() {
            write!(f, [".", identifier(name, node)]);
        }
        write!(f, type_arguments(class.extends_args(), Node::Class(class)));
    });
    let (format_mixins, format_implements) = (
        FormatClassImplements(mixins),
        FormatClassImplements(implements),
    );
    let clauses = format_with(|f| {
        let clauses: [(&'static str, bool, &dyn Format<'a>); 3] = [
            ("extends", class.extends().is_some(), &format_extends),
            ("mixins", !mixins.is_empty(), &format_mixins),
            ("implements", !implements.is_empty(), &format_implements),
        ];
        for (keyword, _, list) in clauses.into_iter().filter(|it| it.1) {
            match (has_multiple_heritage, group_mode) {
                (true, _) => write!(
                    f,
                    [
                        soft_line_break_or_space(),
                        keyword,
                        group(&soft_line_indent_or_space(list))
                    ]
                ),
                (false, true) => write!(
                    f,
                    [
                        soft_line_break_or_space(),
                        group(&format_args!(keyword, space(), list))
                    ]
                ),
                (false, false) => write!(f, [space(), keyword, space(), list]),
            }
        }
    });
    let head = format_args!(
        space(),
        class.name().map(|name| identifier(name, node)),
        type_parameters(class.type_params(), Node::Class(class))
    );

    write!(
        f,
        [
            is_declared(class.modifiers()).then_some("declare "),
            "class"
        ]
    );
    if group_mode {
        let heritage_id = f.group_id("heritageGroup");
        write!(
            f,
            group(&format_args!(head, indent(&clauses))).with_group_id(Some(heritage_id))
        );
        match class.members().is_empty() {
            true => write!(f, space()),
            false => write!(
                f,
                [
                    if_group_breaks(&hard_line_break()).with_group_id(Some(heritage_id)),
                    if_group_fits_on_line(&space()).with_group_id(Some(heritage_id))
                ]
            ),
        }
    } else {
        write!(f, [head, clauses, space()]);
    }
    // `Class::body_span` knows nothing of `mixins`.
    let body_span = match (mixins.last(), implements.is_empty()) {
        (Some(last), true) => Span::new(
            skip_trivia(f.file().text(), last.span().end),
            class.span().end,
        ),
        _ => class.body_span(),
    };
    match class.members().is_empty() {
        true => write!(
            f,
            [
                "{",
                format_dangling_comments(body_span).with_block_indent(),
                "}"
            ]
        ),
        false => {
            write!(
                f,
                [
                    "{",
                    block_indent(&format_with(|f| write_ts_interface_signatures(
                        class.members(),
                        f
                    ))),
                    "}"
                ]
            );
        }
    }
}

/// `hook` or `function`: what the declaration of `func` starts with. A component is written here:
/// then it is `None`.
pub(crate) fn write_component_or_keyword<'a>(
    func: Func<'a>,
    f: &mut Formatter<'a>,
) -> Option<&'static str> {
    let Node::Stmt(statement) = func.owner() else {
        return Some("function");
    };
    let modifiers = statement.modifiers();
    if has_word(modifiers, b"hook", f) {
        return Some("hook");
    }
    if !has_word(modifiers, b"component", f) {
        return Some("function");
    }
    write!(
        f,
        [
            is_declared(modifiers).then_some("declare "),
            func.is_async().then_some("async "),
            "component ",
            func.name()
                .map(|name| identifier(name, AstNodes::Function(func))),
            type_parameters(func.type_params(), Node::Func(func))
        ]
    );
    write_component_parameters_and_renders(func, f);
    match func.has_body() {
        true => write!(f, FormatFunctionBody(func)),
        false => write!(f, OptionalSemicolon),
    }
    None
}

/// `of string `, after the name of an enum.
pub(crate) fn write_explicit_type_of_enum<'a>(declaration: Enum<'a>, f: &mut Formatter<'a>) {
    if let Some(span) = declaration.flow_explicit_type() {
        write!(f, ["of ", source_text(span), space()]);
    }
}

/// The `...` that ends an enum with unknown members, after which there is no comma.
pub(crate) fn is_unknown_members_mark(member: EnumMember<'_>) -> bool {
    member.text() == b"..."
}

/// `typeof ` or `type `: how the import, or the specifier, that starts at `start` after its `import`
/// is written.
pub(crate) fn import_kind(start: u32, f: &Formatter<'_>) -> &'static str {
    match f
        .file()
        .text()
        .get(start as usize..)
        .is_some_and(|it| it.starts_with(b"typeof"))
    {
        true => "typeof ",
        false => "type ",
    }
}
