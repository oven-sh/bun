use crate::util_jsx::is_dom_component;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use rustc_hash::FxHashMap;
use smallvec::SmallVec;

/// Disallow `.bind()` or arrow functions in JSX props.
pub struct JsxNoBind {
    allow_arrow_functions: bool,
    allow_bind: bool,
    allow_functions: bool,
    ignore_refs: bool,
    ignore_dom_components: bool,
}

const BIND_CALL: Message = Message::new("bindCall", "JSX props should not use .bind()");
const ARROW_FUNC: Message = Message::new("arrowFunc", "JSX props should not use arrow functions");
const FUNC: Message = Message::new("func", "JSX props should not use functions");

/// In the order in which upstream looks for a name in the sets of a block.
#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord)]
enum Violation {
    ArrowFunc,
    BindCall,
    Func,
}

impl Violation {
    fn message(self) -> Message {
        match self {
            Violation::ArrowFunc => ARROW_FUNC,
            Violation::BindCall => BIND_CALL,
            Violation::Func => FUNC,
        }
    }
}

/// What a name is declared as in a `BlockStatement`, which is the nearest around the declaration.
#[derive(Copy, Clone)]
struct Declared {
    block: Span,
    violation: Violation,
}

/// An attribute whose value is the identifier `name`, or a declaration of that name.
struct Mention<'a> {
    name: Name<'a>,
    span: Span,
    declared: Option<Declared>,
}

#[derive(Default)]
pub struct State<'a> {
    /// The attributes whose value is an identifier.
    identifiers: Vec<Mention<'a>>,
}

impl Rule for JsxNoBind {
    const META: Meta = Meta::plugin(Plugin::React, "jsx-no-bind", Kind::None);
    const ON: On = On::new().exprs(&[ExprTag::Jsx]).finish();
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        JsxNoBind {
            allow_arrow_functions: options.bool_or("allowArrowFunctions", false),
            allow_bind: options.bool_or("allowBind", false),
            allow_functions: options.bool_or("allowFunctions", false),
            ignore_refs: options.bool_or("ignoreRefs", false),
            ignore_dom_components: options.bool_or("ignoreDOMComponents", false),
        }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<State<'a>> {
        file.has_exprs([ExprTag::Jsx]).then(State::default)
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Jsx(jsx) = e.kind() else {
            return;
        };
        if self.ignore_dom_components && is_dom_component(jsx) {
            return;
        }
        for attribute in jsx.attrs() {
            // A value that is not in braces is a string or an element.
            let Some(value) = attribute.value().filter(|_| attribute.kind() != PropKind::Spread) else {
                continue;
            };
            if self.ignore_refs && attribute.key().is_some_and(|it| it.is("ref")) {
                continue;
            }
            if let Some(name) = value.as_ident() {
                cx.state.identifiers.push(Mention { name, span: attribute.span(), declared: None });
            } else if let Some(violation) = self.get_node_violation_type(value) {
                cx.report(attribute, violation.message());
            }
        }
    }

    /// Upstream fills the sets of the blocks while it walks: an attribute sees what is declared before it.
    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let mut mentions = std::mem::take(&mut cx.state.identifiers);
        if mentions.is_empty() {
            return;
        }
        // What each name is declared as in the blocks around the place that the last loop is at, the innermost last.
        let mut open: FxHashMap<Name<'_>, SmallVec<[Declared; 2]>> =
            mentions.iter().map(|it| (it.name, SmallVec::new())).collect();
        let mut blocks = AncestorMemo::default();
        if !self.allow_functions {
            for statement in cx.file().stmts_of_kind(StmtTag::Fn) {
                if let StmtKind::Fn(function) = statement.kind()
                    && function.has_body()
                    && let Some(name) = function.name().map(Ident::name)
                    && open.contains_key(&name)
                    && let Some(block) = block_around(statement, &mut blocks)
                {
                    let declared = Some(Declared { block, violation: Violation::Func });
                    mentions.push(Mention { name, span: statement.span(), declared });
                }
            }
        }
        for statement in cx.file().stmts_of_kind(StmtTag::Var) {
            let StmtKind::Var(declarations) = statement.kind() else {
                continue;
            };
            for declaration in declarations.iter().filter(|it| it.var_kind() == VarKind::Const) {
                if let Some(name) = declaration.pat().as_ident()
                    && open.contains_key(&name)
                    && let Some(violation) = declaration.init().and_then(|it| self.get_node_violation_type(it))
                    && let Some(block) = block_around(statement, &mut blocks)
                {
                    let declared = Some(Declared { block, violation });
                    mentions.push(Mention { name, span: declaration.span(), declared });
                }
            }
        }
        mentions.sort_unstable_by_key(|it| it.span.start);
        for mention in &mentions {
            let Some(open) = open.get_mut(&mention.name) else {
                continue;
            };
            while open.last().is_some_and(|it| it.block.end <= mention.span.start) {
                open.pop();
            }
            match mention.declared {
                Some(declared) => match open.last_mut() {
                    Some(last) if last.block == declared.block => {
                        last.violation = last.violation.min(declared.violation);
                    }
                    _ => open.push(declared),
                },
                None => {
                    if let Some(last) = open.last() {
                        cx.report(mention.span, last.violation.message());
                    }
                }
            }
        }
    }
}

impl JsxNoBind {
    /// upstream's `getNodeViolationType`
    fn get_node_violation_type(&self, mut node: Expr<'_>) -> Option<Violation> {
        let mut pending: SmallVec<[Expr<'_>; 4]> = SmallVec::new();
        loop {
            let violation = match node.kind() {
                ExprKind::Cond { test, yes, no } => {
                    pending.extend([no, yes]);
                    node = test;
                    continue;
                }
                ExprKind::Call(call) => {
                    let is_bind = !self.allow_bind && is_member_called_bind(call.callee()) && !node.is_chain_root();
                    is_bind.then_some(Violation::BindCall)
                }
                ExprKind::Fn(function) if function.is_arrow() => {
                    (!self.allow_arrow_functions).then_some(Violation::ArrowFunc)
                }
                ExprKind::Fn(_) => (!self.allow_functions).then_some(Violation::Func),
                _ => None,
            };
            if violation.is_some() {
                return violation;
            }
            node = pending.pop()?;
        }
    }
}

/// `a.bind`, `a[bind]`
fn is_member_called_bind(callee: Expr<'_>) -> bool {
    let is_called_bind = match callee.kind() {
        ExprKind::Dot { name, .. } => name.name().is("bind"),
        ExprKind::Index { index, .. } => index.as_ident().is_some_and(|it| it.is("bind")),
        _ => false,
    };
    is_called_bind && !callee.is_chain_root()
}

/// The first of upstream's `getBlockStatementAncestors`.
fn block_around<'a>(statement: Stmt<'a>, known: &mut AncestorMemo<'a, Span>) -> Option<Span> {
    known.find(Node::Stmt(statement), |child, parent| match parent {
        Node::Stmt(it) if it.tag() == StmtTag::Block => Some(it.span()),
        // The parameters are not in the body. A static block is no `BlockStatement`.
        Node::Func(it) if matches!(child, Node::Stmt(_)) && it.kind() != FnKind::StaticBlock => it.body_span(),
        _ => None,
    })
}
