//! Prints an edited package.json tree over the text that it was parsed from.
//!
//! The tree says what the file means, the old text says how it is written. What an edit leaves
//! alone is copied byte for byte: comments, blank lines, line endings, how a string or a number
//! is spelled. Only a changed value, a new member and the commas around a member that was added
//! or removed are printed.

use bun_ast::{Expr, ExprData, G, Indentation, IndentationCharacter, Source};
use bun_collections::index_sort;
use bun_core::{StackCheck, strings};
use bun_js_printer as js_printer;

use crate::bun_json::scan;

/// The text of a package.json that was `old`, now that its tree is `root`.
///
/// A text that `root` was not parsed from (an empty file, another root) is printed as a new file.
pub fn print(old: &[u8], root: Expr, indentation: Indentation) -> js_printer::Result<Vec<u8>> {
    let mut text = Text::new(old, indentation);
    match text.document(&root) {
        Ok(()) => {
            debug_assert!(
                is_written(&text.out, &root),
                "package.json text does not say what its tree says"
            );
            Ok(text.out)
        }
        Err(Stop::Printer(err)) => Err(err),
        Err(Stop::NotTheText) => print_new_file(old, root, indentation),
    }
}

fn print_new_file(old: &[u8], root: Expr, indentation: Indentation) -> js_printer::Result<Vec<u8>> {
    let mut buffer_writer = js_printer::BufferWriter::init();
    buffer_writer.buffer.list.reserve(old.len() + 1);
    buffer_writer.append_newline = old.last() == Some(&b'\n');
    let mut writer = js_printer::BufferPrinter::init(buffer_writer);
    js_printer::print_json(
        &mut writer,
        root,
        &Source::init_empty_file(b"package.json"),
        js_printer::PrintJsonOptions {
            indent: indentation,
            mangled_props: None,
            ..Default::default()
        },
    )?;
    Ok(writer.ctx.written_without_trailing_zero().to_vec())
}

enum Stop {
    /// The tree was not parsed from this text.
    NotTheText,
    Printer(js_printer::Error),
}

impl From<js_printer::Error> for Stop {
    fn from(err: js_printer::Error) -> Self {
        Stop::Printer(err)
    }
}

type Step<T = ()> = Result<T, Stop>;

/// A member of an object or an item of an array, as the old text has it. All fields are offsets.
#[derive(Clone, Copy)]
struct Member {
    /// Where the lines above it start: blank lines, comments, then its indentation.
    lead: usize,
    /// The key of a member. An item has no key: `key..key_end` is its value.
    key: usize,
    key_end: usize,
    value: usize,
    value_end: usize,
    comma: Option<usize>,
    /// Where the rest of its line ends: a comment, then the line break.
    end: usize,
    starts_line: bool,
    ends_line: bool,
}

/// An object or an array of the old text. Its members are `Text::members[first..first + len]`.
#[derive(Clone, Copy)]
struct Container {
    open: usize,
    close: usize,
    /// Where the rest of the line of the opening bracket ends.
    head_end: usize,
    head_ends_line: bool,
    first: usize,
    len: usize,
}

/// The members of an object or the items of an array of the tree.
#[derive(Clone, Copy)]
enum Entries<'e> {
    Members(&'e [G::Property]),
    Items {
        items: &'e [Expr],
        /// The printer writes the array on one line.
        on_one_line: bool,
    },
}

impl<'e> Entries<'e> {
    fn of(value: &'e Expr, open: u8) -> Option<Entries<'e>> {
        match (&value.data, open) {
            (ExprData::EObject(object), b'{') => {
                Some(Entries::Members(object.properties.as_slice()))
            }
            (ExprData::EArray(array), b'[') => Some(Entries::Items {
                items: array.items.as_slice(),
                on_one_line: array.is_single_line,
            }),
            _ => None,
        }
    }

    fn len(self) -> usize {
        match self {
            Entries::Members(members) => members.len(),
            Entries::Items { items, .. } => items.len(),
        }
    }

    fn key(self, index: usize) -> Option<&'e Expr> {
        match self {
            Entries::Members(members) => members[index].key.as_ref(),
            Entries::Items { .. } => None,
        }
    }

