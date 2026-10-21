use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::ancestor_memo::AncestorMemo;

/// Disallow `renderItem()` functions that are defined inside a component and used in its JSX.
pub struct ReactNoLocalRenderHelpers {
    /// `pattern`. The default matches `render` followed by a capital letter.
    pattern: Option<Regex>,
}

const LOCAL_HELPER: Message = Message::new(
    "localHelper",
    "`{{name}}` is created again on every render, and React does not see it as a component. Move it out and make it a component.",
);

impl ReactNoLocalRenderHelpers {
    fn is_render_name(&self, name: &[u8]) -> bool {
        match &self.pattern {
            Some(pattern) => pattern.test(name),
            None => name.strip_prefix(b"render").and_then(<[u8]>::first).is_some_and(u8::is_ascii_uppercase),
        }
    }
}

/// Returns the function that `symbol` names: `function a() {}`, `const a = () => {}`.
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
    const ON: On = On::new().symbols();
    /// Caches a node's innermost enclosing JSX element.
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

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        if !file.has_exprs([ExprTag::Jsx]) {
            return None;
        }
        Some(AncestorMemo::default())
    }

    fn symbol<'a>(&self, symbol: Symbol<'a>, cx: &mut Cx<'a, Self>) {
        if !self.is_render_name(symbol.name().bytes()) {
            return;
        }
        let Some(enclosing_function) = function_of(symbol).and_then(Func::enclosing) else {
            return;
        };
        // Either it's called, or it's passed to a function that calls it.
        let uses = symbol.references().filter_map(Reference::expr);
        let mut uses = uses.filter(|it| it.parent().as_expr().is_some_and(|it| it.tag() == ExprTag::Call));
        let element = |_, parent: Node<'a>| parent.as_expr().filter(|it| it.tag() == ExprTag::Jsx);
        let is_in_jsx = uses.any(|it| {
            let found = cx.state.find(Node::Expr(it), element);
            found.is_some_and(|found| enclosing_function.span().contains(found.span()))
        });
        if is_in_jsx && let Some(span) = symbol.declarations().next().and_then(Declaration::name_span) {
            cx.report(span, LOCAL_HELPER).data("name", symbol.name());
        }
    }
}
