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
use crate::js::format::{
    ExprOptions, FormatTypeAnnotation, format_node, identifier, write_expression,
};
use crate::js::utils::object::{format_computed_or_property_key, key_requires_quotes};
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
    has_word_in(f.file(), modifiers, word)
}

fn has_word_in<'a>(file: &'a File<'a>, modifiers: List<'a, Modifier<'a>>, word: &[u8]) -> bool {
    modifiers.iter().any(|it| {
        it.decorator().is_none() && it.flag().is_empty() && file.slice(it.token_span()) == word
    })
}

fn is_declared<'a>(modifiers: List<'a, Modifier<'a>>) -> bool {
    modifiers.iter().any(|it| it.flag() == Flags::AMBIENT)
}

/// `declare export`: the `declare` has no flag, so that what is exported is written without it.
pub(crate) fn is_declare_export<'a>(statement: Stmt<'a>, f: &Formatter<'a>) -> bool {
    has_word(statement.modifiers(), b"declare", f)
}

/// The same, for a statement of any file.
pub(crate) fn is_flow_declare_export(statement: Stmt<'_>) -> bool {
    statement.file().is_flow() && has_word_in(statement.file(), statement.modifiers(), b"declare")
}

/// What Prettier's `isJsSourceElement` leaves out: the type parameters of Flow, and what is in
/// `declare export`.
pub(crate) fn is_no_source_element(node: AstNodes<'_>) -> bool {
    match node {
        AstNodes::TSTypeParameterDeclaration(owner) => owner.file().is_flow(),
        AstNodes::ExportNamedDeclaration(_)
        | AstNodes::ExportDefaultDeclaration(_)
        | AstNodes::Program(_) => false,
        _ => matches!(
            node.parent(),
            AstNodes::ExportNamedDeclaration(statement) | AstNodes::ExportDefaultDeclaration(statement)
                if is_flow_declare_export(statement)
        ),
    }
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

/// Prettier's `includesFunctionTypeInObjectType`. `is_in_object_type`: `node` is.
fn includes_function_type_in_object_type(node: Node<'_>, is_in_object_type: bool) -> bool {
    let (is_function_type, is_object_type, operand) = match node {
        Node::Type(ty) => (
            ty.tag() == TypeTag::Fn,
            ty.tag() == TypeTag::Object,
            ty.flow_nullable_operand(),
        ),
        Node::Func(_) => (true, false, None),
        _ => (false, false, None),
    };
    if is_function_type && is_in_object_type {
        return true;
    }
    let is_in_object_type = is_in_object_type || is_object_type;
    if let Some(operand) = operand {
        return includes_function_type_in_object_type(Node::Type(operand), is_in_object_type);
    }
    let mut is_found = false;
    node.for_each_child(|child| {
        is_found = is_found || includes_function_type_in_object_type(child, is_in_object_type)
    });
    is_found
}

/// Prettier's `needsParentheses` for the types of Flow.
pub(crate) fn needs_parentheses(ty: TypeNode<'_>) -> bool {
    let parent = match ty.parent() {
        Node::Type(parent) => Some(parent),
        // The `=>` of a function type in an object type would be taken for that of the arrow function.
        Node::Func(owner)
            if owner.is_arrow()
                && owner.return_type() == Some(ty)
                && !ty.flow_nullable_operand().is_some_and(needs_parentheses)
                && includes_function_type_in_object_type(Node::Type(ty), false) =>
        {
            return true;
        }
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
            Node::TypeParam(param) => {
                param.constraint() == Some(ty) && param.flow_token_after_name() == b"extends"
            }
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

/// `: T %checks(e)` as a return type. Returns whether the type query `ty` is that. Of a function
/// that is only declared, the `T` is written: the rest is not part of the signature.
pub(crate) fn write_declared_predicate<'a>(
    ty: TypeNode<'a>,
    expr: Expr<'a>,
    args: List<'a, TypeNode<'a>>,
    f: &mut Formatter<'a>,
) -> bool {
    if ty.first_token() == b"typeof" {
        return false;
    }
    write!(f, args.first());
    let is_of_declared_function = matches!(
        ty.parent(),
        Node::Func(func) if !func.has_body() && matches!(func.owner(), Node::Stmt(_))
    );
    if !is_of_declared_function {
        write!(f, [args.first().map(|_| space()), "%checks(", expr, ")"]);
    }
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
            // Those between the word and the `(` lead the type.
            if !f.is_quiet()
                && let Some(open) = func.open_paren()
            {
                let comments = f.comments().comments_before(open);
                write!(f, FormatLeadingComments::Comments(comments));
            }
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

pub(crate) fn is_component<'a>(func: Func<'a>, f: &Formatter<'a>) -> bool {
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
        return true;
    }
    // `...a?: T`
    if param.is_rest() && param.is_optional() {
        let ty = param.ty().map(FormatTypeAnnotation);
        write!(f, ["...", param.pat(), "?", ty]);
        return true;
    }
    false
}

/// Prettier has no node between the last parameter of a function type and the type behind the `=>`:
/// a comment before the `=>` trails the parameter. Where the `=>` is, if `func` is such a type.
pub(crate) fn arrow_behind_parameters(func: Func<'_>) -> Option<u32> {
    let is_function_type = func.file().is_flow()
        && func.kind() == FnKind::FunctionType
        && !func.params().is_empty()
        && matches!(func.owner(), Node::Type(ty) if keyword_of_function_type(ty, func) != Some("component"));
    match is_function_type {
        true => Some(func.return_type()?.annotation_span().start),
        false => None,
    }
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
    let is_function_type = keyword_of_function_type(ty, func).is_none();
    match ty.parent() {
        Node::Member(member) => is_function_type && !member.is_static(),
        Node::Param(param) => is_function_type && !is_function_type_param(param),
        Node::VarDecl(_) => is_function_type,
        Node::Func(owner) => is_function_type || matches!(owner.owner(), Node::Type(_)),
        Node::Stmt(statement) => {
            statement.tag() == StmtTag::TypeAlias && !is_declared(statement.modifiers())
        }
        Node::Type(parent) => matches!(parent.tag(), TypeTag::Union | TypeTag::Intersection),
        Node::Expr(e) => is_function_type && e.is_flow_type_cast(),
        _ => false,
    }
}

/// Prettier's `shouldIndentUnionType`, what it says about the parameters of function types: whether
/// the union `ty` is written without an indentation of its own.
pub(crate) fn is_union_indented_by_parameters(ty: TypeNode<'_>) -> bool {
    let Node::Param(param) = ty.parent() else {
        return false;
    };
    let Some(func) = param.func().filter(|_| is_function_type_param(param)) else {
        return false;
    };
    if func.this_param() == Some(param) {
        return false;
    }
    if param.pat().tag() == PatTag::Missing {
        return true;
    }
    // The function type is the type of a property.
    !param.is_rest()
        && matches!(func.owner(), Node::Type(owner) if keyword_of_function_type(owner, func).is_none()
            && matches!(owner.parent(), Node::Member(member) if !member.is_static()))
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
    match param.flow_token_after_name() {
        b":" => write!(f, FormatTypeAnnotation(bound)),
        _ => write!(f, [" extends ", bound]),
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

/// `[...]`: the comments in it dangle, and are written behind the dots. Returns whether `ty` is that.
pub(crate) fn write_tuple_of_unknown_elements<'a>(
    ty: TypeNode<'a>,
    elements: List<'a, TupleElem<'a>>,
    f: &mut Formatter<'a>,
) -> bool {
    if elements.len() != 1 || !is_inexact_tuple(elements) {
        return false;
    }
    let comments = f.comments().comments_before(ty.span().end);
    let has_line_comment = comments.iter().any(|it| it.is_line());
    let content = format_args!("...", format_dangling_comments(ty.span()));
    write!(
        f,
        group(&format_args!("[", soft_block_indent(&content), "]")).should_expand(has_line_comment)
    );
    true
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
    let needs_parentheses = needs_parentheses(ty);
    write!(f, [needs_parentheses.then_some("("), open]);
    match members.first() {
        None => write!(
            f,
            format_dangling_comments(ty.span()).with_soft_block_indent()
        ),
        // Prettier has no node for the `...`: the comments dangle.
        Some(first)
            if is_inexact_mark(first) && f.comments().has_comment_before(first.span().start) =>
        {
            let comments = f.comments().comments_before(first.span().start);
            let has_line_comment = comments.iter().any(|it| it.is_line());
            let ends_line = comments.last().is_some_and(|it| it.followed_by_newline());
            let content = format_with(|f| {
                write!(
                    f,
                    FormatDanglingComments::Comments {
                        comments,
                        indent: DanglingIndentMode::None
                    }
                );
                match has_line_comment || ends_line {
                    true => write!(f, hard_line_break()),
                    false => write!(f, soft_line_break_or_space()),
                }
                write!(f, "...");
            });
            let inner =
                soft_block_indent_with_maybe_space(&content, f.options().bracket_spacing.value());
            write!(f, group(&inner).should_expand(has_line_comment));
        }
        Some(first) => {
            let should_expand = f.options().expand == Expand::Auto
                && !is_inexact_mark(first)
                && f.source_text()
                    .contains_newline(Span::new(ty.span().start, first.span().start));
            let content = format_with(|f| write_ts_signatures(members, f));
            let inner =
                soft_block_indent_with_maybe_space(&content, f.options().bracket_spacing.value());
            match ObjectLike::TSTypeLiteral(ty, members).should_hug(f) {
                true => write!(f, inner),
                false => write!(f, group(&inner).should_expand(should_expand)),
            }
        }
    }
    write!(f, [close, needs_parentheses.then_some(")")]);
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
        (_, Some(func)) => match (
            member.flow_internal_slot(),
            member.key().map(|it| it.kind()),
        ) {
            (Some(slot), _) => {
                write!(f, ["[[", identifier(slot, node), "]]"]);
                write_ts_call_signature_declaration(func, f);
            }
            (None, Some(KeyKind::Ident(name))) if name.bytes().starts_with(b"@@") => {
                write!(f, text(name.bytes()));
                write_ts_call_signature_declaration(func, f);
            }
            _ => write_ts_method_signature(member, func, f),
        },
        (_, None) => {
            if let Some(TypeKind::Mapped(mapped)) = member.ty().map(|it| it.kind()) {
                return write_mapped_type_property(mapped, f);
            }
            match (member.flow_internal_slot(), member.key()) {
                (Some(slot), _) => write!(f, ["[[", identifier(slot, node), "]]"]),
                (None, Some(key)) => match key.kind() {
                    KeyKind::Ident(name) if name.bytes().starts_with(b"@@") => {
                        write!(f, text(name.bytes()));
                    }
                    _ => format_computed_or_property_key(key, node, f),
                },
                (None, None) => {}
            }
            write!(f, [optional, ": ", member.ty()]);
        }
    }
}

/// `[K in T]?: V`. Prettier's `printFlowMappedTypeProperty`.
fn write_mapped_type_property<'a>(mapped: Mapped<'a>, f: &mut Formatter<'a>) {
    let param = mapped.param();
    let name = identifier(param.name(), AstNodes::TSTypeParameter(param));
    let key = format_args!(name, " in ", param.constraint());
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
    class.flags().contains(Flags::AMBIENT) && class.file().is_flow()
}

