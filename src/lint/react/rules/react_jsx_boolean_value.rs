use crate::jsx::get_prop_value;
use crate::react::is_jsx;
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforce a consistent boolean attribute style in your code.
pub struct JsxBooleanValue {
    /// `"always"`, not `"never"`
    is_always: bool,
    always: Vec<Box<[u8]>>,
    never: Vec<Box<[u8]>>,
    assume_undefined_is_false: bool,
}

const BOOLEAN_VALUE: Message = Message::new("", "Value must be omitted for boolean attribute \"{{attr}}\"");
const BOOLEAN_VALUE_ALWAYS: Message = Message::new("", "Value must be set for boolean attribute \"{{attr}}\"");
const BOOLEAN_VALUE_UNDEFINED_FALSE: Message =
    Message::new("", "Value must be omitted for `false` attribute \"{{attr}}\"");

impl Rule for JsxBooleanValue {
    const META: Meta = Meta::oxlint(Plugin::React, "jsx-boolean-value", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().exprs(&[ExprTag::Jsx]);
    type State<'a> = ();

    /// `["always", { never: ["a"], assumeUndefinedIsFalse }]`
    fn new(options: &Options) -> Self {
        let (is_always, options) = (options.str(0) == Some("always"), options.object(1));
        let names = |key: &str| options.strings(key).into_iter().map(|it| it.as_bytes().into()).collect();
        JsxBooleanValue {
            is_always,
            always: names("always"),
            never: names("never"),
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
            // Whether the value has to be written for this attribute.
            let is_always = match self.is_always {
                true => !self.never.iter().any(|it| **it == *name),
                false => self.always.iter().any(|it| **it == *name),
            };
            if is_always != boolean.is_none() || strings::contains_char(name, b':') {
                continue;
            }
            let ident = key.span(cx.file());
            match boolean {
                None => cx
                    .report(ident, BOOLEAN_VALUE_ALWAYS)
                    .data("attr", name)
                    .fix(|fixer| fixer.insert_after(ident, "={true}")),
                Some(true) => {
                    let span = Span::after(ident, attribute.span().end);
                    cx.report(span, BOOLEAN_VALUE).data("attr", name).fix(|fixer| fixer.remove(span))
                }
                Some(false) => cx
                    .report(attribute, BOOLEAN_VALUE_UNDEFINED_FALSE)
                    .data("attr", name)
                    .fix(|fixer| fixer.remove(attribute)),
            };
        }
    }
}
