use super::class::dangling_comments_with_marker;
use super::decorators::FormatDecorators;
use crate::js::attach::Marker;
use crate::js::format::{FormatTypeAnnotation, format_node};
use crate::js::utils::call_expression::{
    is_angular_test_wrapper, is_test_call_expression_in_flavor,
};
use crate::js::utils::format_node_without_trailing_comments::FormatNodeWithoutTrailingComments;
use crate::js::utils::suppressed::FormatSuppressedNode;
use crate::prelude::*;
use crate::{format_args, write};

/// The `( .. )` of a function, with the `this` parameter.
#[derive(Copy, Clone)]
pub(crate) struct FormatFormalParameters<'a>(pub(crate) Func<'a>);

impl Spanned for FormatFormalParameters<'_> {
    fn span(&self) -> Span {
        AstNodes::FormalParameters(self.0).span()
    }
}

impl<'a> Format<'a> for FormatFormalParameters<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        write_formal_parameters(self.0, f);
    }
}

fn has_modifier(param: Param<'_>) -> bool {
    param.modifiers().iter().any(|it| it.decorator().is_none())
}

/// Prettier's `printFunctionParameters`.
fn write_formal_parameters<'a>(func: Func<'a>, f: &mut Formatter<'a>) {
    // Comments that are attached to the parentheses. For oxfmt `class A { b ⏎// comment⏎ () {} }` is `b () {}⏎// comment`, and
    // `b /* prettier-ignore */ ( c ) {}` is `b/* prettier-ignore */ ( c ) {}`. For Prettier only in Flow:
    // `declare function a /* comment */ (): void`
    if !f.is_quiet() {
        let node = AstNodes::FormalParameters(func);
        let owned = f.comments().of_node(node);
        if owned.is_ignored {
            return write!(
                f,
                [
                    FormatLeadingComments::Comments(owned.leading),
                    FormatSuppressedNode(node.span())
                ]
            );
        }
        if !owned.leading.is_empty() {
            write!(
                f,
                [space(), FormatTrailingComments::Comments(owned.leading)]
            );
        }
    }
    if func.params().is_empty() && func.this_param().is_none() {
        write!(f, "(");
        write_dangling_comments_in_parentheses(func, f);
        return write!(f, ")");
    }
    if f.file().is_flow() && super::flow::is_shorthand_function_type(func) {
        return super::flow::write_shorthand_parameter(func, f);
    }
    let parentheses_not_needed = func.is_arrow() && can_avoid_parentheses(func, f);
    let has_any_decorated_parameter = func
        .params()
        .iter()
        .any(|param| param.decorators().next().is_some());
    let can_hug = should_hug_function_parameters(func, parentheses_not_needed, f)
        && !has_any_decorated_parameter;

    let layout = if can_hug
        // The callback of a test. Not that of `inject`, `async`, `fakeAsync` and `waitForAsync`,
        // whose parameters can break.
        || matches!(
            func.owner(),
            Node::Expr(function) if matches!(
                function.parent(),
                Node::Expr(call) if call.tag() == ExprTag::Call
                    && is_test_call_expression_in_flavor(call, f)
                    && !is_angular_test_wrapper(call)
            )
        ) {
        ParameterLayout::Hug
    } else {
        ParameterLayout::Default
    };

    if !parentheses_not_needed {
        write!(f, "(");
    }
    match layout {
        ParameterLayout::Hug => write!(f, ParameterList::with_layout(func, layout)),
        ParameterLayout::Default => write!(
            f,
            soft_block_indent(&ParameterList::with_layout(func, layout))
        ),
    }
    if !parentheses_not_needed {
        write!(f, ")");
    }
}

/// The node whose parameters Prettier prints for `func`. It owns the comments in empty parentheses. Babel has no
/// `FunctionExpression` in a method, so there it is the method.
fn function_node<'a>(func: Func<'a>, f: &Formatter<'a>) -> AstNodes<'a> {
    let node = func.as_ast_nodes();
    if !matches!(node, AstNodes::Function(_)) || !f.context().has_tree_of_babel() {
        return node;
    }
    match func.owner() {
        Node::Member(member) => member.as_ast_nodes(),
        Node::Expr(function) => match function.parent() {
            Node::Prop(property) if property.func() == Some(func) => property.as_ast_nodes(),
            _ => node,
        },
        _ => node,
    }
}

