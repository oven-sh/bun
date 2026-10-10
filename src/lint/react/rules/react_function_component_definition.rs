use crate::react::{Returns, component_wrapper_functions, function_returns, is_hoc_call};
use crate::util_components::Components;
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::{estree_parent, estree_span};
use bun_lint_oxlint::ast_util::{callee_name, get_inner_expression, is_react_component_name, iter_outer_expressions};
use std::cell::OnceCell;

#[derive(Copy, Clone, PartialEq, Eq)]
enum FunctionStyle {
    Declaration,
    Expression,
    Arrow,
}

/// Enforce a specific function type for function components
pub struct FunctionComponentDefinition {
    /// The first is preferred.
    named_components: Vec<FunctionStyle>,
    unnamed_components: Vec<FunctionStyle>,
}

const FUNCTION_DECLARATION: Message =
    Message::new("function-declaration", "Function component is not a function declaration");
const FUNCTION_EXPRESSION: Message =
    Message::new("function-expression", "Function component is not a function expression");
const ARROW_FUNCTION: Message = Message::new("arrow-function", "Function component is not an arrow function");
const NOT_A_DECLARATION: Message = Message::new("", "Function component is not a function declaration");
const NOT_AN_EXPRESSION: Message = Message::new("", "Function component is not a function expression");
const NOT_AN_ARROW: Message = Message::new("", "Function component is not an arrow function");

pub struct State<'a> {
    /// These two are for oxlint, which goes by where a function is and what it returns.
    component_wrapper_functions: &'a [Json],
    returns: Returns<'a>,
    components: Components<'a>,
    /// upstream's `hasES6OrJsx`
    has_es6_or_jsx: OnceCell<bool>,
}

impl Rule for FunctionComponentDefinition {
    const META: Meta = Meta::plugin(Plugin::React, "function-component-definition", Kind::None)
        .fixable(Fixable::Code)
        .has_suggestions();
    const ON: On = On::new().funcs();
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

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        (file.language().is_oxlint || Components::may_have_any(file)).then(|| State {
            component_wrapper_functions: component_wrapper_functions(file),
            returns: Returns::default(),
            components: Components::new(file),
            has_es6_or_jsx: OnceCell::new(),
        })
    }

    fn func<'a>(&self, func: Func<'a>, cx: &mut Cx<'a, Self>) {
        check(self, func, cx);
    }
}

/// upstream's `validate`
fn check<'a>(rule: &FunctionComponentDefinition, func: Func<'a>, cx: &mut Cx<'a, FunctionComponentDefinition>) {
    let is_oxlint = cx.language().is_oxlint;
    let actual = match func.kind() {
        _ if !func.has_body() => return,
        FnKind::Decl => FunctionStyle::Declaration,
        FnKind::Expr => FunctionStyle::Expression,
        FnKind::Arrow => FunctionStyle::Arrow,
        // oxlint passes over the function of a method.
        FnKind::Method | FnKind::Getter | FnKind::Setter | FnKind::Constructor if !is_oxlint => {
            FunctionStyle::Expression
        }
        _ => return,
    };
    // oxlint looks through `as T` and the like.
    let parent = if is_oxlint { component_parent_kind(func) } else { Some(estree_parent(Node::Func(func))) };
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
    let is_in_position = match (actual, parent) {
        // All is asked when the program ends.
        (_, Some(parent)) if !is_oxlint => {
            cx.state.components.finish();
            cx.state.components.get(Node::Func(func)).is_some() && !is_property_of(func, parent)
        }
        (FunctionStyle::Declaration, _) => func.name().is_none_or(|id| is_react_component_name(id.bytes())),
        (_, Some(parent)) => is_component_expression_position(func, parent, cx.state.component_wrapper_functions),
        (_, None) => false,
    };
    if !is_in_position || (is_oxlint && !function_returns(func, &mut cx.state.returns).has_jsx_or_null()) {
        return;
    }
    let expected = allowed.first().copied().unwrap_or(default);
    let message = match (expected, is_oxlint) {
        (FunctionStyle::Declaration, false) => FUNCTION_DECLARATION,
        (FunctionStyle::Expression, false) => FUNCTION_EXPRESSION,
        (FunctionStyle::Arrow, false) => ARROW_FUNCTION,
        (FunctionStyle::Declaration, true) => NOT_A_DECLARATION,
        (FunctionStyle::Expression, true) => NOT_AN_EXPRESSION,
        (FunctionStyle::Arrow, true) => NOT_AN_ARROW,
    };
    let report = cx.report(func.estree_span(), message);
    let fix = |fixer| match can_fix(func, declaration, expected, is_oxlint) {
        true => replacement(fixer, func, declaration, expected, named, &cx.state.has_es6_or_jsx),
        false => None,
    };
    // oxlint suggests it.
    match is_oxlint {
        true => report.suggest(message, fix),
        false => report.at_the_end().fix(fix),
    };
}

