//! The declarations of TypeScript.

use super::block_statement::is_empty_block;
use super::class::FormatClassImplements;
use super::import_declaration::FormatStringLiteral;
use super::program::FormatStatements;
use super::semicolon::OptionalSemicolon;
use super::ts_types::{entity_name, write_ts_interface_signatures};
use super::type_parameters::{FormatTSTypeParametersOptions, type_parameters};
use super::union_type::write_ts_union_type_in;
use crate::js::format::{format_node, identifier, write_trailing_comments_of};
use crate::js::utils::assignment_like::AssignmentLikeLayout;
use crate::js::utils::format_node_without_trailing_comments::FormatNodeWithoutTrailingComments;
use crate::js::utils::object::{FormatKey, key_requires_quotes};
use crate::js::utils::typescript::{should_hug_type, without_lone_operator};
use crate::prelude::*;
use crate::{format_args, write};

fn is_declared(statement: Stmt<'_>) -> bool {
    statement.modifiers().iter().any(|it| it.flag() == Flags::AMBIENT)
}

/// `interface A<T> extends B { .. }`
pub(crate) fn write_ts_interface_declaration<'a>(statement: Stmt<'a>, interface: Interface<'a>, f: &mut Formatter<'a>) {
    let node = AstNodes::TSInterfaceDeclaration(statement);
    let id = identifier(interface.name(), node);
    let type_params = interface.type_params();
    let extends = interface.extends();
    let body_span = interface.body_span();

    // Whether the head is a group that can break before `extends`: there are several types, or one
    // that is `A.B` without type arguments, or a comment before it.
    let group_mode = extends.len() > 1
        || extends.first().is_some_and(|first| {
            let is_member = match first.kind() {
                TypeKind::Ref { name, args } => name.len() > 1 && args.is_empty(),
                TypeKind::Heritage { expr, args } => {
                    matches!(expr.kind(), ExprKind::Dot { .. } | ExprKind::Index { .. }) && args.is_empty()
                }
                _ => false,
            };
            is_member || {
                let previous = type_params.angle_brackets_span().unwrap_or(id.span());
                f.comments().has_comment_in_range(previous.end, first.span().start)
            }
        });

    let format_id = format_with(|f| {
        match type_params.is_empty() && extends.is_empty() {
            true => FormatNodeWithoutTrailingComments(&id).fmt(f),
            false => write!(f, id),
        }
        if type_params.angle_brackets_span().is_some() {
            let options = FormatTSTypeParametersOptions {
                group_id: Some(f.group_id("type_parameters")),
                is_type_or_interface_decl: true,
            };
            type_parameters(type_params, Node::Stmt(statement)).with_options(options).write_without_comments(f);
        }
    });

    let format_extends = format_with(|f| {
        let Some(first_extend) = extends.first() else {
            return;
        };
        if f.comments().has_leading_own_line_comment(first_extend.span().start) {
            write!(f, FormatTrailingComments::Comments(f.comments().comments_before(first_extend.span().start)));
        }

        let heritage = FormatClassImplements(extends);
        if extends.len() > 1 {
            write!(f, [soft_line_break_or_space(), "extends", group(&soft_line_indent_or_space(&heritage))]);
        } else {
            let format_extends = format_args!("extends", space(), heritage);
            match group_mode {
                true => write!(f, [soft_line_break_or_space(), group(&format_extends)]),
                false => write!(f, [space(), format_extends]),
            }
        }

        if !f.comments().has_leading_own_line_comment(body_span.start) {
            write!(f, [space(), format_leading_comments(body_span)]);
        }
    });

    let content = format_with(|f| {
        write!(f, [is_declared(statement).then_some("declare "), "interface", space()]);

        if !extends.is_empty() && group_mode {
            let heritage_id = f.group_id("heritageGroup");
            write!(f, [group(&format_args!(format_id, indent(&format_extends))).with_group_id(Some(heritage_id)), space()]);
        } else {
            write!(f, [format_id, format_extends]);
        }

        write!(f, [space(), "{"]);
        match interface.members().is_empty() {
            true => write!(f, format_dangling_comments(body_span).with_block_indent()),
            false => write!(f, block_indent(&format_with(|f| write_ts_interface_signatures(interface.members(), f)))),
        }
        write!(f, "}");
    });
    write!(f, group(&content));
}

