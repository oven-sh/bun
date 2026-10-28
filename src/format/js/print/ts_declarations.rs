//! TypeScript's declarations.

use super::block_statement::is_empty_block;
use super::import_declaration::FormatStringLiteral;
use super::intersection_type::groups_single_type_intersection;
use super::program::FormatStatements;
use super::semicolon::OptionalSemicolon;
use super::ts_types::{entity_name, write_ts_interface_signatures};
use super::type_parameters::{FormatTSTypeParametersOptions, type_parameters};
use super::union_type::{
    type_alias_union_breaks_after_operator, union_breaks_one_per_line, union_prints_itself,
    union_prints_own_comments, write_ts_union_type_in,
};
use crate::cursor::with_node_marks;
use crate::js::comments::OwnedComments;
use crate::js::format::{
    format_ignorable_name, format_name, format_node, identifier, name_without_comments,
    write_ignored_node,
};
use crate::js::utils::assignment_like::AssignmentLikeLayout;
use crate::js::utils::object::{FormatKey, key_requires_quotes};
use crate::js::utils::statement_body::write_space_before_body;
use crate::js::utils::typescript::{should_hug_type, without_lone_operator};
use crate::prelude::*;
use crate::{format_args, write};

fn is_declared(statement: Stmt<'_>) -> bool {
    statement
        .modifiers()
        .iter()
        .any(|it| it.flag() == Flags::AMBIENT)
}

/// An interface's name or type parameters, with the comments it owns in `owned`. Prettier's `printClass` indents the
/// trailing comments.
fn write_part_of_interface_head<'a>(
    owned: &OwnedComments<'a>,
    part: &impl Format<'a>,
    f: &mut Formatter<'a>,
) {
    let trailing_comments = FormatTrailingComments::Comments(owned.trailing);
    write!(f, [FormatLeadingComments::Comments(owned.leading), part]);
    match only_comments_at_end_or_start_of_line_are_indented(f)
        && !(owned.trailing.iter())
            .any(|comment| comment.has_newline_before() || comment.has_newline_after())
    {
        true => write!(f, trailing_comments),
        false => write!(f, indent(&trailing_comments)),
    }
}

