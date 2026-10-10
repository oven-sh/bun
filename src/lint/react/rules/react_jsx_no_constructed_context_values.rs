use bun_lint_oxlint::ast_util::{as_function, as_method_definition, get_inner_expression};
use crate::jsx::get_prop_value;
use crate::react::{FlagsOfVariables, Variables, is_jsx};
use crate::util_components::Components;
use crate::util_components_list::At;
use crate::util_is_create_element::is_member_called;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use bun_lint::utils::{estree_span, normalize};
use rustc_hash::FxHashMap;
use smallvec::{SmallVec, smallvec};
use std::collections::hash_map::Entry;

/// Disallows JSX context provider values from taking values that will cause needless rerenders
pub struct JsxNoConstructedContextValues;

const WITH_IDENTIFIER_MSG: Message = Message::new(
    "withIdentifierMsg",
    "The '{{variableName}}' {{type}} (at line {{nodeLine}}) passed as the value prop to the Context provider (at line {{usageLine}}) changes every render. To fix this consider wrapping it in a useMemo hook.",
);
const WITH_IDENTIFIER_MSG_FUNC: Message = Message::new(
    "withIdentifierMsgFunc",
    "The '{{variableName}}' {{type}} (at line {{nodeLine}}) passed as the value prop to the Context provider (at line {{usageLine}}) changes every render. To fix this consider wrapping it in a useCallback hook.",
);
const DEFAULT_MSG: Message = Message::new(
    "defaultMsg",
    "The {{type}} passed as the value prop to the Context provider (at line {{nodeLine}}) changes every render. To fix this consider wrapping it in a useMemo hook.",
);
const DEFAULT_MSG_FUNC: Message = Message::new(
    "defaultMsgFunc",
    "The {{type}} passed as the value prop to the Context provider (at line {{nodeLine}}) changes every render. To fix this consider wrapping it in a useCallback hook.",
);
const JSX_NO_CONSTRUCTED_CONTEXT_VALUES: Message =
    Message::new("", "The Context `value` prop should not be constructed.");

#[derive(Default)]
pub struct State<'a> {
    inside_component: AncestorMemo<'a, ()>,
    /// 1 for a variable that is made anew each time the function that declares it runs.
    constructed_variables: FlagsOfVariables<'a>,
    /// What such a variable is in the end, for upstream.
    ends: FxHashMap<Symbol<'a>, Option<End<'a>>>,
    /// What upstream reports if the element is in a component.
    constructions: Vec<Construction<'a>>,
}

/// What upstream's `isConstruction` returns.
struct Construction<'a> {
    element: Expr<'a>,
    kind: &'static str,
    node: Node<'a>,
    usage: Option<Expr<'a>>,
}

/// `type` and `node` of that.
#[derive(Copy, Clone)]
struct End<'a> {
    kind: &'static str,
    node: Node<'a>,
}

/// A variable on the way to its end, with the `type` as far as its own initializer decides about it.
struct Step<'a> {
    variable: Symbol<'a>,
    kind: Option<&'static str>,
}

/// An expression on the way from the value of the attribute to what is made anew.
#[derive(Copy, Clone)]
struct Way<'a> {
    expr: Expr<'a>,
    /// The outermost variable, object of a member expression or assignment that the way leads through.
    usage: Option<Expr<'a>>,
    /// `type`, as far as the way decides about it.
    kind: Option<&'static str>,
}

/// Where a way ends.
struct Found<'a> {
    way: Way<'a>,
    /// `way.expr` is this variable, which is made anew.
    variable: Option<Symbol<'a>>,
}

/// oxlint asks one thing of the value of the attribute and another of what a variable is initialized with.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Place {
    Value,
    Init,
}