    fn value(self, index: usize) -> Step<&'e Expr> {
        match self {
            Entries::Members(members) => members[index].value.as_ref().ok_or(Stop::NotTheText),
            Entries::Items { items, .. } => Ok(&items[index]),
        }
    }

    /// What pairs an entry with a member of the text: the key of a member, the text of a string item.
    fn name(self, index: usize) -> Option<&'e [u8]> {
        match self {
            Entries::Members(members) => string_of(members[index].key.as_ref()?),
            Entries::Items { items, .. } => string_of(&items[index]),
        }
    }
}

fn string_of(value: &Expr) -> Option<&[u8]> {
    match &value.data {
        ExprData::EString(string) if string.is_utf8() && string.next.is_none() => {
            Some(&string.data)
        }
        _ => None,
    }
}

#[derive(PartialEq, Eq)]
enum Kind {
    Object,
    Array,
    String,
    Scalar,
}

fn kind_of_token(first: u8) -> Kind {
    match first {
        b'{' => Kind::Object,
        b'[' => Kind::Array,
        b'"' | b'\'' => Kind::String,
        _ => Kind::Scalar,
    }
}

fn kind_of_value(value: &Expr) -> Kind {
    match &value.data {
        ExprData::EObject(_) => Kind::Object,
        ExprData::EArray(_) => Kind::Array,
        ExprData::EString(_) => Kind::String,
        _ => Kind::Scalar,
    }
}

/// The value of a number that is spelled the way JSON spells numbers.
fn number_token(token: &[u8]) -> Option<f64> {
    let digits = |from: usize| {
        from + token[from..]
            .iter()
            .take_while(|byte| byte.is_ascii_digit())
            .count()
    };
    let start = usize::from(token.first() == Some(&b'-'));
    let mut at = digits(start);
    if at == start || (token[start] == b'0' && at > start + 1) {
        return None;
    }
    if token.get(at) == Some(&b'.') {
        let fraction = at + 1;
        at = digits(fraction);
        if at == fraction {
            return None;
        }
    }
    if matches!(token.get(at), Some(b'e' | b'E')) {
        let exponent = at + 1 + usize::from(matches!(token.get(at + 1), Some(b'+' | b'-')));
        at = digits(exponent);
        if at == exponent {
            return None;
        }
    }
    if at != token.len() {
        return None;
    }
    core::str::from_utf8(token).ok()?.parse().ok()
}

fn has_line_break(text: &[u8]) -> bool {
    strings::index_of_any(text, b"\n\r").is_some()
}

struct Text<'a> {
    text: &'a [u8],
    out: Vec<u8>,
    indentation: Indentation,
    /// One level of indentation.
    unit: Vec<u8>,
    line_break: &'static [u8],
    /// `(opening bracket, closing bracket)` of every object and array, in the order of the first.
    brackets: Vec<(usize, usize)>,
    /// The members of the containers that are being written, innermost last.
    members: Vec<Member>,
    scratch: Vec<u8>,
    /// A `//` comment was written without its line break: what comes next starts a line.
    in_line_comment: bool,
    stack: StackCheck,
    no_source: Source,
}

impl<'a> Text<'a> {
    fn new(text: &'a [u8], indentation: Indentation) -> Self {
        let unit = match indentation.character {
            IndentationCharacter::Space => b' ',
            IndentationCharacter::Tab => b'\t',
        };
        let crlf = strings::index_of_char_usize(text, b'\n')
            .is_some_and(|line_end| line_end > 0 && text[line_end - 1] == b'\r');
        Text {
            text,
            out: Vec::with_capacity(text.len() + 64),
            indentation: Indentation {
                count: 0,
                ..indentation
            },
            unit: vec![unit; indentation.scalar],
            line_break: if crlf { b"\r\n" } else { b"\n" },
            brackets: Vec::new(),
            members: Vec::new(),
            scratch: Vec::new(),
            in_line_comment: false,
            stack: StackCheck::init(),
            no_source: Source::init_empty_file(b"package.json"),
        }
    }

