//! Flow-only syntax. Covers Prettier's `print/flow.js`, plus what the printers it shares with TypeScript do for Flow
//! nodes.
//!
//! The tree represents Flow syntax with TypeScript nodes (`flow.rs` in `bun_sema_parser` has the mapping table), so
//! most of a Flow file is written by the TypeScript functions. They call into this module when `File::is_flow` is true.

use super::class::dangling_comments_with_marker;
use super::function::FormatFunctionBody;
use super::function_type::{write_ts_call_signature_declaration, write_ts_method_signature};
use super::import_declaration::FormatStringLiteral;
use super::object_like::ObjectLike;
use super::parameters::FormatFormalParameters;
use super::semicolon::OptionalSemicolon;
use super::ts_types::{write_ts_interface_signatures, write_ts_signatures};
use super::type_parameters::{type_arguments, type_parameters};
use crate::js::attach::Marker;
use crate::js::format::{
    ExprOptions, FormatTypeAnnotation, format_name, format_node, identifier, name_without_comments,
    write_expression,
};
use crate::js::utils::format_node_without_trailing_comments::FormatNodeWithoutTrailingComments;
use crate::js::utils::object::{format_computed_or_property_key, key_requires_quotes};
use crate::js::utils::typescript::is_simple_type;
use crate::prelude::*;
use crate::{format_args, write};
use smallvec::SmallVec;

// ───────────────────────────── modifiers ─────────────────────────────

/// `static`, `proto`, `readonly`, `+`: copied from the source, in source order.
struct FormatModifiers<'a>(List<'a, Modifier<'a>>);

impl<'a> Format<'a> for FormatModifiers<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        for modifier in self.0.iter() {
            let span = modifier.token_span();
            format_name(span, f, |f| write!(f, source_text(span)));
            write!(f, (span.len() > 1).then_some(space()));
        }
    }
}

/// `+`, `-`, `in`, `out`: Flow's `Variance`, which is a node for Prettier.
pub(crate) fn is_variance(modifier: Modifier<'_>) -> bool {
    modifier.flag().intersects(Flags::IN | Flags::OUT)
}

/// Writes the `+` or `-` of a class property.
pub(crate) fn write_variance_sign<'a>(modifiers: List<'a, Modifier<'a>>, f: &mut Formatter<'a>) {
    for modifier in modifiers.iter().filter(|it| is_variance(*it)) {
        let span = modifier.token_span();
        format_name(span, f, |f| write!(f, source_text(span)));
    }
}

/// True if `modifiers` contains the keyword `word`, which TypeScript has no flag for.
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

/// `declare export`: the `declare` has no flag, so the exported declaration is written without it.
pub(crate) fn is_declare_export<'a>(statement: Stmt<'a>, f: &Formatter<'a>) -> bool {
    has_word(statement.modifiers(), b"declare", f)
}

/// Same, for a statement in any file.
pub(crate) fn is_flow_declare_export(statement: Stmt<'_>) -> bool {
    statement.file().is_flow() && has_word_in(statement.file(), statement.modifiers(), b"declare")
}

/// True for the nodes that Prettier's `isJsSourceElement` excludes: Flow's type parameters, and the content of
/// `declare export`.
pub(crate) fn is_not_js_source_element(node: AstNodes<'_>) -> bool {
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
#[inline(never)]
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

/// Returns `hook` or `component` if the function type `ty` starts with that keyword.
pub(crate) fn keyword_of_function_type<'a>(
    ty: TypeNode<'a>,
    func: Func<'a>,
) -> Option<&'static str> {
    // In `hook => void` it's the type of the parameter.
    if func.open_paren() == Some(ty.span().start) {
        return None;
    }
    match ty.first_token() {
        b"hook" => Some("hook"),
        b"component" => Some("component"),
        _ => None,
    }
}

/// True if `ty` is an `OptionalIndexedAccessType`: `A?.[B]`, or the `A?.[B][C]` around it.
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

/// True for a parameter of a function type, a signature or a declared function. That's Flow's `FunctionTypeParam`, as
/// opposed to a pattern with a type annotation.
pub(crate) fn is_function_type_param(param: Param<'_>) -> bool {
    param
        .func()
        .is_some_and(|func| !func.has_body() && !func.is_arrow())
}

