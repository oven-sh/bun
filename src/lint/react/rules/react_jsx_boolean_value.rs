use crate::jsx::get_prop_value;
use crate::react::is_jsx;
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforce boolean attributes notation in JSX
pub struct JsxBooleanValue {
    /// `"always"`, not `"never"`
    is_always: bool,
    /// `never` beside `"always"`, `always` beside `"never"`
    exceptions: Vec<Box<[u8]>>,
    assume_undefined_is_false: bool,
}

const OMIT_BOOLEAN: Message = Message::new("omitBoolean", "Value must be omitted for boolean attribute `{{propName}}`");
const SET_BOOLEAN: Message = Message::new("setBoolean", "Value must be set for boolean attribute `{{propName}}`");
const OMIT_PROP_AND_BOOLEAN: Message =
    Message::new("omitPropAndBoolean", "Value must be omitted for `false` attribute: `{{propName}}`");
const BOOLEAN_VALUE: Message = Message::new("", "Value must be omitted for boolean attribute \"{{attr}}\"");
const BOOLEAN_VALUE_ALWAYS: Message = Message::new("", "Value must be set for boolean attribute \"{{attr}}\"");
const BOOLEAN_VALUE_UNDEFINED_FALSE: Message =
    Message::new("", "Value must be omitted for `false` attribute \"{{attr}}\"");

impl Rule for JsxBooleanValue {
    const META: Meta = Meta::plugin(Plugin::React, "jsx-boolean-value", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().exprs(&[ExprTag::Jsx]);
    type State<'a> = ();

    /// `["always", { never: ["a"], assumeUndefinedIsFalse }]`
    fn new(options: &Options) -> Self {
        let (is_always, options) = (options.str(0) == Some("always"), options.object(1));
        let exceptions = options.strings(if is_always { "never" } else { "always" });
        JsxBooleanValue {
            is_always,
            exceptions: exceptions.into_iter().map(|it| it.as_bytes().into()).collect(),
            assume_undefined_is_false: options.bool_or("assumeUndefinedIsFalse", false),
        }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        is_jsx(file).then_some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Jsx(jsx) = e.kind() else {
            return;
        };
        let is_oxlint = cx.language().is_oxlint;
        for attribute in jsx.attrs().iter().filter(|it| it.kind() != PropKind::Spread) {
            let value = get_prop_value(attribute);
            let boolean = match value.map(|it| it.as_expression().map(Expr::tag)) {
                None => None,
                Some(Some(ExprTag::True)) => Some(true),
                Some(Some(ExprTag::False)) if self.assume_undefined_is_false => Some(false),
                _ => continue,
            };
            let Some((key, name)) = attribute.key().and_then(|key| Some((key, key.name()?.bytes()))) else {
                continue;
            };
            // Upstream takes the node `b` of `a:b` for the name: it is in no list.
            let is_namespaced = strings::contains_char(name, b':');
            let is_exception = !is_namespaced && self.exceptions.iter().any(|it| **it == *name);
            // Whether the value has to be written for this attribute.
            let is_always = self.is_always != is_exception;
            // oxlint passes over `a:b`.
            if is_always != boolean.is_none() || (is_oxlint && is_namespaced) {
                continue;
            }
            let (ident, whole) = (key.span(cx.file()), attribute.span());
            let after_name = Span::after(ident, whole.end);
            // oxlint has texts of its own, and points at the `={true}` that is to be omitted.
            let (message, at, removed) = match (boolean, is_oxlint) {
                (None, false) => (SET_BOOLEAN, ident, None),
                (None, true) => (BOOLEAN_VALUE_ALWAYS, ident, None),
                (Some(true), false) => (OMIT_BOOLEAN, whole, Some(after_name)),
                (Some(true), true) => (BOOLEAN_VALUE, after_name, Some(after_name)),
                (Some(false), false) => (OMIT_PROP_AND_BOOLEAN, whole, Some(whole)),
                (Some(false), true) => (BOOLEAN_VALUE_UNDEFINED_FALSE, whole, Some(whole)),
            };
            let shown = if is_namespaced { &b"[object Object]"[..] } else { name };
            cx.report(at, message).data(if is_oxlint { "attr" } else { "propName" }, shown).fix(|fixer| match removed {
                Some(removed) => fixer.remove(removed),
                None => fixer.insert_after(ident, "={true}"),
            });
        }
    }
}
