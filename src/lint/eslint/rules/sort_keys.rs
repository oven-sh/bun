use bun_lint::prelude::*;
use rustc_hash::FxHashMap;
use std::borrow::Cow;
use std::cmp::Ordering;

/// Require object keys to be sorted.
pub struct SortKeys {
    is_descending: bool,
    is_insensitive: bool,
    is_natural: bool,
    min_keys: usize,
    allows_line_separated_groups: bool,
    ignores_computed_keys: bool,
}

const SORT_KEYS: Message = Message::new(
    "sortKeys",
    "Expected object keys to be in {{natural}}{{insensitive}}{{order}}ending order. '{{thisName}}' should be before '{{prevName}}'.",
);

/// The static name of the property, or else the name of the identifier in `[name]`, which oxlint passes over.
fn get_property_name(key: Key<'_>, is_oxlint: bool) -> Option<Cow<'_, [u8]>> {
    ast_utils::get_static_key_name(key).or_else(|| match key.kind() {
        KeyKind::Computed(e) if !is_oxlint => e.as_ident().map(|name| Cow::Borrowed(name.bytes())),
        _ => None,
    })
}

/// Whether there is a blank line between `previous` and `current` that is not inside a token or a
/// comment.
fn is_blank_line_between<'a>(file: &'a File<'a>, previous: Prop<'a>, current: Prop<'a>) -> bool {
    let mut line = file.line_of(previous.span().end);
    let last_line = file.line_of(current.span().start);
    if last_line - line <= 1 {
        return false;
    }
    for token in file.tokens_between(previous, current).with_comments() {
        if file.line_of(token.start()) - line > 1 {
            return true;
        }
        line = file.line_of(token.end());
    }
    last_line - line > 1
}

/// oxlint's `take_numeric`: the number that starts with the digit `first` and goes on in `rest`. It wraps around, and
/// takes the character after the number too.
fn take_numeric(rest: &mut impl Iterator<Item = u32>, first: u32) -> u32 {
    let mut sum = first - 0x30;
    for c in rest {
        match c {
            0x30..=0x39 => sum = sum.wrapping_mul(10).wrapping_add(c - 0x30),
            _ => break,
        }
    }
    sum
}

/// oxlint's `compare_keys`: by the bytes of UTF-8, or by its own `natural_compare`. Only the letters of ASCII have
/// capitals.
fn compare_keys_as_oxlint(a: &[u8], b: &[u8], is_natural: bool, is_insensitive: bool) -> Ordering {
    if !is_natural {
        let fold = |it: &u8| if is_insensitive { it.to_ascii_lowercase() } else { *it };
        return a.iter().map(fold).cmp(b.iter().map(fold));
    }
    let fold = |it: u32| if is_insensitive && (0x41..=0x5A).contains(&it) { it + 0x20 } else { it };
    let is_alphanumeric = |it: u32| char::from_u32(it).is_some_and(char::is_alphanumeric);
    let (mut a, mut b) = (text::code_points(a).map(|it| it.1), text::code_points(b).map(|it| it.1));
    loop {
        let (x, y) = match (a.next(), b.next()) {
            (None, None) => return Ordering::Equal,
            (Some(_), None) => return Ordering::Greater,
            (None, Some(_)) => return Ordering::Less,
            (Some(x), Some(y)) => (fold(x), fold(y)),
        };
        if x == y {
            continue;
        }
        if (0x30..=0x39).contains(&x) && (0x30..=0x39).contains(&y) {
            match take_numeric(&mut a, x).cmp(&take_numeric(&mut b, y)) {
                Ordering::Equal => continue,
                order => return order,
            }
        }
        return match (is_alphanumeric(x), is_alphanumeric(y)) {
            (true, false) => Ordering::Greater,
            (false, true) => Ordering::Less,
            _ => x.cmp(&y),
        };
    }
}

/// oxlint's fix for each object literal that was asked about: what is replaced, and by what.
type Fixes<'a> = FxHashMap<Expr<'a>, Option<(Span, Vec<u8>)>>;