/// True if `ty` is the return type or a parameter type of a function type, a signature or a declared function. In
/// Flow's tree it's directly in the function type or the `FunctionTypeParam`: no `TypeAnnotation` starts at the `=>` or
/// the `:`.
pub(crate) fn is_directly_in_function_type(ty: TypeNode<'_>) -> bool {
    match ty.parent() {
        Node::Func(func) => !func.has_body() && !func.is_arrow(),
        Node::Param(param) => is_function_type_param(param),
        _ => false,
    }
}

/// Prettier's `includesFunctionTypeInObjectType`. `is_in_object_type` means `node` is inside an object type.
fn includes_function_type_in_object_type(node: Node<'_>, is_in_object_type: bool) -> bool {
    // Nested nodes still to visit.
    let mut rest = vec![(node, is_in_object_type)];
    while let Some((node, is_in_object_type)) = rest.pop() {
        let (is_function_type, is_object_type, operand) = match node {
            Node::Type(ty) => (
                // A hook type and a component type are separate node kinds.
                matches!(ty.kind(), TypeKind::Fn(func) if keyword_of_function_type(ty, func).is_none()),
                ty.tag() == TypeTag::Object,
                ty.flow_nullable_operand(),
            ),
            // The value of a method, an accessor or a call property is a function type. An indexer has none.
            Node::Func(func) => (
                matches!(func.owner(), Node::Member(_)) && func.kind() != FnKind::IndexSignature,
                false,
                None,
            ),
            _ => (false, false, None),
        };
        if is_function_type && is_in_object_type {
            return true;
        }
        let is_in_object_type = is_in_object_type || is_object_type;
        match operand {
            Some(operand) => rest.push((Node::Type(operand), is_in_object_type)),
            None => node.for_each_child(|child| rest.push((child, is_in_object_type))),
        }
    }
    false
}

/// `T %checks`, which is a predicate around the `T` in the tree.
fn is_checks_predicate(ty: TypeNode<'_>) -> bool {
    matches!(ty.kind(), TypeKind::Predicate { param, .. } if param.is("%checks"))
}

/// True if `ty` is the return type of an arrow function. For `T %checks`, Prettier's return type is the `T`.
fn is_return_type_of_arrow(ty: TypeNode<'_>) -> bool {
    let outer = match ty.parent() {
        Node::Type(parent) if is_checks_predicate(parent) => parent,
        _ => ty,
    };
    matches!(outer.parent(), Node::Func(owner) if owner.is_arrow() && owner.return_type() == Some(outer))
}

/// Prettier's `needsParentheses` for Flow types.
pub(crate) fn needs_parentheses(ty: TypeNode<'_>) -> bool {
    // The `=>` of a function type in an object type would be parsed as the arrow function's `=>`. Prettier also prints
    // `(): (a is { b: () => void }) => c`, which is a syntax error.
    if ty.tag() != TypeTag::Predicate
        && is_return_type_of_arrow(ty)
        && !ty.flow_nullable_operand().is_some_and(needs_parentheses)
        && includes_function_type_in_object_type(Node::Type(ty), false)
    {
        return true;
    }
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
    if is_return_type_of_arrow(ty) {
        return true;
    }
    let parent = ty.parent();
    let mut ancestor = parent;
    if let Node::Type(parent) = parent {
        // The inner `=>` would be parsed as the arrow function's `=>`.
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

/// Writes `content`, which is `ty` without parentheses, adding parentheses if `ty` needs them.
fn write_in_parentheses<'a>(ty: TypeNode<'a>, content: &impl Format<'a>, f: &mut Formatter<'a>) {
    match needs_parentheses(ty) {
        true => write!(f, ["(", content, ")"]),
        false => write!(f, content),
    }
}

// ───────────────────────────── types ─────────────────────────────

/// `?T`, `renders T`. Returns true if `ty` is one of them.
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

/// `: T %checks` as a return type. Returns true if the predicate `ty` is one.
pub(crate) fn write_checks_predicate<'a>(ty: TypeNode<'a>, f: &mut Formatter<'a>) -> bool {
    match ty.kind() {
        TypeKind::Predicate {
            param, ty: checked, ..
        } if param.is("%checks") => {
            // `% /* comment */ checks`, which Prettier doesn't parse.
            let comments = f.comments().of_node(ty.as_ast_nodes()).dangling;
            write!(
                f,
                [
                    checked,
                    checked.map(|_| space()),
                    "%checks",
                    FormatTrailingComments::Comments(comments)
                ]
            );
            true
        }
        _ => false,
    }
}