/// `node.parent.type === "Property"`
fn is_property_of<'a>(func: Func<'a>, parent: Node<'a>) -> bool {
    match parent {
        Node::Prop(it) => it.kind() != PropKind::Spread && !it.is_jsx_attribute(),
        // The default is in an `AssignmentPattern`.
        Node::PatProp(it) => it.default().and_then(Expr::as_fn) != Some(func),
        _ => false,
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

/// Where upstream's `getFixer` returns a function. oxlint is more careful.
fn can_fix(func: Func, declaration: Option<VarDecl>, expected: FunctionStyle, is_oxlint: bool) -> bool {
    // `has_unsafe_outer_expression`
    if is_oxlint
        && let Node::Expr(e) = func.owner()
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
    (!is_oxlint || declaration.is_none_or(is_alone))
        && !matches!(func.owner(), Node::Stmt(statement) if statement.is_default_export())
        && !(func.kind() == FnKind::Expr && func.name().is_some())
        && !(expected == FunctionStyle::Declaration && declaration.is_some_and(|it| it.ty().is_some()))
        && !(expected == FunctionStyle::Arrow
            && (is_oxlint && (func.this_param().is_some() || func.is_generator())
                || type_params.len() == 1 && type_params.first().is_some_and(|it| it.constraint().is_none())))
}

fn replacement<'a>(
    fixer: Fixer<'a>,
    func: Func<'a>,
    declaration: Option<VarDecl<'a>>,
    expected: FunctionStyle,
    named: bool,
    has_es6_or_jsx: &OnceCell<bool>,
) -> Option<Fix> {
    let file = fixer.file();
    let is_oxlint = file.language().is_oxlint;
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
        // upstream's `fileVarType`. For oxlint it is always `const`.
        None if is_oxlint || *has_es6_or_jsx.get_or_init(|| file_has_es6_or_jsx(file)) => (func.estree_span(), "const"),
        None => (func.estree_span(), "var"),
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
        // oxlint keeps the parentheses.
        FnBody::Expr(body) if is_oxlint => ("{\n return ", file.slice(body.outer_span()), "\n}"),
        FnBody::Expr(body) => ("{\n  return ", body.text(), "\n}"),
        _ => ("", source(func.body_span()), ""),
    };
    if !is_oxlint {
        let template = match (expected, named) {
            (FunctionStyle::Declaration, _) => "function {name}{typeParams}({params}){returnType} {body}",
            (FunctionStyle::Arrow, true) => {
                "{varType} {name}{typeAnnotation} = {typeParams}({params}){returnType} => {body}"
            }
            (FunctionStyle::Expression, true) => {
                "{varType} {name}{typeAnnotation} = function{typeParams}({params}){returnType} {body}"
            }
            (FunctionStyle::Expression, false) => "function{typeParams}({params}){returnType} {body}",
            (FunctionStyle::Arrow, false) => "{typeParams}({params}){returnType} => {body}",
        };
        let mut all_params = func.params_with_this().map(|it| estree_span(Node::Param(it)));
        let first = all_params.next();
        let params = first.map(|first| Span::new(first.start, all_params.last().unwrap_or(first).end));
        let body = [before_body.as_bytes(), body, after_body.as_bytes()].concat();
        let parts = [
            ("{typeAnnotation}", type_annotation),
            ("{typeParams}", type_parameters),
            ("{params}", source(params)),
            ("{returnType}", return_type),
            ("{body}", &body[..]),
            ("{name}", name),
            ("{varType}", variable_kind.as_bytes()),
        ];
        return Some(fixer.replace(replace_span, build_function(template, &parts)));
    }
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

/// upstream's `buildFunction`: each placeholder where it is found first, which can be in what was put in before.
fn build_function(template: &str, parts: &[(&str, &[u8])]) -> Vec<u8> {
    let mut acc = template.as_bytes().to_vec();
    for (key, part) in parts {
        if let Some(at) = strings::index_of(&acc, key.as_bytes()) {
            acc.splice(at..at + key.len(), part.iter().copied());
        }
    }
    acc
}

/// upstream's `hasES6OrJsx` when the program ends.
fn file_has_es6_or_jsx<'a>(file: &'a File<'a>) -> bool {
    const DECLARATIONS: [StmtTag; 7] = [
        StmtTag::Var,
        StmtTag::Fn,
        StmtTag::Class,
        StmtTag::Interface,
        StmtTag::TypeAlias,
        StmtTag::Enum,
        StmtTag::Module,
    ];
    let is_let_or_const = |it: Stmt<'a>| {
        matches!(it.kind(), StmtKind::Var(all)
            if all.first().is_some_and(|it| matches!(it.var_kind(), VarKind::Let | VarKind::Const)))
    };
    file.has_stmts([
        StmtTag::Import,
        StmtTag::ImportEquals,
        StmtTag::ExportNamed,
        StmtTag::ExportStar,
        StmtTag::ExportDefault,
        StmtTag::ExportAssign,
    ]) || file.exprs_of_kind(ExprTag::Jsx).any(|it| matches!(it.kind(), ExprKind::Jsx(jsx) if !jsx.is_fragment()))
        || file.stmts_of_kind(StmtTag::Var).any(is_let_or_const)
        || DECLARATIONS.into_iter().any(|tag| file.stmts_of_kind(tag).any(Stmt::is_exported))
}
