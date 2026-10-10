use bun_lint_oxlint::ast_util::{get_inner_expression, static_name};
use crate::jsx::{as_jsx_element, children};
use crate::react::{FlagsOfVariables, Variables, is_padding_spaces};
use crate::util_ast::name_of_key;
use crate::util_is_create_element::is_member_called;
use crate::util_variable::get_variable_from_context;
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow when a DOM element is using both children and dangerouslySetInnerHTML.
pub struct NoDangerWithChildren;

const DANGER_WITH_CHILDREN: Message =
    Message::new("dangerWithChildren", "Only set one of `children` or `props.dangerouslySetInnerHTML`");
const NO_DANGER_WITH_CHILDREN: Message =
    Message::new("", "Only set one of `children` or `props.dangerouslySetInnerHTML`");

/// Which of the two something has.
const CHILDREN: u8 = 1 << 0;
const DANGER: u8 = 1 << 1;

#[derive(Default)]
pub struct State<'a> {
    props_of_variables: FlagsOfVariables<'a>,
}

impl Rule for NoDangerWithChildren {
    const META: Meta = Meta::plugin(Plugin::React, "no-danger-with-children", Kind::Problem).recommended();
    const ON: On = On::new().exprs(&[ExprTag::Jsx, ExprTag::Call]);
    type State<'a> = State<'a>;

    fn new(_: &Options) -> Self {
        NoDangerWithChildren
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        let on = On::new().exprs(&[ExprTag::Jsx]);
        // For upstream `a.#createElement` has that name too.
        if !file.mentions("createElement") && (file.language().is_oxlint || !file.mentions("#createElement")) {
            return on;
        }
        on.exprs(&[ExprTag::Call])
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        if !file.mentions("dangerouslySetInnerHTML") {
            return None;
        }
        Some(State::default())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        match e.tag() {
            ExprTag::Jsx => self.jsx(e, cx),
            ExprTag::Call => self.call(e, cx),
            _ => {}
        }
    }
}

impl NoDangerWithChildren {
    fn jsx<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(jsx) = as_jsx_element(e) else {
            return;
        };
        if jsx.attrs().is_empty() {
            return;
        }
        let is_oxlint = cx.language().is_oxlint;
        let props = props_of_element(e, jsx, &mut cx.state.props_of_variables, is_oxlint);
        // Children are passed as `children={}` or are between the tags.
        let has_children = || match is_oxlint {
            true => children(cx.file(), jsx).next().is_some_and(|first| !is_padding_spaces(first)),
            false => jsx.children_with_whitespace().next().is_some_and(|first| !is_line_break(cx.file(), first)),
        };
        if props & DANGER != 0 && (props & CHILDREN != 0 || has_children()) {
            cx.report(e, message(is_oxlint));
        }
    }

    fn call<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(call) = e.as_call() else {
            return;
        };
        let is_oxlint = cx.language().is_oxlint;
        let (arguments, callee) = (call.args(), call.callee());
        // For oxlint parentheses are a node, and it is `a.createElement` alone.
        let is_create_element = || match callee.member_name() {
            Some(name) if is_oxlint => name.name().is("createElement") && !callee.is_parenthesized(),
            _ => !is_oxlint && is_member_called(callee, "createElement"),
        };
        if arguments.len() <= 1 || !is_create_element() {
            return;
        }
        let is_seen = |it: &Expr| it.tag() != ExprTag::Spread && !(is_oxlint && it.is_parenthesized());
        let Some(props) = arguments.get(1).filter(is_seen) else {
            return;
        };
        let known = &mut cx.state.props_of_variables;
        let props = match props.kind() {
            // oxlint does not follow what is spread here.
            ExprKind::Object(properties) if is_oxlint => props_of_object(properties, is_oxlint),
            ExprKind::Object(properties) => {
                let spread = variables_spread_in(props, properties, is_oxlint).into_iter();
                let own = props_of_object(properties, is_oxlint);
                spread.fold(own, |props, it| props | props_of_variable(it, known, is_oxlint))
            }
            ExprKind::Ident(_) => {
                variable(props, Node::Expr(e), is_oxlint).map_or(0, |it| props_of_variable(it, known, is_oxlint))
            }
            _ => 0,
        };
        // A third argument is a child.
        if props & DANGER != 0 && (props & CHILDREN != 0 || arguments.len() > 2) {
            cx.report(e, message(is_oxlint));
        }
    }
}