/// Writes `declare class` and `record`. Returns whether `class` is one of them.
pub(crate) fn write_class<'a>(class: Class<'a>, f: &mut Formatter<'a>) -> bool {
    let is_record = is_record(class, f);
    if is_record || is_declared_class(class) {
        write_declared_class_or_record(class, is_record, f);
        return true;
    }
    false
}

/// `declare class A<T> extends B<T> mixins C implements D { }`, `record A<T> implements B { }`.
/// Prettier's `printClass`.
fn write_declared_class_or_record<'a>(class: Class<'a>, is_record: bool, f: &mut Formatter<'a>) {
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
    // Where what is after `extends`, `mixins` and `implements` starts.
    let starts = [
        class.extends().map(|it| it.span().start),
        mixins.first().map(|it| it.span().start),
        implements.first().map(|it| it.span().start),
    ];
    // A comment trails the name or the type parameters.
    let group_mode = group_mode
        || (!f.is_quiet()
            && starts
                .iter()
                .flatten()
                .next()
                .is_some_and(|&start| f.comments().has_comment_before(start)));

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
        let clauses: [(&'static str, &dyn Format<'a>); 3] = [
            ("extends", &format_extends),
            ("mixins", &format_mixins),
            ("implements", &format_implements),
        ];
        for ((keyword, list), start) in clauses.into_iter().zip(starts) {
            let Some(start) = start else {
                continue;
            };
            // The comments before a keyword trail what is before it.
            if !f.is_quiet() {
                let comments = f.comments().comments_before(start);
                write!(f, FormatTrailingComments::Comments(comments));
            }
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

    let keyword = if is_record { "record" } else { "class" };
    write!(
        f,
        [
            is_declared(class.modifiers()).then_some("declare "),
            keyword
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
        false if is_record => write_record_body(class, f),
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
    // Prettier's `shouldOmitSemicolon` does not know records.
    if is_record && matches!(class.owner(), Node::Stmt(statement) if statement.is_default_export())
    {
        write!(f, OptionalSemicolon);
    }
}

/// `hook` or `function`: what the declaration of `func` starts with. A component, and a function
/// that is only declared, which is written like a function type, are written here: then it is
/// `None`.
pub(crate) fn write_component_or_keyword<'a>(
    func: Func<'a>,
    f: &mut Formatter<'a>,
) -> Option<&'static str> {
    let Node::Stmt(statement) = func.owner() else {
        return Some("function");
    };
    let modifiers = statement.modifiers();
    if !has_word(modifiers, b"component", f) {
        let keyword = if has_word(modifiers, b"hook", f) {
            "hook"
        } else {
            "function"
        };
        if func.has_body() {
            return Some(keyword);
        }
        let name = func
            .name()
            .map(|name| identifier(name, AstNodes::Function(func)));
        write!(
            f,
            [
                is_declared(modifiers).then_some("declare "),
                keyword,
                space(),
                name
            ]
        );
        write_ts_call_signature_declaration(func, f);
        if let Some(ty) = func.return_type()
            && let TypeKind::Typeof { expr, .. } = ty.kind()
            && ty.first_token() != b"typeof"
        {
            write!(f, [" %checks(", expr, ")"]);
        }
        // Those before the `;` trail the return type.
        if !f.is_quiet()
            && let Some(semicolon) = statement.semicolon()
        {
            let comments = f.comments().comments_before(semicolon.start);
            write!(f, FormatTrailingComments::Comments(comments));
        }
        write!(f, OptionalSemicolon);
        return None;
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

// ───────────────────────────── match ─────────────────────────────

/// `match (a) { }` and `R { a: 1 }` are `new` expressions in the tree, which do not start with
/// `new`. Returns whether `e` is one of them, which is written.
pub(crate) fn write_expression_with_braces<'a>(
    e: Expr<'a>,
    call: Call<'a>,
    f: &mut Formatter<'a>,
) -> bool {
    let (head, Some(braces)) = (call.callee(), call.args().first()) else {
        return false;
    };
    if head.span().start != e.span().start {
        return false;
    }
    match (head.as_call(), braces.kind()) {
        (Some(head), ExprKind::Object(cases)) => {
            let format_cases = format_with(|f| {
                let mut join = f.join_nodes_with_hardline();
                for case in cases.iter() {
                    let content = format_with(|f| {
                        format_node(
                            case.span(),
                            || AstNodes::ObjectExpression(braces),
                            f,
                            |f| {
                                write_match_expression_case(case, f);
                            },
                        );
                    });
                    join.entry(case.span(), &content);
                }
            });
            write_match(
                head,
                braces.span().start,
                cases.is_empty(),
                &format_cases,
                f,
            );
        }
        _ => {
            let type_args = call.type_args();
            let empty_list =
                (type_args.is_empty() && head.is_before_flow_type_arguments()).then_some("<>");
            write!(
                f,
                [
                    head,
                    empty_list,
                    type_arguments(type_args, Node::Expr(e)),
                    space(),
                    braces
                ]
            );
        }
    }
    true
}

/// A match statement is a `switch` statement in the tree, which does not start with `switch`.
/// Returns whether `statement` is one, which is written.
pub(crate) fn write_match_statement<'a>(
    statement: Stmt<'a>,
    head: Expr<'a>,
    cases: List<'a, Case<'a>>,
    f: &mut Formatter<'a>,
) -> bool {
    let head_end = head.span().end;
    let Some(head) = head
        .as_call()
        .filter(|_| head.span().start == statement.span().start)
    else {
        return false;
    };
    let format_cases = format_with(|f| {
        let mut join = f.join_nodes_with_hardline();
        for case in cases.iter() {
            let content = format_with(|f| {
                format_node(
                    case.span(),
                    || AstNodes::SwitchStatement(statement),
                    f,
                    |f| {
                        write_match_pattern_and_guard(case.test(), f);
                        let body = case.body().first();
                        let is_empty = body.is_some_and(|it| {
                            matches!(it.kind(), StmtKind::Block(statements) if statements.is_empty())
                                && !f.comments().has_comment_in_span(it.span())
                        });
                        match is_empty {
                            true => write!(f, " => {}"),
                            false => write!(f, [" => ", body]),
                        }
                    },
                );
            });
            join.entry(case.span(), &content);
        }
    });
    let open_brace = skip_trivia(f.file().text(), head_end);
    write_match(head, open_brace, cases.is_empty(), &format_cases, f);
    true
}

