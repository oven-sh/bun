//! The types that take only a few lines each, and the members of interfaces and type literals.

use super::function_type::{
    write_ts_call_signature_declaration, write_ts_construct_signature_declaration,
    write_ts_method_signature,
};
use super::import_declaration::FormatStringLiteral;
use super::object_like::ObjectLike;
use super::type_parameters::type_arguments;
use crate::cursor::extend_node;
use crate::js::format::{
    FormatTypeOfPredicate, identifier, no_comment_trails_what_is_before_another,
    write_trailing_comments_of,
};
use crate::js::utils::conditional::ConditionalLike;
use crate::js::utils::format_node_without_trailing_comments::FormatNodeWithoutTrailingComments;
use crate::js::utils::number::format_number_token;
use crate::js::utils::object::{format_computed_or_property_key, key_requires_quotes};
use crate::js::utils::string::{FormatLiteralStringToken, StringLiteralParentKind};
use crate::js::utils::suppressed::{FormatSuppressedNode, FormatTemplateText};
use crate::js::utils::typescript::{end_of_line_comments, without_lone_operator};
use crate::prelude::*;
use crate::{best_fitting, format_args, write};
use smallvec::SmallVec;
use std::cell::Cell;

/// `A.B.C`. `parent`: what it is a name in.
pub(crate) fn entity_name<'a>(name: EntityName<'a>, parent: AstNodes<'a>) -> impl Format<'a> {
    format_with(move |f: &mut Formatter<'a>| {
        if f.is_quiet() {
            f.join_with(".")
                .entries(name.parts().map(|part| identifier(part, parent)));
            return;
        }
        // The next name is what follows a name, which `parent` does not tell.
        let mut parts = name.parts().peekable();
        while let Some(part) = parts.next() {
            let part = identifier(part, parent);
            let Some(next) = parts.peek() else {
                return write!(f, part);
            };
            let comments = format_trailing_comments(name.span(), part.span(), next.span().start);
            write!(f, [FormatNodeWithoutTrailingComments(&part), comments, "."]);
        }
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
        && matches!(
            node,
            AstNodes::TSInterfaceHeritage(_) | AstNodes::TSClassImplements(_)
        )
    {
        return write!(
            f,
            [
                heritage_name(name, node),
                type_arguments(args, Node::Type(ty))
            ]
        );
    }
    if args.is_empty() && f.file().is_javascript() {
        // Flow's other name for it.
        if name.len() == 1 && ty.text() == b"bool" {
            return write!(f, "boolean");
        }
        // `A<>`
        if let Some(last) = name.get(name.len().wrapping_sub(1))
            && ty.text().ends_with(b">")
        {
            let brackets = Span::after(last.span(), ty.span().end);
            let has_line_comment = f
                .comments()
                .comments_in(brackets)
                .iter()
                .any(|it| it.is_line());
            match name.len() {
                1 => write!(
                    f,
                    FormatNodeWithoutTrailingComments(&identifier(last, node))
                ),
                _ => write!(f, entity_name(name, node)),
            }
            write!(f, "<");
            match has_line_comment {
                true => write!(f, format_dangling_comments(brackets).with_block_indent()),
                false => write!(f, format_dangling_comments(brackets)),
            }
            return write!(f, ">");
        }
    }
    let wrap =
        keeps_parentheses_of_intrinsic(f) && is_leftmost_intrinsic_in_type_alias(ty, name, args);
    write!(
        f,
        [
            wrap.then_some("("),
            entity_name(name, node),
            type_arguments(args, Node::Type(ty)),
            wrap.then_some(")")
        ]
    );
}

/// `A.B.C` after `extends` or `implements`. There it is a member expression in ESTree, which can
/// break before its dots (Prettier's `printMemberExpression`).
fn heritage_name<'a>(name: EntityName<'a>, parent: AstNodes<'a>) -> impl Format<'a> {
    format_with(move |f: &mut Formatter<'a>| {
        for (index, part) in name.parts().enumerate() {
            let part = identifier(part, parent);
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
            let comments = f.comments().comments_before(ty.span().end);
            let Some(last) = comments.last() else {
                return write!(f, ["-", format_digits(rest.trim_ascii_start())]);
            };
            let digits = f
                .source_text()
                .text_for(&Span::after(last.span, ty.span().end))
                .trim_ascii_start();
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
                write!(f, signature);
                // It is not part of a member of Flow's.
                if f.file().is_flow() {
                    self.write_separator(f);
                }
                return;
            }
            if f.comments().has_trailing_suppression_comment(span.end) {
                write!(
                    f,
                    [format_leading_comments(span), FormatSuppressedNode(span)]
                );
                return write_trailing_comments_of(signature.as_ast_nodes(), f);
            }
            // Prettier's `handleTSFunctionTrailingComments`: `a() /* comment */;`
            if matches!(signature.as_ast_nodes(), AstNodes::TSMethodSignature(_))
                && signature
                    .func()
                    .is_some_and(|func| func.return_type().is_none())
            {
                span = f.comments().without_semicolon(span);
            }
            // The `,` of Flow's is behind the comments that trail the member.
            if (f.file().is_flow() && !self.is_interface) || separator_is_behind_comments(f) {
                write!(f, signature);
                return self.write_separator(f);
            }
        }

        // The separator is not part of the member. The comments after the member are behind it.
        write!(
            f,
            FormatNodeWithoutTrailingComments(&FormatMemberIn(signature, span))
        );
        self.write_separator(f);
        extend_node(signature.span(), f);
        if !f.is_quiet()
            && !(self.next_signature.is_some() && no_comment_trails_what_is_before_another(f))
        {
            write_trailing_comments_of(signature.as_ast_nodes(), f);
        }
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
            // Prettier does not attach comments to the `: T` of a property signature, only to the
            // name and the type.
            if !f.is_quiet() {
                write!(
                    f,
                    FormatTrailingComments::Comments(comments_after_property_name(ty, f))
                );
            }
            write!(
                f,
                [
                    member.flags().contains(Flags::OPTIONAL).then_some("?"),
                    ":",
                    space(),
                    ty
                ]
            );
            write_trailing_comments_of(AstNodes::TSTypeAnnotation(ty), f);
        }
    }
}

