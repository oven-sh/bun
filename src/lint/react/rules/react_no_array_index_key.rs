use crate::jsx::{as_jsx_element, get_prop_value};
use crate::util_ast::name_of_key;
use crate::util_is_create_element::is_member_called;
use crate::util_pragma::get_from_context;
use crate::util_variable::{Found, find_variable_by_name};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint_oxlint::ast_util::{get_inner_expression, is_method_call};
use rustc_hash::FxHashMap;
use smallvec::{SmallVec, smallvec};
use std::cmp::Reverse;

/// Disallow usage of Array index in keys
pub struct NoArrayIndexKey;

const NO_ARRAY_INDEX: Message = Message::new("noArrayIndex", "Do not use Array index in keys");
const NO_ARRAY_INDEX_KEY: Message = Message::new("", "Usage of Array index in keys is not allowed");

#[derive(Default)]
pub struct State<'a> {
    /// `None` until it's first needed. Unused for oxlint, which has no pragma setting.
    pragma: Option<&'a [u8]>,
    /// The attributes and properties named `key` whose value could be built from an index.
    keys: Vec<Prop<'a>>,
}

impl<'a> State<'a> {
    fn pragma(&mut self, file: &'a File<'a>) -> &'a [u8] {
        *self.pragma.get_or_insert_with(|| get_from_context(file))
    }

    fn add_candidate_keys(&mut self, keys: &mut dyn Iterator<Item = Prop<'a>>) {
        let can_use_index = |it: &Prop<'a>| {
            it.value().is_some_and(|value| {
                !matches!(value.tag(), ExprTag::Dot | ExprTag::Index | ExprTag::String | ExprTag::Number)
            })
        };
        self.keys.extend(keys.filter(can_use_index));
    }
}

/// oxlint only recognizes `React.cloneElement`. For upstream a named import from `react` can also create elements.
fn may_create_elements(file: &File) -> bool {
    file.mentions("cloneElement")
        || (!file.language().is_oxlint
            && file.mentions_any(&["createElement", "react", "#createElement", "#cloneElement"]))
}

impl Rule for NoArrayIndexKey {
    const META: Meta = Meta::plugin(Plugin::React, "no-array-index-key", Kind::None);
    const ON: On = On::new().exprs(&[ExprTag::Jsx, ExprTag::Call]).finish();
    type State<'a> = State<'a>;