/// Prettier's `printMatch`. `head`: the `match (a)`. `open_brace`: where the `{` is.
fn write_match<'a>(
    head: Call<'a>,
    open_brace: u32,
    is_empty: bool,
    cases: &impl Format<'a>,
    f: &mut Formatter<'a>,
) {
    let argument = format_with(|f| {
        write!(f, head.args().first());
        // What is behind the `{` on its line trails the argument.
        if !f.is_quiet() {
            let comments = f.comments().end_of_line_comments_after(open_brace + 1);
            write!(f, FormatTrailingComments::Comments(comments));
        }
    });
    write!(
        f,
        [
            group(&format_args!("match (", soft_block_indent(&argument), ")")),
            " {"
        ]
    );
    match is_empty {
        true => write!(f, hard_line_break()),
        false => write!(f, block_indent(cases)),
    }
    write!(f, "}");
}

/// `pattern`, `pattern if (guard)`, which is a `&&` in the tree.
fn write_match_pattern_and_guard<'a>(pattern: Option<Expr<'a>>, f: &mut Formatter<'a>) {
    let Some(pattern) = pattern else {
        return;
    };
    match pattern.kind() {
        ExprKind::Binary {
            op: BinOp::And,
            left,
            right,
        } => {
            write_match_pattern(left, PatternParent::Case, f);
            // It is in no `&&`.
            let guard = format_with(|f| {
                format_node(
                    right.span(),
                    || right.ast_parent(),
                    f,
                    |f| write_expression(right, ExprOptions::None, f),
                );
            });
            write!(
                f,
                group(&indent(&format_args!(
                    soft_line_break_or_space(),
                    "if (", guard, ")"
                )))
            );
        }
        _ => write_match_pattern(pattern, PatternParent::Case, f),
    }
}

