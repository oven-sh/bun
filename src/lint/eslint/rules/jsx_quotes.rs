use bun_core::strings;
use bun_lint::prelude::*;

/// Enforce the consistent use of either double or single quotes in JSX attributes.
pub struct JsxQuotes {
    quote: u8,
}

const UNEXPECTED: Message = Message::new("unexpected", "Unexpected usage of {{description}}.");

impl JsxQuotes {
    fn check<'a>(&self, attribute: Prop<'a>, cx: &mut Cx<'a, Self>) {
        if !attribute.is_jsx_attribute() {
            return;
        }
        let Some(value) = attribute.value() else {
            return;
        };
        let (quote, raw) = (self.quote, value.text());
        if value.tag() != ExprTag::String
            || value.jsx_container_span().is_some()
            || ast_utils::is_surrounded_by(raw, quote)
            || value.as_string().is_some_and(|it| strings::contains_char(it.bytes(), quote))
        {
            return;
        }
        let (other, description) = match quote {
            b'"' => (b'\'', "singlequote"),
            _ => (b'"', "doublequote"),
        };
        cx.report(value, UNEXPECTED).data("description", description).fix(|fixer| {
            let converted: Vec<u8> = raw.iter().map(|&b| if b == other { quote } else { b }).collect();
            fixer.replace(value, converted)
        });
    }
}

impl Rule for JsxQuotes {
    const META: Meta = Meta::eslint("jsx-quotes", Kind::Layout)
        .fixable(Fixable::Whitespace)
        .deprecated();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        JsxQuotes {
            quote: match options.str(0) {
                Some("prefer-single") => b'\'',
                _ => b'"',
            },
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if file.has_exprs([ExprTag::Jsx]) {
            on.props(Self::check);
        }
    }
}
