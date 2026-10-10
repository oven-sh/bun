use bun_lint_oxlint::ast_util::{
    as_function, as_member_expression, as_object_property, callee_name, get_inner_expression, static_property_info,
    static_property_name,
};
use crate::jsx::{AttributeValue, as_jsx_element, get_prop_value, has_jsx_prop_ignore_case};
use crate::react::{AncestorWalk, is_jsx};
use crate::util_is_create_element::is_member_called;
use crate::util_pragma::{get_fragment_from_context, get_from_context};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use bun_lint::utils::sort;
use rustc_hash::FxHashSet;
use smallvec::SmallVec;
use std::borrow::Cow;
use std::cell::OnceCell;
use std::ops::ControlFlow;

/// Disallow missing `key` props in iterators/collection literals
pub struct JsxKey {
    eslint: Checks,
    oxlint: Checks,
}

/// The options.
#[derive(Copy, Clone, Default)]
struct Checks {
    key_must_before_spread: bool,
    warn_on_duplicates: bool,
    fragment_shorthand: bool,
}

const MISSING_ITER_KEY: Message = Message::new("missingIterKey", "Missing \"key\" prop for element in iterator");
const MISSING_ITER_KEY_USE_PRAG: Message = Message::new(
    "missingIterKeyUsePrag",
    "Missing \"key\" prop for element in iterator. Shorthand fragment syntax does not support providing keys. Use {{reactPrag}}.{{fragPrag}} instead",
);
const MISSING_ARRAY_KEY: Message = Message::new("missingArrayKey", "Missing \"key\" prop for element in array");
const MISSING_ARRAY_KEY_USE_PRAG: Message = Message::new(
    "missingArrayKeyUsePrag",
    "Missing \"key\" prop for element in array. Shorthand fragment syntax does not support providing keys. Use {{reactPrag}}.{{fragPrag}} instead",
);
const KEY_BEFORE_SPREAD: Message = Message::new(
    "keyBeforeSpread",
    "`key` prop must be placed before any `{...spread}, to avoid conflicting with React’s new JSX transform: https://reactjs.org/blog/2020/09/22/introducing-the-new-jsx-transform.html`",
);
const NON_UNIQUE_KEYS: Message = Message::new("nonUniqueKeys", "`key` prop must be unique");

const MISSING_KEY_PROP_FOR_ELEMENT_IN_ARRAY: Message = Message::new("", "Missing \"key\" prop for element in array.");
const MISSING_KEY_PROP_FOR_ELEMENT_IN_ITERATOR: Message =
    Message::new("", "Missing \"key\" prop for element in iterator.");
const KEY_PROP_MUST_BE_PLACED_BEFORE_SPREAD: Message =
    Message::new("", "\"key\" prop must be placed before any `{...spread}`");
const DUPLICATE_KEY_PROP: Message = Message::new("", "Duplicate key '{{key_value}}' found in JSX elements");

#[derive(Copy, Clone)]
enum InsideArrayOrIterator {
    Array(Span),
    /// Where the name of the method is. For ESLint: the call.
    Iterator(Span),
}

const OUTSIDE_CONTAINING_FUNCTION: u8 = 1 << 0;
const EXPLICIT_RETURN: u8 = 1 << 1;

/// What the walk up for ESLint has come to: the element,
const ELEMENT: u8 = 0;
/// the `?:`, `&&`, `||` or `??` that it is a result of,
const BRANCH: u8 = 1;
/// the `return` of it, or an `if` around that,
const RETURNED: u8 = 2;
/// a block around that, which has to be a branch of an `if`,
const BLOCK: u8 = 3;
/// the function, and the expression that it is.
const FUNCTION: u8 = 4;
const ARGUMENT: u8 = 5;

#[derive(Default)]
pub struct State<'a> {
    in_array_or_iter: AncestorWalk<'a, u8, Option<InsideArrayOrIterator>>,
    within_children_to_array: AncestorMemo<'a, ()>,
    imports: OnceCell<Imports<'a>>,
    /// Where upstream's `isWithinChildrenToArray` changes, in order: twice the end of a call, twice the start plus 1.
    children_to_array_changes: OnceCell<Vec<u64>>,
    pragma: OnceCell<&'a [u8]>,
    checks: Checks,
    is_oxlint: bool,
    /// The file mentions `key`, `toArray`.
    mentions_key: bool,
    mentions_to_array: bool,
}

