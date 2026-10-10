use crate::util_eslint::is_space_between_tokens;
use crate::util_get_token_before_closing_bracket::get_token_before_closing_bracket;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforce whitespace in and around the JSX opening and closing brackets
pub struct JsxTagSpacing {
    closing_slash: Spacing,
    before_self_closing: Spacing,
    after_opening: Spacing,
    before_closing: Spacing,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Spacing {
    Always,
    ProportionalAlways,
    AllowMultiline,
    Never,
    Allow,
}

const SELF_CLOSE_SLASH_NO_SPACE: Message =
    Message::new("selfCloseSlashNoSpace", "Whitespace is forbidden between `/` and `>`; write `/>`");
const SELF_CLOSE_SLASH_NEED_SPACE: Message =
    Message::new("selfCloseSlashNeedSpace", "Whitespace is required between `/` and `>`; write `/ >`");
const CLOSE_SLASH_NO_SPACE: Message =
    Message::new("closeSlashNoSpace", "Whitespace is forbidden between `<` and `/`; write `</`");
const CLOSE_SLASH_NEED_SPACE: Message =
    Message::new("closeSlashNeedSpace", "Whitespace is required between `<` and `/`; write `< /`");
const BEFORE_SELF_CLOSE_NO_SPACE: Message =
    Message::new("beforeSelfCloseNoSpace", "A space is forbidden before closing bracket");
const BEFORE_SELF_CLOSE_NEED_SPACE: Message =
    Message::new("beforeSelfCloseNeedSpace", "A space is required before closing bracket");
const BEFORE_SELF_CLOSE_NEED_NEWLINE: Message =
    Message::new("beforeSelfCloseNeedNewline", "A newline is required before closing bracket");
const AFTER_OPEN_NO_SPACE: Message = Message::new("afterOpenNoSpace", "A space is forbidden after opening bracket");
const AFTER_OPEN_NEED_SPACE: Message = Message::new("afterOpenNeedSpace", "A space is required after opening bracket");
const BEFORE_CLOSE_NO_SPACE: Message =
    Message::new("beforeCloseNoSpace", "A space is forbidden before closing bracket");
const BEFORE_CLOSE_NEED_SPACE: Message =
    Message::new("beforeCloseNeedSpace", "Whitespace is required before closing bracket");
const BEFORE_CLOSE_NEED_NEWLINE: Message =
    Message::new("beforeCloseNeedNewline", "A newline is required before closing bracket");

impl Spacing {
    fn of(options: Object<'_>, key: &str, default: Spacing) -> Spacing {
        match options.str(key) {
            Some("always") => Spacing::Always,
            Some("proportional-always") => Spacing::ProportionalAlways,
            Some("allow-multiline") => Spacing::AllowMultiline,
            Some("never") => Spacing::Never,
            Some("allow") => Spacing::Allow,
            _ => default,
        }
    }
}

impl Rule for JsxTagSpacing {
    const META: Meta = Meta::plugin(Plugin::React, "jsx-tag-spacing", Kind::Layout).fixable(Fixable::Whitespace);
    const ON: On = On::new().exprs(&[ExprTag::Jsx]);
    no_state!();

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        JsxTagSpacing {
            closing_slash: Spacing::of(options, "closingSlash", Spacing::Never),
            before_self_closing: Spacing::of(options, "beforeSelfClosing", Spacing::Always),
            after_opening: Spacing::of(options, "afterOpening", Spacing::Never),
            before_closing: Spacing::of(options, "beforeClosing", Spacing::Allow),
        }
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Jsx(jsx) = e.kind() else {
            return;
        };
        let Some(name) = jsx.tag().map(|it| it.span()) else {
            return;
        };
        let (file, node, is_self_closing) = (cx.file(), jsx.opening_span(), jsx.is_self_closing());
        if is_self_closing && self.closing_slash != Spacing::Allow {
            let slash = punctuator(skip_trivia(file.text(), last_token(jsx, name).end));
            let bracket = punctuator(node.end.saturating_sub(1));
            self.validate_closing_slash(slash, bracket, SELF_CLOSE_SLASH_NO_SPACE, SELF_CLOSE_SLASH_NEED_SPACE, cx);
        }
        if self.after_opening != Spacing::Allow {
            self.validate_after_opening(punctuator(node.start), name, cx);
        }
        if is_self_closing {
            if self.before_self_closing != Spacing::Allow {
                self.validate_before_self_closing(node, get_token_before_closing_bracket(jsx), cx);
            }
            return;
        }
        let is_proportional = self.before_closing == Spacing::ProportionalAlways;
        if self.before_closing != Spacing::Allow {
            let left_token = match is_proportional {
                true => get_token_before_closing_bracket(jsx),
                false => last_token(jsx, name),
            };
            self.validate_before_closing(node, left_token, Element::Opening, cx);
        }
        let (Some(node), Some(name)) = (jsx.closing_span(), jsx.close_tag().map(|it| it.span())) else {
            return;
        };
        if self.after_opening != Spacing::Allow || self.closing_slash != Spacing::Allow {
            let slash = slash_of_closing_element(file, node);
            if self.after_opening != Spacing::Allow {
                self.validate_after_opening(slash, name, cx);
            }
            if self.closing_slash != Spacing::Allow {
                let bracket = punctuator(node.start);
                self.validate_closing_slash(bracket, slash, CLOSE_SLASH_NO_SPACE, CLOSE_SLASH_NEED_SPACE, cx);
            }
        }
        if self.before_closing != Spacing::Allow {
            let left_token = if is_proportional { name } else { Span::empty(name.end) };
            self.validate_before_closing(node, left_token, Element::Closing, cx);
        }
    }
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Element {
    Opening,
    Closing,
}

impl JsxTagSpacing {
    /// `validateClosingSlash`: the `/` and the `>` of `/>`, or the `<` and the `/` of `</`.
    fn validate_closing_slash(
        &self,
        first: Span,
        second: Span,
        no_space: Message,
        need_space: Message,
        cx: &mut Cx<'_, Self>,
    ) {
        let spaced = is_spaced(cx.file(), first, second);
        if self.closing_slash == Spacing::Never && spaced {
            cx.report(first.to(second), no_space).fix(|fixer| fixer.remove(first.between(second)));
        } else if self.closing_slash == Spacing::Always && !spaced {
            cx.report(first.to(second), need_space).fix(|fixer| fixer.insert_before(second, " "));
        }
    }

