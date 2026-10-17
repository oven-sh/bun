//! Prints an edited package.json tree over the text that it was parsed from.
//!
//! The tree says what the file means, the old text says how it is written. What an edit leaves
//! alone is copied byte for byte: comments, blank lines, line endings, how a string or a number
//! is spelled. Only a changed value, a new member and the commas around a member that was added
//! or removed are printed.
//!
//! Nothing here reads the position of a node. The editors change nodes in place and put in
//! nodes of other files, so a position does not say that a node is as the text has it. A member
//! of the tree is the member of the text that has its key, and it is as written if the parser
//! reads the token of the text as the value of the tree.

use bun_ast::{E, Expr, ExprData, G, Indentation, IndentationCharacter, Log, Source};
use bun_collections::index_sort;
use bun_core::{MutableString, StackCheck, strings};
use bun_js_printer as js_printer;

use std::borrow::Cow;

use crate::bun_json::scan::Scalar;
use crate::bun_json::{self as json, scan};

/// The text of a package.json that was `old`, now that its tree is `root`.
pub fn print(old: &[u8], root: Expr, indentation: Indentation) -> js_printer::Result<Vec<u8>> {
    Ok(write(old, root, indentation, false)?.0)
}

/// [`print`], and what the parser read the new text as, with the position of every value.
/// `None` for a text that was printed as a whole: nothing has read that one.
pub(crate) fn print_and_read(
    old: &[u8],
    root: Expr,
    indentation: Indentation,
) -> js_printer::Result<(Vec<u8>, Option<json::ParsedJson>)> {
    write(old, root, indentation, true)
}

