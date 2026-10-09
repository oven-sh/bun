use bun_lint::prelude::*;
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

impl SortKeys {
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
                cx.report(if is_oxlint { object.span() } else { key.inner_span(cx.file()) }, SORT_KEYS)
                    .data("thisName", this_name)
                    .data("prevName", before)
                    .data("order", if self.is_descending { "desc" } else { "asc" })
                    .data("insensitive", if self.is_insensitive { "insensitive " } else { "" })
                    .data("natural", if self.is_natural { "natural " } else { "" });
                if is_oxlint {
                    return;
                }
            }
        }
    }
}

impl Rule for SortKeys {
    const META: Meta = Meta::eslint("sort-keys", Kind::Suggestion);
    type State<'a> = ();

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

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Object], Self::check);
    }
}
