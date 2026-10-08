use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::utils::ast_utils::{get_static_key_name, is_colon_token};
use bun_lint::utils::string_utils::get_grapheme_count;
use smallvec::SmallVec;
use std::borrow::Cow;

/// Enforce consistent spacing between keys and values in object literal properties.
pub struct KeySpacing {
    single_line: LineOptions,
    multi_line: LineOptions,
    align: Option<Align>,
}

#[derive(Copy, Clone, PartialEq)]
enum Mode {
    Strict,
    Minimum,
}

#[derive(Copy, Clone, PartialEq)]
enum On {
    Colon,
    Value,
}

#[derive(Copy, Clone, PartialEq)]
struct LineOptions {
    mode: Mode,
    before_colon: usize,
    after_colon: usize,
}

/// What is `None` is `undefined` upstream: `multiLine.align` is taken as it is configured. Nothing
/// is reported where the expected width is computed from it.
struct Align {
    on: Option<On>,
    mode: Mode,
    before_colon: Option<usize>,
    after_colon: Option<usize>,
}

#[derive(Copy, Clone)]
enum Side {
    Key,
    Value,
}

const EXTRA_KEY: Message = Message::new("extraKey", "Extra space after {{computed}}key '{{key}}'.");
const EXTRA_VALUE: Message = Message::new(
    "extraValue",
    "Extra space before value for {{computed}}key '{{key}}'.",
);
const MISSING_KEY: Message =
    Message::new("missingKey", "Missing space after {{computed}}key '{{key}}'.");
const MISSING_VALUE: Message = Message::new(
    "missingValue",
    "Missing space before value for {{computed}}key '{{key}}'.",
);

fn mode_of(mode: Option<&str>) -> Option<Mode> {
    match mode? {
        "strict" => Some(Mode::Strict),
        "minimum" => Some(Mode::Minimum),
        _ => None,
    }
}

fn on_of(on: Option<&str>) -> Option<On> {
    match on? {
        "colon" => Some(On::Colon),
        "value" => Some(On::Value),
        _ => None,
    }
}

/// ESLint's `initOptionProperty`, without `align`.
fn init_option_property(from: Object) -> LineOptions {
    LineOptions {
        mode: mode_of(from.str("mode")).unwrap_or(Mode::Strict),
        before_colon: from.bool("beforeColon").map_or(0, usize::from),
        after_colon: from.bool("afterColon").map_or(1, usize::from),
    }
}

/// The key and the value, if ESLint's `isKeyValueProperty` holds.
fn key_value<'a>(property: Prop<'a>) -> Option<(Key<'a>, Expr<'a>)> {
    if property.kind() != PropKind::Init || property.is_jsx_attribute() {
        return None;
    }
    Some((property.key()?, property.value()?))
}

/// The whitespace on both sides of the colon.
#[derive(Copy, Clone)]
struct Whitespace {
    before_colon: Span,
    after_colon: Span,
}

/// ESLint's `getPropertyWhitespace`: what `/(\s*):(\s*)/u` finds between the key and the value.
fn get_property_whitespace<'a>(file: &'a File<'a>, key: Key<'a>, value_start: u32) -> Option<Whitespace> {
    let start = key.inner_span(file).end;
    let between = file.slice(Span::new(start, value_start));
    let colon = strings::index_of_char_usize(between, b':')?;
    let (before, after) = (between.get(..colon)?, between.get(colon + 1..)?);
    let colon = start + colon as u32;
    Some(Whitespace {
        before_colon: Span::new(start + text::trim_end(before).len() as u32, colon),
        after_colon: Span::new(
            colon + 1,
            colon + 1 + (after.len() - text::trim_start(after).len()) as u32,
        ),
    })
}

/// The offset that is `units` UTF-16 code units after `from`.
fn forward(source: &[u8], from: u32, units: usize) -> u32 {
    let rest = source.get(from as usize..).unwrap_or_default();
    from + text::utf16_offset_to_byte(rest, units as u32) as u32
}

/// The offset that is `units` UTF-16 code units before `from`.
fn backward(source: &[u8], from: u32, units: usize) -> u32 {
    let mut before = source.get(..from as usize).unwrap_or_default();
    let mut left = units as u32;
    while left > 0 && !before.is_empty() {
        let (c, start) = bun_core::lexer::last_char(before);
        left = left.saturating_sub(text::utf16_width(c as u32));
        before = before.get(..start).unwrap_or_default();
    }
    before.len() as u32
}

