use bun_lint_oxlint::ast_util::is_method_call;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use rustc_hash::FxHashMap;

/// Disallow useless `undefined`.
pub struct NoUselessUndefined {
    check_arguments: bool,
    check_arrow_function_body: bool,
}

const NO_USELESS_UNDEFINED: Message = Message::new("", "Do not use useless `undefined`.");

pub struct State<'a> {
    undefined: Name<'a>,
    /// Whether the function around something has a return type.
    return_types: AncestorMemo<'a, bool>,
    /// Where the first optional parameter of a function with many parameters starts.
    first_optional_parameters: FxHashMap<Func<'a>, Option<u32>>,
}

impl Rule for NoUselessUndefined {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "no-useless-undefined", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().exprs(&[ExprTag::Ident, ExprTag::Call]);
    type State<'a> = Option<State<'a>>;

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        NoUselessUndefined {
            check_arguments: options.bool_or("checkArguments", true),
            check_arrow_function_body: options.bool_or("checkArrowFunctionBody", true),
        }
    }

    fn narrow<'a>(&self, _: &'a File<'a>) -> On {
        let on = On::new().exprs(&[ExprTag::Ident]);
        if self.check_arguments { on.exprs(&[ExprTag::Call]) } else { on }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        if !file.mentions("undefined") {
            return None;
        }
        Some(Some(State {
            undefined: file.name_of("undefined"),
            return_types: AncestorMemo::default(),
            first_optional_parameters: FxHashMap::default(),
        }))
    }

    fn expr<'a>(&self, expr: Expr<'a>, cx: &mut Cx<'a, Self>) {
        match expr.tag() {
            ExprTag::Ident => self.check_identifier(expr, cx),
            ExprTag::Call => check_call(self, expr, cx),
            _ => {}
        }
    }
}

impl NoUselessUndefined {
    fn check_identifier<'a>(&self, undefined_literal: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(state) = &mut cx.state else {
            return;
        };
        if undefined_literal.as_ident() != Some(state.undefined) {
            return;
        }
        let end = undefined_literal.span().end;
        let is_it = |e: Option<Expr<'a>>| e == Some(undefined_literal);
        // What is replaced, and by what.
        let (replaced, replacement) = match undefined_literal.parent() {
            // `return undefined`
            Node::Stmt(ret_stmt) if ret_stmt.tag() == StmtTag::Return => (Replaced::AfterReturn(ret_stmt), ""),
            // `yield undefined`
            Node::Expr(yield_expr) if matches!(yield_expr.kind(), ExprKind::Yield { star: false, .. }) => {
                (Replaced::Span(yield_expr.span()), "yield")
            }
            // `() => undefined`
            Node::Func(arrow) if self.check_arrow_function_body && matches!(arrow.body(), FnBody::Expr(_)) => {
                (Replaced::Span(undefined_literal.outer_span()), "{}")
            }
            // `let foo = undefined` / `var foo = undefined`
            Node::VarDecl(declarator) if is_it(declarator.init()) && declarator.var_kind() != VarKind::Const => {
                (Replaced::Span(Span::new(declarator.pat().span().end, end)), "")
            }
            // `const {foo = undefined} = {}`
            Node::PatProp(property) if is_it(property.default()) => (Replaced::Span(Span::new(property.value().span().end, end)), ""),
            Node::PatElem(element) if is_it(element.default()) => match element.pat() {
                Some(left) => (Replaced::Span(Span::new(left.span().end, end)), ""),
                None => return,
            },
            // `function foo(bar = undefined) {}`
            Node::Param(parameter) if is_it(parameter.default()) && !undefined_literal.is_parenthesized() => {
                // Without the default it is required, which it cannot be after an optional parameter.
                let Some(func) = parameter.func() else {
                    return;
                };
                let first_optional = || func.params().iter().find(|it| !it.is_rest() && it.is_optional()).map(|it| it.span().start);
                let first_optional = match func.params().len() {
                    0..=8 => first_optional(),
                    _ => *state.first_optional_parameters.entry(func).or_insert_with(first_optional),
                };
                if first_optional.is_some_and(|it| it < parameter.span().start) {
                    return;
                }
                let left = parameter.ty().map_or_else(|| parameter.pat().span().end, |it| it.annotation_span().end);
                (Replaced::Span(Span::new(left, end)), "")
            }
            _ => return,
        };
        let is_yield = replacement == "yield";
        if !is_yield && state.return_types.find(Node::Expr(undefined_literal), has_function_return_type) == Some(true) {
            return;
        }
        cx.report(undefined_literal, NO_USELESS_UNDEFINED).fix(|fixer| {
            let span = match replaced {
                Replaced::Span(span) => span,
                Replaced::AfterReturn(ret_stmt) => {
                    let start = fixer.file().comments_in(ret_stmt).next_back().map_or_else(|| ret_stmt.span().start + 6, |it| it.end());
                    Span::new(start, end)
                }
            };
            (span.start <= span.end).then(|| fixer.replace(span, replacement))
        });
    }
}

