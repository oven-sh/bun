//! The types that take only a few lines each, and the members of interfaces and type literals.

use super::function_type::{
    write_ts_call_signature_declaration, write_ts_construct_signature_declaration,
    write_ts_method_signature,
};
use super::object_like::ObjectLike;
use super::type_parameters::{FormatDanglingCommentsForInline, type_arguments};
use super::union_type::union_writes_comments_behind_colon;
use crate::cursor::extend_node;
use crate::js::format::{FormatTypeOfPredicate, format_node, identifier};
use crate::js::utils::conditional::ConditionalLike;
use crate::js::utils::format_node_without_trailing_comments::FormatNodeWithoutTrailingComments;
use crate::js::utils::number::format_number_token;
use crate::js::utils::object::{format_computed_or_property_key, key_requires_quotes};
use crate::js::utils::string::{FormatLiteralStringToken, StringLiteralParentKind};
use crate::js::utils::suppressed::{FormatSuppressedNode, FormatTemplateText};
use crate::js::utils::typescript::without_lone_operator;
use crate::prelude::*;
use crate::{best_fitting, format_args, write};

/// `A.B.C`
pub(crate) fn entity_name<'a>(name: EntityName<'a>) -> impl Format<'a> {
    format_with(move |f: &mut Formatter<'a>| {
        f.join_with(".")
            .entries(name.parts().map(|part| identifier(part)));
    })
}

/// `A.B<C>`
pub(crate) fn write_ts_type_reference<'a>(
    ty: TypeNode<'a>,
    name: EntityName<'a>,
    args: List<'a, TypeNode<'a>>,
    f: &mut Formatter<'a>,
) {
    // What it is only matters for a long name, and for comments.
    if f.is_quiet()
        && name.len() <= 2
        && !f.file().is_javascript()
        && !keeps_parentheses_of_intrinsic(f)
    {
        f.join_with(".")
            .entries(name.parts().map(|part| source_text(part.span())));
        return write!(f, type_arguments(args, Node::Type(ty)));
    }
    let node = ty.as_ast_nodes();
    if name.len() > 2
        && heritage_name_breaks_before_its_dots(f)
        && matches!(
            node,
            AstNodes::TSInterfaceHeritage(_) | AstNodes::TSClassImplements(_)
        )
    {
        return write!(
            f,
            [heritage_name(name), type_arguments(args, Node::Type(ty))]
        );
    }
    if args.is_empty() && f.file().is_javascript() {
        // Flow's other name for it.
        if name.len() == 1 && ty.text() == b"bool" {
            return write!(f, "boolean");
        }
        // `A<>`
        if ty.text().ends_with(b">") {
            let arguments = AstNodes::TSTypeParameterInstantiation(Node::Type(ty));
            return write!(
                f,
                [
                    entity_name(name),
                    "<",
                    FormatDanglingCommentsForInline(arguments),
                    ">"
                ]
            );
        }
    }
    let wrap =
        keeps_parentheses_of_intrinsic(f) && is_leftmost_intrinsic_in_type_alias(ty, name, args);
    write!(
        f,
        [
            wrap.then_some("("),
            entity_name(name),
            type_arguments(args, Node::Type(ty)),
            wrap.then_some(")")
        ]
    );
}

/// For oxfmt `A.B.C` after `extends` or `implements` is a name like any other, on one line.
fn heritage_name_breaks_before_its_dots(f: &Formatter<'_>) -> bool {
    !f.options().flavor.is_oxfmt()
}

/// `A.B.C` after `extends` or `implements`. There it is a member expression in ESTree, which can
/// break before its dots (Prettier's `printMemberExpression`).
fn heritage_name<'a>(name: EntityName<'a>) -> impl Format<'a> {
    format_with(move |f: &mut Formatter<'a>| {
        for (index, part) in name.parts().enumerate() {
            let part = identifier(part);
            match index {
                0 => write!(f, part),
                _ => write!(
                    f,
                    [
                        line_suffix_boundary(),
                        group(&indent(&format_args!(soft_line_break(), ".", part)))
                    ]
                ),
            }
        }
    })
}