/// Returns `implies` instead of `asserts` if the predicate `ty` starts with it.
pub(crate) fn predicate_prefix(ty: TypeNode<'_>) -> &'static str {
    match ty.first_token() {
        b"implies" => "implies ",
        _ => "asserts ",
    }
}

/// Returns the `T` and the `e` of the return type `T %checks(e)`, which is a type query with `T` as its type argument
/// in the tree.
pub(crate) fn as_declared_predicate(ty: TypeNode<'_>) -> Option<(Option<TypeNode<'_>>, Expr<'_>)> {
    match ty.kind() {
        TypeKind::Typeof { expr, args, .. } if ty.first_token() != b"typeof" => {
            Some((args.first(), expr))
        }
        _ => None,
    }
}

/// `: T %checks(e)` as a return type. Returns true if the type query `ty` is one. For a function that's only declared,
/// just the `T` is written, because the rest isn't part of the signature.
pub(crate) fn write_declared_predicate<'a>(ty: TypeNode<'a>, f: &mut Formatter<'a>) -> bool {
    let Some((return_type, expr)) = as_declared_predicate(ty) else {
        return false;
    };
    write!(f, return_type);
    let belongs_to_declared_function = matches!(
        ty.parent(),
        Node::Func(func) if !func.has_body() && matches!(func.owner(), Node::Stmt(_))
    );
    if !belongs_to_declared_function {
        write!(f, [return_type.map(|_| space()), "%checks(", expr, ")"]);
    }
    true
}

/// `interface { }`, `interface extends A, B { }`. `parts` are `A`, `B` and the object type.
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

/// For `hook (A) => B`, writes only the keyword. `component(a: A) renders B` is written here in full, and this returns
/// true for it.
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

pub(crate) fn is_component<'a>(func: Func<'a>, f: &Formatter<'a>) -> bool {
    match func.owner() {
        Node::Stmt(statement) => has_word(statement.modifiers(), b"component", f),
        Node::Type(ty) => keyword_of_function_type(ty, func) == Some("component"),
        _ => false,
    }
}

/// Writes a parameter without a name, which is just a type, and returns true. For any other parameter it only writes
/// the Flow-specific prefix: the `a as` of a component parameter.
pub(crate) fn write_parameter_start<'a>(param: Param<'a>, f: &mut Formatter<'a>) -> bool {
    let is_unnamed = param.pat().tag() == PatTag::Missing;
    let outer_name = match param.modifiers().is_empty() {
        true => param
            .flow_outer_name()
            .filter(|_| param.func().is_some_and(|func| is_component(func, f))),
        false => None,
    };
    if let Some(span) = outer_name {
        format_name(span, f, |f| match f.source_text().text_for(&span).first() {
            Some(b'"' | b'\'') => write!(f, FormatStringLiteral { span }),
            _ => write!(f, source_text(span)),
        });
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

/// Returns the offset of the `=>` if `func` is a function type with parameters. Prettier has no node between the last
/// parameter and the type after the `=>`, so a comment before the `=>` trails the parameter.
pub(crate) fn arrow_after_parameters(func: Func<'_>) -> Option<u32> {
    let is_function_type = func.file().is_flow()
        && func.kind() == FnKind::FunctionType
        && !func.params().is_empty()
        && matches!(func.owner(), Node::Type(ty) if keyword_of_function_type(ty, func) != Some("component"));
    match is_function_type {
        true => Some(func.return_type()?.annotation_span().start),
        false => None,
    }
}

/// Prettier's `isFlowShorthandWithOneArg`: `A => B`, in the positions where it's printed without a possible line break,
/// and with parentheses only if arrow functions get them.
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

/// The part of Prettier's `shouldIndentUnionType` that deals with function type parameters. True if the union `ty` is
/// printed without its own indentation.
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

/// Writes the parameter of a function type for which [`is_shorthand_function_type`] is true.
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

/// Writes the modifiers of a type parameter: `const`, `+`, `in`.
pub(crate) fn write_type_parameter_modifiers<'a>(param: TypeParam<'a>, f: &mut Formatter<'a>) {
    write!(f, FormatModifiers(param.modifiers()));
}

