//! `<T, U>`: type parameters and type arguments.

use crate::js::format::{format_node, identifier};
use crate::js::utils::call_expression::is_test_call_expression_in_flavor;
use crate::js::utils::typescript::{
    is_object_like_type, is_simple_type, should_hug_type, without_lone_operator,
};
use crate::prelude::*;
use crate::{format_args, write};

/// `const in out T extends C = D`
pub(crate) fn write_ts_type_parameter<'a>(param: TypeParam<'a>, f: &mut Formatter<'a>) {
    let (flags, is_flow) = (param.flags(), f.file().is_flow());
    if is_flow {
        super::flow::write_type_parameter_modifiers(param, f);
    } else if !flags.is_empty() {
        for (flag, keyword) in [
            (Flags::CONST, "const"),
            (Flags::IN, "in"),
            (Flags::OUT, "out"),
        ] {
            if flags.contains(flag) {
                write!(f, [keyword, space()]);
            }
        }
    }
    write!(f, identifier(param.name()));

    match param.constraint() {
        Some(constraint) if is_flow => {
            super::flow::write_type_parameter_bound(param, constraint, f)
        }
        Some(constraint) => write_type_parameter_bound("extends", constraint, f),
        None => {}
    }
    if let Some(default) = param.default() {
        write_type_parameter_bound("=", default, f);
    }
}

/// ` extends T`, ` = T`
fn write_type_parameter_bound<'a>(operator: &'static str, ty: TypeNode<'a>, f: &mut Formatter<'a>) {
    let group_id = f.group_id("bound");
    // A union that breaks starts with a line break. If there's also one after the operator, Prettier prints both. The
    // empty text keeps the printer from merging them.
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

/// Prettier's `shouldForceTrailingComma`: `<T,>() => {}` in a `.tsx` file, where `<T>` would start an element.
fn should_force_trailing_comma_for_arrow_function<'a>(
    params: List<'a, TypeParam<'a>>,
    owner: Node<'a>,
    f: &Formatter<'a>,
) -> bool {
    params.len() == 1
        && matches!(owner, Node::Func(func) if func.is_arrow())
        && !params
            .first()
            .is_some_and(|param| param.constraint().is_some())
        && !f.filepath().ends_with(b".ts")
        && !f.file().is_flow()
}

#[derive(Default, Copy, Clone)]
pub(crate) struct FormatTSTypeParametersOptions {
    pub(crate) group_id: Option<GroupId>,
    pub(crate) is_type_or_interface_decl: bool,
}

/// ESTree's `TSTypeParameterDeclaration`. Prints nothing if there are no type parameters.
#[derive(Copy, Clone)]
pub(crate) struct FormatTSTypeParameters<'a> {
    params: List<'a, TypeParam<'a>>,
    owner: Node<'a>,
    options: FormatTSTypeParametersOptions,
}

/// `owner`'s type parameters `params`. `owner` is a `Func`, a `Class`, or the `Stmt` of an interface or type alias.
pub(crate) fn type_parameters<'a>(
    params: List<'a, TypeParam<'a>>,
    owner: Node<'a>,
) -> FormatTSTypeParameters<'a> {
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
        let node = AstNodes::TSTypeParameterDeclaration(owner);
        if params.is_empty() && self.options.is_type_or_interface_decl {
            return write!(f, ["<", FormatDanglingCommentsForInline(node), ">"]);
        }
        let is_in_test_call = matches!(node.parent().parent(), AstNodes::CallExpression(call) if is_test_call_expression_in_flavor(call, f));
        if is_in_test_call
            && !(params.iter())
                .any(|param| has_comment_that_breaks(AstNodes::TSTypeParameter(param), f))
        {
            let format_params = format_with(|f| {
                f.join_nodes_with_space().entries_with_trailing_separator(
                    params.iter(),
                    ",",
                    TrailingSeparator::Omit,
                );
            });
            return write!(
                f,
                group(&format_args!("<", format_params, ">")).with_group_id(self.options.group_id)
            );
        }
        let trailing_separator =
            match should_force_trailing_comma_for_arrow_function(params, owner, f) {
                true => TrailingSeparator::Mandatory,
                false => FormatTrailingCommas::ES5.trailing_separator(f.options()),
            };
        let format_params = format_with(|f| {
            f.join_with(soft_line_break_or_space())
                .entries_with_trailing_separator(params.iter(), ",", trailing_separator);
        });
        write!(
            f,
            group(&format_args!("<", soft_block_indent(&format_params), ">"))
                .with_group_id(self.options.group_id)
        );
    }
}

/// Prettier's `printDanglingCommentsForInline`: the comments in `</* comment */>`.
pub(crate) struct FormatDanglingCommentsForInline<'a>(pub(crate) AstNodes<'a>);