/// Prettier's `printMatchCase` for a case of a match expression, which is a property with a
/// computed name in the tree.
fn write_match_expression_case<'a>(case: Prop<'a>, f: &mut Formatter<'a>) {
    let pattern = case.key().and_then(|key| match key.kind() {
        KeyKind::Computed(pattern) => Some(pattern),
        _ => None,
    });
    write_match_pattern_and_guard(pattern, f);
    let body = case.value();
    // Prettier's `needsParentheses`.
    let is_arrow =
        body.is_some_and(|it| matches!(it.kind(), ExprKind::Fn(func) if func.is_arrow()));
    let body = format_args!(is_arrow.then_some("("), body, is_arrow.then_some(")"), ",");
    write!(
        f,
        group(&format_args!(
            " =>",
            indent(&format_args!(soft_line_break_or_space(), body))
        ))
    );
}

/// What a pattern is directly in.
#[derive(Copy, Clone, PartialEq, Eq)]
enum PatternParent {
    Case,
    /// With that many elements, the rest not counted.
    Array(usize),
    Property,
    /// It is the left side.
    As,
    Other,
}

/// `a | b | c`, from left to right.
fn alternatives(pattern: Expr<'_>) -> SmallVec<[Expr<'_>; 4]> {
    let mut all = SmallVec::new();
    let mut rest = pattern;
    while let ExprKind::Binary {
        op: BinOp::BitOr,
        left,
        right,
    } = rest.kind()
    {
        all.push(right);
        rest = left;
    }
    all.push(rest);
    all.reverse();
    all
}