    /// `validateBeforeSelfClosing`
    fn validate_before_self_closing(&self, node: Span, left_token: Span, cx: &mut Cx<'_, Self>) {
        let file = cx.file();
        // After a name with type arguments it is their `<`.
        let closing_slash = punctuator(skip_trivia(file.text(), left_token.end));
        if !ast_utils::is_on_one_line(file, left_token.between(closing_slash)) {
            return;
        }
        if self.before_self_closing == Spacing::ProportionalAlways && !ast_utils::is_on_one_line(file, node) {
            cx.report_at(left_token.end, BEFORE_SELF_CLOSE_NEED_NEWLINE)
                .fix(|fixer| fixer.insert_before(closing_slash, "\n"));
            return;
        }
        let spaced = is_spaced(file, left_token, closing_slash);
        if self.before_self_closing == Spacing::Never && spaced {
            cx.report_at(closing_slash.start, BEFORE_SELF_CLOSE_NO_SPACE)
                .fix(|fixer| fixer.remove(left_token.between(closing_slash)));
        } else if self.before_self_closing != Spacing::Never && !spaced {
            cx.report_at(closing_slash.start, BEFORE_SELF_CLOSE_NEED_SPACE)
                .fix(|fixer| fixer.insert_before(closing_slash, " "));
        }
    }

