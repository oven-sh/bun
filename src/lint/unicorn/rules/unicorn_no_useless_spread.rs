use bun_lint_oxlint::ast_util::{
    get_inner_expression, get_inner_expression_unless_chain, get_member_expr, is_method_call, is_new_expression,
    static_property_name,
};
use bun_lint_oxlint::codegen::Codegen;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use rustc_hash::FxHashSet;
use smallvec::{SmallVec, smallvec};

/// Disallow unnecessary spread.
pub struct NoUselessSpread;

const USELESS_SPREAD: Message = Message::new("", "Using a spread operator here creates a new {{noun}} unnecessarily.");
const ITERABLE_TO_ARRAY: Message = Message::new(
    "",
    "`{{ctor_name}}` accepts an iterable, so it's unnecessary to convert the iterable to an array.",
);

const TYPED_ARRAYS: [&str; 12] = [
    "Int8Array",
    "Uint8Array",
    "Uint8ClampedArray",
    "Int16Array",
    "Uint16Array",
    "Int32Array",
    "Uint32Array",
    "Float16Array",
    "Float32Array",
    "Float64Array",
    "BigInt64Array",
    "BigUint64Array",
];

impl Rule for NoUselessSpread {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "no-useless-spread", Kind::Problem).fixable(Fixable::Code);
    /// The array literals of which it is known that not all elements are `...[..]`.
    type State<'a> = FxHashSet<Expr<'a>>;

    fn new(_: &Options) -> Self {
        NoUselessSpread
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) -> FxHashSet<Expr<'a>> {
        on.exprs([ExprTag::Spread], |_, spread, cx| {
            if let (ExprKind::Spread(argument), Node::Expr(list)) = (spread.kind(), spread.parent())
                && spread.jsx_container_span().is_none()
            {
                check(Spread { start: spread.span().start, argument, list }, cx);
            }
        });
        on.props(|_, prop, cx| {
            if prop.kind() == PropKind::Spread
                && !prop.is_jsx_attribute()
                && let (Some(argument), Node::Expr(list)) = (prop.value(), prop.parent())
            {
                check(Spread { start: prop.span().start, argument, list }, cx);
            }
        });
        FxHashSet::default()
    }
}

/// `...argument` in `list`, which is an array, an object, a call or a `new`.
#[derive(Copy, Clone)]
struct Spread<'a> {
    start: u32,
    argument: Expr<'a>,
    list: Expr<'a>,
}

impl<'a> Spread<'a> {
    /// The `...`.
    fn dots(self) -> Span {
        Span::new(self.start, self.start + 3)
    }

    fn span(self) -> Span {
        Span::new(self.start, self.argument.outer_span().end)
    }

    fn argument_text(self) -> &'a [u8] {
        self.argument.file().slice(self.argument.outer_span())
    }
}

/// Whether `...literal` in `list` is reported whatever else is in `list`.
fn is_useless_spread_in_list(literal: ExprTag, list: ExprTag) -> bool {
    match literal {
        ExprTag::Object => list == ExprTag::Object,
        ExprTag::Array => matches!(list, ExprTag::Array | ExprTag::Call | ExprTag::New),
        _ => false,
    }
}

fn check<'a>(spread: Spread<'a>, cx: &mut Cx<'a, NoUselessSpread>) {
    let Spread { argument, list, .. } = spread;
    if is_useless_spread_in_list(argument.tag(), list.tag()) {
        if !list.is_assignment_target() {
            check_useless_spread_in_list(spread, cx);
        }
        return;
    }
    // What follows is about `[...argument]` and `{...argument}`.
    let is_array = match list.kind() {
        ExprKind::Array(elements) if elements.len() == 1 => true,
        ExprKind::Object(properties) if properties.len() == 1 => false,
        _ => return,
    };
    let around = match list.parent() {
        Node::Expr(outer) if outer.tag() == ExprTag::Spread && outer.jsx_container_span().is_none() => outer.parent(),
        Node::Prop(outer) if outer.kind() == PropKind::Spread && !outer.is_jsx_attribute() => outer.parent(),
        _ => Node::File(cx.file()),
    };
    // It is reported as `...list` then.
    if matches!(around, Node::Expr(around) if is_useless_spread_in_list(list.tag(), around.tag())) {
        return;
    }
    if !(is_array && check_useless_iterable_to_array(spread, cx)) {
        check_useless_clone(spread, is_array, cx);
    }
}

