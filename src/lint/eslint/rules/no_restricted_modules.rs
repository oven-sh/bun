use bun_core::strings;
use super::no_restricted_imports::{IgnoreRules, IgnoreSyntax, ignore_rules};
use bun_lint::prelude::*;

/// Disallow specified modules when loaded by `require`.
pub struct NoRestrictedModules {
    /// Each with its custom message. Of two with the same name, the last counts.
    paths: Vec<(Vec<u8>, Option<Vec<u8>>)>,
    patterns: Option<IgnoreRules>,
}

const DEFAULT_MESSAGE: Message =
    Message::new("defaultMessage", "'{{name}}' module is restricted from being used.");
const CUSTOM_MESSAGE: Message = Message::new(
    "customMessage",
    "'{{name}}' module is restricted from being used. {{customMessage}}",
);
const PATTERN_MESSAGE: Message = Message::new(
    "patternMessage",
    "'{{name}}' module is restricted from being used by a pattern.",
);

impl NoRestrictedModules {
    fn check<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Call(call) = e.kind() else {
            return;
        };
        if !call.callee().is_ident("require") {
            return;
        }
        let name = match call.args().first().map(Expr::kind) {
            Some(ExprKind::String(value)) => Some(value),
            Some(ExprKind::Template(template)) => template.as_static(),
            _ => None,
        };
        let Some(name) = name.map(|it| strings::trim_js_whitespace(it.bytes())).filter(|it| !it.is_empty()) else {
            return;
        };
        if let Some((_, message)) = self.paths.iter().rfind(|it| it.0 == name) {
            match message {
                Some(message) => cx
                    .report(e, CUSTOM_MESSAGE)
                    .data("name", name)
                    .data("customMessage", message.clone()),
                None => cx.report(e, DEFAULT_MESSAGE).data("name", name),
            };
        }
        if self.patterns.as_ref().is_some_and(|it| it.ignores(name)) {
            cx.report(e, PATTERN_MESSAGE).data("name", name);
        }
    }
}

impl Rule for NoRestrictedModules {
    const META: Meta = Meta::eslint("no-restricted-modules", Kind::Suggestion).deprecated();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let first = options.object(0);
        let (paths, patterns) = match first.has("paths") || first.has("patterns") {
            true => (first.array("paths"), first.strings("patterns")),
            false => (options.all(), Vec::new()),
        };
        let paths = paths.iter().filter_map(|path| match path {
            Json::String(name) => Some((name.clone(), None)),
            _ => {
                let path = Object::of(Some(path));
                let message = path.str("message").filter(|it| !it.is_empty());
                Some((path.str("name")?.into(), message.map(Into::into)))
            }
        });
        NoRestrictedModules {
            paths: paths.collect(),
            patterns: (!patterns.is_empty()).then(|| ignore_rules(&patterns, true, IgnoreSyntax::Npm5)),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        if !self.paths.is_empty() || self.patterns.is_some() {
            on.exprs([ExprTag::Call], Self::check);
        }
    }
}
