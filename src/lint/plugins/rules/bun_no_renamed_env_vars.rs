use crate::bun::has_word;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow environment variables that Bun has renamed.
pub struct NoRenamedEnvVars;

const RENAMED: &Message = &Message::new("renamed", "`{{old}}` is now `{{new}}`. Bun doesn't start with the old name set.");

const OLD: &str = "BUN_JSC_useSharedArrayBuffer";
const NEW: &str = "BUN_JSC_alwaysUseSharedArrayBuffer";

impl Rule for NoRenamedEnvVars {
    const META: Meta = Meta::plugin(Plugin::Bun, "no-renamed-env-vars", Kind::Problem).fixable(Fixable::Code);
    const ON: On = On::new().exprs(&[ExprTag::Dot, ExprTag::Index]).props().finish();
    /// The names, and whether each is a shorthand property.
    type State<'a> = Vec<(Span, bool)>;

    fn new(_: &Options) -> Self {
        NoRenamedEnvVars
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        file.mentions(OLD).then(Vec::new)
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let name = match e.kind() {
            ExprKind::Dot { name, .. } if name.name().is(OLD) => name.span(),
            ExprKind::Index { index, .. } if index.as_string().is_some_and(|it| it.is(OLD)) => index.span().shrink(1, 1),
            _ => return,
        };
        // `delete env.OLD` keeps a child process from getting it.
        if e.parent().as_expr().and_then(Expr::unary_op) != Some(UnOp::Delete) {
            cx.state.push((name, false));
        }
    }

    fn prop<'a>(&self, prop: Prop<'a>, cx: &mut Cx<'a, Self>) {
        if let Some(key) = prop.key().filter(|it| it.is(OLD)) {
            let written = key.inner_span(cx.file());
            let name = if written.len() as usize == OLD.len() { written } else { written.shrink(1, 1) };
            cx.state.push((name, prop.kind() == PropKind::Shorthand));
        }
    }

    fn finish<'a>(&self, cx: &mut Cx<'a, Self>) {
        if cx.state.is_empty() || has_word(cx.file(), &[NEW]) {
            return;
        }
        for (name, _) in &cx.state {
            // All at once, because a file with the new name isn't checked again.
            cx.report(*name, RENAMED).data("old", OLD).data("new", NEW).fix(|fixer| {
                Vec::from_iter(cx.state.iter().map(|&(name, is_shorthand)| match is_shorthand {
                    true => fixer.insert_before(name, [NEW, ": "].concat()),
                    false => fixer.replace(name, NEW),
                }))
            });
        }
    }
}
