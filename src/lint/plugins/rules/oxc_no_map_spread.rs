use bun_lint_oxlint::ast_util::{get_inner_expression, is_method_call};
use bun_lint_oxlint::codegen::Codegen;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use rustc_hash::FxHashMap;
use smallvec::{SmallVec, smallvec};

/// Disallow object or array spreads in `Array.prototype.map` and `Array.prototype.flatMap` to add properties or elements to array
/// items.
pub struct NoMapSpread {
    ignore_rereads: bool,
    ignore_args: bool,
}

const OBJECT_SPREAD: Message = Message::new("", "Spreading to modify object properties in `map` calls is inefficient");
const ARRAY_SPREAD: Message = Message::new("", "Spreading to modify array elements in `map` calls is inefficient");
const USE_OBJECT_ASSIGN: Message = Message::new(
    "",
    "If in-place mutation is acceptable, use `Object.assign` or direct property assignment instead of spreading",
);

const MAP_FN_NAMES: [&str; 2] = ["map", "flatMap"];

#[derive(Default)]
pub struct State<'a> {
    /// Where the last reference ends that reads a variable.
    last_reads: FxHashMap<Symbol<'a>, u32>,
}

impl Rule for NoMapSpread {
    const META: Meta = Meta::oxlint(Plugin::Oxc, "no-map-spread", Kind::Suggestion).has_suggestions();
    const ON: On = On::new().exprs(&[ExprTag::Call]);
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        NoMapSpread { ignore_rereads: options.bool_or("ignoreRereads", true), ignore_args: options.bool_or("ignoreArgs", true) }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        file.mentions_any(&MAP_FN_NAMES).then(State::default)
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(call_expr) = e.as_call() else {
            return;
        };
        let Some((mapper, callback)) = get_map_callback(call_expr) else {
            return;
        };
        // All that is looked for is in the callback.
        if !bun_core::strings::contains(mapper.text(), b"...") {
            return;
        }
        let mut finder =
            SpreadFinder { callback, declarations: FxHashMap::default(), lists: Vec::new(), return_span: None };
        let mut spreads = finder.spreads_in_returns();
        if spreads.is_empty() {
            return;
        }
        let callee = call_expr.callee();
        let mut leftmost = callee;
        while !leftmost.is_parenthesized()
            && let Some(object) = leftmost.object()
        {
            leftmost = object;
        }
        if !leftmost.is_parenthesized() {
            match leftmost.tag() {
                ExprTag::Ident if self.is_ignored_map_call(leftmost, e.span(), cx) => return,
                // The elements of what a class has are likely spread to leave the instance alone.
                ExprTag::This => return,
                _ => {}
            }
        }
        let map_call_site = match callee.kind() {
            _ if callee.is_parenthesized() => callee.outer_span(),
            ExprKind::Dot { name, .. } => name.span(),
            ExprKind::Index { index, .. } => index.outer_span(),
            _ => callee.span(),
        };
        while let Some(found) = spreads.pop() {
            let spread = match found {
                Found::One(spread) => spread,
                Found::Many(list) => {
                    spreads.extend(finder.lists.get(list).into_iter().flatten().copied());
                    continue;
                }
            };
            let message = if spread.tag() == ExprTag::Object { OBJECT_SPREAD } else { ARRAY_SPREAD };
            let return_span = finder.return_span;
            let report = cx.report(map_call_site, message).labels_with(|labels| label(labels, spread, return_span));
            let ExprKind::Object(properties) = spread.kind() else {
                continue;
            };
            if properties.len() > 1 && properties.first().is_some_and(|it| it.kind() == PropKind::Spread) {
                report.suggest(USE_OBJECT_ASSIGN, |fixer| fixer.replace(spread, spread_to_object_assign(properties)));
            }
        }
    }
}

impl NoMapSpread {
    fn is_ignored_map_call<'a>(&self, ident: Expr<'a>, call_site: Span, cx: &mut Cx<'a, Self>) -> bool {
        let Some(symbol) = ident.symbol() else {
            return false;
        };
        // A `map` of one's own.
        if symbol.name().is_any(&MAP_FN_NAMES) {
            return true;
        }
        if self.ignore_args && matches!(symbol.declarations().next(), Some(Declaration::Param(pat)) if !is_in_rest_parameter(pat)) {
            return true;
        }
        // `ident` itself ends before the call does.
        let is_read = |it: &Reference| it.is_read() && !it.expr().is_some_and(Expr::is_in_type_query);
        let last_read = || symbol.references().rev().find(is_read).map_or(0, |it| it.span().end);
        self.ignore_rereads && *cx.state.last_reads.entry(symbol).or_insert_with(last_read) > call_site.end
    }
}

/// `...a`, `...[a]`: not a parameter for oxlint.
fn is_in_rest_parameter(pat: Pat) -> bool {
    let parameter = Node::Pat(pat).ancestors().find_map(|it| match it {
        Node::Param(parameter) => Some(parameter.is_rest()),
        Node::Func(_) => Some(false),
        _ => None,
    });
    parameter == Some(true)
}

