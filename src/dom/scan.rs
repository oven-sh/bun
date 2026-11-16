//! Finds the rules of a style sheet, and what an element must have for each to matter, without parsing them.

use crate::name::Name;
use crate::selector::key;

fn is_space(byte: u8) -> bool {
    matches!(byte, b' ' | b'\t' | b'\n' | b'\r' | 0x0c)
}

fn is_name(byte: u8) -> bool {
    const TABLE: [bool; 256] = {
        let (mut table, mut byte) = ([false; 256], 0);
        while byte < 256 {
            table[byte] = matches!(byte as u8, b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'-' | b'_' | 0x80..);
            byte += 1;
        }
        table
    };
    TABLE[usize::from(byte)]
}

const IS_SPECIAL: [bool; 256] = {
    let (mut table, special, mut index) = ([false; 256], b"{}()[]\"'\\/;", 0);
    while index < special.len() {
        table[special[index] as usize] = true;
        index += 1;
    }
    table
};

fn after_comment(source: &[u8], at: usize) -> usize {
    bun_core::strings::index_of(&source[at + 2..], b"*/").map_or(source.len(), |it| at + it + 4)
}

fn after_string(source: &[u8], mut at: usize) -> usize {
    let quote = source[at];
    at += 1;
    while let Some(&byte) = source.get(at) {
        match byte {
            b'\\' => at += 2,
            b'\n' | b'\r' | 0x0c => return at,
            _ if byte == quote => return at + 1,
            _ => at += 1,
        }
    }
    source.len()
}

/// `at` is the parenthesis. `None` if it does not start a URL without quotes.
fn after_url(source: &[u8], at: usize) -> Option<usize> {
    let [before @ .., b'u' | b'U', b'r' | b'R', b'l' | b'L'] = &source[..at] else {
        return None;
    };
    let mut at = at
        + 1
        + source[at + 1..]
            .iter()
            .take_while(|it| is_space(**it))
            .count();
    if before.last().is_some_and(|it| is_name(*it)) || matches!(source.get(at), Some(b'"' | b'\''))
    {
        return None;
    }
    while let Some(&byte) = source.get(at) {
        match byte {
            b'\\' => at += 2,
            b')' => return Some(at + 1),
            _ => at += 1,
        }
    }
    Some(source.len())
}

/// To the first byte outside of any brackets that `stops`, and whether there are braces before it.
fn skip(source: &[u8], mut at: usize, stops: impl Fn(u8) -> bool) -> (usize, bool) {
    let (mut open, mut has_braces) = (smallvec::SmallVec::<[u8; 16]>::new(), false);
    while let Some(&byte) = source.get(at) {
        if !IS_SPECIAL[usize::from(byte)] {
            at += 1;
            continue;
        }
        if open.is_empty() && stops(byte) {
            return (at, has_braces);
        }
        at = match byte {
            b'\\' => at + 2,
            b'"' | b'\'' => after_string(source, at),
            b'/' if source.get(at + 1) == Some(&b'*') => after_comment(source, at),
            b'(' if let Some(end) = after_url(source, at) => end,
            b'(' | b'[' | b'{' => {
                has_braces |= byte == b'{';
                open.push(if byte == b'(' { b')' } else { byte + 2 });
                at + 1
            }
            _ => {
                open.pop_if(|it| *it == byte);
                at + 1
            }
        };
    }
    (source.len(), has_braces)
}

trait PopIf {
    fn pop_if(&mut self, condition: impl Fn(&u8) -> bool);
}

impl PopIf for smallvec::SmallVec<[u8; 16]> {
    fn pop_if(&mut self, condition: impl Fn(&u8) -> bool) {
        if self.last().is_some_and(condition) {
            self.pop();
        }
    }
}

pub(crate) enum Next {
    /// The end of the sheet, or of the block that the rules are in.
    End(usize),
    Statement {
        start: usize,
        end: usize,
    },
    Block {
        start: usize,
        brace: usize,
    },
}

pub(crate) fn next_rule(source: &[u8], mut at: usize, is_nested: bool) -> Next {
    loop {
        match &source[at.min(source.len())..] {
            [] => return Next::End(source.len()),
            [b'}', ..] if is_nested => return Next::End(at + 1),
            [b'/', b'*', ..] => at = after_comment(source, at),
            [b'<', b'!', b'-', b'-', ..] if !is_nested => at += 4,
            [b'-', b'-', b'>', ..] if !is_nested => at += 3,
            [byte, ..] if is_space(*byte) => at += 1,
            [first, ..] => {
                let stops = |byte| {
                    byte == b'{' || byte == b';' && *first == b'@' || byte == b'}' && is_nested
                };
                let (end, _) = skip(source, at, stops);
                return match source.get(end) {
                    Some(b'{') => Next::Block {
                        start: at,
                        brace: end,
                    },
                    Some(b';') => Next::Statement {
                        start: at,
                        end: end + 1,
                    },
                    _ => Next::Statement { start: at, end },
                };
            }
        }
    }
}