/// `a: // comment ⏎ B;` stays as it is for oxfmt. For Prettier it is `a: B; // comment`.
fn comments_behind_colon_of_property_signature_stay(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

/// Of the comments between the name of a property signature and its type `ty`, those that trail
/// the name: those on its line that are before the `:`, or at the end of the line, unless a union
/// or an intersection follows (Prettier's `handlePropertySignatureComments`).
fn comments_after_property_name<'a>(ty: TypeNode<'a>, f: &Formatter<'a>) -> &'a [Comment] {
    let comments = f.comments().comments_before(ty.span().start);
    let colon = ty.annotation_span().start;
    let before_colon = comments
        .iter()
        .take_while(|comment| comment.span.start < colon && !comment.preceded_by_newline())
        .count();
    let (_, rest) = comments.split_at(before_colon);
    let takes_comments = comments_behind_colon_of_property_signature_stay(f)
        || matches!(
            without_lone_operator(ty).kind(),
            TypeKind::Union(_) | TypeKind::Intersection(_)
        );
    match takes_comments {
        true => &comments[..before_colon],
        false => &comments[..before_colon + end_of_line_comments(rest).len()],
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
    // The name is ESTree's `TSQualifiedName`, which does not break like a member expression.
    let mut names: SmallVec<[Ident<'a>; 4]> = SmallVec::new();
    let mut leftmost = expr;
    while let ExprKind::Dot { obj, name, .. } = leftmost.kind() {
        names.push(name);
        leftmost = obj;
    }
    write!(f, ["typeof ", leftmost]);
    for &name in names.iter().rev() {
        write!(f, [".", identifier(name, AstNodes::TSTypeQuery(ty))]);
    }
    write!(f, type_arguments(args, Node::Type(ty)));
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

    // Up to what follows the `)`, they lead or trail the module specifier.
    let has_comment = !f.is_quiet() && {
        let following = name
            .first()
            .map(|it| it.span())
            .or_else(|| args.angle_brackets_span());
        let span = ty.span();
        f.comments()
            .has_comment_in_range(span.start, following.map_or(span.end, |it| it.start))
    };

    write!(f, is_typeof.then_some("typeof "));
    match ty.import_attributes() {
        Some(options) => {
            let arguments = format_with(|f| write_import_type_arguments(ty, source, options, f));
            write!(f, group(&format_args!("import", arguments)));
        }
        // A long module name does not break.
        None if !has_comment => write!(f, ["import(", format_source, ")"]),
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
        write!(f, [".", entity_name(name, node)]);
    }
    write!(f, type_arguments(args, Node::Type(ty)));
}

/// The module specifier in `import("a")` or `require("a")`. Only the comments before the `)` trail it.
pub(crate) struct FormatModuleSpecifier<'a> {
    pub(crate) span: Span,
    pub(crate) parent: AstNodes<'a>,
    /// From `import` or `require` to the `)`.
    pub(crate) call_span: Span,
}

struct FormatModuleSpecifierWithoutComments<'a>(Span, AstNodes<'a>);

impl Spanned for FormatModuleSpecifierWithoutComments<'_> {
    fn span(&self) -> Span {
        self.0
    }
}