/// oxfmt keeps the parentheses of `type A = (intrinsic)`. Prettier drops them, which changes what it
/// means.
fn keeps_parentheses_of_intrinsic(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

/// `type A = (intrinsic)` is a reference to a type of that name. Without the parentheses it is the
/// keyword.
fn is_leftmost_intrinsic_in_type_alias<'a>(
    ty: TypeNode<'a>,
    name: EntityName<'a>,
    args: List<'a, TypeNode<'a>>,
) -> bool {
    if !name.is("intrinsic") || !args.is_empty() {
        return false;
    }
    let start = ty.outer_span().start;
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
        // A template without substitutions.
        TypeKind::StringLit(_) if text.starts_with(b"`") => {
            write!(f, [line_suffix_boundary(), FormatTemplateText(ty.span())]);
        }
        TypeKind::StringLit(_) => {
            write!(
                f,
                FormatLiteralStringToken::new(text, false, StringLiteralParentKind::Expression)
            );
        }
        _ => {
            let format_digits = |digits: &'a [u8]| {
                format_with(move |f: &mut Formatter<'a>| match digits.ends_with(b"n") {
                    true => write!(f, text_without_whitespace(&digits.to_ascii_lowercase())),
                    false => write!(f, format_number_token(digits)),
                })
            };
            let Some(rest) = text.strip_prefix(b"-") else {
                return write!(f, format_digits(text));
            };
            // `- /* comment */ 1`: like a unary expression whose operand has a comment.
            let comments = match f.is_quiet() {
                true => CommentList::empty(),
                false => f.comments().of_node(ty.as_ast_nodes()).dangling,
            };
            let Some(last) = comments.last() else {
                return write!(f, ["-", format_digits(rest.trim_ascii_start())]);
            };
            let digits = f
                .source_text()
                .text_for(&Span::new(last.next_token_start(), ty.span().end));
            let operand = format_args!(
                FormatLeadingComments::Comments(comments),
                format_digits(digits)
            );
            write!(
                f,
                [
                    "-",
                    group(&format_args!("(", soft_block_indent(&operand), ")"))
                ]
            );
        }
    }
}

/// `{ a: A }`
pub(crate) fn write_ts_type_literal<'a>(
    ty: TypeNode<'a>,
    members: List<'a, Member<'a>>,
    f: &mut Formatter<'a>,
) {
    if f.file().is_flow() {
        return super::flow::write_object_type(ty, members, f);
    }
    ObjectLike::TSTypeLiteral(ty, members).fmt(f);
}

/// The members of a type literal, with their separators.
pub(crate) fn write_ts_signatures<'a>(members: List<'a, Member<'a>>, f: &mut Formatter<'a>) {
    write_signatures(members, false, f);
}

/// The members of an interface, with their separators.
pub(crate) fn write_ts_interface_signatures<'a>(
    members: List<'a, Member<'a>>,
    f: &mut Formatter<'a>,
) {
    write_signatures(members, true, f);
}

fn write_signatures<'a>(members: List<'a, Member<'a>>, is_interface: bool, f: &mut Formatter<'a>) {
    let is_consistent = f.options().quote_properties.is_consistent();
    if is_consistent {
        let quote_needed = members.iter().any(|signature| {
            let node = signature.as_ast_nodes();
            matches!(
                node,
                AstNodes::TSPropertySignature(_) | AstNodes::TSMethodSignature(_)
            ) && signature
                .key()
                .is_some_and(|key| key_requires_quotes(key, node, f))
        });
        f.context_mut().push_quote_needed(quote_needed);
    }

    let mut joiner = f.join_nodes_with_soft_line();
    let mut iter = members.iter().peekable();
    while let Some(signature) = iter.next() {
        let content = FormatTSSignature {
            signature,
            next_signature: iter.peek().copied(),
            is_interface,
        };
        // Prettier has no node for the `...`.
        match super::flow::is_inexact_mark(signature)
            && !joiner.has_comment_before(signature.span().start)
        {
            true => joiner.entry_without_empty_line(&content),
            false => joiner.entry(signature.span(), &content),
        }
    }

    if is_consistent {
        f.context_mut().pop_quote_needed();
    }
}

/// `a: string; /* comment */` is `a: string /* comment */;` for oxfmt.
fn separator_is_behind_comments(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

/// A member and the `;` after it.
struct FormatTSSignature<'a> {
    signature: Member<'a>,
    next_signature: Option<Member<'a>>,
    is_interface: bool,
}

impl<'a> Format<'a> for FormatTSSignature<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let signature = self.signature;
        let node = signature.as_ast_nodes();
        if !f.is_quiet() {
            if f.comments().is_ignored(node) {
                write!(f, signature);
                // It is not part of a member of Flow's.
                if f.file().is_flow() {
                    self.write_separator(f);
                }
                return;
            }
            // The `,` of Flow's is behind the comments that trail the member.
            if (f.file().is_flow() && !self.is_interface) || separator_is_behind_comments(f) {
                write!(f, signature);
                return self.write_separator(f);
            }
        }

        // The separator is not part of the member. The comments that trail the member are behind it.
        write!(f, FormatNodeWithoutTrailingComments(&signature));
        self.write_separator(f);
        extend_node(signature.span(), f);
        write!(f, trailing_comments(node));
    }
}