/// In a block that has declarations, which count as statements. `end` is after the semicolon.
pub(crate) fn next_item(source: &[u8], mut at: usize) -> Next {
    loop {
        match &source[at.min(source.len())..] {
            [] => return Next::End(source.len()),
            [b'/', b'*', ..] => at = after_comment(source, at),
            [byte, ..] if is_space(*byte) || *byte == b';' => at += 1,
            rest => {
                let (end, _) = skip(source, at, |byte| byte == b'{' || byte == b';');
                if source.get(end) != Some(&b'{') {
                    return Next::Statement {
                        start: at,
                        end: (end + 1).min(source.len()),
                    };
                }
                let value = declaration(&source[at..end]).map(|it| it.1);
                let after = || {
                    skip(
                        source,
                        (end_of_block(source, end).0 + 1).min(source.len()),
                        |byte| byte == b'{' || byte == b';',
                    )
                    .0
                };
                if value.is_some_and(|it| {
                    rest.starts_with(b"--") || it.is_empty() && source.get(after()) != Some(&b'{')
                }) {
                    return Next::Statement {
                        start: at,
                        end: (skip(source, at, |byte| byte == b';').0 + 1).min(source.len()),
                    };
                }
                return Next::Block {
                    start: at,
                    brace: end,
                };
            }
        }
    }
}

fn trim_start(mut source: &[u8]) -> &[u8] {
    loop {
        source = source.trim_ascii_start();
        match source {
            [b'/', b'*', ..] => source = &source[after_comment(source, 0)..],
            _ => return source,
        }
    }
}

fn trim_end(mut source: &[u8]) -> &[u8] {
    loop {
        let trimmed = source.trim_ascii_end();
        source = &source[..trimmed.len()
            + usize::from(trimmed.ends_with(b"\\") && trimmed.len() < source.len())];
        let Some(before) = source.strip_suffix(b"*/") else {
            return source;
        };
        let (mut at, mut last) = (0, None);
        while at < before.len() {
            (at, last) = match before[at..] {
                [b'/', b'*', ..] => (after_comment(source, at), Some(at)),
                [b'"' | b'\'', ..] => (after_string(source, at), None),
                [b'\\', ..] => (at + 2, None),
                [b'(', ..] => (after_url(source, at).unwrap_or(at + 1), None),
                _ => (at + 1, None),
            };
        }
        let Some(start) = last else { return source };
        source = &source[..start];
    }
}

pub(crate) fn trim(source: &[u8]) -> &[u8] {
    trim_end(trim_start(source))
}

/// And whether it is important.
pub(crate) fn without_priority(value: &[u8]) -> (&[u8], bool) {
    let value = trim(value);
    let Some(at) = bun_core::strings::last_index_of_char(value, b'!') else {
        return (value, false);
    };
    let is_important = crate::values::parse_all(&value[at + 1..], |p| {
        crate::values::keyword(p, "important").then_some(())
    })
    .is_some();
    if is_important && !value[..at].ends_with(b"\\") {
        (trim_end(&value[..at]), true)
    } else {
        (value, false)
    }
}

/// The name, which is not unescaped, and what follows the colon.
pub(crate) fn declaration(source: &[u8]) -> Option<(&[u8], &[u8])> {
    let mut end = 0;
    while let Some(byte) = source.get(end) {
        end += match byte {
            b'\\' => {
                let digits = source[end + 1..]
                    .iter()
                    .take(6)
                    .take_while(|it| it.is_ascii_hexdigit())
                    .count();
                1 + digits.max(1)
                    + usize::from(
                        digits > 0 && source.get(end + 1 + digits).is_some_and(|it| is_space(*it)),
                    )
            }
            byte if is_name(*byte) || *byte == 0 => 1,
            _ => break,
        };
    }
    let (name, rest) = source.split_at_checked(end).filter(|it| !it.0.is_empty())?;
    let value = trim_start(rest).strip_prefix(b":")?;
    Some((
        name,
        trim_start(
            value
                .strip_suffix(b";")
                .filter(|it| !it.ends_with(b"\\"))
                .unwrap_or(value),
        ),
    ))
}

/// Where the closing brace is, and whether there are blocks in the block.
pub(crate) fn end_of_block(source: &[u8], brace: usize) -> (usize, bool) {
    skip(source, brace + 1, |byte| byte == b'}')
}