/// `: Bound` or ` extends Bound`, whichever the source has. Babel's tree doesn't record which one it is, so with
/// `babel` and `babel-flow` Prettier prints `T: A` for `T extends A`.
pub(crate) fn write_type_parameter_bound<'a>(
    param: TypeParam<'a>,
    bound: TypeNode<'a>,
    f: &mut Formatter<'a>,
) {
    match param.flow_token_after_name() == b":" {
        true => write!(f, FormatTypeAnnotation(bound)),
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
        let label = identifier(label);
        write!(f, [label, element.is_optional().then_some("?"), ": "]);
    }
    write!(f, element.flow_type());
}

/// `[...]`. The comments dangle in the tuple type, and Prettier's `printArray` prints them after the dots. Returns true
/// if `ty` is one.
pub(crate) fn write_tuple_of_unknown_elements<'a>(
    ty: TypeNode<'a>,
    elements: List<'a, TupleElem<'a>>,
    f: &mut Formatter<'a>,
) -> bool {
    if elements.len() != 1 || !is_inexact_tuple(elements) {
        return false;
    }
    let comments = f.comments().of_node(ty.as_ast_nodes()).dangling;
    let format_comments = FormatDanglingComments::Comments {
        comments,
        indent: DanglingIndentMode::None,
    };
    write!(
        f,
        group(&format_args!(
            "[",
            soft_block_indent(&format_args!("...", format_comments)),
            "]"
        ))
        .should_expand(comments.iter().any(|comment| comment.is_line()))
    );
    true
}

/// True if the tuple ends with the `...` of an inexact tuple type, which has no comma after it.
pub(crate) fn is_inexact_tuple<'a>(elements: List<'a, TupleElem<'a>>) -> bool {
    elements.last().is_some_and(|it| it.flow_type().is_none())
}

// ───────────────────────────── object types ─────────────────────────────

/// True for the `...` that ends an inexact object type, which has no comma after it.
pub(crate) fn is_inexact_mark(member: Member<'_>) -> bool {
    member.is_flow_spread() && member.ty().is_none()
}

/// `{ a: A }`, `{| a: A |}`, `{ a: A, ... }`. Prettier's `printClassBody` for an object type that isn't the body of an
/// interface or a class.
#[inline(never)]
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
            dangling_comments(ty.as_ast_nodes()).with_soft_block_indent()
        ),
        // `{ /* comment */ ... }`
        Some(first)
            if is_inexact_mark(first)
                && !(f.comments().of_node(ty.as_ast_nodes()).dangling).is_empty() =>
        {
            let comments = f.comments().of_node(ty.as_ast_nodes()).dangling;
            let has_line_comment = comments.iter().any(|comment| comment.is_line());
            let ends_line = comments.last().is_some_and(|it| it.has_newline_after());
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
                false => write!(
                    f,
                    group(&inner)
                        .should_expand(should_expand)
                        .stays_expanded(f.options().expand == Expand::Auto)
                ),
            }
        }
    }
    write!(f, [close, needs_parentheses.then_some(")")]);
}

/// Writes a member of an object type, an interface or a declared class, without the separator after it.
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
        (MemberKind::CallSignature, Some(func)) => {
            // `static /* comment */ (): void`
            write!(f, leading_comments(AstNodes::FormalParameters(func)));
            write_ts_call_signature_declaration(func, f);
        }
        (_, Some(func)) => match (
            member.flow_internal_slot(),
            member.key().map(|it| it.kind()),
        ) {
            (Some(slot), _) => {
                write!(f, ["[[", identifier(slot), "]]"]);
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
                (Some(slot), _) => write!(f, ["[[", identifier(slot), "]]"]),
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
    let name = identifier(param.name());
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

/// True if the interface `statement` represents `opaque type A = B`.
pub(crate) fn is_opaque_type<'a>(statement: Stmt<'a>, f: &Formatter<'a>) -> bool {
    has_word(statement.modifiers(), b"opaque", f)
}

/// Same, for a statement in any file.
pub(crate) fn is_flow_opaque_type(statement: Stmt<'_>) -> bool {
    statement.file().is_flow() && has_word_in(statement.file(), statement.modifiers(), b"opaque")
}

/// `opaque type A<T>: B = C`, `opaque type A super B extends C = D`
#[inline(never)]
pub(crate) fn write_opaque_type<'a>(
    statement: Stmt<'a>,
    interface: Interface<'a>,
    f: &mut Formatter<'a>,
) {
    write!(
        f,
        [
            is_declared(statement.modifiers()).then_some("declare "),
            "opaque type ",
            identifier(interface.name()),
            type_parameters(interface.type_params(), Node::Stmt(statement))
        ]
    );
    let (bounds, file) = (interface.extends(), f.file());
    // Checks the token before a bound: `:`, `super` or `extends`.
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

/// `declare module.exports: T`, and the `T` of `declare export default T`. Returns true if the type alias represents
/// one of them.
pub(crate) fn write_pseudo_type_alias<'a>(
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

/// True if `class` is `declare class`, whose members are those of an object type.
#[inline]
pub(crate) fn is_declared_class(class: Class<'_>) -> bool {
    class.flags().contains(Flags::AMBIENT) && class.file().is_flow()
}

/// Writes `declare class` and `record`. Returns true if `class` is one of them.
#[inline(never)]
pub(crate) fn write_class<'a>(class: Class<'a>, f: &mut Formatter<'a>) -> bool {
    let is_record = is_record(class, f);
    if is_record || is_declared_class(class) {
        write_declared_class_or_record(class, is_record, f);
        return true;
    }
    false
}

