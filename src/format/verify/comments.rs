//! The comments of the two programs.

use super::Difference;
use bun_core::strings;
use bun_lint::ast::File;
use bun_lint::tokens::{Token, skip_trivia};

/// The text of a program, and where its comments are.
type Comments<'a> = (&'a [u8], &'a [(u32, u32)]);

fn text_of<'a>(text: &'a [u8], comment: (u32, u32)) -> &'a [u8] {
    text.get(comment.0 as usize..comment.1 as usize)
        .unwrap_or_default()
}

/// Allowed: the white space at the start and at the end of the lines of a comment.
fn lines(comment: &[u8]) -> impl Iterator<Item = &[u8]> {
    // A `\r` ends a line too, and `\r\n` is one end.
    let mut rest = Some(comment);
    std::iter::from_fn(move || {
        let text = rest?;
        let Some(end) = strings::index_of_any(text, b"\r\n") else {
            rest = None;
            return Some(strings::trim_js_whitespace(text));
        };
        let after = if text.get(end..end + 2) == Some(b"\r\n") {
            end + 2
        } else {
            end + 1
        };
        rest = text.get(after..);
        text.get(..end).map(strings::trim_js_whitespace)
    })
}

fn is_same(before: &[u8], after: &[u8]) -> bool {
    before == after || lines(before).eq(lines(after))
}

/// Allowed: the comments are in another order.
#[cold]
fn compare_in_any_order(before: Comments<'_>, after: Comments<'_>) -> Result<(), Difference> {
    let sorted = |(text, comments): Comments<'_>| {
        let mut all: Vec<(Vec<u8>, u32)> = comments
            .iter()
            .map(|&it| (bstr::join(b"\n", lines(text_of(text, it))), it.0))
            .collect();
        crate::sort::sort(&mut all[..]);
        all
    };
    let (xs, ys) = (sorted(before), sorted(after));
    let different = xs
        .iter()
        .zip(&ys)
        .find(|(x, y)| x.0 != y.0)
        .map(|(x, y)| (x.1, y.1));
    let place = |all: &[(Vec<u8>, u32)], at: usize, text: &[u8]| {
        all.get(at).map_or(text.len() as u32, |it| it.1)
    };
    let shorter = xs.len().min(ys.len());
    match different {
        Some((x, y)) => Err(Difference::new("a comment", (before.0, x), (after.0, y))),
        None if xs.len() == ys.len() => Ok(()),
        None => Err(Difference::new(
            "the number of comments",
            (before.0, place(&xs, shorter, before.0)),
            (after.0, place(&ys, shorter, after.0)),
        )),
    }
}

/// The `#!` line of `text`.
fn hashbang(text: &[u8]) -> &[u8] {
    if !text.starts_with(b"#!") {
        return &[];
    }
    let line = text
        .get(..strings::index_of_any(text, b"\n\r").unwrap_or(text.len()))
        .unwrap_or(text);
    // U+2028 and U+2029 end the line too.
    let ends = [&b"\xE2\x80\xA8"[..], b"\xE2\x80\xA9"]
        .into_iter()
        .filter_map(|it| strings::index_of(line, it));
    line.get(..ends.min().unwrap_or(line.len()))
        .unwrap_or(line)
        .trim_ascii_end()
}

/// The tree does not list the comments of HTML, `<!-- a` and `--> a`. Those of `file` have to be
/// somewhere in `after`.
fn find_html_comments<'f>(file: &'f File<'f>, after: &[u8]) -> Result<(), Difference> {
    let text = file.text();
    if !file.is_javascript()
        || file.is_module()
        || !(strings::contains(text, b"<!--") || strings::contains(text, b"-->"))
    {
        return Ok(());
    }
    // At the end of a line.
    let is_in_after = |comment: &[u8]| {
        let mut rest = after;
        while let Some(at) = strings::index_of(rest, comment) {
            rest = rest.get(at + comment.len()..).unwrap_or_default();
            if matches!(rest.trim_ascii_start().len(), len if len == 0 || strings::index_of_any(&rest[..rest.len() - len], b"\r\n").is_some())
            {
                return true;
            }
        }
        false
    };
    let is_missing = |it: &Token<'_>| {
        (it.text().starts_with(b"<!--") || it.text().starts_with(b"-->"))
            && !is_in_after(it.text().trim_ascii_end())
    };
    match file.comments().find(is_missing) {
        Some(comment) => Err(Difference::new(
            "a comment",
            (text, comment.start()),
            (after, after.len() as u32),
        )),
        None => Ok(()),
    }
}

