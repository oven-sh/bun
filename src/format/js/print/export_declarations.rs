use super::decorators::FormatDecorators;
use super::import_declaration::{
    FormatCommentsInSpecifier, FormatSpecifiers, format_import_and_export_source_with_clause, module_export_name,
    only_specifier_has_comments,
};
use super::semicolon::OptionalSemicolon;
use crate::cursor::{enter_node, extend_node};
use crate::js::format::{FormatDeclaration, write_trailing_comments_of};
use crate::prelude::*;
use crate::write;

/// `export` or `export default`, and the decorators of the class after it. They can be before the
/// `export` or after it, and stay where they are. `keyword` is empty if it is not written.
fn format_export_keyword_with_class_decorators<'a>(
    node: AstNodes<'a>,
    keyword: &'static str,
    class: Option<Class<'a>>,
    f: &mut Formatter<'a>,
) {
    let span = node.span();
    let keyword_and_space = format_with(|f| {
        if !keyword.is_empty() {
            write!(f, [keyword, space()]);
        }
    });
    let format_leading_comments = format_with(|f| {
        let comments = f.comments().comments_before(span.start);
        FormatLeadingComments::Comments(comments).fmt(f);
    });

    if let Some(class) = class
        && let Some(first_decorator) = class.decorators().next()
    {
        let decorators = FormatDecorators::new(class.decorators(), node);
        if first_decorator.span().end < span.start {
            enter_node(span, f);
            write!(f, [decorators, hard_line_break(), format_leading_comments, keyword_and_space]);
        } else if ignored_class_stays_behind_export(f) && f.comments().is_suppressed(first_decorator.span().start) {
            // The class is written as it is, with its decorators.
            write!(f, format_leading_comments);
            enter_node(span, f);
            write!(f, keyword_and_space);
        } else {
            write!(f, format_leading_comments);
            enter_node(span, f);
            write!(f, [keyword, hard_line_break(), decorators, hard_line_break()]);
        }
    } else {
        write!(f, format_leading_comments);
        enter_node(span, f);
        write!(f, keyword_and_space);
    }
}

/// Prettier writes a class that is not formatted behind `export `, with the comment in between. For
/// oxfmt the decorators start a line as they always do after `export`.
fn ignored_class_stays_behind_export(f: &Formatter<'_>) -> bool {
    !f.options().flavor.is_oxfmt()
}

/// `export` or `export default` and the declaration `statement`.
pub(crate) fn write_exported_declaration<'a>(statement: Stmt<'a>, f: &mut Formatter<'a>) {
    let node = statement.as_ast_nodes();
    let class = match statement.kind() {
        StmtKind::Class(class) => Some(class),
        _ => None,
    };
    let first_modifier = statement.modifiers().iter().find(|it| it.decorator().is_none());
    let keyword = match statement.tag() {
        // Errors, where the `export` is not in typescript-estree's tree: `export import a from "b"`,
        // `export export = a`, `declare export const a`.
        StmtTag::Import | StmtTag::ExportAssign => "",
        _ if f.file().is_flow() && super::flow::is_declare_export(statement, f) => match statement.is_default_export() {
            true => "declare export default",
            false => "declare export",
        },
        _ if first_modifier.is_some_and(|it| it.flag() != Flags::EXPORT) => "",
        _ if statement.is_default_export() => "export default",
        _ => "export",
    };
    format_export_keyword_with_class_decorators(node, keyword, class, f);
    write!(f, FormatDeclaration(statement));
    if matches!(statement.kind(), StmtKind::Var(_)) {
        write!(f, OptionalSemicolon);
    }
    extend_node(node.span(), f);
    write_trailing_comments_of(node, f);
}