impl<'a> FormatTSSignature<'a> {
    fn write_separator(&self, f: &mut Formatter<'a>) {
        // The types in a JavaScript file are Flow's.
        if f.file().is_javascript() {
            return match (self.is_interface, self.next_signature) {
                (true, _) => write!(f, ";"),
                (false, None) if super::flow::is_inexact_mark(self.signature) => {}
                (false, Some(_)) => write!(f, ","),
                (false, None) => write!(f, FormatTrailingCommas::ES5),
            };
        }
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
        if !matches!(signature.as_ast_nodes(), AstNodes::TSPropertySignature(_))
            || signature.ty().is_some()
        {
            return false;
        }
        // `get; a(): void`, `a; (): void`
        signature.key().is_some_and(|key| {
            matches!(key.kind(), KeyKind::Ident(_))
                && (key.is("static") || key.is("get") || key.is("set"))
        }) || self.next_signature.is_some_and(|next| {
            matches!(next.as_ast_nodes(), AstNodes::TSCallSignatureDeclaration(_))
        })
    }
}

/// A member of an interface or a type literal that is not an index signature.
pub(crate) fn write_ts_signature<'a>(member: Member<'a>, f: &mut Formatter<'a>) {
    if f.file().is_flow() {
        return super::flow::write_object_type_member(member, f);
    }
    let node = member.as_ast_nodes();
    match (node, member.func()) {
        (AstNodes::TSCallSignatureDeclaration(_), Some(func)) => {
            write_ts_call_signature_declaration(func, f)
        }
        (AstNodes::TSConstructSignatureDeclaration(_), Some(func)) => {
            write_ts_construct_signature_declaration(func, f)
        }
        (AstNodes::TSMethodSignature(_), Some(func)) => write_ts_method_signature(member, func, f),
        _ => {
            write!(
                f,
                member
                    .flags()
                    .contains(Flags::READONLY)
                    .then_some("readonly ")
            );
            if let Some(key) = member.key() {
                format_computed_or_property_key(key, node, f);
            }
            let Some(ty) = member.ty() else {
                return write!(f, member.flags().contains(Flags::OPTIONAL).then_some("?"));
            };
            write!(
                f,
                [member.flags().contains(Flags::OPTIONAL).then_some("?"), ":"]
            );
            write!(f, space());
            // `a: // comment ⏎ B` stays as it is for oxfmt. The comment dangles from the signature.
            if !f.is_quiet() && !union_writes_comments_behind_colon(without_lone_operator(ty), f) {
                let comments_behind_colon = f.comments().of_node(node).dangling;
                write!(f, FormatLeadingComments::Comments(comments_behind_colon));
            }
            write!(f, ty);
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
    if f.file().is_flow() && super::flow::write_declared_predicate(ty, expr, args, f) {
        return;
    }
    write!(f, "typeof ");
    write_qualified_name(expr, f);
    write!(f, type_arguments(args, Node::Type(ty)));
}

/// `a.b.c` after `typeof`. It is ESTree's `TSQualifiedName`, which does not break like a member expression.
fn write_qualified_name<'a>(name: Expr<'a>, f: &mut Formatter<'a>) {
    let ExprKind::Dot {
        obj: left,
        name: right,
        ..
    } = name.kind()
    else {
        return write!(f, name);
    };
    // Not by way of `Expr`.
    if !f.context_mut().has_stack_left() {
        return;
    }
    format_node(name.as_chain_element(), f, |f| {
        write_qualified_name(left, f);
        write!(f, [".", identifier(right)]);
    });
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
    let options = ty.import_attributes();
    let comments = match f.is_quiet() {
        true => ImportTypeComments::default(),
        false => ImportTypeComments::new(ty, source, options, f),
    };
    let format_source = comments.format_source(source);

    write!(
        f,
        [
            is_typeof.then_some("typeof "),
            FormatLeadingComments::Comments(comments.leading_import)
        ]
    );
    match options {
        Some(options) => {
            let arguments =
                format_with(|f| write_import_type_arguments(source, options, &comments, f));
            write!(f, group(&format_args!("import", arguments)));
        }
        // A long module name does not break.
        None if comments.leading_source.is_empty() && comments.trailing_source.is_empty() => {
            write!(f, ["import(", format_source, ")"])
        }
        None => write!(
            f,
            group(&format_args!(
                "import(",
                soft_block_indent(&format_source),
                ")"
            ))
        ),
    }

    if !name.is_empty() {
        write!(f, [".", entity_name(name)]);
    }
    write!(f, type_arguments(args, Node::Type(ty)));
}