fn check_useless_spread_in_list<'a>(spread: Spread<'a>, cx: &mut Cx<'a, NoUselessSpread>) {
    let Spread { argument, list, .. } = spread;
    let noun = if argument.tag() == ExprTag::Object { "object" } else { "array" };
    let report = cx.report(spread.dots(), USELESS_SPREAD).data("noun", noun);
    match (argument.kind(), list.kind()) {
        (ExprKind::Object(inner), ExprKind::Object(outer)) => report.fix(|fixer| {
            let mut properties: SmallVec<[Prop; 8]> = SmallVec::new();
            for property in outer {
                match property.value() == Some(argument) {
                    true => properties.extend(inner),
                    false => properties.push(property),
                }
            }
            let mut codegen = Codegen::default();
            codegen.code.push(b'(');
            codegen.print_object_expression(&properties);
            codegen.code.push(b')');
            fixer.replace(list, codegen.code)
        }),
        (ExprKind::Array(_), ExprKind::Array(outer)) if outer.len() == 1 => {
            report.fix(|fixer| fixer.replace(list, argument.text()))
        }
        (ExprKind::Array(_), ExprKind::Array(outer)) => report.fix(|fixer| {
            if cx.state.contains(&list) {
                return None;
            }
            let Some(elements) = elements_of_spread_arrays(outer) else {
                cx.state.insert(list);
                return None;
            };
            let mut codegen = Codegen::default();
            codegen.code.push(b'[');
            for (i, element) in elements.iter().enumerate() {
                let is_last = i + 1 == elements.len();
                match element.is_missing() {
                    true if is_last => codegen.code.push(b','),
                    true => {}
                    false => codegen.print_expression(*element),
                }
                if !is_last {
                    codegen.code.extend_from_slice(b", ");
                }
            }
            codegen.code.push(b']');
            Some(fixer.replace(list, codegen.code))
        }),
        (ExprKind::Array(elements), _) => report.fix(|fixer| {
            let (file, brackets) = (fixer.file(), argument.span());
            // A hole is where its comma is.
            let elements = elements.first().zip(elements.last()).map(|(first, last)| {
                let start = match first.is_missing() {
                    true => skip_trivia(file.text(), brackets.start + 1),
                    false => first.outer_span().start,
                };
                let end = match last.is_missing() {
                    true => file.end_of_token_before(brackets.end.saturating_sub(1)),
                    false => last.outer_span().end,
                };
                Span::new(start, end)
            });
            fixer.replace(spread.span(), elements.map_or(&b""[..], |it| file.slice(it)))
        }),
        _ => report,
    };
}

/// The elements of the arrays, if all of `list` is `...[..]`.
fn elements_of_spread_arrays<'a>(list: List<'a, Expr<'a>>) -> Option<Vec<Expr<'a>>> {
    let mut all = Vec::new();
    for spread in list {
        let ExprKind::Spread(array) = spread.kind() else {
            return None;
        };
        let ExprKind::Array(elements) = array.kind() else {
            return None;
        };
        if array.is_parenthesized() {
            return None;
        }
        all.extend(elements);
    }
    Some(all)
}

