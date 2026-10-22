//! Writes an edited package.json tree over its old text. It reads no node position (#11536).

use bun_ast::{E, Expr, ExprData, G, Indentation, IndentationCharacter, Log, Source};
use bun_collections::index_sort;
use bun_core::{MutableString, StackCheck, strings};
use bun_js_printer as js_printer;

use std::borrow::Cow;

use crate::bun_json::scan::Scalar;
use crate::bun_json::{self as json, scan};

/// The text of the package.json at `path` that was `old`, now that its tree is `root`.
pub fn print(
    path: &[u8],
    old: &[u8],
    root: Expr,
    indentation: Indentation,
) -> js_printer::Result<Vec<u8>> {
    Ok(write(path, old, root, indentation, &mut None, false)?.0)
}

/// [`print`], with the parser's rows of the new text: `None` if the file was printed whole.
pub(crate) fn print_and_read(
    path: &[u8],
    old: &[u8],
    root: Expr,
    indentation: Indentation,
    old_is_jsonc: &mut Option<bool>,
) -> js_printer::Result<(Vec<u8>, Option<json::ParsedJson>)> {
    write(path, old, root, indentation, old_is_jsonc, true)
}

/// Returns no text that the parser has not read back as `root`.
fn write(
    path: &[u8],
    old: &[u8],
    root: Expr,
    indentation: Indentation,
    old_is_jsonc: &mut Option<bool>,
    with_positions: bool,
) -> js_printer::Result<(Vec<u8>, Option<json::ParsedJson>)> {
    let mut text = Text::new(old, indentation);
    let stack = text.stack;
    let is_wrong = match text.document(&root) {
        Ok(()) => {
            let new = text.out.list;
            let old = OldText {
                text: old,
                looks_jsonc: text.looks_jsonc,
                is_jsonc: old_is_jsonc,
            };
            if let Some(read) = read_new(&new, old, with_positions)
                && is_tree(&read.root, &root, stack)
            {
                return Ok((new, Some(read)));
            }
            true
        }
        Err(Stop::Printer(err)) => return Err(err),
        Err(Stop::Unread) => true,
        Err(Stop::NotTheText) => false,
    };
    // A text that `root` was parsed from, and that no edit has changed, says it as it is.
    let same = old.to_vec();
    if let Some(read) = read(&same, json::PACKAGE_JSON_OPTS, Extent::Root, with_positions)
        && is_tree(&read.root, &root, stack)
    {
        debug_assert!(!is_wrong, "package.json text is not written over itself");
        return Ok((same, Some(read)));
    }
    let whole = print_new_file(old, root, indentation)?;
    // A tree that the printer cannot write either (a string that is not UTF-8) is not a bug here.
    if is_wrong
        && read(&whole, json::PACKAGE_JSON_OPTS, Extent::Root, false)
            .is_some_and(|read| is_tree(&read.root, &root, stack))
    {
        debug_assert!(false, "package.json text does not say what its tree says");
        bun_core::warn!(
            "could not write the edit into the text of {}: the whole file is printed again, without its comments and formatting",
            bun_core::fmt::quote(path),
        );
        bun_core::note!("this is a bug in Bun: report it at https://github.com/oven-sh/bun/issues");
    }
    Ok((whole, None))
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

/// The old text, for the question whether a new text may have comments and trailing commas.
struct OldText<'a> {
    text: &'a [u8],
    /// What the scanners saw. It only picks the dialect to read the new text in first.
    looks_jsonc: bool,
    /// What the parser says, once it was asked.
    is_jsonc: &'a mut Option<bool>,
}

impl OldText<'_> {
    fn is_jsonc(&mut self) -> bool {
        *self.is_jsonc.get_or_insert_with(|| {
            read(
                self.text,
                json::JSONOptions::DEFAULT,
                Extent::Document,
                false,
            )
            .is_none()
        })
    }
}