impl<'a> Format<'a> for FormatDanglingCommentsForInline<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        if f.is_quiet() {
            return;
        }
        let comments = f.comments().of_node(self.0).dangling;
        let indent = match comments.iter().any(|comment| comment.is_line()) {
            true => DanglingIndentMode::Block,
            false => DanglingIndentMode::None,
        };
        write!(f, FormatDanglingComments::Comments { comments, indent });
    }
}

/// True if a type parameter or type argument has a comment that doesn't fit between `<` and `>` on one line: a line
/// comment, or a last comment that ends its line.
fn has_comment_that_breaks<'a>(node: AstNodes<'a>, f: &Formatter<'a>) -> bool {
    if f.is_quiet() {
        return false;
    }
    let owned = f.comments().of_node(node);
    (owned.leading.iter().chain(owned.trailing)).any(|comment| comment.is_line())
        || (owned.trailing.last().or_else(|| owned.leading.last()))
            .is_some_and(|comment| comment.has_newline_after())
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
        format_node(node, f, |f| self.write_without_comments(f));
    }
}

/// ESTree's `TSTypeParameterInstantiation`. Prints nothing if there are no type arguments.
#[derive(Copy, Clone)]
pub(crate) struct FormatTypeArguments<'a> {
    params: List<'a, TypeNode<'a>>,
    owner: Node<'a>,
}

/// `owner`'s type arguments `params`. `owner` is an `Expr`, a `TypeNode`, or the `Class` whose `extends` clause has
/// them.
pub(crate) fn type_arguments<'a>(
    params: List<'a, TypeNode<'a>>,
    owner: Node<'a>,
) -> FormatTypeArguments<'a> {
    FormatTypeArguments { params, owner }
}

/// ```ts
/// a<                 a<// comment
///   // comment       { b: c }>();
///   { b: c }
/// >();
/// ```
///
/// Prettier is on the left, oxfmt on the right.
fn only_comment_after_type_argument_counts(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

impl<'a> FormatTypeArguments<'a> {
    /// Without the comments around the `<..>`.
    pub(crate) fn write_without_comments(self, f: &mut Formatter<'a>) {
        let params = self.params;
        let should_inline = params.len() == 1
            && params.first().is_some_and(|first| {
                should_hug_single_type(first, f) && !has_comment_that_unhugs(first, f)
            })
            && !is_arrow_function_variable_type_argument(self);

        // TypeScript doesn't allow a `,` after the last type argument. Flow does, and types in a JavaScript file are
        // Flow's.
        let trailing_separator = match f.file().is_javascript() && !should_inline {
            true => FormatTrailingCommas::ES5.trailing_separator(f.options()),
            false => TrailingSeparator::Disallowed,
        };
        let format_params = format_with(|f| {
            f.join_with(soft_line_break_or_space())
                .entries_with_trailing_separator(params.iter(), ",", trailing_separator);
        });

        if should_inline {
            write!(f, ["<", format_params, ">"]);
        } else {
            write!(
                f,
                group(&format_args!("<", soft_block_indent(&format_params), ">"))
            );
        }
    }
}

/// True if a comment on `only`, the only type argument, keeps it from being printed directly between `<` and `>`.
fn has_comment_that_unhugs<'a>(only: TypeNode<'a>, f: &Formatter<'a>) -> bool {
    let node = without_lone_operator(only).as_ast_nodes();
    match only_comment_after_type_argument_counts(f) {
        true => !f.is_quiet() && !f.comments().of_node(node).trailing.is_empty(),
        false => has_comment_that_breaks(node, f),
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
        format_node(node, f, |f| self.write_without_comments(f));
    }
}

fn should_hug_single_type<'a>(ty: TypeNode<'a>, f: &Formatter<'a>) -> bool {
    is_simple_type(ty)
        || is_object_like_type(ty)
        // `A<B | null | undefined>`
        || matches!(ty.kind(), TypeKind::Union(types) if should_hug_type(types, f))
        // Flow's `?T`
        || (ty.tag() == TypeTag::JSDoc && f.file().is_flow())
}

/// `const foo: A<B, C> = () => {};`
fn is_arrow_function_variable_type_argument(arguments: FormatTypeArguments<'_>) -> bool {
    let params = arguments.params;
    if params.len() == 1 && params.first().is_some_and(is_object_like_type) {
        return false;
    }
    if !matches!(arguments.owner, Node::Type(ty) if matches!(ty.parent(), Node::VarDecl(_))) {
        return false;
    }
    // The parent is the `TSTypeReference`.
    let grand_parent = AstNodes::TSTypeParameterInstantiation(arguments.owner)
        .parent()
        .parent();
    matches!(grand_parent, AstNodes::TSTypeAnnotation(_))
        && matches!(
            grand_parent.parent(),
            AstNodes::VariableDeclarator(declarator)
                if declarator.init().is_some_and(|init| init.arrow_function().is_some())
        )
}