/// The function that is the one argument of `a.map(..)` or `a.flatMap(..)`.
fn get_map_callback(call_expr: Call<'_>) -> Option<(Expr<'_>, Func<'_>)> {
    if call_expr.args().len() != 1 {
        return None;
    }
    let arg = get_inner_expression(call_expr.args().first()?);
    let callback = arg.as_fn()?;
    is_method_call(call_expr, None, Some(&MAP_FN_NAMES), Some(1), Some(1)).then_some((arg, callback))
}

/// `{ ...a, b, c, ...d }` as `Object.assign(a, { b, c }, d)`.
fn spread_to_object_assign<'a>(properties: List<'a, Prop<'a>>) -> Vec<u8> {
    fn separate(codegen: &mut Codegen) {
        if !codegen.code.ends_with(b"(") {
            codegen.code.extend_from_slice(b", ");
        }
    }
    let mut codegen = Codegen::default();
    codegen.code.extend_from_slice(b"Object.assign(");
    let mut curr_obj_properties: SmallVec<[Prop<'a>; 8]> = SmallVec::new();
    // After the last property there is nothing to spread.
    for property in properties.iter().map(Some).chain([None]) {
        if let Some(property) = property.filter(|it| it.kind() != PropKind::Spread) {
            curr_obj_properties.push(property);
            continue;
        }
        if !curr_obj_properties.is_empty() {
            separate(&mut codegen);
            codegen.print_object_expression(&curr_obj_properties);
            curr_obj_properties.clear();
        }
        if let Some(argument) = property.and_then(Prop::value) {
            separate(&mut codegen);
            // The parentheses around an argument are not printed.
            match argument.is_parenthesized() {
                true => codegen.code.extend_from_slice(argument.text()),
                false => codegen.print_expression(argument),
            }
        }
    }
    codegen.code.push(b')');
    codegen.code
}

/// Literals with a spread, each as often as it is found.
#[derive(Copy, Clone)]
enum Found<'a> {
    One(Expr<'a>),
    /// All in the list at this index of `SpreadFinder::lists`.
    Many(usize),
}

enum Visit<'a> {
    Started,
    Done(Option<Found<'a>>),
}

enum Task<'a> {
    Expr(Expr<'a>),
    Pat(Pat<'a>),
    /// Everything in the last of the groups has been looked at.
    End,
}

/// What is found in a declaration, or in what is returned.
#[derive(Default)]
struct Group<'a> {
    declarator: Option<VarDecl<'a>>,
    found: SmallVec<[Found<'a>; 2]>,
}

/// The call, each `...` of `spread`, and what is returned if `spread` is not in it.
fn label(labels: &mut Details, spread: Expr, return_span: Option<Span>) {
    let is_spread = |it: &Prop| it.kind() == PropKind::Spread;
    let spans: SmallVec<[Span; 4]> = match spread.kind() {
        ExprKind::Object(properties) => properties.iter().filter(is_spread).map(Prop::span).collect(),
        ExprKind::Array(elements) => elements.iter().filter(|it| it.tag() == ExprTag::Spread).map(Expr::span).collect(),
        _ => return,
    };
    labels.first(match spread.tag() {
        ExprTag::Object => "This map call spreads an object",
        _ => "This map call spreads an array",
    });
    for (i, span) in spans.iter().enumerate() {
        labels.push(*span, match (i, spans.len()) {
            (0, 1) => "This spread allocates a new value on each iteration",
            (0, _) => "These spreads allocate new values on each iteration",
            _ => "",
        });
    }
    if let Some(returned) = return_span.filter(|it| !it.contains(spread.span())) {
        labels.push(returned, "Map returns the spread here");
    }
}

/// oxlint's `SpreadInReturnVisitor`. That looks at the declaration of a variable each time the variable is returned, or is the value
/// of one that is. Here a declaration is looked at once.
struct SpreadFinder<'a> {
    callback: Func<'a>,
    declarations: FxHashMap<VarDecl<'a>, Visit<'a>>,
    /// Each has two elements or more.
    lists: Vec<Vec<Found<'a>>>,
    /// What the last `return` returns.
    return_span: Option<Span>,
}

