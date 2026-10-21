use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::tokens::next_token;
use bun_lint::types::IdMap;
use smallvec::SmallVec;
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

/// Returns the property's static name, or else the name of the identifier in `[name]`, which oxlint skips.
#[inline]
fn get_property_name(key: Key<'_>, is_oxlint: bool) -> Option<Cow<'_, [u8]>> {
    match key.kind() {
        KeyKind::Ident(name) => Some(Cow::Borrowed(name.bytes())),
        KeyKind::Computed(e) => ast_utils::get_static_key_name(key)
            .or_else(|| e.as_ident().filter(|_| !is_oxlint).map(|name| Cow::Borrowed(name.bytes()))),
        _ => ast_utils::get_static_key_name(key),
    }
}

/// True if there's a blank line between `previous` and `current` that isn't inside a token or a comment.
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

/// oxlint's `take_numeric`: returns the number that starts with the digit `first` and continues in `rest`. It wraps on
/// overflow, and also consumes the character after the number.
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

/// oxlint's `compare_keys`: compares UTF-8 bytes, or uses its own `natural_compare`. Case folding only applies to ASCII
/// letters.
fn oxlint_compare_keys(a: &[u8], b: &[u8], is_natural: bool, is_insensitive: bool) -> Ordering {
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

/// The span that oxlint's fix replaces in an object literal, and the replacement text.
type ObjectFix = Option<(Span, Vec<u8>)>;

/// Caches the [`ObjectFix`] of each object literal.
type Fixes<'a> = IdMap<Expr<'a>, ObjectFix>;

/// oxlint's `FixableProperty`.
struct FixableProperty<'a, 'k> {
    key: Cow<'a, [u8]>,
    /// The result of [`lift_property_span`].
    span: Span,
    /// The fix for the value, if it's an object literal.
    nested: Option<&'k (Span, Vec<u8>)>,
    /// True if `span` extends to a comment after the `,`.
    has_comma: bool,
}

/// oxlint's `has_blank_line`: true if a line after the first is completely empty.
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

/// oxlint's `lift_property_span`: returns the property's span, extended back to the first JSDoc comment that oxc
/// attaches to it (the ones before it that aren't on the previous token's line), and forward to the end of a `// ..`
/// after its `,` on the same line. `after` is the previous property, or the object's start. `boundary` is the next
/// property's start, or the object's end.
#[cold]
#[inline(never)]
fn lift_property_span<'a>(file: &'a File<'a>, prop: Prop<'a>, after: Result<Prop<'a>, u32>, boundary: u32) -> Span {
    let whole = prop.span();
    let mut lifted = whole;
    // The `{`, or the `,`.
    let token_before = match after {
        Ok(previous) => Some(next_token(file.text(), previous.span().end)).filter(|it| file.slice(*it) == b","),
        Err(start) => Some(Span::new(start, start + 1)),
    };
    let token_before = token_before.or_else(|| file.token_before(prop).map(|it| it.span()));
    let is_on_line_of_previous_token = |at: u32| {
        token_before.is_some_and(|it| !strings::contains_js_line_break(file.slice(Span::after(it, at))))
    };
    let is_on_previous_token_line = is_on_line_of_previous_token(whole.start);
    for comment in file.comments_before(prop).rev() {
        if !is_on_previous_token_line && is_on_line_of_previous_token(comment.start()) {
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
    /// oxlint's `collect_fixable_properties`: returns `None` unless every property's name is known, they form one
    /// group, spreads only come before and after them, and every comment moves with a property. `fixes` has the fixes
    /// of the object literals in `props`.
    #[cold]
    #[inline(never)]
    fn collect_fixable_properties<'a, 'k>(
        &self,
        (whole, props): (Span, List<'a, Prop<'a>>),
        fixes: &'k Fixes<'a>,
    ) -> Option<Vec<FixableProperty<'a, 'k>>> {
        let file = props.first()?.file();
        // Every comment query below is inside the object, so one check up front can skip them all.
        let object_has_comments = file.comments_in(whole).next().is_some();
        let has_comments = |at: Span| object_has_comments && file.comments_in(at).next().is_some();
        let (mut has_spread_after, mut has_group_ended) = (false, false);
        let mut found: Vec<FixableProperty<'a, 'k>> = Vec::with_capacity(props.len());
        // The span of the previous property, and true if that's a spread.
        let (mut before, mut is_after_spread) = (Span::empty(whole.start), false);
        let mut after = Err(whole.start);
        for (index, prop) in props.iter().enumerate() {
            let next = props.get(index + 1);
            let span = match object_has_comments {
                true => lift_property_span(file, prop, after, next.map_or(whole.end, |it| it.span().start)),
                false => prop.span(),
            };
            after = Ok(prop);
            // Between two spreads there can be comments.
            let key = prop.key();
            if has_comments(before.between(span)) && !(is_after_spread && key.is_none()) {
                return None;
            }
            (before, is_after_spread) = (span, key.is_none());
            let Some(key) = key else {
                has_spread_after = !found.is_empty();
                continue;
            };
            if has_spread_after || has_group_ended {
                return None;
            }
            has_group_ended = self.allows_line_separated_groups
                && next.is_some_and(|next| has_empty_line(file.slice(prop.span().between(next.span()))));
            let value = prop.value().filter(|it| it.tag() == ExprTag::Object && !it.is_parenthesized());
            found.push(FixableProperty {
                key: get_property_name(key, true)?,
                span,
                nested: value.and_then(|it| fixes.get(it)?.as_ref()),
                has_comma: span.end > prop.span().end,
            });
        }
        (!has_comments(Span::after(before, whole.end))).then_some(found)
    }

    /// oxlint's `build_object_fix`.
    #[cold]
    #[inline(never)]
    fn build_object_fix<'a>(&self, object: Expr<'a>, fixes: &Fixes<'a>) -> ObjectFix {
        let list = object.as_object()?;
        let (file, props) = (object.file(), self.collect_fixable_properties((object.span(), list), fixes)?);
        let (first, last) = (props.first()?, props.last()?);
        let mut sorted: Vec<&FixableProperty> = props.iter().collect();
        // With `natural` the comparison isn't transitive: `a10` < `a1b` < `a2` < `a10`. After the sort, a key is still
        // never greater than the next one, which is all the rule checks, so fixed code isn't reported again.
        utils::sort::sort_by(&mut sorted, |a, b| {
            let order = oxlint_compare_keys(&a.key, &b.key, self.is_natural, self.is_insensitive);
            if self.is_descending { order.reverse() } else { order }
        });
        let is_in_order = sorted.iter().zip(&props).all(|(a, b)| a.span == b.span);
        if is_in_order && props.iter().all(|it| it.nested.is_none()) {
            return None;
        }
        // The text between the first two properties, without the `,`, becomes the separator for all of them.
        let raw = props.get(1).map_or(&b" "[..], |second| file.slice(first.span.between(second.span)));
        let between = strings::split_once_char(raw, b',').unwrap_or((raw, &[]));
        let replaced = Span::new(first.span.start, last.span.end);
        let mut text = Vec::with_capacity(replaced.len() as usize + 8);
        for (index, prop) in sorted.iter().enumerate() {
            let mut from = prop.span.start;
            if let Some((nested, inner)) = prop.nested {
                text.extend_from_slice(file.slice(Span::before(from, *nested)));
                text.extend_from_slice(inner);
                from = nested.end;
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
        Some((replaced, text))
    }

    /// Runs [`SortKeys::build_object_fix`] on `root`, after running it on the object literals that are values in it.
    #[cold]
    #[inline(never)]
    fn fix_as_oxlint<'a>(&self, root: Expr<'a>, fixes: &mut Fixes<'a>) -> ObjectFix {
        let mut pending: SmallVec<[Expr<'a>; 8]> = SmallVec::new();
        if !fixes.contains_key(root) {
            pending.push(root);
        }
        while let Some(&object) = pending.last() {
            let count = pending.len();
            if let Some(props) = object.as_object() {
                for value in props.iter().filter_map(Prop::value) {
                    if value.tag() == ExprTag::Object && !value.is_parenthesized() && !fixes.contains_key(value) {
                        pending.push(value);
                    }
                }
            }
            if pending.len() == count {
                pending.pop();
                let fix = self.build_object_fix(object, fixes);
                fixes.insert(object, fix);
            }
        }
        fixes.get(root)?.clone()
    }

    fn is_valid_order(&self, a: &[u8], b: &[u8], is_oxlint: bool) -> bool {
        if is_oxlint {
            let order = oxlint_compare_keys(a, b, self.is_natural, self.is_insensitive);
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
        let Some(props) = object.as_object() else {
            return;
        };
        if props.len() < self.min_keys {
            return;
        }
        let is_oxlint = cx.language().is_oxlint;
        let mut is_pattern: Option<bool> = None;
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

            let Some(this_name) = get_property_name(key, is_oxlint) else {
                prev_blank_line |= starts_group;
                continue;
            };
            let before = prev_name.replace(this_name.clone());
            if starts_group {
                prev_blank_line = false;
                continue;
            }
            if let Some(before) = before
                && !self.is_valid_order(&before, &this_name, is_oxlint)
            {
                if *is_pattern.get_or_insert_with(|| utils::is_assignment_target(object)) {
                    return;
                }
                // oxlint reports an object once, without any names, and points at the whole object.
                if is_oxlint {
                    cx.report(object, SORT_KEYS).fix(|fixer| {
                        let (replaced, text) = self.fix_as_oxlint(object, &mut cx.state)?;
                        Some(fixer.replace(replaced, text))
                    });
                    return;
                }
                cx.report(key.inner_span(cx.file()), SORT_KEYS)
                    .data("thisName", this_name)
                    .data("prevName", before)
                    .data("order", if self.is_descending { "desc" } else { "asc" })
                    .data("insensitive", if self.is_insensitive { "insensitive " } else { "" })
                    .data("natural", if self.is_natural { "natural " } else { "" });
            }
        }
    }
}