/// oxlint's `FixableProperty`.
struct FixableProperty<'a> {
    key: Cow<'a, [u8]>,
    /// [`lift_property_span`]
    span: Span,
    /// The text at `span`, with the object literal that is the value sorted.
    text: Cow<'a, [u8]>,
    /// `span` goes on to a comment after the `,`.
    has_comma: bool,
}

/// oxlint's `has_blank_line`: a line after the first with nothing at all on it.
fn has_empty_line(text: &[u8]) -> bool {
    let mut at = 0;
    let mut is_after_break = false;
    while let Some(rest) = text.get(at..).filter(|it| !it.is_empty()) {
        let len = text::line_break_len(rest);
        if len > 0 && is_after_break {
            return true;
        }
        is_after_break = len > 0;
        at += len.max(1);
    }
    false
}

/// oxlint's `lift_property_span`: the property, from the first of the JSDoc comments that oxc attaches to it, which are
/// those before it that are not on the line of the token before, and up to the end of a `// ..` after its `,` on the
/// same line. `boundary`: where the next property starts, or where the object ends.
fn lift_property_span<'a>(file: &'a File<'a>, prop: Prop<'a>, boundary: u32) -> Span {
    let whole = prop.span();
    let mut lifted = whole;
    let line_before = file.token_before(prop).map(|it| file.line_of(it.end()));
    let is_on_line_before = |at: u32| line_before == Some(file.line_of(at));
    let follows_on_the_line = is_on_line_before(whole.start);
    for comment in file.comments_before(prop).rev() {
        if !follows_on_the_line && is_on_line_before(comment.start()) {
            break;
        }
        let value = comment.comment_value();
        if comment.kind() == TokenKind::Block && value.starts_with(b"*") && value.iter().any(|it| *it != b'*') {
            lifted.start = comment.start();
        }
    }
    if let Some(comment) = file.comments_in(Span::after(whole, boundary)).next()
        && comment.kind() == TokenKind::Line
    {
        let between = file.slice(whole.between(comment.span()));
        if between.contains(&b',') && !between.contains(&b'\n') {
            lifted.end = comment.end();
        }
    }
    lifted
}

/// The object literals that are values of properties of `object`, without parentheses.
fn nested_objects<'a>(object: Expr<'a>) -> impl Iterator<Item = Expr<'a>> {
    let props = match object.kind() {
        ExprKind::Object(props) => Some(props),
        _ => None,
    };
    let values = props.into_iter().flatten().filter_map(Prop::value);
    values.filter(|it| it.tag() == ExprTag::Object && !it.is_parenthesized())
}