/// The parser reads every text that is written over `old` before it is returned. A text that
/// does not read as `root`, or that has a comment or a trailing comma when `old` has none, is
/// not returned: that is a bug of this file, and no edit is lost to it. The whole file is then
/// printed from `root`, as a file without a text is (an empty file, a root that was not parsed
/// from `old`).
fn write(
    old: &[u8],
    root: Expr,
    indentation: Indentation,
    with_positions: bool,
) -> js_printer::Result<(Vec<u8>, Option<json::ParsedJson>)> {
    let mut text = Text::new(old, indentation);
    let stack = text.stack;
    let is_wrong = match text.document(&root) {
        Ok(()) => {
            let new = text.out.list;
            if let Some(read) = read_new(&new, old, text.looks_jsonc, with_positions)
                && is_tree(&read.root, &root, stack)
            {
                return Ok((new, Some(read)));
            }
            debug_assert!(false, "package.json text does not say what its tree says");
            true
        }
        Err(Stop::Printer(err)) => return Err(err),
        Err(Stop::NotTheText) => false,
    };
    // A text that `root` was parsed from, and that no edit has changed, says it as it is.
    let same = old.to_vec();
    if let Some(read) = read(&same, json::PACKAGE_JSON_OPTS, with_positions)
        && is_tree(&read.root, &root, stack)
    {
        return Ok((same, Some(read)));
    }
    if is_wrong {
        bun_core::warn!(
            "Bun could not write this edit into the text of package.json, and printed the whole file again without its comments and formatting. This is a bug in Bun. Please report it at https://github.com/oven-sh/bun/issues",
        );
    }
    Ok((print_new_file(old, root, indentation)?, None))
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

/// What the parser reads `new` as. `None` also for a text that has a comment or a trailing
/// comma when `old` has none: strict JSON stays strict JSON.
///
/// `old_looks_jsonc` only says which dialect to read first, so that a file is read once when
/// it is as it looks. Whether `old` is strict JSON is for the parser to say.
fn read_new(
    new: &[u8],
    old: &[u8],
    old_looks_jsonc: bool,
    with_positions: bool,
) -> Option<json::ParsedJson> {
    let strict = json::JSONOptions::DEFAULT;
    let old_is_jsonc = || read(old, strict, false).is_none();
    if old_looks_jsonc {
        let read_as_jsonc = read(new, json::PACKAGE_JSON_OPTS, with_positions)?;
        return if old_is_jsonc() {
            Some(read_as_jsonc)
        } else {
            read(new, strict, with_positions)
        };
    }
    read(new, strict, with_positions).or_else(|| {
        if old_is_jsonc() {
            read(new, json::PACKAGE_JSON_OPTS, with_positions)
        } else {
            None
        }
    })
}

/// The rows of the parser for `text`: no tree is made of them to compare them with one.
fn read(text: &[u8], opts: json::JSONOptions, with_positions: bool) -> Option<json::ParsedJson> {
    bun_ast::initialize_store();
    let source = Source::init_path_string(b"package.json", text);
    let opts = json::JSONOptions {
        json_warn_duplicate_keys: false,
        record_value_locs: with_positions,
        ..opts
    };
    json::ParsedJson::parse_with_opts(opts, &source, &mut Log::init()).ok()
}

/// Whether `read`, what the parser read, is the tree `root`.
fn is_tree(read: &Expr, root: &Expr, stack: StackCheck) -> bool {
    match (&read.data, &root.data) {
        (ExprData::EObjectJSON(read), ExprData::EObject(root)) => {
            is_object(read.get(), root, stack)
        }
        (ExprData::EArrayJSON(read), ExprData::EArray(root)) => is_array(read.get(), root, stack),
        _ => false,
    }
}

fn is_object(read: &E::ObjectJSON, root: &E::Object, stack: StackCheck) -> bool {
    let rows = read.properties();
    rows.len() == root.properties.len()
        && rows
            .iter()
            .zip(root.properties.iter())
            .all(|(row, member)| match (&member.key, &member.value) {
                (Some(key), Some(value)) => {
                    is_string(row.key.slice(), key) && is_value(&row.value, value, stack)
                }
                _ => false,
            })
}

fn is_array(read: &E::ArrayJSON, root: &E::Array, stack: StackCheck) -> bool {
    let items = read.items();
    items.len() == root.items.len()
        && items
            .iter()
            .zip(root.items.iter())
            .all(|(item, value)| is_value(item, value, stack))
}

fn is_string(read: &[u8], root: &Expr) -> bool {
    matches!(&root.data, ExprData::EString(string) if string.next.is_none() && string.eql_bytes(read))
}

fn is_value(read: &E::JsonValue, root: &Expr, stack: StackCheck) -> bool {
    if !stack.is_safe_to_recurse() {
        return false;
    }
    match (read, &root.data) {
        (E::JsonValue::Object(read), ExprData::EObject(root)) => is_object(read.get(), root, stack),
        (E::JsonValue::Array(read), ExprData::EArray(root)) => is_array(read.get(), root, stack),
        (E::JsonValue::String(read), _) => is_string(read.slice(), root),
        (E::JsonValue::Number(read), ExprData::ENumber(root)) => {
            read.value().to_bits() == root.value().to_bits()
        }
        // The printer writes `null` for a number that JSON has no token for.
        (E::JsonValue::Null, ExprData::ENumber(root)) => !root.value().is_finite(),
        (E::JsonValue::Boolean(read), ExprData::EBoolean(root)) => *read == root.value,
        (E::JsonValue::Null, ExprData::ENull(_)) => true,
        _ => false,
    }
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

/// A member of an object or an item of an array, as the old text has it.
#[derive(Clone, Copy)]
struct Member {
    /// The key of a member. An item has no key: `key..key_end` is its value.
    key: usize,
    key_end: usize,
    value: usize,
    value_end: usize,
    comma: Option<usize>,
    /// `Text::containers` index of its value, if that is an object or an array.
    container: Option<usize>,
    /// The key, the value: a string without an escape. What is between its quotes is the string.
    key_is_plain: bool,
    value_is_plain: bool,
}

impl Member {
    fn old_value(&self) -> OldValue {
        OldValue {
            at: self.value,
            end: self.value_end,
            container: self.container,
            is_plain: self.value_is_plain,
        }
    }
}

/// A value of the old text.
#[derive(Clone, Copy)]
struct OldValue {
    at: usize,
    end: usize,
    container: Option<usize>,
    is_plain: bool,
}

/// An object or an array of the old text. Its members are `Text::members[first..first + len]`.
#[derive(Clone, Copy)]
struct Container {
    open: usize,
    close: usize,
    first: usize,
    len: usize,
}

/// Where the lines of a container are. Only a container that gets, loses or moves a member
/// needs to know.
struct Lines {
    /// Where the rest of the line of the opening bracket ends.
    head_end: usize,
    head_ends_line: bool,
    members: Vec<MemberLines>,
}

/// The lines of a member.
#[derive(Clone, Copy)]
struct MemberLines {
    /// Where the lines above it start: blank lines, comments, then its indentation.
    lead: usize,
    /// Where the rest of its line ends: a comment, then the line break.
    end: usize,
    starts_line: bool,
    ends_line: bool,
}

impl Lines {
    /// Whether the members of the container are on lines of their own.
    fn has_lines(&self) -> bool {
        self.head_ends_line || self.members.iter().any(|member| member.ends_line)
    }
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

    /// What pairs an entry with a member of the text.
    fn name(self, index: usize) -> Option<Name<'e>> {
        match self {
            Entries::Members(members) => string_of(members[index].key.as_ref()?).map(Name::String),
            Entries::Items { items, .. } => match string_of(&items[index]) {
                Some(string) => Some(Name::String(string)),
                None => scalar_of_value(&items[index]).map(Name::Scalar),
            },
        }
    }
}

/// What a member of the text and an entry of the tree have in common when they are the same
/// one: the key of a member of an object. An item of an array has no key, so a string, a
/// number, `true`, `false` and `null` are what they are. An object and an array in an array
/// have no name.
#[derive(Clone, Copy)]
enum Name<'e> {
    String(&'e [u8]),
    Scalar(Scalar),
}

impl Name<'_> {
    fn hash(self) -> u64 {
        match self {
            Name::String(string) => bun_wyhash::hash(string),
            Name::Scalar(Scalar::Number(number)) => {
                bun_wyhash::hash(&number.to_bits().to_ne_bytes())
            }
            Name::Scalar(Scalar::Boolean(boolean)) => u64::from(boolean),
            Name::Scalar(Scalar::Null) => 2,
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

fn scalar_of_value(value: &Expr) -> Option<Scalar> {
    match &value.data {
        ExprData::ENumber(number) => Some(Scalar::Number(number.value())),
        ExprData::EBoolean(boolean) => Some(Scalar::Boolean(boolean.value)),
        ExprData::ENull(_) => Some(Scalar::Null),
        _ => None,
    }
}

/// What the parser reads a token that is not a string, an object or an array as.
fn scalar_of(token: &[u8]) -> Option<Scalar> {
    match token {
        b"true" => return Some(Scalar::Boolean(true)),
        b"false" => return Some(Scalar::Boolean(false)),
        b"null" => return Some(Scalar::Null),
        _ => {}
    }
    // Nine digits at most, without a zero before them, are that integer. Any other spelling
    // is the parser's to read.
    if token.len() <= 9
        && token.iter().all(u8::is_ascii_digit)
        && token
            .first()
            .is_some_and(|first| *first != b'0' || token.len() == 1)
    {
        let integer = token.iter().fold(0u32, |integer, digit| {
            integer * 10 + u32::from(digit - b'0')
        });
        return Some(Scalar::Number(f64::from(integer)));
    }
    scan::scalar(token)
}

/// Whether the two are one value. `0` is not `-0`: the file says which one it has.
fn is_scalar(written: Scalar, value: Scalar) -> bool {
    match (written, value) {
        (Scalar::Number(written), Scalar::Number(value)) => written.to_bits() == value.to_bits(),
        (Scalar::Boolean(written), Scalar::Boolean(value)) => written == value,
        (Scalar::Null, Scalar::Null) => true,
        _ => false,
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
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

fn has_line_break(text: &[u8]) -> bool {
    strings::index_of_any(text, b"\n\r").is_some()
}

struct Text<'a> {
    text: &'a [u8],
    out: MutableString,
    indentation: Indentation,
    line_break: &'static [u8],
    /// Every object and array of the old text, a container after the ones in it.
    containers: Vec<Container>,
    /// The members of `containers`.
    members: Vec<Member>,
    /// The members of the containers that are still open while the old text is read.
    open_members: Vec<Member>,
    scratch: Vec<u8>,
    /// A `//` comment was written without its line break: what comes next starts a line.
    in_line_comment: bool,
    /// The old text has a comment or a trailing comma, as far as it was read.
    looks_jsonc: bool,
    stack: StackCheck,
    no_source: Source,
}

impl<'a> Text<'a> {
    fn new(text: &'a [u8], indentation: Indentation) -> Self {
        let crlf = strings::index_of_char_usize(text, b'\n')
            .is_some_and(|line_end| line_end > 0 && text[line_end - 1] == b'\r');
        Text {
            text,
            out: MutableString {
                list: Vec::with_capacity(text.len() + 64),
            },
            indentation: Indentation {
                count: 0,
                ..indentation
            },
            line_break: if crlf { b"\r\n" } else { b"\n" },
            containers: Vec::with_capacity(16),
            members: Vec::with_capacity(32),
            open_members: Vec::with_capacity(32),
            scratch: Vec::new(),
            in_line_comment: false,
            looks_jsonc: false,
            stack: StackCheck::init(),
            no_source: Source::init_empty_file(b"package.json"),
        }
    }

    /// `indent` and one level of indentation more.
    fn indented(&self, indent: &[u8]) -> Vec<u8> {
        let unit = match self.indentation.character {
            IndentationCharacter::Space => b' ',
            IndentationCharacter::Tab => b'\t',
        };
        let mut indented = Vec::with_capacity(indent.len() + self.indentation.scalar);
        indented.extend_from_slice(indent);
        indented.resize(indent.len() + self.indentation.scalar, unit);
        indented
    }

    fn document(&mut self, root: &Expr) -> Step {
        let text = self.text;
        let start = self.token(0)?;
        if Entries::of(root, text[start]).is_none() {
            return Err(Stop::NotTheText);
        }
        let index = self.read(start)?;
        let container = self.containers[index];
        self.looks_jsonc |= text[container.close..].contains(&b'/');
        let old = OldValue {
            at: start,
            end: container.close + 1,
            container: Some(index),
            is_plain: false,
        };
        self.put(&text[..start]);
        self.value(root, old)?;
        self.put(&text[old.end..]);
        if self.out.list == text || self.lines_of(&container).has_lines() {
            return Ok(());
        }
        // A root that is written on one line has no layout to keep: it gets the printer's.
        self.out.list.clear();
        self.in_line_comment = false;
        self.put(&text[..start]);
        self.lay_out_value(root, old, self.line_indent(start))?;
        self.put(&text[old.end..]);
        Ok(())
    }

    // ───── the old text ─────

    fn member(&self, container: &Container, index: usize) -> Member {
        self.members[container.first + index]
    }

    /// The entries of `value` and the container that `old` is, if both are an object or both an array.
    fn container_of<'e>(&self, value: &'e Expr, old: OldValue) -> Option<(Entries<'e>, Container)> {
        let entries = Entries::of(value, self.text[old.at])?;
        Some((entries, self.containers[old.container?]))
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

    /// Where the next token of the old text is, at or after `at`.
    fn token(&mut self, at: usize) -> Step<usize> {
        let gap = scan::gap(self.text, at).ok_or(Stop::NotTheText)?;
        self.looks_jsonc |= gap.has_comment;
        Ok(gap.end)
    }

    /// Reads the container that opens at `open` and the containers in it, each token once.
    /// Returns its index in `self.containers`.
    fn read(&mut self, open: usize) -> Step<usize> {
        if !self.stack.is_safe_to_recurse() {
            return Err(Stop::Printer(js_printer::Error::StackOverflow));
        }
        let text = self.text;
        let is_object = text[open] == b'{';
        let closing = if is_object { b'}' } else { b']' };
        let mark = self.open_members.len();
        let mut at = open + 1;
        let mut is_after_comma = false;
        let close = loop {
            let token = self.token(at)?;
            if text[token] == closing {
                self.looks_jsonc |= is_after_comma;
                break token;
            }
            let mut member = Member {
                key: token,
                key_end: 0,
                value: token,
                value_end: 0,
                comma: None,
                container: None,
                key_is_plain: false,
                value_is_plain: false,
            };
            if is_object {
                let key = scan::string(text, token).ok_or(Stop::NotTheText)?;
                let colon = self.token(key.end)?;
                if text[colon] != b':' {
                    return Err(Stop::NotTheText);
                }
                member.key_end = key.end;
                member.key_is_plain = !key.has_escape;
                member.value = self.token(colon + 1)?;
            }
            match text[member.value] {
                b'{' | b'[' => {
                    let container = self.read(member.value)?;
                    member.value_end = self.containers[container].close + 1;
                    member.container = Some(container);
                }
                b'"' | b'\'' => {
                    let string = scan::string(text, member.value).ok_or(Stop::NotTheText)?;
                    member.value_end = string.end;
                    member.value_is_plain = !string.has_escape;
                }
                _ => {
                    member.value_end =
                        scan::value_end(text, member.value).ok_or(Stop::NotTheText)?;
                }
            }
            if !is_object {
                member.key_end = member.value_end;
                member.key_is_plain = member.value_is_plain;
            }
            at = self.token(member.value_end)?;
            is_after_comma = text[at] == b',';
            if is_after_comma {
                member.comma = Some(at);
                at += 1;
            } else if text[at] != closing {
                return Err(Stop::NotTheText);
            }
            self.open_members.push(member);
        };
        let first = self.members.len();
        self.members.extend_from_slice(&self.open_members[mark..]);
        self.open_members.truncate(mark);
        self.containers.push(Container {
            open,
            close,
            first,
            len: first.abs_diff(self.members.len()),
        });
        Ok(self.containers.len() - 1)
    }

    /// Where the lines of `container` are.
    fn lines_of(&self, container: &Container) -> Lines {
        let first_key = if container.len == 0 {
            container.close
        } else {
            self.member(container, 0).key
        };
        let (head_end, head_ends_line) = self.rest_of_line(container.open + 1, first_key);
        let mut members = Vec::with_capacity(container.len);
        let (mut lead, mut starts_line) = (head_end, head_ends_line);
        for index in 0..container.len {
            let member = self.member(container, index);
            let next_key = if index + 1 < container.len {
                self.member(container, index + 1).key
            } else {
                container.close
            };
            let after = member.comma.map_or(member.value_end, |comma| comma + 1);
            let (end, ends_line) = self.rest_of_line(after, next_key);
            members.push(MemberLines {
                lead,
                end,
                starts_line,
                ends_line,
            });
            (lead, starts_line) = (end, ends_line);
        }
        Lines {
            head_end,
            head_ends_line,
            members,
        }
    }

    /// Whether the string token `token` spells `string`. `is_plain`: it has no escape.
    fn string_token_is(&mut self, token: &[u8], is_plain: bool, string: &[u8]) -> bool {
        if is_plain {
            return &token[1..token.len() - 1] == string;
        }
        scan::string_value(token, &mut self.scratch) == Some(string)
    }

    /// Whether the token of `old` is how the old text spells `value`.
    fn is_token(&mut self, old: OldValue, value: &Expr) -> bool {
        let token = &self.text[old.at..old.end];
        if let Some(string) = string_of(value) {
            return self.string_token_is(token, old.is_plain, string);
        }
        scalar_of_value(value).is_some_and(|value| {
            kind_of_token(token[0]) == Kind::Scalar
                && scalar_of(token).is_some_and(|written| is_scalar(written, value))
        })
    }

    /// Whether the member `old` of the text has the name `name`.
    fn is_named(&mut self, container: &Container, old: usize, name: Name<'_>) -> bool {
        let member = &self.members[container.first + old];
        let (token, is_plain) = (&self.text[member.key..member.key_end], member.key_is_plain);
        match name {
            Name::String(string) => self.string_token_is(token, is_plain, string),
            Name::Scalar(value) => {
                kind_of_token(token[0]) == Kind::Scalar
                    && scalar_of(token).is_some_and(|written| is_scalar(written, value))
            }
        }
    }

    /// Whether the tree has the members of the text, each where the text has it. The values
    /// of an object can be other values. What has no name in an array (an object, an array)
    /// is what the text has there.
    fn has_same_members(&mut self, container: &Container, entries: Entries<'_>) -> bool {
        if entries.len() != container.len {
            return false;
        }
        for index in 0..container.len {
            match entries.name(index) {
                Some(name) => {
                    if !self.is_named(container, index, name) {
                        return false;
                    }
                }
                None => {
                    if let Entries::Members(_) = entries {
                        return false;
                    }
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
            let name = match kind_of_token(token[0]) {
                Kind::String if member.key_is_plain => {
                    Some(Name::String(&token[1..token.len() - 1]))
                }
                Kind::String => scan::string_value(token, &mut self.scratch).map(Name::String),
                Kind::Scalar => scalar_of(token).map(Name::Scalar),
                Kind::Object | Kind::Array => None,
            };
            if let Some(name) = name {
                names.push((name.hash(), index));
            }
        }
        index_sort::sort_slice_unstable(&mut names);
        names
    }

    /// For each entry of the tree, the member of the text that it is, if it is one, and for each
    /// member of the text, whether the tree still has it.
    ///
    /// An entry is the first member with its name that no entry before it is. What is then
    /// left of an array is paired in order with an item of its kind: a number that changed, an
    /// object and an array are the ones that the text has there.
    fn pair(
        &mut self,
        container: &Container,
        entries: Entries<'_>,
    ) -> (Vec<Option<usize>>, Vec<bool>) {
        let text = self.text;
        let old_len = container.len;
        let mut pairs: Vec<Option<usize>> = Vec::with_capacity(entries.len());
        let mut taken = vec![false; old_len];
        // The member after the one that was paired last: where the entry is, if nothing moved.
        let mut next = 0;
        // Made when an entry is not where it is looked for first.
        let mut names: Option<Vec<(u64, usize)>> = None;
        for index in 0..entries.len() {
            let Some(name) = entries.name(index) else {
                pairs.push(None);
                continue;
            };
            let mut found = None;
            if next < old_len && !taken[next] && self.is_named(container, next, name) {
                found = Some(next);
            } else {
                let names = names.get_or_insert_with(|| self.names(container));
                let hash = name.hash();
                let mut at = names.partition_point(|&(other, _)| other < hash);
                while at < names.len() && names[at].0 == hash {
                    let old = names[at].1;
                    if !taken[old] && self.is_named(container, old, name) {
                        found = Some(old);
                        break;
                    }
                    at += 1;
                }
            }
            if let Some(old) = found {
                taken[old] = true;
                next = old + 1;
            }
            pairs.push(found);
        }
        if let Entries::Items { items, .. } = entries {
            let mut old = 0;
            for (index, item) in items.iter().enumerate() {
                let kind = kind_of_value(item);
                if pairs[index].is_some() || kind == Kind::String {
                    continue;
                }
                while old < old_len {
                    let candidate = old;
                    old += 1;
                    if !taken[candidate]
                        && kind_of_token(text[self.member(container, candidate).value]) == kind
                    {
                        taken[candidate] = true;
                        pairs[index] = Some(candidate);
                        break;
                    }
                }
            }
        }
        (pairs, taken)
    }

    // ───── the new text ─────

    fn put(&mut self, bytes: &[u8]) {
        if bytes.is_empty() {
            return;
        }
        self.end_line_comment(bytes[0]);
        self.out.list.extend_from_slice(bytes);
    }

    /// Ends the line of a `//` comment before `next` is written after it.
    fn end_line_comment(&mut self, next: u8) {
        if !self.in_line_comment {
            return;
        }
        self.in_line_comment = false;
        if matches!(next, b'\n' | b'\r') {
            return;
        }
        // The next line starts where the line of the comment starts.
        let out = &mut self.out.list;
        let line = strings::last_index_of_char(out, b'\n').map_or(0, |i| i + 1);
        let blanks = out[line..]
            .iter()
            .take_while(|byte| matches!(byte, b' ' | b'\t'))
            .count();
        out.extend_from_slice(self.line_break);
        out.extend_from_within(line..line + blanks);
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
        if let Some(string) = string_of(value) {
            // What the printer writes for a string, without a printer.
            self.end_line_comment(b'"');
            js_printer::quote_for_json(string, &mut self.out, false)?;
            return Ok(());
        }
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

    /// Writes `value` where the old text has the value `old`.
    fn value(&mut self, value: &Expr, old: OldValue) -> Step {
        if !self.stack.is_safe_to_recurse() {
            return Err(Stop::Printer(js_printer::Error::StackOverflow));
        }
        let text = self.text;
        let Some((entries, container)) = self.container_of(value, old) else {
            if self.is_token(old, value) {
                self.put(&text[old.at..old.end]);
            } else {
                self.print(value, self.line_indent(old.at))?;
            }
            return Ok(());
        };
        if self.has_same_members(&container, entries) {
            return self.in_place(&container, entries);
        }
        let (pairs, stays) = self.pair(&container, entries);
        // An array that has every item where the text has one: only values are other values.
        let is_in_place = pairs.len() == container.len
            && pairs
                .iter()
                .enumerate()
                .all(|(index, pair)| *pair == Some(index));
        if is_in_place {
            return self.in_place(&container, entries);
        }
        let lines = self.lines_of(&container);
        if lines.has_lines() {
            self.lines(&container, &lines, entries, &pairs, &stays)
        } else {
            self.lay_out(&container, entries, &pairs, self.line_indent(old.at))
        }
    }

    /// Writes a container that has each of its members where the text has it: the text as it
    /// is, with the values that are not as written.
    fn in_place(&mut self, container: &Container, entries: Entries<'_>) -> Step {
        let text = self.text;
        // What is as it is written is copied in one piece, up to the next value that is not.
        let mut copied = container.open;
        for index in 0..container.len {
            let member = self.member(container, index);
            let value = entries.value(index)?;
            if member.container.is_none() && self.is_token(member.old_value(), value) {
                continue;
            }
            self.put(&text[copied..member.value]);
            self.value(value, member.old_value())?;
            copied = member.value_end;
        }
        self.put(&text[copied..=container.close]);
        Ok(())
    }

    /// Writes a container whose members are on lines of their own and which gained, lost or
    /// moved members: each member of the tree on a line, the lines of the old text as they are.
    fn lines(
        &mut self,
        container: &Container,
        lines: &Lines,
        entries: Entries<'_>,
        pairs: &[Option<usize>],
        stays: &[bool],
    ) -> Step {
        let text = self.text;
        let old_len = container.len;
        let tail = lines.members.last().map_or(lines.head_end, |last| last.end);

        if pairs.is_empty() {
            // Nothing is left but the comments that were on lines of their own.
            let mark = self.out.list.len();
            self.put(&text[container.open..lines.head_end]);
            for old in 0..old_len {
                self.comment_lines_above(&lines.members[old], self.member(container, old).key);
            }
            self.put(&text[tail..=container.close]);
            if !strings::contains_char(&self.out.list[mark..], b'/') {
                self.out.list.truncate(mark);
                self.put(&[text[container.open], text[container.close]]);
            }
            return Ok(());
        }

        // A new member is indented like the first member that starts a line.
        let indent: Cow<'a, [u8]> = (0..old_len)
            .find(|old| lines.members[*old].starts_line)
            .map_or_else(
                || Cow::Owned(self.indented(self.line_indent(container.open))),
                |old| Cow::Borrowed(self.line_indent(self.member(container, old).key)),
            );
        let (has_trailing_comma, close_has_line) = match lines.members.last() {
            None => (false, lines.head_ends_line),
            Some(last) => (
                self.member(container, old_len - 1).comma.is_some(),
                last.ends_line,
            ),
        };

        self.put(&text[container.open..lines.head_end]);
        if !lines.head_ends_line {
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
                let key = self.member(container, removed).key;
                self.comment_lines_above(&lines.members[removed], key);
            }
            let (member, its) = (self.member(container, old), lines.members[old]);
            if its.starts_line {
                self.put(&text[its.lead..member.key]);
            } else {
                self.put(&indent);
                self.comments(its.lead, member.key, Blank::After);
            }
            self.put(&text[member.key..member.value]);
            self.value(entries.value(index)?, member.old_value())?;
            match member.comma {
                Some(comma) if has_line_break(&text[member.value_end..comma]) => {
                    if has_comma {
                        self.put(b",");
                    }
                    self.comments(member.value_end, comma, Blank::Before);
                    self.put(&text[comma + 1..its.end]);
                }
                Some(comma) => {
                    self.put(&text[member.value_end..comma]);
                    if has_comma {
                        self.put(b",");
                    }
                    self.put(&text[comma + 1..its.end]);
                }
                None => {
                    if has_comma {
                        self.put(b",");
                    }
                    self.put(&text[member.value_end..its.end]);
                }
            }
            if ends_line && !its.ends_line {
                self.break_line();
            }
        }
        let mut removed = old_len;
        while removed > 0 && !stays[removed - 1] {
            removed -= 1;
        }
        for removed in removed..old_len {
            let key = self.member(container, removed).key;
            self.comment_lines_above(&lines.members[removed], key);
        }
        self.put(&text[tail..=container.close]);
        Ok(())
    }

    /// Writes the lines above a member that is removed, if a comment is on them. A comment
    /// that ends on the line of the member goes with the member. `key` is where the member is.
    fn comment_lines_above(&mut self, member: &MemberLines, key: usize) {
        if !member.starts_line {
            return;
        }
        let text = self.text;
        // Where the line of the member starts. A line break in a comment does not start it.
        let mut line = member.lead;
        let (mut has_comment, mut is_after_comment) = (false, false);
        let mut at = member.lead;
        while at < key {
            match text[at] {
                b'\n' | b'\r' => {
                    at += 1 + usize::from(text[at] == b'\r' && text.get(at + 1) == Some(&b'\n'));
                    line = at;
                    has_comment |= is_after_comment;
                }
                b'/' => {
                    at = scan::comment_end(text, at).unwrap_or(key);
                    is_after_comment = true;
                }
                _ => at += 1,
            }
        }
        if has_comment {
            self.put(&text[member.lead..line]);
        }
    }

    /// `lay_out` for a value that the old text has.
    fn lay_out_value(&mut self, value: &Expr, old: OldValue, indent: &[u8]) -> Step {
        if !self.stack.is_safe_to_recurse() {
            return Err(Stop::Printer(js_printer::Error::StackOverflow));
        }
        let text = self.text;
        let Some((entries, container)) = self.container_of(value, old) else {
            if self.is_token(old, value) {
                self.put(&text[old.at..old.end]);
                return Ok(());
            }
            return self.print(value, indent);
        };
        let (pairs, _) = self.pair(&container, entries);
        self.lay_out(&container, entries, &pairs, indent)
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
        let inner: Cow<'_, [u8]> = if on_one_line {
            Cow::Borrowed(indent)
        } else {
            Cow::Owned(self.indented(indent))
        };
        self.put(&text[container.open..=container.open]);
        if pairs.is_empty() {
            // A member that goes takes the comments beside it. Only a container that was
            // empty has comments of its own, and only blanks are around them.
            if container.len == 0 {
                self.comments(container.open + 1, container.close, Blank::Before);
                if self.out.list.last() != Some(&text[container.open]) {
                    self.put(b" ");
                }
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
            self.lay_out_value(entries.value(index)?, member.old_value(), &inner)?;
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

#[cfg(test)]
#[path = "package_json_text_tests.rs"]
mod tests;
