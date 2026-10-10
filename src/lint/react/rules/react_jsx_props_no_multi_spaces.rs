use crate::jsx::get_jsx_element_name;
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use std::borrow::Cow;

/// Disallow multiple spaces between inline JSX props
pub struct JsxPropsNoMultiSpaces;

const NO_LINE_GAP: Message = Message::new("noLineGap", "Expected no line gap between “{{prop1}}” and “{{prop2}}”");
const ONLY_ONE_SPACE: Message =
    Message::new("onlyOneSpace", "Expected only one space between “{{prop1}}” and “{{prop2}}”");

impl Rule for JsxPropsNoMultiSpaces {
    const META: Meta = Meta::plugin(Plugin::React, "jsx-props-no-multi-spaces", Kind::None).fixable(Fixable::Code);
    const ON: On = On::new().exprs(&[ExprTag::Jsx]);
    no_state!();

    fn new(_: &Options) -> Self {
        JsxPropsNoMultiSpaces
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Jsx(jsx) = e.kind() else {
            return;
        };
        let (Some(name), Some(_)) = (jsx.tag(), jsx.attrs().first()) else {
            return;
        };
        // `getGenericNode`
        let mut prev_span = jsx.type_args().angle_brackets_span().unwrap_or_else(|| name.span());
        let mut prev = None;
        for node in jsx.attrs() {
            let span = node.span();
            let between = prev_span.between(span);
            if cx.slice(between) != b" " {
                check_spacing(jsx, prev, between, node, cx);
            }
            (prev, prev_span) = (Some(node), span);
        }
    }
}

/// `checkSpacing`. `prev` is `None` for what is before the first attribute, and `between` is not one space.
fn check_spacing<'a>(
    jsx: Jsx<'a>,
    prev: Option<Prop<'a>>,
    between: Span,
    node: Prop<'a>,
    cx: &Cx<'a, JsxPropsNoMultiSpaces>,
) {
    let file = cx.file();
    let report = |message| {
        cx.report(node, message)
            .listened_on(jsx.opening_span())
            .data("prop1", get_prop_name(jsx, prev))
            .data("prop2", get_prop_name(jsx, Some(node)))
    };
    // A name with type arguments is a copy of the opening element with another `range`: its `loc` ends with the tag.
    let is_generic = prev.is_none() && jsx.type_args().first().is_some();
    // 2 for more as well.
    let line_breaks = strings::js_lines(file.slice(between)).skip(1).take(2).count();
    if line_breaks == 2 && has_empty_lines(file, between, is_generic) {
        report(NO_LINE_GAP);
    }
    // Whether both end on one line.
    let is_on_one_line = match is_generic {
        true => ast_utils::is_on_one_line(file, Span::after(node.span(), jsx.opening_span().end)),
        false => line_breaks == 0 && ast_utils::is_on_one_line(file, node.span()),
    };
    if is_on_one_line {
        report(ONLY_ONE_SPACE).fix(|fixer| fixer.replace(between, " "));
    }
}

/// `hasEmptyLines` of what is around `between`, in which there is nothing but blanks and comments.
fn has_empty_lines<'a>(file: &'a File<'a>, between: Span, is_generic: bool) -> bool {
    // Nothing starts two lines after the end of the tag.
    let (mut prev, mut can_be_far) = (Span::empty(between.start), !is_generic);
    for comment in file.comments_in(between) {
        if can_be_far && has_two_line_breaks(file, prev.between(comment.span())) {
            return true;
        }
        (prev, can_be_far) = (comment.span(), true);
    }
    can_be_far && has_two_line_breaks(file, Span::after(prev, between.end))
}

fn has_two_line_breaks(file: &File<'_>, span: Span) -> bool {
    strings::js_lines(file.slice(span)).nth(2).is_some()
}

/// `getPropName`. `None`: of what is before the first attribute.
fn get_prop_name<'a>(jsx: Jsx<'a>, prop_node: Option<Prop<'a>>) -> Cow<'a, [u8]> {
    // The name of a `JSXNamespacedName` is a node.
    const NODE: &[u8] = b"[object Object]";
    let Some(prop_node) = prop_node else {
        let is_generic = jsx.type_args().first().is_some();
        return match jsx.tag().map(Expr::kind) {
            // The opening element has a name, which has none.
            Some(ExprKind::Dot { .. }) if is_generic => Cow::Borrowed(b"undefined".as_slice()),
            Some(ExprKind::String(name)) => Cow::Borrowed(match strings::split_once_char(name.bytes(), b':') {
                Some(_) if is_generic => NODE,
                Some((_, local)) => local,
                None => name.bytes(),
            }),
            _ => get_jsx_element_name(jsx),
        };
    };
    Cow::Borrowed(match prop_node.key().and_then(Key::name) {
        Some(name) if strings::contains_char(name.bytes(), b':') => NODE,
        Some(name) => name.bytes(),
        None => prop_node.value().map(Expr::text).unwrap_or_default(),
    })
}
