//! Patterns without groups, run as `matcher::glob_match_impl` runs them: at most (tokens + 1) x (bytes + 1) steps.

use crate::class::Class;
use crate::node::Assertion;
use crate::unit::{Subject, Text, Unit, push_utf8};
use bun_core::strings;

#[derive(Copy, Clone)]
pub(crate) enum Tok {
    /// In `Tokens::bytes`.
    Lit {
        start: u32,
        len: u32,
        has_slash: bool,
    },
    Any,
    Star,
    Plus,
    /// In `Tokens::classes`.
    Class(u32),
    Deep {
        empty_names: bool,
        newlines: bool,
    },
    Rest {
        min: u8,
        newlines: bool,
    },
    Assert(Assertion),
}

/// The characters of a `Lit`, in `Tokens::bytes`.
#[derive(Copy, Clone, Default)]
struct Span {
    start: u32,
    len: u32,
}

/// The `Lit` before the end of the text: what matches ends with it. `or_slash`: or with it and a `/`.
#[derive(Copy, Clone)]
struct Tail {
    lit: Span,
    or_slash: bool,
}

fn without_slash(text: &[u8]) -> Option<&[u8]> {
    text.strip_suffix(b"/")
}

pub(crate) struct Tokens {
    toks: Vec<Tok>,
    bytes: Vec<u8>,
    classes: Vec<Class>,
    pub(crate) text: Text,
    pub(crate) has_two_kinds_of_deep: bool,
    /// The `Lit` at the start: what matches starts with it. Empty: there is none.
    head: Span,
    tail: Option<Tail>,
    /// All of `bytes` is.
    is_ascii: bool,
    /// A `**` that takes anything, then nothing that takes a `/`, then the end: it matches from the last name or not at all.
    is_for_last_name: bool,
}

