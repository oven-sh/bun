//! `callee(args)`, `new callee(args)`, `import(args)`. Prettier's `printCallExpression`.

pub(crate) mod arguments;

use self::arguments::FormatArguments;
use super::arrow_function_expression::is_multiline_template_starting_on_same_line;
use super::type_parameters::type_arguments;
use crate::js::parentheses::expression::chain_expression_needs_parentheses;
use crate::js::utils::call_expression::{
    FormatCallee, is_call_expression, is_test_call_expression_in_flavor,
};
use crate::js::utils::member_chain::write_member_chain;
use crate::js::utils::tailwindcss::{InTailwindContext, TailwindContext, context_of_function};
use crate::js::utils::typecast::{comments_of_outermost_node, has_comments, is_cast_target};
use crate::prelude::*;
use crate::{format_args, write};

pub(crate) fn write_call_expression<'a>(e: Expr<'a>, call: Call<'a>, f: &mut Formatter<'a>) {
    let context = context_of_function(call.callee(), f);
    // Inside a class list, the strings in a call to some other function aren't classes:
    // `cn(a.includes("b c") && "d e")`.
    let was_disabled = match context {
        Some(_) => None,
        None => f.context_mut().disable_tailwind_context(true),
    };
    write_call(e, call, context, f);
    if let Some(was_disabled) = was_disabled {
        f.context_mut().disable_tailwind_context(was_disabled);
    }
}

/// `context` applies to the arguments. As in oxfmt, it isn't applied in a member chain.
fn write_call<'a>(
    e: Expr<'a>,
    call: Call<'a>,
    context: Option<TailwindContext>,
    f: &mut Formatter<'a>,
) {
    let callee = call.callee();
    let head = format_args!(
        FormatCallee {
            callee,
            is_in_member_chain: false
        },
        boundary_after_callee(f),
        call.is_optional().then_some("?."),
        type_arguments(call.type_args(), Node::Expr(e)),
        boundary_after_callee(f).filter(|_| !call.type_args().is_empty())
    );

    if keeps_arguments_on_one_line(e, call, f) {
        let arguments = InTailwindContext(context, FormatArgumentsOnOneLine(call.args()));
        return write!(f, [head, arguments]);
    }

    if is_link_of_member_chain(callee, f) {
        return write_member_chain(e, f);
    }

    let arguments = InTailwindContext(context, FormatArguments::from_call(e, call));
    let content = format_args!(head, arguments);
    match is_call_expression(callee, f) {
        true => write!(f, group(&content)),
        false => write!(f, content),
    }
}

/// True if `callee` is a member access that's printed without parentheses. It only needs them if
/// it ends an optional chain. In that case Prettier only sees a member access in JavaScript files:
/// see `is_member_expression`.
fn is_link_of_member_chain<'a>(callee: Expr<'a>, f: &Formatter<'a>) -> bool {
    matches!(callee.tag(), ExprTag::Dot | ExprTag::Index)
        && (!callee.is_chain_root()
            || (f.context().has_babel_tree() && !chain_expression_needs_parentheses(callee, f)))
}

/// True if the call `e` is printed by [`write_member_chain`].
pub(crate) fn is_printed_as_member_chain<'a>(
    e: Expr<'a>,
    call: Call<'a>,
    f: &Formatter<'a>,
) -> bool {
    is_link_of_member_chain(call.callee(), f) && !keeps_arguments_on_one_line(e, call, f)
}

fn keeps_arguments_on_one_line<'a>(e: Expr<'a>, call: Call<'a>, f: &Formatter<'a>) -> bool {
    // Each check below requires one of a few callee names, or a string or template as the first argument.
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
        || is_simple_module_import(call, f)
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
        FormatCallee {
            callee: call.callee(),
            is_in_member_chain: false
        },
        boundary_after_callee(f),
        type_arguments(call.type_args(), Node::Expr(e)),
        boundary_after_callee(f).filter(|_| !call.type_args().is_empty())
    );
    if is_template_on_its_own_line_only_argument(call.args(), f) {
        return write!(f, [head, FormatArgumentsOnOneLine(call.args())]);
    }
    let content = format_args!(head, FormatArguments::from_call(e, call));
    match is_call_expression(call.callee(), f) {
        true => write!(f, group(&content)),
        false => write!(f, content),
    }
}

#[inline(never)]
pub(crate) fn write_import_expression<'a>(
    e: Expr<'a>,
    args: List<'a, Expr<'a>>,
    f: &mut Formatter<'a>,
) {
    let phase = e.import_call_phase();
    let head = format_args!("import", phase.map(|_| "."), phase);
    if is_template_on_its_own_line_only_argument(args, f)
        || is_lone_string_without_comments(args, f)
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

/// A comment at the end of the callee's line stays there. oxfmt, like Prettier 3.8, moves it after the call:
/// `call // comment\n()` is `call(); // comment`.
fn boundary_after_callee(f: &Formatter<'_>) -> Option<LineSuffixBoundary> {
    (!f.options().flavor.is_oxfmt()).then_some(line_suffix_boundary())
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

/// Prettier's `isTemplateOnItsOwnLine` for the only argument, if it isn't formatted as its embedded language.
fn is_template_on_its_own_line_only_argument<'a>(
    args: List<'a, Expr<'a>>,
    f: &Formatter<'a>,
) -> bool {
    let is_own_line_template = |only| {
        is_multiline_template_starting_on_same_line(only, f.source_text())
            && !arguments::has_embed_label(only, f)
            && !is_cast_target(only, f)
    };
    args.len() == 1 && args.first().is_some_and(is_own_line_template)
}

/// True if the only argument is a string without comments.
fn is_lone_string_without_comments<'a>(args: List<'a, Expr<'a>>, f: &Formatter<'a>) -> bool {
    args.len() == 1
        && args.first().is_some_and(|first| {
            first.tag() == ExprTag::String && (f.is_quiet() || !has_comments(first, f))
        })
}

fn is_identifier(e: Expr<'_>, name: &[u8]) -> bool {
    e.tag() == ExprTag::Ident && e.text() == name
}

/// Prettier's `isSimpleModuleImport` for a call: `require("a")`, `require.resolve("a")`, `require.resolve.paths("a")`,
/// `import.meta.resolve("a")`. A long module name is no reason to break.
fn is_simple_module_import<'a>(call: Call<'a>, f: &Formatter<'a>) -> bool {
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
    is_module_function && is_lone_string_without_comments(call.args(), f)
}

/// `require("a" // comment⏎)` is `require("a"); // comment` for oxfmt.
fn only_leading_comment_breaks_require(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

/// Prettier's `isCommonsJsOrAmdModuleDefinition`: `require("a", b)`, and AMD's `define`.
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
                && (f.is_quiet()
                    || !args.first().is_some_and(
                        |first| match only_leading_comment_breaks_require(f) {
                            true => !comments_of_outermost_node(first, f).leading.is_empty(),
                            false => has_comments(first, f),
                        },
                    ))
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