/// The comments in `typeof import("a", { with: { .. } })`, by the ESTree node that Prettier attaches them to. Of those nodes only
/// the module specifier and the inner object can own comments here, so they also own the comments of the import type after
/// `typeof`, of the outer object and of its property.
#[derive(Default)]
struct ImportTypeComments<'a> {
    /// `typeof /* comment */ import("a")`
    leading_import: CommentList<'a>,
    leading_source: CommentList<'a>,
    trailing_source: CommentList<'a>,
    /// Before the `{` of `{ with: { .. } }`.
    leading_options: CommentList<'a>,
    /// Before `with`.
    leading_property: CommentList<'a>,
    /// Before the `{` of `{ .. }`: those that the module specifier owns, then those that the object owns.
    leading_attributes: [CommentList<'a>; 2],
    /// Before the `}` of `{ with: { .. } }`.
    trailing_property: CommentList<'a>,
    trailing_options: CommentList<'a>,
}

impl<'a> ImportTypeComments<'a> {
    fn new(
        ty: TypeNode<'a>,
        source: Span,
        options: Option<ImportAttributes<'a>>,
        f: &Formatter<'a>,
    ) -> Self {
        /// Splits off the comments at the start of `comments` whose next token starts at or before `token_start`.
        fn take_up_to<'a>(comments: &mut CommentList<'a>, token_start: u32) -> CommentList<'a> {
            let count = (comments.iter())
                .take_while(|comment| comment.next_token_start() <= token_start)
                .count();
            let (taken, rest) = comments.split_at(count);
            *comments = rest;
            taken
        }
        let of_source = f.comments().of_name(source.start);
        let end_of_typeof = ty.span().start + "typeof".len() as u32;
        let is_typeof = matches!(
            ty.kind(),
            TypeKind::Import {
                is_typeof: true,
                ..
            }
        );
        let behind_typeof = (of_source.leading.iter())
            .take_while(|comment| is_typeof && comment.prev_token_end() == end_of_typeof)
            .count();
        let (leading_import, leading_source) = of_source.leading.split_at(behind_typeof);
        let Some(options) = options else {
            return ImportTypeComments {
                leading_import,
                leading_source,
                trailing_source: of_source.trailing,
                ..ImportTypeComments::default()
            };
        };
        let outer = options.options_span();
        let of_attributes = f.comments().of_node(options.object().as_ast_nodes());
        let (mut behind_source, mut behind_attributes) =
            (of_source.trailing, of_attributes.trailing);
        ImportTypeComments {
            leading_import,
            leading_source,
            trailing_source: take_up_to(&mut behind_source, outer.start.saturating_sub(1)),
            leading_options: take_up_to(&mut behind_source, outer.start),
            leading_property: take_up_to(&mut behind_source, options.keyword_span().start),
            leading_attributes: [behind_source, of_attributes.leading],
            trailing_property: take_up_to(&mut behind_attributes, outer.end.saturating_sub(1)),
            trailing_options: behind_attributes,
        }
    }

    /// The module specifier at `source`, with its comments.
    fn format_source(&self, source: Span) -> impl Format<'a> {
        let (leading, trailing) = (self.leading_source, self.trailing_source);
        format_with(move |f: &mut Formatter<'a>| {
            let string = f.source_text().text_for(&source);
            write!(
                f,
                [
                    FormatLeadingComments::Comments(leading),
                    FormatLiteralStringToken::new(
                        string,
                        false,
                        StringLiteralParentKind::Expression
                    ),
                    FormatTrailingComments::Comments(trailing)
                ]
            );
        })
    }
}