impl<'a> SpreadFinder<'a> {
    fn spreads_in_returns(&mut self) -> Vec<Found<'a>> {
        let mut pending: SmallVec<[Stmt<'a>; 16]> = match self.callback.body() {
            FnBody::None => return Vec::new(),
            FnBody::Expr(body) => {
                self.return_span = Some(body.outer_span());
                return self.spreads_in(body).into_iter().collect();
            }
            FnBody::Block(statements) => statements.iter().collect(),
        };
        let mut spreads = Vec::new();
        let mut last_return = 0;
        // Also what the functions and the methods of the classes return that are declared in the callback. No expression is looked
        // into but what is returned.
        while let Some(statement) = pending.pop() {
            if let StmtKind::Return(argument) = statement.kind()
                && statement.span().start >= last_return
            {
                last_return = statement.span().start;
                self.return_span = argument.map(Expr::outer_span);
            }
            match statement.kind() {
                StmtKind::Return(Some(argument)) => spreads.extend(self.spreads_in(argument)),
                StmtKind::Block(statements) => pending.extend(statements),
                StmtKind::If { yes, no, .. } => pending.extend([Some(yes), no].into_iter().flatten()),
                StmtKind::For { body, .. }
                | StmtKind::ForIn { body, .. }
                | StmtKind::ForOf { body, .. }
                | StmtKind::While { body, .. }
                | StmtKind::DoWhile { body, .. }
                | StmtKind::With { body, .. }
                | StmtKind::Labeled { body, .. } => pending.push(body),
                StmtKind::Switch { cases, .. } => pending.extend(cases.iter().flat_map(Case::body)),
                StmtKind::Try { block, handler, finalizer, .. } => {
                    pending.extend([Some(block), handler, finalizer].into_iter().flatten());
                }
                StmtKind::Fn(func) => pending.extend(func.body_statements().into_iter().flatten()),
                StmtKind::Class(class) => {
                    let bodies = class.members().iter().filter_map(|it| it.func()?.body_statements());
                    pending.extend(bodies.flatten());
                }
                _ => {}
            }
        }
        spreads
    }

    /// The literals with a spread that `returned` can be.
    fn spreads_in(&mut self, returned: Expr<'a>) -> Option<Found<'a>> {
        let mut tasks: SmallVec<[Task<'a>; 8]> = smallvec![Task::End, Task::Expr(returned)];
        let mut groups: SmallVec<[Group<'a>; 2]> = smallvec![Group::default()];
        while let (Some(task), Some(group)) = (tasks.pop(), groups.last_mut()) {
            match task {
                Task::Expr(e) => {
                    let e = get_inner_expression(e);
                    match e.kind() {
                        ExprKind::Object(properties) if properties.iter().any(|it| it.kind() == PropKind::Spread) => {
                            group.found.push(Found::One(e));
                        }
                        ExprKind::Array(elements) if elements.iter().any(|it| it.tag() == ExprTag::Spread) => {
                            group.found.push(Found::One(e));
                        }
                        ExprKind::Cond { yes, no, .. } => tasks.extend([Task::Expr(yes), Task::Expr(no)]),
                        ExprKind::Binary { op: BinOp::Comma, right, .. } => tasks.push(Task::Expr(right)),
                        ExprKind::Binary { op: BinOp::And | BinOp::Or | BinOp::Nullish, left, right } => {
                            tasks.extend([Task::Expr(left), Task::Expr(right)]);
                        }
                        ExprKind::Ident(_) => {
                            let Some(declarator) = self.declarator_in_callback(e) else {
                                continue;
                            };
                            match self.declarations.get(&declarator) {
                                Some(Visit::Started) => {}
                                Some(Visit::Done(found)) => group.found.extend(*found),
                                None => {
                                    self.declarations.insert(declarator, Visit::Started);
                                    groups.push(Group { declarator: Some(declarator), found: SmallVec::new() });
                                    tasks.extend([Task::End, Task::Pat(declarator.pat())]);
                                    tasks.extend(declarator.init().map(Task::Expr));
                                }
                            }
                        }
                        _ => {}
                    }
                }
                // The defaults and the computed keys.
                Task::Pat(pat) => match pat.kind() {
                    PatKind::Object(properties) => {
                        for property in properties {
                            if let Some(KeyKind::Computed(key)) = property.key().map(Key::kind) {
                                tasks.push(Task::Expr(key));
                            }
                            tasks.push(Task::Pat(property.value()));
                            tasks.extend(property.default().map(Task::Expr));
                        }
                    }
                    PatKind::Array(elements) => {
                        for element in elements {
                            tasks.extend(element.pat().map(Task::Pat));
                            tasks.extend(element.default().map(Task::Expr));
                        }
                    }
                    _ => {}
                },
                Task::End => {
                    let (declarator, found) = (group.declarator, std::mem::take(&mut group.found));
                    let found = if found.len() > 1 {
                        self.lists.push(found.into_vec());
                        Some(Found::Many(self.lists.len() - 1))
                    } else {
                        found.first().copied()
                    };
                    if let Some(declarator) = declarator {
                        self.declarations.insert(declarator, Visit::Done(found));
                    }
                    groups.pop();
                    match groups.last_mut() {
                        Some(outer) => outer.found.extend(found),
                        None => return found,
                    }
                }
            }
        }
        None
    }

    /// The `a = b` that declares the variable `ident`, if that is in the callback.
    fn declarator_in_callback(&self, ident: Expr<'a>) -> Option<VarDecl<'a>> {
        let symbol = ident.symbol()?;
        if !self.callback.scope()?.contains(symbol.scope()) {
            return None;
        }
        let declaration = symbol.declarations().next().filter(|it| !it.is_catch_parameter())?;
        match (declaration, declaration.node()) {
            (Declaration::Var(_), Some(Node::VarDecl(declarator))) => Some(declarator),
            _ => None,
        }
    }
}