/// Prettier's `printMatchPattern`. A pattern is an expression in the tree.
fn write_match_pattern<'a>(pattern: Expr<'a>, parent: PatternParent, f: &mut Formatter<'a>) {
    if !f.context_mut().has_stack_left() {
        return;
    }
    let is_leaf = !matches!(
        (pattern.tag(), pattern.unary_operator()),
        (
            ExprTag::Binary | ExprTag::Object | ExprTag::Array | ExprTag::New | ExprTag::Spread,
            _
        ) | (ExprTag::Unary, Some(UnOp::Void))
    );
    if is_leaf {
        return write!(f, pattern);
    }
    format_node(
        pattern.span(),
        || pattern.ast_parent(),
        f,
        |f| write_match_pattern_that_has_parts(pattern, parent, f),
    );
}

fn write_match_pattern_that_has_parts<'a>(
    pattern: Expr<'a>,
    parent: PatternParent,
    f: &mut Formatter<'a>,
) {
    match pattern.kind() {
        ExprKind::Binary {
            op: BinOp::BitOr, ..
        } => write_match_or_pattern(pattern, parent, f),
        ExprKind::Binary { left, right, .. } => {
            write_match_pattern(left, PatternParent::As, f);
            write!(f, " as ");
            write_match_pattern(right, PatternParent::Other, f);
        }
        // `const a`
        ExprKind::Unary { operand, .. } => {
            let keyword = match pattern.text().first() {
                Some(b'c') => "const ",
                Some(b'l') => "let ",
                _ => "var ",
            };
            write!(f, [keyword, operand]);
        }
        ExprKind::Spread(argument) => {
            write!(f, "...");
            write_match_pattern(argument, PatternParent::Other, f);
        }
        ExprKind::New(call) => {
            let properties = format_with(|f| {
                if let Some(properties) = call.args().first() {
                    write_match_pattern(properties, PatternParent::Other, f);
                }
            });
            write!(f, group(&format_args!(call.callee(), space(), properties)));
        }
        ExprKind::Array(elements) => {
            let has_rest = elements
                .last()
                .is_some_and(|it| it.tag() == ExprTag::Spread);
            let count = elements.len() - usize::from(has_rest);
            let content = format_with(|f| {
                for (index, element) in elements.iter().enumerate() {
                    if index > 0 {
                        write!(f, [",", soft_line_break_or_space()]);
                    }
                    write_match_pattern(element, PatternParent::Array(count), f);
                }
                if !has_rest {
                    write!(f, if_group_breaks(&","));
                }
            });
            write!(
                f,
                group(&format_args!("[", soft_block_indent(&content), "]"))
            );
        }
        ExprKind::Object(properties) => {
            let has_rest = properties
                .last()
                .is_some_and(|it| it.kind() == PropKind::Spread);
            let content = format_with(|f| {
                for (index, property) in properties.iter().enumerate() {
                    if index > 0 {
                        write!(f, [",", soft_line_break_or_space()]);
                    }
                    format_node(
                        property.span(),
                        || AstNodes::ObjectExpression(pattern),
                        f,
                        |f| {
                            write_match_object_pattern_property(property, f);
                        },
                    );
                }
                if !has_rest {
                    write!(f, if_group_breaks(&","));
                }
            });
            write!(
                f,
                group(&format_args!("{", soft_block_indent(&content), "}"))
            );
        }
        _ => {}
    }
}

