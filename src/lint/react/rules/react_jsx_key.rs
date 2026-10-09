use bun_lint_oxlint::ast_util::{
    as_function, as_member_expression, as_object_property, callee_name, get_inner_expression, static_property_info,
    static_property_name,
};
use crate::jsx::{AttributeValue, as_jsx_element, get_prop_value};
use crate::react::{AncestorWalk, is_jsx};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use rustc_hash::FxHashSet;
use smallvec::SmallVec;
use std::borrow::Cow;
use std::cell::OnceCell;
use std::ops::ControlFlow;

/// Enforce `key` prop for elements in an array.
pub struct JsxKey {
    check_key_must_before_spread: bool,
    warn_on_duplicates: bool,
    check_fragment_shorthand: bool,
}

const MISSING_KEY_PROP_FOR_ELEMENT_IN_ARRAY: Message = Message::new("", "Missing \"key\" prop for element in array.");
const MISSING_KEY_PROP_FOR_ELEMENT_IN_ITERATOR: Message =
    Message::new("", "Missing \"key\" prop for element in iterator.");
const KEY_PROP_MUST_BE_PLACED_BEFORE_SPREAD: Message =
    Message::new("", "\"key\" prop must be placed before any `{...spread}`");
const DUPLICATE_KEY_PROP: Message = Message::new("", "Duplicate key '{{key_value}}' found in JSX elements");

#[derive(Copy, Clone)]
enum InsideArrayOrIterator {
    Array,
    /// Where the name of the method is.
    Iterator(Span),
}

const OUTSIDE_CONTAINING_FUNCTION: u8 = 1 << 0;
const EXPLICIT_RETURN: u8 = 1 << 1;

#[derive(Default)]
pub struct State<'a> {
    in_array_or_iter: AncestorWalk<'a, u8, Option<InsideArrayOrIterator>>,
    within_children_to_array: AncestorMemo<'a, ()>,
    imports: OnceCell<Imports<'a>>,
}

/// What is asked about the imports of a file.
struct Imports<'a> {
    /// The names under which something is imported from `react`.
    from_react: FxHashSet<Name<'a>>,
    /// The file imports and declares nothing.
    is_bare: bool,
}

impl Rule for JsxKey {
    const META: Meta = Meta::oxlint(Plugin::React, "jsx-key", Kind::Problem);
    type State<'a> = State<'a>;

    /// Without options nothing is on. In an object of options, what is missing is on.
    fn new(options: &Options) -> Self {
        let (is_given, options) = (options.get(0).is_some_and(|it| it.as_object().is_some()), options.object(0));
        JsxKey {
            check_key_must_before_spread: is_given && options.bool_or("checkKeyMustBeforeSpread", true),
            warn_on_duplicates: is_given && options.bool_or("warnOnDuplicates", true),
            check_fragment_shorthand: is_given && options.bool_or("checkFragmentShorthand", true),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> Self::State<'a> {
        if !is_jsx(file) || !file.has_exprs([ExprTag::Jsx]) {
            return State::default();
        }
        on.exprs([ExprTag::Jsx], |rule, e, cx| {
            let ExprKind::Jsx(jsx) = e.kind() else {
                return;
            };
            let Some(name) = jsx.tag() else {
                if rule.check_fragment_shorthand {
                    check_missing_key(e, jsx.opening_span(), cx);
                }
                return;
            };
            if !jsx.attrs().iter().any(is_key) {
                check_missing_key(e, name.span(), cx);
            }
            if rule.check_key_must_before_spread {
                check_jsx_element_is_key_before_spread(jsx, cx);
            }
            if rule.warn_on_duplicates && cx.mentions("key") {
                check_duplicate_keys(&mut jsx.children().iter().filter(|it| it.jsx_container_span().is_none()), cx);
            }
        });
        if self.warn_on_duplicates && file.mentions("key") {
            on.exprs([ExprTag::Array], |_, e, cx| {
                if let ExprKind::Array(elements) = e.kind() {
                    check_duplicate_keys(&mut elements.iter().filter(|it| !it.is_parenthesized()), cx);
                }
            });
        }
        State::default()
    }
}

fn is_key(attribute: Prop) -> bool {
    attribute.key().is_some_and(|key| key.is("key"))
}

/// `e`: an element without a `key`, or a fragment. `span`: its name, or the `<>`.
fn check_missing_key<'a>(e: Expr<'a>, span: Span, cx: &mut Cx<'a, JsxKey>) {
    let Some(outer) = cx.state.in_array_or_iter.run(Node::Expr(e), 0, is_in_array_or_iter) else {
        return;
    };
    if cx.mentions("toArray") {
        let State { within_children_to_array, imports, .. } = &mut cx.state;
        if within_children_to_array.find(Node::Expr(e), |_, parent| is_children_to_array(parent, imports)).is_some() {
            return;
        }
    }
    match outer {
        InsideArrayOrIterator::Array => cx.report(span, MISSING_KEY_PROP_FOR_ELEMENT_IN_ARRAY),
        InsideArrayOrIterator::Iterator(iter_span) => cx.report(iter_span, MISSING_KEY_PROP_FOR_ELEMENT_IN_ITERATOR),
    };
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
                ControlFlow::Break((!is_outside_containing_function).then_some(InsideArrayOrIterator::Array))
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
fn iterator_of_argument<'a>(call: Expr<'a>, argument: Node<'a>) -> Option<InsideArrayOrIterator> {
    let call = call.as_call()?;
    let callee = Some(call.callee()).filter(|it| !it.is_chain_root())?;
    let (span, name) = static_property_info(callee)?;
    let target_arg_index = match name.bytes() {
        b"from" => 1,
        b"map" | b"flatMap" => 0,
        _ => return None,
    };
    (Node::Expr(call.args().get(target_arg_index)?) == argument).then_some(InsideArrayOrIterator::Iterator(span))
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

fn check_jsx_element_is_key_before_spread<'a>(jsx: Jsx<'a>, cx: &Cx<'a, JsxKey>) {
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

/// `elements`: of an array, or the children of an element.
fn check_duplicate_keys<'a>(elements: &mut dyn Iterator<Item = Expr<'a>>, cx: &Cx<'a, JsxKey>) {
    let keys: SmallVec<[(Cow<'a, [u8]>, Prop<'a>); 4]> =
        elements.filter(|it| it.tag() == ExprTag::Jsx).filter_map(get_jsx_element_key_value).collect();
    if keys.len() < 2 {
        return;
    }
    let mut seen_keys = FxHashSet::default();
    for (key_value, attribute) in &keys {
        if !seen_keys.insert(&**key_value) {
            cx.report(attribute, DUPLICATE_KEY_PROP).data("key_value", key_value.clone());
        }
    }
}
