//! The declarations of TypeScript.

use super::block_statement::is_empty_block;
use super::class::FormatClassImplements;
use super::import_declaration::FormatStringLiteral;
use super::intersection_type::lone_type_of_intersection_is_a_group;
use super::program::FormatStatements;
use super::semicolon::OptionalSemicolon;
use super::ts_types::{FormatModuleSpecifier, entity_name, write_ts_interface_signatures};
use super::type_parameters::{FormatTSTypeParametersOptions, type_parameters};
use super::union_type::{
    type_alias_union_breaks_after_operator, union_breaks_one_per_line, union_prints_itself,
    write_ts_union_type_in,
};
use crate::cursor::around_node;
use crate::js::format::{format_node, identifier, write_trailing_comments_of};
use crate::js::trivia::{comments_stay_between_head_and_body, write_head_body_separator};
use crate::js::utils::assignment_like::{
    AssignmentLikeLayout, operator_line_run, write_comments_before_operator,
};
use crate::js::utils::format_node_without_trailing_comments::FormatNodeWithoutTrailingComments;
use crate::js::utils::object::{FormatKey, key_requires_quotes};
use crate::js::utils::typescript::{should_hug_type, without_lone_operator};
use crate::prelude::*;
use crate::{format_args, write};

fn is_declared(statement: Stmt<'_>) -> bool {
    statement
        .modifiers()
        .iter()
        .any(|it| it.flag() == Flags::AMBIENT)
}

/// `interface A<T> extends B { .. }`
pub(crate) fn write_ts_interface_declaration<'a>(
    statement: Stmt<'a>,
    interface: Interface<'a>,
    f: &mut Formatter<'a>,
) {
    if f.file().is_flow() && super::flow::is_opaque_type(statement, f) {
        return super::flow::write_opaque_type(statement, interface, f);
    }
    let node = AstNodes::TSInterfaceDeclaration(statement);
    let id = identifier(interface.name(), node);
    let type_params = interface.type_params();
    let extends = interface.extends();
    let body_span = interface.body_span();

    // Whether the head is a group that can break before `extends`: there are several types, or one
    // that is `A.B` without type arguments, or a comment trails the name or the type parameters.
    let group_mode = extends.len() > 1
        || extends.first().is_some_and(|first| {
            let is_member = match first.kind() {
                TypeKind::Ref { name, args } => name.len() > 1 && args.is_empty(),
                TypeKind::Heritage { expr, args } => {
                    matches!(expr.kind(), ExprKind::Dot { .. } | ExprKind::Index { .. })
                        && args.is_empty()
                }
                _ => false,
            };
            // A comment after `extends` on its line leads the type. All others trail what is before.
            is_member || {
                let previous = type_params
                    .angle_brackets_span()
                    .unwrap_or_else(|| id.span());
                let comments = f.comments().comments_in(previous.between(first.span()));
                comments
                    .iter()
                    .any(|comment| comment.preceded_by_newline() || comment.followed_by_newline())
                    || comments.first().is_some_and(|comment| {
                        f.source_text()
                            .all_bytes(previous.between(comment.span), |b| b.is_ascii_whitespace())
                    })
            }
        });

    let format_id = format_with(|f| {
        match type_params.is_empty() && extends.is_empty() {
            true => FormatNodeWithoutTrailingComments(&id).fmt(f),
            false => write!(f, id),
        }
        if type_params.angle_brackets_span().is_some() {
            let options = FormatTSTypeParametersOptions {
                group_id: None,
                is_type_or_interface_decl: true,
            };
            type_parameters(type_params, Node::Stmt(statement))
                .with_options(options)
                .write_without_comments(f);
            if !extends.is_empty() {
                write_trailing_comments_of(
                    AstNodes::TSTypeParameterDeclaration(Node::Stmt(statement)),
                    f,
                );
            }
        }
    });

    let format_extends = format_with(|f| {
        let Some(first_extend) = extends.first() else {
            return;
        };
        if f.comments()
            .has_leading_own_line_comment(first_extend.span().start)
        {
            write!(
                f,
                FormatTrailingComments::Comments(
                    f.comments().comments_before(first_extend.span().start)
                )
            );
        }

        let heritage = FormatClassImplements(extends);
        if extends.len() > 1 {
            write!(
                f,
                [
                    soft_line_break_or_space(),
                    "extends",
                    group(&soft_line_indent_or_space(&heritage))
                ]
            );
        } else {
            let format_extends = format_args!("extends", space(), heritage);
            match group_mode {
                true => write!(f, [soft_line_break_or_space(), group(&format_extends)]),
                false => write!(f, [space(), format_extends]),
            }
        }
    });

    let content = format_with(|f| {
        write!(
            f,
            [
                is_declared(statement).then_some("declare "),
                "interface",
                space()
            ]
        );

        if !extends.is_empty() && group_mode {
            write!(f, group(&format_args!(format_id, indent(&format_extends))));
        } else {
            write!(f, [format_id, format_extends]);
        }

        // The comments on the line of the `{` stay before it. All others are in the body.
        if !f.is_quiet() && comments_stay_between_head_and_body(f) {
            write_head_body_separator(body_span.start, f);
        } else if !f.is_quiet() {
            let comments = f.comments().comments_before(body_span.start);
            if !comments
                .iter()
                .any(|comment| comment.preceded_by_newline() || comment.followed_by_newline())
            {
                write!(f, [space(), FormatLeadingComments::Comments(comments)]);
            }
        }
        write!(f, space());
        around_node(body_span, f, |f| {
            write!(f, "{");
            match interface.members().is_empty() {
                true => write!(f, format_dangling_comments(body_span).with_block_indent()),
                false => {
                    write!(
                        f,
                        block_indent(&format_with(|f| write_ts_interface_signatures(
                            interface.members(),
                            f
                        )))
                    );
                }
            }
            write!(f, "}");
        });
    });
    write!(f, group(&content));
}