    fn new(_: &Options) -> Self {
        NoArrayIndexKey
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        let on = On::new().exprs(&[ExprTag::Jsx]).finish();
        if may_create_elements(file) { on.exprs(&[ExprTag::Call]) } else { on }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<State<'a>> {
        (file.mentions("key") && (file.has_exprs([ExprTag::Jsx]) || may_create_elements(file))).then(State::default)
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let is_oxlint = cx.language().is_oxlint;
        match e.tag() {
            ExprTag::Jsx => {
                let Some(jsx) = as_jsx_element(e) else {
                    return;
                };
                let is_key = |it: &Prop<'a>| {
                    it.key().is_some_and(|key| key.is("key"))
                        && get_prop_value(*it).is_some_and(|value| value.as_expression().is_some())
                };
                cx.state.add_candidate_keys(&mut jsx.attrs().iter().filter(is_key));
            }
            ExprTag::Call => {
                let Some(call) = e.as_call() else {
                    return;
                };
                // oxlint's AST has a node for parentheses.
                let Some(ExprKind::Object(properties)) =
                    call.args().get(1).filter(|it| !is_oxlint || !it.is_parenthesized()).map(Expr::kind)
                else {
                    return;
                };
                // Upstream treats `[key]` as `key`.
                let is_key = |it: &Prop<'a>| match it.key() {
                    Some(key) if is_oxlint => matches!(key.kind(), KeyKind::Ident(name) if name.is("key")),
                    Some(key) => name_of_key(key).is_some_and(|name| name == b"key"),
                    None => false,
                };
                let is_creation = properties.iter().any(|it| is_key(&it))
                    && match is_oxlint {
                        true => is_method_call(call, Some(&["React"]), Some(&["cloneElement"]), Some(2), Some(3)),
                        false => is_create_clone_element(call.callee(), cx),
                    };
                if is_creation {
                    cx.state.add_candidate_keys(&mut properties.iter().filter(is_key));
                }
            }
            _ => {}
        }
    }

    /// Upstream keeps a stack of the enclosing calls. This walks the calls and the keys in source order instead.
    fn finish<'a>(&self, cx: &mut Cx<'a, Self>) {
        let mut keys = std::mem::take(&mut cx.state.keys);
        if keys.is_empty() {
            return;
        }
        let is_oxlint = cx.language().is_oxlint;
        let file = cx.file();
        let pragma = if is_oxlint { &b""[..] } else { cx.state.pragma(file) };
        let calls = file.exprs_of_kind(ExprTag::Call);
        let mut calls: Vec<_> = calls.filter_map(|it| IteratorCall::new(it, is_oxlint, pragma)).collect();
        if calls.is_empty() {
            return;
        }
        utils::sort::sort_by_key(&mut calls, |it| (it.span.start, Reverse(it.span.end)));
        utils::sort::sort_by_key(&mut keys, |it| it.span().start);
        let mut calls = calls.into_iter().peekable();
        let mut enclosing_calls = EnclosingCalls::default();
        for key in keys {
            let Some(value) = key.value() else {
                continue;
            };
            let at = value.span().start;
            while let Some(call) = calls.next_if(|it| it.span.start < at) {
                enclosing_calls.close_until(call.span.start);
                enclosing_calls.push(call);
            }
            enclosing_calls.close_until(at);
            let innermost = enclosing_calls.calls.last().filter(|_| is_oxlint).and_then(|it| it.index?.symbol());
            let is_array_index = |it: Expr<'a>| match is_oxlint {
                // oxlint only accepts the innermost call's parameter, and looks through TypeScript wrappers.
                true => innermost.is_some() && get_inner_expression(it).symbol() == innermost,
                false => it.as_ident().is_some_and(|name| enclosing_calls.names.contains_key(&name)),
            };
            let mut is_reported = false;
            check_prop_value(value, is_oxlint, &is_array_index, &mut |node| {
                // oxlint reports the attribute or property, once.
                if !is_oxlint {
                    cx.report(node, NO_ARRAY_INDEX);
                } else if !std::mem::replace(&mut is_reported, true) {
                    cx.report(key, NO_ARRAY_INDEX_KEY);
                }
            });
        }
    }
}

fn is_create_clone_element<'a>(callee: Expr<'a>, cx: &mut Cx<'a, NoArrayIndexKey>) -> bool {
    if let Some(name) = callee.as_ident() {
        return matches!(
            find_variable_by_name(Node::Expr(callee), name),
            Some(Found::Import(Declaration::ImportSpec(specifier))) if specifier.import().spec().is("react")
        );
    }
    let file = cx.file();
    (is_member_called(callee, "createElement") || is_member_called(callee, "cloneElement"))
        && callee.object().and_then(Expr::as_ident).is_some_and(|it| it.bytes() == cx.state.pragma(file))
}

/// `a.map(..)` or a similar call.
struct IteratorCall<'a> {
    span: Span,
    /// The callback's index parameter, if it has one.
    index: Option<Pat<'a>>,
}

impl<'a> IteratorCall<'a> {
    /// upstream's `getMapIndexParamName`
    fn new(e: Expr<'a>, is_oxlint: bool, pragma: &[u8]) -> Option<IteratorCall<'a>> {
        let call = e.as_call()?;
        let callee = call.callee();
        // oxlint's AST has a node for parentheses.
        if callee.is_chain_root() || (is_oxlint && callee.is_parenthesized()) {
            return None;
        }
        let method = match callee.kind() {
            ExprKind::Dot { name, .. } => name.name(),
            // Upstream treats `a[map]` as `a.map`.
            ExprKind::Index { index, .. } if !is_oxlint => index.as_ident()?,
            _ => return None,
        };
        let position = match method.bytes() {
            b"every" | b"filter" | b"find" | b"findIndex" | b"flatMap" | b"forEach" | b"map" | b"some" => 1,
            b"reduce" | b"reduceRight" => 2,
            _ => return None,
        };
        // oxlint doesn't recognize `Children.map(children, callback)`.
        let callback = usize::from(!is_oxlint && is_using_react_children(callee, method, pragma));
        let callback = call.args().get(callback).filter(|it| !is_oxlint || !it.is_parenthesized());
        let callback = callback.and_then(Expr::as_fn);
        let index = callback.and_then(|it| match is_oxlint {
            true => it.params().get(position),
            // For upstream `this` counts as a parameter, and `index = 0` has no name.
            false => it.params_with_this().nth(position).filter(|it| it.default().is_none()),
        });
        let index = index.filter(|it| !it.is_rest()).map(Param::pat).filter(|it| it.as_ident().is_some());
        // oxlint stops at the innermost call, whether it has an index or not.
        (is_oxlint || index.is_some()).then(|| IteratorCall { span: e.span(), index })
    }
}

fn is_using_react_children(callee: Expr<'_>, method: Name<'_>, pragma: &[u8]) -> bool {
    method.is_any(&["map", "forEach"])
        && callee.object().is_some_and(|obj| {
            let object = obj.object().filter(|_| !obj.is_chain_root()).and_then(Expr::as_ident);
            obj.is_ident("Children") || object.is_some_and(|it| it.bytes() == pragma)
        })
}

/// upstream's `indexParamNames`
#[derive(Default)]
struct EnclosingCalls<'a> {
    /// The enclosing calls at the current position, innermost last.
    calls: Vec<IteratorCall<'a>>,
    /// For each name, how many of them use it as their index.
    names: FxHashMap<Name<'a>, u32>,
}

