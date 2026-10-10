use crate::jsx::is_jsx_fragment;
use crate::react::is_jsx;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforces the shorthand or standard form for React Fragments.
pub struct JsxFragments {
    /// `"element"`, not `"syntax"`
    prefers_element: bool,
}

const PREFER_ELEMENT: Message = Message::new("", "Standard form for React fragments is preferred.");
const PREFER_SYNTAX: Message = Message::new("", "Shorthand form for React fragments is preferred.");

impl Rule for JsxFragments {
    const META: Meta = Meta::oxlint(Plugin::React, "jsx-fragments", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().exprs(&[ExprTag::Jsx]);
    type State<'a> = ();

    /// `"element"` or `{ mode: "element" }`
    fn new(options: &Options) -> Self {
        JsxFragments { prefers_element: options.str(0).or_else(|| options.object(0).str("mode")) == Some("element") }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        is_jsx(file).then_some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Jsx(jsx) = e.kind() else {
            return;
        };
        let (opening, Some(closing)) = (jsx.opening_span(), jsx.closing_span()) else {
            return;
        };
        match jsx.tag() {
            None if self.prefers_element => {
                cx.report(opening, PREFER_ELEMENT).fix(|fixer| {
                    [fixer.replace(opening, "<React.Fragment>"), fixer.replace(closing, "</React.Fragment>")]
                });
            }
            Some(name) if !self.prefers_element && is_jsx_fragment(jsx) && jsx.attrs().is_empty() => {
                cx.report(name, PREFER_SYNTAX)
                    .fix(|fixer| [fixer.replace(opening, "<>"), fixer.replace(closing, "</>")]);
            }
            _ => {}
        }
    }
}