/// `type A = B /* comment */;` is `type A = B; /* comment */` for oxfmt, as after any other statement.
/// Prettier does that only if the type is exported.
fn comments_before_semicolon_of_type_alias_go_behind_it(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

/// `type A = B`. Prettier's `printTypeAlias`, with what its `printAssignment` does if the right side
/// is a type.
pub(crate) fn write_ts_type_alias_declaration<'a>(
    statement: Stmt<'a>,
    alias: Alias<'a>,
    f: &mut Formatter<'a>,
) {
    if f.file().is_flow() && super::flow::write_what_is_no_type_alias(statement, alias, f) {
        return;
    }
    let node = AstNodes::TSTypeAliasDeclaration(statement);
    let ty = without_lone_operator(alias.ty());

    // The comments before the `;` of an export are behind it: see `Comments::without_semicolon`.
    let is_exported = !f.is_quiet()
        && (comments_before_semicolon_of_type_alias_go_behind_it(f)
            || matches!(
                statement.as_ast_nodes(),
                AstNodes::ExportNamedDeclaration(_)
            ));
    let view_limit = is_exported.then(|| {
        let end = match comments_before_semicolon_of_type_alias_go_behind_it(f) {
            // Without the parentheses around the type, which are not written.
            true => ty.span().end,
            false => f.comments().without_semicolon(statement.span()).end,
        };
        f.comments_mut().limit_comments_up_to(end)
    });

    // Whether the left side is a group depends on the layout, which depends on the comments that
    // are left after the left side is written.
    let outer_group = f.reserve_tag();
    let left_group = f.reserve_tag();
    write!(f, [is_declared(statement).then_some("declare "), "type "]);
    let id = identifier(alias.name(), node);
    if alias.type_params().angle_brackets_span().is_some() {
        let type_parameters = type_parameters(alias.type_params(), Node::Stmt(statement));
        write!(f, [id, FormatNodeWithoutTrailingComments(&type_parameters)]);
    } else {
        write!(f, FormatNodeWithoutTrailingComments(&id));
    }
    // What oxfmt writes behind the `=`, and whether a line comment is on the line of the `=`.
    let mut operator_line: (&[Comment], bool) = (&[], false);
    if !f.is_quiet() {
        match type_alias_comments_stay_behind_operator(f) {
            true => operator_line = write_comments_after_type_alias_left_side(alias, f),
            false => {
                write!(
                    f,
                    FormatTrailingComments::Comments(comments_before_type_alias_operator(
                        id.span().end,
                        ty,
                        f
                    ))
                );
            }
        }
    }
    let (operator_line_run, has_line_comment_on_operator_line) = operator_line;

    let layout = match type_alias_layout(statement, alias, ty, f) {
        AssignmentLikeLayout::Fluid | AssignmentLikeLayout::NeverBreakAfterOperator
            if has_line_comment_on_operator_line =>
        {
            AssignmentLikeLayout::BreakAfterOperator
        }
        layout => layout,
    };
    if layout != AssignmentLikeLayout::BreakLeftHandSide {
        f.group_from(left_group, false);
    }
    write!(f, [space(), "="]);
    if !operator_line_run.is_empty() {
        write!(f, FormatTrailingComments::Comments(operator_line_run));
        if operator_line_run
            .iter()
            .any(|comment| f.comments().is_suppression_comment(comment))
        {
            f.comments_mut()
                .mark_suppressed_after_operator(ty.span().start);
        }
    }

    let right = format_with(|f| {
        match ty.kind() {
            // The comments before a union are written with it.
            TypeKind::Union(types) => {
                let is_indented = layout == AssignmentLikeLayout::BreakAfterOperator;
                around_node(ty.span(), f, |f| {
                    write_ts_union_type_in(ty, types, is_indented, f)
                });
                write_trailing_comments_of(ty.as_ast_nodes(), f);
            }
            _ if ty != alias.ty()
                && matches!(alias.ty().kind(), TypeKind::Intersection(_))
                && lone_type_of_intersection_is_a_group(f) =>
            {
                write!(f, group(&ty))
            }
            _ => write!(f, ty),
        }
        if ty != alias.ty() {
            write_trailing_comments_of(alias.ty().as_ast_nodes(), f);
        }
    });
    match layout {
        // A line comment that has been written after the `=` stays there.
        AssignmentLikeLayout::BreakAfterOperator
            if type_alias_comments_stay_behind_operator(f)
                && (has_line_comment_on_operator_line
                    || !matches!(ty.kind(), TypeKind::Cond { .. })) =>
        {
            write!(f, soft_line_indent_or_space(&right));
        }
        AssignmentLikeLayout::BreakAfterOperator => {
            write!(f, group(&soft_line_indent_or_space(&right)))
        }
        AssignmentLikeLayout::BreakLeftHandSide => write!(f, [space(), group(&right)]),
        AssignmentLikeLayout::NeverBreakAfterOperator => write!(f, [space(), right]),
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

/// oxfmt follows Prettier 3.8: a line comment behind the `=` of a type alias trails the left side.
/// For 3.9 every comment after the `=` leads the type.
///
/// ```ts
/// type A = // comment      type A =
///   B;                       // comment
///                            B;
/// ```
fn type_alias_comments_stay_behind_operator(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

/// What oxc's `AssignmentLike::fmt` does with the comments between the two sides of a type alias: it
/// writes those that trail the left side. Returns those to write behind the `=`, and whether a line
/// comment is on the line of the `=`. See `comments_stay_around_operator`.
fn write_comments_after_type_alias_left_side<'a>(
    alias: Alias<'a>,
    f: &mut Formatter<'a>,
) -> (&'a [Comment], bool) {
    let left_end = alias
        .type_params()
        .angle_brackets_span()
        .map_or_else(|| alias.name().span().end, |it| it.end);
    if !f
        .comments()
        .has_any_comment_in(Span::before(left_end, alias.ty().span()))
    {
        return (&[], false);
    }
    let operator_end = f.comments().position_after_character(left_end, b'=');
    let previous_limit = f.comments_mut().limit_comments_up_to(operator_end);
    write_comments_before_operator(left_end, f);
    f.comments_mut().restore_view_limit(previous_limit);
    let run = operator_line_run(operator_end, f);
    (
        run,
        !run.is_empty() || f.comments().has_printed_line_comment_after(left_end),
    )
}

/// Of the comments that are left between the name of a type alias, which ends at `start`, and the
/// first `=` after it, those that trail the left side. All others lead the type (Prettier's
/// `handleAssignmentLikeComments`, for which the `=` of a default type is as good as any).
fn comments_before_type_alias_operator<'a>(
    start: u32,
    ty: TypeNode<'a>,
    f: &Formatter<'a>,
) -> &'a [Comment] {
    let comments = f.comments().comments_before_character(start, b'=');
    let is_object = matches!(ty.kind(), TypeKind::Object(_));
    let count = comments
        .iter()
        .take_while(|comment| {
            !comment.preceded_by_newline()
                && !(comment.followed_by_newline() && (is_object || comment.is_block()))
        })
        .count();
    &comments[..count]
}