/// What is asked about the imports of a file.
struct Imports<'a> {
    /// The names under which something is imported from `react`.
    from_react: FxHashSet<Name<'a>>,
    /// The file imports and declares nothing.
    is_bare: bool,
}

impl Rule for JsxKey {
    const META: Meta = Meta::plugin(Plugin::React, "jsx-key", Kind::None).recommended();
    const ON: On = On::new().exprs(&[ExprTag::Jsx, ExprTag::Array]);
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        let (is_given, options) = (options.get(0).is_some_and(|it| it.as_object().is_some()), options.object(0));
        let checks = |default| Checks {
            key_must_before_spread: options.bool_or("checkKeyMustBeforeSpread", default),
            warn_on_duplicates: options.bool_or("warnOnDuplicates", default),
            fragment_shorthand: options.bool_or("checkFragmentShorthand", default),
        };
        // oxlint: without options nothing is on. In an object of options, what is missing is on.
        JsxKey { eslint: checks(false), oxlint: checks(is_given) }
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        let mut on = On::new().exprs(&[ExprTag::Jsx]);
        if self.checks(file).warn_on_duplicates && file.mentions("key") {
            on = on.exprs(&[ExprTag::Array]);
        }
        on
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        let is_oxlint = file.language().is_oxlint;
        if (is_oxlint && !is_jsx(file)) || !file.has_exprs([ExprTag::Jsx]) {
            return None;
        }
        Some(State {
            checks: self.checks(file),
            is_oxlint,
            mentions_key: file.mentions("key"),
            mentions_to_array: file.mentions("toArray"),
            ..State::default()
        })
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        match e.tag() {
            ExprTag::Jsx => check_element_or_fragment(e, cx),
            ExprTag::Array => {
                let is_oxlint = cx.state.is_oxlint;
                if let ExprKind::Array(elements) = e.kind()
                    && (is_oxlint || !cx.state.is_within_children_to_array(cx.file(), e.span()))
                {
                    // oxlint takes what is in parentheses for no element.
                    check_duplicate_keys(&mut elements.iter().filter(|it| !is_oxlint || !it.is_parenthesized()), cx);
                }
            }
            _ => {}
        }
    }
}

impl JsxKey {
    fn checks(&self, file: &File) -> Checks {
        if file.language().is_oxlint { self.oxlint } else { self.eslint }
    }
}

fn check_element_or_fragment<'a>(e: Expr<'a>, cx: &mut Cx<'a, JsxKey>) {
    let ExprKind::Jsx(jsx) = e.kind() else {
        return;
    };
    let (checks, is_oxlint) = (cx.state.checks, cx.state.is_oxlint);
    if jsx.is_fragment() {
        if checks.fragment_shorthand {
            check_missing_key(e, jsx, cx);
        }
        return;
    }
    if !jsx.attrs().iter().any(is_key) {
        check_missing_key(e, jsx, cx);
    } else if checks.key_must_before_spread {
        check_jsx_element_is_key_before_spread(e, jsx, cx);
    }
    if !cx.state.mentions_key || !(checks.warn_on_duplicates || (checks.key_must_before_spread && !is_oxlint)) {
        return;
    }
    let children = || jsx.children().iter().filter(|it| it.jsx_container_span().is_none());
    if !is_oxlint {
        // Upstream goes through all children once for each child that is an element.
        let is_listened = |it: &Expr<'a>| {
            as_jsx_element(*it).is_some() && !cx.state.is_within_children_to_array(cx.file(), it.span())
        };
        let times = children().filter(is_listened).count();
        if times == 0 {
            return;
        }
        if checks.key_must_before_spread {
            let keys: usize = children().filter_map(as_jsx_element).map(count_keys_if_one_is_after_spread).sum();
            for _ in 0..times.saturating_mul(keys) {
                cx.report(e, KEY_BEFORE_SPREAD);
            }
        }
    }
    if checks.warn_on_duplicates {
        check_duplicate_keys(&mut children(), cx);
    }
}

fn is_key(attribute: Prop) -> bool {
    attribute.key().is_some_and(|key| key.is("key"))
}

