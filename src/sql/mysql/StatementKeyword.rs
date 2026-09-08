//! MySQL replies carry no command tag, so `result.command` is the leading
//! keyword of the statement in the query text.

use core::ops::Range;

/// Yields the leading keyword of each `;`-separated statement, one per
/// result, skipping comments (but not `/*! ... */`) and ignoring `;` inside
/// quotes and comments. A statement's text is scanned only when the next
/// result arrives. `ANSI_QUOTES` is not modelled.
#[derive(Clone, Copy, Default)]
pub struct KeywordCursor {
    /// Just past the keyword last returned, inside that statement.
    pos: usize,
    started: bool,
    keyword: (usize, usize),
}

impl KeywordCursor {
    /// Range of the next statement's leading keyword in `sql` (Latin-1 or
    /// UTF-16 units), empty when it has none. Past the last statement (a
    /// `CALL` yields several results) the previous keyword is returned again.
    pub fn next<T: Copy + Into<u32>>(
        &mut self,
        sql: &[T],
        backslash_escapes: bool,
    ) -> Range<usize> {
        let mut pos = self.pos;
        if self.started {
            match statement_end(sql, pos, backslash_escapes) {
                Some(end) => pos = end + 1,
                None => return self.keyword.0..self.keyword.1,
            }
        }
        self.started = true;
        pos = skip_to_keyword(sql, pos);
        let start = pos;
        while pos < sql.len() && is_alpha(sql[pos]) {
            pos += 1;
        }
        self.pos = pos;
        if pos > start || self.keyword.1 == 0 {
            self.keyword = (start, pos);
        }
        self.keyword.0..self.keyword.1
    }
}

#[inline]
fn at<T: Copy + Into<u32>>(sql: &[T], pos: usize) -> u32 {
    if pos < sql.len() { sql[pos].into() } else { 0 }
}

#[inline]
fn is_alpha<T: Copy + Into<u32>>(c: T) -> bool {
    let c: u32 = c.into();
    (c | 0x20) >= u32::from(b'a') && (c | 0x20) <= u32::from(b'z')
}

#[inline]
fn is_digit(c: u32) -> bool {
    c >= u32::from(b'0') && c <= u32::from(b'9')
}

/// Length of a `/*!`, `/*!50701` or `/*M!100504` opener at `pos`: the server
/// runs what follows as SQL.
fn executable_comment_prefix<T: Copy + Into<u32>>(sql: &[T], pos: usize) -> Option<usize> {
    if at(sql, pos) != u32::from(b'/') || at(sql, pos + 1) != u32::from(b'*') {
        return None;
    }
    let mut end = pos + 2;
    if at(sql, end) == u32::from(b'M') {
        end += 1;
    }
    if at(sql, end) != u32::from(b'!') {
        return None;
    }
    end += 1;
    while is_digit(at(sql, end)) {
        end += 1;
    }
    Some(end - pos)
}

/// Skips whitespace, comments, executable-comment openers and `(`.
fn skip_to_keyword<T: Copy + Into<u32>>(sql: &[T], mut pos: usize) -> usize {
    while pos < sql.len() {
        let c = at(sql, pos);
        if c == u32::from(b' ')
            || (c >= u32::from(b'\t') && c <= u32::from(b'\r'))
            || c == u32::from(b'(')
        {
            pos += 1;
        } else if let Some(len) = executable_comment_prefix(sql, pos) {
            pos += len;
        } else if let Some(end) = comment_end(sql, pos) {
            pos = end;
        } else {
            break;
        }
    }
    pos
}

/// End of the comment starting at `pos`, if one does (`1--1` is arithmetic).
fn comment_end<T: Copy + Into<u32>>(sql: &[T], pos: usize) -> Option<usize> {
    let c = at(sql, pos);
    if c == u32::from(b'#')
        || (c == u32::from(b'-')
            && at(sql, pos + 1) == u32::from(b'-')
            && at(sql, pos + 2) <= u32::from(b' '))
    {
        let mut end = pos;
        while end < sql.len() && at(sql, end) != u32::from(b'\n') {
            end += 1;
        }
        return Some(end);
    }
    if c == u32::from(b'/')
        && at(sql, pos + 1) == u32::from(b'*')
        && executable_comment_prefix(sql, pos).is_none()
    {
        let mut end = pos + 2;
        while end < sql.len()
            && !(at(sql, end) == u32::from(b'*') && at(sql, end + 1) == u32::from(b'/'))
        {
            end += 1;
        }
        return Some((end + 2).min(sql.len()));
    }
    None
}

/// Position of the `;` that ends the statement containing `pos`, if any.
fn statement_end<T: Copy + Into<u32>>(
    sql: &[T],
    mut pos: usize,
    backslash_escapes: bool,
) -> Option<usize> {
    while pos < sql.len() {
        let c = at(sql, pos);
        if c == u32::from(b';') {
            return Some(pos);
        }
        if c == u32::from(b'\'') || c == u32::from(b'"') || c == u32::from(b'`') {
            pos += 1;
            while pos < sql.len() {
                let q = at(sql, pos);
                if q == u32::from(b'\\') && backslash_escapes && c != u32::from(b'`') {
                    pos += 2;
                } else if q == c {
                    // A doubled quote is an escaped quote, not the end.
                    if at(sql, pos + 1) == c {
                        pos += 2;
                    } else {
                        break;
                    }
                } else {
                    pos += 1;
                }
            }
            pos += 1;
        } else if let Some(end) = comment_end(sql, pos) {
            pos = end;
        } else {
            pos += 1;
        }
    }
    None
}