/// Prettier's `chooseLayout` for the type alias `alias`, whose type is `ty`.
fn type_alias_layout<'a>(
    statement: Stmt<'a>,
    alias: Alias<'a>,
    ty: TypeNode<'a>,
    f: &Formatter<'a>,
) -> AssignmentLikeLayout {
    let is_generic = |ty: TypeNode<'a>| match ty.kind() {
        TypeKind::Fn(func) => func.kind() == FnKind::FunctionType && !func.type_params().is_empty(),
        TypeKind::Ref { args, .. } => !args.is_empty(),
        _ => false,
    };
    let should_break_after_operator = match ty.kind() {
        TypeKind::Union(types)
            if !union_breaks_one_per_line(f) && !should_hug_type(ty, types, f) =>
        {
            true
        }
        _ if type_alias_comments_stay_behind_operator(f)
            && !f.is_quiet()
            && f.comments()
                .comments_before_iter(ty.span().start)
                .any(|comment| comment.is_indentable_block()) =>
        {
            true
        }
        // It is up to the union where it breaks, unless it leaves that to the `=`.
        TypeKind::Union(_)
            if type_alias_comments_stay_behind_operator(f) && union_prints_itself(ty, f) =>
        {
            !f.is_quiet()
                && type_alias_union_breaks_after_operator(
                    statement,
                    f.comments().comments_before(ty.span().start),
                    f,
                )
        }
        _ if type_alias_comments_stay_behind_operator(f)
            && f.comments().has_leading_own_line_comment(ty.span().start) =>
        {
            true
        }
        TypeKind::Cond { check, extends, .. }
            if f.options().experimental_ternaries || is_generic(check) || is_generic(extends) =>
        {
            true
        }
        // Flow's `StringLiteralTypeAnnotation`
        TypeKind::StringLit(_) if f.file().is_javascript() => true,
        _ => {
            !f.is_quiet()
                && f.comments()
                    .comments_before_iter(ty.span().start)
                    .any(|comment| comment.followed_by_newline() || comment.is_indentable_block())
        }
    };
    if should_break_after_operator {
        return AssignmentLikeLayout::BreakAfterOperator;
    }
    // Prettier's `isComplexTypeAliasParams`.
    let params = alias.type_params();
    if params.len() > 1
        && params
            .iter()
            .any(|param| param.constraint().is_some() || param.default().is_some())
    {
        return AssignmentLikeLayout::BreakLeftHandSide;
    }
    // It is up to the union where it breaks, also if it has nowhere to.
    if union_breaks_one_per_line(f) && union_prints_itself(ty, f) {
        return AssignmentLikeLayout::NeverBreakAfterOperator;
    }
    AssignmentLikeLayout::Fluid
}

