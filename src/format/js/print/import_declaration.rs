use super::program::is_next_line_empty;
use super::semicolon::OptionalSemicolon;
use crate::js::format::{format_name, identifier};
use crate::js::utils::object::FormatKey;
use crate::js::utils::string::{
    FormatLiteralStringToken, StringLiteralParentKind, is_name_without_quotes,
};
use crate::prelude::*;
use crate::{format_args, write};

/// A string literal that is not an expression here: a module specifier.
pub(crate) struct FormatStringLiteral {
    pub(crate) span: Span,
}

impl<'a> Format<'a> for FormatStringLiteral {
    fn fmt(&self, f: &mut Formatter<'a>) {
        format_name(self.span, f, |f| {
            let string = f.source_text().text_for(&self.span);
            write!(
                f,
                FormatLiteralStringToken::new(string, false, StringLiteralParentKind::Expression)
            );
        });
    }
}

/// ESTree's `ModuleExportName`: `a`, or `"a"`.
pub(crate) fn module_export_name<'a>(name: Ident<'a>) -> impl Format<'a> {
    format_with(move |f: &mut Formatter<'a>| match name.is_string() {
        true => FormatStringLiteral { span: name.span() }.fmt(f),
        false => identifier(name).fmt(f),
    })
}

/// `"source" with { type: "json" }` of the import or export `statement`.
pub(crate) fn format_import_and_export_source_with_clause<'a>(
    statement: Stmt<'a>,
    f: &mut Formatter<'a>,
) {
    let Some(span) = statement.module_specifier_span() else {
        return;
    };
    let source = FormatStringLiteral { span };
    let Some(with_clause) = statement.import_attributes() else {
        return write!(f, source);
    };
    if f.is_quiet() {
        write!(f, source);
        return write_with_clause(with_clause, f);
    }

    let previous_limit = f.comments_mut().limit_comments_up_to(span.end);
    write!(f, source);
    f.comments_mut().restore_view_limit(previous_limit);

    // Without attributes all comments trail the source. Otherwise, of the comments before the
    // first attribute that do not start their line, those before the `{` and those that end their
    // line. The others lead the attribute.
    let braces = with_clause.braces_span();
    let comments = match with_clause.entries().first() {
        None => f.comments().comments_before(braces.end),
        Some(first) => {
            let comments = f.comments().comments_before(first.span().start);
            let count = comments
                .iter()
                .take_while(|comment| !comment.has_newline_before())
                .enumerate()
                .filter(|(_, comment)| {
                    comment.span().end <= braces.start || comment.has_newline_after()
                })
                .last()
                .map_or(0, |(index, _)| index + 1);
            comments.slice(0, count)
        }
    };
    write!(f, FormatTrailingComments::Comments(comments));
    write_with_clause(with_clause, f);
}

pub(crate) fn write_import_declaration<'a>(
    statement: Stmt<'a>,
    import: Import<'a>,
    f: &mut Formatter<'a>,
) {
    write!(f, "import ");
    if let Some(phase) = import.phase() {
        write!(f, [phase, space()]);
    } else if import.is_type_only() {
        write!(f, super::flow::import_kind(import.clause_span().start, f));
    }
    if !import.is_side_effect() {
        write_import_specifiers(statement, import, f);
        write!(f, " from ");
    }
    format_import_and_export_source_with_clause(statement, f);
    write!(f, OptionalSemicolon);
}

