use crate::oxlint::promise::is_promise_constructor;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforce standard parameter names for Promise constructors.
pub struct ParamNames {
    resolve_pattern: Option<Pattern>,
    reject_pattern: Option<Pattern>,
}

struct Pattern {
    regex: Regex,
    /// As it is in the configuration.
    text: String,
}

const PARAM_NAMES: Message = Message::new("", "Promise constructor parameters must be named to match `{{pattern}}`");

impl Rule for ParamNames {
    const META: Meta = Meta::oxlint(Plugin::Promise, "param-names", Kind::Suggestion);
    const ON: On = On::new().exprs(&[ExprTag::New]);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        let pattern = |key: &str| Some(Pattern { regex: options.regex(key, "")?, text: options.str(key)?.to_owned() });
        ParamNames { resolve_pattern: pattern("resolvePattern"), reject_pattern: pattern("rejectPattern") }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        file.mentions("Promise").then_some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::New(new_expr) = e.kind() else {
            return;
        };
        if new_expr.args().len() != 1 || !is_promise_constructor(new_expr) {
            return;
        }
        let Some(executor) = new_expr.args().first().filter(|it| !it.is_parenthesized()).and_then(Expr::as_fn) else {
            return;
        };
        let expected = [
            (&self.resolve_pattern, ["_resolve", "resolve"], "^_?resolve$"),
            (&self.reject_pattern, ["_reject", "reject"], "^_?reject$"),
        ];
        for (param, (pattern, names, default_pattern)) in executor.params().iter().filter(|it| !it.is_rest()).zip(expected) {
            let Some(name) = param.pat().as_ident() else {
                continue;
            };
            match pattern {
                Some(pattern) if !pattern.regex.test(name.bytes()) => {
                    cx.report(param.pat(), PARAM_NAMES).data("pattern", pattern.text.clone());
                }
                None if !name.is_any(&names) => {
                    cx.report(param.pat(), PARAM_NAMES).data("pattern", default_pattern);
                }
                _ => {}
            }
        }
    }
}
