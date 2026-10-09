use bun_lint_oxlint::ast_util::{callee_name, get_inner_expression, is_react_component_name, iter_outer_expressions};
use crate::react::{Returns, component_wrapper_functions, function_returns, is_hoc_call};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

#[derive(Copy, Clone, PartialEq, Eq)]
enum FunctionStyle {
    Declaration,
    Expression,
    Arrow,
}

/// Enforce a specific function type for function components.
pub struct FunctionComponentDefinition {
    /// The first is preferred.
    named_components: Vec<FunctionStyle>,
    unnamed_components: Vec<FunctionStyle>,
}

const NOT_A_DECLARATION: Message = Message::new("", "Function component is not a function declaration");
const NOT_AN_EXPRESSION: Message = Message::new("", "Function component is not a function expression");
const NOT_AN_ARROW: Message = Message::new("", "Function component is not an arrow function");

pub struct State<'a> {
    component_wrapper_functions: &'a [Json],
    returns: Returns<'a>,
}

impl Rule for FunctionComponentDefinition {
    const META: Meta = Meta::oxlint(Plugin::React, "function-component-definition", Kind::Suggestion).has_suggestions();
    type State<'a> = State<'a>;

    /// `{ namedComponents, unnamedComponents }`, each a style or a list of styles.
    fn new(options: &Options) -> Self {
        let options = options.object(0);
        let style = |value: &Json| match value.as_str()? {
            b"function-declaration" => Some(FunctionStyle::Declaration),
            b"function-expression" => Some(FunctionStyle::Expression),
            b"arrow-function" => Some(FunctionStyle::Arrow),
            _ => None,
        };
        // A component without a name cannot be a declaration.
        let styles = |key: &str, default: FunctionStyle| {
            let style = |value: &Json| style(value).filter(|it| *it != FunctionStyle::Declaration || default == *it);
            match options.get(key) {
                Some(Json::Array(all)) => all.iter().filter_map(style).collect(),
                value => vec![value.and_then(style).unwrap_or(default)],
            }
        };
        FunctionComponentDefinition {
            named_components: styles("namedComponents", FunctionStyle::Declaration),
            unnamed_components: styles("unnamedComponents", FunctionStyle::Expression),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> Self::State<'a> {
        on.funcs(check);
        State { component_wrapper_functions: component_wrapper_functions(file), returns: Returns::default() }
    }
}

fn check<'a>(rule: &FunctionComponentDefinition, func: Func<'a>, cx: &mut Cx<'a, FunctionComponentDefinition>) {
    let actual = match func.kind() {
        _ if !func.has_body() => return,
        FnKind::Decl => FunctionStyle::Declaration,
        FnKind::Expr => FunctionStyle::Expression,
        FnKind::Arrow => FunctionStyle::Arrow,
        _ => return,
    };
    let parent = component_parent_kind(func);
    let declaration = match parent {
        Some(Node::VarDecl(declaration)) => Some(declaration),
        _ => None,
    };
    let named = actual == FunctionStyle::Declaration || declaration.is_some();
    let (allowed, default) = match named {
        true => (&rule.named_components, FunctionStyle::Declaration),
        false => (&rule.unnamed_components, FunctionStyle::Expression),
    };
    if allowed.contains(&actual) {
        return;
    }
    let is_in_position = match actual {
        FunctionStyle::Declaration => func.name().is_none_or(|id| is_react_component_name(id.bytes())),
        _ => parent
            .is_some_and(|parent| is_component_expression_position(func, parent, cx.state.component_wrapper_functions)),
    };
    if !is_in_position || !function_returns(func, &mut cx.state.returns).has_jsx_or_null() {
        return;
    }
    let expected = allowed.first().copied().unwrap_or(default);
    let message = match expected {
        FunctionStyle::Declaration => NOT_A_DECLARATION,
        FunctionStyle::Expression => NOT_AN_EXPRESSION,
        FunctionStyle::Arrow => NOT_AN_ARROW,
    };
    let report = cx.report(func.estree_span(), message);
    if can_fix(func, declaration, expected) {
        report.suggest(message, |fixer| replacement(fixer, func, declaration, expected, named));
    }
}