#[derive(Copy, Clone)]
enum Replaced<'a> {
    Span(Span),
    /// From the `return`, or from the last comment in the statement.
    AfterReturn(Stmt<'a>),
}

fn has_function_return_type<'a>(_: Node<'a>, parent: Node<'a>) -> Option<bool> {
    let func = parent.as_func()?;
    matches!(
        func.kind(),
        FnKind::Decl | FnKind::Expr | FnKind::Arrow | FnKind::Method | FnKind::Getter | FnKind::Setter | FnKind::Constructor
    )
    .then(|| func.return_type().is_some())
}

const FUNCTION_NAMES: [&str; 27] = [
    "add",
    // `React.createContext(undefined)`
    "createContext",
    "equal",
    "has",
    "include",
    "includes",
    "is",
    "not",
    "notEqual",
    "notPropertyVal",
    "notSame",
    "notStrictEqual",
    "property",
    "propertyVal",
    "push",
    // `ref(undefined)` of Vue
    "ref",
    "same",
    "set",
    "strictEqual",
    "strictNotSame",
    "strictSame",
    "toBe",
    "toContain",
    "toContainEqual",
    "toEqual",
    "toHaveBeenCalledWith",
    "unshift",
];

fn should_ignore(callee: Expr) -> bool {
    let name = match callee.kind() {
        ExprKind::Ident(name) => name,
        ExprKind::Dot { name, .. } if !callee.is_private_member() => name.name(),
        _ => return false,
    };
    // `setState(undefined)`
    !callee.is_parenthesized() && (name.bytes().starts_with(b"set") || name.is_any(&FUNCTION_NAMES))
}

fn check_call<'a>(_: &NoUselessUndefined, e: Expr<'a>, cx: &mut Cx<'a, NoUselessUndefined>) {
    let (Some(call_expr), Some(state)) = (e.as_call(), &cx.state) else {
        return;
    };
    let undefined = state.undefined;
    let arguments = call_expr.args();
    let undefined_count = arguments.iter().rev().take_while(|it| it.as_ident() == Some(undefined) && !it.is_parenthesized()).count();
    if undefined_count == 0 || should_ignore(call_expr.callee()) {
        return;
    }
    // The arguments of `Function#bind()` are not looked at, but for `this`.
    if arguments.len() != 1 && !call_expr.is_optional() && is_method_call(call_expr, None, Some(&["bind"]), None, None) {
        return;
    }
    let remaining_count = arguments.len() - undefined_count;
    let (Some(first_undefined), Some(last_undefined)) = (arguments.get(remaining_count), arguments.last()) else {
        return;
    };
    let report = cx.report(first_undefined, NO_USELESS_UNDEFINED);
    let report = arguments.iter().skip(remaining_count + 1).fold(report, |report, it| report.label(it, ""));
    report.fix(|fixer| {
        fixer.remove(match remaining_count.checked_sub(1).and_then(|it| arguments.get(it)) {
            Some(previous_argument) => Span::new(previous_argument.outer_span().end, last_undefined.span().end),
            // With the comma at the end.
            None => Span::new(first_undefined.span().start, e.span().end.saturating_sub(1)),
        })
    });
}