/// `A, B`: the types after `mixins` or `implements`.
struct FormatHeritageClauses<'a>(List<'a, TypeNode<'a>>);

impl<'a> Format<'a> for FormatHeritageClauses<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        f.join_with(soft_line_break_or_space())
            .entries_with_trailing_separator(self.0.iter(), ",", TrailingSeparator::Disallowed);
    }
}

/// `declare class A<T> extends B<T> mixins C implements D { }`, `record A<T> implements B { }`.
/// Prettier's `printClass`.
fn write_declared_class_or_record<'a>(class: Class<'a>, is_record: bool, f: &mut Formatter<'a>) {
    let node = AstNodes::Class(class);
    let (mixins, implements) = (class.flow_mixins(), class.implements());
    let count = usize::from(class.extends().is_some()) + mixins.len() + implements.len();
    let has_multiple_heritage = count > 1;
    let name_comments = class
        .name()
        .map(|name| f.comments().of_name(name.span().start));
    let type_parameters_node = AstNodes::TSTypeParameterDeclaration(Node::Class(class));
    // True if `ty` is `A.B` without type arguments.
    let is_qualified = |ty: TypeNode<'a>| matches!(ty.kind(), TypeKind::Ref { name, args } if name.len() > 1 && args.is_empty());
    // Prettier's `shouldPrintClassInGroupMode`
    let group_mode = has_multiple_heritage
        || name_comments.is_some_and(|comments| !comments.trailing.is_empty())
        || !(f.comments().of_node(type_parameters_node).trailing).is_empty()
        || match (class.extends(), mixins.first()) {
            (Some(extends), _) => extends.tag() == ExprTag::Dot && class.extends_args().is_empty(),
            (None, Some(first)) => is_qualified(first),
            (None, None) => false,
        };

    let format_extends = format_with(|f| {
        // `A.B.C`, from the outside in: each `A.B` and its `B`.
        let mut qualified_names: SmallVec<[(AstNodes<'a>, Ident<'a>); 4]> = SmallVec::new();
        let mut leftmost = class.extends();
        while let Some(e) = leftmost
            && let ExprKind::Dot { obj, name, .. } = e.kind()
        {
            qualified_names.push((e.as_chain_element(), name));
            leftmost = Some(obj);
        }
        for &(node, _) in qualified_names.iter() {
            write!(f, leading_comments(node));
        }
        write!(f, leftmost);
        for &(node, name) in qualified_names.iter().rev() {
            write!(f, [".", identifier(name), trailing_comments(node)]);
        }
        write!(f, type_arguments(class.extends_args(), Node::Class(class)));
    });
    let (format_mixins, format_implements) = (
        FormatHeritageClauses(mixins),
        FormatHeritageClauses(implements),
    );
    // Prettier's `printHeritageClauses`
    let clauses = format_with(|f| {
        let clauses: [(&'static str, Marker, bool, &dyn Format<'a>); 3] = [
            (
                "extends",
                Marker::Extends,
                class.extends().is_some(),
                &format_extends,
            ),
            ("mixins", Marker::Mixins, !mixins.is_empty(), &format_mixins),
            (
                "implements",
                Marker::Implements,
                !implements.is_empty(),
                &format_implements,
            ),
        ];
        for (keyword, marker, _, list) in clauses.into_iter().filter(|clause| clause.2) {
            let comments = dangling_comments_with_marker(node, marker, f);
            let format_comments = FormatDanglingComments::Comments {
                comments,
                indent: DanglingIndentMode::None,
            };
            match (has_multiple_heritage, group_mode) {
                (true, _) => write!(
                    f,
                    [
                        soft_line_break_or_space(),
                        format_comments,
                        (!comments.is_empty()).then_some(hard_line_break()),
                        keyword,
                        group(&soft_line_indent_or_space(list))
                    ]
                ),
                (false, true) => write!(
                    f,
                    [
                        soft_line_break_or_space(),
                        group(&format_args!(keyword, space(), format_comments, list))
                    ]
                ),
                (false, false) => write!(f, [space(), keyword, space(), format_comments, list]),
            }
        }
    });
    let head = format_with(|f| {
        if let (Some(name), Some(comments)) = (class.name(), name_comments) {
            write!(
                f,
                [
                    space(),
                    FormatLeadingComments::Comments(comments.leading),
                    name_without_comments(name.span()),
                    indent(&FormatTrailingComments::Comments(comments.trailing))
                ]
            );
        }
        let type_parameters = type_parameters(class.type_params(), Node::Class(class));
        write!(
            f,
            [
                FormatNodeWithoutTrailingComments(&type_parameters),
                indent(&trailing_comments(type_parameters_node))
            ]
        );
    });

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
    let body = AstNodes::ClassBody(class);
    format_node(body, f, |f| match class.members().is_empty() {
        true => write!(f, ["{", dangling_comments(body).with_block_indent(), "}"]),
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
    });
    // Prettier's `shouldOmitSemicolon` doesn't know about records.
    if is_record && matches!(class.owner(), Node::Stmt(statement) if statement.is_default_export())
    {
        write!(f, OptionalSemicolon);
    }
}

