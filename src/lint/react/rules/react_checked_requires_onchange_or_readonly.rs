use crate::jsx::{as_jsx_element, get_element_type, get_jsx_attribute_name};
use crate::react::is_create_element_call;
use crate::util_ast::name_of_key;
use crate::util_is_create_element::is_create_element;
use crate::util_pragma::get_from_context;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint_oxlint::ast_util::static_name;

/// Enforce using `onChange` or `readonly` attribute when `checked` is used.
pub struct CheckedRequiresOnchangeOrReadonly {
    ignore_missing_properties: bool,
    ignore_exclusive_checked_attribute: bool,
}

const MISSING_PROPERTY: Message =
    Message::new("missingProperty", "`checked` should be used with either `onChange` or `readOnly`.");
const EXCLUSIVE_CHECKED_ATTRIBUTE: Message =
    Message::new("exclusiveCheckedAttribute", "Use either `checked` or `defaultChecked`, but not both.");
const OXLINT_MISSING_PROPERTY: Message =
    Message::new("", "`checked` should be used with either `onChange` or `readOnly`.");
const OXLINT_EXCLUSIVE_CHECKED_ATTRIBUTE: Message =
    Message::new("", "Use either `checked` or `defaultChecked`, but not both.");

impl Rule for CheckedRequiresOnchangeOrReadonly {
    const META: Meta = Meta::plugin(Plugin::React, "checked-requires-onchange-or-readonly", Kind::Suggestion);
    const ON: On = On::new().exprs(&[ExprTag::Jsx, ExprTag::Call]);
    /// The pragma. oxlint knows none.
    type State<'a> = &'a [u8];

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

    fn start<'a>(&self, file: &'a File<'a>) -> Option<&'a [u8]> {
        let needs_pragma = !file.language().is_oxlint && file.mentions("createElement");
        file.mentions("checked").then(|| if needs_pragma { get_from_context(file) } else { &b""[..] })
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        match e.tag() {
            ExprTag::Jsx => self.jsx(e, cx),
            ExprTag::Call => self.call(e, cx),
            _ => {}
        }
    }
}

impl CheckedRequiresOnchangeOrReadonly {
    fn jsx<'a>(&self, e: Expr<'a>, cx: &Cx<'a, Self>) {
        let Some(jsx) = as_jsx_element(e).filter(|jsx| !jsx.attrs().is_empty()) else {
            return;
        };
        // oxlint asks the settings of jsx-a11y what kind of element it is.
        let is_input = match cx.language().is_oxlint {
            true => *get_element_type(cx.file(), jsx) == *b"input",
            false => jsx.tag().is_some_and(|it| it.is_ident("input")),
        };
        if is_input {
            // For oxlint the last `checked` counts.
            let mut props = jsx.attrs().iter().filter_map(|it| Some((it, get_jsx_attribute_name(it)?)));
            self.check_attributes_and_report(jsx.opening_span(), &mut props, true, cx);
        }
    }

    fn call<'a>(&self, e: Expr<'a>, cx: &Cx<'a, Self>) {
        let Some(call) = e.as_call() else {
            return;
        };
        let is_oxlint = cx.language().is_oxlint;
        // oxlint has a node for parentheses.
        let is_seen = |it: &Expr<'a>| !is_oxlint || !it.is_parenthesized();
        let arguments = call.args();
        if !arguments.first().filter(is_seen).and_then(Expr::as_string).is_some_and(|it| it.is("input")) {
            return;
        }
        // oxlint takes the `createElement` of everything but `document`.
        let is_creation = match is_oxlint {
            true => is_create_element_call(call),
            false => is_create_element(e, cx.state),
        };
        if is_creation && let Some(ExprKind::Object(properties)) = arguments.get(1).filter(is_seen).map(Expr::kind) {
            // oxlint: also `"checked"`, and not `[checked]`.
            let name_of = |key: Key<'a>| match is_oxlint {
                true => static_name(key).map(Name::bytes),
                false => name_of_key(key),
            };
            let mut props = properties.iter().filter_map(|it| Some((it, it.key().and_then(name_of)?)));
            self.check_attributes_and_report(e.span(), &mut props, false, cx);
        }
    }

    /// upstream's `checkAttributesAndReport`. `props`: the attributes or the properties, with their names.
    fn check_attributes_and_report<'a>(
        &self,
        node: Span,
        props: &mut dyn Iterator<Item = (Prop<'a>, &'a [u8])>,
        last_checked_counts: bool,
        cx: &Cx<'a, Self>,
    ) {
        let (mut checked, mut default_checked, mut is_missing_property) = (None, None, true);
        for (prop, name) in props {
            match name {
                b"checked" if last_checked_counts || checked.is_none() => checked = Some(prop),
                b"defaultChecked" if default_checked.is_none() => default_checked = Some(prop),
                b"onChange" | b"readOnly" => is_missing_property = false,
                _ => {}
            }
        }
        let Some(checked) = checked else {
            return;
        };
        let is_oxlint = cx.language().is_oxlint;
        // oxlint points at `checked`.
        let at = if is_oxlint { checked.span() } else { node };
        if !self.ignore_exclusive_checked_attribute
            && let Some(default_checked) = default_checked
        {
            cx.report(at, if is_oxlint { OXLINT_EXCLUSIVE_CHECKED_ATTRIBUTE } else { EXCLUSIVE_CHECKED_ATTRIBUTE })
                .labels_with(|labels| labels.push(default_checked, ""));
        }
        if !self.ignore_missing_properties && is_missing_property {
            cx.report(at, if is_oxlint { OXLINT_MISSING_PROPERTY } else { MISSING_PROPERTY });
        }
    }
}
