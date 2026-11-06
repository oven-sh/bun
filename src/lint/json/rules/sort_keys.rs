use crate::{Document, Member, NodeKind};
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use std::cmp::Ordering;

/// Require JSON object keys to be sorted
pub struct SortKeys {
    is_descending: bool,
    is_insensitive: bool,
    is_natural: bool,
    min_keys: usize,
    allows_line_separated_groups: bool,
}

const SORT_KEYS: &Message = &Message::new(
    "sortKeys",
    "Expected object keys to be in {{sortName}} case-{{sensitivity}} {{direction}} order. '{{thisName}}' should be before '{{prevName}}'.",
);

/// Returns true if there's a blank line between the two members. A line inside a comment doesn't count as blank.
fn is_line_separated<'a>(file: &'a File<'a>, document: Document<'a>, gap: Span) -> bool {
    let (last, first) = (file.line_of(gap.start), file.line_of(gap.end));
    if first - last < 2 {
        return false;
    }
    let comments = document.comments();
    let mut comments = comments[comments.partition_point(|it| it.start < gap.start)..].iter();
    let mut comment = comments.next();
    (last + 1..first).any(|line| {
        while comment.is_some_and(|it| file.line_of(it.end) < line) {
            comment = comments.next();
        }
        !comment.is_some_and(|it| file.line_of(it.start) <= line)
            && strings::is_all_js_whitespace(file.line_text(line))
    })
}

/// Returns true if the token before `member`, or the one after `member` and its comma, is a comment.
fn has_adjacent_comment(document: Document, member: &Member) -> bool {
    let (text, span, comments) = (document.text(), member.span(), document.comments());
    let before = text.get(..span.start as usize).unwrap_or_default();
    let previous_end = strings::trim_js_whitespace_end(before).len() as u32;
    let previous = comments[..comments.partition_point(|it| it.end <= span.start)].last();
    let after = text.get(span.end as usize..).unwrap_or_default();
    let after = strings::trim_js_whitespace_start(after);
    let after = strings::trim_js_whitespace_start(after.strip_prefix(b",").unwrap_or(after));
    previous.is_some_and(|it| it.end == previous_end) || after.starts_with(b"/")
}

impl SortKeys {
    /// `isValidOrder(a, b)`
    fn is_valid_order(&self, a: &[u8], b: &[u8]) -> bool {
        let (a, b) = match self.is_descending {
            true => (b, a),
            false => (a, b),
        };
        let compare = match self.is_natural {
            true => text::natural_compare,
            false => strings::order_utf16,
        };
        let order = match self.is_insensitive {
            true => compare(&text::to_lower_case(a), &text::to_lower_case(b)),
            false => compare(a, b),
        };
        order != Ordering::Greater
    }
}

impl Rule for SortKeys {
    const META: Meta = Meta::plugin(Plugin::Json, "sort-keys", Kind::Suggestion)
        .fixable(Fixable::Code)
        .languages(crate::LANGUAGES);
    const ON: On = On::new().finish();
    type State<'a> = Document<'a>;

    fn new(options: &Options) -> Self {
        let object = options.object(1);
        SortKeys {
            is_descending: options.str(0) == Some("desc"),
            is_insensitive: !object.bool_or("caseSensitive", true),
            is_natural: object.bool_or("natural", false),
            min_keys: object.usize("minKeys").unwrap_or(2),
            allows_line_separated_groups: object.bool_or("allowLineSeparatedGroups", false),
        }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Document<'a>> {
        Document::of(file)
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let (file, document) = (cx.file(), cx.state);
        for object in document.nodes().filter(|it| it.kind() == NodeKind::Object) {
            if self.min_keys > 2 && object.members().count() < self.min_keys {
                continue;
            }
            let mut members = object.members();
            let Some(mut previous) = members.next() else {
                continue;
            };
            for member in members {
                let before = std::mem::replace(&mut previous, member);
                if self.is_valid_order(before.key(), member.key())
                    || self.allows_line_separated_groups
                        && is_line_separated(file, document, before.span().between(member.span()))
                {
                    continue;
                }
                cx.report(member.name, SORT_KEYS)
                    .data("thisName", member.raw_key())
                    .data("prevName", before.raw_key())
                    .data("direction", if self.is_descending { "descending" } else { "ascending" })
                    .data("sensitivity", if self.is_insensitive { "insensitive" } else { "sensitive" })
                    .data("sortName", if self.is_natural { "natural" } else { "alphanumeric" })
                    .listened_on(object)
                    .fix(|fixer| {
                        if has_adjacent_comment(document, &member)
                            || has_adjacent_comment(document, &before)
                        {
                            return None;
                        }
                        let text = |it: Member| file.slice(it.span());
                        Some([
                            fixer.replace(member, text(before)),
                            fixer.replace(before, text(member)),
                        ])
                    });
            }
        }
    }
}
