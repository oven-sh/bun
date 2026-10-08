//! `<T, U>`: type parameters and type arguments.

use crate::js::format::{format_node, identifier};
use crate::js::utils::call_expression::is_test_call_expression;
use crate::js::utils::typescript::{is_object_like_type, is_simple_type, should_hug_type};
use crate::prelude::*;
use crate::{format_args, write};

/// `const in out T extends C = D`
pub(crate) fn write_ts_type_parameter<'a>(param: TypeParam<'a>, f: &mut Formatter<'a>) {
    let flags = param.flags();
    for (flag, keyword) in [(Flags::CONST, "const"), (Flags::IN, "in"), (Flags::OUT, "out")] {
        if flags.contains(flag) {
            write!(f, [keyword, space()]);
        }
    }
    write!(f, identifier(param.name(), AstNodes::TSTypeParameter(param)));

    if let Some(constraint) = param.constraint() {
        write_type_parameter_bound("extends", constraint, f);
    }
    if let Some(default) = param.default() {
        write_type_parameter_bound("=", default, f);
    }
}

/// ` extends T`, ` = T`
fn write_type_parameter_bound<'a>(operator: &'static str, ty: TypeNode<'a>, f: &mut Formatter<'a>) {
    let group_id = f.group_id("bound");
    // A union that breaks starts with a line break. If there is one after the operator as well,
    // Prettier writes both. The empty text is what makes the second one count.
    let is_union = matches!(ty.kind(), TypeKind::Union(types) if types.len() > 1);
    write!(
        f,
        [
            space(),
            operator,
            group(&indent(&soft_line_break_or_space())).with_group_id(Some(group_id)),
            line_suffix_boundary(),
            indent_if_group_breaks(&format_args!(is_union.then_some(""), ty), group_id)
        ]
    );
}

/// Prettier's `shouldForceTrailingComma`: `<T,>() => {}` in a `.tsx` file, where `<T>` would be
/// the start of an element.
fn should_force_trailing_comma_for_arrow_function<'a>(
    params: List<'a, TypeParam<'a>>,
    owner: Node<'a>,
    f: &Formatter<'a>,
) -> bool {
    params.len() == 1
        && matches!(owner, Node::Func(func) if func.is_arrow())
        && !params.first().is_some_and(|param| param.constraint().is_some())
        && !f.filepath().ends_with(b".ts")
}

#[derive(Default, Copy, Clone)]
pub(crate) struct FormatTSTypeParametersOptions {
    pub(crate) group_id: Option<GroupId>,
    pub(crate) is_type_or_interface_decl: bool,
}

/// ESTree's `TSTypeParameterDeclaration`. Nothing is written if there are no type parameters.
#[derive(Copy, Clone)]
pub(crate) struct FormatTSTypeParameters<'a> {
    params: List<'a, TypeParam<'a>>,
    owner: Node<'a>,
    options: FormatTSTypeParametersOptions,
}

/// The type parameters `params` of `owner`: a `Func`, a `Class`, or the `Stmt` of an interface or
/// a type alias.
pub(crate) fn type_parameters<'a>(params: List<'a, TypeParam<'a>>, owner: Node<'a>) -> FormatTSTypeParameters<'a> {
    FormatTSTypeParameters {
        params,
        owner,
        options: FormatTSTypeParametersOptions::default(),
    }
}

impl<'a> FormatTSTypeParameters<'a> {
    pub(crate) fn with_options(mut self, options: FormatTSTypeParametersOptions) -> Self {
        self.options = options;
        self
    }

    /// Without the comments around the `<..>`.
    pub(crate) fn write_without_comments(self, f: &mut Formatter<'a>) {
        let Self { params, owner, .. } = self;
        if params.is_empty() && self.options.is_type_or_interface_decl {
            return write!(f, "<>");
        }
        let node = AstNodes::TSTypeParameterDeclaration(owner);
        write!(
            f,
            group(&format_args!(
                "<",
                format_with(|f| {
                    if matches!(node.parent().parent(), AstNodes::CallExpression(call) if is_test_call_expression(call)) {
                        f.join_nodes_with_space().entries_with_trailing_separator(
                            params.iter(),
                            ",",
                            TrailingSeparator::Omit,
                        );
                    } else {
                        let trailing_separator = match should_force_trailing_comma_for_arrow_function(params, owner, f)
                        {
                            true => TrailingSeparator::Mandatory,
                            false => FormatTrailingCommas::ES5.trailing_separator(f.options()),
                        };
                        write!(
                            f,
                            soft_block_indent(&format_with(|f| {
                                f.join_with(soft_line_break_or_space()).entries_with_trailing_separator(
                                    params.iter(),
                                    ",",
                                    trailing_separator,
                                );
                            }))
                        );
                    }
                    if !f.is_quiet() {
                        format_dangling_comments(node.span()).with_soft_block_indent().fmt(f);
                    }
                }),
                ">"
            ))
            .with_group_id(self.options.group_id)
        );
    }
}