/// ```ts
/// import("a", {          import(
///   with: { b: "c" },      "a",
/// })                       { with: { b: "c" } }
///                        )
/// ```
///
/// Prettier on the left: they are the last argument of a call. oxfmt on the right.
fn options_of_import_type_are_on_a_line_of_their_own(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

/// `("a", { with: { type: "json" } })`. Prettier's `printCallArguments` for a string and an object.
fn write_import_type_arguments<'a>(
    source: Span,
    options: ImportAttributes<'a>,
    comments: &ImportTypeComments<'a>,
    f: &mut Formatter<'a>,
) {
    let format_source = comments.format_source(source).memoized();
    let does_source_break = format_source.inspect(f).will_break();

    let has_comments =
        !(comments.leading_options.is_empty() && comments.trailing_options.is_empty());
    let format_options = format_with(|f| {
        write!(f, FormatLeadingComments::Comments(comments.leading_options));
        write_import_type_options(options, comments, f);
        write!(
            f,
            FormatTrailingComments::Comments(comments.trailing_options)
        );
    })
    .memoized();
    let do_options_break = format_options.inspect(f).will_break();

    let head = format_with(|f| write!(f, [format_source, ",", soft_line_break_or_space()]));
    let (head, format_options) = (&head, &format_options);
    let all_broken_out = |should_expand: bool| {
        format_with(move |f: &mut Formatter<'a>| {
            let arguments = format_args!(head, format_options);
            write!(
                f,
                group(&format_args!("(", soft_block_indent(&arguments), ")"))
                    .should_expand(should_expand)
            );
        })
    };
    if has_comments {
        return write!(f, all_broken_out(does_source_break || do_options_break));
    }
    if does_source_break {
        return write!(f, all_broken_out(true));
    }
    if !do_options_break && options_of_import_type_are_on_a_line_of_their_own(f) {
        return write!(
            f,
            best_fitting!(
                format_args!("(", head, format_options, ")"),
                all_broken_out(true)
            )
        );
    }
    let expanded_options = format_with(|f| {
        write!(
            f,
            ["(", head, group(format_options).should_expand(true), ")"]
        )
    });
    match do_options_break {
        true => write!(
            f,
            [
                expand_parent(),
                best_fitting!(expanded_options, all_broken_out(true))
            ]
        ),
        false => write!(
            f,
            best_fitting!(
                format_args!("(", head, format_options, ")"),
                expanded_options,
                all_broken_out(true)
            )
        ),
    }
}

/// `{ with: { type: "json" } }`. It is an object literal, of which the HIR has only the properties
/// of the inner one.
fn write_import_type_options<'a>(
    options: ImportAttributes<'a>,
    comments: &ImportTypeComments<'a>,
    f: &mut Formatter<'a>,
) {
    let (outer, keyword, inner) = (
        options.options_span(),
        options.keyword_span(),
        options.braces_span(),
    );
    let entries = options.entries();
    let is_expanded = |f: &Formatter<'a>, before_first: Span| {
        f.options().expand == Expand::Auto && f.source_text().contains_newline(before_first)
    };
    let has_space = f.options().bracket_spacing.value();

    let format_inner = format_with(|f| {
        for comments in comments.leading_attributes {
            write!(f, FormatLeadingComments::Comments(comments));
        }
        let Some(first) = entries.first() else {
            let attributes = options.object().as_ast_nodes();
            return write!(
                f,
                [
                    "{",
                    dangling_comments(attributes).with_soft_block_indent(),
                    "}"
                ]
            );
        };
        let format_entries = format_with(|f| {
            let trailing_separator = FormatTrailingCommas::ES5.trailing_separator(f.options());
            f.join_nodes_with_soft_line()
                .entries_with_trailing_separator(entries.iter(), ",", trailing_separator);
        });
        write!(
            f,
            group(&format_args!(
                "{",
                soft_block_indent_with_maybe_space(&format_entries, has_space),
                "}"
            ))
            .should_expand(is_expanded(f, Span::before(inner.start, first.span())))
        );
    });
    let format_property = format_with(|f| {
        write!(
            f,
            [
                FormatLeadingComments::Comments(comments.leading_property),
                source_text(keyword),
                ":",
                space(),
                format_inner,
                FormatTrailingComments::Comments(comments.trailing_property),
                FormatTrailingCommas::ES5
            ]
        );
    });
    write!(
        f,
        group(&format_args!(
            "{",
            soft_block_indent_with_maybe_space(&format_property, has_space),
            "}"
        ))
        .should_expand(is_expanded(f, Span::before(outer.start, keyword)))
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
    if f.file().is_flow() && super::flow::write_checks_predicate(ty, f) {
        return;
    }
    let parameter = ty.predicate_param().map(|it| identifier(it));
    write!(f, asserts.then(|| super::flow::predicate_prefix(ty)));
    let Some(type_annotation) = type_annotation else {
        return write!(f, parameter);
    };
    write!(
        f,
        [
            parameter,
            space(),
            "is",
            space(),
            FormatTypeOfPredicate(type_annotation)
        ]
    );
}