fn message(is_oxlint: bool) -> Message {
    if is_oxlint { NO_DANGER_WITH_CHILDREN } else { DANGER_WITH_CHILDREN }
}

fn prop(name: &[u8]) -> u8 {
    match name {
        b"children" => CHILDREN,
        b"dangerouslySetInnerHTML" => DANGER,
        _ => 0,
    }
}

/// `isLineBreak`
fn is_line_break<'a>(file: &'a File<'a>, child: JsxChild<'a>) -> bool {
    let (written, value) = match child {
        JsxChild::Whitespace(span) => (file.slice(span), None),
        JsxChild::Expr(e) if e.is_jsx_text() => (e.text(), e.jsx_text_value()),
        JsxChild::Expr(_) => return false,
    };
    strings::contains_js_line_break(written) && strings::is_all_js_whitespace(value.as_deref().unwrap_or(written))
}

/// The attributes that the element has, and the properties of the variables that it spreads.
fn props_of_element<'a>(e: Expr<'a>, jsx: Jsx<'a>, known: &mut FlagsOfVariables<'a>, is_oxlint: bool) -> u8 {
    jsx.attrs().iter().fold(0, |props, attribute| {
        props
            | match attribute.kind() {
                PropKind::Spread => (attribute.value())
                    .and_then(|argument| variable(argument, Node::Expr(e), is_oxlint))
                    .map_or(0, |it| props_of_variable(it, known, is_oxlint)),
                _ => attribute.key().and_then(Key::name).map_or(0, |name| prop(name.bytes())),
            }
    })
}

/// The variable that `ident` names where `node` is.
fn variable<'a>(ident: Expr<'a>, node: Node<'a>, is_oxlint: bool) -> Option<Symbol<'a>> {
    // oxlint looks through parentheses and the wrappers of TypeScript.
    if is_oxlint {
        return get_inner_expression(ident).symbol();
    }
    get_variable_from_context(node, ident.as_ident()?)
}

/// Of a variable that is declared with an object: the properties of the object, and those of such variables that it
/// spreads.
fn props_of_variable<'a>(variable: Symbol<'a>, known: &mut FlagsOfVariables<'a>, is_oxlint: bool) -> u8 {
    known.of_variable(variable, |it| declared_with(it, is_oxlint))
}

fn declared_with(variable: Symbol<'_>, is_oxlint: bool) -> (u8, Variables<'_>) {
    let init = match variable.declarations().next().and_then(Declaration::node) {
        Some(Node::VarDecl(declarator)) => declarator.init().filter(|it| !(is_oxlint && it.is_parenthesized())),
        _ => None,
    };
    match init.map(|it| (it, it.kind())) {
        Some((init, ExprKind::Object(properties))) => {
            (props_of_object(properties, is_oxlint), variables_spread_in(init, properties, is_oxlint))
        }
        _ => (0, Variables::new()),
    }
}

fn variables_spread_in<'a>(object: Expr<'a>, properties: List<'a, Prop<'a>>, is_oxlint: bool) -> Variables<'a> {
    let spread = properties.iter().filter(|it| it.kind() == PropKind::Spread).filter_map(Prop::value);
    spread.filter_map(|it| variable(it, Node::Expr(object), is_oxlint)).collect()
}

fn props_of_object<'a>(properties: List<'a, Prop<'a>>, is_oxlint: bool) -> u8 {
    // For oxlint it is what the key says, for upstream the name that is written: `[children]`, not `"children"`.
    let name = |key: Key<'a>| if is_oxlint { static_name(key).map(Name::bytes) } else { name_of_key(key) };
    properties.iter().filter_map(|it| it.key().and_then(name)).fold(0, |props, key| props | prop(key))
}
