use crate::a11y::{is_hidden_from_screen_reader, object_has_accessible_child};
use crate::jsx::{Child, as_jsx_element, children, get_element_type, get_jsx_attribute_name, has_jsx_prop_ignore_case};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforce that anchors have content and that the content is accessible to screen readers.
pub struct AnchorHasContent {
    /// Besides `a`.
    components: Vec<String>,
}

const MISSING_CONTENT: Message = Message::new("", "Missing accessible content when using `a` elements.");

impl Rule for AnchorHasContent {
    // oxlint declares a suggestion. What it makes is a fix.
    const META: Meta = Meta::oxlint(Plugin::JsxA11y, "anchor-has-content", Kind::Problem).fixable(Fixable::Code);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        AnchorHasContent { components: options.object(0).strings("components").into_iter().map(String::from).collect() }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Jsx], |rule, e, cx| {
            let Some(jsx_el) = as_jsx_element(e) else {
                return;
            };
            let name = get_element_type(cx.file(), jsx_el);
            if *name != *b"a" && !rule.components.iter().any(|it| *it.as_bytes() == *name) {
                return;
            }
            if is_hidden_from_screen_reader(cx.file(), jsx_el)
                || object_has_accessible_child(cx.file(), jsx_el)
                || has_jsx_prop_ignore_case(jsx_el, "title").is_some()
                || has_jsx_prop_ignore_case(jsx_el, "aria-label").is_some()
                || is_component_prop(e)
            {
                return;
            }
            cx.report(e, MISSING_CONTENT).fix(|fixer| {
                let mut all = children(fixer.file(), jsx_el);
                match (all.next(), all.next()) {
                    (Some(Child::Element(child)), None) => remove_hidden_attributes(child, fixer),
                    _ => Vec::new(),
                }
            });
        });
    }
}

/// It is all that is in the braces of an attribute of a component, which can give it content: `<Button render={<a />} />`.
fn is_component_prop(e: Expr) -> bool {
    let Node::Prop(attribute) = e.parent() else {
        return false;
    };
    // oxc's `IdentifierReference` and `MemberExpression`
    let is_component = |tag: Expr| match tag.kind() {
        ExprKind::Ident(name) => !name.bytes().first().is_some_and(u8::is_ascii_lowercase),
        ExprKind::Dot { .. } => true,
        _ => false,
    };
    e.jsx_container_span().is_some()
        && attribute.kind() != PropKind::Spread
        && matches!(e.parent().parent(), Node::Expr(element) if as_jsx_element(element).and_then(Jsx::tag).is_some_and(is_component))
}

fn remove_hidden_attributes(element: Jsx, fixer: Fixer) -> Vec<Fix> {
    let is_hidden = |name: &[u8]| name.eq_ignore_ascii_case(b"aria-hidden") || name.eq_ignore_ascii_case(b"hidden");
    let hidden = element.attrs().iter().filter(|attr| get_jsx_attribute_name(*attr).is_some_and(is_hidden));
    hidden.map(|attr| fixer.remove(attr)).collect()
}
