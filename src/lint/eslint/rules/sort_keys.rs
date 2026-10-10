use bun_core::strings;
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
    let (mut a, mut b) = (strings::wtf8_codepoints(a).map(|it| it.1), strings::wtf8_codepoints(b).map(|it| it.1));
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

/// What oxlint's fix replaces in an object literal, and by what.
type ObjectFix = Option<(Span, Vec<u8>)>;

/// [`ObjectFix`] for each object literal that was asked about.
type Fixes<'a> = FxHashMap<Expr<'a>, ObjectFix>;

/// oxlint's `FixableProperty`.
struct FixableProperty<'a, 'k> {
    key: Cow<'a, [u8]>,
    /// [`lift_property_span`]
    span: Span,
    /// The fix of the object literal that is the value.
    nested: Option<&'k (Span, Vec<u8>)>,
    /// `span` goes on to a comment after the `,`.
    has_comma: bool,
}

/// oxlint's `has_blank_line`: a line after the first with nothing at all on it.
fn has_empty_line(text: &[u8]) -> bool {
    let mut at = 0;
    let mut is_after_break = false;
    while let Some(rest) = text.get(at..).filter(|it| !it.is_empty()) {
        let len = strings::js_line_break_len(rest);
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
#[cold]
#[inline(never)]
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
        if strings::contains_char(between, b',') && !strings::contains_char(between, b'\n') {
            lifted.end = comment.end();
        }
    }
    lifted
}

impl SortKeys {
    /// oxlint's `collect_fixable_properties`: `None` unless the names of all properties are known, they are one group,
    /// spreads are only before and after them, and every comment moves with a property. `known`: the fixes of the
    /// object literals in `props`.
    #[cold]
    #[inline(never)]
    fn collect_fixable_properties<'a, 'k>(
        &self,
        (whole, props): (Span, List<'a, Prop<'a>>),
        known: &'k Fixes<'a>,
    ) -> Option<Vec<FixableProperty<'a, 'k>>> {
        let file = props.first()?.file();
        let has_comments = |at: Span| file.comments_in(at).next().is_some();
        let (mut has_spread_after, mut is_group_over) = (false, false);
        let mut found: Vec<FixableProperty<'a, 'k>> = Vec::with_capacity(props.len());
        // What is before the property, and whether that is a spread.
        let (mut before, mut is_after_spread) = (Span::empty(whole.start), false);
        for (index, prop) in props.iter().enumerate() {
            let next = props.get(index + 1);
            let span = lift_property_span(file, prop, next.map_or(whole.end, |it| it.span().start));
            // Between two spreads there can be comments.
            if has_comments(before.between(span)) && !(is_after_spread && prop.key().is_none()) {
                return None;
            }
            (before, is_after_spread) = (span, prop.key().is_none());
            let Some(key) = prop.key() else {
                has_spread_after = !found.is_empty();
                continue;
            };
            if has_spread_after || is_group_over {
                return None;
            }
            is_group_over = self.allows_line_separated_groups
                && next.is_some_and(|next| has_empty_line(file.slice(prop.span().between(next.span()))));
            let value = prop.value().filter(|it| !it.is_parenthesized());
            found.push(FixableProperty {
                key: get_property_name(key, true)?,
                span,
                nested: value.and_then(|it| known.get(&it)?.as_ref()),
                has_comma: span.end > prop.span().end,
            });
        }
        (!has_comments(Span::after(before, whole.end))).then_some(found)
    }

    /// oxlint's `build_object_fix`.
    #[cold]
    #[inline(never)]
    fn build_object_fix<'a>(&self, object: Expr<'a>, known: &Fixes<'a>) -> ObjectFix {
        let ExprKind::Object(list) = object.kind() else {
            return None;
        };
        let (file, props) = (object.file(), self.collect_fixable_properties((object.span(), list), known)?);
        let (first, last) = (props.first()?, props.last()?);
        let mut sorted: Vec<&FixableProperty> = props.iter().collect();
        utils::sort::sort_by(&mut sorted, |a, b| {
            let order = compare_keys_as_oxlint(&a.key, &b.key, self.is_natural, self.is_insensitive);
            if self.is_descending { order.reverse() } else { order }
        });
        let is_in_order = sorted.iter().zip(&props).all(|(a, b)| a.span == b.span);
        if is_in_order && props.iter().all(|it| it.nested.is_none()) {
            return None;
        }
        // What is between the first two, without the `,`, comes between all.
        let raw = props.get(1).map_or(&b" "[..], |second| file.slice(first.span.between(second.span)));
        let between = strings::split_once_char(raw, b',').unwrap_or((raw, &[]));
        let mut text = Vec::new();
        for (index, prop) in sorted.iter().enumerate() {
            let mut from = prop.span.start;
            if let Some((replaced, inner)) = prop.nested {
                text.extend_from_slice(file.slice(Span::before(from, *replaced)));
                text.extend_from_slice(inner);
                from = replaced.end;
            }
            text.extend_from_slice(file.slice(Span::new(from, prop.span.end)));
            let is_last = index + 1 == sorted.len();
            if !prop.has_comma && (!is_last || last.has_comma) {
                text.push(b',');
            }
            if !is_last {
                text.extend_from_slice(between.0);
                text.extend_from_slice(between.1);
            }
        }
        Some((Span::new(first.span.start, last.span.end), text))
    }

    /// [`SortKeys::build_object_fix`] of `root`, after those of the object literals that are values in it.
    #[cold]
    #[inline(never)]
    fn fix_as_oxlint<'a>(&self, root: Expr<'a>, known: &mut Fixes<'a>) -> ObjectFix {
        let mut pending = Vec::new();
        if !known.contains_key(&root) {
            pending.push(root);
        }
        while let Some(&object) = pending.last() {
            let count = pending.len();
            if let ExprKind::Object(props) = object.kind() {
                for value in props.iter().filter_map(Prop::value) {
                    if value.tag() == ExprTag::Object && !value.is_parenthesized() && !known.contains_key(&value) {
                        pending.push(value);
                    }
                }
            }
            if pending.len() == count {
                pending.pop();
                let fix = self.build_object_fix(object, known);
                known.insert(object, fix);
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
            false => strings::order_utf16(&a, &b),
        };
        order != Ordering::Greater
    }
}

impl Rule for SortKeys {
    const META: Meta = Meta::eslint("sort-keys", Kind::Suggestion);
    const ON: On = On::new().exprs(&[ExprTag::Object]);
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

    fn start<'a>(&self, _: &'a File<'a>) -> Option<Fixes<'a>> {
        Some(Fixes::default())
    }

    fn expr<'a>(&self, object: Expr<'a>, cx: &mut Cx<'a, Self>) {
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