impl SortKeys {
    /// oxlint's `count_static_groups`: how many runs of properties with known names there are between spreads and, with
    /// `allowLineSeparatedGroups`, empty lines.
    fn count_static_groups<'a>(&self, file: &'a File<'a>, props: List<'a, Prop<'a>>) -> usize {
        let (mut count, mut is_in_group) = (0, false);
        let mut rest = props.iter().peekable();
        while let Some(prop) = rest.next() {
            let Some(key) = prop.key() else {
                is_in_group = false;
                continue;
            };
            if get_property_name(key, true).is_none() {
                continue;
            }
            count += usize::from(!is_in_group);
            is_in_group = !(self.allows_line_separated_groups
                && rest.peek().is_some_and(|next| has_empty_line(file.slice(prop.span().between(next.span())))));
        }
        count
    }

    /// oxlint's `collect_fixable_properties`. `known`: the fixes of the [`nested_objects`].
    fn collect_fixable_properties<'a>(&self, object: Expr<'a>, known: &Fixes<'a>) -> Option<Vec<FixableProperty<'a>>> {
        let ExprKind::Object(props) = object.kind() else {
            return None;
        };
        let (file, whole) = (object.file(), object.span());
        if self.count_static_groups(file, props) != 1 {
            return None;
        }
        let starts = props.iter().skip(1).map(|it| it.span().start).chain([whole.end]);
        let lifted: Vec<Span> = props.iter().zip(starts).map(|(it, next)| lift_property_span(file, it, next)).collect();
        let has_comments = |at: Span| file.comments_in(at).next().is_some();
        let (first, last) = (*lifted.first()?, *lifted.last()?);
        if has_comments(Span::before(whole.start, first)) || has_comments(Span::after(last, whole.end)) {
            return None;
        }
        // Spreads can only be before all the others, and after them.
        let (mut has_properties, mut has_spread_after) = (false, false);
        let mut found = Vec::with_capacity(props.len());
        let gaps = lifted.iter().zip(lifted.iter().skip(1)).map(|(it, next)| Some(it.between(*next))).chain([None]);
        let mut rest = props.iter().zip(&lifted).zip(gaps).peekable();
        while let Some(((prop, &span), gap)) = rest.next() {
            let has_comments_after = gap.is_some_and(has_comments);
            let Some(key) = prop.key() else {
                let is_before_property = rest.peek().is_some_and(|it| it.0.0.key().is_some());
                if is_before_property && has_comments_after {
                    return None;
                }
                has_spread_after = has_properties;
                continue;
            };
            if has_spread_after || has_comments_after {
                return None;
            }
            has_properties = true;
            let value = prop.value().filter(|it| !it.is_parenthesized());
            let nested = value.and_then(|it| known.get(&it)?.as_ref());
            found.push(FixableProperty {
                key: get_property_name(key, true)?,
                span,
                text: match nested {
                    Some((replaced, text)) => {
                        let (before, after) = (Span::before(span.start, *replaced), Span::after(*replaced, span.end));
                        Cow::Owned([file.slice(before), text, file.slice(after)].concat())
                    }
                    None => Cow::Borrowed(file.slice(span)),
                },
                has_comma: span.end > prop.span().end,
            });
        }
        Some(found)
    }

    /// oxlint's `build_object_fix`.
    fn build_object_fix<'a>(&self, object: Expr<'a>, known: &Fixes<'a>) -> Option<(Span, Vec<u8>)> {
        let (file, props) = (object.file(), self.collect_fixable_properties(object, known)?);
        let (first, last) = (props.first()?, props.last()?);
        let mut sorted: Vec<&FixableProperty<'a>> = props.iter().collect();
        utils::sort::sort_by(&mut sorted, |a, b| {
            let order = compare_keys_as_oxlint(&a.key, &b.key, self.is_natural, self.is_insensitive);
            if self.is_descending { order.reverse() } else { order }
        });
        let is_in_order = sorted.iter().zip(&props).all(|(a, b)| a.span == b.span);
        if is_in_order && props.iter().all(|it| matches!(it.text, Cow::Borrowed(_))) {
            return None;
        }
        // What is between the first two, without the `,`, comes between all.
        let between: Vec<u8> = match props.get(1) {
            Some(second) => {
                let raw = file.slice(first.span.between(second.span));
                let comma = raw.iter().position(|it| *it == b',');
                raw.iter().enumerate().filter(|it| Some(it.0) != comma).map(|it| *it.1).collect()
            }
            None => b" ".to_vec(),
        };
        let mut text = Vec::new();
        for (index, prop) in sorted.iter().enumerate() {
            text.extend_from_slice(&prop.text);
            if index + 1 < sorted.len() {
                if !prop.has_comma {
                    text.push(b',');
                }
                text.extend_from_slice(&between);
            }
        }
        if last.has_comma && !sorted.last()?.has_comma {
            text.push(b',');
        }
        Some((Span::new(first.span.start, last.span.end), text))
    }

    /// [`SortKeys::build_object_fix`] of `root`, after those of the object literals in it.
    fn fix_as_oxlint<'a>(&self, root: Expr<'a>, known: &mut Fixes<'a>) -> Option<(Span, Vec<u8>)> {
        let mut pending = vec![root];
        while let Some(&object) = pending.last() {
            let count = pending.len();
            if !known.contains_key(&object) {
                pending.extend(nested_objects(object).filter(|it| !known.contains_key(it)));
            }
            if pending.len() == count {
                pending.pop();
                if !known.contains_key(&object) {
                    let fix = self.build_object_fix(object, known);
                    known.insert(object, fix);
                }
            }
        }
        known.get(&root)?.clone()
    }

    fn is_valid_order(&self, a: &[u8], b: &[u8], is_oxlint: bool) -> bool {
        if is_oxlint {
            let order = compare_keys_as_oxlint(a, b, self.is_natural, self.is_insensitive);
            return order != if self.is_descending { Ordering::Less } else { Ordering::Greater };
        }
        let (a, b) = if self.is_descending { (b, a) } else { (a, b) };
        let (a, b) = match self.is_insensitive {
            true => (text::to_lower_case(a), text::to_lower_case(b)),
            false => (Cow::Borrowed(a), Cow::Borrowed(b)),
        };
        let order = match self.is_natural {
            true => text::natural_compare(&a, &b),
            false => text::compare(&a, &b),
        };
        order != Ordering::Greater
    }

    fn check<'a>(&self, object: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Object(props) = object.kind() else {
            return;
        };
        if props.len() < self.min_keys || utils::is_assignment_target(object) {
            return;
        }
        let mut prev_node: Option<Prop<'a>> = None;
        let mut prev_name: Option<Cow<'a, [u8]>> = None;
        let mut prev_blank_line = false;
        for prop in props {
            let Some(key) = prop.key() else {
                prev_name = None;
                continue;
            };
            if self.ignores_computed_keys && key.is_computed() {
                prev_name = None;
                continue;
            }
            let starts_group = self.allows_line_separated_groups
                && (prev_blank_line
                    || prev_node.is_some_and(|previous| is_blank_line_between(cx.file(), previous, prop)));
            prev_node = Some(prop);

            let Some(this_name) = get_property_name(key, cx.language().is_oxlint) else {
                prev_blank_line |= starts_group;
                continue;
            };
            let before = prev_name.replace(this_name.clone());
            if starts_group {
                prev_blank_line = false;
                continue;
            }
            if let Some(before) = before
                && !self.is_valid_order(&before, &this_name, cx.language().is_oxlint)
            {
                // oxlint says one thing about an object, and points at it.
                let is_oxlint = cx.language().is_oxlint;
                let report = cx
                    .report(if is_oxlint { object.span() } else { key.inner_span(cx.file()) }, SORT_KEYS)
                    .data("thisName", this_name)
                    .data("prevName", before)
                    .data("order", if self.is_descending { "desc" } else { "asc" })
                    .data("insensitive", if self.is_insensitive { "insensitive " } else { "" })
                    .data("natural", if self.is_natural { "natural " } else { "" });
                if is_oxlint {
                    report.fix(|fixer| {
                        let (replaced, text) = self.fix_as_oxlint(object, &mut cx.state)?;
                        Some(fixer.replace(replaced, text))
                    });
                    return;
                }
            }
        }
    }
}

impl Rule for SortKeys {
    const META: Meta = Meta::eslint("sort-keys", Kind::Suggestion);
    type State<'a> = Fixes<'a>;

    fn new(options: &Options) -> Self {
        let object = options.object(1);
        SortKeys {
            is_descending: options.str(0) == Some("desc"),
            is_insensitive: !object.bool_or("caseSensitive", true),
            is_natural: object.bool_or("natural", false),
            min_keys: object.usize("minKeys").unwrap_or(2),
            allows_line_separated_groups: object.bool_or("allowLineSeparatedGroups", false),
            ignores_computed_keys: object.bool_or("ignoreComputedKeys", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) -> Fixes<'a> {
        on.exprs([ExprTag::Object], Self::check);
        Fixes::default()
    }
}