impl<'a> Format<'a> for FormatModuleSpecifierWithoutComments<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        FormatStringLiteral {
            span: self.0,
            parent: self.1,
        }
        .fmt(f);
    }
}

impl<'a> Format<'a> for FormatModuleSpecifier<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let specifier = FormatModuleSpecifierWithoutComments(self.span, self.parent);
        write!(
            f,
            [
                FormatNodeWithoutTrailingComments(&specifier),
                format_trailing_comments(self.call_span, self.span, 0)
            ]
        );
    }
}

/// `("a", { with: { type: "json" } })`. Prettier's `printCallArguments` for a string and an object.
fn write_import_type_arguments<'a>(
    ty: TypeNode<'a>,
    source: Span,
    options: ImportAttributes<'a>,
    f: &mut Formatter<'a>,
) {
    let span = options.options_span();
    let format_source = format_with(|f| {
        let source = FormatModuleSpecifierWithoutComments(source, AstNodes::TSImportType(ty));
        write!(
            f,
            [
                FormatNodeWithoutTrailingComments(&source),
                format_trailing_comments(ty.span(), source.span(), span.start)
            ]
        );
    })
    .memoized();
    let does_source_break = format_source.inspect(f).will_break();

    let has_comments = Cell::new(f.comments().has_comment_before(span.start));
    let format_options = format_with(|f| {
        write!(f, format_leading_comments(span));
        write_import_type_options(options, f);
        let comments = f.comments().comments_before_character(span.end, b')');
        has_comments.set(has_comments.get() || !comments.is_empty());
        write!(f, FormatTrailingComments::Comments(comments));
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
    if has_comments.get() {
        return write!(f, all_broken_out(does_source_break || do_options_break));
    }
    if does_source_break {
        return write!(f, all_broken_out(true));
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
fn write_import_type_options<'a>(options: ImportAttributes<'a>, f: &mut Formatter<'a>) {
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
        write!(f, format_leading_comments(inner));
        let Some(first) = entries.first() else {
            return write!(
                f,
                [
                    "{",
                    format_dangling_comments(inner).with_soft_block_indent(),
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
                format_leading_comments(keyword),
                source_text(keyword),
                ":",
                space(),
                format_inner
            ]
        );
        let comments = f.comments().comments_before(outer.end.saturating_sub(1));
        write!(
            f,
            [
                FormatTrailingComments::Comments(comments),
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
    let parameter = ty
        .predicate_param()
        .map(|it| identifier(it, AstNodes::TSTypePredicate(ty)));
    write!(f, asserts.then(|| super::flow::predicate_prefix(ty)));
    let Some(type_annotation) = type_annotation else {
        return write!(f, parameter);
    };
    write!(f, parameter.as_ref().map(FormatNodeWithoutTrailingComments));
    if let Some(parameter) = parameter {
        write!(
            f,
            format_trailing_comments(ty.span(), parameter.span(), type_annotation.span().start)
        );
    }
    write!(
        f,
        [
            space(),
            "is",
            space(),
            FormatTypeOfPredicate(type_annotation)
        ]
    );
}