impl<'a> EnclosingCalls<'a> {
    fn push(&mut self, call: IteratorCall<'a>) {
        if let Some(name) = call.index.and_then(Pat::as_ident) {
            *self.names.entry(name).or_default() += 1;
        }
        self.calls.push(call);
    }

    /// Pops the calls that end before `at`.
    fn close_until(&mut self, at: u32) {
        while let Some(call) = self.calls.pop_if(|it| it.span.end <= at) {
            if let Some(name) = call.index.and_then(Pat::as_ident)
                && let Some(count) = self.names.get_mut(&name)
            {
                *count -= 1;
                if *count == 0 {
                    self.names.remove(&name);
                }
            }
        }
    }
}

/// `BinaryExpression`: not `a && b` or `a, b`. For oxlint not `#a in b` either.
fn as_binary_expression(expr: Expr<'_>, is_oxlint: bool) -> Option<[Expr<'_>; 2]> {
    match expr.kind() {
        ExprKind::Binary { op, left, right }
            if !matches!(op, BinOp::And | BinOp::Or | BinOp::Nullish | BinOp::Comma)
                && (!is_oxlint || left.tag() != ExprTag::PrivateIdentifier) =>
        {
            Some([left, right])
        }
        _ => None,
    }
}

fn check_prop_value<'a>(
    node: Expr<'a>,
    is_oxlint: bool,
    is_array_index: &dyn Fn(Expr<'a>) -> bool,
    report: &mut dyn FnMut(Expr<'a>),
) {
    // key={bar}
    if is_array_index(node) {
        return report(node);
    }
    // oxlint's AST has a node for parentheses.
    let is_plain = |it: Expr<'a>| !is_oxlint || !it.is_parenthesized();
    if !is_plain(node) {
        return;
    }
    match node.kind() {
        // key={`foo-${bar}`}
        ExprKind::Template(template) => {
            template.exprs().iter().filter(|it| is_array_index(*it)).for_each(|_| report(node));
        }
        // key={'foo' + bar}
        ExprKind::Binary { .. } => {
            let mut pending: SmallVec<[Expr<'a>; 4]> = smallvec![node];
            while let Some(side) = pending.pop() {
                if is_array_index(side) {
                    report(node);
                } else if is_plain(side)
                    && let Some(sides) = as_binary_expression(side, is_oxlint)
                {
                    pending.extend(sides);
                }
            }
        }
        ExprKind::Call(call) if !node.is_chain_root() => {
            let callee = call.callee();
            match callee.kind() {
                _ if callee.is_chain_root() || !is_plain(callee) => {}
                // key={bar.toString()}
                ExprKind::Dot { obj, name, .. } if name.name().is("toString") && is_array_index(obj) => report(node),
                // Upstream treats `bar[toString]` as `bar.toString`.
                ExprKind::Index { obj, index, .. }
                    if !is_oxlint && index.is_ident("toString") && is_array_index(obj) =>
                {
                    report(node);
                }
                // key={String(bar)}
                ExprKind::Ident(name) if name.is("String") => {
                    if let Some(argument) = call.args().first()
                        && argument.tag() != ExprTag::Spread
                        && is_array_index(argument)
                    {
                        report(argument);
                    }
                }
                _ => {}
            }
        }
        _ => {}
    }
}