/// `type A = B`. Prettier's `printTypeAlias`, with what its `printAssignment` does if the right side
/// is a type.
pub(crate) fn write_ts_type_alias_declaration<'a>(statement: Stmt<'a>, alias: Alias<'a>, f: &mut Formatter<'a>) {
    let node = AstNodes::TSTypeAliasDeclaration(statement);
    let ty = without_lone_operator(alias.ty());

    // The comments before the `;` of an export are behind it: see `Comments::without_semicolon`.
    let is_exported = !f.is_quiet() && matches!(statement.as_ast_nodes(), AstNodes::ExportNamedDeclaration(_));
    let view_limit = is_exported.then(|| {
        let end = f.comments().without_semicolon(statement.span()).end;
        f.comments_mut().limit_comments_up_to(end)
    });

    // Whether the left side is a group depends on the layout, which depends on the comments that
    // are left after the left side is written.
    let outer_group = f.reserve_tag();
    let left_group = f.reserve_tag();
    write!(f, [is_declared(statement).then_some("declare "), "type "]);
    let id = identifier(alias.name(), node);
    let left_end = if let Some(span) = alias.type_params().angle_brackets_span() {
        let type_parameters = type_parameters(alias.type_params(), Node::Stmt(statement));
        write!(f, [id, FormatNodeWithoutTrailingComments(&type_parameters)]);
        span.end
    } else {
        write!(f, FormatNodeWithoutTrailingComments(&id));
        id.span().end
    };
    if !f.is_quiet() {
        write!(f, FormatTrailingComments::Comments(comments_before_type_alias_operator(left_end, ty, f)));
    }

    let layout = type_alias_layout(alias, ty, f);
    if layout != AssignmentLikeLayout::BreakLeftHandSide {
        f.group_from(left_group, false);
    }
    write!(f, [space(), "="]);

    let right = format_with(|f| {
        match ty.kind() {
            // The comments before a union are written with it.
            TypeKind::Union(types) => {
                write_ts_union_type_in(ty, types, layout == AssignmentLikeLayout::BreakAfterOperator, f);
                write_trailing_comments_of(ty.as_ast_nodes(), f);
            }
            _ => write!(f, ty),
        }
        if ty != alias.ty() {
            write_trailing_comments_of(alias.ty().as_ast_nodes(), f);
        }
    });
    match layout {
        AssignmentLikeLayout::BreakAfterOperator => write!(f, group(&soft_line_indent_or_space(&right))),
        AssignmentLikeLayout::BreakLeftHandSide => write!(f, [space(), group(&right)]),
        _ => {
            let group_id = f.group_id("assignment_like");
            write!(
                f,
                [
                    group(&indent(&soft_line_break_or_space())).with_group_id(Some(group_id)),
                    line_suffix_boundary(),
                    indent_if_group_breaks(&right, group_id)
                ]
            );
        }
    }
    f.group_from(outer_group, false);
    write!(f, OptionalSemicolon);
    if let Some(view_limit) = view_limit {
        f.comments_mut().restore_view_limit(view_limit);
    }
}

/// Of the comments between the left side of a type alias, which ends at `start`, and the `=`, those
/// that trail the left side. All others, and those after the `=`, lead the type (Prettier's
/// `handleAssignmentLikeComments`).
fn comments_before_type_alias_operator<'a>(start: u32, ty: TypeNode<'a>, f: &Formatter<'a>) -> &'a [Comment] {
    let comments = f.comments().comments_before_character(start, b'=');
    let is_object = matches!(ty.kind(), TypeKind::Object(_));
    let count = comments
        .iter()
        .take_while(|comment| {
            !comment.preceded_by_newline() && !(comment.followed_by_newline() && (is_object || comment.is_block()))
        })
        .count();
    &comments[..count]
}

/// Prettier's `chooseLayout` for the type alias `alias`, whose type is `ty`.
fn type_alias_layout<'a>(alias: Alias<'a>, ty: TypeNode<'a>, f: &Formatter<'a>) -> AssignmentLikeLayout {
    let is_generic = |ty: TypeNode<'a>| match ty.kind() {
        TypeKind::Fn(func) => func.kind() == FnKind::FunctionType && !func.type_params().is_empty(),
        TypeKind::Ref { args, .. } => !args.is_empty(),
        _ => false,
    };
    let should_break_after_operator = match ty.kind() {
        TypeKind::Union(types) if !should_hug_type(ty, types, f) => true,
        TypeKind::Cond { check, extends, .. } if is_generic(check) || is_generic(extends) => true,
        _ => {
            !f.is_quiet()
                && f
                    .comments()
                    .comments_before_iter(ty.span().start)
                    .any(|comment| comment.followed_by_newline() || comment.is_indentable_block())
        }
    };
    if should_break_after_operator {
        return AssignmentLikeLayout::BreakAfterOperator;
    }
    // Prettier's `isComplexTypeAliasParams`.
    let params = alias.type_params();
    if params.len() > 1 && params.iter().any(|param| param.constraint().is_some() || param.default().is_some()) {
        return AssignmentLikeLayout::BreakLeftHandSide;
    }
    AssignmentLikeLayout::Fluid
}

