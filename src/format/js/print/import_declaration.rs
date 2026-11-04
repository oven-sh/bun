use super::program::is_next_line_empty;
use super::semicolon::OptionalSemicolon;
use crate::js::format::{format_ignorable_name, format_name, format_node, identifier};
use crate::js::utils::object::FormatKey;
use crate::js::utils::string::{
    FormatLiteralStringToken, StringLiteralParentKind, is_name_without_quotes,
};
use crate::prelude::*;
use crate::{format_args, write};

/// A module specifier: a string literal that isn't an expression.
pub(crate) struct FormatStringLiteral {
    pub(crate) span: Span,
}

impl<'a> Format<'a> for FormatStringLiteral {
    fn fmt(&self, f: &mut Formatter<'a>) {
        format_ignorable_name(self.span, f, |f| {
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

/// The `"source" with { type: "json" }` part of the import or export `statement`.
pub(crate) fn format_import_and_export_source_with_clause<'a>(
    statement: Stmt<'a>,
    f: &mut Formatter<'a>,
) {
    let Some(span) = statement.module_specifier_span() else {
        return;
    };
    write!(f, FormatStringLiteral { span });
    let Some(with_clause) = statement.import_attributes() else {
        return;
    };
    write_with_clause(with_clause, f);
}

#[inline(never)]
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
        write_import_specifiers(import, f);
        write!(f, " from ");
    }
    format_import_and_export_source_with_clause(statement, f);
    write!(f, OptionalSemicolon);
}

/// `a, * as b`, `a, { b, c }`
fn write_import_specifiers<'a>(import: Import<'a>, f: &mut Formatter<'a>) {
    let named = import.named();
    // `import a, {} from "a"` prints as `import a from "a"`.
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
        format_ignorable_name(span, f, |f| {
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
            if is_only_specifier
                && (f.is_quiet()
                    || !f.comments().has_comments(AstNodes::ImportSpecifier(only))) =>
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
        Some(_) => write!(
            f,
            ["{", FormatSpecifiers(named, AstNodes::ImportSpecifier), "}"]
        ),
    }
}

/// `import {⏎⏎// comment⏎a } from "b"`: oxfmt keeps the empty line, even right after the `{`.
fn keeps_empty_line_before_specifier_comments(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

/// An import or export specifier.
struct FormatSpecifier<'a, T> {
    specifier: T,
    node: AstNodes<'a>,
}

impl<T: Spanned> Spanned for FormatSpecifier<'_, T> {
    fn span(&self) -> Span {
        self.specifier.span()
    }
}

impl<'a, T: Format<'a>> Format<'a> for FormatSpecifier<'a, T> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        if !f.is_quiet()
            && keeps_empty_line_before_specifier_comments(f)
            && let Some(first) = f.comments().of_node(self.node).leading.first()
            && first.span().start < self.node.span().start
            && crate::text::is_previous_line_empty(
                f.source_text().as_bytes(),
                first.span().start as usize,
            )
        {
            write!(f, empty_line());
        }
        write!(f, self.specifier);
    }
}

/// The specifiers between an import's or export's braces, and the [`AstNodes`] variant that wraps each one.
pub(crate) struct FormatSpecifiers<'a, T>(pub(crate) List<'a, T>, pub(crate) fn(T) -> AstNodes<'a>);

impl<'a, T: Handle<'a> + Format<'a> + Spanned> Format<'a> for FormatSpecifiers<'a, T> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let FormatSpecifiers(specifiers, as_node) = *self;
        let format_specifiers = format_with(|f| {
            let trailing_separator = FormatTrailingCommas::ES5.trailing_separator(f.options());
            let specifiers = specifiers.iter().map(|specifier| FormatSpecifier {
                specifier,
                node: as_node(specifier),
            });
            f.join_with(soft_line_break_or_space()).entries(
                FormatSeparatedIter::new(specifiers, ",")
                    .with_trailing_separator(trailing_separator),
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

/// `a`, `a as b`, `type a`
pub(crate) fn write_import_specifier<'a>(specifier: ImportSpec<'a>, f: &mut Formatter<'a>) {
    let kind = specifier
        .is_type_only()
        .then(|| super::flow::import_kind(specifier.span().start, f));
    write!(f, kind);
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

/// Prettier's `printObject` for import attributes. `braces` is the span of the `{ .. }`.
fn write_import_attributes<'a>(entries: List<'a, Prop<'a>>, braces: Span, f: &mut Formatter<'a>) {
    let Some(first) = entries.first() else {
        return write!(f, "{}");
    };
    let needs_space = f.options().bracket_spacing.value();
    if entries.len() == 1 && is_type_attribute_without_comments(first, f) {
        return write!(
            f,
            [
                "{",
                maybe_space(needs_space),
                FormatImportAttribute(first),
                maybe_space(needs_space),
                "}"
            ]
        );
    }

    let format_attributes = format_with(|f| {
        let trailing_separator = FormatTrailingCommas::ES5.trailing_separator(f.options());
        let attributes = entries.iter().map(FormatImportAttribute);
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

/// Prettier's `isSingleTypeImportAttributes`: `type: "json"`
fn is_type_attribute_without_comments<'a>(attribute: Prop<'a>, f: &Formatter<'a>) -> bool {
    let (Some(key), Some(value)) = (attribute.key(), attribute.value()) else {
        return false;
    };
    if !key.is("type") || value.tag() != ExprTag::String {
        return false;
    }
    if f.is_quiet() {
        return true;
    }
    let key_comments = f.comments().of_name(key.span(f.file()).start);
    key_comments.leading.is_empty()
        && key_comments.trailing.is_empty()
        && !f
            .comments()
            .has_comments(AstNodes::ObjectProperty(attribute))
        && !f.comments().has_comments(value.as_ast_nodes())
}

/// `type: "json"`
#[derive(Copy, Clone)]
struct FormatImportAttribute<'a>(Prop<'a>);

impl Spanned for FormatImportAttribute<'_> {
    fn span(&self) -> Span {
        self.0.span()
    }
}

impl<'a> Format<'a> for FormatImportAttribute<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let attribute = self.0;
        format_node(AstNodes::ObjectProperty(attribute), f, |f| {
            write_import_attribute(attribute, f)
        });
    }
}

fn write_import_attribute<'a>(attribute: Prop<'a>, f: &mut Formatter<'a>) {
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
        Some(key) => write!(f, FormatKey::new(key, AstNodes::ObjectProperty(attribute))),
        None => {}
    }
    write!(f, ":");

    let Some(value) = attribute.value() else {
        return;
    };
    // Prettier's `chooseLayout`: `break-after-operator`, or else `never-break-after-operator`.
    let breaks_after_colon = !f.is_quiet()
        && (f.comments().of_node(value.as_ast_nodes()).leading.iter())
            .any(|comment| comment.has_newline_after() || comment.is_indentable_block());
    match breaks_after_colon {
        true => write!(
            f,
            group(&indent(&format_args!(soft_line_break_or_space(), value)))
        ),
        false => write!(f, [space(), value]),
    }
}
