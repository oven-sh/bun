//! The types that take only a few lines each, and the members of interfaces and type literals.

use super::function_type::{
    write_ts_call_signature_declaration, write_ts_construct_signature_declaration, write_ts_method_signature,
};
use super::import_declaration::FormatStringLiteral;
use super::object_like::ObjectLike;
use super::type_parameters::type_arguments;
use crate::js::format::{FormatTypeAnnotation, identifier, write_trailing_comments_of};
use crate::js::utils::format_node_without_trailing_comments::FormatNodeWithoutTrailingComments;
use crate::js::utils::conditional::ConditionalLike;
use crate::js::utils::number::format_number_token;
use crate::js::utils::object::{format_computed_or_property_key, should_preserve_quote};
use crate::js::utils::string::{FormatLiteralStringToken, StringLiteralParentKind};
use crate::js::utils::suppressed::FormatSuppressedNode;
use crate::js::utils::typescript::without_lone_operator;
use crate::prelude::*;
use crate::{best_fitting, format_args, write};

/// `A.B.C`. `parent`: what it is a name in.
pub(crate) fn entity_name<'a>(name: EntityName<'a>, parent: AstNodes<'a>) -> impl Format<'a> {
    format_with(move |f: &mut Formatter<'a>| {
        f.join_with(".").entries(name.parts().map(|part| identifier(part, parent)));
    })
}

/// `A.B<C>`
pub(crate) fn write_ts_type_reference<'a>(
    ty: TypeNode<'a>,
    name: EntityName<'a>,
    args: List<'a, TypeNode<'a>>,
    f: &mut Formatter<'a>,
) {
    let wrap = is_leftmost_intrinsic_in_type_alias(ty, name, args);
    write!(
        f,
        [
            wrap.then_some("("),
            entity_name(name, ty.as_ast_nodes()),
            type_arguments(args, Node::Type(ty)),
            wrap.then_some(")")
        ]
    );
}

/// `type A = (intrinsic)` is a reference to a type of that name. Without the parentheses it is the
/// keyword.
fn is_leftmost_intrinsic_in_type_alias<'a>(ty: TypeNode<'a>, name: EntityName<'a>, args: List<'a, TypeNode<'a>>) -> bool {
    if !name.is("intrinsic") || !args.is_empty() {
        return false;
    }
    let start = ty.span().start;
    let mut parent = ty.ast_parent();
    loop {
        match parent {
            AstNodes::TSTypeAliasDeclaration(_) => return true,
            AstNodes::TSUnionType(it)
            | AstNodes::TSIntersectionType(it)
            | AstNodes::TSConditionalType(it)
            | AstNodes::TSArrayType(it)
                if it.span().start == start =>
            {
                parent = parent.parent();
            }
            _ => return false,
        }
    }
}

/// `"a"`, `1`, `-1`, `1n`
pub(crate) fn write_ts_literal_type<'a>(ty: TypeNode<'a>, f: &mut Formatter<'a>) {
    let text = ty.text();
    match ty.kind() {
        TypeKind::StringLit(_) => {
            write!(f, FormatLiteralStringToken::new(text, false, StringLiteralParentKind::Expression));
        }
        _ => {
            let (sign, digits) = match text.strip_prefix(b"-") {
                Some(digits) => (Some("-"), digits.trim_ascii_start()),
                None => (None, text),
            };
            match digits.ends_with(b"n") {
                true => write!(f, [sign, text_without_whitespace(&digits.to_ascii_lowercase())]),
                false => write!(f, [sign, format_number_token(digits)]),
            }
        }
    }
}

/// `{ a: A }`
pub(crate) fn write_ts_type_literal<'a>(ty: TypeNode<'a>, members: List<'a, Member<'a>>, f: &mut Formatter<'a>) {
    ObjectLike::TSTypeLiteral(ty, members).fmt(f);
}

/// The members of a type literal, with their separators.
pub(crate) fn write_ts_signatures<'a>(members: List<'a, Member<'a>>, f: &mut Formatter<'a>) {
    write_signatures(members, false, f);
}