/// `spread`: the only element of an array.
fn check_useless_iterable_to_array<'a>(spread: Spread<'a>, cx: &Cx<'a, NoUselessSpread>) -> bool {
    let array = spread.list;
    let parent = match array.parent() {
        Node::Stmt(parent) => {
            let is_iterated = matches!(parent.kind(), StmtKind::ForOf { expr, .. } if expr == array);
            if is_iterated {
                cx.report(spread.dots(), USELESS_SPREAD).data("noun", "array");
            }
            return is_iterated;
        }
        Node::Expr(parent) => parent,
        _ => return false,
    };
    match parent.kind() {
        ExprKind::Yield { star: true, .. } if !array.is_parenthesized() => {
            cx.report(spread.dots(), USELESS_SPREAD).data("noun", "array");
            true
        }
        ExprKind::New(new) if new.args().first() == Some(array) => {
            let accepts_iterable = is_new_expression(new, &["Map", "WeakMap", "Set", "WeakSet"], Some(1), Some(1))
                || is_new_expression(new, &TYPED_ARRAYS, Some(1), None);
            if accepts_iterable && let Some(ctor_name) = new.callee().as_ident() {
                cx.report(spread.dots(), ITERABLE_TO_ARRAY)
                    .data("ctor_name", ctor_name)
                    .fix(|fixer| fixer.replace(array.outer_span(), spread.argument_text()));
            }
            accepts_iterable
        }
        ExprKind::Call(call) if call.args().first() == Some(array) => {
            let accepts_iterable =
                is_method_call(call, Some(&["Promise"]), Some(&["all", "allSettled", "any", "race"]), Some(1), Some(1))
                    || is_array_from(call)
                    || is_method_call(call, Some(&["Object"]), Some(&["fromEntries"]), Some(1), Some(1));
            if accepts_iterable && let Some(method_name) = get_method_name(call) {
                cx.report(spread.dots(), ITERABLE_TO_ARRAY)
                    .data("ctor_name", method_name)
                    .fix(|fixer| fixer.replace(array, spread.argument_text()));
            }
            accepts_iterable
        }
        _ => false,
    }
}

fn get_method_name(call: Call) -> Option<Vec<u8>> {
    let callee = get_member_expr(call.callee())?;
    let object = callee.object().filter(|it| !it.is_parenthesized()).and_then(Expr::as_ident);
    Some([object.map_or(&b"unknown"[..], Name::bytes), b".", static_property_name(callee)?.bytes()].concat())
}

/// `spread`: all that is in an array or an object.
fn check_useless_clone<'a>(spread: Spread<'a>, is_array: bool, cx: &Cx<'a, NoUselessSpread>) {
    let target = get_inner_expression(spread.argument);
    let (wanted, noun) = if is_array { (ValueHint::NewArray, "array") } else { (ValueHint::NewObject, "object") };
    if matches!(target.tag(), ExprTag::Array | ExprTag::Object)
        || const_eval(spread.argument) != wanted
        || spread.list.is_assignment_target()
    {
        return;
    }
    cx.report(spread.dots(), USELESS_SPREAD).data("noun", noun).fix(|fixer| {
        // `[...new Array(1)]` has no holes.
        let has_holes = matches!(target.kind(), ExprKind::New(new)
            if new.args().len() == 1 && get_inner_expression(new.callee()).is_ident("Array"));
        let suffix: &[u8] = if has_holes { b".fill()" } else { b"" };
        fixer.replace(spread.list, [spread.argument_text(), suffix].concat())
    });
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum ValueHint {
    NewObject,
    NewArray,
    /// `[...it]` is not a copy of it: it makes an array of it.
    NewTypedArray,
    /// An iterable that is not an array.
    NewIterable,
    /// A promise of a new array.
    Promise,
    Unknown,
}

/// How often what a method is called on is looked at in its turn, where it is more than another call of such a method.
const MAX_DEPTH: u8 = 8;

/// What is known of the value of `e`. Of `a ? b : c`: what is known of both `b` and `c`.
fn const_eval(e: Expr) -> ValueHint {
    const_eval_at(e, 0)
}

fn const_eval_at(e: Expr, depth: u8) -> ValueHint {
    let mut pending: SmallVec<[Expr; 4]> = smallvec![e];
    let mut known = None;
    while let Some(e) = pending.pop() {
        let hint = match const_eval_unless_conditional(e, depth) {
            Ok(hint) => hint,
            Err(branches) => {
                pending.extend(branches);
                continue;
            }
        };
        match known {
            None => known = Some(hint),
            // Of two promises nothing is known.
            Some(known) if known == hint && hint != ValueHint::Promise => {}
            Some(_) => return ValueHint::Unknown,
        }
    }
    known.unwrap_or(ValueHint::Unknown)
}