    fn document(&mut self, root: &Expr) -> Step {
        let text = self.text;
        let start = scan::next_token(text, 0).ok_or(Stop::NotTheText)?;
        if Entries::of(root, text[start]).is_none() {
            return Err(Stop::NotTheText);
        }
        self.find_brackets(start)?;
        self.put(&text[..start]);
        let end = self.value(root, start)?;
        self.put(&text[end..]);
        if self.out == text {
            return Ok(());
        }
        // A root that is written on one line has no layout to keep: it gets the printer's.
        let container = self.scan(start)?;
        let has_lines = self.has_lines(&container);
        self.members.truncate(container.first);
        if has_lines {
            return Ok(());
        }
        self.out.clear();
        self.in_line_comment = false;
        self.put(&text[..start]);
        self.lay_out_value(root, start, self.line_indent(start))?;
        self.put(&text[end..]);
        Ok(())
    }

    // ───── the old text ─────

    fn member(&self, container: &Container, index: usize) -> Member {
        self.members[container.first + index]
    }

    /// Fills `self.brackets` for the container that opens at `root`, in one pass over it.
    fn find_brackets(&mut self, root: usize) -> Step {
        let text = self.text;
        let mut open: Vec<usize> = Vec::new();
        let mut at = root;
        loop {
            match *text.get(at).ok_or(Stop::NotTheText)? {
                b'{' | b'[' => {
                    open.push(self.brackets.len());
                    self.brackets.push((at, at));
                    at += 1;
                }
                closing @ (b'}' | b']') => {
                    let index = open.pop().ok_or(Stop::NotTheText)?;
                    if (text[self.brackets[index].0] == b'{') != (closing == b'}') {
                        return Err(Stop::NotTheText);
                    }
                    self.brackets[index].1 = at;
                    at += 1;
                    if open.is_empty() {
                        return Ok(());
                    }
                }
                b'"' | b'\'' => at = scan::string_end(text, at).ok_or(Stop::NotTheText)?,
                b'/' => at = scan::comment_end(text, at).ok_or(Stop::NotTheText)?,
                _ => at += 1,
            }
        }
    }

    /// Where the value that starts at `at` ends.
    fn value_end(&self, at: usize) -> Step<usize> {
        if !matches!(self.text[at], b'{' | b'[') {
            return scan::value_end(self.text, at).ok_or(Stop::NotTheText);
        }
        match self.brackets.binary_search_by_key(&at, |&(open, _)| open) {
            Ok(index) => Ok(self.brackets[index].1 + 1),
            Err(_) => Err(Stop::NotTheText),
        }
    }