/// The members of an interface, with their separators.
pub(crate) fn write_ts_interface_signatures<'a>(members: List<'a, Member<'a>>, f: &mut Formatter<'a>) {
    write_signatures(members, true, f);
}

fn write_signatures<'a>(members: List<'a, Member<'a>>, is_interface: bool, f: &mut Formatter<'a>) {
    let is_consistent = f.options().quote_properties.is_consistent();
    if is_consistent {
        let quote_needed = members.iter().any(|signature| {
            let node = signature.as_ast_nodes();
            matches!(node, AstNodes::TSPropertySignature(_) | AstNodes::TSMethodSignature(_))
                && signature.key().is_some_and(|key| should_preserve_quote(key, f) || is_quoted_new(key, node))
        });
        f.context_mut().push_quote_needed(quote_needed);
    }

    let mut joiner = f.join_nodes_with_soft_line();
    let mut iter = members.iter().peekable();
    while let Some(signature) = iter.next() {
        joiner.entry(
            signature.span(),
            &FormatTSSignature {
                signature,
                next_signature: iter.peek().copied(),
                is_interface,
            },
        );
    }

    if is_consistent {
        f.context_mut().pop_quote_needed();
    }
}

/// `"new"(): T` is a method. `new (): T` is not.
pub(crate) fn is_quoted_new<'a>(key: Key<'a>, parent: AstNodes<'a>) -> bool {
    matches!(parent, AstNodes::TSMethodSignature(_)) && matches!(key.kind(), KeyKind::String(_)) && key.is("new")
}

/// A member and the `;` after it.
struct FormatTSSignature<'a> {
    signature: Member<'a>,
    next_signature: Option<Member<'a>>,
    is_interface: bool,
}

/// A member, with the span that the comments after it are after.
struct FormatMemberIn<'a>(Member<'a>, Span);

impl<'a> Format<'a> for FormatMemberIn<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        self.0.fmt(f);
    }
}

impl Spanned for FormatMemberIn<'_> {
    fn span(&self) -> Span {
        self.1
    }
}

impl<'a> Format<'a> for FormatTSSignature<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let (signature, mut span) = (self.signature, self.signature.span());
        if !f.is_quiet() {
            if f.comments().is_suppressed(span.start) {
                return write!(f, signature);
            }
            if f.comments().has_trailing_suppression_comment(span.end) {
                let comments = f.comments().end_of_line_comments_after(span.end);
                return write!(f, [FormatSuppressedNode(span), FormatTrailingComments::Comments(comments)]);
            }
            // Prettier's `handleTSFunctionTrailingComments`: `a() /* comment */;`
            if matches!(signature.as_ast_nodes(), AstNodes::TSMethodSignature(_))
                && signature.func().is_some_and(|func| func.return_type().is_none())
            {
                span = f.comments().without_semicolon(span);
            }
        }

        // The separator is not part of the member. The comments after the member are behind it.
        write!(f, FormatNodeWithoutTrailingComments(&FormatMemberIn(signature, span)));
        self.write_separator(f);
        write_trailing_comments_of(signature.as_ast_nodes(), f);
    }
}

impl<'a> FormatTSSignature<'a> {
    fn write_separator(&self, f: &mut Formatter<'a>) {
        match (f.options().semicolons, self.next_signature) {
            (Semicolons::Always, Some(_)) => write!(f, ";"),
            (Semicolons::Always, None) => write!(f, if_group_breaks(&";")),
            (Semicolons::AsNeeded, None) if !self.is_interface => {}
            (Semicolons::AsNeeded, _) if self.needs_semicolon() => write!(f, ";"),
            (Semicolons::AsNeeded, Some(_)) => write!(f, if_group_fits_on_line(&";")),
            (Semicolons::AsNeeded, None) => {}
        }
    }