/// Returns the keyword that `func`'s declaration starts with, `hook` or `function`. A component, and a function that's
/// only declared (which is written like a function type), are written here in full, and then this returns `None`.
#[inline(never)]
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
        let name = func.name().map(|name| identifier(name));
        write!(
            f,
            [
                is_declared(modifiers).then_some("declare "),
                keyword,
                space(),
                name,
                // `f/* comment */ (): void`
                leading_comments(AstNodes::FormalParameters(func))
            ]
        );
        write_ts_call_signature_declaration(func, f);
        if let Some((_, expr)) = func.return_type().and_then(as_declared_predicate) {
            // `%checks(a) /* comment */`
            let comments = f.comments().of_node(AstNodes::Function(func)).dangling;
            write!(
                f,
                [
                    " %checks(",
                    expr,
                    ")",
                    FormatTrailingComments::Comments(comments)
                ]
            );
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
            func.name().map(|name| identifier(name)),
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

/// True for the `...` that ends an enum with unknown members, which has no comma after it.
pub(crate) fn is_unknown_members_mark(member: EnumMember<'_>) -> bool {
    member.text() == b"..."
}

/// Returns `typeof ` or `type `, whichever the import (after its `import` keyword) or the specifier has at `start`.
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

/// `match (a) { .. }` as an expression is a `new` expression in the tree, which doesn't start with `new`. Returns the
/// `match (a)`, which is a call, and the `{ .. }`, which is an object.
pub(crate) fn as_match_expression(e: Expr<'_>) -> Option<(Expr<'_>, Expr<'_>)> {
    let ExprKind::New(call) = e.kind() else {
        return None;
    };
    let (head, braces) = (call.callee(), call.args().first()?);
    (head.span().start == e.span().start
        && head.tag() == ExprTag::Call
        && braces.tag() == ExprTag::Object)
        .then_some((head, braces))
}

/// True for the `{ .. }` of a match expression.
pub(crate) fn is_braces_of_match(braces: Expr<'_>) -> bool {
    matches!(braces.parent(), Node::Expr(e)
        if as_match_expression(e).is_some_and(|(_, it)| it == braces))
}

/// True for `pattern => body` in a match expression, which is a property in the tree. For Prettier the body isn't in a
/// property.
pub(crate) fn is_match_expression_case(case: Prop<'_>) -> bool {
    case.file().is_flow()
        && matches!(case.parent(), Node::Expr(braces) if is_braces_of_match(braces))
}

/// `match (a) { .. }` as a statement is a `switch` statement in the tree, which doesn't start with `switch`. Returns
/// the `match (a)`, which is a call.
pub(crate) fn head_of_match_statement(statement: Stmt<'_>) -> Option<Expr<'_>> {
    match statement.kind() {
        StmtKind::Switch { expr, .. } => Some(expr).filter(|head| {
            head.tag() == ExprTag::Call && head.span().start == statement.span().start
        }),
        _ => None,
    }
}

/// `match (a) { }` and `R { a: 1 }` are `new` expressions in the tree, which don't start with `new`. If `e` is one of
/// them, writes it and returns true.
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
                        format_node(case.as_ast_nodes(), f, |f| {
                            write_match_expression_case(case, f);
                        });
                    });
                    join.entry(case.span(), &content);
                }
            });
            write_match(head, cases.is_empty(), &format_cases, f);
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

