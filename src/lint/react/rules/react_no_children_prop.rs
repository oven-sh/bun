use crate::react::is_create_element_call;
use crate::util_ast::name_of_key;
use crate::util_is_create_element::is_create_element;
use crate::util_pragma::get_from_context;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint_oxlint::ast_util::static_name;

/// Disallow passing of children as props
pub struct NoChildrenProp {
    /// oxlint has no such option.
    allow_functions: bool,
}

const NEST_CHILDREN: Message = Message::new(
    "nestChildren",
    "Do not pass children as props. Instead, nest children between the opening and closing tags.",
);
const PASS_CHILDREN_AS_ARGS: Message = Message::new(
    "passChildrenAsArgs",
    "Do not pass children as props. Instead, pass them as additional arguments to React.createElement.",
);
const NEST_FUNCTION: Message = Message::new(
    "nestFunction",
    "Do not nest a function between the opening and closing tags. Instead, pass it as a prop.",
);
const PASS_FUNCTION_AS_ARGS: Message = Message::new(
    "passFunctionAsArgs",
    "Do not pass a function as an additional argument to React.createElement. Instead, pass it as a prop.",
);
const NO_CHILDREN_PROP: Message = Message::new("", "Avoid passing children using a prop.");

impl Rule for NoChildrenProp {
    const META: Meta = Meta::plugin(Plugin::React, "no-children-prop", Kind::None).recommended();
    const ON: On = On::new().exprs(&[ExprTag::Jsx, ExprTag::Call]);
    /// The pragma. `None`: nobody has asked yet. oxlint knows none.
    type State<'a> = Option<&'a [u8]>;

    fn new(options: &Options) -> Self {
        NoChildrenProp { allow_functions: options.object(0).bool_or("allowFunctions", false) }
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        let on = On::new().exprs(&[ExprTag::Jsx]);
        // Upstream takes `React.#createElement` for `React.createElement`.
        let is_private = || !file.language().is_oxlint && file.mentions("#createElement");
        if file.mentions("createElement") || is_private() { on.exprs(&[ExprTag::Call]) } else { on }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        (file.mentions("children") || (self.allow_functions && !file.language().is_oxlint)).then_some(None)
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        match e.tag() {
            ExprTag::Jsx => self.jsx(e, cx),
            ExprTag::Call => self.call(e, cx),
            _ => {}
        }
    }
}

impl NoChildrenProp {
    /// upstream's `isFunction`
    fn is_function(&self, node: Expr<'_>) -> bool {
        self.allow_functions && node.as_fn().is_some_and(ast_utils::is_function_with_body)
    }

    fn jsx<'a>(&self, e: Expr<'a>, cx: &Cx<'a, Self>) {
        let ExprKind::Jsx(jsx) = e.kind() else {
            return;
        };
        let is_oxlint = cx.language().is_oxlint;
        let is_function_in_braces = |it: Expr<'a>| it.jsx_container_span().is_some() && self.is_function(it);
        for attribute in jsx.attrs() {
            let Some(key) = attribute.key().filter(|key| key.is("children")) else {
                continue;
            };
            if is_oxlint {
                // oxlint points at the name.
                cx.report(key.span(cx.file()), NO_CHILDREN_PROP);
            } else if !attribute.value().is_some_and(is_function_in_braces) {
                cx.report(attribute, NEST_CHILDREN);
            }
        }
        if is_oxlint || !self.allow_functions || jsx.is_fragment() {
            return;
        }
        let mut children = jsx.children_with_whitespace();
        if let (Some(JsxChild::Expr(child)), None) = (children.next(), children.next())
            && is_function_in_braces(child)
        {
            cx.report(e, NEST_FUNCTION);
        }
    }

    fn call<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(call) = e.as_call() else {
            return;
        };
        let is_oxlint = cx.language().is_oxlint;
        let arguments = call.args();
        // oxlint has a node for parentheses.
        let Some(ExprKind::Object(properties)) =
            arguments.get(1).filter(|it| !is_oxlint || !it.is_parenthesized()).map(Expr::kind)
        else {
            return;
        };
        // oxlint takes the `createElement` of everything but `document`.
        let is_creation = match is_oxlint {
            true => is_create_element_call(call),
            false => {
                let file = cx.file();
                is_create_element(e, *cx.state.get_or_insert_with(|| get_from_context(file)))
            }
        };
        if !is_creation {
            return;
        }
        // oxlint: also `"children"`, and not `[children]`.
        let is_children = |key: &Key<'a>| match is_oxlint {
            true => static_name(*key).is_some_and(|name| name.is("children")),
            false => name_of_key(*key).is_some_and(|name| name == b"children"),
        };
        let children_prop = properties.iter().find_map(|it| Some((it, it.key().filter(is_children)?)));
        match children_prop {
            // oxlint points at the key.
            Some((_, key)) if is_oxlint => {
                cx.report(key.inner_span(cx.file()), NO_CHILDREN_PROP);
            }
            Some((children_prop, _)) if children_prop.value().is_some_and(|it| !self.is_function(it)) => {
                cx.report(e, PASS_CHILDREN_AS_ARGS);
            }
            None if !is_oxlint && arguments.len() == 3 && arguments.get(2).is_some_and(|it| self.is_function(it)) => {
                cx.report(e, PASS_FUNCTION_AS_ARGS);
            }
            _ => {}
        }
    }
}