/// What the function is in, over `as T` and the like, and over `(a, b, f)` of which it is the last. `None` if it is not
/// the last.
fn component_parent_kind(func: Func<'_>) -> Option<Node<'_>> {
    let Node::Expr(mut inner) = func.owner() else {
        return Some(func.owner().parent());
    };
    loop {
        let parent = iter_outer_expressions(inner).next()?;
        let Some(sequence) = parent.as_expr().filter(|it| it.binary_op() == Some(BinOp::Comma)) else {
            return Some(parent);
        };
        // `a, b, c` is `(a, b), c` without the parentheses.
        let goes_on = !sequence.is_parenthesized()
            && matches!(sequence.parent(), Node::Expr(outer)
                if outer.binary_op() == Some(BinOp::Comma) && outer.left() == Some(sequence));
        if goes_on || sequence.right().map(get_inner_expression) != Some(inner) {
            return None;
        }
        inner = sequence;
    }
}

fn is_component_expression_position<'a>(
    func: Func<'a>,
    parent: Node<'a>,
    component_wrapper_functions: &[Json],
) -> bool {
    let is_component_name = |name: Name| is_react_component_name(name.bytes());
    match parent {
        Node::VarDecl(declaration) => declaration.pat().as_ident().is_some_and(is_component_name),
        Node::Stmt(statement) => matches!(statement.tag(), StmtTag::ExportDefault | StmtTag::Return),
        Node::Func(outer) => outer.is_arrow(),
        Node::Expr(e) => match e.kind() {
            ExprKind::Assign { target, .. } => match target.kind() {
                ExprKind::Ident(name) => is_component_name(name),
                ExprKind::Dot { obj, name, .. } if !target.is_private_member() => {
                    is_component_name(name.name())
                        || get_inner_expression(obj).is_ident("module") && name.name().is("exports")
                }
                _ => false,
            },
            ExprKind::Call(call) => {
                call.args().first().map(|it| Node::Expr(get_inner_expression(it))) == Some(func.owner())
                    && callee_name(call).is_some_and(|name| is_hoc_call(name.bytes(), component_wrapper_functions))
            }
            _ => false,
        },
        _ => false,
    }
}

fn can_fix(func: Func, declaration: Option<VarDecl>, expected: FunctionStyle) -> bool {
    // `has_unsafe_outer_expression`
    if let Node::Expr(e) = func.owner()
        && let Node::Expr(outer) = e.parent()
        && (get_inner_expression(outer) != outer || outer.binary_op() == Some(BinOp::Comma))
    {
        return false;
    }
    let is_alone = |it: VarDecl| {
        matches!(it.parent(), Node::Stmt(statement)
            if matches!(statement.kind(), StmtKind::Var(all) if all.len() == 1))
    };
    let type_params = func.type_params();
    declaration.is_none_or(is_alone)
        && !matches!(func.owner(), Node::Stmt(statement) if statement.is_default_export())
        && !(func.kind() == FnKind::Expr && func.name().is_some())
        && !(expected == FunctionStyle::Declaration && declaration.is_some_and(|it| it.ty().is_some()))
        && !(expected == FunctionStyle::Arrow
            && (func.this_param().is_some()
                || func.is_generator()
                || type_params.len() == 1 && type_params.first().is_some_and(|it| it.constraint().is_none())))
}

fn replacement<'a>(
    fixer: Fixer<'a>,
    func: Func<'a>,
    declaration: Option<VarDecl<'a>>,
    expected: FunctionStyle,
    named: bool,
) -> Option<Fix> {
    let file = fixer.file();
    let source = |span: Option<Span>| span.map_or(&b""[..], |it| file.slice(it));
    let (replace_span, variable_kind) = match declaration {
        Some(declaration) => {
            let kind = match declaration.var_kind() {
                VarKind::Var => "var",
                VarKind::Let => "let",
                VarKind::Const => "const",
                VarKind::Using => "using",
                VarKind::AwaitUsing => "await using",
            };
            (declaration.parent().as_stmt()?.span_without_export(), kind)
        }
        None => (func.estree_span(), "const"),
    };
    let name =
        func.name().map(Ident::name).or_else(|| declaration?.pat().as_ident()).map(Name::bytes).unwrap_or_default();
    let type_annotation = source(declaration.and_then(VarDecl::ty).map(TypeNode::annotation_span));
    let async_prefix = if func.is_async() { "async " } else { "" };
    let generator_marker = if func.is_generator() { "*" } else { "" };
    let type_parameters = source(func.type_params().angle_brackets_span());
    let params = source(func.params_span());
    let (open, close) = if params.starts_with(b"(") { ("", "") } else { ("(", ")") };
    let return_type = source(func.return_type().map(TypeNode::annotation_span));
    let (before_body, body, after_body) = match func.body() {
        FnBody::Expr(body) => ("{\n return ", file.slice(body.outer_span()), "\n}"),
        _ => ("", source(func.body_span()), ""),
    };
    let mut text: Vec<&[u8]> = Vec::with_capacity(24);
    let keyword = [async_prefix.as_bytes(), b"function", generator_marker.as_bytes()];
    if named && expected != FunctionStyle::Declaration {
        text.extend([variable_kind.as_bytes(), b" ", name, type_annotation, b" = "]);
    }
    match expected {
        FunctionStyle::Declaration => {
            text.extend(keyword);
            text.extend([&b" "[..], name]);
        }
        FunctionStyle::Expression => text.extend(keyword),
        FunctionStyle::Arrow => text.push(async_prefix.as_bytes()),
    }
    text.extend([type_parameters, open.as_bytes(), params, close.as_bytes(), return_type]);
    text.push(if expected == FunctionStyle::Arrow { &b" => "[..] } else { &b" "[..] });
    text.extend([before_body.as_bytes(), body, after_body.as_bytes()]);
    Some(fixer.replace(replace_span, text.concat()))
}
