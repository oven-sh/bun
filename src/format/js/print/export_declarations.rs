use super::decorators::FormatDecorators;
use super::import_declaration::{
    format_import_and_export_source_with_clause, module_export_name, with_empty_line_before_comments,
};
use super::semicolon::OptionalSemicolon;
use crate::js::format::{FormatDeclaration, write_trailing_comments_of};
use crate::prelude::*;
use crate::write;

/// `export` or `export default`, and the decorators of the class after it. They can be before the
/// `export` or after it, and stay where they are.
fn format_export_keyword_with_class_decorators<'a>(
    node: AstNodes<'a>,
    keyword: &'static str,
    class: Option<Class<'a>>,
    f: &mut Formatter<'a>,
) {
    let span = node.span();
    let format_leading_comments = format_with(|f| {
        let comments = f.comments().comments_before(span.start);
        FormatLeadingComments::Comments(comments).fmt(f);
    });

    if let Some(class) = class
        && let Some(first_decorator) = class.decorators().next()
    {
        let decorators = FormatDecorators::new(class.decorators(), node);
        if first_decorator.span().end < span.start {
            write!(f, [decorators, hard_line_break(), format_leading_comments, keyword, space()]);
        } else {
            write!(f, [format_leading_comments, keyword, hard_line_break(), decorators, hard_line_break()]);
        }
    } else {
        write!(f, [format_leading_comments, keyword, space()]);
    }
}

/// `export` or `export default` and the declaration `statement`.
pub(crate) fn write_exported_declaration<'a>(statement: Stmt<'a>, f: &mut Formatter<'a>) {
    let node = statement.as_ast_nodes();
    let class = match statement.kind() {
        StmtKind::Class(class) => Some(class),
        _ => None,
    };
    let keyword = if statement.is_default_export() { "export default" } else { "export" };
    format_export_keyword_with_class_decorators(node, keyword, class, f);
    write!(f, FormatDeclaration(statement));
    if matches!(statement.kind(), StmtKind::Var(_)) {
        write!(f, OptionalSemicolon);
    }
    write_trailing_comments_of(node, f);
}

/// `export default e`
pub(crate) fn write_export_default_expression<'a>(statement: Stmt<'a>, expression: Expr<'a>, f: &mut Formatter<'a>) {
    let node = AstNodes::ExportDefaultDeclaration(statement);
    format_export_keyword_with_class_decorators(node, "export default", None, f);
    write!(f, [expression, OptionalSemicolon]);
    write_trailing_comments_of(node, f);
}

/// `export * from "a"`, `export * as a from "a"`
pub(crate) fn write_export_all_declaration<'a>(statement: Stmt<'a>, f: &mut Formatter<'a>) {
    let StmtKind::ExportStar {
        alias, type_only, ..
    } = statement.kind()
    else {
        return;
    };
    write!(f, ["export", space(), type_only.then_some("type "), "*", space()]);
    if let Some(name) = alias {
        write!(f, ["as", space(), module_export_name(name, AstNodes::ExportAllDeclaration(statement)), space()]);
    }
    write!(f, ["from", space()]);
    format_import_and_export_source_with_clause(statement, f);
    write!(f, OptionalSemicolon);
}

/// `export { a, b as c }`, `export { a } from "a"`
pub(crate) fn write_export_named_declaration<'a>(statement: Stmt<'a>, export: Export<'a>, f: &mut Formatter<'a>) {
    let node = AstNodes::ExportNamedDeclaration(statement);
    let span = statement.span();
    let specifiers = export.items();
    let export_kind = export.is_type_only().then_some("type ");

    format_leading_comments(span).fmt(f);
    write!(f, ["export", space()]);

    let needs_space = f.options().bracket_spacing.value();
    if specifiers.is_empty() {
        let comments = f.comments().comments_before_character(span.start, b'{');
        if !comments.is_empty() {
            let has_line_comment = comments.iter().any(|c| c.is_line());
            write!(
                f,
                [FormatTrailingComments::Comments(comments), has_line_comment.then_some(soft_line_break()), " "]
            );
        }
        write!(f, [export_kind, "{", format_dangling_comments(span).with_block_indent()]);
    } else if specifiers.len() == 1 && f.comments().comments_before_character(span.start, b'}').is_empty() {
        write!(f, [export_kind, "{", maybe_space(needs_space), specifiers.first(), maybe_space(needs_space)]);
    } else {
        let format_specifiers = format_with(|f| {
            let trailing_separator = FormatTrailingCommas::ES5.trailing_separator(f.options());
            f.join_with(soft_line_break_or_space()).entries(
                FormatSeparatedIter::new(specifiers.iter(), ",")
                    .with_trailing_separator(trailing_separator)
                    .map(with_empty_line_before_comments),
            );
        });
        write!(f, [export_kind, "{", group(&soft_block_indent_with_maybe_space(&format_specifiers, needs_space))]);
    }
    write!(f, "}");

    if export.has_from() {
        write!(f, [space(), "from", space()]);
        format_import_and_export_source_with_clause(statement, f);
    }
    write!(f, OptionalSemicolon);
    write_trailing_comments_of(node, f);
}

/// `a`, `a as b`, `type a`
pub(crate) fn write_export_specifier<'a>(specifier: ExportSpec<'a>, f: &mut Formatter<'a>) {
    let node = AstNodes::ExportSpecifier(specifier);
    let comments = f.comments().line_comments_before(specifier.exported().span().end);
    write!(f, [FormatLeadingComments::Comments(comments), specifier.is_type_only().then_some("type ")]);
    let exported = module_export_name(specifier.exported(), node);
    match specifier.is_renamed() {
        true => write!(f, [module_export_name(specifier.local(), node), space(), "as", space(), exported]),
        false => write!(f, exported),
    }
}