/// ```ts
/// interface A /**        interface A /**
///  * comment                * comment
///  */                       */
///   extends B {}           extends B {}
/// ```
///
/// oxfmt is on the left, Prettier on the right.
fn only_comments_at_end_or_start_of_line_are_indented(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

/// ```ts
/// interface A< // comment      interface A< // comment
///   T,                           T,
/// > extends B {}               >
///                                extends B {}
/// ```
///
/// oxfmt is on the left, Prettier on the right. The comment trails the name.
fn only_comments_before_extends_break_the_head(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

/// `interface A<T> extends B { .. }`. Prettier's `printClass`.
#[inline(never)]
pub(crate) fn write_ts_interface_declaration<'a>(
    statement: Stmt<'a>,
    interface: Interface<'a>,
    f: &mut Formatter<'a>,
) {
    if f.file().is_flow() && super::flow::is_opaque_type(statement, f) {
        return super::flow::write_opaque_type(statement, interface, f);
    }
    let name = interface.name().span();
    let type_params = interface.type_params();
    let extends = interface.extends();
    let name_comments = f.comments().of_name(name.start);
    let type_parameters_node = AstNodes::TSTypeParameterDeclaration(Node::Stmt(statement));
    let type_parameters_comments = f.comments().of_node(type_parameters_node);

    // Prettier's `shouldPrintClassInGroupMode`: the head can break before `extends`.
    let group_mode = extends.len() > 1
        || (!name_comments.trailing.is_empty()
            && !(only_comments_before_extends_break_the_head(f)
                && type_params.angle_brackets_span().is_some()))
        || !type_parameters_comments.trailing.is_empty()
        || extends.first().is_some_and(|first| match first.kind() {
            TypeKind::Ref { name, args } => name.len() > 1 && args.is_empty(),
            TypeKind::Heritage { expr, args } => {
                matches!(expr.kind(), ExprKind::Dot { .. } | ExprKind::Index { .. })
                    && args.is_empty()
            }
            _ => false,
        });

    let format_name_and_type_parameters = format_with(|f| {
        write_part_of_interface_head(&name_comments, &name_without_comments(name), f);
        if type_params.angle_brackets_span().is_some() {
            let options = FormatTSTypeParametersOptions {
                group_id: None,
                is_type_or_interface_decl: true,
            };
            let type_parameters = format_with(|f| {
                if type_parameters_comments.is_ignored {
                    return write_ignored_node(type_parameters_node, f);
                }
                f.track_cursor(type_parameters_node.span(), |f| {
                    type_parameters(type_params, Node::Stmt(statement))
                        .with_options(options)
                        .write_without_comments(f);
                });
            });
            write_part_of_interface_head(&type_parameters_comments, &type_parameters, f);
        }
    });

    // Prettier's `printHeritageClauses`.
    let format_extends = format_with(|f| {
        if extends.is_empty() {
            return;
        }
        let comments_before_keyword = (f
            .comments()
            .of_node(AstNodes::TSInterfaceDeclaration(statement)))
        .dangling;
        let format_comments_before_keyword = FormatDanglingComments::Comments {
            comments: comments_before_keyword,
            indent: DanglingIndentMode::None,
        };
        let heritage = format_with(|f| {
            f.join_with(soft_line_break_or_space())
                .entries_with_trailing_separator(
                    extends.iter(),
                    ",",
                    TrailingSeparator::Disallowed,
                );
        });
        if extends.len() > 1 {
            write!(
                f,
                [
                    soft_line_break_or_space(),
                    format_comments_before_keyword,
                    (!comments_before_keyword.is_empty()).then_some(hard_line_break()),
                    "extends",
                    group(&soft_line_indent_or_space(&heritage))
                ]
            );
        } else {
            let format_extends =
                format_args!("extends", space(), format_comments_before_keyword, heritage);
            match group_mode {
                true => write!(f, [soft_line_break_or_space(), group(&format_extends)]),
                false => write!(f, [space(), format_extends]),
            }
        }
    });

    let body = AstNodes::TSInterfaceBody(statement);
    let content = format_with(|f| {
        write!(
            f,
            [
                is_declared(statement).then_some("declare "),
                "interface",
                space()
            ]
        );
        match group_mode {
            true => write!(
                f,
                group(&format_args!(
                    format_name_and_type_parameters,
                    indent(&format_extends)
                ))
            ),
            false => write!(f, [format_name_and_type_parameters, format_extends]),
        }
        write_space_before_body(body, f);
        format_node(body, f, |f| {
            write!(f, "{");
            match interface.members().is_empty() {
                true => write!(f, dangling_comments(body).with_block_indent()),
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

/// `type A = B`. Prettier's `printTypeAlias`, plus what its `printAssignment` does if the right side is a type.
#[inline(never)]
pub(crate) fn write_ts_type_alias_declaration<'a>(
    statement: Stmt<'a>,
    alias: Alias<'a>,
    f: &mut Formatter<'a>,
) {
    if f.file().is_flow() && super::flow::write_pseudo_type_alias(statement, alias, f) {
        return;
    }
    let ty = without_lone_operator(alias.ty());
    let right_node = ty.as_ast_nodes();

    let comments_after_operator = comments_after_type_alias_operator(statement, f);
    let has_line_comment_on_operator_line = !comments_after_operator.is_empty()
        || (type_alias_comments_stay_around_operator(f)
            && (comments_trailing_type_alias_left_side(statement, f).last())
                .is_some_and(|comment| comment.is_line()));
    let layout = match has_line_comment_on_operator_line {
        true => AssignmentLikeLayout::BreakAfterOperator,
        false => type_alias_layout(statement, alias, ty, f),
    };

    let left = format_with(|f| {
        write!(
            f,
            [
                is_declared(statement).then_some("declare "),
                "type ",
                identifier(alias.name())
            ]
        );
        if alias.type_params().angle_brackets_span().is_some() {
            let options = FormatTSTypeParametersOptions {
                group_id: None,
                is_type_or_interface_decl: true,
            };
            let type_parameters =
                type_parameters(alias.type_params(), Node::Stmt(statement)).with_options(options);
            let node = AstNodes::TSTypeParameterDeclaration(Node::Stmt(statement));
            format_node(node, f, |f| type_parameters.write_without_comments(f));
        }
    });
    let right = format_with(|f| match ty.kind() {
        TypeKind::Union(types)
            if layout == AssignmentLikeLayout::BreakAfterOperator
                && union_prints_own_comments(ty, f)
                && !f.comments().is_ignored(right_node) =>
        {
            with_node_marks(ty.span(), f, |f| write_ts_union_type_in(ty, types, true, f));
        }
        _ if ty != alias.ty()
            && matches!(alias.ty().kind(), TypeKind::Intersection(_))
            && groups_single_type_intersection(f) =>
        {
            write!(f, group(&ty))
        }
        _ => write!(f, ty),
    });
    let content = format_with(|f| {
        match layout {
            AssignmentLikeLayout::BreakLeftHandSide => write!(f, left),
            _ => write!(f, group(&left)),
        }
        write!(
            f,
            [
                space(),
                "=",
                FormatTrailingComments::Comments(comments_after_operator)
            ]
        );
        match layout {
            // A line comment that was printed after the `=` stays there.
            AssignmentLikeLayout::BreakAfterOperator
                if type_alias_comments_stay_around_operator(f)
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
    });
    write!(f, [group(&content), OptionalSemicolon]);
}

/// oxfmt follows Prettier 3.8: a comment that ends the line of a type alias's left side, or the `=`'s line, stays
/// there. In 3.9 it leads the type.
///
/// ```ts
/// type A = // comment      type A =
///   B;                       // comment
///                            B;
/// ```
fn type_alias_comments_stay_around_operator(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

/// The trailing comments of the type alias `statement`'s name, or of its type parameters if it has any.
pub(super) fn comments_trailing_type_alias_left_side<'a>(
    statement: Stmt<'a>,
    f: &Formatter<'a>,
) -> CommentList<'a> {
    let StmtKind::TypeAlias(alias) = statement.kind() else {
        return CommentList::empty();
    };
    match alias.type_params().angle_brackets_span() {
        Some(_) => {
            let type_parameters = AstNodes::TSTypeParameterDeclaration(Node::Stmt(statement));
            f.comments().of_node(type_parameters).trailing
        }
        None => f.comments().of_name(alias.name().span().start).trailing,
    }
}

/// See [`type_alias_comments_stay_around_operator`]: the comments that stay after the `=` are dangling comments of the
/// type alias `statement`.
pub(super) fn comments_after_type_alias_operator<'a>(
    statement: Stmt<'a>,
    f: &Formatter<'a>,
) -> CommentList<'a> {
    match f.is_quiet() {
        true => CommentList::empty(),
        false => {
            (f.comments()
                .of_node(AstNodes::TSTypeAliasDeclaration(statement)))
            .dangling
        }
    }
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
    let leading_comments = match f.is_quiet() {
        true => CommentList::empty(),
        false => f.comments().of_node(ty.as_ast_nodes()).leading,
    };
    let should_break_after_operator = match ty.kind() {
        TypeKind::Union(types) if !union_breaks_one_per_line(f) && !should_hug_type(types, f) => {
            true
        }
        _ if type_alias_comments_stay_around_operator(f)
            && (leading_comments.iter()).any(|comment| comment.is_indentable_block()) =>
        {
            true
        }
        // The union decides where it breaks, unless it leaves that to the `=`.
        TypeKind::Union(_)
            if type_alias_comments_stay_around_operator(f) && union_prints_itself(ty, f) =>
        {
            type_alias_union_breaks_after_operator(statement, ty, f)
        }
        TypeKind::Cond { check, extends, .. }
            if f.options().experimental_ternaries || is_generic(check) || is_generic(extends) =>
        {
            true
        }
        // Flow's `StringLiteralTypeAnnotation`
        TypeKind::StringLit(_) if f.file().is_javascript() => true,
        _ => (leading_comments.iter())
            .any(|comment| comment.has_newline_after() || comment.is_indentable_block()),
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
    // The union decides where it breaks, even if it has nowhere to break.
    if union_breaks_one_per_line(f) && union_prints_itself(ty, f) {
        return AssignmentLikeLayout::NeverBreakAfterOperator;
    }
    AssignmentLikeLayout::Fluid
}

/// `enum A { B, C = 1 }`
#[inline(never)]
pub(crate) fn write_ts_enum_declaration<'a>(
    statement: Stmt<'a>,
    declaration: Enum<'a>,
    f: &mut Formatter<'a>,
) {
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
    let body = AstNodes::TSEnumBody(statement);
    write!(f, identifier(declaration.name()));
    write_space_before_body(body, f);
    format_node(body, f, |f| {
        if f.file().is_flow() {
            super::flow::write_explicit_type_of_enum(declaration, f);
        }
        write_ts_enum_body(body, declaration, f);
    });
}

fn write_ts_enum_body<'a>(body: AstNodes<'a>, declaration: Enum<'a>, f: &mut Formatter<'a>) {
    write!(f, "{");
    let members = declaration.members();
    if members.is_empty() {
        // Prettier's `printObject`: an enum's group breaks even when it's empty.
        write!(
            f,
            [
                dangling_comments(body).with_soft_block_indent(),
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
                // Flow's `enum A { /* comment */ ... }`
                let comments = f.comments().of_node(body).dangling;
                write!(
                    f,
                    [
                        FormatDanglingComments::Comments {
                            comments,
                            indent: DanglingIndentMode::None
                        },
                        (!comments.is_empty()).then_some(hard_line_break())
                    ]
                );
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
        // `["a"]` prints as `"a"`. Only a template keeps its brackets.
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
#[inline(never)]
pub(crate) fn write_ts_module_declaration<'a>(
    statement: Stmt<'a>,
    module: Module<'a>,
    f: &mut Formatter<'a>,
) {
    let innermost = module.innermost();
    let body_span = innermost.body_span();
    write!(f, is_declared(statement).then_some("declare "));

    match module.name() {
        ModuleName::Global => format_name(module.name_span(), f, |f| write!(f, "global")),
        ModuleName::String(name) => write!(
            f,
            ["module", space(), FormatStringLiteral { span: name.span() }]
        ),
        ModuleName::Ident(name) => {
            let keyword = if module.uses_module_keyword() {
                "module"
            } else {
                "namespace"
            };
            write!(f, [keyword, space(), identifier(name)]);
        }
    }
    let mut current = module;
    while let Some(nested) = current.nested() {
        if let ModuleName::Ident(name) = nested.name() {
            write!(f, [".", identifier(name)]);
        }
        current = nested;
    }

    let Some(span) = body_span else {
        return write!(f, OptionalSemicolon);
    };
    let body = AstNodes::TSModuleBlock(statement);
    write_space_before_body(body, f);
    format_node(body, f, |f| {
        write!(f, "{");
        match is_empty_block(innermost.body()) {
            // Prettier's `printBlock` doesn't know Flow's `declare namespace`.
            true if f.file().is_flow()
                && !module.uses_module_keyword()
                && !f.comments().has_comment_in_span(span) =>
            {
                write!(f, hard_line_break());
            }
            true => write!(f, dangling_comments(body).with_block_indent()),
            false => write!(f, block_indent(&FormatStatements(innermost.body()))),
        }
        write!(f, "}");
    });
}

/// oxfmt prints `require(/* comment */ "a")` on three lines, whatever the comment is.
fn require_with_comment_breaks(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

/// `import a = require("a")`, `import a = b.c`
#[inline(never)]
pub(crate) fn write_ts_import_equals_declaration<'a>(
    statement: Stmt<'a>,
    import: ImportEquals<'a>,
    f: &mut Formatter<'a>,
) {
    write!(
        f,
        [
            "import",
            space(),
            import.flags().contains(Flags::TYPE_ONLY).then_some("type "),
            identifier(import.name()),
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
        (ImportEqualsTarget::Entity(name), ..) => write!(f, entity_name(name)),
        (ImportEqualsTarget::Require(_), Some(require_span), Some(span)) => {
            format_ignorable_name(require_span, f, |f| {
                let expression = FormatStringLiteral { span };
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
            });
        }
        _ => {}
    }
    write!(f, OptionalSemicolon);
}

/// `export = a`
#[inline(never)]
pub(crate) fn write_ts_export_assignment<'a>(expression: Expr<'a>, f: &mut Formatter<'a>) {
    write!(f, ["export = ", expression, OptionalSemicolon]);
}

/// `export as namespace a`
#[inline(never)]
pub(crate) fn write_ts_namespace_export_declaration<'a>(
    statement: Stmt<'a>,
    f: &mut Formatter<'a>,
) {
    let id = statement.namespace_export_name().map(|it| identifier(it));
    write!(f, ["export as namespace ", id, OptionalSemicolon]);
}
