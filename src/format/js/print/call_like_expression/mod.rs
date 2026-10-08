//! `callee(args)`, `new callee(args)`, `import(args)`. Prettier's `printCallExpression`.

pub(crate) mod arguments;

use self::arguments::FormatArguments;
use super::arrow_function_expression::is_multiline_template_starting_on_same_line;
use super::type_parameters::type_arguments;
use crate::js::parentheses::expression::chain_expression_needs_parentheses;
use crate::js::utils::call_expression::{
    is_call_expression, is_test_call_expression_in_flavor, type_arguments_trailing_comments,
    write_callee_trailing_comments,
};
use crate::js::utils::format_node_without_trailing_comments::FormatNodeWithoutTrailingComments;
use crate::js::utils::member_chain::write_member_chain;
use crate::js::utils::typecast::is_cast_target;
use crate::prelude::*;
use crate::{format_args, write};

pub(crate) fn write_call_expression<'a>(e: Expr<'a>, call: Call<'a>, f: &mut Formatter<'a>) {
    let callee = call.callee();
    let head = format_args!(
        FormatCallee(call),
        call.is_optional().then_some("?."),
        FormatTypeArguments(e, call),
        (!call.type_args().is_empty()).then_some(line_suffix_boundary())
    );

    if keeps_arguments_on_one_line(e, call, f) {
        return write!(f, [head, FormatArgumentsOnOneLine(call.args())]);
    }

    // A member access needs no parentheses as a callee, unless an optional chain ends with it. Then
    // it is a member access only in JavaScript: see `is_member_expression`.
    if matches!(callee.tag(), ExprTag::Dot | ExprTag::Index)
        && (!is_chain_root(callee)
            || (f.context().has_tree_of_babel() && !chain_expression_needs_parentheses(callee, f)))
    {
        return write_member_chain(e, f);
    }

    let content = format_args!(head, FormatArguments::of_call(e, call));
    match is_call_expression(callee, f) {
        true => write!(f, group(&content)),
        false => write!(f, content),
    }
}

fn keeps_arguments_on_one_line<'a>(e: Expr<'a>, call: Call<'a>, f: &Formatter<'a>) -> bool {
    // Each of these takes one of a few names as the callee, or a string or a template as the first
    // argument.
    let Some(first) = call.args().first() else {
        return false;
    };
    let callee = call.callee();
    if !matches!(
        first.tag(),
        ExprTag::String | ExprTag::Template | ExprTag::TaggedTemplate
    ) && !(callee.tag() == ExprTag::Ident
        && matches!(
            callee.text(),
            b"require"
                | b"define"
                | b"async"
                | b"inject"
                | b"fakeAsync"
                | b"waitForAsync"
                | b"beforeEach"
                | b"beforeAll"
                | b"afterEach"
                | b"afterAll"
        ))
    {
        return false;
    }
    is_template_on_its_own_line_only_argument(call.args(), f)
        || is_simple_module_import(e, call, f)
        || is_commonjs_or_amd_module_definition(e, call, f)
        || (is_test_call_expression_in_flavor(e, f)
            && !call
                .args()
                .iter()
                .any(|argument| is_cast_target(argument, f)))
}

pub(crate) fn write_new_expression<'a>(e: Expr<'a>, call: Call<'a>, f: &mut Formatter<'a>) {
    let head = format_args!(
        "new",
        space(),
        FormatCallee(call),
        FormatTypeArguments(e, call),
        (!call.type_args().is_empty()).then_some(line_suffix_boundary())
    );
    if is_template_on_its_own_line_only_argument(call.args(), f) {
        return write!(f, [head, FormatArgumentsOnOneLine(call.args())]);
    }
    let content = format_args!(head, FormatArguments::of_call(e, call));
    match is_call_expression(call.callee(), f) {
        true => write!(f, group(&content)),
        false => write!(f, content),
    }
}

pub(crate) fn write_import_expression<'a>(
    e: Expr<'a>,
    args: List<'a, Expr<'a>>,
    f: &mut Formatter<'a>,
) {
    let phase = e.import_call_phase();
    let head = format_args!("import", phase.map(|_| "."), phase);
    if is_template_on_its_own_line_only_argument(args, f)
        || is_lone_string_without_comments(e, args, f)
    {
        return write!(f, [head, FormatArgumentsOnOneLine(args)]);
    }
    write!(
        f,
        group(&format_args!(
            head,
            FormatArguments::new(args, AstNodes::ImportExpression(e))
        ))
    );
}

/// What is called, with the comments between it and the `?.`, the `<` or the `(`. A comment that
/// ends the line stays there, and the rest of the call goes on the next line.
struct FormatCallee<'a>(Call<'a>);

impl<'a> Format<'a> for FormatCallee<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let call = self.0;
        let callee = call.callee();
        // `new A` has no `(` to look for.
        if f.is_quiet() || call.close_paren().is_none() {
            return write!(f, [callee, boundary_behind_callee(f)]);
        }
        write!(f, FormatNodeWithoutTrailingComments(&callee));
        write_callee_trailing_comments(call, callee.span().end, f);
        write!(f, boundary_behind_callee(f));
    }
}

