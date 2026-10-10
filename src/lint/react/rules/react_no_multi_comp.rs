use bun_lint_oxlint::ast_util::{as_function_expression, as_object_property, callee_name, is_react_component_name};
use crate::react::{
    FunctionsWithJsx, component_wrapper_functions, is_es5_component, is_es6_component, is_hoc_call, is_jsx,
};
use bun_lint::prelude::*;
use bun_lint::rule::{NodeTags, Plugin};

/// Prevents multiple React components from being defined in the same file.
pub struct NoMultiComp {
    ignore_stateless: bool,
}

const NO_MULTI_COMP: Message = Message::new("", "Declare only one React component per file. Found: {{component_name}}");

struct DetectedComponent<'a> {
    /// `None`: `UnnamedComponent`
    name: Option<Name<'a>>,
    span: Span,
    is_stateless: bool,
}

/// What is to be done when a node is left.
enum Entered<'a> {
    Other,
    Component,
    /// A declarator that is a component.
    ComponentDeclarator,
    /// Another declarator, with the `current_var_name` around it.
    Declarator(Option<Name<'a>>),
}

pub struct State<'a> {
    components: Vec<DetectedComponent<'a>>,
    /// How many components are around. What is in a component is not one.
    component_depth: u32,
    /// The name for a `createReactClass(..)`.
    current_var_name: Option<Name<'a>>,
    entered: Vec<Entered<'a>>,
    functions_with_jsx: Option<FunctionsWithJsx<'a>>,
    component_wrapper_functions: &'a [Json],
}

const TAGS: NodeTags = NodeTags::CLASS
    .union(NodeTags::FUNC)
    .union(NodeTags::VAR_DECL)
    .union(NodeTags::PROP)
    .union(NodeTags::new().exprs(&[ExprTag::Call, ExprTag::Assign]))
    .union(NodeTags::new().stmts(&[StmtTag::ExportDefault]));

impl Rule for NoMultiComp {
    const META: Meta = Meta::oxlint(Plugin::React, "no-multi-comp", Kind::Suggestion);
    const ON: On = On::new().enter(TAGS).exit(TAGS).finish();
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        NoMultiComp { ignore_stateless: options.object(0).bool_or("ignoreStateless", false) }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        let mut state = State {
            components: Vec::new(),
            component_depth: 0,
            current_var_name: None,
            entered: Vec::new(),
            functions_with_jsx: None,
            component_wrapper_functions: &[],
        };
        if !is_jsx(file) {
            return None;
        }
        state.functions_with_jsx = Some(FunctionsWithJsx::new(file));
        state.component_wrapper_functions = component_wrapper_functions(file);
        Some(state)
    }

    fn enter<'a>(&self, node: Node<'a>, cx: &mut Cx<'a, Self>) {
        let state = &mut cx.state;
        let entered = match (state.detect(node), node) {
            (Some(component), _) => {
                if state.component_depth == 0 {
                    state.components.push(component);
                }
                state.component_depth += 1;
                match node {
                    Node::VarDecl(decl) => {
                        state.current_var_name = decl.pat().as_ident();
                        Entered::ComponentDeclarator
                    }
                    _ => Entered::Component,
                }
            }
            (None, Node::VarDecl(decl)) if is_variable_declarator(decl) => {
                Entered::Declarator(std::mem::replace(&mut state.current_var_name, decl.pat().as_ident()))
            }
            _ => Entered::Other,
        };
        state.entered.push(entered);
    }

    fn exit<'a>(&self, _: Node<'a>, cx: &mut Cx<'a, Self>) {
        match cx.state.entered.pop() {
            Some(Entered::Component) => cx.state.component_depth -= 1,
            Some(Entered::ComponentDeclarator) => {
                cx.state.component_depth -= 1;
                cx.state.current_var_name = None;
            }
            Some(Entered::Declarator(old_name)) => cx.state.current_var_name = old_name,
            Some(Entered::Other) | None => {}
        }
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        for component in cx.state.components.iter().filter(|it| !self.ignore_stateless || !it.is_stateless).skip(1) {
            let component_name = component.name.map_or(&b"UnnamedComponent"[..], Name::bytes);
            cx.report(component.span, NO_MULTI_COMP).data("component_name", component_name);
        }
    }
}

/// Not the parameter of a `catch`.
fn is_variable_declarator(decl: VarDecl) -> bool {
    matches!(decl.parent(), Node::Stmt(statement) if statement.tag() == StmtTag::Var)
}

fn is_component_name(name: &Name) -> bool {
    is_react_component_name(name.bytes())
}

impl<'a> State<'a> {
    fn function_contains_jsx(&self, func: Func<'a>) -> bool {
        self.functions_with_jsx.as_ref().is_some_and(|it| it.function_contains_jsx(func))
    }

    /// Of a function or an arrow function that is not in parentheses.
    fn expression_contains_jsx(&self, expr: Expr<'a>) -> bool {
        as_function_expression(expr).is_some_and(|it| self.function_contains_jsx(it))
    }