    /// `validateAfterOpening`: `opening_token` is the one before `name`.
    fn validate_after_opening(&self, opening_token: Span, name: Span, cx: &mut Cx<'_, Self>) {
        let (file, at) = (cx.file(), Span::before(opening_token.start, name));
        if self.after_opening == Spacing::AllowMultiline && !ast_utils::is_on_one_line(file, at) {
            return;
        }
        let spaced = is_spaced(file, opening_token, name);
        if self.after_opening == Spacing::Always && !spaced {
            cx.report(at, AFTER_OPEN_NEED_SPACE).fix(|fixer| fixer.insert_before(name, " "));
        } else if self.after_opening != Spacing::Always && spaced {
            cx.report(at, AFTER_OPEN_NO_SPACE).fix(|fixer| fixer.remove(opening_token.between(name)));
        }
    }

    /// `validateBeforeClosing`
    fn validate_before_closing(&self, node: Span, left_token: Span, element: Element, cx: &mut Cx<'_, Self>) {
        let file = cx.file();
        // After a name with type arguments it is their `<`.
        let closing_token = punctuator(skip_trivia(file.text(), left_token.end));
        let at = left_token.between(closing_token);
        let is_proportional = self.before_closing == Spacing::ProportionalAlways;
        let is_node_on_one_line = !is_proportional || ast_utils::is_on_one_line(file, node);
        if !is_node_on_one_line && ast_utils::is_on_one_line(file, at) {
            cx.report_at(left_token.end, BEFORE_CLOSE_NEED_NEWLINE)
                .fix(|fixer| fixer.insert_before(closing_token, "\n"));
            return;
        }
        if !ast_utils::is_on_one_line(file, Span::before(left_token.start, closing_token)) {
            return;
        }
        let spaced = is_spaced(file, left_token, closing_token);
        let needs_space = match self.before_closing {
            Spacing::Always => !spaced,
            Spacing::ProportionalAlways => element == Element::Opening && spaced == is_node_on_one_line,
            _ => false,
        };
        if needs_space {
            cx.report(at, BEFORE_CLOSE_NEED_SPACE).fix(|fixer| fixer.insert_before(closing_token, " "));
        } else if self.before_closing == Spacing::Never && spaced {
            cx.report(at, BEFORE_CLOSE_NO_SPACE).fix(|fixer| fixer.remove(at));
        }
    }
}

/// The `<`, `/` or `>` at `at`.
fn punctuator(at: u32) -> Span {
    Span::new(at, at + 1)
}

/// The last token of an opening element before its `>` or `/>`. Only a string can have a line break in it: of any
/// other it is the end.
fn last_token(jsx: Jsx<'_>, name: Span) -> Span {
    let Some(attribute) = jsx.attrs().last() else {
        return Span::empty(jsx.type_args().angle_brackets_span().map_or(name.end, |it| it.end));
    };
    let end = attribute.span().end;
    match attribute.value().map(|it| (it.tag(), it.span())) {
        Some((ExprTag::String, value)) if value.end == end => value,
        _ => Span::empty(end),
    }
}

/// The `/` of the closing element `node`.
fn slash_of_closing_element<'a>(file: &'a File<'a>, node: Span) -> Span {
    let after_bracket = node.start + 1;
    match file.text().get(after_bracket as usize..) {
        // Not the start of a comment, which espree reads after the `<`.
        Some([b'/', next, ..]) if !matches!(next, b'/' | b'*') => punctuator(after_bracket),
        _ => file.tokens_in(node).nth(1).map_or_else(|| punctuator(after_bracket), Token::span),
    }
}

/// `isSpaceBetweenTokens` of `first` and `second`, which is or starts with the next token.
fn is_spaced<'a>(file: &'a File<'a>, first: Span, second: Span) -> bool {
    match file.slice(first.between(second)).first() {
        None => false,
        Some(b'/') => is_space_between_tokens(file, first, second),
        Some(_) => true,
    }
}