/// What the tokens are, for an index of many. They end with the end of the text, or of the text but for a `/`.
pub(crate) enum Shape<'t> {
    /// `[Deep, Lit without "/", end]`: whatever is called so, in any directory.
    Name(&'t [u8]),
    /// `[Deep, Star, Lit(".ext"), end]`: without the `.`, and there is no other in it.
    Extension(&'t [u8]),
    /// `[Lit, end]`
    Path(&'t [u8]),
    /// `[Lit with a "/", ..]`: the name before it, which is the first name of whatever matches.
    Under(&'t [u8]),
    Other,
}

/// Where the text goes on behind the characters of a `Lit`.
enum LitEnd {
    At(usize),
    No,
    /// The text ends in them.
    UsedUp,
}

fn has_line_terminator(text: Text, bytes: &[u8]) -> bool {
    last_line_terminator(text, bytes).is_some()
}

/// Where the last line terminator of `bytes` starts.
fn last_line_terminator(text: Text, bytes: &[u8]) -> Option<usize> {
    // Hardly any text has one: one search says so.
    strings::index_of_any(bytes, b"\n\r\xE2")?;
    let ascii = strings::last_index_of_any(bytes, b"\n\r");
    if text.unit == Unit::Byte {
        return ascii;
    }
    ascii
        .max(strings::last_index_of(bytes, b"\xE2\x80\xA8"))
        .max(strings::last_index_of(bytes, b"\xE2\x80\xA9"))
}

/// Where the next `/` is, from `from`.
fn next_slash(subject: Subject<'_>, from: usize) -> Option<usize> {
    let rest = subject.bytes.get(from..)?;
    match strings::index_of_char_usize(rest, b'/') {
        Some(slash) => Some(from + slash),
        None => subject.slash.then_some(subject.bytes.len()),
    }
}

/// Where the last name starts. A `/` at the end of the text belongs to it.
fn last_name_start(subject: Subject<'_>) -> usize {
    let names = match subject.slash {
        true => subject.bytes,
        false => subject.bytes.strip_suffix(b"/").unwrap_or(subject.bytes),
    };
    strings::last_index_of_char(names, b'/').map_or(0, |slash| slash + 1)
}

impl Tokens {
    pub(crate) fn new(text: Text) -> Tokens {
        Tokens {
            toks: Vec::new(),
            bytes: Vec::new(),
            classes: Vec::new(),
            text,
            has_two_kinds_of_deep: false,
            head: Span::default(),
            tail: None,
            is_ascii: false,
            is_for_last_name: false,
        }
    }

    /// After the last `push`: finds what `can_match` asks about.
    pub(crate) fn finish(&mut self) {
        use Assertion::{End, EndOrFinalSlash};
        // With folding only ASCII is compared without decoding.
        let span_of = |tok: &Tok| match *tok {
            Tok::Lit { start, len, .. } if !self.text.folds || self.lit(start, len).is_ascii() => {
                Some(Span { start, len })
            }
            _ => None,
        };
        let head = self.toks.first().and_then(span_of).unwrap_or_default();
        let (tail, has_end) = match &self.toks[..] {
            [.., before, Tok::Assert(end @ (End | EndOrFinalSlash))] => {
                let or_slash = *end == EndOrFinalSlash;
                (span_of(before).map(|lit| Tail { lit, or_slash }), true)
            }
            _ => (None, false),
        };
        let takes_no_slash = |tok: &Tok| match tok {
            Tok::Lit { has_slash, .. } => !has_slash,
            Tok::Deep { .. } | Tok::Rest { .. } => false,
            _ => true,
        };
        let is_for_last_name = match &self.toks[..] {
            [
                Tok::Deep {
                    empty_names: true,
                    newlines: true,
                },
                rest @ ..,
            ] => has_end && rest.iter().all(takes_no_slash),
            _ => false,
        };
        (self.head, self.tail, self.is_for_last_name) = (head, tail, is_for_last_name);
        self.is_ascii = self.bytes.is_ascii();
    }

    /// Never `false` for a text that matches.
    #[inline]
    fn can_match(&self, subject: Subject<'_>) -> bool {
        let bytes = subject.bytes;
        let is_same = |a: &[u8], b: &[u8]| match self.text.folds {
            true => a.eq_ignore_ascii_case(b),
            false => a == b,
        };
        // Most differ in one byte already, which is compared without a call.
        let is_same_byte = |a: Option<&u8>, b: Option<&u8>| match (a, b) {
            (Some(a), Some(b)) => a.eq_ignore_ascii_case(b),
            _ => true,
        };
        let ends = |text: &[u8], end: &[u8]| {
            is_same_byte(text.last(), end.last())
                && (text.len().checked_sub(end.len())).is_some_and(|at| is_same(&text[at..], end))
        };
        let head = self.lit(self.head.start, self.head.len);
        let common = head.len().min(bytes.len());
        if !is_same_byte(bytes.first(), head.first()) || !is_same(&bytes[..common], &head[..common])
        {
            return false;
        }
        let Some(tail) = self.tail else {
            return true;
        };
        let end = self.lit(tail.lit.start, tail.lit.len);
        match subject.slash {
            true => {
                tail.or_slash && ends(bytes, end)
                    || without_slash(end).is_some_and(|end| ends(bytes, end))
            }
            false => {
                ends(bytes, end)
                    || tail.or_slash && without_slash(bytes).is_some_and(|text| ends(text, end))
            }
        }
    }

    pub(crate) fn push(&mut self, tok: Tok) {
        // `**` in a name is one `*`.
        if !matches!((tok, self.toks.last()), (Tok::Star, Some(Tok::Star))) {
            self.toks.push(tok);
        }
    }

    /// The pattern is folded when it is read.
    pub(crate) fn push_lit(&mut self, bytes: &[u8]) {
        let start = self.bytes.len();
        if self.text.folds {
            let mut at = 0;
            while let Some((unit, len)) = self.text.next(Subject::of(bytes), at) {
                match unit {
                    0..0x80 => self.bytes.push(unit as u8),
                    // A half of a pair and a byte that is no UTF-8 stay as they are.
                    0xD800..=0xDFFF => self
                        .bytes
                        .extend(bytes.get(at..at + len).unwrap_or_default()),
                    _ if len == 1 => self.bytes.extend(bytes.get(at)),
                    _ => push_utf8(&mut self.bytes, unit),
                }
                at += len;
            }
        } else {
            self.bytes.extend_from_slice(bytes);
        }
        self.toks.push(Tok::Lit {
            start: start as u32,
            len: (self.bytes.len() - start) as u32,
            has_slash: strings::contains_char(bytes, b'/'),
        });
    }

    pub(crate) fn push_class(&mut self, class: Class) {
        self.toks.push(Tok::Class(self.classes.len() as u32));
        self.classes.push(class);
    }

    fn lit(&self, start: u32, len: u32) -> &[u8] {
        let start = start as usize;
        self.bytes
            .get(start..start + len as usize)
            .unwrap_or_default()
    }

    fn lit_end(&self, wanted: &[u8], subject: Subject<'_>, mut pi: usize) -> LitEnd {
        if !self.text.folds {
            if subject
                .bytes
                .get(pi..)
                .is_some_and(|rest| rest.starts_with(wanted))
            {
                return LitEnd::At(pi + wanted.len());
            }
            for (k, byte) in wanted.iter().enumerate() {
                match subject.get(pi + k) {
                    None => return LitEnd::UsedUp,
                    Some(found) if found != *byte => return LitEnd::No,
                    Some(_) => {}
                }
            }
            return LitEnd::At(pi + wanted.len());
        }
        if self.is_ascii
            && let Some(found) = subject.bytes.get(pi..pi + wanted.len())
        {
            return match found.eq_ignore_ascii_case(wanted) {
                true => LitEnd::At(pi + wanted.len()),
                false => LitEnd::No,
            };
        }
        // Unit by unit, because a letter and its capital can differ in length.
        let mut k = 0;
        while let Some((unit, len)) = self.text.plain().next(Subject::of(wanted), k) {
            match self.text.next(subject, pi) {
                None => return LitEnd::UsedUp,
                Some((found, _)) if found != unit => return LitEnd::No,
                Some((_, found_len)) => pi += found_len,
            }
            k += len;
        }
        LitEnd::At(pi)
    }

    /// Matches from the start of `subject`. `partial`: it is a directory with its `/`, and tokens may be left when it is used up.
    #[inline]
    pub(crate) fn run(&self, subject: Subject<'_>, partial: bool) -> bool {
        (partial || self.can_match(subject)) && self.run_loop(subject, partial)
    }

    /// Apart from `run`: most texts are turned away by `can_match`, and do not pay for what this sets up.
    #[inline(never)]
    fn run_loop(&self, subject: Subject<'_>, partial: bool) -> bool {
        let (text, n) = (self.text, subject.len());
        let (mut ti, mut pi) = (0, 0);
        // The token behind the `*`, and how far it has taken.
        let mut star: Option<(usize, usize)> = None;
        // The token behind the `**`, where the name starts that it would take next, `empty_names` and `newlines`.
        let mut deep: Option<(usize, usize, bool, bool)> = None;
        // Looked for when it is first asked for.
        let mut last_terminator: Option<Option<usize>> = None;
        let last = || last_line_terminator(text, subject.bytes);
        loop {
            let Some(tok) = self.toks.get(ti) else {
                return true;
            };
            if partial && pi == n {
                return true;
            }
            let ok = match *tok {
                Tok::Lit {
                    start,
                    len,
                    has_slash,
                } => match self.lit_end(self.lit(start, len), subject, pi) {
                    LitEnd::At(end) => {
                        pi = end;
                        // A `*` ends at the next `/` and nowhere else, so taking more cannot help.
                        if has_slash {
                            star = None;
                        }
                        true
                    }
                    LitEnd::UsedUp if partial => return true,
                    LitEnd::UsedUp | LitEnd::No => false,
                },
                Tok::Any | Tok::Plus | Tok::Class(_) => match text.next(subject, pi) {
                    Some((unit, len)) if self.takes(*tok, unit) => {
                        pi += len;
                        if matches!(tok, Tok::Plus) {
                            star = Some((ti + 1, pi));
                        }
                        true
                    }
                    _ => false,
                },
                Tok::Star => {
                    star = Some((ti + 1, pi));
                    true
                }
                Tok::Deep {
                    empty_names,
                    newlines,
                } => {
                    if self.is_for_last_name && !partial {
                        pi = last_name_start(subject);
                    }
                    deep = Some((ti + 1, pi, empty_names, newlines));
                    star = None;
                    true
                }
                Tok::Rest { min, newlines } => {
                    let is_one_line = newlines
                        || last_terminator
                            .get_or_insert_with(last)
                            .is_none_or(|it| it < pi);
                    let ok = is_one_line && pi + usize::from(min) <= n;
                    if ok {
                        pi = n;
                    }
                    ok
                }
                Tok::Assert(assertion) => assertion.holds(subject, pi),
            };
            if ok {
                ti += 1;
                continue;
            }
            if let Some((behind, taken)) = star {
                match text.next(subject, taken) {
                    Some((unit, len)) if unit != u32::from(b'/') => {
                        let taken = match partial {
                            true => taken + len,
                            false => self.next_try(behind, subject.bytes, taken + len),
                        };
                        star = Some((behind, taken));
                        (ti, pi) = (behind, taken);
                        continue;
                    }
                    _ => star = None,
                }
            }
            // The `**` takes one more name.
            let Some((behind, name, empty_names, newlines)) = deep else {
                return false;
            };
            let Some(slash) = next_slash(subject, name) else {
                return false;
            };
            let taken = subject.bytes.get(name..slash).unwrap_or_default();
            let stops = !newlines
                && last_terminator.get_or_insert_with(last).is_some()
                && has_line_terminator(text, taken);
            if taken.is_empty() && !empty_names || stops {
                return false;
            }
            deep = Some((behind, slash + 1, empty_names, newlines));
            (ti, pi) = (behind, slash + 1);
        }
    }

    /// Where the token at `behind` can match next, from `from`: a `Lit` only where its first byte is. Not beyond a `/`.
    #[inline]
    fn next_try(&self, behind: usize, bytes: &[u8], from: usize) -> usize {
        let Some(&Tok::Lit { start, .. }) = self.toks.get(behind) else {
            return from;
        };
        let Some(first) = self.bytes.get(start as usize).filter(|it| it.is_ascii()) else {
            return from;
        };
        let rest = bytes.get(from..).unwrap_or_default();
        let cannot_start = |it: &&u8| **it != b'/' && !it.eq_ignore_ascii_case(first);
        from + rest.iter().take_while(cannot_start).count()
    }

    /// Whether `tok`, which takes one unit, takes `unit`.
    #[inline]
    fn takes(&self, tok: Tok, unit: u32) -> bool {
        match tok {
            Tok::Class(index) => self
                .classes
                .get(index as usize)
                .is_some_and(|it| it.has(unit)),
            _ => unit != u32::from(b'/'),
        }
    }

    pub(crate) fn longest_literal(&self) -> &[u8] {
        // It is searched for byte by byte.
        if self.text.folds {
            return b"";
        }
        let lits = self.toks.iter().filter_map(|tok| match tok {
            Tok::Lit { start, len, .. } => Some(self.lit(*start, *len)),
            _ => None,
        });
        lits.max_by_key(|it| it.len()).unwrap_or_default()
    }

    /// With folding only what is ASCII has a shape.
    pub(crate) fn shape(&self) -> Shape<'_> {
        let is_free = |tok: &Tok| {
            matches!(
                tok,
                Tok::Deep {
                    empty_names: true,
                    newlines: true
                }
            )
        };
        let fits = |bytes: &[u8]| !self.text.folds || bytes.is_ascii();
        let under = match self.toks.first() {
            Some(&Tok::Lit {
                start,
                len,
                has_slash: true,
            }) => {
                let lit = self.lit(start, len);
                let first = &lit[..strings::index_of_char_usize(lit, b'/').unwrap_or(0)];
                match fits(first) {
                    true => Shape::Under(first),
                    false => Shape::Other,
                }
            }
            _ => Shape::Other,
        };
        let [
            before @ ..,
            Tok::Assert(Assertion::End | Assertion::EndOrFinalSlash),
        ] = &self.toks[..]
        else {
            return under;
        };
        let lit = |tok: &Tok| match tok {
            Tok::Lit { start, len, .. } => Some(self.lit(*start, *len)).filter(|it| fits(it)),
            _ => None,
        };
        let has_slash = |bytes: &[u8]| strings::contains_char(bytes, b'/');
        match before {
            [deep, name] if is_free(deep) => match lit(name) {
                Some(bytes) if !has_slash(bytes) => Shape::Name(bytes),
                _ => Shape::Other,
            },
            [deep, Tok::Star, suffix] if is_free(deep) => match lit(suffix) {
                Some([b'.', bytes @ ..])
                    if !bytes.is_empty() && !strings::contains_any(bytes, b"./") =>
                {
                    Shape::Extension(bytes)
                }
                _ => Shape::Other,
            },
            [path] => match lit(path) {
                Some(bytes) if !bytes.ends_with(b"/") => Shape::Path(bytes),
                _ => under,
            },
            _ => under,
        }
    }
}
