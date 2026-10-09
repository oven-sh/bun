use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::ancestor_memo::AncestorMemo;

/// Disallow a function that is defined in a component, is named like one that renders, and is used in the JSX there.
pub struct ReactNoLocalRenderHelpers {
    /// `pattern`. Without it: `render` and a capital letter.
    pattern: Option<Regex>,
}

const LOCAL_HELPER: Message = Message::new(
    "localHelper",
    "`{{name}}` is made anew whenever the function around it runs, and React does not know it. Make it a component outside.",
);

impl ReactNoLocalRenderHelpers {
    fn is_render_name(&self, name: &[u8]) -> bool {
        match &self.pattern {
            Some(pattern) => pattern.test(name),
            None => name.strip_prefix(b"render").and_then(<[u8]>::first).is_some_and(u8::is_ascii_uppercase),
        }
    }
}

/// The function that `symbol` is the name of: `function a() {}`, `const a = () => {}`.
fn function_of(symbol: Symbol<'_>) -> Option<Func<'_>> {
    match symbol.declarations().next()? {
        Declaration::Fn(func) => Some(func),
        declaration @ Declaration::Var(_) => match declaration.node()? {
            Node::VarDecl(it) => it.init()?.as_fn(),
            _ => None,
        },
        _ => None,
    }
}

impl Rule for ReactNoLocalRenderHelpers {
    const META: Meta = Meta::plugin(Plugin::Bun, "react-no-local-render-helpers", Kind::Suggestion);
    /// The innermost JSX element around a node.
    type State<'a> = AncestorMemo<'a, Expr<'a>>;

    fn new(options: &Options) -> Self {
        ReactNoLocalRenderHelpers { pattern: options.object(0).regex("pattern", "u") }
    }

    fn validate(options: &Options) -> Result<(), Vec<u8>> {
        match options.object(0).str("pattern").map(|it| Regex::new(it, "u")) {
            Some(Err(error)) => Err(error.message.into_bytes()),
            _ => Ok(()),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> Self::State<'a> {
        if file.has_exprs([ExprTag::Jsx]) {
            on.symbols(|rule, symbol, cx| {
                if !rule.is_render_name(symbol.name().bytes()) {
                    return;
                }
                let Some(around) = function_of(symbol).and_then(Func::enclosing) else {
                    return;
                };
                // It is called, or it is handed to what calls it.
                let uses = symbol.references().filter_map(Reference::expr);
                let mut uses = uses.filter(|it| it.parent().as_expr().is_some_and(|it| it.tag() == ExprTag::Call));
                let element = |_, parent: Node<'a>| parent.as_expr().filter(|it| it.tag() == ExprTag::Jsx);
                let is_in_jsx = uses.any(|it| {
                    let found = cx.state.find(Node::Expr(it), element);
                    found.is_some_and(|found| around.span().contains(found.span()))
                });
                if is_in_jsx && let Some(span) = symbol.declarations().next().and_then(Declaration::name_span) {
                    cx.report(span, LOCAL_HELPER).data("name", symbol.name());
                }
            });
        }
        AncestorMemo::default()
    }
}