    /// The component that `node` is, wherever it is.
    fn detect(&self, node: Node<'a>) -> Option<DetectedComponent<'a>> {
        let stateless = |name: Option<Name<'a>>, span: Span| Some(DetectedComponent { name, span, is_stateless: true });
        match node {
            Node::Class(class) if is_es6_component(node) => Some(DetectedComponent {
                name: class.name().map(Ident::name),
                span: class.estree_span(),
                is_stateless: false,
            }),
            // `function Foo() { return <div/> }`
            Node::Func(func) if !func.is_arrow() => {
                let name = func.name().map(Ident::name).filter(is_component_name)?;
                self.function_contains_jsx(func).then(|| stateless(Some(name), func.estree_span()))?
            }
            Node::VarDecl(decl) if is_variable_declarator(decl) => {
                let name = decl.pat().as_ident().filter(is_component_name)?;
                let init = decl.init()?;
                let is_component_function =
                    |it: Expr<'a>| self.expression_contains_jsx(it) || is_function_returning_null(it);
                let is_component = match init.kind() {
                    // The parentheses around the whole do not count.
                    ExprKind::Fn(func) => self.function_contains_jsx(func) || is_returning_null(func),
                    // `(0, () => <div/>)`
                    ExprKind::Binary { op: BinOp::Comma, right, .. } => is_component_function(right),
                    // `memo(() => <div/>)`
                    ExprKind::Call(call) => !init.is_chain_root() && self.is_hoc_component(call),
                    _ => false,
                };
                is_component.then(|| stateless(Some(name), decl.span()))?
            }
            Node::Expr(e) => match e.kind() {
                // `createReactClass({..})`
                ExprKind::Call(_) if self.component_depth == 0 && is_es5_component(node) => {
                    Some(DetectedComponent { name: self.current_var_name, span: e.span(), is_stateless: false })
                }
                // `exports.Foo = function () { return <div/> }`
                ExprKind::Assign { target, value, .. } if !e.is_assignment_target() => {
                    let ExprKind::Dot { name, .. } = target.kind() else {
                        return None;
                    };
                    let name = Some(name.name()).filter(|it| !target.is_private_member() && is_component_name(it))?;
                    let returns_component = || {
                        as_function_expression(value)
                            .filter(|it| !it.is_arrow())
                            .is_some_and(|func| returned_at_top_level(func).any(|it| self.expression_contains_jsx(it)))
                    };
                    (self.expression_contains_jsx(value) || returns_component())
                        .then(|| stateless(Some(name), e.span()))?
                }
                _ => None,
            },
            // `export default React.forwardRef(..)`
            Node::Stmt(statement) => match statement.kind() {
                StmtKind::ExportDefault(e) if !e.is_parenthesized() && !e.is_chain_root() => e
                    .as_call()
                    .is_some_and(|call| self.is_hoc_component(call))
                    .then(|| stateless(None, statement.span()))?,
                _ => None,
            },
            // `{ RenderFoo() { return <div/> } }`
            Node::Prop(prop) => {
                let KeyKind::Ident(name) = as_object_property(node)?.key()?.kind() else {
                    return None;
                };
                let func = prop
                    .value()
                    .and_then(as_function_expression)
                    .filter(|it| !it.is_arrow() && is_component_name(&name))?;
                self.function_contains_jsx(func).then(|| stateless(Some(name), prop.span()))?
            }
            _ => None,
        }
    }

    /// `memo(..)`, `forwardRef(..)` and the like around a function with JSX in it.
    fn is_hoc_component(&self, call: Call<'a>) -> bool {
        callee_name(call).is_some_and(|name| is_hoc_call(name.bytes(), self.component_wrapper_functions))
            && call
                .args()
                .first()
                .and_then(as_function_expression)
                .is_some_and(|func| !is_passthrough(func) && self.function_contains_jsx(func))
    }
}

/// What the `return` statements that are directly in the body of `func` return.
fn returned_at_top_level(func: Func<'_>) -> impl Iterator<Item = Expr<'_>> {
    let statements = match func.body() {
        FnBody::Block(statements) => Some(statements),
        _ => None,
    };
    statements.into_iter().flatten().filter_map(|it| match it.kind() {
        StmtKind::Return(argument) => argument,
        _ => None,
    })
}

/// The function does nothing but render another component with its props: `(props, ref) => <A {...props} ref={ref} />`
fn is_passthrough(func: Func) -> bool {
    match func.body() {
        FnBody::Expr(body) => is_simple_jsx_passthrough(body),
        FnBody::Block(statements) => {
            let mut statements = statements.iter().filter(|it| it.directive().is_none());
            let (first, second) = (statements.next().map(Stmt::kind), statements.next());
            matches!((first, second), (Some(StmtKind::Return(Some(argument))), None)
                if is_simple_jsx_passthrough(argument))
        }
        FnBody::None => false,
    }
}

fn is_simple_jsx_passthrough(expr: Expr) -> bool {
    let ExprKind::Jsx(jsx) = expr.kind() else {
        return false;
    };
    let attrs = jsx.attrs();
    !expr.is_parenthesized()
        && jsx.tag().and_then(Expr::as_ident).is_some_and(|name| is_component_name(&name))
        && attrs.len() <= 2
        && attrs.iter().any(|it| it.kind() == PropKind::Spread)
}

/// `() => null`, `function () { return null; }`
fn is_function_returning_null(expr: Expr) -> bool {
    as_function_expression(expr).is_some_and(is_returning_null)
}

fn is_returning_null(func: Func) -> bool {
    let is_null = |it: Expr| it.tag() == ExprTag::Null && !it.is_parenthesized();
    match func.body() {
        FnBody::Expr(body) => is_null(body),
        _ => returned_at_top_level(func).any(is_null),
    }
}