/// `function f(/* comment */) {}`: Prettier's `printDanglingCommentsInList`.
fn write_dangling_comments_in_parentheses<'a>(func: Func<'a>, f: &mut Formatter<'a>) {
    if f.is_quiet() {
        return;
    }
    let node = function_node(func, f);
    let all_dangling_comments = f.comments().of_node(node).dangling;
    if all_dangling_comments.is_empty() {
        return;
    }
    // `() /* comment */ => a`: Prettier means to leave out the comment before the `=>`, but misspells `comment.marker`. So
    // it writes the line breaks even if no comment is between them. The empty text makes the second line break count.
    let comments = dangling_comments_with_marker(node, Marker::None, f);
    let format_comments = FormatDanglingComments::Comments {
        comments,
        indent: DanglingIndentMode::None,
    };
    write!(
        f,
        indent(&format_args!(
            soft_line_break(),
            comments.is_empty().then_some(""),
            format_comments
        ))
    );
    match all_dangling_comments
        .iter()
        .any(|comment| comment.is_line())
    {
        true => write!(f, hard_line_break()),
        false => write!(f, soft_line_break()),
    }
}

/// Prettier's `hasComment(parameter)`. A parameter without a default value is the same node as its pattern in ESTree.
///
/// The pattern and the type in the parameter ask this too while they are written, so [`Formatter::is_quiet`] says nothing
/// about it.
fn parameter_has_comment<'a>(param: Param<'a>, f: &Formatter<'a>) -> bool {
    let comments = f.comments();
    (comments.is_owner(Node::Param(param)) && comments.has_comments(param.as_ast_nodes()))
        || (comments.is_owner(Node::Pat(param.pat()))
            && param.default().is_none()
            && !hugs_pattern_with_comments(f)
            && comments.has_comments(param.pat().as_ast_nodes()))
}