/// `a, * as b`, `a, { b, c }`
fn write_import_specifiers<'a>(statement: Stmt<'a>, import: Import<'a>, f: &mut Formatter<'a>) {
    let named = import.named();
    // `import a, {} from "a"` is `import a from "a"`.
    let has_braces = import.has_named_imports()
        && !(named.is_empty() && (import.default().is_some() || import.namespace().is_some()));

    if let Some(default) = import.default() {
        write!(f, identifier(default));
        if import.namespace().is_none() && !has_braces {
            return;
        }
        write!(f, [",", space()]);
    }
    if let (Some(namespace), Some(span)) = (import.namespace(), import.namespace_span()) {
        format_name(span, f, |f| {
            write!(f, ["*", space(), "as", space(), identifier(namespace)])
        });
        if !has_braces {
            return;
        }
        write!(f, [",", space()]);
    }

    let should_insert_space_around_brackets = f.options().bracket_spacing.value();
    let is_only_specifier =
        named.len() == 1 && import.default().is_none() && import.namespace().is_none();

    match named.first() {
        None => write!(f, "{}"),
        Some(only)
            if is_only_specifier && !only_specifier_has_comments(statement, only.span(), f) =>
        {
            write!(
                f,
                [
                    "{",
                    maybe_space(should_insert_space_around_brackets),
                    only,
                    maybe_space(should_insert_space_around_brackets),
                    "}",
                ]
            )
        }
        Some(_) => write!(f, ["{", FormatSpecifiers(statement, named), "}"]),
    }
}

/// Whether a comment belongs to `specifier`, the only one of the import or export `statement`. One
/// inside of it does if it starts or ends its line, otherwise it belongs to a name.
pub(crate) fn only_specifier_has_comments<'a>(
    statement: Stmt<'a>,
    specifier: Span,
    f: &Formatter<'a>,
) -> bool {
    !f.is_quiet()
        && (f
            .comments()
            .comments_before_character(statement.span().start, b'}')
            .iter()
            .any(|comment| {
                !specifier.contains(comment.span())
                    || comment.has_newline_before()
                    || comment.has_newline_after()
            })
            || !comments_before_from(specifier.end, statement, f).is_empty())
}

/// `{ a } /* comment */ from "a"`: of the comments that are not printed yet between `position`,
/// where the last specifier of `statement` ends, and the source, those that trail the specifier:
/// the ones that end their line, and the ones before the `from` that do not start their line.
fn comments_before_from<'a>(
    mut position: u32,
    statement: Stmt<'a>,
    f: &Formatter<'a>,
) -> CommentList<'a> {
    let Some(source) = statement.module_specifier_span() else {
        return CommentList::empty();
    };
    let comments = f.comments().comments_in(Span::before(position, source));
    let mut is_before_from = true;
    let count = comments
        .iter()
        .take_while(|comment| {
            let gap = f
                .source_text()
                .text_for(&Span::before(position, comment.span()));
            position = comment.span().end;
            is_before_from &= !bun_core::strings::contains(gap, b"from");
            comment.has_newline_after() || (is_before_from && !comment.has_newline_before())
        })
        .count();
    comments.slice(0, count)
}

/// The specifiers between the braces of the import or export in the first field.
pub(crate) struct FormatSpecifiers<'a, T>(pub(crate) Stmt<'a>, pub(crate) List<'a, T>);

impl<'a, T: Handle<'a> + Format<'a> + Spanned> Format<'a> for FormatSpecifiers<'a, T> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let FormatSpecifiers(statement, specifiers) = *self;
        let format_specifiers = format_with(|f| {
            let trailing_separator = FormatTrailingCommas::ES5.trailing_separator(f.options());
            let iter = specifiers
                .iter()
                .enumerate()
                .map(|(index, specifier)| FormatSpecifier {
                    specifier,
                    statement,
                    next_start: specifiers.get(index + 1).map(|next| next.span().start),
                });
            f.join_with(soft_line_break_or_space()).entries(
                FormatSeparatedIter::new(iter, ",").with_trailing_separator(trailing_separator),
            );
        });
        let needs_space = f.options().bracket_spacing.value();
        write!(
            f,
            group(&soft_block_indent_with_maybe_space(
                &format_specifiers,
                needs_space
            ))
        );
    }
}

/// `import {⏎⏎// comment⏎a } from "b"`: oxfmt keeps the empty line, also behind the `{`.
fn empty_line_before_comments_of_specifier_stays(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

struct FormatSpecifier<'a, T> {
    specifier: T,
    /// The import or export.
    statement: Stmt<'a>,
    /// Where the next specifier starts.
    next_start: Option<u32>,
}

