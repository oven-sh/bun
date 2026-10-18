use crate::a11y::HTML_TAG;
use bun_lint_oxlint::ast_util::get_inner_expression;
use crate::jsx::{
    AttributeValue, as_jsx_element, get_element_type, get_prop_value, get_string_literal_prop_value, has_jsx_prop,
    has_jsx_prop_ignore_case,
};
use bun_lint_oxlint::text::contains_name;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::ancestor_memo::AncestorMemo;

/// Enforce that `autoFocus` prop is not used on elements.
pub struct NoAutofocus {
    ignore_non_dom: bool,
}

const NO_AUTOFOCUS: Message = Message::new(
    "",
    "The `autoFocus` attribute is found here, which can cause usability issues for sighted and non-sighted users.",
);
const REMOVE: Message = Message::new("", "Remove the `autoFocus` attribute.");

impl Rule for NoAutofocus {
    const META: Meta = Meta::oxlint(Plugin::JsxA11y, "no-autofocus", Kind::Problem).has_suggestions();
    const ON: On = On::new().exprs(&[ExprTag::Jsx]);
    /// Whether something is in a dialog or a popover.
    type State<'a> = AncestorMemo<'a, ()>;

    fn new(options: &Options) -> Self {
        NoAutofocus { ignore_non_dom: options.object(0).bool_or("ignoreNonDOM", false) }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        file.mentions("autoFocus").then(AncestorMemo::default)
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(jsx_el) = as_jsx_element(e) else {
            return;
        };
        let Some(attr) = has_jsx_prop(jsx_el, "autoFocus") else {
            return;
        };
        if get_prop_value(attr).is_some_and(is_false_attribute_value)
            || self.ignore_non_dom && !contains_name(&HTML_TAG, &get_element_type(cx.file(), jsx_el))
        {
            return;
        }
        let file = cx.file();
        let decide = |_, parent: Node<'a>| {
            parent.as_expr().and_then(as_jsx_element).filter(|it| is_dialog_or_popover(file, *it)).map(|_| ())
        };
        if cx.state.find(Node::Expr(e), decide).is_none() {
            cx.report(attr, NO_AUTOFOCUS).suggest(REMOVE, |fixer| fixer.remove(attr));
        }
    }
}

fn is_dialog_or_popover<'a>(file: &'a File<'a>, opening: Jsx<'a>) -> bool {
    *get_element_type(file, opening) == *b"dialog"
        || has_jsx_prop_ignore_case(opening, "popover").is_some()
        || has_jsx_prop_ignore_case(opening, "role").and_then(get_string_literal_prop_value).is_some_and(|it| it == b"dialog")
}

/// `"false"`, `{false}`, `{"false"}`, `` {`false`} ``
fn is_false_attribute_value(value: AttributeValue) -> bool {
    match value {
        AttributeValue::StringLiteral(literal) => literal.value == b"false",
        _ => value.as_expression().is_some_and(|e| match get_inner_expression(e).kind() {
            ExprKind::False => true,
            ExprKind::String(value) => value.is("false"),
            ExprKind::Template(template) => template.as_static().is_some_and(|cooked| cooked.is("false")),
            _ => false,
        }),
    }
}