impl Spanned for FormatTSTypeParameters<'_> {
    fn span(&self) -> Span {
        AstNodes::TSTypeParameterDeclaration(self.owner).span()
    }
}

impl<'a> Format<'a> for FormatTSTypeParameters<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        if self.params.is_empty() {
            return;
        }
        if f.is_quiet() {
            return self.write_without_comments(f);
        }
        let node = AstNodes::TSTypeParameterDeclaration(self.owner);
        format_node(node.span(), || node.parent(), f, |f| self.write_without_comments(f));
    }
}

/// ESTree's `TSTypeParameterInstantiation`. Nothing is written if there are no type arguments.
#[derive(Copy, Clone)]
pub(crate) struct FormatTypeArguments<'a> {
    params: List<'a, TypeNode<'a>>,
    owner: Node<'a>,
}

/// The type arguments `params` of `owner`: an `Expr`, a `TypeNode`, or the `Class` whose `extends`
/// clause has them.
pub(crate) fn type_arguments<'a>(params: List<'a, TypeNode<'a>>, owner: Node<'a>) -> FormatTypeArguments<'a> {
    FormatTypeArguments { params, owner }
}

impl<'a> FormatTypeArguments<'a> {
    /// Without the comments around the `<..>`.
    pub(crate) fn write_without_comments(self, f: &mut Formatter<'a>) {
        let params = self.params;
        let should_inline = params.len() == 1
            && params.first().is_some_and(|first| should_hug_single_type(first, f) && !self.has_comment_on_own_line(first, f))
            && !is_arrow_function_variable_type_argument(self);

        let format_params = format_with(|f| {
            f.join_with(soft_line_break_or_space()).entries_with_trailing_separator(
                params.iter(),
                ",",
                TrailingSeparator::Disallowed,
            );
        });

        if should_inline {
            write!(f, ["<", format_params, ">"]);
        } else {
            write!(f, group(&format_args!("<", soft_block_indent(&format_params), ">")));
        }
    }

    /// Whether a comment around `only`, the only type argument, is a line comment, or the last one
    /// ends its line.
    fn has_comment_on_own_line(self, only: TypeNode<'a>, f: &Formatter<'a>) -> bool {
        if f.is_quiet() {
            return false;
        }
        let (outer, inner) = (AstNodes::TSTypeParameterInstantiation(self.owner).span(), only.span());
        let before = f.comments().comments_in_range(outer.start, inner.start);
        let after = f.comments().comments_in_range(inner.end, outer.end);
        before.iter().chain(after).any(|comment| comment.is_line())
            || after.last().or(before.last()).is_some_and(|comment| comment.followed_by_newline())
    }
}

impl<'a> Format<'a> for FormatTypeArguments<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        if self.params.is_empty() {
            return;
        }
        if f.is_quiet() {
            return self.write_without_comments(f);
        }
        let node = AstNodes::TSTypeParameterInstantiation(self.owner);
        format_node(node.span(), || node.parent(), f, |f| self.write_without_comments(f));
    }
}

fn should_hug_single_type<'a>(ty: TypeNode<'a>, f: &Formatter<'a>) -> bool {
    is_simple_type(ty)
        || is_object_like_type(ty)
        // `A<B | null | undefined>`
        || matches!(ty.kind(), TypeKind::Union(types) if should_hug_type(ty, types, f))
}

/// `const foo: A<B, C> = () => {};`
fn is_arrow_function_variable_type_argument(arguments: FormatTypeArguments<'_>) -> bool {
    let params = arguments.params;
    if params.len() == 1 && params.first().is_some_and(is_object_like_type) {
        return false;
    }
    // The parent is the `TSTypeReference`.
    let grand_parent = AstNodes::TSTypeParameterInstantiation(arguments.owner).parent().parent();
    matches!(grand_parent, AstNodes::TSTypeAnnotation(_))
        && matches!(
            grand_parent.parent(),
            AstNodes::VariableDeclarator(declarator)
                if declarator.init().is_some_and(|init| init.arrow_function().is_some())
        )
}
