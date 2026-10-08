//! `callee(args)`, `new callee(args)`, `import(args)`

pub(crate) mod arguments;

use self::arguments::{FormatArguments, is_simple_module_import};
use super::arrow_function_expression::is_multiline_template_starting_on_same_line;
use super::type_parameters::type_arguments;
use crate::js::utils::call_expression::is_test_call_expression;
use crate::js::utils::format_node_without_trailing_comments::FormatNodeWithoutTrailingComments;
use crate::js::utils::member_chain::MemberChain;
use crate::prelude::*;
use crate::write;

pub(crate) fn write_call_expression<'a>(e: Expr<'a>, call: Call<'a>, f: &mut Formatter<'a>) {
    let callee = call.callee();
    let arguments = FormatArguments::of_call(e, call);
    let callee_node = callee.as_ast_nodes();

    let is_template_literal_single_arg = call.args().len() == 1
        && call.args().first().is_some_and(|it| is_multiline_template_starting_on_same_line(it, f.source_text()));

    if !is_template_literal_single_arg
        && matches!(callee_node, AstNodes::StaticMemberExpression(_) | AstNodes::ComputedMemberExpression(_))
        && !is_simple_module_import(&arguments, f.comments())
        && !is_test_call_expression(e)
    {
        return MemberChain::from_call_expression(e, f).fmt(f);
    }

    let format_inner = format_with(|f| {
        // The comments after the callee stay there in `call /**/()` and `call /**/<T>()`.
        if !call.type_args().is_empty() || f.is_quiet() {
            write!(f, callee);
        } else {
            write!(f, FormatNodeWithoutTrailingComments(&callee));
            let character = match () {
                // `alert /* comment */?.("value")`
                () if call.is_optional() => Some(b'?'),
                () if call.args().is_empty() => Some(b'('),
                () => None,
            };
            if let Some(character) = character {
                let callee_trailing_comments = f.comments().comments_before_character(callee.span().end, character);
                write!(f, FormatTrailingComments::Comments(callee_trailing_comments));
            }
        }
        write!(f, [call.is_optional().then_some("?."), type_arguments(call.type_args(), Node::Expr(e)), arguments]);
    });
    match callee_node {
        AstNodes::CallExpression(_) => write!(f, group(&format_inner)),
        _ => write!(f, format_inner),
    }
}

pub(crate) fn write_new_expression<'a>(e: Expr<'a>, call: Call<'a>, f: &mut Formatter<'a>) {
    write!(
        f,
        ["new", space(), call.callee(), type_arguments(call.type_args(), Node::Expr(e)), FormatArguments::of_call(e, call)]
    );
}

pub(crate) fn write_import_expression<'a>(e: Expr<'a>, args: List<'a, Expr<'a>>, f: &mut Formatter<'a>) {
    write!(f, "import");
    if e.is_deferred_import_call() {
        write!(f, ".defer");
    }
    write!(f, FormatArguments::new(args, AstNodes::ImportExpression(e)));
}
