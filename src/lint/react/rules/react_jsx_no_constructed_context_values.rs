use bun_lint_oxlint::ast_util::{as_function, as_method_definition, get_inner_expression};
use crate::jsx::get_prop_value;
use crate::react::{VariableFlags, Variables, is_jsx};
use crate::util_components::Components;
use crate::util_components_list::At;
use crate::util_is_create_element::is_member_called;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::types::IdMap;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use bun_lint::utils::{estree_span, normalize};
use smallvec::{SmallVec, smallvec};

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
    /// 1 for a variable that gets a new value every time the function that declares it runs.
    constructed_variables: VariableFlags<'a>,
    /// For upstream: the construction that such a variable ultimately refers to.
    ends: IdMap<Symbol<'a>, Option<End<'a>>>,
    /// The constructions that upstream reports if the element is in a component.
    constructions: Vec<Construction<'a>>,
}

/// The result of upstream's `isConstruction`.
struct Construction<'a> {
    element: Expr<'a>,
    kind: &'static str,
    node: Node<'a>,
    usage: Option<Expr<'a>>,
}

/// That result's `type` and `node`.
#[derive(Copy, Clone)]
struct End<'a> {
    kind: &'static str,
    node: Node<'a>,
}

/// A variable on the path to its construction, with the `type` if its own initializer determines it.
struct Step<'a> {
    variable: Symbol<'a>,
    kind: Option<&'static str>,
}

/// An expression on the path from the attribute's value to the construction.
#[derive(Copy, Clone)]
struct Trace<'a> {
    expr: Expr<'a>,
    /// The outermost variable, member expression object or assignment on the path.
    usage: Option<Expr<'a>>,
    /// `type`, if the path so far determines it.
    kind: Option<&'static str>,
}

/// The end of a path.
struct Found<'a> {
    trace: Trace<'a>,
    /// `trace.expr` is this variable, which is constructed on every run.
    variable: Option<Symbol<'a>>,
}

/// oxlint checks the attribute's value differently from a variable's initializer.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Origin {
    Value,
    Init,
}

