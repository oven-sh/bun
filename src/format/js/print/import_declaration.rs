use super::semicolon::OptionalSemicolon;
use crate::js::format::{format_node, identifier};
use crate::js::utils::object::FormatKey;
use crate::js::utils::string::{FormatLiteralStringToken, StringLiteralParentKind, is_es5_identifier_name};
use crate::prelude::*;
use crate::{format_args, write};

/// A string literal that is not an expression here: a module specifier.
pub(crate) struct FormatStringLiteral<'a> {
    pub(crate) span: Span,
    pub(crate) parent: AstNodes<'a>,
}

impl<'a> Format<'a> for FormatStringLiteral<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        format_node(self.span, || self.parent, f, |f| {
            let string = f.source_text().text_for(&self.span);
            write!(f, FormatLiteralStringToken::new(string, false, StringLiteralParentKind::Expression));
        });
    }
}

/// ESTree's `ModuleExportName`: `a`, or `"a"`.
pub(crate) fn module_export_name<'a>(name: Ident<'a>, parent: AstNodes<'a>) -> impl Format<'a> {
    format_with(move |f: &mut Formatter<'a>| match name.is_string() {
        true => FormatStringLiteral {
            span: name.span(),
            parent,
        }
        .fmt(f),
        false => identifier(name, parent).fmt(f),
    })
}

/// `"source" with { type: "json" }` of the import or export `statement`.
pub(crate) fn format_import_and_export_source_with_clause<'a>(statement: Stmt<'a>, f: &mut Formatter<'a>) {
    let parent = statement.as_ast_nodes();
    if let Some(span) = statement.module_specifier_span() {
        FormatStringLiteral { span, parent }.fmt(f);
    }
    if let Some(with_clause) = statement.import_attributes() {
        let span = with_clause.keyword_span().to(with_clause.braces_span());
        // Of the comments before the first attribute that do not start their line, those before
        // the `{` and those that end their line trail the source.
        if !f.is_quiet() {
            let braces_start = with_clause.braces_span().start;
            let end = with_clause.entries().first().map_or(braces_start, |first| first.span().start);
            let comments = f.comments().comments_before(end);
            let count = comments
                .iter()
                .take_while(|comment| !comment.preceded_by_newline())
                .enumerate()
                .filter(|(_, comment)| comment.span.end <= braces_start || comment.followed_by_newline())
                .last()
                .map_or(0, |(index, _)| index + 1);
            write!(f, FormatTrailingComments::Comments(comments.get(..count).unwrap_or_default()));
        }
        if f.comments().has_comment_before(span.start) {
            write!(f, space());
        }
        format_node(span, || parent, f, |f| write_with_clause(with_clause, span, parent, f));
    }
}

pub(crate) fn write_import_declaration<'a>(statement: Stmt<'a>, import: Import<'a>, f: &mut Formatter<'a>) {
    write!(f, ["import", space()]);
    if import.is_deferred() {
        write!(f, ["defer", space()]);
    } else if import.is_type_only() {
        write!(f, ["type", space()]);
    }
    if !import.is_side_effect() {
        write_import_specifiers(statement, import, f);
        write!(f, [space(), "from", space()]);
    }
    format_import_and_export_source_with_clause(statement, f);
    write!(f, OptionalSemicolon);
}

/// `a, * as b`, `a, { b, c }`
fn write_import_specifiers<'a>(statement: Stmt<'a>, import: Import<'a>, f: &mut Formatter<'a>) {
    let node = AstNodes::ImportDeclaration(statement);
    let named = import.named();
    // `import a, {} from "a"` is `import a from "a"`.
    let has_braces = import.has_named_imports()
        && !(named.is_empty() && (import.default().is_some() || import.namespace().is_some()));

    if let Some(default) = import.default() {
        write!(f, identifier(default, node));
        if import.namespace().is_none() && !has_braces {
            return;
        }
        write!(f, [",", space()]);
    }
    if let (Some(namespace), Some(span)) = (import.namespace(), import.namespace_span()) {
        format_node(span, || node, f, |f| write!(f, ["*", space(), "as", space(), identifier(namespace, node)]));
        if !has_braces {
            return;
        }
        write!(f, [",", space()]);
    }

    let should_insert_space_around_brackets = f.options().bracket_spacing.value();
    let is_only_specifier = named.len() == 1 && import.default().is_none() && import.namespace().is_none();

    match named.first() {
        None => write!(f, "{}"),
        Some(only) if is_only_specifier && !only_specifier_has_comments(statement, only.span(), f) => write!(
            f,
            [
                "{",
                maybe_space(should_insert_space_around_brackets),
                only,
                maybe_space(should_insert_space_around_brackets),
                "}",
            ]
        ),
        Some(_) => write!(f, ["{", FormatSpecifiers(statement, named), "}"]),
    }
}