    /// The blanks that the line of `at` starts with.
    fn line_indent(&self, at: usize) -> &'a [u8] {
        let text = self.text;
        let line = strings::last_index_of_char(&text[..at], b'\n').map_or(0, |i| i + 1);
        let blanks = text[line..at]
            .iter()
            .take_while(|byte| matches!(byte, b' ' | b'\t'))
            .count();
        &text[line..line + blanks]
    }

    /// Where the line that `from` is on ends, if only blanks and comments are left on it before `limit`.
    fn rest_of_line(&self, from: usize, limit: usize) -> (usize, bool) {
        let text = self.text;
        let mut at = from;
        while at < limit {
            match text[at] {
                b'\n' => return (at + 1, true),
                b'\r' => return (at + 1 + usize::from(text.get(at + 1) == Some(&b'\n')), true),
                b'/' => at = scan::comment_end(text, at).unwrap_or(limit),
                _ => at += 1,
            }
        }
        (from, false)
    }

    /// Finds the members of the container that opens at `open` and pushes them on `self.members`.
    fn scan(&mut self, open: usize) -> Step<Container> {
        let text = self.text;
        let is_object = text[open] == b'{';
        let closing = if is_object { b'}' } else { b']' };
        let first = self.members.len();
        let mut at = open + 1;
        let close = loop {
            let token = scan::next_token(text, at).ok_or(Stop::NotTheText)?;
            if text[token] == closing {
                break token;
            }
            let (key_end, value) = if is_object {
                let key_end = scan::string_end(text, token).ok_or(Stop::NotTheText)?;
                let colon = scan::next_token(text, key_end).ok_or(Stop::NotTheText)?;
                if text[colon] != b':' {
                    return Err(Stop::NotTheText);
                }
                let value = scan::next_token(text, colon + 1).ok_or(Stop::NotTheText)?;
                (key_end, value)
            } else {
                (0, token)
            };
            let value_end = self.value_end(value)?;
            let after = scan::next_token(text, value_end).ok_or(Stop::NotTheText)?;
            let comma = (text[after] == b',').then_some(after);
            if comma.is_none() && text[after] != closing {
                return Err(Stop::NotTheText);
            }
            self.members.push(Member {
                lead: 0,
                key: token,
                key_end: if is_object { key_end } else { value_end },
                value,
                value_end,
                comma,
                end: 0,
                starts_line: false,
                ends_line: false,
            });
            at = comma.map_or(value_end, |comma| comma + 1);
        };
        let len = self.members.len() - first;
        let first_key = if len == 0 {
            close
        } else {
            self.members[first].key
        };
        let (head_end, head_ends_line) = self.rest_of_line(open + 1, first_key);
        let (mut lead, mut at_line_start) = (head_end, head_ends_line);
        for index in first..first + len {
            let next_key = if index + 1 < first + len {
                self.members[index + 1].key
            } else {
                close
            };
            let member = self.members[index];
            let after = member.comma.map_or(member.value_end, |comma| comma + 1);
            let (end, ends_line) = self.rest_of_line(after, next_key);
            self.members[index] = Member {
                lead,
                end,
                starts_line: at_line_start,
                ends_line,
                ..member
            };
            (lead, at_line_start) = (end, ends_line);
        }
        Ok(Container {
            open,
            close,
            head_end,
            head_ends_line,
            first,
            len,
        })
    }

    /// Whether the members of the container are on lines of their own.
    fn has_lines(&self, container: &Container) -> bool {
        container.head_ends_line
            || (0..container.len).any(|index| self.member(container, index).ends_line)
    }

    fn name_is(&mut self, container: &Container, index: usize, name: &[u8]) -> bool {
        let text = self.text;
        let member = self.member(container, index);
        self.string_token_is(&text[member.key..member.key_end], name)
    }

    fn string_token_is(&mut self, token: &[u8], string: &[u8]) -> bool {
        scan::string_value(token, &mut self.scratch) == Some(string)
    }

    /// Whether `token` is how the old text spells `value`.
    fn is_token(&mut self, token: &[u8], value: &Expr) -> bool {
        match &value.data {
            ExprData::EString(_) => {
                string_of(value).is_some_and(|string| self.string_token_is(token, string))
            }
            ExprData::ENumber(number) => number_token(token)
                .is_some_and(|written| written.to_bits() == number.value().to_bits()),
            ExprData::EBoolean(boolean) => {
                token
                    == if boolean.value {
                        b"true".as_slice()
                    } else {
                        b"false"
                    }
            }
            ExprData::ENull(_) => token == b"null",
            _ => false,
        }
    }

    /// Whether the tree has the members of the text, in the order of the text.
    fn has_same_members(&mut self, container: &Container, entries: Entries<'_>) -> bool {
        if entries.len() != container.len {
            return false;
        }
        if let Entries::Members(_) = entries {
            for index in 0..container.len {
                let Some(name) = entries.name(index) else {
                    return false;
                };
                if !self.name_is(container, index, name) {
                    return false;
                }
            }
        }
        true
    }

    /// `(hash of its name, member)` for the members of the text that have a name, sorted.
    fn names(&mut self, container: &Container) -> Vec<(u64, usize)> {
        let text = self.text;
        let mut names = Vec::with_capacity(container.len);
        for index in 0..container.len {
            let member = self.member(container, index);
            let token = &text[member.key..member.key_end];
            if let Some(name) = scan::string_value(token, &mut self.scratch) {
                names.push((bun_wyhash::hash(name), index));
            }
        }
        index_sort::sort_slice_unstable(&mut names);
        names
    }

    /// For each entry of the tree, the member of the text that it is, if it is one.
    ///
    /// A member is paired by its key and a string item by its text, the first with the first.
    /// Other items are paired in order with an item of their kind.
    fn pair(&mut self, container: &Container, entries: Entries<'_>) -> Step<Vec<Option<usize>>> {
        let text = self.text;
        let old_len = container.len;
        let mut pairs: Vec<Option<usize>> = Vec::with_capacity(entries.len());
        let mut taken = vec![false; old_len];
        let mut next = 0;
        // Made when the tree has a name where the text does not have it.
        let mut names: Option<Vec<(u64, usize)>> = None;
        for index in 0..entries.len() {
            let Some(name) = entries.name(index) else {
                if let Entries::Members(_) = entries {
                    return Err(Stop::NotTheText);
                }
                pairs.push(None);
                continue;
            };
            while next < old_len && taken[next] {
                next += 1;
            }
            let mut found = None;
            if next < old_len && self.name_is(container, next, name) {
                found = Some(next);
            } else {
                let names = names.get_or_insert_with(|| self.names(container));
                let hash = bun_wyhash::hash(name);
                let mut at = names.partition_point(|&(other, _)| other < hash);
                while at < names.len() && names[at].0 == hash {
                    let old = names[at].1;
                    if !taken[old] && self.name_is(container, old, name) {
                        found = Some(old);
                        break;
                    }
                    at += 1;
                }
            }
            if let Some(old) = found {
                taken[old] = true;
            }
            pairs.push(found);
        }
        if let Entries::Items { items, .. } = entries {
            let mut old = 0;
            for (index, item) in items.iter().enumerate() {
                if pairs[index].is_some() || kind_of_value(item) == Kind::String {
                    continue;
                }
                while old < old_len {
                    let candidate = old;
                    old += 1;
                    if !taken[candidate]
                        && kind_of_token(text[self.member(container, candidate).value])
                            == kind_of_value(item)
                    {
                        taken[candidate] = true;
                        pairs[index] = Some(candidate);
                        break;
                    }
                }
            }
        }
        Ok(pairs)
    }

    // ───── the new text ─────

    fn put(&mut self, bytes: &[u8]) {
        if bytes.is_empty() {
            return;
        }
        if self.in_line_comment {
            self.in_line_comment = false;
            if !matches!(bytes[0], b'\n' | b'\r') {
                self.out.extend_from_slice(self.line_break);
            }
        }
        self.out.extend_from_slice(bytes);
    }

    fn break_line(&mut self) {
        self.put(self.line_break);
    }

    /// Writes the comments of `text[from..to]` on the line that is being written.
    fn comments(&mut self, from: usize, to: usize, blank: Blank) {
        let text = self.text;
        let mut at = from;
        while at < to {
            let Some(end) = (text[at] == b'/')
                .then(|| scan::comment_end(text, at))
                .flatten()
            else {
                at += 1;
                continue;
            };
            if blank == Blank::Before {
                self.put(b" ");
            }
            self.put(&text[at..end]);
            self.in_line_comment = text[at + 1] == b'/';
            if blank == Blank::After && !self.in_line_comment {
                self.put(b" ");
            }
            at = end;
        }
    }

    /// Prints `value`, which the old text does not have. Its lines after the first start with `indent`.
    fn print(&mut self, value: &Expr, indent: &[u8]) -> Step {
        let mut writer = js_printer::BufferPrinter::init(js_printer::BufferWriter::init());
        js_printer::print_json(
            &mut writer,
            *value,
            &self.no_source,
            js_printer::PrintJsonOptions {
                indent: self.indentation,
                mangled_props: None,
                ..Default::default()
            },
        )?;
        let mut rest = writer.ctx.written_without_trailing_zero();
        while let Some(line_end) = strings::index_of_char_usize(rest, b'\n') {
            self.put(&rest[..line_end]);
            self.break_line();
            self.put(indent);
            rest = &rest[line_end + 1..];
        }
        self.put(rest);
        Ok(())
    }

    fn print_entry(&mut self, entries: Entries<'_>, index: usize, indent: &[u8]) -> Step {
        if let Some(key) = entries.key(index) {
            self.print(key, b"")?;
            self.put(b": ");
        }
        self.print(entries.value(index)?, indent)
    }

    /// Writes `value` where the old text has the value that starts at `at`. Returns where that one ends.
    fn value(&mut self, value: &Expr, at: usize) -> Step<usize> {
        if !self.stack.is_safe_to_recurse() {
            return Err(Stop::Printer(js_printer::Error::StackOverflow));
        }
        let text = self.text;
        let Some(entries) = Entries::of(value, text[at]) else {
            let end = self.value_end(at)?;
            if self.is_token(&text[at..end], value) {
                self.put(&text[at..end]);
            } else {
                self.print(value, self.line_indent(at))?;
            }
            return Ok(end);
        };
        let container = self.scan(at)?;
        if self.has_same_members(&container, entries) {
            let mut copied = container.open;
            for index in 0..container.len {
                let member = self.member(&container, index);
                self.put(&text[copied..member.value]);
                copied = self.value(entries.value(index)?, member.value)?;
            }
            self.put(&text[copied..=container.close]);
        } else {
            let pairs = self.pair(&container, entries)?;
            if self.has_lines(&container) {
                self.lines(&container, entries, &pairs)?;
            } else {
                self.lay_out(&container, entries, &pairs, self.line_indent(at))?;
            }
        }
        self.members.truncate(container.first);
        Ok(container.close + 1)
    }

    /// Writes a container whose members are on lines of their own and which gained, lost or
    /// moved members: each member of the tree on a line, the lines of the old text as they are.
    fn lines(
        &mut self,
        container: &Container,
        entries: Entries<'_>,
        pairs: &[Option<usize>],
    ) -> Step {
        let text = self.text;
        let old_len = container.len;
        let mut stays = vec![false; old_len];
        for &old in pairs.iter().flatten() {
            stays[old] = true;
        }
        let tail = if old_len == 0 {
            container.head_end
        } else {
            self.member(container, old_len - 1).end
        };

        if pairs.is_empty() {
            // Nothing is left but the comments that were on lines of their own.
            let mark = self.out.len();
            self.put(&text[container.open..container.head_end]);
            for old in 0..old_len {
                self.comment_lines_above(&self.member(container, old));
            }
            self.put(&text[tail..=container.close]);
            if !strings::contains_char(&self.out[mark..], b'/') {
                self.out.truncate(mark);
                self.put(&[text[container.open], text[container.close]]);
            }
            return Ok(());
        }

        let mut indent = None;
        for old in 0..old_len {
            let member = self.member(container, old);
            if member.starts_line {
                indent = Some(self.line_indent(member.key).to_vec());
                break;
            }
        }
        let indent = indent
            .unwrap_or_else(|| [self.line_indent(container.open), self.unit.as_slice()].concat());
        let (has_trailing_comma, close_has_line) = if old_len == 0 {
            (false, container.head_ends_line)
        } else {
            let last = self.member(container, old_len - 1);
            (last.comma.is_some(), last.ends_line)
        };

        self.put(&text[container.open..container.head_end]);
        if !container.head_ends_line {
            self.break_line();
        }
        for (index, pair) in pairs.iter().enumerate() {
            let is_last = index + 1 == pairs.len();
            let has_comma = !is_last || has_trailing_comma;
            let ends_line = !is_last || close_has_line;
            let Some(old) = *pair else {
                self.put(&indent);
                self.print_entry(entries, index, &indent)?;
                if has_comma {
                    self.put(b",");
                }
                if ends_line {
                    self.break_line();
                }
                continue;
            };
            // The comments above the members that were removed before this one stay.
            let mut removed = old;
            while removed > 0 && !stays[removed - 1] {
                removed -= 1;
            }
            for removed in removed..old {
                self.comment_lines_above(&self.member(container, removed));
            }
            let member = self.member(container, old);
            if member.starts_line {
                self.put(&text[member.lead..member.key]);
            } else {
                self.put(&indent);
                self.comments(member.lead, member.key, Blank::After);
            }
            self.put(&text[member.key..member.value]);
            self.value(entries.value(index)?, member.value)?;
            match member.comma {
                Some(comma) if has_line_break(&text[member.value_end..comma]) => {
                    if has_comma {
                        self.put(b",");
                    }
                    self.comments(member.value_end, comma, Blank::Before);
                    self.put(&text[comma + 1..member.end]);
                }
                Some(comma) => {
                    self.put(&text[member.value_end..comma]);
                    if has_comma {
                        self.put(b",");
                    }
                    self.put(&text[comma + 1..member.end]);
                }
                None => {
                    if has_comma {
                        self.put(b",");
                    }
                    self.put(&text[member.value_end..member.end]);
                }
            }
            if ends_line && !member.ends_line {
                self.break_line();
            }
        }
        let mut removed = old_len;
        while removed > 0 && !stays[removed - 1] {
            removed -= 1;
        }
        for removed in removed..old_len {
            self.comment_lines_above(&self.member(container, removed));
        }
        self.put(&text[tail..=container.close]);
        Ok(())
    }

    /// Writes the lines above a member that is removed, if a comment is on them.
    fn comment_lines_above(&mut self, member: &Member) {
        if !member.starts_line {
            return;
        }
        let text = self.text;
        let above = &text[member.lead..member.key];
        let Some(last_break) = strings::last_index_of_char(above, b'\n') else {
            return;
        };
        let above = &above[..=last_break];
        if strings::contains_char(above, b'/') {
            self.put(above);
        }
    }

    /// `lay_out` for a value that the old text has at `at`.
    fn lay_out_value(&mut self, value: &Expr, at: usize, indent: &[u8]) -> Step {
        if !self.stack.is_safe_to_recurse() {
            return Err(Stop::Printer(js_printer::Error::StackOverflow));
        }
        let text = self.text;
        let Some(entries) = Entries::of(value, text[at]) else {
            let end = self.value_end(at)?;
            if self.is_token(&text[at..end], value) {
                self.put(&text[at..end]);
                return Ok(());
            }
            return self.print(value, indent);
        };
        let container = self.scan(at)?;
        let pairs = self.pair(&container, entries)?;
        self.lay_out(&container, entries, &pairs, indent)?;
        self.members.truncate(container.first);
        Ok(())
    }

    /// Writes a container that is written on one line the way the printer lays it out, with the
    /// tokens and the comments of the old text. `indent` is the indentation of its line.
    fn lay_out(
        &mut self,
        container: &Container,
        entries: Entries<'_>,
        pairs: &[Option<usize>],
        indent: &[u8],
    ) -> Step {
        let text = self.text;
        let on_one_line = matches!(
            entries,
            Entries::Items {
                on_one_line: true,
                ..
            }
        );
        let inner = if on_one_line {
            indent.to_vec()
        } else {
            [indent, self.unit.as_slice()].concat()
        };
        self.put(&text[container.open..=container.open]);
        if pairs.is_empty() {
            self.comments(container.open + 1, container.close, Blank::Before);
            if self.out.last() != Some(&text[container.open]) {
                self.put(b" ");
            }
            self.put(&text[container.close..=container.close]);
            return Ok(());
        }
        for (index, pair) in pairs.iter().enumerate() {
            let is_last = index + 1 == pairs.len();
            if !on_one_line {
                self.break_line();
                self.put(&inner);
            } else if index > 0 {
                self.put(b" ");
            }
            let Some(old) = *pair else {
                self.print_entry(entries, index, &inner)?;
                if !is_last {
                    self.put(b",");
                }
                continue;
            };
            let member = self.member(container, old);
            // What is between the member before it (or the opening bracket) and this one.
            let before = if old == 0 {
                container.open + 1
            } else {
                let previous = self.member(container, old - 1);
                previous.comma.map_or(previous.value_end, |comma| comma + 1)
            };
            self.comments(before, member.key, Blank::After);
            if member.key != member.value {
                self.put(&text[member.key..member.key_end]);
                self.put(b": ");
                self.comments(member.key_end, member.value, Blank::After);
            }
            self.lay_out_value(entries.value(index)?, member.value, &inner)?;
            // What is between this member and its comma, and for the last one up to the bracket.
            let after = if old + 1 == container.len {
                container.close
            } else {
                member.comma.unwrap_or(member.value_end)
            };
            let comments = &text[member.value_end..after];
            if !is_last && strings::contains(comments, b"//") {
                self.put(b",");
                self.comments(member.value_end, after, Blank::Before);
            } else {
                self.comments(member.value_end, after, Blank::Before);
                if !is_last {
                    self.put(b",");
                }
            }
        }
        if !on_one_line {
            self.break_line();
            self.put(indent);
        }
        self.put(&text[container.close..=container.close]);
        Ok(())
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Blank {
    Before,
    After,
}

/// Whether `text` is a document that says what `root` says: same members, same order, same values.
fn is_written(text: &[u8], root: &Expr) -> bool {
    let mut scratch = Vec::new();
    scan::next_token(text, 0)
        .is_some_and(|start| value_is_written(text, start, root, &mut scratch).is_some())
}

/// The end of the value that starts at `at`, if it is `value`.
fn value_is_written(text: &[u8], at: usize, value: &Expr, scratch: &mut Vec<u8>) -> Option<usize> {
    let Some(entries) = Entries::of(value, *text.get(at)?) else {
        let end = scan::value_end(text, at)?;
        let token = &text[at..end];
        let is_value = match &value.data {
            ExprData::EString(_) => scan::string_value(token, scratch) == Some(string_of(value)?),
            ExprData::ENumber(number) => {
                let number = number.value();
                // The printer writes `null` for a number that JSON has no token for.
                number_token(token) == Some(number) || (!number.is_finite() && token == b"null")
            }
            ExprData::EBoolean(boolean) => {
                token
                    == if boolean.value {
                        b"true".as_slice()
                    } else {
                        b"false"
                    }
            }
            ExprData::ENull(_) => token == b"null",
            ExprData::EObject(_) | ExprData::EArray(_) => false,
            // What JSON has no value for is written as the printer writes it.
            _ => true,
        };
        return is_value.then_some(end);
    };
    let closing = if text[at] == b'{' { b'}' } else { b']' };
    let mut at = scan::next_token(text, at + 1)?;
    for index in 0..entries.len() {
        if let Some(key) = entries.key(index) {
            let key_end = scan::string_end(text, at)?;
            if scan::string_value(&text[at..key_end], scratch) != Some(string_of(key)?) {
                return None;
            }
            let colon = scan::next_token(text, key_end)?;
            if text[colon] != b':' {
                return None;
            }
            at = scan::next_token(text, colon + 1)?;
        }
        let end = value_is_written(text, at, entries.value(index).ok()?, scratch)?;
        at = scan::next_token(text, end)?;
        if text[at] == b',' {
            at = scan::next_token(text, at + 1)?;
        } else if index + 1 != entries.len() {
            return None;
        }
    }
    (text[at] == closing).then_some(at + 1)
}