/// A match statement is a `switch` statement in the tree, which doesn't start with `switch`. If `statement` is one,
/// writes it and returns true.
pub(crate) fn write_match_statement<'a>(
    statement: Stmt<'a>,
    head: Expr<'a>,
    cases: List<'a, Case<'a>>,
    f: &mut Formatter<'a>,
) -> bool {
    let Some(head) = head
        .as_call()
        .filter(|_| head_of_match_statement(statement) == Some(head))
    else {
        return false;
    };
    let format_cases = format_with(|f| {
        let mut join = f.join_nodes_with_hardline();
        for case in cases.iter() {
            let content = format_with(|f| {
                format_node(AstNodes::SwitchCase(case), f, |f| {
                    write_match_pattern_and_guard(case.test(), f);
                    write!(f, " => ");
                    match case.body().first() {
                        // An empty block in a `case` of a `switch` is printed differently.
                        Some(block) if block.as_block().is_some_and(|it| it.is_empty()) => {
                            let node = block.as_ast_nodes();
                            format_node(node, f, |f| {
                                write!(f, ["{", dangling_comments(node).with_block_indent(), "}"]);
                            });
                        }
                        body => write!(f, body),
                    }
                });
            });
            join.entry(case.span(), &content);
        }
    });
    write_match(head, cases.is_empty(), &format_cases, f);
    true
}

/// Prettier's `printMatch`. `head` is the `match (a)`.
fn write_match<'a>(head: Call<'a>, is_empty: bool, cases: &impl Format<'a>, f: &mut Formatter<'a>) {
    let argument = head.args().first();
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
            // The guard isn't really an operand of `&&`, so it's written without the parentheses check.
            let guard = format_with(|f| {
                format_node(right.as_ast_nodes(), f, |f| {
                    write_expression(right, ExprOptions::None, f)
                });
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

/// A pattern's direct parent.
#[derive(Copy, Clone, PartialEq, Eq)]
enum PatternParent {
    Case,
    /// The number of elements, not counting a rest element.
    Array(usize),
    Property,
    /// The pattern is the left side.
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
        (pattern.tag(), pattern.unary_op()),
        (
            ExprTag::Binary | ExprTag::Object | ExprTag::Array | ExprTag::New | ExprTag::Spread,
            _
        ) | (ExprTag::Unary, Some(UnOp::Void))
    );
    if is_leaf {
        return write!(f, pattern);
    }
    format_node(pattern.as_ast_nodes(), f, |f| {
        write_compound_match_pattern(pattern, parent, f)
    });
}

fn write_compound_match_pattern<'a>(
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
                write!(f, dangling_comments(pattern.as_ast_nodes()));
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
                    format_node(property.as_ast_nodes(), f, |f| {
                        write_match_object_pattern_property(property, f);
                    });
                }
                if !has_rest {
                    write!(f, if_group_breaks(&","));
                }
                write!(f, dangling_comments(pattern.as_ast_nodes()));
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
    let format_key = format_with(|f| {
        format_name(span, f, |f| match key.kind() {
            KeyKind::String(_) => write!(f, FormatStringLiteral { span }),
            _ => write!(f, source_text(span)),
        });
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
        ExprTag::Unary => pattern.unary_op() != Some(UnOp::Void),
        _ => false,
    }
}

/// One of the patterns of `a | b`.
struct FormatAlternative<'a>(Expr<'a>);

impl<'a> Format<'a> for FormatAlternative<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        write_match_pattern(self.0, PatternParent::Other, f);
    }
}