/// After the semicolon.
pub(crate) fn end_of_statement(source: &[u8], at: usize) -> usize {
    skip(source, at, |byte| byte == b';').0 + 1
}

pub(crate) fn at_keyword(rule: &[u8]) -> &[u8] {
    &rule[1..1 + rule[1..].iter().take_while(|it| is_name(**it)).count()]
}

#[derive(Default)]
pub(crate) struct Required {
    /// What the subject has to have.
    pub(crate) own: Option<Name>,
    /// What the subject or one of its ancestors has to have.
    pub(crate) others: Keys,
    /// The selector is that class and nothing else.
    pub(crate) is_class: bool,
}

type Keys = smallvec::SmallVec<[Name; 4]>;

#[derive(Default)]
struct Found {
    /// The lower the rank, the fewer elements have it.
    own: Option<(u8, Name)>,
    also_own: Keys,
    above: Keys,
}

impl Found {
    fn add(&mut self, new: (u8, Name)) {
        let other = match self.own {
            Some(own) if own.0 <= new.0 => Some(new),
            _ => self.own.replace(new),
        };
        self.also_own
            .extend(other.filter(|it| it.0 < TAG).map(|it| it.1));
    }

    fn all(self) -> impl Iterator<Item = Name> {
        self.own
            .filter(|it| it.0 < TAG)
            .map(|it| it.1)
            .into_iter()
            .chain(self.also_own)
            .chain(self.above)
    }
}

const TAG: u8 = 4;

struct Selectors<'a> {
    source: &'a [u8],
    at: usize,
    /// The start, the end and the value of a name that has been read.
    known: Option<(usize, usize, Name)>,
    unescaped: &'a mut Vec<u8>,
}