/// `a: pattern`, `const a`, `...const a`, `...`
fn write_match_object_pattern_property<'a>(property: Prop<'a>, f: &mut Formatter<'a>) {
    let Some(value) = property.value() else {
        return;
    };
    let key = match property.kind() {
        PropKind::Spread => {
            write!(f, "...");
            None
        }
        _ => property.key(),
    };
    let Some(key) = key else {
        return write_match_pattern(value, PatternParent::Other, f);
    };
    let span = key.span(f.file());
    let format_key = format_with(|f| match key.kind() {
        KeyKind::String(_) => write!(
            f,
            FormatStringLiteral {
                span,
                parent: AstNodes::ObjectProperty(property)
            }
        ),
        _ => write!(f, source_text(span)),
    });
    let format_value = format_with(|f| write_match_pattern(value, PatternParent::Property, f));
    write!(
        f,
        group(&format_args!(
            format_key,
            ":",
            indent(&format_args!(soft_line_break_or_space(), format_value))
        ))
    );
}

/// Prettier's `isSimpleMatchPattern`.
fn is_simple_match_pattern(pattern: Expr<'_>) -> bool {
    match pattern.tag() {
        ExprTag::Ident
        | ExprTag::Null
        | ExprTag::True
        | ExprTag::False
        | ExprTag::Number
        | ExprTag::BigInt
        | ExprTag::String => true,
        ExprTag::Unary => pattern.unary_operator() != Some(UnOp::Void),
        _ => false,
    }
}

