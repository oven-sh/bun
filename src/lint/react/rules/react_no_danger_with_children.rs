use bun_lint_oxlint::ast_util::{get_inner_expression, static_name};
use crate::jsx::{Child, as_jsx_element, children};
use crate::react::{FlagsOfVariables, Variables};
use bun_lint_oxlint::text::is_whitespace;
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallows DOM elements from using both `children` and `dangerouslySetInnerHTML` properties.
pub struct NoDangerWithChildren;

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
    const META: Meta = Meta::oxlint(Plugin::React, "no-danger-with-children", Kind::Problem);
    type State<'a> = State<'a>;

    fn new(_: &Options) -> Self {
        NoDangerWithChildren
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> Self::State<'a> {
        if !file.mentions("dangerouslySetInnerHTML") {
            return State::default();
        }
        on.exprs([ExprTag::Jsx], |_, e, cx| {
            let Some(jsx) = as_jsx_element(e) else {
                return;
            };
            if jsx.attrs().is_empty() {
                return;
            }
            let props = props_of_element(jsx, &mut cx.state.props_of_variables);
            // Children are passed as `children={}` or are between the tags.
            let has_children = || children(cx.file(), jsx).next().is_some_and(|first| !is_line_break(first));
            if props & DANGER != 0 && (props & CHILDREN != 0 || has_children()) {
                cx.report(e, NO_DANGER_WITH_CHILDREN);
            }
        });
        if !file.mentions("createElement") {
            return State::default();
        }
        on.exprs([ExprTag::Call], |_, e, cx| {
            let Some(call) = e.as_call() else {
                return;
            };
            let (arguments, callee) = (call.args(), call.callee());
            if arguments.len() <= 1
                || !callee.member_name().is_some_and(|name| name.name().is("createElement"))
                || callee.is_parenthesized()
            {
                return;
            }
            let Some(props) = arguments.get(1).filter(|it| it.tag() != ExprTag::Spread && !it.is_parenthesized())
            else {
                return;
            };
            let props = match props.kind() {
                ExprKind::Object(properties) => props_of_object(properties),
                ExprKind::Ident(_) => props_of_variable(props, &mut cx.state.props_of_variables),
                _ => 0,
            };
            // A third argument is a child.
            if props & DANGER != 0 && (props & CHILDREN != 0 || arguments.len() > 2) {
                cx.report(e, NO_DANGER_WITH_CHILDREN);
            }
        });
        State::default()
    }
}

fn is_line_break(child: Child) -> bool {
    matches!(child, Child::Text(text) if is_whitespace(text) && strings::contains_char(text, b'\n'))
}

fn prop(name: &[u8]) -> u8 {
    match name {
        b"children" => CHILDREN,
        b"dangerouslySetInnerHTML" => DANGER,
        _ => 0,
    }
}

/// The attributes that the element has, and the properties of the variables that it spreads.
fn props_of_element<'a>(jsx: Jsx<'a>, known: &mut FlagsOfVariables<'a>) -> u8 {
    jsx.attrs().iter().fold(0, |props, attribute| {
        props
            | match attribute.kind() {
                PropKind::Spread => attribute.value().map_or(0, |argument| props_of_variable(argument, known)),
                _ => attribute.key().and_then(Key::name).map_or(0, |name| prop(name.bytes())),
            }
    })
}

/// Of a variable that is declared with an object: the properties of the object, and those of such variables that it
/// spreads.
fn props_of_variable<'a>(ident: Expr<'a>, known: &mut FlagsOfVariables<'a>) -> u8 {
    get_inner_expression(ident).symbol().map_or(0, |variable| known.of_variable(variable, declared_with))
}

fn declared_with(variable: Symbol<'_>) -> (u8, Variables<'_>) {
    let init = match variable.declarations().next().and_then(Declaration::node) {
        Some(Node::VarDecl(declarator)) => declarator.init().filter(|it| !it.is_parenthesized()),
        _ => None,
    };
    let Some(ExprKind::Object(properties)) = init.map(Expr::kind) else {
        return (0, Variables::new());
    };
    let spread = properties.iter().filter(|it| it.kind() == PropKind::Spread).filter_map(Prop::value);
    (props_of_object(properties), spread.filter_map(|it| get_inner_expression(it).symbol()).collect())
}

fn props_of_object<'a>(properties: List<'a, Prop<'a>>) -> u8 {
    properties.iter().filter_map(|it| it.key().and_then(static_name)).fold(0, |props, key| props | prop(key.bytes()))
}