/// Whether a comment belongs to `specifier`, the only one of the import or export `statement`. One
/// inside of it does if it starts or ends its line, otherwise it belongs to a name.
pub(crate) fn only_specifier_has_comments<'a>(statement: Stmt<'a>, specifier: Span, f: &Formatter<'a>) -> bool {
    !f.is_quiet()
        && (f.comments().comments_before_character(statement.span().start, b'}').iter().any(|comment| {
            !specifier.contains(comment.span) || comment.preceded_by_newline() || comment.followed_by_newline()
        }) || !comments_before_from(specifier.end, statement, f).is_empty())
}

/// `{ a } /* comment */ from "a"`: of the comments that are not printed yet between `position`,
/// where the last specifier of `statement` ends, and the source, those that trail the specifier:
/// the ones that end their line, and the ones before the `from` that do not start their line.
fn comments_before_from<'a>(mut position: u32, statement: Stmt<'a>, f: &Formatter<'a>) -> &'a [Comment] {
    let Some(source) = statement.module_specifier_span() else {
        return &[];
    };
    let comments = f.comments().comments_in_range(position, source.start);
    let mut is_before_from = true;
    let count = comments
        .iter()
        .take_while(|comment| {
            let gap = f.source_text().slice_range(position, comment.span.start);
            position = comment.span.end;
            is_before_from &= !bun_core::strings::contains(gap, b"from");
            comment.followed_by_newline() || (is_before_from && !comment.preceded_by_newline())
        })
        .count();
    comments.get(..count).unwrap_or_default()
}

/// The specifiers between the braces of the import or export in the first field.
pub(crate) struct FormatSpecifiers<'a, T>(pub(crate) Stmt<'a>, pub(crate) List<'a, T>);

impl<'a, T: Handle<'a> + Format<'a> + Spanned> Format<'a> for FormatSpecifiers<'a, T> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let FormatSpecifiers(statement, specifiers) = *self;
        let format_specifiers = format_with(|f| {
            let trailing_separator = FormatTrailingCommas::ES5.trailing_separator(f.options());
            let iter = specifiers.iter().enumerate().map(|(index, specifier)| FormatSpecifier {
                specifier,
                statement,
                next_start: specifiers.get(index + 1).map(|next| next.span().start),
            });
            f.join_with(soft_line_break_or_space())
                .entries(FormatSeparatedIter::new(iter, ",").with_trailing_separator(trailing_separator));
        });
        let needs_space = f.options().bracket_spacing.value();
        write!(f, group(&soft_block_indent_with_maybe_space(&format_specifiers, needs_space)));
    }
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
        write!(f, self.specifier);
        if f.is_quiet() {
            return;
        }
        // Prettier's `handleModuleSpecifiersComments`: a comment after a specifier that ends its
        // line trails the specifier, also if it is on a line of its own.
        let comments = match self.next_start {
            Some(next_start) => {
                let comments = f.comments().comments_before(next_start);
                let count = comments.iter().rposition(|it| it.followed_by_newline()).map_or(0, |last| last + 1);
                comments.get(..count).unwrap_or_default()
            }
            None => comments_before_from(self.specifier.span().end, self.statement, f),
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
        let count = comments.iter().rposition(|it| it.preceded_by_newline() || it.followed_by_newline());
        let comments = comments.get(..count.map_or(0, |last| last + 1)).unwrap_or_default();
        write!(f, FormatLeadingComments::Comments(comments));
    }
}

