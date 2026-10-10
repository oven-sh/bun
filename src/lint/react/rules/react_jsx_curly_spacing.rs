use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforce or disallow spaces inside of curly braces in JSX attributes and expressions.
pub struct JsxCurlySpacing {
    attributes_config: Option<Config>,
    children_config: Option<Config>,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Spacing {
    Always,
    Never,
}

/// What `normalizeConfig` returns on its last pass.
#[derive(Copy, Clone)]
struct Config {
    when: Spacing,
    allow_multiline: bool,
    object_literal_spaces: Spacing,
}

/// `mode` of `fixByTrimmingWhitespace`: after the opening brace, or before the closing one.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Mode {
    Start,
    End,
}

#[derive(Copy, Clone)]
enum Problem {
    Newline,
    Space,
    SpaceNeeded,
}

const NO_NEWLINE_AFTER: Message = Message::new("noNewlineAfter", "There should be no newline after '{{token}}'");
const NO_NEWLINE_BEFORE: Message = Message::new("noNewlineBefore", "There should be no newline before '{{token}}'");
const NO_SPACE_AFTER: Message = Message::new("noSpaceAfter", "There should be no space after '{{token}}'");
const NO_SPACE_BEFORE: Message = Message::new("noSpaceBefore", "There should be no space before '{{token}}'");
const SPACE_NEEDED_AFTER: Message = Message::new("spaceNeededAfter", "A space is required after '{{token}}'");
const SPACE_NEEDED_BEFORE: Message = Message::new("spaceNeededBefore", "A space is required before '{{token}}'");

impl Spacing {
    fn of(value: Option<&str>) -> Option<Spacing> {
        match value? {
            "always" => Some(Spacing::Always),
            "never" => Some(Spacing::Never),
            _ => None,
        }
    }
}

/// `fixByTrimmingWhitespace`: `replace(/^\s+/gm, "")` or `replace(/\s+$/gm, "")`, in one pass over the text.
#[cold]
#[inline(never)]
fn fix_by_trimming_whitespace(fixer: Fixer<'_>, range: Span, mode: Mode, spacing: Spacing) -> Fix {
    let mut rest = fixer.file().slice(range);
    let mut replacement_text = Vec::with_capacity(rest.len() + 1);
    loop {
        if mode == Mode::Start {
            rest = strings::trim_js_whitespace_start(rest);
        }
        let line_break = strings::find_js_line_break(rest);
        let (line, from_line_break) = rest.split_at(line_break.map_or(rest.len(), |it| it.0));
        replacement_text.extend_from_slice(line);
        if mode == Mode::End {
            replacement_text.truncate(strings::trim_js_whitespace_end(&replacement_text).len());
        }
        let Some((_, len)) = line_break else {
            break;
        };
        // To a regular expression `\r\n` is two line terminators.
        let (line_terminator, next_lines) = from_line_break.split_at(if len == 2 { 1 } else { len });
        replacement_text.extend_from_slice(line_terminator);
        rest = next_lines;
    }
    if spacing == Spacing::Always {
        match mode {
            Mode::Start => replacement_text.push(b' '),
            Mode::End => replacement_text.insert(0, b' '),
        }
    }
    fixer.replace(range, replacement_text)
}

impl Config {
    /// `validateBraceSpacing`. What is next to a brace, a token or a comment, is found by skipping white space.
    fn validate_brace_spacing(self, node: Span, cx: &mut Cx<'_, JsxCurlySpacing>) {
        let file = cx.file();
        let inside = node.shrink(1, 1);
        let from_second = strings::trim_js_whitespace_start(file.slice(inside));
        let second = inside.end - from_second.len() as u32;
        let penultimate_end = inside.start + strings::trim_js_whitespace_end(file.slice(inside)).len() as u32;
        let is_object_literal = match from_second.first() {
            Some(b'{') => true,
            // The value of the comment `/*{*/` is that of the brace too.
            Some(b'/' | b'<') => file.comment_around(second).is_some_and(|it| it.value() == b"{"),
            _ => false,
        };
        let spacing = if is_object_literal { self.object_literal_spaces } else { self.when };
        let (first, last) = (Span::before(node.start, inside), Span::after(inside, node.end));
        self.check(Mode::Start, first, Span::after(first, second), spacing, cx);
        self.check(Mode::End, last, Span::before(penultimate_end, last), spacing, cx);
    }