/// What a variable is declared as.
enum Definition<'a> {
    /// A function or a class.
    Made(Node<'a>),
    Init(Expr<'a>),
}

impl Rule for JsxNoConstructedContextValues {
    const META: Meta = Meta::plugin(Plugin::React, "jsx-no-constructed-context-values", Kind::None);
    const ON: On = On::new().exprs(&[ExprTag::Jsx]).finish();
    type State<'a> = State<'a>;

    fn new(_: &Options) -> Self {
        JsxNoConstructedContextValues
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        let on = On::new().exprs(&[ExprTag::Jsx]);
        // Which function is a component depends for upstream on what comes before it.
        if file.language().is_oxlint { on } else { on.finish() }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        (file.has_exprs([ExprTag::Jsx])
            && (!file.language().is_oxlint || is_jsx(file))
            && file.mentions("value")
            && file.mentions_any(&["Provider", "createContext"]))
        .then(State::default)
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Jsx(jsx) = e.kind() else {
            return;
        };
        let is_oxlint = cx.language().is_oxlint;
        if !jsx.tag().is_some_and(|name| is_context_provider(name, is_oxlint)) {
            return;
        }
        // For oxlint every function is a component.
        let is_component = |node: Node<'a>| as_function(node).is_some() || as_method_definition(node).is_some();
        if is_oxlint
            && cx
                .state
                .inside_component
                .find(Node::Expr(e), |_, ancestor| is_component(ancestor).then_some(()))
                .is_none()
        {
            return;
        }
        // upstream looks at the first.
        let count = if is_oxlint { usize::MAX } else { 1 };
        for attribute in jsx.attrs().iter().filter(|it| it.key().is_some_and(|key| key.is("value"))).take(count) {
            let Some(construction) = get_prop_value(attribute)
                .and_then(|it| it.as_expression())
                .and_then(|it| cx.state.is_construction(it, e, is_oxlint))
            else {
                continue;
            };
            if is_oxlint {
                cx.report(attribute, JSX_NO_CONSTRUCTED_CONTEXT_VALUES);
            } else {
                cx.state.constructions.push(construction);
            }
        }
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let mut constructions = std::mem::take(&mut cx.state.constructions);
        constructions.sort_unstable_by_key(|it| At::enter(Node::Expr(it.element)));
        let mut components = Components::new(cx.file());
        for construction in constructions {
            let element = Node::Expr(construction.element);
            components.advance(At::enter(element));
            if components.get_parent_component(element).is_some() {
                construction.report(cx);
            }
        }
    }
}

impl<'a> Construction<'a> {
    fn report(&self, cx: &Cx<'a, JsxNoConstructedContextValues>) {
        let at = estree_span(self.node);
        let is_function = matches!(self.kind, "function expression" | "function declaration");
        let message = match (self.usage, is_function) {
            (Some(_), true) => WITH_IDENTIFIER_MSG_FUNC,
            (Some(_), false) => WITH_IDENTIFIER_MSG,
            (None, true) => DEFAULT_MSG_FUNC,
            (None, false) => DEFAULT_MSG,
        };
        let report = cx.report(at, message).data("type", self.kind).data("nodeLine", cx.line_of(at.start));
        if let Some(usage) = self.usage {
            // `usage.name`
            let name = usage.as_ident().map_or(&b"undefined"[..], Name::bytes);
            report.data("usageLine", cx.line_of(usage.span().start)).data("variableName", name);
        }
    }
}

/// `<A.Provider>`, or `<A>` with `const A = createContext()`
fn is_context_provider(name: Expr, is_oxlint: bool) -> bool {
    match name.kind() {
        ExprKind::Dot { name, .. } => name.name().is("Provider"),
        // For oxlint `<a>` is the name of an element of HTML.
        ExprKind::Ident(ident) if is_oxlint && ident.bytes().first().is_some_and(u8::is_ascii_lowercase) => false,
        ExprKind::Ident(ident) => {
            // upstream looks for the name, be it that of a type.
            let variable = if is_oxlint { name.symbol() } else { Node::Expr(name).scope().resolve_name(ident) };
            let is_created = |init: Expr| is_create_context_call(init, is_oxlint);
            matches!(variable.and_then(|it| it.declarations().next()).and_then(Declaration::node),
            Some(Node::VarDecl(declarator)) if declarator.init().is_some_and(is_created))
        }
        _ => false,
    }
}

/// `createContext()`, `React.createContext()`
fn is_create_context_call(expr: Expr, is_oxlint: bool) -> bool {
    // Parentheses are nodes for oxlint.
    let is_plain = |it: Expr| !it.is_chain_root() && !(is_oxlint && it.is_parenthesized());
    let Some(callee) = expr.as_call().map(Call::callee).filter(|it| is_plain(expr) && is_plain(*it)) else {
        return false;
    };
    match callee.kind() {
        ExprKind::Ident(name) => name.is("createContext"),
        // For upstream also `React[createContext]()` and `React.#createContext()`.
        _ if !is_oxlint => {
            is_member_called(callee, "createContext") && callee.object().is_some_and(|it| it.is_ident("React"))
        }
        ExprKind::Dot { obj, name, .. } => {
            obj.is_ident("React") && !obj.is_parenthesized() && name.name().is("createContext")
        }
        _ => false,
    }
}

impl<'a> State<'a> {
    /// upstream's `isConstruction`. For oxlint: whether there is one.
    fn is_construction(&mut self, value: Expr<'a>, element: Expr<'a>, is_oxlint: bool) -> Option<Construction<'a>> {
        let mut ask = |it| is_constructed(&mut self.constructed_variables, it, is_oxlint);
        let (way, scope) = (Way { expr: value, usage: None, kind: None }, Node::Expr(element).scope());
        let Found { way, variable } = way.find_construction(Place::Value, scope, is_oxlint, &mut ask)?;
        let end = match variable.filter(|_| !is_oxlint) {
            None => End { kind: "", node: normalize(Node::Expr(way.expr)) },
            Some(variable) => self.end_of(variable)?,
        };
        Some(Construction { element, kind: way.kind.unwrap_or(end.kind), node: end.node, usage: way.usage })
    }

    /// Each variable is looked at once. `None` where upstream never ends.
    fn end_of(&mut self, mut variable: Symbol<'a>) -> Option<End<'a>> {
        let is_oxlint = false;
        let mut ask = |it| is_constructed(&mut self.constructed_variables, it, is_oxlint);
        let mut path: SmallVec<[Step<'a>; 4]> = SmallVec::new();
        let mut end = loop {
            match self.ends.entry(variable) {
                Entry::Occupied(known) => break *known.get(),
                Entry::Vacant(unknown) => unknown.insert(None),
            };
            let init = match definition_of(variable, is_oxlint) {
                None => break None,
                Some(Definition::Made(node)) => {
                    path.push(Step { variable, kind: None });
                    break Some(End { kind: "function declaration", node });
                }
                Some(Definition::Init(init)) => Way { expr: init, usage: None, kind: None },
            };
            let Some(found) = init.find_construction(Place::Init, variable.scope(), is_oxlint, &mut ask) else {
                break None;
            };
            path.push(Step { variable, kind: found.way.kind });
            match found.variable {
                None => break Some(End { kind: "", node: normalize(Node::Expr(found.way.expr)) }),
                Some(next) => variable = next,
            }
        };
        for step in path.into_iter().rev() {
            end = end.map(|it| End { kind: step.kind.unwrap_or(it.kind), ..it });
            self.ends.insert(step.variable, end);
        }
        end
    }
}

fn is_constructed<'a>(known: &mut FlagsOfVariables<'a>, variable: Symbol<'a>, is_oxlint: bool) -> bool {
    known.of_variable(variable, |it| declared_with(it, is_oxlint)) != 0
}

impl<'a> Way<'a> {
    /// upstream's `isConstruction`, oxlint's `is_constructed_expression` and `is_construction_expression`, up to the
    /// first expression that is made anew each time, or that is a variable of which `is_constructed` says so.
    fn find_construction(
        self,
        place: Place,
        scope: Scope<'a>,
        is_oxlint: bool,
        is_constructed: &mut dyn FnMut(Symbol<'a>) -> bool,
    ) -> Option<Found<'a>> {
        let is_value_for_oxlint = is_oxlint && place == Place::Value;
        let mut pending: SmallVec<[Way<'a>; 8]> = smallvec![self];
        while let Some(way) = pending.pop() {
            // oxlint looks through all that TypeScript puts around an expression, upstream through `as`.
            let expr = if is_oxlint { get_inner_expression(way.expr) } else { way.expr };
            let kind = match expr.kind() {
                ExprKind::Object(_) => "object",
                ExprKind::Array(_) => "array",
                ExprKind::Fn(_) => "function expression",
                ExprKind::Class(_) => "class expression",
                ExprKind::New(_) => "new expression",
                ExprKind::Jsx(jsx) if jsx.is_fragment() => "JSX fragment",
                ExprKind::Jsx(_) => "JSX element",
                ExprKind::Regex(_) if !is_value_for_oxlint => "regular expression",
                ExprKind::Unary { op: UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec, .. }
                | ExprKind::Assign { .. }
                | ExprKind::TaggedTemplate(_)
                | ExprKind::Await(_)
                | ExprKind::Yield { .. }
                | ExprKind::ImportCall { .. }
                    if is_value_for_oxlint =>
                {
                    ""
                }
                ExprKind::Call(call) if is_value_for_oxlint => {
                    let callee = call.callee();
                    if !callee.is_parenthesized()
                        && callee.as_ident().is_some_and(|name| name.is_any(&["useMemo", "useCallback"]))
                    {
                        continue;
                    }
                    ""
                }
                ExprKind::Template(template) if is_value_for_oxlint && !template.exprs().is_empty() => "",
                ExprKind::Unary { operand, .. } if is_value_for_oxlint => {
                    pending.push(Way { expr: operand, ..way });
                    continue;
                }
                ExprKind::Binary { op, left, right }
                    if matches!(op, BinOp::And | BinOp::Or | BinOp::Nullish)
                        || (is_value_for_oxlint && left.tag() != ExprTag::PrivateIdentifier) =>
                {
                    pending.extend([Way { expr: right, ..way }, Way { expr: left, ..way }]);
                    continue;
                }
                ExprKind::Cond { yes, no, .. } => {
                    pending.extend([Way { expr: no, ..way }, Way { expr: yes, ..way }]);
                    continue;
                }
                ExprKind::Assign { value, .. } => {
                    let usage = way.usage.or(Some(expr));
                    pending.push(Way { expr: value, usage, kind: Some("assignment expression") });
                    continue;
                }
                ExprKind::As { expr: inner, .. } | ExprKind::AsConst(inner) if !expr.is_angle_bracket_assertion() => {
                    pending.push(Way { expr: inner, ..way });
                    continue;
                }
                ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } if !is_oxlint && !expr.is_chain_root() => {
                    pending.push(Way { expr: obj, usage: way.usage.or(Some(obj)), ..way });
                    continue;
                }
                ExprKind::Ident(name) => {
                    // upstream knows the variables of the scope that the element is in, and no other.
                    let variable = if is_oxlint { expr.symbol() } else { scope.get_name(name) };
                    if variable.is_some_and(&mut *is_constructed) {
                        return Some(Found { way: Way { expr, usage: way.usage.or(Some(expr)), ..way }, variable });
                    }
                    continue;
                }
                _ => continue,
            };
            return Some(Found { way: Way { expr, kind: way.kind.or(Some(kind)), ..way }, variable: None });
        }
        None
    }
}

fn definition_of(variable: Symbol<'_>, is_oxlint: bool) -> Option<Definition<'_>> {
    // For oxlint what is declared at the top level is made once.
    if is_oxlint && matches!(variable.scope().node(), Node::File(_)) {
        return None;
    }
    // oxlint goes by the first declaration, upstream by the last.
    let mut declarations = variable.declarations();
    let declaration = if is_oxlint { declarations.next() } else { declarations.next_back() }?;
    match declaration {
        // For upstream a `TSDeclareFunction` is no function and a class is unusual.
        Declaration::Fn(function) if is_oxlint || function.has_body() => Some(Definition::Made(Node::Func(function))),
        Declaration::Class(class) if is_oxlint => Some(Definition::Made(Node::Class(class))),
        Declaration::Var(_) => match declaration.node() {
            Some(Node::VarDecl(declarator)) => declarator.init().map(Definition::Init),
            _ => None,
        },
        _ => None,
    }
}

/// 1 if the declaration of a variable makes something new, and the variables that it can be as well.
fn declared_with(variable: Symbol<'_>, is_oxlint: bool) -> (u8, Variables<'_>) {
    let mut variables = Variables::new();
    let is_made = match definition_of(variable, is_oxlint) {
        None => false,
        Some(Definition::Made(_)) => true,
        Some(Definition::Init(init)) => {
            let way = Way { expr: init, usage: None, kind: None };
            let mut add = |it| {
                variables.push(it);
                false
            };
            way.find_construction(Place::Init, variable.scope(), is_oxlint, &mut add).is_some()
        }
    };
    (u8::from(is_made), variables)
}