/// ESLint's `report`: reports `whitespace`, on one side of the colon after `key`, if it is not
/// `expected` characters long.
fn report<'a>(
    cx: &Cx<'a, KeySpacing>,
    key: Key<'a>,
    side: Side,
    whitespace: Span,
    expected: Option<usize>,
    mode: Mode,
) {
    let Some(expected) = expected else {
        return;
    };
    let file = cx.file();
    let whitespace = file.slice(whitespace);
    let length = text::utf16_len(whitespace) as usize;
    let is_extra = length > expected;
    if length == expected
        || (mode == Mode::Minimum && is_extra && expected != 0)
        || (expected != 0 && text::has_line_break(whitespace))
    {
        return;
    }
    let diff = length.abs_diff(expected);
    let key_span = key.inner_span(file);
    let Some(next_colon) = file.tokens_after(key_span).find(is_colon_token) else {
        return;
    };
    let (Some(token_before_colon), Some(token_after_colon)) = (
        file.tokens_before(next_colon).with_comments().next(),
        file.tokens_after(next_colon).with_comments().next(),
    ) else {
        return;
    };
    let (message, loc) = match (side, is_extra) {
        (Side::Key, true) => (EXTRA_KEY, Span::new(token_before_colon.end(), next_colon.start())),
        (Side::Value, true) => (EXTRA_VALUE, Span::new(next_colon.start(), token_after_colon.start())),
        (Side::Key, false) => (MISSING_KEY, token_before_colon.span()),
        (Side::Value, false) => (MISSING_VALUE, token_after_colon.span()),
    };
    let name = match key.is_computed() {
        true => Cow::Borrowed(file.slice(key_span)),
        false => get_static_key_name(key).unwrap_or_default(),
    };
    cx.report(loc, message)
        .data("computed", if key.is_computed() { "computed " } else { "" })
        .data("key", name)
        .fix(|fixer| match (side, is_extra) {
            (Side::Key, true) => {
                let start = token_before_colon.end();
                fixer.remove(Span::new(start, forward(file.text(), start, diff)))
            }
            (Side::Value, true) => {
                let end = token_after_colon.start();
                fixer.remove(Span::new(backward(file.text(), end, diff), end))
            }
            (Side::Key, false) => fixer.insert_after(token_before_colon, " ".repeat(diff)),
            (Side::Value, false) => fixer.insert_before(token_after_colon, " ".repeat(diff)),
        });
}

/// ESLint's `verifySpacing`
fn verify_spacing<'a>(cx: &Cx<'a, KeySpacing>, key: Key<'a>, actual: Whitespace, options: LineOptions) {
    report(cx, key, Side::Key, actual.before_colon, Some(options.before_colon), options.mode);
    report(cx, key, Side::Value, actual.after_colon, Some(options.after_colon), options.mode);
}

/// ESLint's `verifyListSpacing`
fn verify_list_spacing<'a>(
    cx: &Cx<'a, KeySpacing>,
    properties: impl Iterator<Item = Prop<'a>>,
    options: LineOptions,
) {
    for (key, value) in properties.filter_map(key_value) {
        if let Some(actual) = get_property_whitespace(cx.file(), key, value.span().start) {
            verify_spacing(cx, key, actual, options);
        }
    }
}

/// ESLint's `getKeyWidth`: the number of characters from the start of the property to the end of
/// the key, with its quotes or brackets.
fn get_key_width<'a>(file: &'a File<'a>, property: Prop<'a>) -> usize {
    let start = property.span().start;
    let end = property.key().map_or(start, |key| key.span(file).end);
    get_grapheme_count(file.slice(Span::new(start, end)))
}

/// ESLint's `continuesPropertyGroup`
fn continues_property_group<'a>(file: &'a File<'a>, last_member: Prop<'a>, candidate: Prop<'a>) -> bool {
    let group_end_line = file.line_of(last_member.span().start);
    let candidate_value_start_line = file.line_of(match key_value(candidate) {
        Some((_, value)) => value.outer_span().start,
        None => candidate.span().start,
    });
    if candidate_value_start_line <= group_end_line + 1 {
        return true;
    }
    // The comments in between have to leave no line empty.
    let mut leading_comments = file.comments_before(candidate);
    let Some(first) = leading_comments.next() else {
        return false;
    };
    if file.line_of(first.start()) > group_end_line + 1 {
        return false;
    }
    let mut previous_end_line = file.line_of(first.end());
    for comment in leading_comments {
        if file.line_of(comment.start()) > previous_end_line + 1 {
            return false;
        }
        previous_end_line = file.line_of(comment.end());
    }
    candidate_value_start_line <= previous_end_line + 1
}