/// Prettier's `printMatchOrPattern`.
fn write_match_or_pattern<'a>(pattern: Expr<'a>, parent: PatternParent, f: &mut Formatter<'a>) {
    let patterns = alternatives(pattern);
    // Prettier's `shouldHugMatchOrPattern`: one object pattern among simple ones.
    let should_hug = patterns
        .iter()
        .filter(|it| it.tag() == ExprTag::Object)
        .count()
        == 1
        && patterns
            .iter()
            .all(|&it| it.tag() == ExprTag::Object || is_simple_match_pattern(it))
        && !f.comments().has_comment_in_span(pattern.span());
    if should_hug {
        for (index, &it) in patterns.iter().enumerate() {
            if index > 0 {
                write!(f, " | ");
            }
            write_match_pattern(it, PatternParent::Other, f);
        }
        return;
    }
    let should_indent = !matches!(
        parent,
        PatternParent::Case | PatternParent::Array(_) | PatternParent::Property
    ) && !f
        .comments()
        .has_leading_own_line_comment(pattern.span().start);
    let code = format_with(|f| {
        write!(f, if_group_breaks(&"| "));
        for (index, &it) in patterns.iter().enumerate() {
            if index > 0 {
                write!(f, [soft_line_break_or_space(), "| "]);
            }
            write!(
                f,
                align(
                    2,
                    &format_with(|f| write_match_pattern(it, PatternParent::Other, f))
                )
            );
        }
    });
    match parent {
        PatternParent::As => {
            let line = soft_line_break();
            let content = format_args!(if_group_breaks(&line), code);
            write!(
                f,
                [
                    "(",
                    group(&format_args!(indent(&content), soft_line_break())),
                    ")"
                ]
            );
        }
        PatternParent::Array(count) if count > 1 => write!(
            f,
            group(&format_args!(
                indent(&format_args!(
                    if_group_breaks(&format_args!("(", soft_line_break())),
                    code
                )),
                soft_line_break(),
                if_group_breaks(&")")
            ))
        ),
        _ if should_indent => write!(f, group(&indent(&code))),
        _ => write!(f, group(&code)),
    }
}

// ───────────────────────────── records ─────────────────────────────

/// Whether `class` is `record A { }`.
fn is_record<'a>(class: Class<'a>, f: &Formatter<'a>) -> bool {
    has_word(class.modifiers(), b"record", f)
}

/// The `{ }` of a record that has members. Prettier's `printClassBody`.
fn write_record_body<'a>(class: Class<'a>, f: &mut Formatter<'a>) {
    let members = class.members();
    let is_consistent = f.options().quote_properties.is_consistent();
    if is_consistent {
        let quote_needed = members.iter().any(|member| {
            member
                .key()
                .is_some_and(|key| key_requires_quotes(key, member.as_ast_nodes(), f))
        });
        f.context_mut().push_quote_needed(quote_needed);
    }
    let content = format_with(|f| {
        let mut join = f.join_nodes_with_hardline();
        for member in members.iter() {
            match member.kind() {
                MemberKind::Property => join.entry(
                    member.span(),
                    &format_args!(FormatRecordProperty(member), ","),
                ),
                _ => join.entry(member.span(), &member),
            }
        }
    });
    write!(f, ["{", block_indent(&content), "}"]);
    if is_consistent {
        f.context_mut().pop_quote_needed();
    }
}

/// `a: T = b`, `static a: T = b`
struct FormatRecordProperty<'a>(Member<'a>);

impl<'a> Format<'a> for FormatRecordProperty<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let member = self.0;
        let node = member.as_ast_nodes();
        format_node(
            member.span(),
            || node.parent(),
            f,
            |f| {
                write!(f, member.is_static().then_some("static "));
                if let Some(key) = member.key() {
                    format_computed_or_property_key(key, node, f);
                }
                write!(f, member.ty().map(FormatTypeAnnotation));
                if let Some(value) = member.init() {
                    write!(f, [" = ", value]);
                }
            },
        );
    }
}

