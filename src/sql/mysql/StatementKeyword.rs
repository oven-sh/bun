//! MySQL replies carry no command tag (PostgreSQL sends `CommandComplete`
//! with `INSERT 0 3`, `UPDATE 2`, ...), so `result.command` is derived from
//! the query text: the leading keyword of the statement that produced the
//! result.

/// Returns the leading keyword of the `index`-th `;`-separated statement in
/// `sql`. Whitespace, comments and opening parentheses before the keyword are
/// skipped, and quoted strings, quoted identifiers and comments do not split
/// statements. When `sql` has fewer statements than `index + 1` (a `CALL`
/// produces one result per result set plus one), the last keyword found is
/// returned. The slice is empty when there is no keyword.
///
/// Generic over the code unit so it runs on both Latin-1 and UTF-16 strings
/// without transcoding.
pub fn keyword_of_statement<T: Copy + Into<u32>>(sql: &[T], index: usize) -> &[T] {
    let mut keyword: &[T] = &[];
    let mut pos = 0usize;
    let mut statement = 0usize;
    loop {
        pos = skip_to_keyword(sql, pos);
        let start = pos;
        while pos < sql.len() && is_alpha(sql[pos]) {
            pos += 1;
        }
        if pos > start {
            keyword = &sql[start..pos];
        }
        if statement == index {
            return keyword;
        }
        match statement_end(sql, pos) {
            Some(end) => pos = end + 1,
            None => return keyword,
        }
        statement += 1;
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

/// Skips whitespace, comments and `(` starting at `pos`.
fn skip_to_keyword<T: Copy + Into<u32>>(sql: &[T], mut pos: usize) -> usize {
    while pos < sql.len() {
        let c = at(sql, pos);
        if c == u32::from(b' ') || (c >= u32::from(b'\t') && c <= u32::from(b'\r')) || c == u32::from(b'(') {
            pos += 1;
        } else if let Some(end) = comment_end(sql, pos) {
            pos = end;
        } else {
            break;
        }
    }
    pos
}

/// When a comment starts at `pos`, returns the position just past it.
fn comment_end<T: Copy + Into<u32>>(sql: &[T], pos: usize) -> Option<usize> {
    let c = at(sql, pos);
    if c == u32::from(b'#') || (c == u32::from(b'-') && at(sql, pos + 1) == u32::from(b'-')) {
        let mut end = pos;
        while end < sql.len() && at(sql, end) != u32::from(b'\n') {
            end += 1;
        }
        return Some(end);
    }
    if c == u32::from(b'/') && at(sql, pos + 1) == u32::from(b'*') {
        let mut end = pos + 2;
        while end < sql.len() && !(at(sql, end) == u32::from(b'*') && at(sql, end + 1) == u32::from(b'/')) {
            end += 1;
        }
        return Some((end + 2).min(sql.len()));
    }
    None
}

/// Position of the `;` that ends the statement containing `pos`, if any.
fn statement_end<T: Copy + Into<u32>>(sql: &[T], mut pos: usize) -> Option<usize> {
    while pos < sql.len() {
        let c = at(sql, pos);
        if c == u32::from(b';') {
            return Some(pos);
        }
        if c == u32::from(b'\'') || c == u32::from(b'"') || c == u32::from(b'`') {
            pos += 1;
            while pos < sql.len() {
                let q = at(sql, pos);
                if q == u32::from(b'\\') && c != u32::from(b'`') {
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
