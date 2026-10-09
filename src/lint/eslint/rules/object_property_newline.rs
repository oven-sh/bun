use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::tokens::token_len;

/// Enforce placing object properties on separate lines.
pub struct ObjectPropertyNewline {
    allow_same_line: bool,
}

const PROPERTIES_ON_NEWLINE_ALL: Message = Message::new(
    "propertiesOnNewlineAll",
    "Object properties must go on a new line if they aren't all on the same line.",
);
const PROPERTIES_ON_NEWLINE: Message = Message::new(
    "propertiesOnNewline",
    "Object properties must go on a new line.",
);

/// Whether the first token of `first` ends on the line that the last token of `last` starts on.
fn are_on_same_line<'a>(file: &'a File<'a>, first: Prop<'a>, last: Prop<'a>) -> bool {
    let (start, end) = (first.span().start, last.span().end);
    let first_token_end = start + token_len(file.slice(Span::new(start, end))) as u32;
    if !strings::contains_js_line_break(file.slice(Span::new(first_token_end, end))) {
        return true;
    }
    // Only a string and a template can have a line break in them.
    let last_byte = end.checked_sub(1).and_then(|at| file.text().get(at as usize));
    matches!(last_byte, Some(b'`' | b'\'' | b'"'))
        && file.last_token(last).is_some_and(|token| {
            !strings::contains_js_line_break(file.slice(Span::new(first_token_end, token.start())))
        })
}

impl ObjectPropertyNewline {
    fn check<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Object(properties) = e.kind() else {
            return;
        };
        let mut rest = properties.iter();
        let Some(first) = rest.next() else {
            return;
        };
        let Some(last) = rest.next_back() else {
            return;
        };
        if utils::is_assignment_target(e) {
            return;
        }
        let file = cx.file();
        if self.allow_same_line && are_on_same_line(file, first, last) {
            return;
        }
        let mut previous = first;
        for current in properties.iter().skip(1) {
            let between = previous.span().between(current.span());
            previous = current;
            if strings::contains_js_line_break(file.slice(between)) {
                continue;
            }
            let Some(first_token) = file.first_token(current) else {
                continue;
            };
            let message = match self.allow_same_line {
                true => PROPERTIES_ON_NEWLINE_ALL,
                false => PROPERTIES_ON_NEWLINE,
            };
            cx.report(first_token, message).fix(|fixer| {
                let comma = file.token_before(first_token)?;
                let after_comma = comma.span().between(first_token.span());
                // Not if there is a comment between the comma and the property.
                strings::is_all_js_whitespace(file.slice(after_comma)).then(|| fixer.replace(after_comma, "\n"))
            });
        }
    }
}

impl Rule for ObjectPropertyNewline {
    const META: Meta = Meta::eslint("object-property-newline", Kind::Layout)
        .fixable(Fixable::Whitespace)
        .deprecated();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let object = options.object(0);
        ObjectPropertyNewline {
            allow_same_line: object.bool_or("allowAllPropertiesOnSameLine", false)
                || object.bool_or("allowMultiplePropertiesPerLine", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Object], Self::check);
    }
}