    /// Prettier's `shouldPrintSemicolonAfterInterfaceProperty`: what follows would be taken for the
    /// rest of the property.
    fn needs_semicolon(&self) -> bool {
        let signature = self.signature;
        if !matches!(signature.as_ast_nodes(), AstNodes::TSPropertySignature(_)) || signature.ty().is_some() {
            return false;
        }
        // `get; a(): void`, `a; (): void`
        signature.key().is_some_and(|key| {
            matches!(key.kind(), KeyKind::Ident(_)) && (key.is("static") || key.is("get") || key.is("set"))
        }) || self.next_signature.is_some_and(|next| matches!(next.as_ast_nodes(), AstNodes::TSCallSignatureDeclaration(_)))
    }
}

/// A member of an interface or a type literal that is not an index signature.
pub(crate) fn write_ts_signature<'a>(member: Member<'a>, f: &mut Formatter<'a>) {
    let node = member.as_ast_nodes();
    match (node, member.func()) {
        (AstNodes::TSCallSignatureDeclaration(_), Some(func)) => write_ts_call_signature_declaration(func, f),
        (AstNodes::TSConstructSignatureDeclaration(_), Some(func)) => write_ts_construct_signature_declaration(func, f),
        (AstNodes::TSMethodSignature(_), Some(func)) => write_ts_method_signature(member, func, f),
        _ => {
            write!(f, member.flags().contains(Flags::READONLY).then_some("readonly "));
            if let Some(key) = member.key() {
                format_computed_or_property_key(key, node, f);
            }
            // A comment at the end of the line of the `:` trails the name, unless a union or an
            // intersection follows (Prettier's `handlePropertySignatureComments`).
            if !f.is_quiet()
                && let Some(ty) = member.ty()
                && !matches!(without_lone_operator(ty).kind(), TypeKind::Union(_) | TypeKind::Intersection(_))
            {
                let comments = f.comments().end_of_line_comments_after(ty.annotation_span().start);
                write!(f, FormatTrailingComments::Comments(comments));
            }
            write!(f, [member.flags().contains(Flags::OPTIONAL).then_some("?"), member.ty().map(FormatTypeAnnotation)]);
        }
    }
}

/// `A extends B ? C : D`
pub(crate) fn write_ts_conditional_type<'a>(ty: TypeNode<'a>, f: &mut Formatter<'a>) {
    ConditionalLike::TSConditionalType(ty).fmt(f);
}

/// `typeof a.b<T>`
pub(crate) fn write_ts_type_query<'a>(
    ty: TypeNode<'a>,
    expr: Expr<'a>,
    args: List<'a, TypeNode<'a>>,
    f: &mut Formatter<'a>,
) {
    write!(f, ["typeof ", expr, type_arguments(args, Node::Type(ty))]);
}

/// `import("a").B<C>`, `typeof import("a")`
pub(crate) fn write_ts_import_type<'a>(ty: TypeNode<'a>, f: &mut Formatter<'a>) {
    let TypeKind::Import {
        name,
        args,
        is_typeof,
        ..
    } = ty.kind()
    else {
        return;
    };
    let Some(source) = ty.import_source_span() else {
        return write!(f, FormatSuppressedNode(ty.span()));
    };
    let node = AstNodes::TSImportType(ty);
    let format_source = FormatStringLiteral {
        span: source,
        parent: node,
    };

    write!(f, is_typeof.then_some("typeof "));
    match ty.import_attributes() {
        Some(options) => {
            write!(f, group(&format_args!("import", format_with(|f| write_import_type_arguments(&format_source, options, f)))));
        }
        // A long module name does not break.
        None if !f.comments().has_comment_before(source.start) => write!(f, ["import(", format_source, ")"]),
        None => write!(f, group(&format_args!("import(", soft_block_indent(&format_source), ")"))),
    }

    if !name.is_empty() {
        write!(f, [".", entity_name(name, node)]);
    }
    write!(f, type_arguments(args, Node::Type(ty)));
}