/// `enum A { B, C = 1 }`
pub(crate) fn write_ts_enum_declaration<'a>(
    statement: Stmt<'a>,
    declaration: Enum<'a>,
    f: &mut Formatter<'a>,
) {
    let node = AstNodes::TSEnumDeclaration(statement);
    let is_const = statement
        .modifiers()
        .iter()
        .any(|it| it.flag() == Flags::CONST);
    write!(
        f,
        [
            is_declared(statement).then_some("declare "),
            is_const.then_some("const "),
            "enum",
            space(),
        ]
    );
    let name = identifier(declaration.name(), node);
    if !f.is_quiet() && comments_stay_between_head_and_body(f) {
        write!(f, FormatNodeWithoutTrailingComments(&name));
        write_head_body_separator(declaration.body_span().start, f);
    } else {
        write!(
            f,
            [
                name,
                space(),
                format_leading_comments(declaration.body_span())
            ]
        );
    }
    if f.file().is_flow() {
        super::flow::write_explicit_type_of_enum(declaration, f);
    }
    around_node(declaration.body_span(), f, |f| {
        write_ts_enum_body(declaration, f)
    });
}

fn write_ts_enum_body<'a>(declaration: Enum<'a>, f: &mut Formatter<'a>) {
    write!(f, "{");
    let members = declaration.members();
    if members.is_empty() {
        // Prettier's `printObject`: the group of an enum breaks, with nothing in it as well.
        write!(
            f,
            [
                format_dangling_comments(declaration.body_span()).with_soft_block_indent(),
                expand_parent()
            ]
        );
    } else {
        let is_consistent = f.options().quote_properties.is_consistent();
        if is_consistent {
            let quote_needed = members.iter().any(|member| {
                member
                    .key()
                    .is_some_and(|key| key_requires_quotes(key, AstNodes::TSEnumMember(member), f))
            });
            f.context_mut().push_quote_needed(quote_needed);
        }
        write!(
            f,
            block_indent(&format_with(|f| {
                let trailing_separator = match members
                    .last()
                    .is_some_and(super::flow::is_unknown_members_mark)
                {
                    true => TrailingSeparator::Disallowed,
                    false => FormatTrailingCommas::ES5.trailing_separator(f.options()),
                };
                f.join_nodes_with_soft_line()
                    .entries_with_trailing_separator(members.iter(), ",", trailing_separator);
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
    if super::flow::is_unknown_members_mark(member) {
        return write!(f, "...");
    }
    if let Some(key) = member.key() {
        // `["a"]` is `"a"`. Only a template keeps its brackets.
        let is_computed = key.is_computed()
            && f.source_text()
                .text_for(&key.inner_span(f.file()))
                .starts_with(b"`");
        let key = FormatKey::new(key, AstNodes::TSEnumMember(member));
        write!(
            f,
            [is_computed.then_some("["), key, is_computed.then_some("]")]
        );
    }
    if let Some(init) = member.init() {
        write!(f, [space(), "=", space(), init]);
    }
}

/// `namespace A.B { .. }`, `declare module "a" { .. }`, `declare global { .. }`
pub(crate) fn write_ts_module_declaration<'a>(
    statement: Stmt<'a>,
    module: Module<'a>,
    f: &mut Formatter<'a>,
) {
    let node = statement.as_ast_nodes();
    let innermost = module.innermost();
    let body_span = innermost.body_span();
    write!(f, is_declared(statement).then_some("declare "));

    // Which of the comments after the name trail it depends on the body.
    let name_end = innermost.name_span().end;
    let view_limit = (!f.is_quiet()).then(|| f.comments_mut().limit_comments_up_to(name_end));
    match module.name() {
        ModuleName::Global => {
            let comments_before_global = f.comments().comments_before(module.name_span().start);
            write!(
                f,
                [
                    FormatLeadingComments::Comments(comments_before_global),
                    "global"
                ]
            );
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
            let keyword = if module.uses_module_keyword() {
                "module"
            } else {
                "namespace"
            };
            write!(f, [keyword, space(), identifier(name, node)]);
        }
    }
    let mut current = module;
    while let Some(nested) = current.nested() {
        if let ModuleName::Ident(name) = nested.name() {
            write!(f, [".", identifier(name, node)]);
        }
        current = nested;
    }
    if let Some(view_limit) = view_limit {
        f.comments_mut().restore_view_limit(view_limit);
        if !(body_span.is_some() && comments_stay_between_head_and_body(f)) {
            let following = body_span.map_or(0, |it| it.start);
            write!(
                f,
                format_trailing_comments(statement.span(), innermost.name_span(), following)
            );
        }
    }

    let Some(span) = body_span else {
        return write!(f, OptionalSemicolon);
    };
    match !f.is_quiet() && comments_stay_between_head_and_body(f) {
        true => write_head_body_separator(span.start, f),
        false => write!(f, space()),
    }
    format_node(
        span,
        || node,
        f,
        |f| {
            write!(f, "{");
            match is_empty_block(innermost.body()) {
                // Prettier's `printBlock` does not know Flow's `declare namespace`.
                true if f.file().is_flow()
                    && !module.uses_module_keyword()
                    && !f.comments().has_comment_in_span(span) =>
                {
                    write!(f, hard_line_break());
                }
                true => write!(f, format_dangling_comments(span).with_block_indent()),
                false => write!(f, block_indent(&FormatStatements(innermost.body()))),
            }
            write!(f, "}");
        },
    );
}

/// `require(/* comment */ "a")` is on three lines for oxfmt, whatever the comment is.
fn require_with_comment_breaks(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
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
    match (
        import.target(),
        import.require_span(),
        statement.module_specifier_span(),
    ) {
        (ImportEqualsTarget::Entity(name), ..) => write!(f, entity_name(name, node)),
        (ImportEqualsTarget::Require(_), Some(require_span), Some(span)) => {
            format_node(
                require_span,
                || node,
                f,
                |f| {
                    let expression = FormatModuleSpecifier {
                        span,
                        parent: node,
                        call_span: require_span,
                    };
                    match f.comments().has_comment_in_span(require_span) {
                        true if require_with_comment_breaks(f) => {
                            write!(f, ["require(", block_indent(&expression), ")"])
                        }
                        true => write!(
                            f,
                            group(&format_args!(
                                "require(",
                                soft_block_indent(&expression),
                                ")"
                            ))
                        ),
                        false => write!(f, ["require(", expression, ")"]),
                    }
                },
            );
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
pub(crate) fn write_ts_namespace_export_declaration<'a>(
    statement: Stmt<'a>,
    f: &mut Formatter<'a>,
) {
    let id = statement
        .namespace_export_name()
        .map(|it| identifier(it, AstNodes::TSNamespaceExportDeclaration(statement)));
    write!(f, ["export as namespace ", id, OptionalSemicolon]);
}