/// `enum A { B, C = 1 }`
pub(crate) fn write_ts_enum_declaration<'a>(statement: Stmt<'a>, declaration: Enum<'a>, f: &mut Formatter<'a>) {
    let node = AstNodes::TSEnumDeclaration(statement);
    let is_const = statement.modifiers().iter().any(|it| it.flag() == Flags::CONST);
    write!(
        f,
        [
            is_declared(statement).then_some("declare "),
            is_const.then_some("const "),
            "enum",
            space(),
            identifier(declaration.name(), node),
            space(),
            "{"
        ]
    );
    let members = declaration.members();
    if members.is_empty() {
        write!(f, format_dangling_comments(declaration.body_span()).with_block_indent());
    } else {
        let is_consistent = f.options().quote_properties.is_consistent();
        if is_consistent {
            let quote_needed = members
                .iter()
                .any(|member| member.key().is_some_and(|key| key_requires_quotes(key, AstNodes::TSEnumMember(member), f)));
            f.context_mut().push_quote_needed(quote_needed);
        }
        write!(
            f,
            block_indent(&format_with(|f| {
                let trailing_separator = FormatTrailingCommas::ES5.trailing_separator(f.options());
                f.join_nodes_with_soft_line().entries_with_trailing_separator(members.iter(), ",", trailing_separator);
            }))
        );
        if is_consistent {
            f.context_mut().pop_quote_needed();
        }
    }
    write!(f, "}");
}

/// `A`, `A = 1`, `"a" = 1`
pub(crate) fn write_ts_enum_member<'a>(member: EnumMember<'a>, f: &mut Formatter<'a>) {
    if let Some(key) = member.key() {
        // `["a"]` is `"a"`. Only a template keeps its brackets.
        let is_computed = key.is_computed() && f.source_text().text_for(&key.inner_span(f.file())).starts_with(b"`");
        let key = FormatKey::new(key, AstNodes::TSEnumMember(member));
        write!(f, [is_computed.then_some("["), key, is_computed.then_some("]")]);
    }
    if let Some(init) = member.init() {
        write!(f, [space(), "=", space(), init]);
    }
}

/// `namespace A.B { .. }`, `declare module "a" { .. }`, `declare global { .. }`
pub(crate) fn write_ts_module_declaration<'a>(statement: Stmt<'a>, module: Module<'a>, f: &mut Formatter<'a>) {
    let node = statement.as_ast_nodes();
    write!(f, is_declared(statement).then_some("declare "));

    match module.name() {
        ModuleName::Global => {
            let comments_before_global = f.comments().comments_before(module.name_span().start);
            write!(f, [FormatLeadingComments::Comments(comments_before_global), "global"]);
        }
        ModuleName::String(name) => write!(
            f,
            [
                "module",
                space(),
                FormatStringLiteral {
                    span: name.span(),
                    parent: node
                }
            ]
        ),
        ModuleName::Ident(name) => {
            let keyword = if module.uses_module_keyword() { "module" } else { "namespace" };
            write!(f, [keyword, space(), identifier(name, node)]);
        }
    }

    let mut innermost = module;
    while let Some(nested) = innermost.nested() {
        if let ModuleName::Ident(name) = nested.name() {
            write!(f, [".", identifier(name, node)]);
        }
        innermost = nested;
    }

    let Some(span) = innermost.body_span() else {
        return write!(f, OptionalSemicolon);
    };
    write!(f, space());
    format_node(span, || node, f, |f| {
        write!(f, "{");
        match is_empty_block(innermost.body()) {
            true => write!(f, format_dangling_comments(span).with_block_indent()),
            false => write!(f, block_indent(&FormatStatements(innermost.body()))),
        }
        write!(f, "}");
    });
}

/// `import a = require("a")`, `import a = b.c`
pub(crate) fn write_ts_import_equals_declaration<'a>(
    statement: Stmt<'a>,
    import: ImportEquals<'a>,
    f: &mut Formatter<'a>,
) {
    let node = AstNodes::TSImportEqualsDeclaration(statement);
    write!(
        f,
        [
            "import",
            space(),
            import.flags().contains(Flags::TYPE_ONLY).then_some("type "),
            identifier(import.name(), node),
            space(),
            "=",
            space()
        ]
    );
    match (import.target(), import.require_span(), statement.module_specifier_span()) {
        (ImportEqualsTarget::Entity(name), ..) => write!(f, entity_name(name, node)),
        (ImportEqualsTarget::Require(_), Some(require_span), Some(span)) => {
            format_node(require_span, || node, f, |f| {
                let expression = FormatStringLiteral { span, parent: node };
                match f.comments().has_comment_in_span(require_span) {
                    true => write!(f, group(&format_args!("require(", soft_block_indent(&expression), ")"))),
                    false => write!(f, ["require(", expression, ")"]),
                }
            });
        }
        _ => {}
    }
    write!(f, OptionalSemicolon);
}

/// `export = a`
pub(crate) fn write_ts_export_assignment<'a>(expression: Expr<'a>, f: &mut Formatter<'a>) {
    write!(f, ["export = ", expression, OptionalSemicolon]);
}

/// `export as namespace a`
pub(crate) fn write_ts_namespace_export_declaration<'a>(statement: Stmt<'a>, f: &mut Formatter<'a>) {
    let id = statement.namespace_export_name().map(|it| identifier(it, AstNodes::TSNamespaceExportDeclaration(statement)));
    write!(f, ["export as namespace ", id, OptionalSemicolon]);
}