    /// `gap`: the white space between the brace `token` and what is next to it.
    fn check(self, mode: Mode, token: Span, gap: Span, spacing: Spacing, cx: &mut Cx<'_, JsxCurlySpacing>) {
        let is_after = mode == Mode::Start;
        let (problem, message) = if gap.is_empty() {
            if spacing == Spacing::Never {
                return;
            }
            (Problem::SpaceNeeded, if is_after { SPACE_NEEDED_AFTER } else { SPACE_NEEDED_BEFORE })
        } else if strings::contains_js_line_break(cx.slice(gap)) {
            if self.allow_multiline {
                return;
            }
            (Problem::Newline, if is_after { NO_NEWLINE_AFTER } else { NO_NEWLINE_BEFORE })
        } else {
            if spacing == Spacing::Always {
                return;
            }
            (Problem::Space, if is_after { NO_SPACE_AFTER } else { NO_SPACE_BEFORE })
        };
        cx.report_at(token.start, message).data("token", cx.slice(token)).fix(|fixer| {
            let file = fixer.file();
            let range = match (problem, mode) {
                (Problem::SpaceNeeded, _) => return fixer.insert_before(gap, " "),
                (Problem::Space, Mode::Start) => gap,
                // From the first of the comments before the brace, not the last.
                (Problem::Space, Mode::End) => {
                    Span::before(file.comments_before(token).next().map_or(gap.start, Token::end), token)
                }
                // As far as the next token: the lines of the comments on the way are trimmed too.
                (Problem::Newline, Mode::Start) => {
                    Span::after(token, file.token_after(token).map_or(gap.end, Token::start))
                }
                (Problem::Newline, Mode::End) => {
                    Span::before(file.token_before(token).map_or(gap.start, Token::end), token)
                }
            };
            fix_by_trimming_whitespace(fixer, range, mode, spacing)
        });
    }
}

impl Rule for JsxCurlySpacing {
    const META: Meta = Meta::plugin(Plugin::React, "jsx-curly-spacing", Kind::Layout).fixable(Fixable::Code);
    const ON: On = On::new().exprs(&[ExprTag::Jsx]);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        // `"always", { .. }` is `{ when: "always", .. }`.
        let (when, original_config) = match options.str(0) {
            Some(when) => (Some(when), options.object(1)),
            None => (options.object(0).str("when"), options.object(0)),
        };
        let object_literals = |config: Object<'_>| Spacing::of(config.object("spacing").str("objectLiterals"));
        // `normalizeConfig` of what is at `key`, with `normalizeConfig(originalConfig)` for its defaults.
        let config_of = |key: &str, default: bool| {
            let config_or_boolean = original_config.get(key);
            if !config_or_boolean.map_or(default, |it| it.as_bool() != Some(false)) {
                return None;
            }
            let config = Object::of(config_or_boolean);
            let when = Spacing::of(config.str("when").or(when)).unwrap_or(Spacing::Never);
            let allow_multiline = config.bool("allowMultiline").or_else(|| original_config.bool("allowMultiline"));
            let object_literal_spaces = object_literals(config).or_else(|| object_literals(original_config));
            Some(Config {
                when,
                allow_multiline: allow_multiline.unwrap_or(true),
                object_literal_spaces: object_literal_spaces.unwrap_or(when),
            })
        };
        JsxCurlySpacing {
            attributes_config: config_of("attributes", true),
            children_config: config_of("children", false),
        }
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<()> {
        (self.attributes_config.is_some() || self.children_config.is_some()).then_some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Jsx(jsx) = e.kind() else {
            return;
        };
        if let Some(config) = self.attributes_config {
            for attribute in jsx.attrs() {
                let node = match attribute.kind() {
                    PropKind::Spread => Some(attribute.span()),
                    _ => attribute.value().and_then(Expr::jsx_container_span),
                };
                if let Some(node) = node {
                    config.validate_brace_spacing(node, cx);
                }
            }
        }
        if let Some(config) = self.children_config {
            // A `JSXSpreadChild` is not looked at.
            for child in jsx.children().iter().filter(|it| it.tag() != ExprTag::Spread) {
                if let Some(node) = child.jsx_container_span() {
                    config.validate_brace_spacing(node, cx);
                }
            }
        }
    }
}