/// The array or the iterator that `e` is an element of, unless that is within `Children.toArray(..)`.
fn array_or_iterator_of<'a>(e: Expr<'a>, jsx: Jsx<'a>, cx: &mut Cx<'a, JsxKey>) -> Option<InsideArrayOrIterator> {
    if !cx.state.is_oxlint {
        let outer = cx.state.in_array_or_iter.run(Node::Expr(e), ELEMENT, is_element_of_array_or_iter)?;
        // Upstream listens for arrays, calls and fragments.
        let listened = match outer {
            InsideArrayOrIterator::Array(_) if jsx.is_fragment() => e.span(),
            InsideArrayOrIterator::Array(span) | InsideArrayOrIterator::Iterator(span) => span,
        };
        return (!cx.state.is_within_children_to_array(cx.file(), listened)).then_some(outer);
    }
    let outer = cx.state.in_array_or_iter.run(Node::Expr(e), 0, is_in_array_or_iter)?;
    if cx.state.mentions_to_array {
        let State { within_children_to_array, imports, .. } = &mut cx.state;
        if within_children_to_array.find(Node::Expr(e), |_, parent| is_children_to_array(parent, imports)).is_some() {
            return None;
        }
    }
    Some(outer)
}

/// `e`: an element without a `key`, or a fragment.
fn check_missing_key<'a>(e: Expr<'a>, jsx: Jsx<'a>, cx: &mut Cx<'a, JsxKey>) {
    let Some(outer) = array_or_iterator_of(e, jsx, cx) else {
        return;
    };
    if !cx.state.is_oxlint {
        let message = match (outer, jsx.is_fragment()) {
            (InsideArrayOrIterator::Array(_), false) => MISSING_ARRAY_KEY,
            (InsideArrayOrIterator::Array(_), true) => MISSING_ARRAY_KEY_USE_PRAG,
            // `hasProp` ignores the case.
            (InsideArrayOrIterator::Iterator(_), false) if has_jsx_prop_ignore_case(jsx, "key").is_some() => return,
            (InsideArrayOrIterator::Iterator(_), false) => MISSING_ITER_KEY,
            (InsideArrayOrIterator::Iterator(_), true) => MISSING_ITER_KEY_USE_PRAG,
        };
        let report = cx.report(e, message);
        if jsx.is_fragment() {
            report.data("reactPrag", cx.state.pragma(cx.file())).data("fragPrag", get_fragment_from_context(cx.file()));
        }
        return;
    }
    // oxlint points at the name, or at the `<>`.
    let span = jsx.tag().map_or_else(|| jsx.opening_span(), |name| name.span());
    match outer {
        InsideArrayOrIterator::Array(_) => cx.report(span, MISSING_KEY_PROP_FOR_ELEMENT_IN_ARRAY),
        InsideArrayOrIterator::Iterator(iter_span) => cx
            .report(iter_span, MISSING_KEY_PROP_FOR_ELEMENT_IN_ITERATOR)
            .first_label("Iterator starts here.")
            .label(span, "Element generated here."),
    };
}

/// One step of the way up from an element, to where upstream comes down from: `checkArrowFunctionWithJSX`,
/// `checkFunctionsBlockStatement`, `getReturnStatements`.
fn is_element_of_array_or_iter<'a>(
    child: Node<'a>,
    parent: Node<'a>,
    state: u8,
) -> ControlFlow<Option<InsideArrayOrIterator>, u8> {
    let next = match (state, parent) {
        (ELEMENT, Node::Expr(e)) => match e.kind() {
            ExprKind::Array(_) => return ControlFlow::Break(Some(InsideArrayOrIterator::Array(e.span()))),
            ExprKind::Cond { test, .. } => (Node::Expr(test) != child).then_some(BRANCH),
            ExprKind::Binary { op: BinOp::And | BinOp::Or | BinOp::Nullish, right, .. } => {
                (Node::Expr(right) == child).then_some(BRANCH)
            }
            _ => None,
        },
        (ELEMENT | BRANCH, Node::Func(func)) => {
            matches!(func.body(), FnBody::Expr(body) if Node::Expr(body) == child).then_some(FUNCTION)
        }
        (ELEMENT, Node::Stmt(statement)) => (statement.tag() == StmtTag::Return).then_some(RETURNED),
        (RETURNED, Node::Stmt(statement)) => match statement.tag() {
            StmtTag::If => Some(RETURNED),
            StmtTag::Block => Some(BLOCK),
            _ => None,
        },
        (BLOCK, Node::Stmt(statement)) => (statement.tag() == StmtTag::If).then_some(RETURNED),
        (RETURNED, Node::Func(_)) => Some(FUNCTION),
        (FUNCTION, Node::Expr(_)) => Some(ARGUMENT),
        (ARGUMENT, Node::Expr(e)) => return ControlFlow::Break(iterator_of_argument(e, child)),
        _ => None,
    };
    match next {
        Some(next) => ControlFlow::Continue(next),
        None => ControlFlow::Break(None),
    }
}