impl KeySpacing {
    /// Without alignment: a `Property` of ESTree whose `parent` has the range that `parent` returns.
    fn verify_property<'a>(
        &self,
        cx: &Cx<'a, Self>,
        key: Key<'a>,
        value_start: u32,
        parent: impl FnOnce() -> Span,
    ) {
        let Some(actual) = get_property_whitespace(cx.file(), key, value_start) else {
            return;
        };
        let is_on_one_line = |span: Span| cx.line_of(span.start) == cx.line_of(span.end);
        let is_single_line = self.single_line != self.multi_line && is_on_one_line(parent());
        let options = if is_single_line { self.single_line } else { self.multi_line };
        verify_spacing(cx, key, actual, options);
    }

    fn check_property<'a>(&self, property: Prop<'a>, cx: &mut Cx<'a, Self>) {
        if let Some((key, value)) = key_value(property) {
            self.verify_property(cx, key, value.span().start, || property.parent().span());
        }
    }

    fn check_pattern<'a>(&self, pattern: Pat<'a>, cx: &mut Cx<'a, Self>) {
        let PatKind::Object(properties) = pattern.kind() else {
            return;
        };
        for property in properties {
            if !property.is_rest()
                && !property.is_shorthand()
                && let Some(key) = property.key()
            {
                let value_start = property.value().span().start;
                self.verify_property(cx, key, value_start, || utils::estree_span(pattern.into()));
            }
        }
    }

    /// ESLint's `verifyGroupAlignment`, and what `verifyAlignment` does with a group. `properties`
    /// are those of the group that have a key and a value.
    fn verify_group<'a>(&self, cx: &Cx<'a, Self>, align: &Align, properties: &[Prop<'a>]) {
        let (Some(first), Some(last)) = (properties.first(), properties.last()) else {
            return;
        };
        let file = cx.file();
        if !text::has_line_break(file.slice(first.span().to(last.span()))) {
            return verify_list_spacing(cx, properties.iter().copied(), self.multi_line);
        }
        let widths: SmallVec<[usize; 16]> =
            properties.iter().map(|property| get_key_width(file, *property)).collect();
        let widest = widths.iter().copied().max().unwrap_or(0);
        let (before_colon, after_colon) = match properties.len() > 1 {
            true => (align.before_colon, align.after_colon),
            false => (Some(self.multi_line.before_colon), Some(self.multi_line.after_colon)),
        };
        let target_width = match align.on {
            Some(On::Colon) => before_colon,
            _ => after_colon,
        }
        .map(|space| widest + space);
        for (property, width) in properties.iter().zip(widths) {
            let Some((key, value)) = key_value(*property) else {
                continue;
            };
            let Some(whitespace) = get_property_whitespace(file, key, value.span().start) else {
                continue;
            };
            let aligned = target_width.map(|target| target - width);
            let (before, after) = match align.on {
                Some(On::Value) => (before_colon, aligned),
                _ => (aligned, after_colon),
            };
            report(cx, key, Side::Key, whitespace.before_colon, before, align.mode);
            report(cx, key, Side::Value, whitespace.after_colon, after, align.mode);
        }
    }

    fn check_object<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let (ExprKind::Object(properties), Some(align)) = (e.kind(), &self.align) else {
            return;
        };
        if properties.is_empty() || utils::is_assignment_target(e) {
            return;
        }
        if !text::has_line_break(e.text()) {
            return verify_list_spacing(cx, properties.iter(), self.single_line);
        }
        let file = cx.file();
        let mut group: SmallVec<[Prop<'a>; 16]> = SmallVec::new();
        let mut previous: Option<Prop<'a>> = None;
        for property in properties {
            if let Some(previous) = previous
                && !continues_property_group(file, previous, property)
            {
                self.verify_group(cx, align, &group);
                group.clear();
            }
            previous = Some(property);
            if key_value(property).is_some() {
                group.push(property);
            }
        }
        self.verify_group(cx, align, &group);
    }
}

impl Rule for KeySpacing {
    const META: Meta = Meta::eslint("key-spacing", Kind::Layout)
        .fixable(Fixable::Whitespace)
        .deprecated();
    type State<'a> = ();

    /// ESLint's `initOptions`
    fn new(options: &Options) -> Self {
        let from = options.object(0);
        let or_all = |key: &str| if from.has(key) { from.object(key) } else { from };
        let is_object = |value: Option<&Json>| value.is_some_and(|it| it.as_object().is_some());
        let from_multi_line = or_all("multiLine");
        let multi_line = init_option_property(from_multi_line);
        let align = if is_object(from.get("align")) {
            let from = from.object("align");
            let align = init_option_property(from);
            Some(Align {
                on: Some(on_of(from.str("on")).unwrap_or(On::Colon)),
                mode: align.mode,
                before_colon: Some(align.before_colon),
                after_colon: Some(align.after_colon),
            })
        } else if is_object(from_multi_line.get("align")) {
            let from = from_multi_line.object("align");
            Some(Align {
                on: on_of(from.str("on")),
                mode: mode_of(from.str("mode")).unwrap_or(multi_line.mode),
                before_colon: from.bool("beforeColon").map(usize::from),
                after_colon: from.bool("afterColon").map(usize::from),
            })
        } else {
            on_of(from_multi_line.str("align")).map(|on| Align {
                on: Some(on),
                mode: multi_line.mode,
                before_colon: Some(multi_line.before_colon),
                after_colon: Some(multi_line.after_colon),
            })
        };
        KeySpacing {
            single_line: init_option_property(or_all("singleLine")),
            multi_line,
            align,
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        if self.align.is_some() {
            on.exprs([ExprTag::Object], Self::check_object);
        } else {
            on.props(Self::check_property);
            on.pats([PatTag::Object], Self::check_pattern);
        }
    }
}