/// What is between `/**` and `*/`, if `comment` is a JSDoc comment.
fn jsdoc(comment: &[u8]) -> Option<&[u8]> {
    comment
        .strip_prefix(b"/**")?
        .strip_suffix(b"*/")
        .filter(|inner| !inner.iter().all(|&it| it == b'*'))
}

/// Whether the JSDoc comment says more than the name of one tag. One that does not can be left out.
fn says_something(inner: &[u8]) -> bool {
    let is_part_of_word = |it: &u8| it.is_ascii_alphanumeric() || !it.is_ascii();
    let mut words = inner
        .split(|it| !is_part_of_word(it) && *it != b'@')
        .filter(|it| !it.is_empty());
    match words.next() {
        Some([b'@', ..]) => words.next().is_some(),
        first => first.is_some(),
    }
}

/// The name or the keyword that follows the comment, if it is one that follows.
fn word_after(text: &[u8], comment: (u32, u32)) -> &[u8] {
    let rest = text
        .get(skip_trivia(text, comment.1) as usize..)
        .unwrap_or_default();
    let len = rest
        .iter()
        .take_while(|it| it.is_ascii_alphanumeric() || matches!(it, b'_' | b'$'))
        .count();
    rest.get(..len).unwrap_or_default()
}

/// Allowed, if JSDoc comments are formatted: anything in them, and those that say nothing are left out. If none is,
/// each is before the same word.
fn compare_without_jsdoc(before: Comments<'_>, after: Comments<'_>) -> Result<(), Difference> {
    type Lists = (Vec<(u32, u32)>, Vec<(u32, u32)>);
    // Those that are not JSDoc comments, and those that are.
    let split = |(text, comments): Comments<'_>| -> Lists {
        comments
            .iter()
            .partition(|&&it| jsdoc(text_of(text, it)).is_none())
    };
    let (x, y) = (split(before), split(after));
    let can_be_left_out =
        x.1.iter()
            .filter(|&&it| !jsdoc(text_of(before.0, it)).is_some_and(says_something))
            .count();
    if x.1.len() < y.1.len() || x.1.len() - y.1.len() > can_be_left_out {
        let end = |text: &[u8]| text.len() as u32;
        return Err(Difference::new(
            "the number of JSDoc comments",
            (before.0, end(before.0)),
            (after.0, end(after.0)),
        ));
    }
    for (&p, &q) in x.1.iter().zip(&y.1).filter(|_| x.1.len() == y.1.len()) {
        let (word, word2) = (word_after(before.0, p), word_after(after.0, q));
        if word != word2 && !word.is_empty() && !word2.is_empty() {
            return Err(Difference::new(
                "what follows a JSDoc comment",
                (before.0, p.0),
                (after.0, q.0),
            ));
        }
    }
    compare_in_any_order((before.0, &x.0), (after.0, &y.0))
}

/// `file`: the program before. `formats_jsdoc`: the option `jsdoc` is set.
pub(super) fn compare<'f>(
    file: &'f File<'f>,
    before: Comments<'_>,
    after: Comments<'_>,
    formats_jsdoc: bool,
) -> Result<(), Difference> {
    if hashbang(before.0) != hashbang(after.0) {
        return Err(Difference::new(
            "the `#!` line",
            (before.0, 0),
            (after.0, 0),
        ));
    }
    find_html_comments(file, after.0)?;
    if formats_jsdoc {
        return compare_without_jsdoc(before, after);
    }
    let is_same_in_order = before.1.len() == after.1.len()
        && (before.1.iter().zip(after.1))
            .all(|(&x, &y)| is_same(text_of(before.0, x), text_of(after.0, y)));
    match is_same_in_order {
        true => Ok(()),
        false => compare_in_any_order(before, after),
    }
}