impl<T: Spanned> Spanned for FormatSpecifier<'_, T> {
    fn span(&self) -> Span {
        self.specifier.span()
    }
}

impl<'a, T: Format<'a> + Spanned> Format<'a> for FormatSpecifier<'a, T> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        if f.is_quiet() {
            return write!(f, self.specifier);
        }
        // What leads the source is hidden from the last specifier.
        let end = self.specifier.span().end;
        let source = self
            .statement
            .module_specifier_span()
            .filter(|_| self.next_start.is_none());
        let limit = source.and_then(|source| {
            let is_leading = |it: &Comment<'_>| it.has_newline_before() && !it.has_newline_after();
            Some(
                f.comments()
                    .comments_in(self.specifier.span().between(source))
                    .iter()
                    .find(is_leading)?
                    .span()
                    .start,
            )
        });
        let previous_limit = limit.map(|limit| f.comments_mut().limit_comments_up_to(limit));
        if empty_line_before_comments_of_specifier_stays(f)
            && f.comments().has_comment_before(self.specifier.span().start)
            && f.lines_before(self.specifier.span()) > 1
        {
            write!(f, empty_line());
        }
        write!(f, self.specifier);
        if let Some(previous_limit) = previous_limit {
            f.comments_mut().restore_view_limit(previous_limit);
        }

        // Prettier's `handleModuleSpecifiersComments`: a comment after a specifier that ends its
        // line trails the specifier, also if it is on a line of its own.
        let comments = match self.next_start {
            Some(next_start) => {
                let comments = f.comments().comments_before(next_start);
                let count = comments
                    .iter()
                    .rposition(|it| it.has_newline_after())
                    .map_or(0, |last| last + 1);
                comments.slice(0, count)
            }
            None => comments_before_from(end, self.statement, f),
        };
        write!(f, FormatTrailingComments::Comments(comments));
    }
}

/// Prettier's `handleModuleSpecifiersComments`: a comment in the specifier at this span that starts
/// or ends its line goes before the specifier.
pub(crate) struct FormatCommentsInSpecifier(pub(crate) Span);

impl<'a> Format<'a> for FormatCommentsInSpecifier {
    fn fmt(&self, f: &mut Formatter<'a>) {
        if f.is_quiet() {
            return;
        }
        let comments = f.comments().comments_before(self.0.end);
        let count = comments
            .iter()
            .rposition(|it| it.has_newline_before() || it.has_newline_after());
        let comments = comments.slice(0, count.map_or(0, |last| last + 1));
        write!(f, FormatLeadingComments::Comments(comments));
    }
}

/// `a`, `a as b`, `type a`
pub(crate) fn write_import_specifier<'a>(specifier: ImportSpec<'a>, f: &mut Formatter<'a>) {
    let kind = specifier
        .is_type_only()
        .then(|| super::flow::import_kind(specifier.span().start, f));
    write!(f, [FormatCommentsInSpecifier(specifier.span()), kind]);
    let local = identifier(specifier.local());
    match specifier.is_renamed() {
        true => write!(
            f,
            [
                module_export_name(specifier.imported()),
                space(),
                "as",
                space(),
                local
            ]
        ),
        false => write!(f, local),
    }
}

/// ` with { type: "json" }`
fn write_with_clause<'a>(with_clause: ImportAttributes<'a>, f: &mut Formatter<'a>) {
    let entries = with_clause.entries();
    let is_consistent = f.options().quote_properties.is_consistent();
    if is_consistent {
        let quote_needed = entries.iter().any(|attribute| {
            attribute.key().is_some_and(|key| {
                matches!(key.kind(), KeyKind::String(_))
                    && !is_name_without_quotes(
                        f.source_text().text_for(&key.span(f.file()).shrink(1, 1)),
                        f.options().flavor,
                    )
            })
        });
        f.context_mut().push_quote_needed(quote_needed);
    }

    write!(
        f,
        [space(), source_text(with_clause.keyword_span()), space()]
    );
    write_import_attributes(entries, with_clause.braces_span(), f);

    if is_consistent {
        f.context_mut().pop_quote_needed();
    }
}