/// What the parser reads `new` as. `None` also if `new` is less strict JSON than the old text.
fn read_new(new: &[u8], mut old: OldText<'_>, with_positions: bool) -> Option<json::ParsedJson> {
    let strict = json::JSONOptions::DEFAULT;
    if old.looks_jsonc {
        let read_as_jsonc = read(
            new,
            json::PACKAGE_JSON_OPTS,
            Extent::Document,
            with_positions,
        )?;
        return if old.is_jsonc() {
            Some(read_as_jsonc)
        } else {
            read(new, strict, Extent::Document, with_positions)
        };
    }
    read(new, strict, Extent::Document, with_positions).or_else(|| {
        if old.is_jsonc() {
            read(
                new,
                json::PACKAGE_JSON_OPTS,
                Extent::Document,
                with_positions,
            )
        } else {
            None
        }
    })
}

/// How far the parser reads a text.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Extent {
    /// To the end of the root, as a command reads a package.json.
    Root,
    /// To the end of the text: after the root it takes blanks and comments only.
    Document,
}

/// The parser's rows for `text`.
fn read(
    text: &[u8],
    opts: json::JSONOptions,
    extent: Extent,
    with_positions: bool,
) -> Option<json::ParsedJson> {
    bun_ast::initialize_store();
    let source = Source::init_path_string(b"package.json", text);
    let opts = json::JSONOptions {
        json_warn_duplicate_keys: false,
        record_value_locs: with_positions,
        ..opts
    };
    let is_document = extent == Extent::Document;
    json::ParsedJson::parse_with_opts(opts, is_document, &source, &mut Log::init()).ok()
}

/// Whether `read`, what the parser read, is the tree `root`.
fn is_tree(read: &Expr, root: &Expr, stack: StackCheck) -> bool {
    match (&read.data, &root.data) {
        (ExprData::EObjectJSON(read), ExprData::EObject(root)) => {
            is_object(read.get(), root, stack)
        }
        (ExprData::EArrayJSON(read), ExprData::EArray(root)) => is_array(read.get(), root, stack),
        (ExprData::EString(read), ExprData::EString(_)) => is_string(&read.data, root),
        (ExprData::ENumber(read), ExprData::ENumber(root)) => {
            read.value().to_bits() == root.value().to_bits()
        }
        (ExprData::EBoolean(read), ExprData::EBoolean(root)) => read.value == root.value,
        (ExprData::ENull(_), ExprData::ENull(_)) => true,
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
    /// `root` is not the tree of this text: the file is printed as a whole.
    NotTheText,
    /// The scanners do not read what the parser read.
    Unread,
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

/// Where the lines of a container are, for one that gets, loses or moves a member.
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
    Items(&'e [Expr]),
}

impl<'e> Entries<'e> {
    fn of(value: &'e Expr, open: u8) -> Option<Entries<'e>> {
        match (&value.data, open) {
            (ExprData::EObject(object), b'{') => {
                Some(Entries::Members(object.properties.as_slice()))
            }
            (ExprData::EArray(array), b'[') => Some(Entries::Items(array.items.as_slice())),
            _ => None,
        }
    }

    fn len(self) -> usize {
        match self {
            Entries::Members(members) => members.len(),
            Entries::Items(items) => items.len(),
        }
    }

    fn key(self, index: usize) -> Option<&'e Expr> {
        match self {
            Entries::Members(members) => members[index].key.as_ref(),
            Entries::Items(_) => None,
        }
    }

    fn value(self, index: usize) -> Step<&'e Expr> {
        match self {
            Entries::Members(members) => members[index].value.as_ref().ok_or(Stop::NotTheText),
            Entries::Items(items) => Ok(&items[index]),
        }
    }

    /// What pairs an entry with a member of the text.
    fn name(self, index: usize) -> Option<Name<'e>> {
        match self {
            Entries::Members(members) => string_of(members[index].key.as_ref()?).map(Name::String),
            Entries::Items(items) => match string_of(&items[index]) {
                Some(string) => Some(Name::String(string)),
                None => scalar_of_value(&items[index]).map(Name::Scalar),
            },
        }
    }
}

/// What pairs an entry with a member: a key, or what an array item is. A container has none.
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
    // Nine digits at most are that integer. Any other spelling is the parser's to read.
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