/// `a`, `a as b`, `type a`
pub(crate) fn write_import_specifier<'a>(specifier: ImportSpec<'a>, f: &mut Formatter<'a>) {
    let node = AstNodes::ImportSpecifier(specifier);
    write!(f, [FormatCommentsInSpecifier(specifier.span()), specifier.is_type_only().then_some("type ")]);
    let local = identifier(specifier.local(), node);
    match specifier.is_renamed() {
        true => write!(f, [module_export_name(specifier.imported(), node), space(), "as", space(), local]),
        false => write!(f, local),
    }
}

/// `with { type: "json" }`. `span`: of all of it. `parent`: the import or export.
fn write_with_clause<'a>(with_clause: ImportAttributes<'a>, span: Span, parent: AstNodes<'a>, f: &mut Formatter<'a>) {
    let entries = with_clause.entries();
    let is_consistent = f.options().quote_properties.is_consistent();
    if is_consistent {
        let quote_needed = entries.iter().any(|attribute| {
            attribute.key().is_some_and(|key| {
                matches!(key.kind(), KeyKind::String(_))
                    && !is_es5_identifier_name(f.source_text().text_for(&key.span(f.file()).shrink(1, 1)))
            })
        });
        f.context_mut().push_quote_needed(quote_needed);
    }

    write!(f, space());
    if entries.is_empty() {
        let comments = f.comments().comments_before(span.end);
        write!(f, [space(), FormatLeadingComments::Comments(comments)]);
    }
    write!(f, [source_text(with_clause.keyword_span()), space()]);
    write_import_attributes(entries, span, parent, f);

    if is_consistent {
        f.context_mut().pop_quote_needed();
    }
}

fn write_import_attributes<'a>(entries: List<'a, Prop<'a>>, span: Span, parent: AstNodes<'a>, f: &mut Formatter<'a>) {
    let Some(first) = entries.first() else {
        return write!(f, "{}");
    };
    let attributes = || entries.iter().map(|attribute| FormatImportAttribute { attribute, parent });
    let should_insert_space_around_brackets = f.options().bracket_spacing.value();

    let format_inner = format_with(|f| {
        write!(f, "{");
        if entries.len() > 1 || !first.key().is_some_and(|key| key.is("type")) || f.comments().has_comment_before(span.end)
        {
            write!(
                f,
                soft_block_indent_with_maybe_space(
                    &format_with(|f| {
                        let trailing_separator = FormatTrailingCommas::ES5.trailing_separator(f.options());
                        f.join_with(soft_line_break_or_space()).entries_with_trailing_separator(
                            attributes(),
                            ",",
                            trailing_separator,
                        );
                    }),
                    should_insert_space_around_brackets
                )
            );
        } else {
            write!(f, maybe_space(should_insert_space_around_brackets));
            f.join_with(space()).entries_with_trailing_separator(attributes(), ",", TrailingSeparator::Disallowed);
            write!(f, maybe_space(should_insert_space_around_brackets));
        }
        write!(f, "}");
    });

    write!(f, group(&format_inner).should_expand(f.source_text().has_line_terminator_before(first.span().start)));
}

/// `type: "json"`
struct FormatImportAttribute<'a> {
    attribute: Prop<'a>,
    /// The import or export.
    parent: AstNodes<'a>,
}

impl Spanned for FormatImportAttribute<'_> {
    fn span(&self) -> Span {
        self.attribute.span()
    }
}

impl<'a> Format<'a> for FormatImportAttribute<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let FormatImportAttribute { attribute, parent } = *self;
        format_node(attribute.span(), || parent, f, |f| {
            let node = AstNodes::ObjectProperty(attribute);
            match attribute.key() {
                Some(key) if matches!(key.kind(), KeyKind::String(_)) => {
                    let span = key.span(f.file());
                    let string = f.source_text().text_for(&span);
                    let format =
                        FormatLiteralStringToken::new(string, false, StringLiteralParentKind::ImportAttribute).clean_text(f);
                    format_node(span, || node, f, |f| write!(f, format));
                }
                Some(key) => write!(f, FormatKey::new(key, node)),
                None => {}
            }
            write!(f, [":", space()]);

            let Some(value) = attribute.value() else {
                return;
            };
            match f.comments().has_leading_own_line_comment(value.span().start) {
                true => write!(f, group(&indent(&format_args!(soft_line_break(), value)))),
                false => write!(f, value),
            }
        });
    }
}
