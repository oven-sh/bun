//! The types that take only a few lines each, and the members of interfaces and type literals.

use super::function_type::{
    write_ts_call_signature_declaration, write_ts_construct_signature_declaration,
    write_ts_method_signature,
};
use super::object_like::ObjectLike;
use super::type_parameters::{FormatDanglingCommentsForInline, type_arguments};
use super::union_type::union_prints_comments_after_colon;
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
    // Fast path: which node this is only matters for a long name and for comments.
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
        // Flow's other name for `boolean`.
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

/// oxfmt prints `A.B.C` after `extends` or `implements` like any other name, on one line.
fn heritage_name_breaks_before_its_dots(f: &Formatter<'_>) -> bool {
    !f.options().flavor.is_oxfmt()
}

/// `A.B.C` after `extends` or `implements`. ESTree has a member expression there, which can break before its dots
/// (Prettier's `printMemberExpression`).
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

/// oxfmt keeps the parentheses of `type A = (intrinsic)`. Prettier drops them, which changes the meaning.
fn keeps_parentheses_of_intrinsic(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

/// `type A = (intrinsic)` refers to a type with that name. Without the parentheses it's the keyword.
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

/// A type literal's members, with their separators.
pub(crate) fn write_ts_signatures<'a>(members: List<'a, Member<'a>>, f: &mut Formatter<'a>) {
    write_signatures(members, false, f);
}

/// An interface's members, with their separators.
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

    let (is_flow, text) = (f.file().is_flow(), f.source_text().as_bytes());
    let mut joiner = f.join_nodes_with_soft_line();
    let mut iter = members.iter().peekable();
    let mut previous: Option<Member<'a>> = None;
    while let Some(signature) = iter.next() {
        let content = FormatTSSignature {
            signature,
            next_signature: iter.peek().copied(),
            is_interface,
        };
        // `a: 1⏎⏎// comment⏎; b: 2`: a Flow member ends before its separator, and Prettier's `isNextLineEmpty` starts
        // there.
        let is_after_empty_line = is_flow
            && previous.replace(signature).is_some_and(|previous| {
                crate::text::is_next_line_empty(text, previous.span().end as usize)
            });
        // Prettier has no node for the `...`. A comment before it trails the previous member.
        match super::flow::is_inexact_mark(signature) {
            true => joiner.entry_without_empty_line(&content),
            false if is_after_empty_line => joiner.entry_after_empty_line(&content),
            false => joiner.entry(signature.span(), &content),
        }
    }

    if is_consistent {
        f.context_mut().pop_quote_needed();
    }
}

/// oxfmt prints `a: string; /* comment */` as `a: string /* comment */;`.
fn separator_goes_after_comments(f: &Formatter<'_>) -> bool {
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
                // In Flow the separator isn't part of the member. In an interface or a declared class Prettier doesn't
                // print one after an ignored member, which is a syntax error before another member.
                if f.file().is_flow() && !(self.is_interface && self.next_signature.is_none()) {
                    self.write_separator(f);
                }
                return;
            }
            // Flow's `,` goes after the member's trailing comments.
            if (f.file().is_flow() && !self.is_interface) || separator_goes_after_comments(f) {
                write!(f, signature);
                return self.write_separator(f);
            }
        }

        // The separator isn't part of the member. The member's trailing comments go after it.
        write!(f, FormatNodeWithoutTrailingComments(&signature));
        self.write_separator(f);
        extend_node(signature.span(), f);
        write!(f, trailing_comments(node));
    }
}