/// Prettier's `printObject` for import attributes. `braces`: the `{ .. }`.
fn write_import_attributes<'a>(entries: List<'a, Prop<'a>>, braces: Span, f: &mut Formatter<'a>) {
    let Some(first) = entries.first() else {
        return write!(f, "{}");
    };
    let attribute_at = |index: usize, attribute: Prop<'a>| FormatImportAttribute {
        attribute,
        braces,
        next_start: entries.get(index + 1).map_or(0, |next| next.span().start),
    };
    let needs_space = f.options().bracket_spacing.value();

    // Prettier's `isSingleTypeImportAttributes`
    let is_type = first.key().is_some_and(|key| key.is("type"))
        && first
            .value()
            .is_some_and(|value| value.tag() == ExprTag::String);
    if entries.len() == 1 && is_type && !f.comments().has_comment_before(braces.end) {
        return write!(
            f,
            [
                "{",
                maybe_space(needs_space),
                attribute_at(0, first),
                maybe_space(needs_space),
                "}"
            ]
        );
    }

    let format_attributes = format_with(|f| {
        let trailing_separator = FormatTrailingCommas::ES5.trailing_separator(f.options());
        let attributes = entries
            .iter()
            .enumerate()
            .map(|(index, attribute)| attribute_at(index, attribute));
        let mut previous_end = None;
        for attribute in
            FormatSeparatedIter::new(attributes, ",").with_trailing_separator(trailing_separator)
        {
            match previous_end {
                Some(end) if is_next_line_empty(f.source_text(), end) => write!(f, empty_line()),
                Some(_) => write!(f, soft_line_break_or_space()),
                None => {}
            }
            previous_end = Some(attribute.span().end);
            write!(f, attribute);
        }
    });
    write!(
        f,
        group(&format_args!(
            "{",
            soft_block_indent_with_maybe_space(&format_attributes, needs_space),
            "}"
        ))
        .should_expand(
            f.source_text()
                .contains_newline(Span::before(braces.start, first.span()))
        )
    );
}

/// `type: "json"`
struct FormatImportAttribute<'a> {
    attribute: Prop<'a>,
    /// The `{ .. }` that it is in.
    braces: Span,
    /// Where the next attribute starts, or 0.
    next_start: u32,
}

impl Spanned for FormatImportAttribute<'_> {
    fn span(&self) -> Span {
        self.attribute.span()
    }
}

impl<'a> Format<'a> for FormatImportAttribute<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let attribute = self.attribute;
        let (span, node) = (attribute.span(), AstNodes::ObjectProperty(attribute));
        write!(f, format_leading_comments(span));
        match attribute.key() {
            Some(key) if matches!(key.kind(), KeyKind::String(_)) => {
                let span = key.span(f.file());
                let string = f.source_text().text_for(&span);
                let format = FormatLiteralStringToken::new(
                    string,
                    false,
                    StringLiteralParentKind::ImportAttribute,
                )
                .clean_text(f);
                format_name(span, f, |f| write!(f, format));
            }
            Some(key) => write!(f, FormatKey::new(key, node)),
            None => {}
        }
        write!(f, ":");

        if let Some(value) = attribute.value() {
            let breaks_after_colon = !f.is_quiet()
                && (f.comments().comments_before_iter(value.span().start))
                    .any(|comment| comment.has_newline_after() || comment.is_indentable_block());
            let previous_limit = f.comments_mut().limit_comments_up_to(span.end);
            match breaks_after_colon {
                true => write!(
                    f,
                    group(&indent(&format_args!(soft_line_break_or_space(), value)))
                ),
                false => write!(f, [space(), value]),
            }
            f.comments_mut().restore_view_limit(previous_limit);
        }
        write!(
            f,
            format_trailing_comments(self.braces, span, self.next_start)
        );
    }
}