// ───────────────────────────── comment types ─────────────────────────────

/// Which of Prettier's two parsers reads a file of Flow at `path`: `babel-flow`, as opposed to
/// `flow`, which somebody has to ask for, by name or with `.js.flow`.
pub fn goes_to_babel(options: &FormatOptions, path: &[u8]) -> bool {
    let name = options.filepath.as_deref().filter(|it| !it.is_empty());
    options.parser.as_deref() != Some(b"flow") && !name.unwrap_or(path).ends_with(b".js.flow")
}

/// Whether `text` has something that looks like a comment for which [`uncommented`] is there.
pub fn may_have_comment_types(text: &[u8]) -> bool {
    let mut rest = text;
    while let Some(at) = bun_core::strings::index_of(rest, b"/*") {
        rest = rest.get(at + 2..).unwrap_or_default();
        let blanks = rest
            .iter()
            .take_while(|b| matches!(b, b' ' | b'\t'))
            .count();
        let code = rest.get(blanks..).unwrap_or_default();
        if code.starts_with(b":") || code.starts_with(b"flow-include") {
            return true;
        }
    }
    false
}

/// Babel's plugin `flowComments`, which `babel-flow` has and `flow` has not: what is in `/*:: */`,
/// `/*flow-include */` and `/*: */` is code, and Prettier prints it as such. Returns the text that
/// has to be parsed and formatted in place of `file`, if it has such a comment.
pub fn uncommented<'a>(file: &'a File<'a>) -> Option<Vec<u8>> {
    let text = file.text();
    let mut out: Option<Vec<u8>> = None;
    let mut copied = 0;
    for comment in file.comments() {
        let span = comment.span();
        let Some(inner) = file
            .slice(span)
            .strip_prefix(b"/*")
            .and_then(|it| it.strip_suffix(b"*/"))
        else {
            continue;
        };
        let blanks = inner
            .iter()
            .take_while(|b| matches!(b, b' ' | b'\t'))
            .count();
        let code = inner.get(blanks..).unwrap_or_default();
        let code = match code {
            [b':', b':', code @ ..] => code,
            [b':', ..] => code,
            _ => match code.strip_prefix(b"flow-include") {
                Some(code) => code,
                None => continue,
            },
        };
        // The length of the line that `rest` starts with, if there are only blanks on it.
        let blank_line = |rest: &[u8]| {
            let blanks = rest
                .iter()
                .take_while(|b| matches!(b, b' ' | b'\t'))
                .count();
            match rest.get(blanks..) {
                Some([b'\r', b'\n', ..]) => Some(blanks + 2),
                Some([b'\r' | b'\n', ..]) => Some(blanks + 1),
                _ => None,
            }
        };
        let out = out.get_or_insert_with(|| Vec::with_capacity(text.len()));
        out.extend_from_slice(text.get(copied..span.start as usize).unwrap_or_default());
        // A `/*::` that is alone on its line leaves no line behind.
        let blanks_before = out.get(out.trim_ascii_end().len()..).unwrap_or_default();
        let is_at_start_of_line = blanks_before.len() == out.len()
            || bun_core::strings::index_of_any(blanks_before, b"\r\n").is_some();
        let code = match blank_line(code).filter(|_| is_at_start_of_line) {
            Some(line) => code.get(line..).unwrap_or_default(),
            None => code,
        };
        out.extend_from_slice(code);
        copied = span.end as usize;
        // For Prettier no empty line follows what ends before a `*/`.
        let rest = text.get(copied..).unwrap_or_default();
        let Some(line) = blank_line(rest) else {
            continue;
        };
        // A `*/` that starts its line leaves no line behind.
        let blanks_at_the_end = code.get(code.trim_ascii_end().len()..).unwrap_or_default();
        let starts_line = bun_core::strings::index_of_any(blanks_at_the_end, b"\r\n").is_some();
        if !starts_line {
            out.extend_from_slice(rest.get(..line).unwrap_or_default());
        }
        copied += line;
        while let Some(line) = blank_line(text.get(copied..).unwrap_or_default()) {
            copied += line;
        }
    }
    let mut out = out?;
    out.extend_from_slice(text.get(copied..).unwrap_or_default());
    Some(out)
}