/// A comment at the end of the line of the callee stays there. oxfmt, like Prettier 3.8, moves it behind
/// the call: `call // comment\n()` is `call(); // comment`.
fn boundary_behind_callee(f: &Formatter<'_>) -> Option<LineSuffixBoundary> {
    (!f.options().flavor.is_oxfmt()).then_some(line_suffix_boundary())
}

/// The `<T>` of `a<T>()`, with the comments around it.
pub(crate) struct FormatTypeArguments<'a>(pub(crate) Expr<'a>, pub(crate) Call<'a>);

impl<'a> Format<'a> for FormatTypeArguments<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let FormatTypeArguments(e, call) = *self;
        if call.type_args().is_empty() {
            return;
        }
        let type_arguments = type_arguments(call.type_args(), Node::Expr(e));
        if f.is_quiet() || call.close_paren().is_none() {
            return write!(f, type_arguments);
        }
        let span = AstNodes::TSTypeParameterInstantiation(Node::Expr(e)).span();
        write!(f, format_leading_comments(span));
        type_arguments.write_without_comments(f);
        write!(
            f,
            FormatTrailingComments::Comments(type_arguments_trailing_comments(call, span.end, f))
        );
    }
}

/// `(a, b)`, without a way to break between the arguments.
struct FormatArgumentsOnOneLine<'a>(List<'a, Expr<'a>>);

impl<'a> Format<'a> for FormatArgumentsOnOneLine<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        write!(f, "(");
        f.join_with(space()).entries_with_trailing_separator(
            self.0.iter(),
            ",",
            TrailingSeparator::Omit,
        );
        write!(f, ")");
    }
}

/// Prettier's `isTemplateOnItsOwnLine` of the only argument, which is not written as the language in it.
fn is_template_on_its_own_line_only_argument<'a>(
    args: List<'a, Expr<'a>>,
    f: &Formatter<'a>,
) -> bool {
    let is_one = |only| {
        is_multiline_template_starting_on_same_line(only, f.source_text())
            && !arguments::has_embed_label(only, f)
            && !is_cast_target(only, f)
    };
    args.len() == 1 && args.first().is_some_and(is_one)
}

/// Whether the only argument of `e` is a string, and there are no comments around it.
fn is_lone_string_without_comments<'a>(
    e: Expr<'a>,
    args: List<'a, Expr<'a>>,
    f: &Formatter<'a>,
) -> bool {
    args.len() == 1
        && args
            .first()
            .is_some_and(|first| first.tag() == ExprTag::String)
        && (f.is_quiet() || !f.comments().has_comment_before(e.span().end))
}

fn is_identifier(e: Expr<'_>, name: &[u8]) -> bool {
    e.tag() == ExprTag::Ident && e.text() == name
}

/// Prettier's `isSimpleModuleImport` for a call: `require("a")`, `require.resolve("a")`,
/// `require.resolve.paths("a")`, `import.meta.resolve("a")`. A long name of a module is no reason
/// to break.
fn is_simple_module_import<'a>(e: Expr<'a>, call: Call<'a>, f: &Formatter<'a>) -> bool {
    if call.args().len() != 1
        || call.chain() != Chain::No
        || !call
            .args()
            .first()
            .is_some_and(|first| first.tag() == ExprTag::String)
    {
        return false;
    }
    let callee = call.callee();
    let is_module_function = match callee.kind() {
        ExprKind::Ident(_) => callee.text() == b"require",
        ExprKind::Dot { obj, name, .. } => match name.bytes() {
            b"resolve" => {
                is_identifier(obj, b"require") || matches!(obj.kind(), ExprKind::ImportMeta)
            }
            b"paths" => matches!(
                obj.kind(),
                ExprKind::Dot { obj, name, .. } if is_identifier(obj, b"require") && name.bytes() == b"resolve"
            ),
            _ => false,
        },
        _ => false,
    };
    is_module_function && is_lone_string_without_comments(e, call.args(), f)
}

/// Prettier's `isCommonsJsOrAmdModuleDefinition`: `require("a", b)`, and `define` of AMD.
fn is_commonjs_or_amd_module_definition<'a>(
    e: Expr<'a>,
    call: Call<'a>,
    f: &Formatter<'a>,
) -> bool {
    let callee = call.callee();
    if callee.tag() != ExprTag::Ident || call.is_optional() {
        return false;
    }
    let args = call.args();
    let is_string = |e: Option<Expr<'a>>| e.is_some_and(|e| e.tag() == ExprTag::String);
    let is_array = |e: Option<Expr<'a>>| e.is_some_and(|e| e.tag() == ExprTag::Array);
    match callee.text() {
        // `require(path.join(__dirname, "a"))` can break.
        b"require" => {
            (args.len() > 1 || (args.len() == 1 && is_string(args.first())))
                && !args
                    .first()
                    .is_some_and(|first| f.comments().has_comment_before(first.span().start))
        }
        b"define" => {
            matches!(e.as_chain_element().parent(), AstNodes::ExpressionStatement(statement) if !statement.is_arrow_function_body())
                && match args.len() {
                    1 => true,
                    2 => is_array(args.first()),
                    3 => is_string(args.first()) && is_array(args.get(1)),
                    _ => false,
                }
        }
        _ => false,
    }
}