/// ```js
/// function a(          function a({
///   {                    // comment
///     // comment       }) {}
///   },
/// ) {}
/// ```
///
/// Prettier on the left, oxfmt on the right.
fn hugs_pattern_with_comments(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

/// `function a({ b } // comment⏎ = {}) {}` is `function a({⏎  b,⏎} = {}) {} // comment` for oxfmt, and
/// `function a({ b } = {}) {} // comment` for Prettier.
fn comment_behind_pattern_breaks_it(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

/// The modifiers of a parameter, in the order that they are written in.
const MODIFIERS: [(Flags, &str); 6] = [
    (Flags::PUBLIC, "public"),
    (Flags::PROTECTED, "protected"),
    (Flags::PRIVATE, "private"),
    (Flags::STATIC, "static"),
    (Flags::OVERRIDE, "override"),
    (Flags::READONLY, "readonly"),
];

/// `private a?: T = 1`, `...a: T`, `this: T`
pub(crate) fn write_formal_parameter<'a>(param: Param<'a>, f: &mut Formatter<'a>) {
    if f.file().is_flow() && super::flow::write_parameter_start(param, f) {
        return;
    }
    if matches!(param.as_ast_nodes(), AstNodes::TSThisParameter(_)) {
        return write!(f, ["this", param.ty().map(FormatTypeAnnotation)]);
    }
    let has_decorators = param.decorators().next().is_some();
    if param.is_rest() {
        let content = format_with(|f| {
            write!(
                f,
                ["...", param.pat(), param.ty().map(FormatTypeAnnotation)]
            )
        });
        return match has_decorators {
            true => write!(
                f,
                group(&format_args!(FormatDecorators::of_param(param), content))
            ),
            false => write!(f, content),
        };
    }

    let pattern = param.pat();
    let type_annotation = param.ty().map(FormatTypeAnnotation);
    let is_group = !matches!(pattern.kind(), PatKind::Ident(_)) || every_parameter_is_a_group(f);
    let content = format_with(|f| {
        let modifiers = param.modifiers();
        let keywords: &[_] = match modifiers.is_empty() {
            true => &[],
            false => &MODIFIERS,
        };
        for &(flag, keyword) in keywords {
            if modifiers.iter().any(|it| it.flag() == flag) {
                write!(f, [keyword, space()]);
            }
        }
        let left = format_with(|f| {
            let optional = param.is_optional().then_some("?");
            match param
                .default()
                .filter(|_| !comment_behind_pattern_breaks_it(f))
            {
                Some(_) => write!(
                    f,
                    [
                        FormatNodeWithoutTrailingComments(&pattern),
                        optional,
                        (type_annotation.as_ref()).map(FormatNodeWithoutTrailingComments)
                    ]
                ),
                None => write!(f, [pattern, optional, type_annotation]),
            }
        });

        let Some(initializer) = param.default() else {
            return write!(f, left);
        };
        let write_assignment_pattern = |f: &mut Formatter<'a>| {
            // `({ a } // comment⏎ = {}) => {}`: the comment does not break the pattern.
            match is_group {
                true => write!(f, group(&left)),
                false => write!(f, left),
            }
            write!(f, trailing_comments(pattern.as_ast_nodes()));
            if let Some(ty) = param.ty() {
                write!(f, trailing_comments(AstNodes::TSTypeAnnotation(ty)));
            }
            write!(f, [space(), "=", space(), initializer]);
        };
        // `private a = 1`: the `AssignmentPattern` in a `TSParameterProperty` is a node of its own. Not for oxfmt.
        match param.is_parameter_property() && !f.options().flavor.is_oxfmt() {
            true => format_node(
                AstNodes::AssignmentPattern(Node::Param(param)),
                f,
                write_assignment_pattern,
            ),
            false => write_assignment_pattern(f),
        }
    });

    // A group makes no difference to what has no place to break at.
    if !has_decorators && (!is_group || cannot_break(param, f)) {
        return write!(f, content);
    }

    let is_hug_parameter = param.func().is_some_and(|func| {
        let parentheses_not_needed = func.is_arrow() && can_avoid_parentheses(func, f);
        should_hug_function_parameters(func, parentheses_not_needed, f)
    });

    if is_hug_parameter && !has_decorators {
        write!(f, content);
    } else if !has_decorators {
        write!(f, group(&content));
    } else if decorators_of_parameter_are_a_group_of_their_own(f) {
        write!(
            f,
            [group(&FormatDecorators::of_param(param)), group(&content)]
        );
    } else {
        write!(
            f,
            group(&format_args!(
                FormatDecorators::of_param(param),
                group(&content)
            ))
        );
    }
}

/// ```ts
/// @A({ b: true })          @A({ b: true }) c:
/// c: D | undefined,          | D
///                            | undefined,
/// ```
///
/// Prettier on the left: what does not fit breaks after the decorators first. oxfmt on the right.
fn decorators_of_parameter_are_a_group_of_their_own(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

/// ```ts
/// constructor(               constructor(
///   private a: /* comment */   private a: /* comment */ B,
///   B,                         c,
///   c,                       ) {}
/// ) {}
/// ```
///
/// Prettier on the left, for `a: /* comment */⏎B`: only a pattern is a group, so the line break after the comment breaks with
/// the parameters. oxfmt on the right.
fn every_parameter_is_a_group(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

/// Whether `param` is a name, and its type a keyword or a name.
fn cannot_break<'a>(param: Param<'a>, f: &Formatter<'a>) -> bool {
    f.is_quiet()
        && param.default().is_none()
        && matches!(param.pat().kind(), PatKind::Ident(_))
        && param.ty().is_none_or(|ty| match ty.kind() {
            TypeKind::Keyword(_) => true,
            TypeKind::Ref { args, .. } => args.is_empty(),
            _ => false,
        })
}

struct ParameterList<'a> {
    func: Func<'a>,
    layout: ParameterLayout,
}

#[derive(Debug, Copy, Clone)]
enum ParameterLayout {
    /// The only parameter is written right after the `(`, even if it breaks:
    ///
    /// ```javascript
    /// function test({
    ///   a,
    ///   b
    /// }) {}
    /// ```
    Hug,
    /// On one line if they fit, otherwise each on its own line.
    Default,
}