impl<'a> FormatTSSignature<'a> {
    fn write_separator(&self, f: &mut Formatter<'a>) {
        // Types in a JavaScript file are Flow's.
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

    /// Prettier's `shouldPrintSemicolonAfterInterfaceProperty`: without the `;`, what follows would be parsed as the
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

/// A member of an interface or a type literal, other than an index signature.
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
            write!(f, member.flags().contains(Flags::OPTIONAL).then_some("?"));
            // oxfmt prints `a?/* comment */ : B`. In Prettier the `: B` has no comments, and a comment before the `:`
            // can lead `B`. So the `: B` node isn't entered: inside it, nothing would look for a comment that comes
            // before it.
            if !f.is_quiet() {
                let type_annotation = AstNodes::TSTypeAnnotation(ty);
                let owned = f.comments().of_node(type_annotation);
                if owned.is_ignored {
                    format_node(type_annotation, f, |_| {});
                    // `B` is copied, not printed, and these come after the copied text.
                    return write!(
                        f,
                        trailing_comments(without_lone_operator(ty).as_ast_nodes())
                    );
                }
                write!(f, FormatLeadingComments::Comments(owned.leading));
            }
            write!(f, [":", space()]);
            // oxfmt leaves `a: // comment ⏎ B` as is. The comment dangles from the signature.
            if !f.is_quiet() && !union_prints_comments_after_colon(without_lone_operator(ty), f) {
                let comments_after_colon = f.comments().of_node(node).dangling;
                write!(f, FormatLeadingComments::Comments(comments_after_colon));
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
    if f.file().is_flow() && super::flow::write_declared_predicate(ty, f) {
        return;
    }
    write!(f, "typeof ");
    write_qualified_name(expr, f);
    write!(f, type_arguments(args, Node::Type(ty)));
}

/// `a.b.c` after `typeof`. It's ESTree's `TSQualifiedName`, which doesn't break like a member expression.
fn write_qualified_name<'a>(name: Expr<'a>, f: &mut Formatter<'a>) {
    let ExprKind::Dot {
        obj: left,
        name: right,
        ..
    } = name.kind()
    else {
        return write!(f, name);
    };
    // It isn't printed through `Expr`, so the stack check has to happen here.
    if !f.context_mut().has_stack_left() {
        return;
    }
    format_node(name.as_chain_element(), f, |f| {
        write_qualified_name(left, f);
        write!(f, [".", identifier(right)]);
    });
}

/// `import("a").B<C>`, `typeof import("a")`
#[inline(never)]
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
    if let Some(import) = ty.import_span()
        && has_ignore_comment(&[comments.leading_import], CommentList::empty(), f)
    {
        return write!(f, FormatSuppressedNode(import));
    }
    match options {
        Some(options) => {
            let arguments =
                format_with(|f| write_import_type_arguments(source, options, &comments, f));
            write!(f, group(&format_args!("import", arguments)));
        }
        // A long module name doesn't break.
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

/// The comments in `typeof import("a", { with: { .. } })`, by the ESTree node that Prettier attaches them to. Of those
/// nodes, only the module specifier and the inner object can own comments here, so they also own the comments of the
/// import type after `typeof`, of the outer object and of its property.
#[derive(Default)]
struct ImportTypeComments<'a> {
    /// `typeof /* comment */ import("a")`
    leading_import: CommentList<'a>,
    leading_source: CommentList<'a>,
    trailing_source: CommentList<'a>,
    /// Before the `{` of `{ with: { .. } }`: first the comments the module specifier owns, then the ones the inner
    /// object owns.
    leading_options: [CommentList<'a>; 2],
    /// Before `with`: first the comments the module specifier owns, then the ones the inner object owns.
    leading_property: [CommentList<'a>; 2],
    /// `with // comment ⏎: { .. }`. Prettier's `handlePropertyComments` makes it lead the property.
    at_end_of_line_before_colon: CommentList<'a>,
    /// `with: // comment ⏎ { .. }`. Same as above.
    at_end_of_line_after_colon: CommentList<'a>,
    /// `with /* comment */: { .. }`
    trailing_keyword: CommentList<'a>,
    /// Before the `{` of `{ .. }`.
    leading_attributes: CommentList<'a>,
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
            let (front, rest) = comments.split_at(count);
            *comments = rest;
            front
        }
        let source_comments = f.comments().of_name(source.start);
        let end_of_typeof = ty.span().start + "typeof".len() as u32;
        let is_typeof = matches!(
            ty.kind(),
            TypeKind::Import {
                is_typeof: true,
                ..
            }
        );
        let after_typeof = (source_comments.leading.iter())
            .take_while(|comment| is_typeof && comment.prev_token_end() == end_of_typeof)
            .count();
        let (leading_import, leading_source) = source_comments.leading.split_at(after_typeof);
        let Some(options) = options else {
            return ImportTypeComments {
                leading_import,
                leading_source,
                trailing_source: source_comments.trailing,
                ..ImportTypeComments::default()
            };
        };
        let outer = options.options_span();
        let attribute_comments = f.comments().of_node(options.object().as_ast_nodes());
        let (mut after_source, mut before_attributes, mut after_attributes) = (
            source_comments.trailing,
            attribute_comments.leading,
            attribute_comments.trailing,
        );
        // `"a" /* 1 */, // 2 ⏎ { .. }`: before the `,`, or after it up to the end of its line.
        let before_comma = take_up_to(&mut after_source, outer.start.saturating_sub(1));
        let (on_line_of_comma, after_comma) =
            take_up_to(&mut after_source, outer.start).split_at_end_of_line();
        let (keyword, attributes) = (options.keyword_span().start, options.braces_span().start);
        let leading_options = [after_comma, take_up_to(&mut before_attributes, outer.start)];
        let leading_property = [
            take_up_to(&mut after_source, keyword),
            take_up_to(&mut before_attributes, keyword),
        ];
        let (at_end_of_line_before_colon, trailing_keyword) =
            take_up_to(&mut after_source, attributes.saturating_sub(1)).split_at_end_of_line();
        ImportTypeComments {
            leading_import,
            leading_source,
            trailing_source: (source_comments.trailing)
                .slice(0, before_comma.len() + on_line_of_comma.len()),
            leading_options,
            leading_property,
            at_end_of_line_before_colon,
            at_end_of_line_after_colon: after_source,
            trailing_keyword,
            leading_attributes: before_attributes,
            trailing_property: take_up_to(&mut after_attributes, outer.end.saturating_sub(1)),
            trailing_options: after_attributes,
        }
    }

    /// The module specifier at `source`, with its comments.
    fn format_source(&self, source: Span) -> impl Format<'a> {
        let (leading, trailing) = (self.leading_source, self.trailing_source);
        format_with(move |f: &mut Formatter<'a>| {
            write!(f, FormatLeadingComments::Comments(leading));
            let is_ignored = has_ignore_comment(&[leading], trailing, f);
            f.track_cursor(source, |f| match is_ignored {
                true => write!(f, FormatSuppressedNode(source)),
                false => write!(
                    f,
                    FormatLiteralStringToken::new(
                        f.source_text().text_for(&source),
                        false,
                        StringLiteralParentKind::Expression
                    )
                ),
            });
            write!(f, FormatTrailingComments::Comments(trailing));
        })
    }
}