/// `Err`: it is what `a ? b : c` is: the `b` and the `c`.
fn const_eval_unless_conditional(e: Expr<'_>, depth: u8) -> Result<ValueHint, [Expr<'_>; 2]> {
    let (mut at, mut is_awaited) = (e, false);
    loop {
        let Some(inner) = get_inner_expression_unless_chain(at) else {
            return Ok(ValueHint::Unknown);
        };
        let hint = match inner.kind() {
            ExprKind::Await(argument) => {
                (at, is_awaited) = (argument, true);
                continue;
            }
            ExprKind::Binary { op: BinOp::Comma, right, .. } => {
                at = right;
                continue;
            }
            ExprKind::Call(call) if is_array_reduce(call) => {
                let Some(initial_value) = call.args().get(1) else {
                    return Ok(ValueHint::Unknown);
                };
                let spread = initial_value.operand().filter(|_| initial_value.tag() == ExprTag::Spread);
                at = spread.unwrap_or(initial_value);
                continue;
            }
            ExprKind::Cond { yes, no, .. } => return Err([yes, no]),
            ExprKind::Array(_) => ValueHint::NewArray,
            ExprKind::Object(_) => ValueHint::NewObject,
            ExprKind::Call(call) => const_eval_call(call, depth),
            ExprKind::New(new) => const_eval_new(new),
            _ => ValueHint::Unknown,
        };
        return Ok(if is_awaited && hint == ValueHint::Promise { ValueHint::NewArray } else { hint });
    }
}

fn const_eval_new(new: Call) -> ValueHint {
    if is_new_expression(new, &["Array"], None, None) {
        ValueHint::NewArray
    } else if is_new_expression(new, &TYPED_ARRAYS, Some(1), None) {
        ValueHint::NewTypedArray
    } else if is_new_expression(new, &["Map", "WeakMap", "Set", "WeakSet"], None, Some(1)) {
        ValueHint::NewIterable
    } else if is_new_expression(new, &["Object"], None, None) {
        ValueHint::NewObject
    } else {
        ValueHint::Unknown
    }
}

fn const_eval_call(call: Call, depth: u8) -> ValueHint {
    let is_typed_array_from = is_method_call(call, Some(&TYPED_ARRAYS), Some(&["from"]), Some(1), Some(1));
    if is_typed_array_from || is_typed_array_method(call, depth) {
        ValueHint::NewTypedArray
    } else if returns_new_array(call) {
        ValueHint::NewArray
    } else if is_method_call(call, Some(&["Promise"]), Some(&["all", "allSettled"]), Some(1), Some(1)) {
        ValueHint::Promise
    } else if is_method_call(call, Some(&["Object"]), Some(&["fromEntries", "create"]), Some(1), Some(1)) {
        ValueHint::NewObject
    } else {
        ValueHint::Unknown
    }
}

/// `a.map(..)` and the like: of an array it makes a new array.
fn is_functional_array_method(call: Call) -> bool {
    const FUNCTIONAL_ARRAY_METHODS: [&str; 12] = [
        "concat",
        "copyWithin",
        "filter",
        "flat",
        "flatMap",
        "map",
        "slice",
        "splice",
        "toReversed",
        "toSorted",
        "toSpliced",
        "with",
    ];
    is_method_call(call, None, Some(&FUNCTIONAL_ARRAY_METHODS), None, None)
}

/// Such a method, called on a typed array: it makes a new typed array.
fn is_typed_array_method(mut call: Call, depth: u8) -> bool {
    loop {
        let object = get_member_expr(call.callee()).and_then(Expr::object);
        let Some(object) = object.filter(|_| is_functional_array_method(call)) else {
            return false;
        };
        // A chain of such calls can be as long as the code.
        match get_inner_expression_unless_chain(object).and_then(Expr::as_call) {
            Some(inner) if is_functional_array_method(inner) => call = inner,
            _ => return depth < MAX_DEPTH && const_eval_at(object, depth + 1) == ValueHint::NewTypedArray,
        }
    }
}

fn returns_new_array(call: Call) -> bool {
    is_method_call(call, None, Some(&["split"]), None, None)
        || is_method_call(call, Some(&["Array"]), Some(&["from", "of"]), None, None)
        || is_functional_array_method(call)
        || is_method_call(call, Some(&["Object"]), Some(&["keys", "values", "entries"]), None, None)
}

/// `Array.from(x)`, `Int8Array.from(x)`
fn is_array_from(call: Call) -> bool {
    is_method_call(call, Some(&["Array"]), Some(&["from"]), Some(1), Some(1))
        || is_method_call(call, Some(&TYPED_ARRAYS), Some(&["from"]), Some(1), Some(1))
}

/// `a.reduce(f, initial_value)`
fn is_array_reduce(call: Call) -> bool {
    is_method_call(call, None, Some(&["reduce"]), Some(2), Some(2))
}