/// One step of the way up from an element.
fn is_in_array_or_iter<'a>(
    child: Node<'a>,
    parent: Node<'a>,
    state: u8,
) -> ControlFlow<Option<InsideArrayOrIterator>, u8> {
    let is_outside_containing_function = state & OUTSIDE_CONTAINING_FUNCTION != 0;
    match parent {
        Node::Func(func) if as_function(parent).is_some() => {
            let is_returned =
                !func.is_arrow() || state & EXPLICIT_RETURN != 0 || matches!(func.body(), FnBody::Expr(_));
            let is_property = matches!(func.owner(), Node::Expr(e)
                if !e.is_parenthesized() && as_object_property(e.parent()).is_some());
            match is_returned && !is_property && !is_outside_containing_function {
                true => ControlFlow::Continue(state | OUTSIDE_CONTAINING_FUNCTION),
                false => ControlFlow::Break(None),
            }
        }
        Node::Expr(e) => match e.tag() {
            ExprTag::Array => {
                ControlFlow::Break((!is_outside_containing_function).then(|| InsideArrayOrIterator::Array(e.span())))
            }
            ExprTag::Call => ControlFlow::Break(iterator_of_argument(e, child)),
            ExprTag::Jsx => ControlFlow::Break(None),
            _ => ControlFlow::Continue(state),
        },
        Node::Prop(prop) if prop.kind() != PropKind::Spread || prop.is_jsx_attribute() => ControlFlow::Break(None),
        Node::Stmt(statement) if statement.tag() == StmtTag::Return => ControlFlow::Continue(state | EXPLICIT_RETURN),
        _ => ControlFlow::Continue(state),
    }
}

/// `argument` is what `a.map(..)`, `a.flatMap(..)` or `Array.from(a, ..)` calls for each element.
fn iterator_of_argument<'a>(e: Expr<'a>, argument: Node<'a>) -> Option<InsideArrayOrIterator> {
    let call = e.as_call()?;
    let callee = Some(call.callee()).filter(|it| !it.is_chain_root())?;
    let (span, target_arg_index) = if e.file().language().is_oxlint {
        let (span, name) = static_property_info(callee)?;
        match name.bytes() {
            b"from" => (span, 1),
            b"map" | b"flatMap" => (span, 0),
            _ => return None,
        }
    } else if is_member_called(callee, "map") {
        (e.span(), 0)
    } else if is_member_called(callee, "from") {
        (e.span(), 1)
    } else {
        return None;
    };
    (Node::Expr(call.args().get(target_arg_index)?) == argument).then_some(InsideArrayOrIterator::Iterator(span))
}

impl<'a> State<'a> {
    fn pragma(&self, file: &'a File<'a>) -> &'a [u8] {
        *self.pragma.get_or_init(|| get_from_context(file))
    }

    /// `childrenToArraySelector`
    fn matches_children_to_array_selector(&self, call: Expr<'a>) -> bool {
        let Some(object) = call.callee().filter(|it| is_member_called(*it, "toArray")).and_then(Expr::object) else {
            return false;
        };
        // What has no name is called `undefined` for esquery.
        let name_of = |it: Expr<'a>| it.as_ident().map_or(&b"undefined"[..], Name::bytes);
        object.is_ident("Children")
            || (is_member_called(object, "Children")
                && object.object().is_some_and(|it| name_of(it) == self.pragma(call.file())))
    }

    /// Upstream's `isWithinChildrenToArray` when ESLint enters `node`: it is set where such a call is entered, and
    /// reset where one is left, also inside of another.
    fn is_within_children_to_array(&self, file: &'a File<'a>, node: Span) -> bool {
        let changes = self.children_to_array_changes.get_or_init(|| {
            let mut changes = Vec::new();
            for call in file.exprs_of_kind(ExprTag::Call).filter(|it| self.matches_children_to_array_selector(*it)) {
                changes.extend([u64::from(call.span().start) * 2 + 1, u64::from(call.span().end) * 2]);
            }
            sort::sort_unstable(&mut changes);
            changes
        });
        let before = changes.partition_point(|it| *it <= u64::from(node.start) * 2);
        before.checked_sub(1).and_then(|last| changes.get(last)).is_some_and(|it| it % 2 == 1)
    }
}

