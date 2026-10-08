use super::function_paren_newline::is_on_one_line;
use bun_lint::prelude::*;

/// Enforce line breaks after each array element.
pub struct ArrayElementNewline {
    /// `None`: such arrays are not checked.
    expression: Option<Config>,
    pattern: Option<Config>,
}

#[derive(Copy, Clone, PartialEq, Eq)]
struct Config {
    consistent: bool,
    multiline: bool,
    /// `usize::MAX` for no number.
    min_items: usize,
}

const UNEXPECTED_LINE_BREAK: Message =
    Message::new("unexpectedLineBreak", "There should be no linebreak here.");
const MISSING_LINE_BREAK: Message = Message::new(
    "missingLineBreak",
    "There should be a linebreak after this element.",
);

impl Config {
    /// ESLint's `normalizeOptionValue`.
    fn new(option: Option<&Json>) -> Config {
        let mut config = Config {
            consistent: false,
            multiline: false,
            min_items: usize::MAX,
        };
        let object = Object::of(option);
        match option.and_then(Json::as_str) {
            Some(b"never") => {}
            Some(b"consistent") => config.consistent = true,
            Some(_) => config.min_items = 0,
            None if option.is_none_or(|it| it.as_object().is_none()) => config.min_items = 0,
            None => match object.usize("minItems") {
                Some(0) => config.min_items = 0,
                min_items => {
                    config.multiline = object.bool_or("multiline", false);
                    config.min_items = min_items.unwrap_or(usize::MAX);
                }
            },
        }
        config
    }
}

#[derive(Copy, Clone)]
struct Element {
    span: Span,
    /// With the parentheses around it.
    outer: Span,
}

fn element_of_expression(e: Expr) -> Option<Element> {
    (!e.is_missing()).then(|| Element {
        span: e.span(),
        outer: e.outer_span(),
    })
}

fn element_of_pattern(element: PatElem) -> Option<Element> {
    element.pat().map(|_| Element {
        span: element.span(),
        outer: element.span(),
    })
}

/// What is between each element and the next, unless one of the two is a hole: from the token
/// before the comma to the token after it.
fn gaps(elements: impl Iterator<Item = Option<Element>>) -> impl Iterator<Item = Span> {
    let mut previous: Option<Element> = None;
    elements.filter_map(move |element| {
        let before = std::mem::replace(&mut previous, element)?;
        Some(Span::new(before.outer.end, element?.outer.start))
    })
}

fn report(cx: &Cx<'_, ArrayElementNewline>, gap: Span, needs_line_break: bool) {
    let file = cx.file();
    let comma = skip_trivia(file.text(), gap.start);
    let comma = Span::new(comma, comma + 1);
    let comment = file.comments_between(comma, Span::empty(gap.end)).next_back();
    let at = Span::new(comment.map_or(comma.end, Token::end), gap.end);
    if needs_line_break {
        cx.report(at, MISSING_LINE_BREAK).fix(|fixer| fixer.replace(at, "\n"));
        return;
    }
    cx.report(at, UNEXPECTED_LINE_BREAK).fix(|fixer| {
        if comment.is_some() {
            return None;
        }
        if text::has_line_break(file.slice(at)) {
            return Some(fixer.replace(at, " "));
        }
        // The comma is on the line of the next element.
        let before_comma = Span::new(gap.start, comma.start);
        (!file.comments_exist_between(Span::empty(gap.start), comma)).then(|| fixer.remove(before_comma))
    });
}

fn check(
    cx: &Cx<'_, ArrayElementNewline>,
    config: Config,
    len: usize,
    elements: impl Iterator<Item = Option<Element>> + Clone,
) {
    let has_line_break = |span: &Span| text::has_line_break(cx.slice(*span));
    let needs_line_breaks = len >= config.min_items
        || config.multiline && elements.clone().flatten().any(|it| !is_on_one_line(cx.file(), it.span))
        || config.consistent && {
            let count = gaps(elements.clone()).filter(has_line_break).count();
            count > 0 && count < len
        };
    for gap in gaps(elements) {
        if has_line_break(&gap) != needs_line_breaks {
            report(cx, gap, needs_line_breaks);
        }
    }
}

impl Rule for ArrayElementNewline {
    const META: Meta = Meta::eslint("array-element-newline", Kind::Layout)
        .fixable(Fixable::Whitespace)
        .deprecated();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let by_type = options.object(0);
        let (expression, pattern) = (by_type.get("ArrayExpression"), by_type.get("ArrayPattern"));
        if expression.is_some() || pattern.is_some() {
            return ArrayElementNewline {
                expression: expression.map(|it| Config::new(Some(it))),
                pattern: pattern.map(|it| Config::new(Some(it))),
            };
        }
        let config = Some(Config::new(options.get(0)));
        ArrayElementNewline {
            expression: config,
            pattern: config,
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Array], |rule, e, cx| {
            let ExprKind::Array(elements) = e.kind() else {
                return;
            };
            let len = elements.len();
            if len < 2 {
                return;
            }
            let is_pattern = rule.expression != rule.pattern && utils::is_assignment_target(e);
            let config = if is_pattern { rule.pattern } else { rule.expression };
            if let Some(config) = config {
                check(cx, config, len, elements.iter().map(element_of_expression));
            }
        });
        if self.pattern.is_some() {
            on.pats([PatTag::Array], |rule, pat, cx| {
                let (PatKind::Array(elements), Some(config)) = (pat.kind(), rule.pattern) else {
                    return;
                };
                let len = elements.len();
                if len >= 2 {
                    check(cx, config, len, elements.iter().map(element_of_pattern));
                }
            });
        }
    }
}