/// How a variable is declared.
enum Definition<'a> {
    /// A function or a class.
    FunctionOrClass(Node<'a>),
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
        // For upstream, whether a function is a component depends on what comes before it.
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
        // upstream only checks the first one.
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
        utils::sort::sort_unstable_by_key(&mut constructions, |it| At::enter(Node::Expr(it.element)));
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
        // For oxlint `<a>` is an HTML element's name.
        ExprKind::Ident(ident) if is_oxlint && ident.bytes().first().is_some_and(u8::is_ascii_lowercase) => false,
        ExprKind::Ident(ident) => {
            // upstream looks the name up, even if it's a type's name.
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
    // oxlint's AST keeps parentheses as nodes.
    let is_plain = |it: Expr| !it.is_chain_root() && !(is_oxlint && it.is_parenthesized());
    let Some(callee) = expr.as_call().map(Call::callee).filter(|it| is_plain(expr) && is_plain(*it)) else {
        return false;
    };
    match callee.kind() {
        ExprKind::Ident(name) => name.is("createContext"),
        // upstream also accepts `React[createContext]()` and `React.#createContext()`.
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
    /// upstream's `isConstruction`. For oxlint only `Some` or `None` matters.
    fn is_construction(&mut self, value: Expr<'a>, element: Expr<'a>, is_oxlint: bool) -> Option<Construction<'a>> {
        let mut is_constructed_variable = |it| is_constructed(&mut self.constructed_variables, it, is_oxlint);
        let (trace, scope) = (Trace { expr: value, usage: None, kind: None }, Node::Expr(element).scope());
        let Found { trace, variable } = trace.find_construction(Origin::Value, scope, is_oxlint, &mut is_constructed_variable)?;
        let end = match variable.filter(|_| !is_oxlint) {
            None => End { kind: "", node: normalize(Node::Expr(trace.expr)) },
            Some(variable) => self.end_of(variable)?,
        };
        Some(Construction { element, kind: trace.kind.unwrap_or(end.kind), node: end.node, usage: trace.usage })
    }

    /// Visits each variable once. Returns `None` where upstream would recurse forever.
    fn end_of(&mut self, mut variable: Symbol<'a>) -> Option<End<'a>> {
        let is_oxlint = false;
        let mut is_constructed_variable = |it| is_constructed(&mut self.constructed_variables, it, is_oxlint);
        let mut path: SmallVec<[Step<'a>; 4]> = SmallVec::new();
        let mut end = loop {
            let mut is_new = false;
            let known = *self.ends.get_or_insert_with(variable, || {
                is_new = true;
                None
            });
            if !is_new {
                break known;
            }
            let init = match definition_of(variable, is_oxlint) {
                None => break None,
                Some(Definition::FunctionOrClass(node)) => {
                    path.push(Step { variable, kind: None });
                    break Some(End { kind: "function declaration", node });
                }
                Some(Definition::Init(init)) => Trace { expr: init, usage: None, kind: None },
            };
            let Some(found) = init.find_construction(Origin::Init, variable.scope(), is_oxlint, &mut is_constructed_variable) else {
                break None;
            };
            path.push(Step { variable, kind: found.trace.kind });
            match found.variable {
                None => break Some(End { kind: "", node: normalize(Node::Expr(found.trace.expr)) }),
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

fn is_constructed<'a>(known: &mut VariableFlags<'a>, variable: Symbol<'a>, is_oxlint: bool) -> bool {
    known.of_variable(variable, |it| declared_with(it, is_oxlint)) != 0
}

impl<'a> Trace<'a> {
    /// upstream's `isConstruction`, oxlint's `is_constructed_expression` and `is_construction_expression`. Stops at the
    /// first expression that creates a new value every time, or at a variable for which `is_constructed` returns true.
    fn find_construction(
        self,
        origin: Origin,
        scope: Scope<'a>,
        is_oxlint: bool,
        is_constructed: &mut dyn FnMut(Symbol<'a>) -> bool,
    ) -> Option<Found<'a>> {
        let is_value_for_oxlint = is_oxlint && origin == Origin::Value;
        let mut pending: SmallVec<[Trace<'a>; 8]> = smallvec![self];
        while let Some(trace) = pending.pop() {
            // oxlint looks through every TypeScript wrapper, upstream only through `as`.
            let expr = if is_oxlint { get_inner_expression(trace.expr) } else { trace.expr };
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
                    pending.push(Trace { expr: operand, ..trace });
                    continue;
                }
                ExprKind::Binary { op, left, right }
                    if matches!(op, BinOp::And | BinOp::Or | BinOp::Nullish)
                        || (is_value_for_oxlint && left.tag() != ExprTag::PrivateIdentifier) =>
                {
                    pending.extend([Trace { expr: right, ..trace }, Trace { expr: left, ..trace }]);
                    continue;
                }
                ExprKind::Cond { yes, no, .. } => {
                    pending.extend([Trace { expr: no, ..trace }, Trace { expr: yes, ..trace }]);
                    continue;
                }
                ExprKind::Assign { value, .. } => {
                    let usage = trace.usage.or(Some(expr));
                    pending.push(Trace { expr: value, usage, kind: Some("assignment expression") });
                    continue;
                }
                ExprKind::As { expr: inner, .. } | ExprKind::AsConst(inner) if !expr.is_angle_bracket_assertion() => {
                    pending.push(Trace { expr: inner, ..trace });
                    continue;
                }
                ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } if !is_oxlint && !expr.is_chain_root() => {
                    pending.push(Trace { expr: obj, usage: trace.usage.or(Some(obj)), ..trace });
                    continue;
                }
                ExprKind::Ident(name) => {
                    // upstream only sees the variables of the element's own scope.
                    let variable = if is_oxlint { expr.symbol() } else { scope.get_name(name) };
                    if variable.is_some_and(&mut *is_constructed) {
                        return Some(Found { trace: Trace { expr, usage: trace.usage.or(Some(expr)), ..trace }, variable });
                    }
                    continue;
                }
                _ => continue,
            };
            return Some(Found { trace: Trace { expr, kind: trace.kind.or(Some(kind)), ..trace }, variable: None });
        }
        None
    }
}

fn definition_of(variable: Symbol<'_>, is_oxlint: bool) -> Option<Definition<'_>> {
    // For oxlint a top-level declaration is only evaluated once.
    if is_oxlint && matches!(variable.scope().node(), Node::File(_)) {
        return None;
    }
    // oxlint uses the first declaration, upstream the last.
    let mut declarations = variable.declarations();
    let declaration = if is_oxlint { declarations.next() } else { declarations.next_back() }?;
    match declaration {
        // For upstream a `TSDeclareFunction` isn't a function, and a class isn't handled.
        Declaration::Fn(function) if is_oxlint || function.has_body() => Some(Definition::FunctionOrClass(Node::Func(function))),
        Declaration::Class(class) if is_oxlint => Some(Definition::FunctionOrClass(Node::Class(class))),
        Declaration::Var(_) => match declaration.node() {
            Some(Node::VarDecl(declarator)) => declarator.init().map(Definition::Init),
            _ => None,
        },
        _ => None,
    }
}

/// Returns 1 if the variable's declaration creates a new value, plus the variables it can also evaluate to.
fn declared_with(variable: Symbol<'_>, is_oxlint: bool) -> (u8, Variables<'_>) {
    let mut variables = Variables::new();
    let creates_value = match definition_of(variable, is_oxlint) {
        None => false,
        Some(Definition::FunctionOrClass(_)) => true,
        Some(Definition::Init(init)) => {
            let trace = Trace { expr: init, usage: None, kind: None };
            let mut add = |it| {
                variables.push(it);
                false
            };
            trace.find_construction(Origin::Init, variable.scope(), is_oxlint, &mut add).is_some()
        }
    };
    (u8::from(creates_value), variables)
}