/// `Children.toArray(..)`, `React.Children.toArray(..)`
fn is_children_to_array<'a>(node: Node<'a>, imports: &OnceCell<Imports<'a>>) -> Option<()> {
    let call = node.as_expr()?.as_call()?;
    (is_to_array(call) && is_children(call, imports.get_or_init(|| Imports::new(node.file())))).then_some(())
}

fn is_to_array(call: Call) -> bool {
    callee_name(call).is_some_and(|subject| subject.is("toArray"))
}

impl<'a> Imports<'a> {
    fn new(file: &'a File<'a>) -> Self {
        let mut from_react = FxHashSet::default();
        for statement in file.stmts_of_kind(StmtTag::Import) {
            if let StmtKind::Import(import) = statement.kind()
                && import.spec().is("react")
            {
                from_react.extend(import.default().into_iter().chain(import.namespace()).map(|it| it.name()));
                from_react.extend(import.named().iter().map(|it| it.local().name()));
            }
        }
        let requests_modules = file.has_stmts([StmtTag::Import, StmtTag::ExportStar])
            || file
                .stmts_of_kind(StmtTag::ExportNamed)
                .any(|it| matches!(it.kind(), StmtKind::ExportNamed(export) if export.has_from()));
        let is_bare = !requests_modules && file.top_level_scope().symbols().all(Symbol::is_implicit_arguments);
        Imports { from_react, is_bare }
    }

    /// An import from `react` is called `actual_local_name` here.
    fn import_matcher(&self, actual_local_name: Name<'a>) -> bool {
        self.from_react.contains(&actual_local_name)
    }

    /// In a file that imports and declares nothing, `React` is React.
    fn is_import(&self, actual_local_name: Name<'a>) -> bool {
        if self.is_bare { actual_local_name.is("React") } else { self.import_matcher(actual_local_name) }
    }
}

fn is_children_from_react<'a>(ident: Expr<'a>, imports: &Imports<'a>) -> bool {
    let Some(name) = ident.as_ident() else {
        return false;
    };
    if imports.import_matcher(name) {
        return true;
    }
    // `const { Children } = React;`
    if name.is("Children")
        && let Some(Node::VarDecl(declarator)) =
            ident.symbol().and_then(|it| it.declarations().next()).and_then(Declaration::node)
        && let Some(init) = declarator.init().filter(|it| !it.is_parenthesized())
        && let Some(init) = init.as_ident()
    {
        return imports.import_matcher(init);
    }
    false
}

fn is_children<'a>(call: Call<'a>, imports: &Imports<'a>) -> bool {
    let Some(object) = as_member_expression(call.callee()).and_then(Expr::object) else {
        return false;
    };
    if object.tag() == ExprTag::Ident && !object.is_parenthesized() {
        return is_children_from_react(object, imports);
    }
    let inner_member = get_inner_expression(object);
    if !matches!(inner_member.tag(), ExprTag::Dot | ExprTag::Index) || inner_member.is_chain_root() {
        return false;
    }
    static_property_name(inner_member).is_some_and(|name| name.is("Children"))
        && (inner_member.object().and_then(|it| get_inner_expression(it).as_ident()))
            .is_some_and(|name| imports.is_import(name))
}

/// How many `key`s an element has for which `isKeyAfterSpread` holds, else 0.
fn count_keys_if_one_is_after_spread(jsx: Jsx) -> usize {
    match jsx.attrs().iter().skip_while(|it| it.kind() != PropKind::Spread).any(is_key) {
        true => jsx.attrs().iter().filter(|it| is_key(*it)).count(),
        false => 0,
    }
}

