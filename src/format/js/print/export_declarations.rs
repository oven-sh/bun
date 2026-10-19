use super::decorators::FormatDecorators;
use super::import_declaration::{
    FormatSpecifiers, format_import_and_export_source_with_clause, module_export_name,
};
use super::semicolon::OptionalSemicolon;
use crate::js::ast_nodes::inner_of_stmt;
use crate::js::format::{FormatDeclaration, format_ignorable_name, format_node, write_declaration};
use crate::js::utils::suppressed::FormatSuppressedNode;
use crate::prelude::*;
use crate::write;

/// `export // comment⏎@a class B {}`: Prettier prints the comment after `export `. oxfmt starts a new line after
/// `export`, as it always does before decorators.
fn comments_of_decorated_class_start_a_line(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

/// `export /* prettier-ignore */ const a = 1 ;` stays as it is for oxfmt. Prettier prints `const a = 1;`.
fn ignored_variable_declaration_is_copied_with_its_semicolon(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

/// `export /* prettier-ignore */ type A = 1 ;`: the `;` is part of a type alias, an `import a = b`, a function without
/// a body and a module without a body, so it's copied with them, regardless of the options.
///
/// Both tools do that after `export`. When the whole statement is ignored, oxfmt prints the `;` according to the
/// options. See
/// [`ignored_node_terminator_follows_semi`](crate::js::format::ignored_node_terminator_follows_semi).
fn is_ignored_with_its_semicolon<'a>(statement: Stmt<'a>, f: &Formatter<'a>) -> bool {
    let ends_with_its_semicolon = match statement.kind() {
        StmtKind::TypeAlias(_) | StmtKind::ImportEquals(_) => true,
        StmtKind::Fn(func) => !func.has_body(),
        StmtKind::Module(module) => !module.innermost().has_body(),
        StmtKind::Var(_) => ignored_variable_declaration_is_copied_with_its_semicolon(f),
        _ => false,
    };
    ends_with_its_semicolon && !f.is_quiet() && f.comments().is_ignored(inner_of_stmt(statement))
}

/// Writes `export` or `export default` followed by the declaration `statement`.
#[inline(never)]
pub(crate) fn write_exported_declaration<'a>(statement: Stmt<'a>, f: &mut Formatter<'a>) {
    let node = statement.as_ast_nodes();
    let first_modifier = statement
        .modifiers()
        .iter()
        .find(|it| it.decorator().is_none());
    let keyword = match statement.tag() {
        // Errors, where the `export` isn't in typescript-estree's tree: `export import a from "b"`,
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

    // A class's decorators can come before or after the `export`, and they stay where they are.
    let decorated_class = match statement.kind() {
        StmtKind::Class(class) => Some(class).zip(class.decorators().next()),
        _ => None,
    };
    match decorated_class {
        None if is_ignored_with_its_semicolon(statement, f) => {
            let declaration = inner_of_stmt(statement);
            write!(
                f,
                [
                    keyword_and_space,
                    leading_comments(declaration),
                    FormatSuppressedNode(statement.span_without_export()),
                    trailing_comments(declaration)
                ]
            );
        }
        None => write!(f, [keyword_and_space, FormatDeclaration(statement)]),
        // Prettier's `printDecoratorsBeforeExport`
        Some((class, first_decorator)) if first_decorator.span().end < node.span().start => {
            write!(
                f,
                [
                    FormatDecorators::new(class.decorators(), node),
                    hard_line_break(),
                    keyword_and_space
                ]
            );
            // `@a export /* prettier-ignore */ class B {}`: the span of the class starts at its decorators, which have
            // already been written. Only oxfmt attaches the comment to the class.
            let class_node = AstNodes::Class(class);
            match !f.is_quiet() && f.comments().is_ignored(class_node) {
                true => write!(
                    f,
                    [
                        leading_comments(class_node),
                        FormatSuppressedNode(statement.span_without_export()),
                        trailing_comments(class_node)
                    ]
                ),
                false => write!(f, FormatDeclaration(statement)),
            }
        }
        // They're part of the class, so its leading comments are written before them.
        Some((class, _)) => {
            let starts_a_line = comments_of_decorated_class_start_a_line(f);
            match starts_a_line {
                true => write!(f, [keyword, hard_line_break()]),
                false => write!(f, keyword_and_space),
            }
            // Prettier's `printDecorators` starts with a line break, even right after the one that ends a comment.
            let class_node = AstNodes::Class(class);
            let follows_line_break = !f.is_quiet()
                && !starts_a_line
                && (f.comments().of_node(class_node).leading.last())
                    .is_some_and(|last| last.is_line() || last.has_newline_after());
            format_node(class_node, f, |f| {
                write!(
                    f,
                    [
                        follows_line_break.then_some(empty_line()),
                        FormatDecorators::new(
                            class.decorators(),
                            match starts_a_line {
                                true => class_node,
                                false => node,
                            }
                        ),
                        hard_line_break()
                    ]
                );
                write_declaration(statement, f);
            });
        }
    }
    // An ignored declaration is written with its `;`.
    if matches!(statement.kind(), StmtKind::Var(_))
        && !f
            .comments()
            .is_ignored(AstNodes::VariableDeclaration(statement))
    {
        write!(f, OptionalSemicolon);
    }
}

/// `export default e`
#[inline(never)]
pub(crate) fn write_export_default_expression<'a>(
    _statement: Stmt<'a>,
    expression: Expr<'a>,
    f: &mut Formatter<'a>,
) {
    write!(f, ["export default ", expression, OptionalSemicolon]);
}

/// Flow's `declare export { a }`. Not `export export { a }`, which TypeScript's parser turns into `export { a }`.
fn is_declared(statement: Stmt<'_>) -> bool {
    (statement.modifiers().iter()).any(|it| it.flag() == Flags::AMBIENT)
}

/// `export * from "a"`, `export * as a from "a"`
#[inline(never)]
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
    format_ignorable_name(Span::new(star, name.span().end), f, |f| {
        write!(f, ["*", space(), "as", space(), module_export_name(name)]);
    });
    write!(f, [space(), "from", space()]);
    format_import_and_export_source_with_clause(statement, f);
    write!(f, OptionalSemicolon);
}

/// `export { a, b as c }`, `export { a } from "a"`
#[inline(never)]
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
            if specifiers.len() == 1
                && (f.is_quiet()
                    || !f.comments().has_comments(AstNodes::ExportSpecifier(only))) =>
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