impl Spanned for FormatAlternative<'_> {
    fn span(&self) -> Span {
        self.0.span()
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
            // The pattern is aligned without its comments:
            //
            //     | a
            //     // comment
            //     | b
            let node = it.as_chain_element();
            write!(
                f,
                [
                    leading_comments(node),
                    align(
                        2,
                        &FormatNodeWithoutTrailingComments(&FormatAlternative(it))
                    ),
                    trailing_comments(node)
                ]
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

/// True if `class` is `record A { }`.
fn is_record<'a>(class: Class<'a>, f: &Formatter<'a>) -> bool {
    has_word(class.modifiers(), b"record", f)
}

/// Same, for a class in any file.
pub(crate) fn is_flow_record(class: Class<'_>) -> bool {
    class.file().is_flow() && has_word_in(class.file(), class.modifiers(), b"record")
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
        format_node(node, f, |f| {
            write!(f, member.is_static().then_some("static "));
            if let Some(key) = member.key() {
                format_computed_or_property_key(key, node, f);
            }
            write!(f, member.ty().map(FormatTypeAnnotation));
            if let Some(value) = member.init() {
                write!(f, [" = ", value]);
            }
        });
    }
}

// ───────────────────────────── comment types ─────────────────────────────

/// True if Prettier parses the Flow file at `path` with `babel-flow` instead of `flow`. `flow` has to be requested
/// explicitly, with the `parser` option or a `.js.flow` extension.
pub fn is_parsed_by_babel_flow(options: &FormatOptions, path: &[u8]) -> bool {
    let name = options.filepath.as_deref().filter(|it| !it.is_empty());
    let is_flow_by_name =
        crate::text::ends_with_ignore_ascii_case(name.unwrap_or(path), b".js.flow");
    options.parser.as_deref() != Some(b"flow") && !is_flow_by_name
}

/// True if `text` contains something that looks like a comment that [`uncommented`] handles.
pub fn may_have_comment_types(text: &[u8]) -> bool {
    let mut rest = text;
    while let Some(at) = bun_core::strings::index_of(rest, b"/*") {
        rest = rest.get(at + 2..).unwrap_or_default();
        let indent_len = rest
            .iter()
            .take_while(|b| matches!(b, b' ' | b'\t'))
            .count();
        let code = rest.get(indent_len..).unwrap_or_default();
        if code.starts_with(b":") || code.starts_with(b"flow-include") {
            return true;
        }
    }
    false
}

/// Babel's `flowComments` plugin, which `babel-flow` enables and `flow` doesn't. The content of `/*:: */`,
/// `/*flow-include */` and `/*: */` is code, and Prettier prints it as code. Returns the text to parse and format in
/// place of `file`, if it has such a comment.
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
        let indent_len = inner
            .iter()
            .take_while(|b| matches!(b, b' ' | b'\t'))
            .count();
        let code = inner.get(indent_len..).unwrap_or_default();
        let code = match code {
            [b':', b':', code @ ..] => code,
            [b':', ..] => code,
            _ => match code.strip_prefix(b"flow-include") {
                Some(code) => code,
                None => continue,
            },
        };
        // Returns the length of the line that `rest` starts with, if it contains only spaces and tabs.
        let blank_line = |rest: &[u8]| {
            let indent_len = rest
                .iter()
                .take_while(|b| matches!(b, b' ' | b'\t'))
                .count();
            match rest.get(indent_len..) {
                Some([b'\r', b'\n', ..]) => Some(indent_len + 2),
                Some([b'\r' | b'\n', ..]) => Some(indent_len + 1),
                _ => None,
            }
        };
        let out = out.get_or_insert_with(|| Vec::with_capacity(text.len()));
        out.extend_from_slice(text.get(copied..span.start as usize).unwrap_or_default());
        // A `/*::` that's alone on its line doesn't leave an empty line behind.
        let whitespace_before = out.get(out.trim_ascii_end().len()..).unwrap_or_default();
        let is_at_start_of_line = whitespace_before.len() == out.len()
            || bun_core::strings::index_of_any(whitespace_before, b"\r\n").is_some();
        let code = match blank_line(code).filter(|_| is_at_start_of_line) {
            Some(line) => code.get(line..).unwrap_or_default(),
            None => code,
        };
        out.extend_from_slice(code);
        copied = span.end as usize;
        // For Prettier, code that ends right before a `*/` is never followed by an empty line.
        let rest = text.get(copied..).unwrap_or_default();
        let Some(line) = blank_line(rest) else {
            continue;
        };
        // A `*/` that starts its line doesn't leave an empty line behind.
        let trailing_whitespace = code.get(code.trim_ascii_end().len()..).unwrap_or_default();
        let starts_line = bun_core::strings::index_of_any(trailing_whitespace, b"\r\n").is_some();
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