fn check_jsx_element_is_key_before_spread<'a>(e: Expr<'a>, jsx: Jsx<'a>, cx: &mut Cx<'a, JsxKey>) {
    if !cx.state.is_oxlint {
        let keys = count_keys_if_one_is_after_spread(jsx);
        if keys == 0 {
            return;
        }
        // Upstream reports the array, once for each `key`, or the element of the iterator.
        let (at, times) = match array_or_iterator_of(e, jsx, cx) {
            Some(InsideArrayOrIterator::Array(array)) => (array, keys),
            Some(InsideArrayOrIterator::Iterator(_)) => (e.span(), 1),
            None => return,
        };
        for _ in 0..times {
            cx.report(at, KEY_BEFORE_SPREAD);
        }
        return;
    }
    let (mut key, mut has_spread) = (None, false);
    for attribute in jsx.attrs() {
        if attribute.kind() == PropKind::Spread {
            // A `key` before it is in the right place.
            if key.is_some() {
                return;
            }
            has_spread = true;
        } else if is_key(attribute) {
            key = attribute.key();
            if has_spread {
                break;
            }
        }
    }
    if let (Some(key), true) = (key, has_spread) {
        cx.report(key.span(cx.file()), KEY_PROP_MUST_BE_PLACED_BEFORE_SPREAD);
    }
}

/// The value of the first `key` of an element that is a string or a number, and the attribute.
fn get_jsx_element_key_value(e: Expr<'_>) -> Option<(Cow<'_, [u8]>, Prop<'_>)> {
    as_jsx_element(e)?.attrs().iter().filter(|it| is_key(*it)).find_map(|attribute| {
        let value = match get_prop_value(attribute)? {
            AttributeValue::StringLiteral(literal) => Cow::Borrowed(literal.value),
            AttributeValue::ExpressionContainer(e) if !e.is_parenthesized() => match e.kind() {
                ExprKind::String(value) => Cow::Borrowed(value.bytes()),
                ExprKind::Number(value) => Cow::Owned(value.to_string().into_bytes()),
                ExprKind::Template(template) if template.quasi_count() == 1 => Cow::Borrowed(template.raw(0)),
                _ => return None,
            },
            _ => return None,
        };
        Some((value, attribute))
    })
}

/// `getText(context, attr.value)`. Empty without a value, where upstream has the text of the file.
fn text_of_value(attribute: Prop<'_>) -> &[u8] {
    let span = attribute.value().map(|it| it.jsx_container_span().unwrap_or_else(|| it.span()));
    span.map(|it| attribute.file().slice(it)).unwrap_or_default()
}

/// `elements`: of an array, or the children of an element.
fn check_duplicate_keys<'a>(elements: &mut dyn Iterator<Item = Expr<'a>>, cx: &Cx<'a, JsxKey>) {
    let is_oxlint = cx.state.is_oxlint;
    let mut keys: SmallVec<[(Cow<'a, [u8]>, Prop<'a>); 4]> = SmallVec::new();
    for element in elements.filter(|it| it.tag() == ExprTag::Jsx) {
        if is_oxlint {
            keys.extend(get_jsx_element_key_value(element));
        } else if let Some(jsx) = as_jsx_element(element) {
            // Upstream compares the texts of all of them.
            let attributes = jsx.attrs().iter().filter(|it| is_key(*it));
            keys.extend(attributes.map(|it| (Cow::Borrowed(text_of_value(it)), it)));
        }
    }
    if keys.len() < 2 {
        return;
    }
    let (mut seen_keys, mut repeated) = (FxHashSet::default(), FxHashSet::default());
    for (key_value, attribute) in &keys {
        if seen_keys.insert(&**key_value) {
            continue;
        }
        if is_oxlint {
            cx.report(attribute, DUPLICATE_KEY_PROP).data("key_value", key_value.clone());
        } else {
            repeated.insert(&**key_value);
        }
    }
    // Upstream reports the first one too.
    for (_, attribute) in keys.iter().filter(|it| repeated.contains(&*it.0)) {
        cx.report(attribute, NON_UNIQUE_KEYS);
    }
}