/// `("a", { with: { type: "json" } })`. Prettier's `printCallArguments` for a string and an object.
fn write_import_type_arguments<'a>(
    format_source: &FormatStringLiteral<'a>,
    options: ImportAttributes<'a>,
    f: &mut Formatter<'a>,
) {
    let span = options.options_span();
    let format_source = format_source.memoized();
    let does_source_break = format_source.inspect(f).will_break();
    let has_comments = f.comments().has_comment_before(span.start);
    let format_options = format_with(|f| write_import_type_options(options, f)).memoized();
    let do_options_break = format_options.inspect(f).will_break();

    let head = format_with(|f| write!(f, [format_source, ",", soft_line_break_or_space()]));
    let (head, format_options) = (&head, &format_options);
    let all_broken_out = |should_expand: bool| {
        format_with(move |f: &mut Formatter<'a>| {
            let arguments = format_args!(head, format_options);
            write!(f, group(&format_args!("(", soft_block_indent(&arguments), ")")).should_expand(should_expand));
        })
    };
    if has_comments {
        return write!(f, all_broken_out(does_source_break || do_options_break));
    }
    if does_source_break {
        return write!(f, all_broken_out(true));
    }
    let expanded_options =
        format_with(|f| write!(f, ["(", head, group(format_options).should_expand(true), ")"]));
    match do_options_break {
        true => write!(f, [expand_parent(), best_fitting!(expanded_options, all_broken_out(true))]),
        false => write!(
            f,
            best_fitting!(format_args!("(", head, format_options, ")"), expanded_options, all_broken_out(true))
        ),
    }
}

/// `{ with: { type: "json" } }`. It is an object literal, of which the HIR has only the properties
/// of the inner one.
fn write_import_type_options<'a>(options: ImportAttributes<'a>, f: &mut Formatter<'a>) {
    let (outer, keyword, inner) = (options.options_span(), options.keyword_span(), options.braces_span());
    let entries = options.entries();
    let is_expanded = |f: &Formatter<'a>, open: u32, first: u32| {
        f.options().expand == Expand::Auto && f.source_text().contains_newline_between(open, first)
    };
    let has_space = f.options().bracket_spacing.value();

    let format_inner = format_with(|f| {
        let Some(first) = entries.first() else {
            return write!(f, ["{", format_dangling_comments(inner).with_soft_block_indent(), "}"]);
        };
        let format_entries = format_with(|f| {
            let trailing_separator = FormatTrailingCommas::ES5.trailing_separator(f.options());
            f.join_nodes_with_soft_line().entries_with_trailing_separator(entries.iter(), ",", trailing_separator);
        });
        write!(
            f,
            group(&format_args!("{", soft_block_indent_with_maybe_space(&format_entries, has_space), "}"))
                .should_expand(is_expanded(f, inner.start, first.span().start))
        );
    });
    let format_property = format_args!(
        format_leading_comments(keyword),
        source_text(keyword),
        ":",
        space(),
        format_inner,
        FormatTrailingCommas::ES5
    );
    write!(
        f,
        group(&format_args!("{", soft_block_indent_with_maybe_space(&format_property, has_space), "}"))
            .should_expand(is_expanded(f, outer.start, keyword.start))
    );
}

/// `a is T`, `asserts a`, `asserts a is T`
pub(crate) fn write_ts_type_predicate<'a>(ty: TypeNode<'a>, f: &mut Formatter<'a>) {
    let TypeKind::Predicate {
        ty: type_annotation,
        asserts,
        ..
    } = ty.kind()
    else {
        return;
    };
    write!(f, [asserts.then_some("asserts "), ty.predicate_param().map(|it| identifier(it, AstNodes::TSTypePredicate(ty)))]);
    if let Some(type_annotation) = type_annotation {
        write!(f, [space(), "is", space(), FormatTypeAnnotation(type_annotation)]);
    }
}

/// The `: T` around `ty`. For the return type of a function type, `=> T`.
pub(crate) fn write_ts_type_annotation<'a>(ty: TypeNode<'a>, f: &mut Formatter<'a>) {
    match AstNodes::TSTypeAnnotation(ty).parent() {
        AstNodes::TSFunctionType(_) | AstNodes::TSConstructorType(_) => write!(f, ["=>", space(), ty]),
        AstNodes::TSTypePredicate(_) => write!(f, ty),
        _ => write!(f, [":", space(), ty]),
    }
}
