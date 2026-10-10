use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow text that matches a pattern in strings, templates, JSX text, comments and regular expressions.
pub struct NoRestrictedText {
    patterns: Box<[Pattern]>,
}

struct Pattern {
    regex: Regex,
    message: Option<Box<[u8]>>,
    /// Where it looks: a bit for each [`Place`].
    places: u8,
}

#[derive(Copy, Clone)]
enum Place {
    Strings,
    Templates,
    JsxText,
    Comments,
    RegularExpressions,
}

const PLACES: [(&str, Place); 5] = [
    ("strings", Place::Strings),
    ("templates", Place::Templates),
    ("jsxText", Place::JsxText),
    ("comments", Place::Comments),
    ("regularExpressions", Place::RegularExpressions),
];

const RESTRICTED: Message = Message::new("restricted", "`{{text}}` matches the restricted pattern `{{pattern}}`.");
const RESTRICTED_WITH_MESSAGE: Message = Message::new("restrictedWithMessage", "{{message}}");

/// The regular expression of an element of `patterns`.
fn regex_of(pattern: &Object) -> Result<Regex, Vec<u8>> {
    let source = pattern.str("pattern").unwrap_or_default();
    Regex::new(source, pattern.str("flags").unwrap_or("u"))
        .map_err(|error| format!("The pattern \"{source}\" is not a regular expression: {error}").into_bytes())
}

fn patterns_of<'o>(options: &Options<'o>) -> impl Iterator<Item = Object<'o>> {
    options.object(0).array("patterns").iter().map(|it| Object::of(Some(it)))
}

impl NoRestrictedText {
    fn looks_at(&self, place: Place) -> bool {
        self.patterns.iter().any(|it| it.places & (1 << place as u8) != 0)
    }

    /// `span`: text as it is written, without what is around it.
    fn check<'a>(&self, span: Span, place: Place, cx: &Cx<'a, Self>) {
        let text = cx.file().slice(span);
        for pattern in self.patterns.iter().filter(|it| it.places & (1 << place as u8) != 0) {
            for found in pattern.regex.find_iter(text).filter(|it| !it.is_empty()) {
                let at = Span::new(span.start + found.start() as u32, span.start + found.end() as u32);
                match &pattern.message {
                    Some(message) => cx.report(at, RESTRICTED_WITH_MESSAGE).data("message", message.to_vec()),
                    None => {
                        let source = pattern.regex.source().to_vec();
                        cx.report(at, RESTRICTED).data("text", found.as_bytes()).data("pattern", source)
                    }
                };
            }
        }
    }
}

impl Rule for NoRestrictedText {
    const META: Meta = Meta::plugin(Plugin::Bun, "no-restricted-text", Kind::Suggestion);
    const ON: On = On::new().exprs(&[ExprTag::Template, ExprTag::String, ExprTag::Regex]).string_literals().finish();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let pattern_of = |it: Object| {
            let places = it.strings("in");
            let is_in = |name: &str| !it.has("in") || places.contains(&name);
            Some(Pattern {
                regex: regex_of(&it).ok()?,
                message: it.str("message").map(|it| it.as_bytes().into()),
                places: PLACES.iter().filter(|it| is_in(it.0)).fold(0, |all, it| all | (1 << it.1 as u8)),
            })
        };
        NoRestrictedText { patterns: patterns_of(options).filter_map(pattern_of).collect() }
    }

    fn validate(options: &Options) -> Result<(), Vec<u8>> {
        patterns_of(options).try_for_each(|it| regex_of(&it).map(|_| ()))
    }

    fn narrow<'a>(&self, _: &'a File<'a>) -> On {
        let mut on = On::new();
        if self.looks_at(Place::Strings) {
            on = on.string_literals();
        }
        if self.looks_at(Place::Templates) {
            on = on.exprs(&[ExprTag::Template]);
        }
        if self.looks_at(Place::JsxText) {
            on = on.exprs(&[ExprTag::String]);
        }
        if self.looks_at(Place::RegularExpressions) {
            on = on.exprs(&[ExprTag::Regex]);
        }
        if self.looks_at(Place::Comments) {
            on = on.finish();
        }
        on
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<()> {
        (!self.patterns.is_empty()).then_some(())
    }

    fn string_literal<'a>(&self, literal: Literal<'a>, cx: &mut Cx<'a, Self>) {
        self.check(literal.span().shrink(1, 1), Place::Strings, cx)
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        match e.tag() {
            ExprTag::Template => {
                let ExprKind::Template(template) = e.kind() else {
                    return;
                };
                for at in 0..template.quasi_count() {
                    // After the backtick or the `}`.
                    let start = template.quasi_span(at).start + 1;
                    self.check(Span::new(start, start + template.raw(at).len() as u32), Place::Templates, cx);
                }
            }
            ExprTag::String => {
                if e.is_jsx_text() {
                    self.check(e.span(), Place::JsxText, cx);
                }
            }
            ExprTag::Regex => self.check(e.span(), Place::RegularExpressions, cx),
            _ => {}
        }
    }

    fn finish<'a>(&self, cx: &mut Cx<'a, Self>) {
        for comment in cx.file().comments() {
            self.check(comment.span(), Place::Comments, cx);
        }
    }
}