impl<'a> ParameterList<'a> {
    fn with_layout(func: Func<'a>, layout: ParameterLayout) -> Self {
        Self { func, layout }
    }
}

impl<'a> Format<'a> for ParameterList<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let params = self.func.params_with_this();
        match self.layout {
            ParameterLayout::Default => {
                // Nothing can follow a rest parameter, not even a comma.
                let trailing_separator = match self.func.params().last().is_some_and(Param::is_rest)
                {
                    true => TrailingSeparator::Disallowed,
                    false => FormatTrailingCommas::Arguments.trailing_separator(f.options()),
                };
                let has_modifiers = self.func.params().iter().any(has_modifier);
                let mut joiner = match has_modifiers {
                    true => f.join_nodes_with_hardline(),
                    false => f.join_nodes_with_soft_line(),
                };
                joiner.entries_with_trailing_separator(params, ",", trailing_separator);
            }
            ParameterLayout::Hug => {
                f.join_with(space()).entries_with_trailing_separator(
                    params,
                    ",",
                    TrailingSeparator::Omit,
                );
            }
        }
    }
}

/// `a => a`: whether the options ask for it and the parameters allow it. Prettier's `shouldPrintParamsWithoutParens`.
pub(crate) fn can_avoid_parentheses<'a>(arrow: Func<'a>, f: &Formatter<'a>) -> bool {
    f.options().arrow_parentheses.is_as_needed()
        && arrow.params().len() == 1
        && arrow.this_param().is_none()
        && arrow.type_params().is_empty()
        && arrow.return_type().is_none()
        && arrow.params().first().is_some_and(|param| {
            !param.is_rest()
                && param.ty().is_none()
                && !param.is_optional()
                && param.default().is_none()
                && matches!(param.pat().kind(), PatKind::Ident(_))
                && !parameter_has_comment(param, f)
        })
        && (f.comments().of_node(arrow.as_ast_nodes()).dangling).is_empty()
}

/// Prettier's `shouldHugTheOnlyFunctionParameter`.
pub(crate) fn should_hug_function_parameters<'a>(
    func: Func<'a>,
    parentheses_not_needed: bool,
    f: &Formatter<'a>,
) -> bool {
    let list = func.params();
    if list.len() > 1 || list.last().is_some_and(Param::is_rest) {
        return false;
    }
    if let Some(this_param) = func.this_param() {
        return list.is_empty()
            && this_param
                .ty()
                .is_some_and(|ty| matches!(ty.kind(), TypeKind::Object(_) | TypeKind::Mapped(_)))
            && !parameter_has_comment(this_param, f);
    }
    let Some(only_parameter) = list.first() else {
        return false;
    };
    let is_huggable = match only_parameter.pat().kind() {
        PatKind::Array(_) | PatKind::Object(_) => {
            only_parameter.default().is_none_or(is_huggable_expression)
        }
        PatKind::Ident(_) | PatKind::Missing => {
            only_parameter.default().is_none()
                && (parentheses_not_needed
                    || only_parameter.ty().is_some_and(|ty| {
                        matches!(ty.kind(), TypeKind::Object(_) | TypeKind::Mapped(_))
                    }))
        }
    };
    is_huggable
        && !has_modifier(only_parameter)
        && !(f.file().is_flow() && super::flow::is_component(func, f))
        && !parameter_has_comment(only_parameter, f)
}

/// Whether all parameters are plain names, without default values. A rest parameter is not.
pub(crate) fn has_only_simple_parameters(func: Func<'_>, allow_type_annotations: bool) -> bool {
    func.params_with_this().all(|parameter| {
        !parameter.is_rest()
            && matches!(parameter.pat().kind(), PatKind::Ident(_))
            && parameter.default().is_none()
            && (allow_type_annotations || parameter.ty().is_none())
    })
}

/// `{}`, `[]` or a name.
fn is_huggable_expression(e: Expr<'_>) -> bool {
    match e.kind() {
        ExprKind::Object(props) => props.is_empty(),
        ExprKind::Array(elements) => elements.is_empty(),
        ExprKind::Ident(_) => true,
        _ => false,
    }
}
