use super::decorators::FormatDecorators;
use super::import_declaration::{
    FormatSpecifiers, format_import_and_export_source_with_clause, has_comments, module_export_name,
};
use super::semicolon::OptionalSemicolon;
use crate::js::format::{FormatDeclaration, format_name, format_node, write_declaration};
use crate::js::utils::format_node_without_trailing_comments::FormatNodeWithoutTrailingComments;
use crate::js::utils::typecast::is_cast_target;
use crate::prelude::*;
use crate::write;

/// `export // comment⏎@a class B {}`: Prettier writes the comment behind `export `. For oxfmt a line starts after `export`
/// as it always does before decorators.
fn comments_of_decorated_class_start_a_line(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

/// `export` or `export default` and the declaration `statement`.
pub(crate) fn write_exported_declaration<'a>(statement: Stmt<'a>, f: &mut Formatter<'a>) {
    let node = statement.as_ast_nodes();
    let first_modifier = statement
        .modifiers()
        .iter()
        .find(|it| it.decorator().is_none());
    let keyword = match statement.tag() {
        // Errors, where the `export` is not in typescript-estree's tree: `export import a from "b"`,
        // `export export = a`, `declare export const a`.
        StmtTag::Import | StmtTag::ExportAssign => "",
        _ if f.file().is_flow() && super::flow::is_declare_export(statement, f) => {
            match statement.is_default_export() {
                true => "declare export default",
                false => "declare export",
            }
        }
        _ if first_modifier.is_some_and(|it| it.flag() != Flags::EXPORT) => "",
        _ if statement.is_default_export() => "export default",
        _ => "export",
    };
    let keyword_and_space = format_with(|f| {
        if !keyword.is_empty() {
            write!(f, [keyword, space()]);
        }
    });

    // The decorators of a class can be before the `export` or after it, and stay where they are.
    let decorated_class = match statement.kind() {
        StmtKind::Class(class) => Some(class).zip(class.decorators().next()),
        _ => None,
    };
    match decorated_class {
        None => write!(f, [keyword_and_space, FormatDeclaration(statement)]),
        // Prettier's `printDecoratorsBeforeExport`
        Some((class, first_decorator)) if first_decorator.span().end < node.span().start => {
            write!(
                f,
                [
                    FormatDecorators::new(class.decorators(), node),
                    hard_line_break(),
                    keyword_and_space,
                    FormatDeclaration(statement)
                ]
            );
        }
        // They are part of the class, so its leading comments are written before them.
        Some((class, _)) => {
            match comments_of_decorated_class_start_a_line(f) {
                true => write!(f, [keyword, hard_line_break()]),
                false => write!(f, keyword_and_space),
            }
            format_node(AstNodes::Class(class), f, |f| {
                write!(
                    f,
                    [
                        FormatDecorators::new(class.decorators(), node),
                        hard_line_break()
                    ]
                );
                write_declaration(statement, f);
            });
        }
    }
    if matches!(statement.kind(), StmtKind::Var(_)) {
        write!(f, OptionalSemicolon);
    }
}

/// `export default a /* comment */;` is `export default a; /* comment */` for oxfmt, as after any other
/// statement. Prettier leaves it.
fn comments_before_semicolon_of_default_export_go_behind_it(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

/// `export default e`
pub(crate) fn write_export_default_expression<'a>(
    _statement: Stmt<'a>,
    expression: Expr<'a>,
    f: &mut Formatter<'a>,
) {
    write!(f, "export default ");
    if f.is_quiet()
        || !comments_before_semicolon_of_default_export_go_behind_it(f)
        || is_cast_target(expression, f)
    {
        return write!(f, [expression, OptionalSemicolon]);
    }
    write!(
        f,
        [
            FormatNodeWithoutTrailingComments(&expression),
            OptionalSemicolon,
            trailing_comments(expression.as_chain_element())
        ]
    );
}

/// Flow's `declare export { a }`. Not `export export { a }`, of which TypeScript's parser makes `export { a }`.
fn is_declared(statement: Stmt<'_>) -> bool {
    (statement.modifiers().iter()).any(|it| it.flag() == Flags::AMBIENT)
}

/// `export * from "a"`, `export * as a from "a"`
pub(crate) fn write_export_all_declaration<'a>(statement: Stmt<'a>, f: &mut Formatter<'a>) {
    let StmtKind::ExportStar {
        alias, type_only, ..
    } = statement.kind()
    else {
        return;
    };
    write!(
        f,
        [
            is_declared(statement).then_some("declare "),
            "export",
            space(),
            type_only.then_some("type ")
        ]
    );
    let Some(name) = alias else {
        write!(f, ["*", space(), "from", space()]);
        format_import_and_export_source_with_clause(statement, f);
        return write!(f, OptionalSemicolon);
    };
    // For Babel `* as a` is an `ExportNamespaceSpecifier`, which can own comments.
    let star = statement.export_star_offset().unwrap_or_default();
    format_name(Span::new(star, name.span().end), f, |f| {
        write!(f, ["*", space(), "as", space(), module_export_name(name)]);
    });
    write!(f, [space(), "from", space()]);
    format_import_and_export_source_with_clause(statement, f);
    write!(f, OptionalSemicolon);
}

/// `export { a, b as c }`, `export { a } from "a"`
pub(crate) fn write_export_named_declaration<'a>(
    statement: Stmt<'a>,
    export: Export<'a>,
    f: &mut Formatter<'a>,
) {
    write!(f, [is_declared(statement).then_some("declare "), "export"]);
    // `export { /* comment */ };`
    let node = AstNodes::ExportNamedDeclaration(statement);
    if !f.is_quiet()
        && let Some(last) = f.comments().of_node(node).dangling.last()
    {
        write!(
            f,
            [
                space(),
                dangling_comments(node),
                last.is_line().then_some(hard_line_break())
            ]
        );
    }
    write!(f, [" ", export.is_type_only().then_some("type ")]);

    let specifiers = export.items();
    let needs_space = f.options().bracket_spacing.value();
    match specifiers.first() {
        None => write!(f, "{}"),
        Some(only)
            if specifiers.len() == 1 && !has_comments(AstNodes::ExportSpecifier(only), f) =>
        {
            write!(
                f,
                [
                    "{",
                    maybe_space(needs_space),
                    only,
                    maybe_space(needs_space),
                    "}"
                ]
            );
        }
        Some(_) => write!(
            f,
            [
                "{",
                FormatSpecifiers(specifiers, AstNodes::ExportSpecifier),
                "}"
            ]
        ),
    }
    if export.has_from() {
        write!(f, [space(), "from", space()]);
        format_import_and_export_source_with_clause(statement, f);
    }
    write!(f, OptionalSemicolon);
}

/// `a`, `a as b`, `type a`
pub(crate) fn write_export_specifier<'a>(specifier: ExportSpec<'a>, f: &mut Formatter<'a>) {
    write!(f, specifier.is_type_only().then_some("type "));
    let exported = module_export_name(specifier.exported());
    match specifier.is_renamed() {
        true => write!(
            f,
            [
                module_export_name(specifier.local()),
                space(),
                "as",
                space(),
                exported
            ]
        ),
        false => write!(f, exported),
    }
}
