use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow Object Rest/Spread Properties.
pub struct NoRestSpreadProperties {
    object_spread_message: String,
    object_rest_message: String,
}

const NO_REST_SPREAD_PROPERTIES: Message = Message::new("", "{{kind}} are not allowed. {{message_suffix}}");

impl Rule for NoRestSpreadProperties {
    const META: Meta = Meta::oxlint(Plugin::Oxc, "no-rest-spread-properties", Kind::Suggestion);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        NoRestSpreadProperties {
            object_spread_message: options.str("objectSpreadMessage").unwrap_or_default().to_owned(),
            object_rest_message: options.str("objectRestMessage").unwrap_or_default().to_owned(),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        // Objects are far fewer than properties.
        on.exprs([ExprTag::Object], |rule, object, cx| {
            let ExprKind::Object(properties) = object.kind() else {
                return;
            };
            let mut is_target = None;
            for property in properties.iter().filter(|it| it.kind() == PropKind::Spread) {
                match *is_target.get_or_insert_with(|| object.is_assignment_target()) {
                    true => rule.report_rest(property.span(), cx),
                    false => {
                        cx.report(property, NO_REST_SPREAD_PROPERTIES)
                            .data("kind", "object spread property")
                            .data("message_suffix", rule.object_spread_message.clone());
                    }
                }
            }
        });
        on.pats([PatTag::Object], |rule, pattern, cx| {
            if let PatKind::Object(properties) = pattern.kind()
                && let Some(rest) = properties.last().filter(|it| it.is_rest())
            {
                rule.report_rest(rest.span(), cx);
            }
        });
    }
}

impl NoRestSpreadProperties {
    fn report_rest(&self, span: Span, cx: &Cx<Self>) {
        cx.report(span, NO_REST_SPREAD_PROPERTIES)
            .data("kind", "object rest property")
            .data("message_suffix", self.object_rest_message.clone());
    }
}