/// `export default e`
pub(crate) fn write_export_default_expression<'a>(statement: Stmt<'a>, expression: Expr<'a>, f: &mut Formatter<'a>) {
    let node = AstNodes::ExportDefaultDeclaration(statement);
    format_export_keyword_with_class_decorators(node, "export default", None, f);
    write!(f, [expression, OptionalSemicolon]);
    extend_node(node.span(), f);
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
    write!(f, [(!statement.modifiers().is_empty()).then_some("declare "), "export", space(), type_only.then_some("type ")]);
    let Some(name) = alias else {
        write!(f, ["*", space(), "from", space()]);
        format_import_and_export_source_with_clause(statement, f);
        return write!(f, OptionalSemicolon);
    };
    let format_name = module_export_name(name, AstNodes::ExportAllDeclaration(statement));
    if f.is_quiet() {
        write!(f, ["*", space(), "as", space(), format_name, space()]);
    } else {
        // To Babel `* as a` is a specifier, which the comments before it lead. To TypeScript there
        // is only the name.
        if f.file().is_javascript() {
            let comments = f.comments().comments_before_character(statement.span().start, b'*');
            write!(f, FormatLeadingComments::Comments(comments));
        }
        write!(f, ["*", space(), "as", space()]);
        let previous_limit = f.comments_mut().limit_comments_up_to(name.span().end);
        write!(f, format_name);
        f.comments_mut().restore_view_limit(previous_limit);
        let source_start = statement.module_specifier_span().map_or(0, |source| source.start);
        write!(f, [format_trailing_comments(statement.span(), name.span(), source_start), space()]);
    }
    write!(f, ["from", space()]);
    format_import_and_export_source_with_clause(statement, f);
    write!(f, OptionalSemicolon);
}

/// `export { a, b as c }`, `export { a } from "a"`
pub(crate) fn write_export_named_declaration<'a>(statement: Stmt<'a>, export: Export<'a>, f: &mut Formatter<'a>) {
    let span = statement.span();
    let specifiers = export.items();
    let export_kind = export.is_type_only().then_some("type ");

    format_leading_comments(span).fmt(f);
    write!(f, [(!statement.modifiers().is_empty()).then_some("declare "), "export", space()]);

    let needs_space = f.options().bracket_spacing.value();
    let Some(first) = specifiers.first() else {
        // The comments in an export of nothing go after the keyword.
        if !export.has_from() && !f.is_quiet() {
            let comments = f.comments().comments_before_character(span.start, b'}');
            if let Some(last) = comments.last() {
                write!(
                    f,
                    [
                        FormatDanglingComments::Comments {
                            comments,
                            indent: DanglingIndentMode::None
                        },
                        last.is_line().then_some(hard_line_break()),
                        " "
                    ]
                );
            }
        }
        write!(f, [export_kind, "{}"]);
        return write_export_source(statement, export, f);
    };
    if specifiers.len() == 1 && !only_specifier_has_comments(statement, first.span(), f) {
        write!(f, [export_kind, "{", maybe_space(needs_space), first, maybe_space(needs_space), "}"]);
    } else {
        write!(f, [export_kind, "{", FormatSpecifiers(statement, specifiers), "}"]);
    }
    write_export_source(statement, export, f);
}

/// What is after the `}` of `export {}`.
fn write_export_source<'a>(statement: Stmt<'a>, export: Export<'a>, f: &mut Formatter<'a>) {
    if export.has_from() {
        write!(f, [space(), "from", space()]);
        format_import_and_export_source_with_clause(statement, f);
    }
    write!(f, OptionalSemicolon);
    write_trailing_comments_of(AstNodes::ExportNamedDeclaration(statement), f);
}

/// `a`, `a as b`, `type a`
pub(crate) fn write_export_specifier<'a>(specifier: ExportSpec<'a>, f: &mut Formatter<'a>) {
    let node = AstNodes::ExportSpecifier(specifier);
    write!(f, [FormatCommentsInSpecifier(specifier.span()), specifier.is_type_only().then_some("type ")]);
    let exported = module_export_name(specifier.exported(), node);
    match specifier.is_renamed() {
        true => write!(f, [module_export_name(specifier.local(), node), space(), "as", space(), exported]),
        false => write!(f, exported),
    }
}
