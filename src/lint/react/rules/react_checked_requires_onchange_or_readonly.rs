use bun_lint_oxlint::ast_util::static_name;
use crate::jsx::{as_jsx_element, get_element_type};
use crate::react::is_create_element_call;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforce using `onChange` or `readOnly` attributes when `checked` is used on an `<input>` field.
pub struct CheckedRequiresOnchangeOrReadonly {
    ignore_missing_properties: bool,
    ignore_exclusive_checked_attribute: bool,
}

const MISSING_PROPERTY: Message = Message::new("", "`checked` should be used with either `onChange` or `readOnly`.");
const EXCLUSIVE_CHECKED_ATTRIBUTE: Message =
    Message::new("", "Use either `checked` or `defaultChecked`, but not both.");

impl Rule for CheckedRequiresOnchangeOrReadonly {
    const META: Meta = Meta::oxlint(Plugin::React, "checked-requires-onchange-or-readonly", Kind::Suggestion);
    const ON: On = On::new().exprs(&[ExprTag::Jsx, ExprTag::Call]);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        CheckedRequiresOnchangeOrReadonly {
            ignore_missing_properties: options.bool_or("ignoreMissingProperties", false),
            ignore_exclusive_checked_attribute: options.bool_or("ignoreExclusiveCheckedAttribute", false),
        }
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        let on = On::new().exprs(&[ExprTag::Jsx]);
        if !file.mentions("createElement") {
            return on;
        }
        on.exprs(&[ExprTag::Call])
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        file.mentions("checked").then_some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        match e.tag() {
            ExprTag::Jsx => {
                if let Some(jsx) = as_jsx_element(e)
                    && !jsx.attrs().is_empty()
                    && *get_element_type(cx.file(), jsx) == *b"input"
                {
                    // The last `checked` counts.
                    self.check(&mut jsx.attrs().iter().filter_map(|it| Some((it, it.key()?.name()?))), true, cx);
                }
            }
            ExprTag::Call => self.call(e, cx),
            _ => {}
        }
    }
}

impl CheckedRequiresOnchangeOrReadonly {
    fn call<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if let Some(call) = e.as_call()
            && is_create_element_call(call)
            && call
                .args()
                .first()
                .is_some_and(|it| it.as_string().is_some_and(|it| it.is("input")) && !it.is_parenthesized())
            && let Some(ExprKind::Object(properties)) =
                call.args().get(1).filter(|it| !it.is_parenthesized()).map(Expr::kind)
        {
            let mut props = properties.iter().filter_map(|it| Some((it, it.key().and_then(static_name)?)));
            self.check(&mut props, false, cx);
        }
    }

    /// `props`: the attributes or the properties, with their names.
    fn check<'a>(
        &self,
        props: &mut dyn Iterator<Item = (Prop<'a>, Name<'a>)>,
        last_checked_counts: bool,
        cx: &Cx<'a, Self>,
    ) {
        let (mut checked, mut default_checked, mut is_missing_property) = (None, None, true);
        for (prop, name) in props {
            match name.bytes() {
                b"checked" if last_checked_counts || checked.is_none() => checked = Some(prop),
                b"defaultChecked" if default_checked.is_none() => default_checked = Some(prop),
                b"onChange" | b"readOnly" => is_missing_property = false,
                _ => {}
            }
        }
        let Some(checked) = checked else {
            return;
        };
        if !self.ignore_exclusive_checked_attribute
            && let Some(default_checked) = default_checked
        {
            cx.report(checked, EXCLUSIVE_CHECKED_ATTRIBUTE).label(default_checked, "");
        }
        if !self.ignore_missing_properties && is_missing_property {
            cx.report(checked, MISSING_PROPERTY);
        }
    }
}