impl Selectors<'_> {
    fn name(&mut self) -> Option<Name> {
        let start = self.at;
        if let Some((_, end, name)) = self.known.take().filter(|it| it.0 == start) {
            self.at = end;
            return Some(name);
        }
        self.unescaped.clear();
        loop {
            let run = self.at;
            self.at += self.source[run..]
                .iter()
                .take_while(|it| is_name(**it))
                .count();
            if run == start && self.source.get(self.at) != Some(&b'\\') {
                return Some(Name::new(&self.source[start..self.at]));
            }
            self.unescaped.extend_from_slice(&self.source[run..self.at]);
            match self.source[self.at..] {
                [b'\\', digit, ..] if digit.is_ascii_hexdigit() => {
                    let digits = self.source[self.at + 1..]
                        .iter()
                        .take(6)
                        .map_while(|it| char::from(*it).to_digit(16));
                    let (count, code) = digits.fold((0, 0), |(count, code), digit| {
                        (count + 1, code * 16 + digit)
                    });
                    let character = char::from_u32(code).filter(|it| *it != '\0')?;
                    self.unescaped
                        .extend_from_slice(character.encode_utf8(&mut [0; 4]).as_bytes());
                    self.at += 1 + count;
                    self.at += match self.source[self.at..] {
                        [b'\r', b'\n', ..] => 2,
                        [byte, ..] => usize::from(is_space(byte)),
                        [] => 0,
                    };
                }
                [b'\\', b'\n' | b'\r' | 0x0c | 0, ..] | [b'\\'] => return None,
                [b'\\', byte, ..] => {
                    self.unescaped.push(byte);
                    self.at += 2;
                }
                _ => return Some(Name::new(self.unescaped)),
            }
        }
    }

    fn lowercase_name(&mut self) -> Option<Name> {
        let start = self.at;
        let name = self.name()?;
        let is_plain = |it: &u8| matches!(it, b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_');
        (self.at > start && self.source[start..self.at].iter().all(is_plain)).then_some(name)
    }

    fn close(&mut self, bracket: u8) {
        self.at = (skip(self.source, self.at, |it| it == bracket).0 + 1).min(self.source.len());
    }

    /// What all of them require.
    fn alternatives(&mut self) -> Option<Found> {
        let mut found = self.complex()?;
        while self.source.get(self.at) == Some(&b',') {
            self.at += 1;
            let other: Keys = self.complex()?.all().collect();
            found = Found {
                also_own: found.all().filter(|it| other.contains(it)).collect(),
                ..Found::default()
            };
        }
        (self.source.get(self.at) == Some(&b')')).then_some(found)
    }

    /// Up to a comma, a closing parenthesis, or the end. `None` if it takes a parser to tell.
    fn complex(&mut self) -> Option<Found> {
        let (mut found, mut is_empty) = (Found::default(), true);
        while let Some(&byte) = self.source.get(self.at) {
            let mut own = None;
            match byte {
                b',' | b')' => break,
                b'.' | b'#' => {
                    self.at += 1;
                    let name = self.name()?;
                    own = Some(if byte == b'.' {
                        (1, key::class(name))
                    } else {
                        (0, key::id(name))
                    });
                }
                b'[' => {
                    self.at += 1;
                    let (start, name) = (self.at, self.lowercase_name());
                    let (written, end) = (&self.source[start..self.at], self.at);
                    let is_plain = matches!(self.source[end..], [b']' | b'=', ..] | [_, b'=', ..]);
                    own = name
                        .filter(|_| is_plain)
                        .map(|name| (3, key::attribute(name)));
                    self.close(b']');
                    let value = match &self.source[end..self.at] {
                        [b'=', b'"', value @ .., b'"', b']']
                        | [b'=', b'\'', value @ .., b'\'', b']'] => Some(value),
                        [b'=', value @ .., b']'] => Some(value),
                        _ => None,
                    };
                    let value =
                        value.filter(|it| own.is_some() && it.iter().all(|it| is_name(*it)));
                    own = value
                        .map(|it| (2, key::value(written, it)))
                        .filter(|it| it.1 != Name::NONE)
                        .or(own);
                }
                b':' => {
                    self.at += 1 + usize::from(self.source.get(self.at + 1) == Some(&b':'));
                    let start = self.at;
                    self.name()?;
                    let name = &self.source[start..self.at];
                    let is = |it: &str| name.eq_ignore_ascii_case(it.as_bytes());
                    if is("host") || is("host-context") || is("slotted") || is("part") {
                        return None;
                    }
                    if self.source.get(self.at) == Some(&b'(') {
                        self.at += 1;
                        if is("is") || is("where") {
                            let start = self.at;
                            match self.alternatives() {
                                Some(inner) => {
                                    own = inner.own;
                                    found.also_own.extend(inner.also_own);
                                    found.above.extend(inner.above);
                                }
                                None if bun_core::strings::contains(
                                    &self.source[start..],
                                    b":host",
                                ) =>
                                {
                                    return None;
                                }
                                None => self.at = start,
                            }
                        }
                        self.close(b')');
                    }
                }
                b'*' => self.at += 1,
                b'>' | b'+' | b'~' | b' ' | b'\t' | b'\n' | b'\r' | 0x0c => {
                    let rest = &self.source[self.at..];
                    let count = rest
                        .iter()
                        .take_while(|it| is_space(**it) || matches!(it, b'>' | b'+' | b'~'))
                        .count();
                    self.at += count;
                    if is_empty || matches!(rest.get(count), None | Some(b',' | b')')) {
                        continue;
                    }
                    let above = core::mem::take(&mut found.above);
                    let left = core::mem::take(&mut found);
                    found.above = above;
                    if !rest[..count].iter().any(|it| matches!(it, b'+' | b'~')) {
                        found.above.extend(left.all());
                    }
                }
                _ if is_name(byte) => {
                    own = self.lowercase_name().map(|name| (TAG, key::tag(name)));
                }
                _ => return None,
            }
            is_empty = false;
            own.into_iter().for_each(|it| found.add(it));
        }
        Some(found)
    }
}

/// For each selector of the list. `false` if it takes a parser to tell.
pub(crate) fn requirements(
    source: &[u8],
    unescaped: &mut Vec<u8>,
    out: &mut Vec<Required>,
) -> bool {
    let mut selectors = Selectors {
        source,
        at: 0,
        known: None,
        unescaped,
    };
    out.clear();
    loop {
        let start = selectors.at;
        if let [b'.', first, ..] = source[start..]
            && !matches!(first, b'-' | b'0'..=b'9')
        {
            selectors.at += 1;
            let name = selectors.name();
            if let Some(name) = name.filter(|_| start == 0 && selectors.at == source.len()) {
                out.push(Required {
                    own: Some(key::class(name)),
                    is_class: true,
                    ..Required::default()
                });
                return true;
            }
            selectors.known =
                name.map(|it| (start + 1, core::mem::replace(&mut selectors.at, start), it));
            selectors.at = start;
        }
        let Some(found) = selectors.complex() else {
            return false;
        };
        let others = found
            .above
            .into_iter()
            .rev()
            .chain(found.also_own)
            .take(4)
            .collect();
        out.push(Required {
            own: found.own.map(|it| it.1),
            others,
            is_class: false,
        });
        match source.get(selectors.at) {
            Some(b',') => selectors.at += 1,
            end => return end.is_none(),
        }
    }
}
