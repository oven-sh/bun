use bun_lint_oxlint::ast_util::{get_inner_expression, is_global_reference, static_property_name};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use rustc_hash::FxHashSet;

/// Disallows use of `process.env`.
pub struct NoProcessEnv {
    allowed_variables: FxHashSet<Box<[u8]>>,
}

const NO_PROCESS_ENV: Message = Message::new("", "Disallowed usage of `process.env`.");

impl Rule for NoProcessEnv {
    const META: Meta = Meta::oxlint(Plugin::Node, "no-process-env", Kind::Suggestion);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let allowed = options.object(0).strings("allowedVariables");
        NoProcessEnv { allowed_variables: allowed.iter().map(|it| it.as_bytes().into()).collect() }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.mentions("process") || !file.mentions("env") {
            return;
        }
        on.exprs([ExprTag::Dot, ExprTag::Index], |rule, member, cx| {
            if !static_property_name(member).is_some_and(|name| name.is("env"))
                || !member.object().map(get_inner_expression).is_some_and(|it| it.is_ident("process") && is_global_reference(it))
                || member.is_jsx_tag_name()
                || member.is_in_type_query()
            {
                return;
            }
            // `process.env.ALLOWED`
            let variable = match member.parent() {
                Node::Expr(parent) if parent.object() == Some(member) && !member.is_parenthesized() && !member.is_chain_root() => {
                    static_property_name(parent)
                }
                _ => None,
            };
            if !variable.is_some_and(|name| rule.allowed_variables.contains(name.bytes())) {
                cx.report(member, NO_PROCESS_ENV);
            }
        });
    }
}
