use crate::jsx::{as_jsx_element, get_element_type};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforces that no distracting elements are used.
pub struct NoDistractingElements {
    check_marquee: bool,
    check_blink: bool,
}

const NO_DISTRACTING_ELEMENTS: Message = Message::new(
    "",
    "Do not use `<{{element}}>` elements as they can create visual accessibility issues and are deprecated.",
);

impl Rule for NoDistractingElements {
    const META: Meta = Meta::oxlint(Plugin::JsxA11y, "no-distracting-elements", Kind::Problem);
    const ON: On = On::new().exprs(&[ExprTag::Jsx]);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let elements = options.object(0).get("elements").and_then(Json::as_array);
        let checks = |name: &[u8]| elements.is_none_or(|all| all.iter().any(|it| it.as_str() == Some(name)));
        NoDistractingElements { check_marquee: checks(b"marquee"), check_blink: checks(b"blink") }
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<()> {
        if !self.check_marquee && !self.check_blink {
            return None;
        }
        Some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(jsx_el) = as_jsx_element(e) else {
            return;
        };
        let element = match &*get_element_type(cx.file(), jsx_el) {
            b"marquee" if self.check_marquee => "marquee",
            b"blink" if self.check_blink => "blink",
            _ => return,
        };
        if let Some(name) = jsx_el.tag() {
            cx.report(name, NO_DISTRACTING_ELEMENTS).data("element", element);
        }
    }
}