/// oxfmt prints `import('a' /* prettier-ignore */)` as `import("a" /* prettier-ignore */)`: a `prettier-ignore` comment
/// after a node applies to it only if it ends its line. In Prettier every comment of a node counts.
fn trailing_ignore_comment_has_to_end_its_line(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

/// True if a `prettier-ignore` comment applies to the ESTree node with the comments `leading` and `trailing`.
fn has_ignore_comment<'a>(
    leading: &[CommentList<'a>],
    trailing: CommentList<'a>,
    f: &Formatter<'a>,
) -> bool {
    let is_ignore_comment = |comment: Comment<'a>| f.comments().is_suppression_comment(comment);
    leading.iter().any(|it| it.iter().any(is_ignore_comment))
        || trailing.iter().any(|comment| {
            is_ignore_comment(comment)
                && (comment.has_newline_after() || !trailing_ignore_comment_has_to_end_its_line(f))
        })
}

/// ```ts
/// import("a", {          import(
///   with: { b: "c" },      "a",
/// })                       { with: { b: "c" } }
///                        )
/// ```
///
/// Prettier is on the left: the options are the last argument of a call. oxfmt is on the right.
fn import_type_options_get_their_own_line(f: &Formatter<'_>) -> bool {
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

    let has_comments = !(comments.leading_options.iter().all(|it| it.is_empty())
        && comments.trailing_options.is_empty());
    let format_options = format_with(|f| {
        for comments in comments.leading_options {
            write!(f, FormatLeadingComments::Comments(comments));
        }
        match has_ignore_comment(&comments.leading_options, comments.trailing_options, f) {
            true => write!(f, FormatSuppressedNode(options.options_span())),
            false => write_import_type_options(options, comments, f),
        }
        write!(
            f,
            FormatTrailingComments::Comments(comments.trailing_options)
        );
    })
    .memoized();
    let do_options_break = format_options.inspect(f).will_break();

    let first_comment = comments.leading_options.into_iter().flatten().next();
    let has_empty_line = f.source_text().get_lines_before(
        options.options_span(),
        first_comment.map(|comment| comment.span()),
        true,
    ) > 1;
    let head = format_with(|f| match has_empty_line {
        true => write!(f, [format_source, ",", empty_line()]),
        false => write!(f, [format_source, ",", soft_line_break_or_space()]),
    });
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
    if does_source_break || has_empty_line {
        return write!(f, all_broken_out(true));
    }
    if !do_options_break && import_type_options_get_their_own_line(f) {
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

/// ```ts
/// type A = import("a", {          type A = import("a", {
///   with: // comment                // comment
///     { type: "json" },             with: { type: "json" },
/// });                             });
/// ```
///
/// oxfmt is on the left, Prettier on the right.
fn comments_at_end_of_line_stay_after_colon(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

/// `{ with: { type: "json" } }`. It's an object literal, but the HIR only has the inner object's properties.
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

    let attributes = options.object().as_ast_nodes();
    let format_inner = format_with(|f| {
        write!(
            f,
            FormatLeadingComments::Comments(comments.leading_attributes)
        );
        if has_ignore_comment(&[comments.leading_attributes], CommentList::empty(), f) {
            return write!(f, FormatSuppressedNode(inner));
        }
        let Some(first) = entries.first() else {
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
            .stays_expanded(f.options().expand == Expand::Auto)
        );
    });
    let format_property = format_with(|f| {
        for comments in comments.leading_property {
            write!(f, FormatLeadingComments::Comments(comments));
        }
        if has_ignore_comment(&comments.leading_property, comments.trailing_property, f) {
            return write!(
                f,
                [
                    FormatSuppressedNode(keyword.to(inner)),
                    FormatTrailingComments::Comments(comments.trailing_property),
                    FormatTrailingCommas::ES5
                ]
            );
        }
        let at_end_of_line = [
            comments.at_end_of_line_before_colon,
            comments.at_end_of_line_after_colon,
        ];
        let stay_after_colon = comments_at_end_of_line_stay_after_colon(f);
        if !stay_after_colon {
            for comments in at_end_of_line {
                write!(f, FormatLeadingComments::Comments(comments));
            }
        }
        write!(
            f,
            [
                source_text(keyword),
                FormatTrailingComments::Comments(comments.trailing_keyword),
                ":"
            ]
        );
        if stay_after_colon {
            for comments in at_end_of_line {
                write!(f, FormatTrailingComments::Comments(comments));
            }
        }
        // Prettier's `printAssignment` layout `break-after-operator`.
        let breaks_after_colon = (comments.leading_attributes.iter())
            .any(|comment| comment.has_newline_after() || comment.is_indentable_block())
            || (stay_after_colon && at_end_of_line.iter().any(|it| !it.is_empty()));
        match breaks_after_colon {
            true => write!(
                f,
                group(&indent(&format_args!(
                    soft_line_break_or_space(),
                    format_inner
                )))
                .should_expand(stay_after_colon)
            ),
            false => write!(f, [space(), format_inner]),
        }
        write!(
            f,
            [
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
        .stays_expanded(f.options().expand == Expand::Auto)
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