/// How `text` ends its lines.
pub fn line_break(text: &[u8]) -> &'static [u8] {
    let crlf = strings::index_of_char_usize(text, b'\n')
        .is_some_and(|line_end| line_end > 0 && text[line_end - 1] == b'\r');
    if crlf { b"\r\n" } else { b"\n" }
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
    /// How far an object or an array of an array is looked for among the items of the text.
    const PAIR_WINDOW: usize = 64;

    fn new(text: &'a [u8], indentation: Indentation) -> Self {
        Text {
            text,
            out: MutableString {
                list: Vec::with_capacity(text.len() + 64),
            },
            indentation: Indentation {
                count: 0,
                ..indentation
            },
            line_break: line_break(text),
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
        // Without a token it is a new file.
        let lead = scan::gap(text, 0).ok_or(Stop::NotTheText)?;
        let start = lead.end;
        if Entries::of(root, text[start]).is_none() {
            return Err(Stop::NotTheText);
        }
        let index = self.read(start)?;
        let container = self.containers[index];
        let tail = container.close + 1;
        // The parser stops at the end of the root: what else follows is not written back.
        if scan::gap(text, tail).is_some() {
            return Err(Stop::NotTheText);
        }
        self.looks_jsonc |= lead.has_comment || strings::contains_char(&text[tail..], b'/');
        let old = OldValue {
            at: start,
            end: tail,
            container: Some(index),
            is_plain: false,
        };
        self.put(&text[..start]);
        self.value(root, old)?;
        self.put(&text[tail..]);
        if self.out.list == text {
            return Ok(());
        }
        if !self.lines_of(&container).has_lines() {
            // A root that is written on one line has no layout to keep: it gets the printer's.
            self.out.list.clear();
            self.in_line_comment = false;
            self.put(&text[..start]);
            self.print(root, self.line_indent(start))?;
            self.put(&text[tail..]);
        }
        // An edit takes the byte order mark, as the print of the whole file does.
        let mark = self.out.list.len() - strings::without_utf8_bom(&self.out.list).len();
        self.out.list.drain(..mark);
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

    /// Where the last comment of `text[from..limit]` ends: `from` if it has none.
    fn comments_end(&self, from: usize, limit: usize) -> usize {
        let text = self.text;
        let (mut at, mut end) = (from, from);
        while at < limit {
            match (text[at] == b'/')
                .then(|| scan::comment_end(text, at))
                .flatten()
            {
                Some(comment_end) => (at, end) = (comment_end, comment_end),
                None => at += 1,
            }
        }
        end
    }

    /// Where the next token of the old text is, at or after `at`.
    fn token(&mut self, at: usize) -> Step<usize> {
        let gap = scan::gap(self.text, at).ok_or(Stop::Unread)?;
        self.looks_jsonc |= gap.has_comment;
        Ok(gap.end)
    }

    /// Reads the container at `open` and those in it. Returns its index in `self.containers`.
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
                let key = scan::string(text, token).ok_or(Stop::Unread)?;
                let colon = self.token(key.end)?;
                if text[colon] != b':' {
                    return Err(Stop::Unread);
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
                    let string = scan::string(text, member.value).ok_or(Stop::Unread)?;
                    member.value_end = string.end;
                    member.value_is_plain = !string.has_escape;
                }
                _ => {
                    member.value_end = scan::value_end(text, member.value).ok_or(Stop::Unread)?;
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
                return Err(Stop::Unread);
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
            let (mut end, ends_line) = self.rest_of_line(after, next_key);
            if !ends_line && index + 1 == container.len {
                // The closing bracket is on the line of the last member: a comment before it is that member's.
                end = self.comments_end(after, container.close);
            }
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

    /// Whether the tree has the members of the text, each in its place. Array items: as written.
    fn has_same_members(&mut self, container: &Container, entries: Entries<'_>) -> bool {
        if entries.len() != container.len {
            return false;
        }
        for index in 0..container.len {
            let is_same = match (entries.name(index), entries) {
                (Some(name), _) => self.is_named(container, index, name),
                (None, Entries::Members(_)) => false,
                (None, Entries::Items(items)) => {
                    let member = self.member(container, index);
                    self.says(member.old_value(), &items[index])
                }
            };
            if !is_same {
                return false;
            }
        }
        true
    }

    /// Whether the old text at `old` says all of `value`.
    fn says(&mut self, old: OldValue, value: &Expr) -> bool {
        if !self.stack.is_safe_to_recurse() {
            return false;
        }
        let Some((entries, container)) = self.container_of(value, old) else {
            return old.container.is_none() && self.is_token(old, value);
        };
        if !self.has_same_members(&container, entries) {
            return false;
        }
        match entries {
            // `has_same_members` has read every item of an array in full. A second read here doubles the work at each level.
            Entries::Items(_) => true,
            Entries::Members(_) => (0..container.len).all(|index| {
                let member = self.member(&container, index);
                entries
                    .value(index)
                    .is_ok_and(|value| self.says(member.old_value(), value))
            }),
        }
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

    /// For each entry its member of the text, and for each member whether the tree still has it. `None`: a look met a member of another name that has its hash.
    fn pair(
        &mut self,
        container: &Container,
        entries: Entries<'_>,
    ) -> Option<(Vec<Option<usize>>, Vec<bool>)> {
        let text = self.text;
        let old_len = container.len;
        let mut pairs: Vec<Option<usize>> = vec![None; entries.len()];
        let mut taken = vec![false; old_len];
        let names = self.names(container);
        // For a hash that many members have: how many of them are taken, from the first one on.
        let mut taken_first: Vec<usize> = Vec::new();
        for (index, pair) in pairs.iter_mut().enumerate() {
            let Some(name) = entries.name(index) else {
                continue;
            };
            let hash = name.hash();
            let first = names.partition_point(|&(other, _)| other < hash);
            let mut skip = taken_first.get(first).copied().unwrap_or(0);
            let mut at = first + skip;
            while at < names.len() && names[at].0 == hash {
                let old = names[at].1;
                if taken[old] {
                    skip += 1;
                    if taken_first.is_empty() {
                        taken_first.resize(names.len(), 0);
                    }
                    taken_first[first] = skip;
                } else if self.is_named(container, old, name) {
                    taken[old] = true;
                    *pair = Some(old);
                    break;
                } else {
                    return None;
                }
                at += 1;
            }
        }
        let Entries::Items(items) = entries else {
            return Some((pairs, taken));
        };
        // The objects and arrays of the tree and of the text, in order.
        let theirs: Vec<usize> = (0..items.len())
            .filter(|index| matches!(kind_of_value(&items[*index]), Kind::Object | Kind::Array))
            .collect();
        let ours: Vec<usize> = (0..old_len)
            .filter(|old| self.member(container, *old).container.is_some())
            .collect();
        let mut is_pair = |text: &mut Self, their: usize, our: usize| {
            let member = text.member(container, ours[our]);
            let is_pair = text.says(member.old_value(), &items[theirs[their]]);
            if is_pair {
                taken[ours[our]] = true;
                pairs[theirs[their]] = Some(ours[our]);
            }
            is_pair
        };
        // From both ends, the ones that say each other are each other.
        let mut first = 0;
        while first < theirs.len().min(ours.len()) && is_pair(self, first, first) {
            first += 1;
        }
        let (mut their_end, mut our_end) = (theirs.len(), ours.len());
        while their_end > first && our_end > first && is_pair(self, their_end - 1, our_end - 1) {
            their_end -= 1;
            our_end -= 1;
        }
        // Between those, one of the tree is the next of the text that says all of it.
        let mut next = first;
        for their in first..their_end {
            let found = (next..our_end.min(next + Self::PAIR_WINDOW))
                .find(|our| is_pair(self, their, *our));
            if let Some(our) = found {
                next = our + 1;
            }
        }
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
        Some((pairs, taken))
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
            if let Entries::Items(_) = entries {
                self.put(&text[container.open..=container.close]);
                return Ok(());
            }
            return self.in_place(&container, entries);
        }
        let Some((pairs, stays)) = self.pair(&container, entries) else {
            bun_core::hint::cold();
            // Two names of one hash: the printer writes the container, as it writes one that is on one line.
            return self.print(value, self.line_indent(old.at));
        };
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
            // A container that is written on one line has no layout to keep: it gets the printer's.
            self.print(value, self.line_indent(old.at))
        }
    }

    /// Writes a container whose members are all in place: the text, with the values that changed.
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

    /// Writes a container on lines that gained, lost or moved members: old lines stay as they are.
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
            self.end_line_comment(text[container.open]);
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

    /// Writes the lines above a removed member (at `key`) if a comment is on them.
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
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Blank {
    Before,
    After,
}

#[cfg(test)]
#[path = "package_json_text_tests.rs"]
mod tests;
