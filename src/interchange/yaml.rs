//! YAML parser ported from src/interchange/yaml.zig
//!
//! NOTE ON GENERICITY: Zig's `Parser(comptime enc: Encoding)` returns a type whose
//! `enc.unit()` is `u8` or `u16`. Rust const generics cannot return types, so this
//! port models `Encoding` as a trait with an associated `Unit` type, and `Parser<Enc>`
//! is generic over `Enc: Encoding`.
//!
//! NOTE ON LABELED SWITCH: Zig's `label: switch (x) { ... continue :label y; }` is a
//! state-machine loop. These are ported as `let mut __c = x; loop { match __c { ... } }`
//! with `__c = y; continue;` for `continue :label y`. Each is marked
//! `// PORT NOTE: labeled-switch loop`.

use core::cmp::Ordering;
use core::fmt;

use bun_alloc::AllocError;
use bun_collections::{BabyList, StringHashMap};
use bun_core::{self, StackCheck};
use bun_js_parser::ast::{self, Expr, E, G};
use bun_logger::{self as logger, Loc, Log, Source};

// ───────────────────────────────────────────────────────────────────────────
// YAML entry point
// ───────────────────────────────────────────────────────────────────────────

pub struct YAML;

impl YAML {
    pub fn parse(
        source: &logger::Source,
        log: &mut logger::Log,
    ) -> Result<Expr, YamlParseError> {
        bun_core::analytics::Features::yaml_parse_inc(1);

        let mut parser: Parser<Utf8> = Parser::init(source.contents());

        let stream = match parser.parse() {
            Ok(s) => s,
            Err(e) => {
                let err = ParseResult::<Utf8>::fail(e, &parser);
                if let ParseResult::Err(err) = err {
                    err.add_to_log(source, log)?;
                }
                return Err(YamlParseError::SyntaxError);
            }
        };

        match stream.docs.len() {
            0 => Ok(Expr::init(E::Null, E::Null {}, Loc::EMPTY)),
            1 => Ok(stream.docs[0].root.clone()),
            _ => {
                // multi-document yaml streams are converted into arrays
                let mut items: BabyList<Expr> = BabyList::with_capacity(stream.docs.len())?;
                for doc in &stream.docs {
                    items.push(doc.root.clone());
                    // PERF(port): was appendAssumeCapacity
                }
                Ok(Expr::init(E::Array, E::Array { items, ..Default::default() }, Loc::EMPTY))
            }
        }
    }
}

#[derive(Debug, thiserror::Error, strum::IntoStaticStr)]
pub enum YamlParseError {
    #[error("out of memory")]
    OutOfMemory,
    #[error("syntax error")]
    SyntaxError,
    #[error("stack overflow")]
    StackOverflow,
}

impl From<AllocError> for YamlParseError {
    fn from(_: AllocError) -> Self {
        YamlParseError::OutOfMemory
    }
}

// ───────────────────────────────────────────────────────────────────────────
// Top-level free functions
// ───────────────────────────────────────────────────────────────────────────

pub fn parse<Enc: Encoding>(input: &[Enc::Unit]) -> ParseResult<Enc> {
    let mut parser: Parser<Enc> = Parser::init(input);

    match parser.parse() {
        Ok(stream) => ParseResult::success(stream, &parser),
        Err(err) => ParseResult::fail(err, &parser),
    }
}

pub fn print<Enc: Encoding, W: fmt::Write>(
    stream: Stream<Enc>,
    writer: &mut W,
) -> fmt::Result {
    // TODO(port): Printer is commented-out in Zig source; this fn references
    // Parser(encoding).Printer which does not exist. Stubbed.
    let _ = (stream, writer);
    Ok(())
}

// ───────────────────────────────────────────────────────────────────────────
// Context
// ───────────────────────────────────────────────────────────────────────────

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Context {
    BlockOut,
    BlockIn,
    // BlockKey,
    FlowIn,
    FlowKey,
}

pub struct ContextStack {
    list: Vec<Context>,
}

impl ContextStack {
    pub fn init() -> Self {
        Self { list: Vec::new() }
    }

    pub fn set(&mut self, context: Context) -> Result<(), AllocError> {
        self.list.push(context);
        Ok(())
    }

    pub fn unset(&mut self, context: Context) {
        let prev_context = self.list.pop();
        debug_assert!(prev_context.is_some() && prev_context.unwrap() == context);
    }

    pub fn get(&self) -> Context {
        // top level context is always BLOCK-OUT
        self.list.last().copied().unwrap_or(Context::BlockOut)
    }
}

// ───────────────────────────────────────────────────────────────────────────
// Chomp
// ───────────────────────────────────────────────────────────────────────────

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Chomp {
    /// '-'
    /// remove all trailing newlines
    Strip,
    /// ''
    /// exclude the last trailing newline (default)
    Clip,
    /// '+'
    /// include all trailing newlines
    Keep,
}

impl Chomp {
    pub const DEFAULT: Chomp = Chomp::Clip;
}

// ───────────────────────────────────────────────────────────────────────────
// Indent
// ───────────────────────────────────────────────────────────────────────────

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
#[repr(transparent)]
pub struct Indent(usize);

impl Indent {
    pub const NONE: Indent = Indent(0);

    pub fn from(indent: usize) -> Indent {
        Indent(indent)
    }

    pub fn cast(self) -> usize {
        self.0
    }

    pub fn inc(&mut self, n: usize) {
        self.0 += n;
    }

    pub fn dec(&mut self, n: usize) {
        self.0 -= n;
    }

    pub fn add(self, n: usize) -> Indent {
        Indent(self.0 + n)
    }

    pub fn sub(self, n: usize) -> Indent {
        Indent(self.0 - n)
    }

    pub fn is_less_than(self, other: Indent) -> bool {
        self.0 < other.0
    }

    pub fn is_less_than_or_equal(self, other: Indent) -> bool {
        self.0 <= other.0
    }

    pub fn cmp(self, r: Indent) -> Ordering {
        if self.0 > r.0 {
            return Ordering::Greater;
        }
        if self.0 < r.0 {
            return Ordering::Less;
        }
        Ordering::Equal
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum IndentIndicator {
    /// trim leading indentation (spaces) (default)
    Auto = 0,
    N1 = 1,
    N2 = 2,
    N3 = 3,
    N4 = 4,
    N5 = 5,
    N6 = 6,
    N7 = 7,
    N8 = 8,
    N9 = 9,
}

impl IndentIndicator {
    pub const DEFAULT: IndentIndicator = IndentIndicator::Auto;

    pub fn get(self) -> u8 {
        self as u8
    }

    pub const fn from_raw(n: u8) -> Self {
        debug_assert!(n <= 9);
        // SAFETY: #[repr(u8)] with contiguous discriminants 0..=9
        unsafe { core::mem::transmute::<u8, IndentIndicator>(n) }
    }
}

pub struct IndentStack {
    list: Vec<Indent>,
}

impl IndentStack {
    pub fn init() -> Self {
        Self { list: Vec::new() }
    }

    pub fn push(&mut self, indent: Indent) -> Result<(), AllocError> {
        self.list.push(indent);
        Ok(())
    }

    pub fn pop(&mut self) {
        debug_assert!(!self.list.is_empty());
        self.list.pop();
    }

    pub fn get(&self) -> Option<Indent> {
        self.list.last().copied()
    }
}

// ───────────────────────────────────────────────────────────────────────────
// Pos
// ───────────────────────────────────────────────────────────────────────────

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
#[repr(transparent)]
pub struct Pos(usize);

impl Pos {
    pub const ZERO: Pos = Pos(0);

    pub fn from(pos: usize) -> Pos {
        Pos(pos)
    }

    pub fn cast(self) -> usize {
        self.0
    }

    pub fn loc(self) -> logger::Loc {
        logger::Loc { start: i32::try_from(self.0).unwrap() }
    }

    pub fn inc(&mut self, n: usize) {
        self.0 += n;
    }

    pub fn dec(&mut self, n: usize) {
        self.0 -= n;
    }

    pub fn add(self, n: usize) -> Pos {
        Pos(self.0 + n)
    }

    pub fn sub(self, n: usize) -> Pos {
        Pos(self.0 - n)
    }

    pub fn is_less_than(self, other: usize) -> bool {
        self.0 < other
    }

    pub fn cmp(self, r: usize) -> Ordering {
        if self.0 < r {
            return Ordering::Less;
        }
        if self.0 > r {
            return Ordering::Greater;
        }
        Ordering::Equal
    }
}

// ───────────────────────────────────────────────────────────────────────────
// Line
// ───────────────────────────────────────────────────────────────────────────

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
#[repr(transparent)]
pub struct Line(usize);

impl Line {
    pub fn from(line: usize) -> Line {
        Line(line)
    }

    pub fn cast(self) -> usize {
        self.0
    }

    pub fn inc(&mut self, n: usize) {
        self.0 += n;
    }

    pub fn dec(&mut self, n: usize) {
        self.0 -= n;
    }

    pub fn add(self, n: usize) -> Line {
        Line(self.0 + n)
    }

    pub fn sub(self, n: usize) -> Line {
        Line(self.0 - n)
    }
}

// Zig: comptime { bun.assert(Pos != Indent); ... } — type-distinctness checks.
// Rust newtypes are already distinct; nothing to assert.

// ───────────────────────────────────────────────────────────────────────────
// Encoding trait (replaces Zig `Encoding` enum + `enc.unit()` type fn)
// ───────────────────────────────────────────────────────────────────────────

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum EncodingKind {
    Latin1,
    Utf8,
    Utf16,
}

/// Trait modeling Zig's `Encoding` comptime enum where `unit()` returns a type.
pub trait Encoding: Copy + 'static {
    type Unit: Copy + Eq + Ord + Default + fmt::Debug + Into<u32> + 'static;

    const KIND: EncodingKind;

    /// Zero unit (used as EOF sentinel).
    const NUL: Self::Unit;

    /// Construct a Unit from a `u8` ASCII char literal.
    fn ch(c: u8) -> Self::Unit;

    /// Widen a unit to u32 for switching.
    fn wide(u: Self::Unit) -> u32 {
        u.into()
    }

    /// `enc.literal("...")` — comptime string literal in the target encoding.
    /// TODO(port): for Utf16 this needs `bun_str::w!("...")`; callers pass ASCII only.
    fn literal(s: &'static [u8]) -> &'static [Self::Unit];
}

#[derive(Clone, Copy)]
pub struct Latin1;
#[derive(Clone, Copy)]
pub struct Utf8;
#[derive(Clone, Copy)]
pub struct Utf16;

impl Encoding for Latin1 {
    type Unit = u8;
    const KIND: EncodingKind = EncodingKind::Latin1;
    const NUL: u8 = 0;
    fn ch(c: u8) -> u8 {
        c
    }
    fn literal(s: &'static [u8]) -> &'static [u8] {
        s
    }
}

impl Encoding for Utf8 {
    type Unit = u8;
    const KIND: EncodingKind = EncodingKind::Utf8;
    const NUL: u8 = 0;
    fn ch(c: u8) -> u8 {
        c
    }
    fn literal(s: &'static [u8]) -> &'static [u8] {
        s
    }
}

impl Encoding for Utf16 {
    type Unit = u16;
    const KIND: EncodingKind = EncodingKind::Utf16;
    const NUL: u16 = 0;
    fn ch(c: u8) -> u16 {
        c as u16
    }
    fn literal(_s: &'static [u8]) -> &'static [u16] {
        // TODO(port): Zig used std.unicode.utf8ToUtf16LeStringLiteral. Rust needs
        // a const transcoding macro (e.g. bun_str::w!). Phase B.
        unimplemented!("Utf16::literal requires const utf8->utf16 macro")
    }
}

// ───────────────────────────────────────────────────────────────────────────
// chars — character classification (Zig: `Encoding.chars()` returned a type)
// ───────────────────────────────────────────────────────────────────────────

pub mod chars {
    use super::{Encoding, EncodingKind};

    pub fn is_ns_dec_digit<Enc: Encoding>(c: Enc::Unit) -> bool {
        matches!(Enc::wide(c), 0x30..=0x39)
    }

    pub fn is_ns_hex_digit<Enc: Encoding>(c: Enc::Unit) -> bool {
        matches!(Enc::wide(c), 0x30..=0x39 | 0x61..=0x66 | 0x41..=0x46)
    }

    pub fn is_ns_word_char<Enc: Encoding>(c: Enc::Unit) -> bool {
        matches!(
            Enc::wide(c),
            0x30..=0x39 | 0x41..=0x5A | 0x61..=0x7A | 0x2D /* '-' */
        )
    }

    pub fn is_ns_char<Enc: Encoding>(c: Enc::Unit) -> bool {
        let cw = Enc::wide(c);
        match Enc::KIND {
            EncodingKind::Utf8 => match cw {
                0x20 /* ' ' */ | 0x09 /* '\t' */ => false,
                0x0A | 0x0D => false,
                // TODO: exclude BOM
                0x21..=0x7E => true,
                0x80..=0xFF => true,
                // TODO: include 0x85, [0xa0 - 0xd7ff], [0xe000 - 0xfffd], [0x010000 - 0x10ffff]
                _ => false,
            },
            EncodingKind::Utf16 => match cw {
                0x20 | 0x09 => false,
                0x0A | 0x0D => false,
                // TODO: exclude BOM
                0x21..=0x7E => true,
                0x85 => true,
                0xA0..=0xD7FF => true,
                0xE000..=0xFFFD => true,
                // TODO: include [0x010000 - 0x10ffff]
                _ => false,
            },
            EncodingKind::Latin1 => match cw {
                0x20 | 0x09 => false,
                0x0A | 0x0D => false,
                // TODO: !!!!
                _ => true,
            },
        }
    }

    /// null if false, length if true
    pub fn is_ns_tag_char<Enc: Encoding>(cs: &[Enc::Unit]) -> Option<u8> {
        if cs.is_empty() {
            return None;
        }
        let c0 = Enc::wide(cs[0]);
        match c0 {
            // '#' ';' '/' '?' ':' '@' '&' '=' '+' '$' '_' '.' '~' '*' '\'' '(' ')'
            0x23 | 0x3B | 0x2F | 0x3F | 0x3A | 0x40 | 0x26 | 0x3D | 0x2B | 0x24 | 0x5F
            | 0x2E | 0x7E | 0x2A | 0x27 | 0x28 | 0x29 => Some(1),

            // '!' ',' '[' ']' '{' '}'
            0x21 | 0x2C | 0x5B | 0x5D | 0x7B | 0x7D => None,

            _ => {
                if c0 == 0x25
                    /* '%' */
                    && cs.len() > 2
                    && is_ns_hex_digit::<Enc>(cs[1])
                    && is_ns_hex_digit::<Enc>(cs[2])
                {
                    return Some(3);
                }
                if is_ns_word_char::<Enc>(cs[0]) {
                    Some(1)
                } else {
                    None
                }
            }
        }
    }

    pub fn is_b_char<Enc: Encoding>(c: Enc::Unit) -> bool {
        let cw = Enc::wide(c);
        cw == 0x0A || cw == 0x0D
    }

    pub fn is_s_white<Enc: Encoding>(c: Enc::Unit) -> bool {
        let cw = Enc::wide(c);
        cw == 0x20 || cw == 0x09
    }

    pub fn is_ns_plain_safe_out<Enc: Encoding>(c: Enc::Unit) -> bool {
        is_ns_char::<Enc>(c)
    }

    pub fn is_ns_plain_safe_in<Enc: Encoding>(c: Enc::Unit) -> bool {
        // TODO: inline isCFlowIndicator
        is_ns_char::<Enc>(c) && !is_c_flow_indicator::<Enc>(c)
    }

    pub fn is_c_indicator<Enc: Encoding>(c: Enc::Unit) -> bool {
        matches!(
            Enc::wide(c),
            // - ? : , [ ] { } # & * ! | > ' " % @ `
            0x2D | 0x3F | 0x3A | 0x2C | 0x5B | 0x5D | 0x7B | 0x7D | 0x23 | 0x26
                | 0x2A | 0x21 | 0x7C | 0x3E | 0x27 | 0x22 | 0x25 | 0x40 | 0x60
        )
    }

    pub fn is_c_flow_indicator<Enc: Encoding>(c: Enc::Unit) -> bool {
        matches!(Enc::wide(c), 0x2C | 0x5B | 0x5D | 0x7B | 0x7D)
    }

    pub fn is_ns_uri_char<Enc: Encoding>(cs: &[Enc::Unit]) -> bool {
        if cs.is_empty() {
            return false;
        }
        let c0 = Enc::wide(cs[0]);
        match c0 {
            // '#' ';' '/' '?' ':' '@' '&' '=' '+' '$' ',' '_' '.' '!' '~' '*' '\'' '(' ')' '[' ']'
            0x23 | 0x3B | 0x2F | 0x3F | 0x3A | 0x40 | 0x26 | 0x3D | 0x2B | 0x24 | 0x2C
            | 0x5F | 0x2E | 0x21 | 0x7E | 0x2A | 0x27 | 0x28 | 0x29 | 0x5B | 0x5D => true,
            _ => {
                if c0 == 0x25
                    && cs.len() > 2
                    && is_ns_hex_digit::<Enc>(cs[1])
                    && is_ns_hex_digit::<Enc>(cs[2])
                {
                    return true;
                }
                is_ns_word_char::<Enc>(cs[0])
            }
        }
    }

    pub fn is_ns_anchor_char<Enc: Encoding>(c: Enc::Unit) -> bool {
        // TODO: inline isCFlowIndicator
        is_ns_char::<Enc>(c) && !is_c_flow_indicator::<Enc>(c)
    }
}

// ───────────────────────────────────────────────────────────────────────────
// ParseError (Parser-internal error set)
// ───────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error, strum::IntoStaticStr)]
pub enum ParseError {
    #[error("OutOfMemory")]
    OutOfMemory,
    #[error("UnexpectedToken")]
    UnexpectedToken,
    #[error("UnexpectedEof")]
    UnexpectedEof,
    #[error("InvalidDirective")]
    InvalidDirective,
    #[error("UnexpectedCharacter")]
    UnexpectedCharacter,
    #[error("UnresolvedTagHandle")]
    UnresolvedTagHandle,
    #[error("UnresolvedAlias")]
    UnresolvedAlias,
    #[error("MultilineImplicitKey")]
    MultilineImplicitKey,
    #[error("MultipleAnchors")]
    MultipleAnchors,
    #[error("MultipleTags")]
    MultipleTags,
    #[error("UnexpectedDocumentStart")]
    UnexpectedDocumentStart,
    #[error("UnexpectedDocumentEnd")]
    UnexpectedDocumentEnd,
    #[error("MultipleYamlDirectives")]
    MultipleYamlDirectives,
    #[error("InvalidIndentation")]
    InvalidIndentation,
    #[error("StackOverflow")]
    StackOverflow,
}

impl From<AllocError> for ParseError {
    fn from(_: AllocError) -> Self {
        ParseError::OutOfMemory
    }
}

impl From<ParseError> for bun_core::Error {
    fn from(e: ParseError) -> Self {
        bun_core::Error::from_name(<&'static str>::from(e))
    }
}

// ───────────────────────────────────────────────────────────────────────────
// String / StringRange / StringBuilder
// ───────────────────────────────────────────────────────────────────────────

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct StringRange {
    pub off: Pos,
    pub end: Pos,
}

impl StringRange {
    pub fn is_empty(&self) -> bool {
        self.off == self.end
    }

    pub fn len(&self) -> usize {
        self.end.cast() - self.off.cast()
    }

    pub fn slice<'i, U>(&self, input: &'i [U]) -> &'i [U] {
        &input[self.off.cast()..self.end.cast()]
    }
}

pub struct StringRangeStart<'a, Enc: Encoding> {
    pub off: Pos,
    pub parser: &'a Parser<'a, Enc>,
}

impl<'a, Enc: Encoding> StringRangeStart<'a, Enc> {
    pub fn end(&self) -> StringRange {
        StringRange { off: self.off, end: self.parser.pos }
    }
}

pub enum YamlString<Enc: Encoding> {
    Range(StringRange),
    List(Vec<Enc::Unit>),
}

impl<Enc: Encoding> YamlString<Enc> {
    pub fn slice<'i>(&'i self, input: &'i [Enc::Unit]) -> &'i [Enc::Unit] {
        match self {
            YamlString::Range(range) => range.slice(input),
            YamlString::List(list) => list.as_slice(),
        }
    }

    pub fn len(&self) -> usize {
        match self {
            YamlString::Range(range) => range.len(),
            YamlString::List(list) => list.len(),
        }
    }

    pub fn is_empty(&self) -> bool {
        match self {
            YamlString::Range(range) => range.is_empty(),
            YamlString::List(list) => list.is_empty(),
        }
    }

    pub fn eql(&self, r: &[u8], input: &[Enc::Unit]) -> bool {
        // TODO(port): Zig compared []const enc.unit() against []const u8 via
        // std.mem.eql(enc.unit(), ...) which only compiles when enc.unit() == u8.
        // Phase B should constrain or transcode.
        let l_slice = self.slice(input);
        if l_slice.len() != r.len() {
            return false;
        }
        l_slice.iter().zip(r.iter()).all(|(a, b)| Enc::wide(*a) == *b as u32)
    }
}

// `String.Builder` — owns a back-reference into the parser. The Zig code stored
// `parser: *Parser(enc)` and mutated `parser.whitespace_buf`. In Rust this is a
// borrow-checker hazard (the builder borrows `&mut Parser` while the parser also
// drives scanning). For Phase A we keep a raw pointer with SAFETY notes;
// Phase B should refactor whitespace_buf out of Parser or pass &mut explicitly.
pub struct StringBuilder<'a, Enc: Encoding> {
    pub parser: &'a mut Parser<'a, Enc>,
    // TODO(port): lifetime — see LIFETIMES.tsv BORROW_PARAM. This aliases the
    // outer `&mut self` in scanPlainScalar; Phase B must reshape (e.g. pass
    // `&mut whitespace_buf` separately or use a raw `*mut Parser<Enc>`).
    pub str: YamlString<Enc>,
}

impl<'a, Enc: Encoding> StringBuilder<'a, Enc> {
    pub fn append_source(&mut self, unit: Enc::Unit, pos: Pos) -> Result<(), AllocError> {
        self.drain_whitespace()?;

        if cfg!(feature = "ci_assert") {
            let actual = self.parser.input[pos.cast()];
            debug_assert!(actual == unit);
        }
        match &mut self.str {
            YamlString::Range(range) => {
                if range.is_empty() {
                    range.off = pos;
                    range.end = pos;
                }
                debug_assert!(range.end == pos);
                range.end = pos.add(1);
            }
            YamlString::List(list) => {
                list.push(unit);
            }
        }
        Ok(())
    }

    fn drain_whitespace(&mut self) -> Result<(), AllocError> {
        // PORT NOTE: reshaped for borrowck — take ownership of buf, process, clear.
        let buf = core::mem::take(&mut self.parser.whitespace_buf);
        for ws in &buf {
            match ws {
                Whitespace::Source { pos, unit } => {
                    if cfg!(feature = "ci_assert") {
                        let actual = self.parser.input[pos.cast()];
                        debug_assert!(actual == *unit);
                    }
                    match &mut self.str {
                        YamlString::Range(range) => {
                            if range.is_empty() {
                                range.off = *pos;
                                range.end = *pos;
                            }
                            debug_assert!(range.end == *pos);
                            range.end = pos.add(1);
                        }
                        YamlString::List(list) => list.push(*unit),
                    }
                }
                Whitespace::New(unit) => match &mut self.str {
                    YamlString::Range(range) => {
                        let mut list: Vec<Enc::Unit> = Vec::with_capacity(range.len() + 1);
                        list.extend_from_slice(range.slice(self.parser.input));
                        list.push(*unit);
                        // PERF(port): was assume_capacity
                        self.str = YamlString::List(list);
                    }
                    YamlString::List(list) => list.push(*unit),
                },
            }
        }
        let mut buf = buf;
        buf.clear();
        self.parser.whitespace_buf = buf;
        Ok(())
    }

    pub fn append_source_whitespace(&mut self, unit: Enc::Unit, pos: Pos) -> Result<(), AllocError> {
        self.parser.whitespace_buf.push(Whitespace::Source { unit, pos });
        Ok(())
    }

    pub fn append_whitespace(&mut self, unit: Enc::Unit) -> Result<(), AllocError> {
        self.parser.whitespace_buf.push(Whitespace::New(unit));
        Ok(())
    }

    pub fn append_whitespace_n_times(&mut self, unit: Enc::Unit, n: usize) -> Result<(), AllocError> {
        for _ in 0..n {
            self.parser.whitespace_buf.push(Whitespace::New(unit));
        }
        Ok(())
    }

    pub fn append_source_slice(&mut self, off: Pos, end: Pos) -> Result<(), AllocError> {
        self.drain_whitespace()?;
        match &mut self.str {
            YamlString::Range(range) => {
                if range.is_empty() {
                    range.off = off;
                    range.end = off;
                }
                debug_assert!(range.end == off);
                range.end = end;
            }
            YamlString::List(list) => {
                list.extend_from_slice(&self.parser.input[off.cast()..end.cast()]);
            }
        }
        Ok(())
    }

    pub fn append_expected_source_slice(
        &mut self,
        off: Pos,
        end: Pos,
        expected: &[Enc::Unit],
    ) -> Result<(), AllocError> {
        self.drain_whitespace()?;

        if cfg!(feature = "ci_assert") {
            let actual = &self.parser.input[off.cast()..end.cast()];
            debug_assert!(actual == expected);
        }

        match &mut self.str {
            YamlString::Range(range) => {
                if range.is_empty() {
                    range.off = off;
                    range.end = off;
                }
                debug_assert!(range.end == off);
                range.end = end;
            }
            YamlString::List(list) => {
                list.extend_from_slice(&self.parser.input[off.cast()..end.cast()]);
            }
        }
        Ok(())
    }

    pub fn append(&mut self, unit: Enc::Unit) -> Result<(), AllocError> {
        self.drain_whitespace()?;
        match &mut self.str {
            YamlString::Range(range) => {
                let mut list: Vec<Enc::Unit> = Vec::with_capacity(range.len() + 1);
                list.extend_from_slice(range.slice(self.parser.input));
                list.push(unit);
                // PERF(port): was assume_capacity
                self.str = YamlString::List(list);
            }
            YamlString::List(list) => list.push(unit),
        }
        Ok(())
    }

    pub fn append_slice(&mut self, s: &[Enc::Unit]) -> Result<(), AllocError> {
        if s.is_empty() {
            return Ok(());
        }
        self.drain_whitespace()?;
        match &mut self.str {
            YamlString::Range(range) => {
                let mut list: Vec<Enc::Unit> = Vec::with_capacity(range.len() + s.len());
                list.extend_from_slice(range.slice(self.parser.input));
                list.extend_from_slice(s);
                // PERF(port): was assume_capacity
                self.str = YamlString::List(list);
            }
            YamlString::List(list) => list.extend_from_slice(s),
        }
        Ok(())
    }

    pub fn append_n_times(&mut self, unit: Enc::Unit, n: usize) -> Result<(), AllocError> {
        if n == 0 {
            return Ok(());
        }
        self.drain_whitespace()?;
        match &mut self.str {
            YamlString::Range(range) => {
                let mut list: Vec<Enc::Unit> = Vec::with_capacity(range.len() + n);
                list.extend_from_slice(range.slice(self.parser.input));
                for _ in 0..n {
                    list.push(unit);
                }
                // PERF(port): was appendNTimesAssumeCapacity
                self.str = YamlString::List(list);
            }
            YamlString::List(list) => {
                for _ in 0..n {
                    list.push(unit);
                }
            }
        }
        Ok(())
    }

    pub fn len(&self) -> usize {
        self.str.len()
    }

    pub fn done(mut self) -> YamlString<Enc> {
        self.parser.whitespace_buf.clear();
        self.str
    }
}

// ───────────────────────────────────────────────────────────────────────────
// ScalarResolverCtx (scanPlainScalar inner struct)
// ───────────────────────────────────────────────────────────────────────────

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum FirstChar {
    Positive,
    Negative,
    Dot,
    Other,
}

// PORT NOTE: Zig defined this inline inside scanPlainScalar. Hoisted to module
// scope so methods can be `impl`'d. `parser` is `*mut` because the outer
// `&mut self` in scan_plain_scalar drives scanning concurrently — see
// LIFETIMES.tsv BACKREF.
pub struct ScalarResolverCtx<'i, Enc: Encoding> {
    pub str_builder: StringBuilder<'i, Enc>,

    pub resolved: bool,
    pub scalar: Option<NodeScalar<Enc>>,
    pub tag: NodeTag,

    pub parser: *mut Parser<'i, Enc>,

    pub resolved_scalar_len: usize,

    pub start: Pos,
    pub line: Line,
    pub line_indent: Indent,
    pub multiline: bool,
}

impl<'i, Enc: Encoding> ScalarResolverCtx<'i, Enc> {
    pub fn done(self) -> Token<Enc> {
        let multiline = self.multiline;
        let start = self.start;
        let line_indent = self.line_indent;
        let line = self.line;
        let resolved_scalar_len = self.resolved_scalar_len;
        let scalar_opt = self.scalar;

        let scalar: TokenScalar<Enc> = 'scalar: {
            let scalar_str = self.str_builder.done();

            if let Some(scalar) = scalar_opt {
                if scalar_str.len() == resolved_scalar_len {
                    drop(scalar_str);
                    break 'scalar TokenScalar { multiline, data: scalar };
                }
                // the first characters resolved to something
                // but there were more characters afterwards
            }

            break 'scalar TokenScalar { multiline, data: NodeScalar::String(scalar_str) };
        };

        Token::scalar(ScalarInit { start, indent: line_indent, line, resolved: scalar })
    }

    pub fn check_append(&mut self) {
        // SAFETY: ctx outlived by &mut self in scan_plain_scalar.
        let parser = unsafe { &*self.parser };
        if self.str_builder.len() == 0 {
            self.line_indent = parser.line_indent;
            self.line = parser.line;
        } else if self.line != parser.line {
            self.multiline = true;
        }
    }

    pub fn append_source(&mut self, unit: Enc::Unit, pos: Pos) -> Result<(), AllocError> {
        self.check_append();
        self.str_builder.append_source(unit, pos)
    }

    pub fn append_source_whitespace(&mut self, unit: Enc::Unit, pos: Pos) -> Result<(), AllocError> {
        self.str_builder.append_source_whitespace(unit, pos)
    }

    pub fn append_source_slice(&mut self, off: Pos, end: Pos) -> Result<(), AllocError> {
        self.check_append();
        self.str_builder.append_source_slice(off, end)
    }

    // may or may not contain whitespace
    pub fn append_unknown_source_slice(&mut self, off: Pos, end: Pos) -> Result<(), AllocError> {
        for _pos in off.cast()..end.cast() {
            let pos = Pos::from(_pos);
            // SAFETY: ctx outlived by &mut self in scan_plain_scalar.
            let unit = unsafe { (*self.parser).input[pos.cast()] };
            match Enc::wide(unit) {
                0x20 | 0x09 | 0x0D | 0x0A => {
                    self.str_builder.append_source_whitespace(unit, pos)?;
                }
                _ => {
                    self.check_append();
                    self.str_builder.append_source(unit, pos)?;
                }
            }
        }
        Ok(())
    }

    pub fn append(&mut self, unit: Enc::Unit) -> Result<(), AllocError> {
        self.check_append();
        self.str_builder.append(unit)
    }

    pub fn append_whitespace(&mut self, unit: Enc::Unit) -> Result<(), AllocError> {
        self.str_builder.append_whitespace(unit)
    }

    pub fn append_slice(&mut self, str: &[Enc::Unit]) -> Result<(), AllocError> {
        self.check_append();
        self.str_builder.append_slice(str)
    }

    pub fn append_n_times(&mut self, unit: Enc::Unit, n: usize) -> Result<(), AllocError> {
        if n == 0 {
            return Ok(());
        }
        self.check_append();
        self.str_builder.append_n_times(unit, n)
    }

    pub fn append_whitespace_n_times(&mut self, unit: Enc::Unit, n: usize) -> Result<(), AllocError> {
        if n == 0 {
            return Ok(());
        }
        self.str_builder.append_whitespace_n_times(unit, n)
    }

    // PORT NOTE: Zig `Keywords` enum (yaml.zig:1862-1887) was unused; not ported.

    pub fn resolve(
        &mut self,
        scalar: NodeScalar<Enc>,
        off: Pos,
        text: &[Enc::Unit],
    ) -> Result<(), AllocError> {
        self.str_builder
            .append_expected_source_slice(off, off.add(text.len()), text)?;

        self.resolved = true;

        match self.tag {
            NodeTag::None => {
                self.resolved_scalar_len = self.str_builder.len();
                self.scalar = Some(scalar);
            }
            NodeTag::NonSpecific => {
                // always becomes string
            }
            NodeTag::Bool => {
                if matches!(scalar, NodeScalar::Boolean(_)) {
                    self.resolved_scalar_len = self.str_builder.len();
                    self.scalar = Some(scalar);
                }
                // return error.ScalarTypeMismatch;
            }
            NodeTag::Int => {
                if matches!(scalar, NodeScalar::Number(_)) {
                    self.resolved_scalar_len = self.str_builder.len();
                    self.scalar = Some(scalar);
                }
                // return error.ScalarTypeMismatch;
            }
            NodeTag::Float => {
                if matches!(scalar, NodeScalar::Number(_)) {
                    self.resolved_scalar_len = self.str_builder.len();
                    self.scalar = Some(scalar);
                }
                // return error.ScalarTypeMismatch;
            }
            NodeTag::Null => {
                if matches!(scalar, NodeScalar::Null) {
                    self.resolved_scalar_len = self.str_builder.len();
                    self.scalar = Some(scalar);
                }
                // return error.ScalarTypeMismatch;
            }
            NodeTag::Str => {
                // always becomes string
            }
            NodeTag::Verbatim(_) | NodeTag::Unknown(_) => {
                // also always becomes a string
            }
        }
        Ok(())
    }

    pub fn try_resolve_number(
        &mut self,
        parser: &mut Parser<'i, Enc>,
        first_char: FirstChar,
    ) -> Result<(), AllocError> {
        let nan = f64::NAN;
        let inf = f64::INFINITY;

        match first_char {
            FirstChar::Dot => match Enc::wide(parser.next()) {
                0x6E /* 'n' */ => {
                    let n_start = parser.pos;
                    parser.inc(1);
                    if parser.remain_starts_with(Enc::literal(b"an")) {
                        self.resolve(NodeScalar::Number(nan), n_start, Enc::literal(b"nan"))?;
                        parser.inc(2);
                        return Ok(());
                    }
                    self.append_source(Enc::ch(b'n'), n_start)?;
                    return Ok(());
                }
                0x4E /* 'N' */ => {
                    let n_start = parser.pos;
                    parser.inc(1);
                    if parser.remain_starts_with(Enc::literal(b"aN")) {
                        self.resolve(NodeScalar::Number(nan), n_start, Enc::literal(b"NaN"))?;
                        parser.inc(2);
                        return Ok(());
                    }
                    if parser.remain_starts_with(Enc::literal(b"AN")) {
                        self.resolve(NodeScalar::Number(nan), n_start, Enc::literal(b"NAN"))?;
                        parser.inc(2);
                        return Ok(());
                    }
                    self.append_source(Enc::ch(b'N'), n_start)?;
                    return Ok(());
                }
                0x69 /* 'i' */ => {
                    let i_start = parser.pos;
                    parser.inc(1);
                    if parser.remain_starts_with(Enc::literal(b"nf")) {
                        self.resolve(NodeScalar::Number(inf), i_start, Enc::literal(b"inf"))?;
                        parser.inc(2);
                        return Ok(());
                    }
                    self.append_source(Enc::ch(b'i'), i_start)?;
                    return Ok(());
                }
                0x49 /* 'I' */ => {
                    let i_start = parser.pos;
                    parser.inc(1);
                    if parser.remain_starts_with(Enc::literal(b"nf")) {
                        self.resolve(NodeScalar::Number(inf), i_start, Enc::literal(b"Inf"))?;
                        parser.inc(2);
                        return Ok(());
                    }
                    if parser.remain_starts_with(Enc::literal(b"NF")) {
                        self.resolve(NodeScalar::Number(inf), i_start, Enc::literal(b"INF"))?;
                        parser.inc(2);
                        return Ok(());
                    }
                    self.append_source(Enc::ch(b'I'), i_start)?;
                    return Ok(());
                }
                _ => {}
            },
            FirstChar::Negative | FirstChar::Positive => {
                // PORT NOTE: Zig `a == b and c or d` parses as `(a == b and c) or d`.
                if Enc::wide(parser.next()) == 0x2E && Enc::wide(parser.peek(1)) == 0x69
                    || Enc::wide(parser.peek(1)) == 0x49
                {
                    self.append_source(Enc::ch(b'.'), parser.pos)?;
                    parser.inc(1);
                    match Enc::wide(parser.next()) {
                        0x69 /* 'i' */ => {
                            let i_start = parser.pos;
                            parser.inc(1);
                            if parser.remain_starts_with(Enc::literal(b"nf")) {
                                self.resolve(
                                    NodeScalar::Number(if first_char == FirstChar::Negative { -inf } else { inf }),
                                    i_start,
                                    Enc::literal(b"inf"),
                                )?;
                                parser.inc(2);
                                return Ok(());
                            }
                            self.append_source(Enc::ch(b'i'), i_start)?;
                            return Ok(());
                        }
                        0x49 /* 'I' */ => {
                            let i_start = parser.pos;
                            parser.inc(1);
                            if parser.remain_starts_with(Enc::literal(b"nf")) {
                                self.resolve(
                                    NodeScalar::Number(if first_char == FirstChar::Negative { -inf } else { inf }),
                                    i_start,
                                    Enc::literal(b"Inf"),
                                )?;
                                parser.inc(2);
                                return Ok(());
                            }
                            if parser.remain_starts_with(Enc::literal(b"NF")) {
                                self.resolve(
                                    NodeScalar::Number(if first_char == FirstChar::Negative { -inf } else { inf }),
                                    i_start,
                                    Enc::literal(b"INF"),
                                )?;
                                parser.inc(2);
                                return Ok(());
                            }
                            self.append_source(Enc::ch(b'I'), i_start)?;
                            return Ok(());
                        }
                        _ => {
                            return Ok(());
                        }
                    }
                }
            }
            FirstChar::Other => {}
        }

        let start = parser.pos;

        let mut decimal = Enc::wide(parser.next()) == 0x2E /* '.' */;
        let mut x = false;
        let mut o = false;
        let mut e = false;
        let mut plus = false;
        let mut minus = false;
        let mut hex = false;

        if first_char != FirstChar::Negative && first_char != FirstChar::Positive {
            parser.inc(1);
        }

        let mut first = true;

        // PORT NOTE: labeled-switch loop
        let mut __c = Enc::wide(parser.next());
        let (end, valid): (Pos, bool) = 'end: loop {
            match __c {
                // can only be valid if it ends on:
                // - ' '
                // - '\t'
                // - eof
                // - '\n'
                // - '\r'
                // - ':'
                0x20 | 0x09 | 0 | 0x0A | 0x0D | 0x3A => {
                    if first && (first_char == FirstChar::Positive || first_char == FirstChar::Negative) {
                        break 'end (parser.pos, false);
                    }
                    break 'end (parser.pos, true);
                }

                0x2C | 0x5D | 0x7D /* , ] } */ => {
                    first = false;
                    match parser.context.get() {
                        // it's valid for ',' ']' '}' to end the scalar
                        // in flow context
                        Context::FlowIn | Context::FlowKey => break 'end (parser.pos, true),
                        Context::BlockIn | Context::BlockOut => break 'end (parser.pos, false),
                    }
                }

                0x30 /* '0' */ => {
                    let was_first = first;
                    first = false;
                    parser.inc(1);
                    if was_first {
                        match Enc::wide(parser.next()) {
                            0x62 | 0x42 /* 'b' 'B' */ => {
                                break 'end (parser.pos, false);
                            }
                            c => {
                                __c = c;
                                continue;
                            }
                        }
                    }
                    __c = Enc::wide(parser.next());
                    continue;
                }

                0x31..=0x39 /* '1'..'9' */ => {
                    first = false;
                    parser.inc(1);
                    __c = Enc::wide(parser.next());
                    continue;
                }

                0x65 | 0x45 /* 'e' 'E' */ => {
                    first = false;
                    if e {
                        hex = true;
                    }
                    e = true;
                    parser.inc(1);
                    __c = Enc::wide(parser.next());
                    continue;
                }

                0x61..=0x64 | 0x66 | 0x41..=0x44 | 0x46 /* a-d f A-D F */ => {
                    hex = true;

                    if first {
                        if __c == 0x62 || __c == 0x42 {
                            break 'end (parser.pos, false);
                        }
                    }
                    first = false;

                    parser.inc(1);
                    __c = Enc::wide(parser.next());
                    continue;
                }

                0x78 /* 'x' */ => {
                    first = false;
                    if x {
                        break 'end (parser.pos, false);
                    }

                    x = true;
                    parser.inc(1);
                    __c = Enc::wide(parser.next());
                    continue;
                }

                0x6F /* 'o' */ => {
                    first = false;
                    if o {
                        break 'end (parser.pos, false);
                    }

                    o = true;
                    parser.inc(1);
                    __c = Enc::wide(parser.next());
                    continue;
                }

                0x2E /* '.' */ => {
                    first = false;
                    if decimal {
                        break 'end (parser.pos, false);
                    }

                    decimal = true;
                    parser.inc(1);
                    __c = Enc::wide(parser.next());
                    continue;
                }

                0x2B /* '+' */ => {
                    first = false;
                    if x {
                        break 'end (parser.pos, false);
                    }
                    plus = true;
                    parser.inc(1);
                    __c = Enc::wide(parser.next());
                    continue;
                }
                0x2D /* '-' */ => {
                    first = false;
                    if minus {
                        break 'end (parser.pos, false);
                    }
                    minus = true;
                    parser.inc(1);
                    __c = Enc::wide(parser.next());
                    continue;
                }
                _ => {
                    first = false;
                    break 'end (parser.pos, false);
                }
            }
        };
        let _ = plus;

        self.append_unknown_source_slice(start, end)?;

        if !valid {
            return Ok(());
        }

        let mut scalar: NodeScalar<Enc> = 'scalar: {
            if x || o || hex {
                // TODO(port): std.fmt.parseUnsigned(u64, slice, 0) over &[Enc::Unit] —
                // need ASCII narrowing for non-u8 encodings; Phase B.
                let unsigned = match parse_unsigned_radix0::<Enc>(parser.slice(start, end)) {
                    Ok(v) => v,
                    Err(_) => return Ok(()),
                };
                break 'scalar NodeScalar::Number(unsigned as f64);
            }
            // TODO(port): bun.jsc.wtf.parseDouble over &[Enc::Unit] — Phase B.
            let float = match bun_jsc::wtf::parse_double(parser.slice(start, end)) {
                Ok(v) => v,
                Err(_) => return Ok(()),
            };

            break 'scalar NodeScalar::Number(float);
        };

        self.resolved = true;

        match self.tag {
            NodeTag::None | NodeTag::Float | NodeTag::Int => {
                self.resolved_scalar_len = self.str_builder.len();
                if first_char == FirstChar::Negative {
                    if let NodeScalar::Number(n) = &mut scalar {
                        *n = -*n;
                    }
                }
                self.scalar = Some(scalar);
            }
            _ => {}
        }
        Ok(())
    }
}

// TODO(port): placeholder for std.fmt.parseUnsigned(u64, _, 0). Phase B should
// route through bun_str or core u64::from_str_radix after ASCII narrowing.
fn parse_unsigned_radix0<Enc: Encoding>(_s: &[Enc::Unit]) -> Result<u64, ()> {
    Err(())
}

// ───────────────────────────────────────────────────────────────────────────
// NodeTag / NodeScalar
// ───────────────────────────────────────────────────────────────────────────

#[derive(Clone, Copy, Debug)]
pub enum NodeTag {
    /// ''
    None,
    /// '!'
    NonSpecific,
    /// '!!bool'
    Bool,
    /// '!!int'
    Int,
    /// '!!float'
    Float,
    /// '!!null'
    Null,
    /// '!!str'
    Str,
    /// '!<...>'
    Verbatim(StringRange),
    /// '!!unknown'
    Unknown(StringRange),
}

impl NodeTag {
    pub fn resolve_null(self, loc: logger::Loc) -> Expr {
        match self {
            NodeTag::None
            | NodeTag::Bool
            | NodeTag::Int
            | NodeTag::Float
            | NodeTag::Null
            | NodeTag::Verbatim(_)
            | NodeTag::Unknown(_) => Expr::init(E::Null, E::Null {}, loc),

            // non-specific tags become seq, map, or str
            NodeTag::NonSpecific | NodeTag::Str => {
                Expr::init(E::String, E::String::default(), loc)
            }
        }
    }
}

pub enum NodeScalar<Enc: Encoding> {
    Null,
    Boolean(bool),
    Number(f64),
    String(YamlString<Enc>),
}

impl<Enc: Encoding> NodeScalar<Enc> {
    pub fn to_expr(&self, pos: Pos, input: &[Enc::Unit]) -> Expr {
        match self {
            NodeScalar::Null => Expr::init(E::Null, E::Null {}, pos.loc()),
            NodeScalar::Boolean(value) => {
                Expr::init(E::Boolean, E::Boolean { value: *value }, pos.loc())
            }
            NodeScalar::Number(value) => {
                Expr::init(E::Number, E::Number { value: *value }, pos.loc())
            }
            NodeScalar::String(value) => {
                // TODO(port): E.String wants &[u8]; for Utf16 this needs transcoding.
                Expr::init(
                    E::String,
                    E::String { data: value.slice(input), ..Default::default() },
                    pos.loc(),
                )
            }
        }
    }
}

// ───────────────────────────────────────────────────────────────────────────
// Directive / Document / Stream
// ───────────────────────────────────────────────────────────────────────────

pub enum Directive {
    Yaml,
    Tag(DirectiveTag),
    Reserved(StringRange),
}

/// '%TAG <handle> <prefix>'
pub struct DirectiveTag {
    pub handle: DirectiveTagHandle,
    pub prefix: DirectiveTagPrefix,
}

pub enum DirectiveTagHandle {
    /// '!name!'
    Named(StringRange),
    /// '!!'
    Secondary,
    /// '!'
    Primary,
}

pub enum DirectiveTagPrefix {
    /// c-ns-local-tag-prefix
    /// '!my-prefix'
    Local(StringRange),
    /// ns-global-tag-prefix
    /// 'tag:example.com,2000:app/'
    Global(StringRange),
}

pub struct Document {
    pub directives: Vec<Directive>,
    pub root: Expr,
}

// impl Drop for Document — Vec<Directive> auto-drops; Expr is arena-backed.

pub struct Stream<Enc: Encoding> {
    pub docs: Vec<Document>,
    pub input: *const [Enc::Unit],
    // TODO(port): lifetime — Zig stored `[]const enc.unit()` borrowing parser input.
}

// ───────────────────────────────────────────────────────────────────────────
// Token
// ───────────────────────────────────────────────────────────────────────────

#[derive(Clone, Copy)]
pub struct TokenInit {
    pub start: Pos,
    pub indent: Indent,
    pub line: Line,
}

pub struct Token<Enc: Encoding> {
    pub start: Pos,
    pub indent: Indent,
    pub line: Line,
    pub data: TokenData<Enc>,
}

impl<Enc: Encoding> Clone for Token<Enc> {
    fn clone(&self) -> Self {
        // TODO(port): TokenData contains NodeScalar<Enc> which holds a Vec for
        // String::List. Zig copied tokens by value (struct copy). Phase B should
        // make Token cheaply-copyable or store scalars by index.
        Token {
            start: self.start,
            indent: self.indent,
            line: self.line,
            data: self.data.clone(),
        }
    }
}

pub enum TokenData<Enc: Encoding> {
    Eof,
    /// `-`
    SequenceEntry,
    /// `?`
    MappingKey,
    /// `:`
    MappingValue,
    /// `,`
    CollectEntry,
    /// `[`
    SequenceStart,
    /// `]`
    SequenceEnd,
    /// `{`
    MappingStart,
    /// `}`
    MappingEnd,
    /// `&`
    Anchor(StringRange),
    /// `*`
    Alias(StringRange),
    /// `!`
    Tag(NodeTag),
    /// `%`
    Directive,
    /// `@` or `` ` ``
    Reserved,
    /// `---`
    DocumentStart,
    /// `...`
    DocumentEnd,
    /// might be single or double quoted, or unquoted.
    /// might be a literal or folded literal ('|' or '>')
    Scalar(TokenScalar<Enc>),
}

impl<Enc: Encoding> Clone for TokenData<Enc> {
    fn clone(&self) -> Self {
        // TODO(port): see Token::clone note
        match self {
            TokenData::Eof => TokenData::Eof,
            TokenData::SequenceEntry => TokenData::SequenceEntry,
            TokenData::MappingKey => TokenData::MappingKey,
            TokenData::MappingValue => TokenData::MappingValue,
            TokenData::CollectEntry => TokenData::CollectEntry,
            TokenData::SequenceStart => TokenData::SequenceStart,
            TokenData::SequenceEnd => TokenData::SequenceEnd,
            TokenData::MappingStart => TokenData::MappingStart,
            TokenData::MappingEnd => TokenData::MappingEnd,
            TokenData::Anchor(r) => TokenData::Anchor(*r),
            TokenData::Alias(r) => TokenData::Alias(*r),
            TokenData::Tag(t) => TokenData::Tag(*t),
            TokenData::Directive => TokenData::Directive,
            TokenData::Reserved => TokenData::Reserved,
            TokenData::DocumentStart => TokenData::DocumentStart,
            TokenData::DocumentEnd => TokenData::DocumentEnd,
            TokenData::Scalar(_) => {
                // TODO(port): Scalar contains Vec; Zig copied by value. Phase B reshape.
                unreachable!("Token<Scalar> should not be cloned")
            }
        }
    }
}

impl<Enc: Encoding> TokenData<Enc> {
    pub fn discriminant(&self) -> u8 {
        // SAFETY: #[repr(...)] not declared; use mem::discriminant for comparisons instead.
        // This helper exists only for the labeled-switch-loop ports below.
        // TODO(port): replace with core::mem::discriminant comparisons.
        match self {
            TokenData::Eof => 0,
            TokenData::SequenceEntry => 1,
            TokenData::MappingKey => 2,
            TokenData::MappingValue => 3,
            TokenData::CollectEntry => 4,
            TokenData::SequenceStart => 5,
            TokenData::SequenceEnd => 6,
            TokenData::MappingStart => 7,
            TokenData::MappingEnd => 8,
            TokenData::Anchor(_) => 9,
            TokenData::Alias(_) => 10,
            TokenData::Tag(_) => 11,
            TokenData::Directive => 12,
            TokenData::Reserved => 13,
            TokenData::DocumentStart => 14,
            TokenData::DocumentEnd => 15,
            TokenData::Scalar(_) => 16,
        }
    }
}

pub struct TokenScalar<Enc: Encoding> {
    pub data: NodeScalar<Enc>,
    pub multiline: bool,
}

#[derive(Clone, Copy)]
pub struct AnchorInit {
    pub start: Pos,
    pub indent: Indent,
    pub line: Line,
    pub name: StringRange,
}

pub type AliasInit = AnchorInit;

#[derive(Clone, Copy)]
pub struct TagInit {
    pub start: Pos,
    pub indent: Indent,
    pub line: Line,
    pub tag: NodeTag,
}

pub struct ScalarInit<Enc: Encoding> {
    pub start: Pos,
    pub indent: Indent,
    pub line: Line,
    pub resolved: TokenScalar<Enc>,
}

impl<Enc: Encoding> Token<Enc> {
    pub fn eof(init: TokenInit) -> Self {
        Self { start: init.start, indent: init.indent, line: init.line, data: TokenData::Eof }
    }
    pub fn sequence_entry(init: TokenInit) -> Self {
        Self { start: init.start, indent: init.indent, line: init.line, data: TokenData::SequenceEntry }
    }
    pub fn mapping_key(init: TokenInit) -> Self {
        Self { start: init.start, indent: init.indent, line: init.line, data: TokenData::MappingKey }
    }
    pub fn mapping_value(init: TokenInit) -> Self {
        Self { start: init.start, indent: init.indent, line: init.line, data: TokenData::MappingValue }
    }
    pub fn collect_entry(init: TokenInit) -> Self {
        Self { start: init.start, indent: init.indent, line: init.line, data: TokenData::CollectEntry }
    }
    pub fn sequence_start(init: TokenInit) -> Self {
        Self { start: init.start, indent: init.indent, line: init.line, data: TokenData::SequenceStart }
    }
    pub fn sequence_end(init: TokenInit) -> Self {
        Self { start: init.start, indent: init.indent, line: init.line, data: TokenData::SequenceEnd }
    }
    pub fn mapping_start(init: TokenInit) -> Self {
        Self { start: init.start, indent: init.indent, line: init.line, data: TokenData::MappingStart }
    }
    pub fn mapping_end(init: TokenInit) -> Self {
        Self { start: init.start, indent: init.indent, line: init.line, data: TokenData::MappingEnd }
    }
    pub fn anchor(init: AnchorInit) -> Self {
        Self { start: init.start, indent: init.indent, line: init.line, data: TokenData::Anchor(init.name) }
    }
    pub fn alias(init: AliasInit) -> Self {
        Self { start: init.start, indent: init.indent, line: init.line, data: TokenData::Alias(init.name) }
    }
    pub fn tag(init: TagInit) -> Self {
        Self { start: init.start, indent: init.indent, line: init.line, data: TokenData::Tag(init.tag) }
    }
    pub fn directive(init: TokenInit) -> Self {
        Self { start: init.start, indent: init.indent, line: init.line, data: TokenData::Directive }
    }
    pub fn reserved(init: TokenInit) -> Self {
        Self { start: init.start, indent: init.indent, line: init.line, data: TokenData::Reserved }
    }
    pub fn document_start(init: TokenInit) -> Self {
        Self { start: init.start, indent: init.indent, line: init.line, data: TokenData::DocumentStart }
    }
    pub fn document_end(init: TokenInit) -> Self {
        Self { start: init.start, indent: init.indent, line: init.line, data: TokenData::DocumentEnd }
    }
    pub fn scalar(init: ScalarInit<Enc>) -> Self {
        Self { start: init.start, indent: init.indent, line: init.line, data: TokenData::Scalar(init.resolved) }
    }
}

// ───────────────────────────────────────────────────────────────────────────
// ParseResult
// ───────────────────────────────────────────────────────────────────────────

pub enum ParseResult<Enc: Encoding> {
    Result(ParseResultOk<Enc>),
    Err(ParseResultError),
}

pub struct ParseResultOk<Enc: Encoding> {
    pub stream: Stream<Enc>,
    // allocator dropped — global mimalloc
}

pub enum ParseResultError {
    Oom,
    StackOverflow,
    UnexpectedEof { pos: Pos },
    UnexpectedToken { pos: Pos },
    UnexpectedCharacter { pos: Pos },
    InvalidDirective { pos: Pos },
    UnresolvedTagHandle { pos: Pos },
    UnresolvedAlias { pos: Pos },
    MultilineImplicitKey { pos: Pos },
    MultipleAnchors { pos: Pos },
    MultipleTags { pos: Pos },
    UnexpectedDocumentStart { pos: Pos },
    UnexpectedDocumentEnd { pos: Pos },
    MultipleYamlDirectives { pos: Pos },
    InvalidIndentation { pos: Pos },
}

impl ParseResultError {
    pub fn add_to_log(
        &self,
        source: &logger::Source,
        log: &mut logger::Log,
    ) -> Result<(), YamlParseError> {
        match self {
            ParseResultError::Oom => return Err(YamlParseError::OutOfMemory),
            ParseResultError::StackOverflow => return Err(YamlParseError::StackOverflow),
            ParseResultError::UnexpectedEof { pos } => {
                log.add_error(source, pos.loc(), "Unexpected EOF")?;
            }
            ParseResultError::UnexpectedToken { pos } => {
                log.add_error(source, pos.loc(), "Unexpected token")?;
            }
            ParseResultError::UnexpectedCharacter { pos } => {
                log.add_error(source, pos.loc(), "Unexpected character")?;
            }
            ParseResultError::InvalidDirective { pos } => {
                log.add_error(source, pos.loc(), "Invalid directive")?;
            }
            ParseResultError::UnresolvedTagHandle { pos } => {
                log.add_error(source, pos.loc(), "Unresolved tag handle")?;
            }
            ParseResultError::UnresolvedAlias { pos } => {
                log.add_error(source, pos.loc(), "Unresolved alias")?;
            }
            ParseResultError::MultilineImplicitKey { pos } => {
                log.add_error(source, pos.loc(), "Multiline implicit key")?;
            }
            ParseResultError::MultipleAnchors { pos } => {
                log.add_error(source, pos.loc(), "Multiple anchors")?;
            }
            ParseResultError::MultipleTags { pos } => {
                log.add_error(source, pos.loc(), "Multiple tags")?;
            }
            ParseResultError::UnexpectedDocumentStart { pos } => {
                log.add_error(source, pos.loc(), "Unexpected document start")?;
            }
            ParseResultError::UnexpectedDocumentEnd { pos } => {
                log.add_error(source, pos.loc(), "Unexpected document end")?;
            }
            ParseResultError::MultipleYamlDirectives { pos } => {
                log.add_error(source, pos.loc(), "Multiple YAML directives")?;
            }
            ParseResultError::InvalidIndentation { pos } => {
                log.add_error(source, pos.loc(), "Invalid indentation")?;
            }
        }
        Ok(())
    }
}

impl<Enc: Encoding> ParseResult<Enc> {
    pub fn success(stream: Stream<Enc>, _parser: &Parser<Enc>) -> Self {
        ParseResult::Result(ParseResultOk { stream })
    }

    pub fn fail(err: ParseError, parser: &Parser<Enc>) -> Self {
        let e = match err {
            ParseError::OutOfMemory => ParseResultError::Oom,
            ParseError::StackOverflow => ParseResultError::StackOverflow,
            ParseError::UnexpectedToken => {
                ParseResultError::UnexpectedToken { pos: parser.token.start }
            }
            ParseError::UnexpectedEof => {
                ParseResultError::UnexpectedEof { pos: parser.token.start }
            }
            ParseError::InvalidDirective => {
                ParseResultError::InvalidDirective { pos: parser.token.start }
            }
            ParseError::UnexpectedCharacter => {
                if !parser.pos.is_less_than(parser.input.len()) {
                    ParseResultError::UnexpectedEof { pos: parser.pos }
                } else {
                    ParseResultError::UnexpectedCharacter { pos: parser.pos }
                }
            }
            ParseError::UnresolvedTagHandle => {
                ParseResultError::UnresolvedTagHandle { pos: parser.pos }
            }
            ParseError::UnresolvedAlias => {
                ParseResultError::UnresolvedAlias { pos: parser.token.start }
            }
            ParseError::MultilineImplicitKey => {
                ParseResultError::MultilineImplicitKey { pos: parser.token.start }
            }
            ParseError::MultipleAnchors => {
                ParseResultError::MultipleAnchors { pos: parser.token.start }
            }
            ParseError::MultipleTags => {
                ParseResultError::MultipleTags { pos: parser.token.start }
            }
            ParseError::UnexpectedDocumentStart => {
                ParseResultError::UnexpectedDocumentStart { pos: parser.pos }
            }
            ParseError::UnexpectedDocumentEnd => {
                ParseResultError::UnexpectedDocumentEnd { pos: parser.pos }
            }
            ParseError::MultipleYamlDirectives => {
                ParseResultError::MultipleYamlDirectives { pos: parser.token.start }
            }
            ParseError::InvalidIndentation => {
                ParseResultError::InvalidIndentation { pos: parser.pos }
            }
        };
        ParseResult::Err(e)
    }
}

// ───────────────────────────────────────────────────────────────────────────
// Whitespace (parser-internal)
// ───────────────────────────────────────────────────────────────────────────

pub enum Whitespace<Enc: Encoding> {
    Source { pos: Pos, unit: Enc::Unit },
    New(Enc::Unit),
}

// ───────────────────────────────────────────────────────────────────────────
// Parser
// ───────────────────────────────────────────────────────────────────────────

pub struct Parser<'i, Enc: Encoding> {
    pub input: &'i [Enc::Unit],

    pub pos: Pos,
    pub line_indent: Indent,
    pub line: Line,
    pub token: Token<Enc>,

    // allocator dropped — global mimalloc

    pub context: ContextStack,
    pub block_indents: IndentStack,

    pub explicit_document_start_line: Option<Line>,

    pub anchors: StringHashMap<Expr>,
    // TODO(port): Zig key type was []const enc.unit(); StringHashMap keys are &[u8].
    // For Utf16 this needs a different map type.

    pub tag_handles: StringHashMap<()>,

    pub whitespace_buf: Vec<Whitespace<Enc>>,

    pub stack_check: StackCheck,
}

impl<'i, Enc: Encoding> Parser<'i, Enc> {
    pub fn init(input: &'i [Enc::Unit]) -> Self {
        Self {
            input,
            pos: Pos::from(0),
            line_indent: Indent::NONE,
            line: Line::from(1),
            token: Token::eof(TokenInit {
                start: Pos::from(0),
                indent: Indent::NONE,
                line: Line::from(1),
            }),
            context: ContextStack::init(),
            block_indents: IndentStack::init(),
            explicit_document_start_line: None,
            anchors: StringHashMap::default(),
            tag_handles: StringHashMap::default(),
            whitespace_buf: Vec::new(),
            stack_check: StackCheck::init(),
        }
    }

    // deinit → impl Drop is automatic; all fields are Vec/HashMap.

    fn unexpected_token() -> ParseError {
        ParseError::UnexpectedToken
    }

    pub fn parse(&mut self) -> Result<Stream<Enc>, ParseError> {
        self.scan(ScanOptions { first_scan: true, ..Default::default() })?;
        self.parse_stream()
    }

    pub fn parse_stream(&mut self) -> Result<Stream<Enc>, ParseError> {
        let mut docs: Vec<Document> = Vec::new();

        // we want one null document if eof, not zero documents.
        let mut first = true;
        while first || !matches!(self.token.data, TokenData::Eof) {
            first = false;
            let doc = self.parse_document()?;
            docs.push(doc);
        }

        Ok(Stream { docs, input: self.input as *const [Enc::Unit] })
    }

    // PERF(port): was comptime monomorphization — profile in Phase B
    fn peek(&self, n: usize) -> Enc::Unit {
        let pos = self.pos.add(n);
        if pos.is_less_than(self.input.len()) {
            return self.input[pos.cast()];
        }
        Enc::NUL
    }

    fn inc(&mut self, n: usize) {
        self.pos = Pos::from((self.pos.cast() + n).min(self.input.len()));
    }

    fn newline(&mut self) {
        self.line_indent = Indent::NONE;
        self.line.inc(1);
    }

    fn slice(&self, off: Pos, end: Pos) -> &[Enc::Unit] {
        &self.input[off.cast()..end.cast()]
    }

    fn remain(&self) -> &[Enc::Unit] {
        &self.input[self.pos.cast()..]
    }

    fn remain_starts_with(&self, cs: &[Enc::Unit]) -> bool {
        self.remain().starts_with(cs)
    }

    fn remain_starts_with_char(&self, ch: Enc::Unit) -> bool {
        let r = self.remain();
        !r.is_empty() && r[0] == ch
    }

    fn remain_starts_with_any(&self, cs: &[Enc::Unit]) -> bool {
        let r = self.remain();
        if r.is_empty() {
            return false;
        }
        cs.iter().any(|c| *c == r[0])
    }

    // ── parseDirective ──────────────────────────────────────────────────────

    // this looks different from node parsing code because directives
    // exist mostly outside of the normal token scanning logic. they are
    // not part of the root expression.

    // TODO: move most of this into `scan()`
    fn parse_directive(&mut self) -> Result<Directive, ParseError> {
        if self.token.indent != Indent::NONE {
            return Err(ParseError::InvalidDirective);
        }

        // yaml directive
        if self.remain_starts_with(Enc::literal(b"YAML")) && self.is_s_white_at(4) {
            self.inc(4);

            self.try_skip_s_white()?;
            self.try_skip_ns_dec_digits()?;
            self.try_skip_char(Enc::ch(b'.'))?;
            self.try_skip_ns_dec_digits()?;

            // s-l-comments
            self.try_skip_to_new_line()?;

            return Ok(Directive::Yaml);
        }

        // tag directive
        if self.remain_starts_with(Enc::literal(b"TAG")) && self.is_s_white_at(3) {
            self.inc(3);

            self.try_skip_s_white()?;
            self.try_skip_char(Enc::ch(b'!'))?;

            // primary tag handle
            if self.is_s_white() {
                self.skip_s_white();
                let prefix = self.parse_directive_tag_prefix()?;
                self.try_skip_to_new_line()?;
                return Ok(Directive::Tag(DirectiveTag {
                    handle: DirectiveTagHandle::Primary,
                    prefix,
                }));
            }

            // secondary tag handle
            if self.is_char(Enc::ch(b'!')) {
                self.inc(1);
                self.try_skip_s_white()?;
                let prefix = self.parse_directive_tag_prefix()?;
                self.try_skip_to_new_line()?;
                return Ok(Directive::Tag(DirectiveTag {
                    handle: DirectiveTagHandle::Secondary,
                    prefix,
                }));
            }

            // named tag handle
            let range = self.string_range();
            self.try_skip_ns_word_chars()?;
            let handle = range.end();
            self.try_skip_char(Enc::ch(b'!'))?;
            self.try_skip_s_white()?;

            // TODO(port): StringHashMap key type; for Utf16 needs different keying.
            self.tag_handles.put(handle.slice(self.input), ())?;

            let prefix = self.parse_directive_tag_prefix()?;
            self.try_skip_to_new_line()?;
            return Ok(Directive::Tag(DirectiveTag {
                handle: DirectiveTagHandle::Named(handle),
                prefix,
            }));
        }

        // reserved directive
        let range = self.string_range();
        self.try_skip_ns_chars()?;
        let reserved = range.end();

        self.skip_s_white();

        while self.is_ns_char() {
            self.skip_ns_chars();
            self.skip_s_white();
        }

        self.try_skip_to_new_line()?;

        Ok(Directive::Reserved(reserved))
    }

    pub fn parse_directive_tag_prefix(&mut self) -> Result<DirectiveTagPrefix, ParseError> {
        // local tag prefix
        if self.is_char(Enc::ch(b'!')) {
            self.inc(1);
            let range = self.string_range();
            self.skip_ns_uri_chars();
            return Ok(DirectiveTagPrefix::Local(range.end()));
        }

        // global tag prefix
        if let Some(char_len) = self.is_ns_tag_char() {
            let range = self.string_range();
            self.inc(char_len as usize);
            self.skip_ns_uri_chars();
            return Ok(DirectiveTagPrefix::Global(range.end()));
        }

        Err(ParseError::InvalidDirective)
    }

    pub fn parse_document(&mut self) -> Result<Document, ParseError> {
        let mut directives: Vec<Directive> = Vec::new();

        self.anchors.clear_retaining_capacity();
        self.tag_handles.clear_retaining_capacity();

        let mut has_yaml_directive = false;

        while matches!(self.token.data, TokenData::Directive) {
            let directive = self.parse_directive()?;
            if matches!(directive, Directive::Yaml) {
                if has_yaml_directive {
                    return Err(ParseError::MultipleYamlDirectives);
                }
                has_yaml_directive = true;
            }
            directives.push(directive);
            self.scan(ScanOptions::default())?;
        }

        self.explicit_document_start_line = None;

        if matches!(self.token.data, TokenData::DocumentStart) {
            self.explicit_document_start_line = Some(self.token.line);
            self.scan(ScanOptions::default())?;
        } else if !directives.is_empty() {
            // if there's directives they must end with '---'
            return Err(Self::unexpected_token());
        }

        let root = self.parse_node(ParseNodeOptions::default())?;

        // If document_start it needs to create a new document.
        // If document_end, consume as many as possible. They should
        // not create new documents.
        match self.token.data {
            TokenData::Eof => {}
            TokenData::DocumentStart => {}
            TokenData::DocumentEnd => {
                let document_end_line = self.token.line;
                self.scan(ScanOptions::default())?;

                // consume all bare documents
                while matches!(self.token.data, TokenData::DocumentEnd) {
                    self.scan(ScanOptions::default())?;
                }

                if self.token.line == document_end_line {
                    return Err(Self::unexpected_token());
                }
            }
            _ => {
                return Err(Self::unexpected_token());
            }
        }

        Ok(Document { root, directives })
    }

    fn parse_flow_sequence(&mut self) -> Result<Expr, ParseError> {
        let sequence_start = self.token.start;
        let _sequence_indent = self.token.indent;
        let _sequence_line = self.line;

        let mut seq: Vec<Expr> = Vec::new();

        // PORT NOTE: `defer self.context.unset(.flow_in)` translated as manual
        // unset on all exit paths; scopeguard would borrow &mut self.context
        // across the loop body which also needs &mut self.
        // TODO(port): defer side-effect — context.unset is skipped on `?` paths;
        // scopeguard captures &mut self; Phase B.
        self.context.set(Context::FlowIn)?;

        self.scan(ScanOptions::default())?;
        while !matches!(self.token.data, TokenData::SequenceEnd) {
            let item = self.parse_node(ParseNodeOptions::default())?;
            seq.push(item);

            if matches!(self.token.data, TokenData::SequenceEnd) {
                break;
            }

            if !matches!(self.token.data, TokenData::CollectEntry) {
                self.context.unset(Context::FlowIn);
                return Err(Self::unexpected_token());
            }

            self.scan(ScanOptions::default())?;
        }

        self.context.unset(Context::FlowIn);

        self.scan(ScanOptions::default())?;

        Ok(Expr::init(
            E::Array,
            E::Array { items: BabyList::move_from_vec(&mut seq), ..Default::default() },
            sequence_start.loc(),
        ))
    }

    fn parse_flow_mapping(&mut self) -> Result<Expr, ParseError> {
        let mapping_start = self.token.start;
        let _mapping_indent = self.token.indent;
        let _mapping_line = self.token.line;

        let mut props = MappingProps::init();

        // TODO(port): defer side-effect — context.unset is skipped on `?` paths;
        // scopeguard captures &mut self; Phase B.
        self.context.set(Context::FlowIn)?;

        {
            self.context.set(Context::FlowKey)?;
            self.scan(ScanOptions::default())?;
            self.context.unset(Context::FlowKey);
        }

        while !matches!(self.token.data, TokenData::MappingEnd) {
            let key = {
                self.context.set(Context::FlowKey)?;
                let k = self.parse_node(ParseNodeOptions::default());
                self.context.unset(Context::FlowKey);
                k?
            };

            match self.token.data {
                TokenData::CollectEntry => {
                    let value = Expr::init(E::Null, E::Null {}, self.token.start.loc());
                    props.append(G::Property { key: Some(key), value: Some(value), ..Default::default() })?;

                    self.context.set(Context::FlowKey)?;
                    self.scan(ScanOptions::default())?;
                    self.context.unset(Context::FlowKey);
                    continue;
                }
                TokenData::MappingEnd => {
                    let value = Expr::init(E::Null, E::Null {}, self.token.start.loc());
                    props.append(G::Property { key: Some(key), value: Some(value), ..Default::default() })?;
                    continue;
                }
                TokenData::MappingValue => {}
                _ => {
                    self.context.unset(Context::FlowIn);
                    return Err(Self::unexpected_token());
                }
            }

            self.scan(ScanOptions::default())?;

            if matches!(self.token.data, TokenData::MappingEnd | TokenData::CollectEntry) {
                let value = Expr::init(E::Null, E::Null {}, self.token.start.loc());
                props.append(G::Property { key: Some(key), value: Some(value), ..Default::default() })?;
            } else {
                let value = self.parse_node(ParseNodeOptions::default())?;
                props.append_maybe_merge(key, value)?;
            }

            if matches!(self.token.data, TokenData::CollectEntry) {
                self.context.set(Context::FlowKey)?;
                self.scan(ScanOptions::default())?;
                self.context.unset(Context::FlowKey);
            }
        }

        self.context.unset(Context::FlowIn);

        self.scan(ScanOptions::default())?;

        Ok(Expr::init(
            E::Object,
            E::Object { properties: props.move_list(), ..Default::default() },
            mapping_start.loc(),
        ))
    }

    fn parse_block_sequence(&mut self) -> Result<Expr, ParseError> {
        let sequence_start = self.token.start;
        let sequence_indent = self.token.indent;

        self.block_indents.push(sequence_indent)?;
        // TODO(port): defer side-effect — block_indents.pop() skipped on `?` paths;
        // scopeguard captures &mut self; Phase B.

        let mut seq: Vec<Expr> = Vec::new();

        let mut prev_line = Line::from(0);

        while matches!(self.token.data, TokenData::SequenceEntry)
            && self.token.indent == sequence_indent
        {
            let _entry_line = self.token.line;
            let entry_start = self.token.start;
            let entry_indent = self.token.indent;

            if !seq.is_empty() && prev_line == self.token.line {
                // only the first entry can be another sequence entry on the
                // same line
                break;
            }

            prev_line = self.token.line;

            self.scan(ScanOptions {
                additional_parent_indent: Some(entry_indent.add(1)),
                ..Default::default()
            })?;

            // check if the sequence entry is a null value (see Zig comments)
            let item: Expr = match &self.token.data {
                TokenData::Eof => Expr::init(E::Null, E::Null {}, entry_start.add(2).loc()),
                TokenData::SequenceEntry => {
                    if self.token.indent.is_less_than_or_equal(sequence_indent) {
                        Expr::init(E::Null, E::Null {}, entry_start.add(2).loc())
                    } else {
                        self.parse_node(ParseNodeOptions::default())?
                    }
                }
                TokenData::Tag(_) | TokenData::Anchor(_) => {
                    // consume anchor and/or tag, then decide if the next node
                    // should be parsed.
                    let mut has_tag: Option<Token<Enc>> = None;
                    let mut has_anchor: Option<Token<Enc>> = None;

                    // PORT NOTE: labeled-switch loop
                    'item: loop {
                        match &self.token.data {
                            TokenData::Tag(tag) => {
                                if has_tag.is_some() {
                                    self.block_indents.pop();
                                    return Err(Self::unexpected_token());
                                }
                                let tag = *tag;
                                has_tag = Some(self.token.clone());
                                self.scan(ScanOptions {
                                    additional_parent_indent: Some(entry_indent.add(1)),
                                    tag,
                                    ..Default::default()
                                })?;
                                continue;
                            }
                            TokenData::Anchor(_anchor) => {
                                if has_anchor.is_some() {
                                    self.block_indents.pop();
                                    return Err(Self::unexpected_token());
                                }
                                has_anchor = Some(self.token.clone());
                                let tag = match &has_tag {
                                    Some(t) => match &t.data {
                                        TokenData::Tag(tg) => *tg,
                                        _ => NodeTag::None,
                                    },
                                    None => NodeTag::None,
                                };
                                self.scan(ScanOptions {
                                    additional_parent_indent: Some(entry_indent.add(1)),
                                    tag,
                                    ..Default::default()
                                })?;
                                continue;
                            }
                            TokenData::SequenceEntry => {
                                if self.token.indent.is_less_than_or_equal(sequence_indent) {
                                    let tag = match &has_tag {
                                        Some(t) => match &t.data {
                                            TokenData::Tag(tg) => *tg,
                                            _ => NodeTag::None,
                                        },
                                        None => NodeTag::None,
                                    };
                                    break 'item tag.resolve_null(entry_start.add(2).loc());
                                }
                                break 'item self.parse_node(ParseNodeOptions {
                                    scanned_tag: has_tag,
                                    scanned_anchor: has_anchor,
                                    ..Default::default()
                                })?;
                            }
                            _ => {
                                break 'item self.parse_node(ParseNodeOptions {
                                    scanned_tag: has_tag,
                                    scanned_anchor: has_anchor,
                                    ..Default::default()
                                })?;
                            }
                        }
                    }
                }
                _ => self.parse_node(ParseNodeOptions::default())?,
            };

            seq.push(item);
        }

        self.block_indents.pop();

        Ok(Expr::init(
            E::Array,
            E::Array { items: BabyList::move_from_vec(&mut seq), ..Default::default() },
            sequence_start.loc(),
        ))
    }

    /// Should only be used with expressions created with the YAML parser. It assumes
    /// only null, boolean, number, string, array, object are possible. It also only
    /// does pointer comparison with arrays and objects (so exponential merges are avoided)
    fn yaml_merge_key_expr_eql(l: &Expr, r: &Expr) -> bool {
        if core::mem::discriminant(&l.data) != core::mem::discriminant(&r.data) {
            return false;
        }
        match (&l.data, &r.data) {
            (ast::ExprData::ENull(_), _) => true,
            (ast::ExprData::EBoolean(lb), ast::ExprData::EBoolean(rb)) => lb.value == rb.value,
            (ast::ExprData::ENumber(ln), ast::ExprData::ENumber(rn)) => ln.value == rn.value,
            (ast::ExprData::EString(ls), ast::ExprData::EString(rs)) => ls.eql_e_string(rs),
            // pointer comparison
            (ast::ExprData::EArray(la), ast::ExprData::EArray(ra)) => core::ptr::eq(la, ra),
            (ast::ExprData::EObject(lo), ast::ExprData::EObject(ro)) => core::ptr::eq(lo, ro),
            _ => false,
        }
        // TODO(port): exact ExprData variant names depend on bun_js_parser::ast.
    }

    fn parse_block_mapping(
        &mut self,
        first_key: Expr,
        mapping_start: Pos,
        mapping_indent: Indent,
        mapping_line: Line,
    ) -> Result<Expr, ParseError> {
        if let Some(explicit_document_start_line) = self.explicit_document_start_line {
            if mapping_line == explicit_document_start_line {
                // TODO: more specific error
                return Err(ParseError::UnexpectedToken);
            }
        }

        self.block_indents.push(mapping_indent)?;
        // TODO(port): defer side-effect — block_indents.pop() skipped on `?` paths;
        // scopeguard captures &mut self; Phase B.

        let mut props = MappingProps::init();

        {
            // get the first value
            let mapping_value_start = self.token.start;
            let mapping_value_line = self.token.line;

            let value: Expr = match self.token.data {
                // it's a !!set entry
                TokenData::MappingKey => {
                    if self.token.line == mapping_line {
                        self.block_indents.pop();
                        return Err(Self::unexpected_token());
                    }
                    Expr::init(E::Null, E::Null {}, mapping_value_start.loc())
                }
                _ => 'value: {
                    self.scan(ScanOptions::default())?;

                    match self.token.data {
                        TokenData::SequenceEntry => {
                            if self.token.line == mapping_value_line {
                                self.block_indents.pop();
                                return Err(Self::unexpected_token());
                            }
                            if self.token.indent.is_less_than(mapping_indent) {
                                break 'value Expr::init(E::Null, E::Null {}, mapping_value_start.loc());
                            }
                            break 'value self.parse_node(ParseNodeOptions {
                                current_mapping_indent: Some(mapping_indent),
                                ..Default::default()
                            })?;
                        }
                        _ => {
                            if self.token.line != mapping_value_line
                                && self.token.indent.is_less_than_or_equal(mapping_indent)
                            {
                                break 'value Expr::init(E::Null, E::Null {}, mapping_value_start.loc());
                            }
                            break 'value self.parse_node(ParseNodeOptions {
                                current_mapping_indent: Some(mapping_indent),
                                ..Default::default()
                            })?;
                        }
                    }
                }
            };

            props.append_maybe_merge(first_key, value)?;
        }

        if self.context.get() == Context::FlowIn {
            self.block_indents.pop();
            return Ok(Expr::init(
                E::Object,
                E::Object { properties: props.move_list(), ..Default::default() },
                mapping_start.loc(),
            ));
        }

        self.context.set(Context::BlockIn)?;
        // TODO(port): defer side-effect — context.unset(.block_in) skipped on `?` paths;
        // scopeguard captures &mut self; Phase B.

        let mut previous_line = mapping_line;

        while !matches!(
            self.token.data,
            TokenData::Eof | TokenData::DocumentStart | TokenData::DocumentEnd
        ) && self.token.indent == mapping_indent
            && self.token.line != previous_line
        {
            let key_line = self.token.line;
            previous_line = key_line;
            let explicit_key = matches!(self.token.data, TokenData::MappingKey);

            let key = self.parse_node(ParseNodeOptions {
                current_mapping_indent: Some(mapping_indent),
                ..Default::default()
            })?;

            match self.token.data {
                TokenData::Eof => {
                    if explicit_key {
                        let value = Expr::init(E::Null, E::Null {}, self.pos.loc());
                        props.append(G::Property {
                            key: Some(key),
                            value: Some(value),
                            ..Default::default()
                        })?;
                        continue;
                    }
                    self.context.unset(Context::BlockIn);
                    self.block_indents.pop();
                    return Err(Self::unexpected_token());
                }
                TokenData::MappingValue => {
                    if key_line != self.token.line {
                        self.context.unset(Context::BlockIn);
                        self.block_indents.pop();
                        return Err(ParseError::MultilineImplicitKey);
                    }
                }
                TokenData::MappingKey => {}
                _ => {
                    self.context.unset(Context::BlockIn);
                    self.block_indents.pop();
                    return Err(Self::unexpected_token());
                }
            }

            let mapping_value_line = self.token.line;
            let mapping_value_start = self.token.start;

            let value: Expr = match self.token.data {
                // it's a !!set entry
                TokenData::MappingKey => {
                    if self.token.line == key_line {
                        self.context.unset(Context::BlockIn);
                        self.block_indents.pop();
                        return Err(Self::unexpected_token());
                    }
                    Expr::init(E::Null, E::Null {}, mapping_value_start.loc())
                }
                _ => 'value: {
                    self.scan(ScanOptions::default())?;

                    match self.token.data {
                        TokenData::SequenceEntry => {
                            if self.token.line == key_line {
                                self.context.unset(Context::BlockIn);
                                self.block_indents.pop();
                                return Err(Self::unexpected_token());
                            }
                            if self.token.indent.is_less_than(mapping_indent) {
                                break 'value Expr::init(E::Null, E::Null {}, mapping_value_start.loc());
                            }
                            break 'value self.parse_node(ParseNodeOptions {
                                current_mapping_indent: Some(mapping_indent),
                                ..Default::default()
                            })?;
                        }
                        _ => {
                            if self.token.line != mapping_value_line
                                && self.token.indent.is_less_than_or_equal(mapping_indent)
                            {
                                break 'value Expr::init(E::Null, E::Null {}, mapping_value_start.loc());
                            }
                            break 'value self.parse_node(ParseNodeOptions {
                                current_mapping_indent: Some(mapping_indent),
                                ..Default::default()
                            })?;
                        }
                    }
                }
            };

            props.append_maybe_merge(key, value)?;
        }

        self.context.unset(Context::BlockIn);
        self.block_indents.pop();

        Ok(Expr::init(
            E::Object,
            E::Object { properties: props.move_list(), ..Default::default() },
            mapping_start.loc(),
        ))
    }
}

// ───────────────────────────────────────────────────────────────────────────
// MappingProps
// ───────────────────────────────────────────────────────────────────────────

pub struct MappingProps {
    list: Vec<G::Property>,
}

impl MappingProps {
    pub fn init() -> Self {
        Self { list: Vec::new() }
    }

    pub fn merge(&mut self, merge_props: &[G::Property]) -> Result<(), AllocError> {
        self.list.reserve(merge_props.len());
        // PERF(port): was ensureUnusedCapacity
        'next_merge_prop: for merge_prop in merge_props.iter().rev() {
            let merge_key = merge_prop.key.as_ref().unwrap();
            for existing_prop in self.list.iter() {
                let existing_key = existing_prop.key.as_ref().unwrap();
                if Parser::<Utf8>::yaml_merge_key_expr_eql(existing_key, merge_key) {
                    // TODO(port): yaml_merge_key_expr_eql is generic-agnostic; using Utf8 monomorph here is a hack.
                    continue 'next_merge_prop;
                }
            }
            self.list.push(merge_prop.clone());
            // PERF(port): was appendAssumeCapacity
        }
        Ok(())
    }

    pub fn append(&mut self, prop: G::Property) -> Result<(), AllocError> {
        self.list.push(prop);
        Ok(())
    }

    pub fn append_maybe_merge(&mut self, key: Expr, value: Expr) -> Result<(), AllocError> {
        let is_merge_key = match &key.data {
            ast::ExprData::EString(key_str) => key_str.eql_comptime(b"<<"),
            _ => false,
        };
        // TODO(port): exact ExprData variant names depend on bun_js_parser::ast.

        if !is_merge_key {
            self.list.push(G::Property { key: Some(key), value: Some(value), ..Default::default() });
            return Ok(());
        }

        match &value.data {
            ast::ExprData::EObject(value_obj) => self.merge(value_obj.properties.slice()),
            ast::ExprData::EArray(value_arr) => {
                for item in value_arr.items.slice() {
                    let item_obj = match &item.data {
                        ast::ExprData::EObject(obj) => obj,
                        _ => continue,
                    };
                    self.merge(item_obj.properties.slice())?;
                }
                Ok(())
            }
            _ => {
                self.list.push(G::Property { key: Some(key), value: Some(value), ..Default::default() });
                Ok(())
            }
        }
    }

    pub fn move_list(&mut self) -> G::PropertyList {
        G::PropertyList::move_from_vec(&mut self.list)
    }
}

// ───────────────────────────────────────────────────────────────────────────
// NodeProperties
// ───────────────────────────────────────────────────────────────────────────

pub struct NodeProperties<Enc: Encoding> {
    // c-ns-properties
    pub has_anchor: Option<Token<Enc>>,
    pub has_tag: Option<Token<Enc>>,

    // when properties for mapping and first key are right next to eachother
    pub has_mapping_anchor: Option<Token<Enc>>,
    pub has_mapping_tag: Option<Token<Enc>>,
}

impl<Enc: Encoding> Default for NodeProperties<Enc> {
    fn default() -> Self {
        Self { has_anchor: None, has_tag: None, has_mapping_anchor: None, has_mapping_tag: None }
    }
}

pub struct ImplicitKeyAnchors {
    pub key_anchor: Option<StringRange>,
    pub mapping_anchor: Option<StringRange>,
}

impl<Enc: Encoding> NodeProperties<Enc> {
    pub fn has_anchor_or_tag(&self) -> bool {
        self.has_anchor.is_some() || self.has_tag.is_some()
    }

    pub fn set_anchor(&mut self, anchor_token: Token<Enc>) -> Result<(), ParseError> {
        if let Some(previous_anchor) = &self.has_anchor {
            if previous_anchor.line == anchor_token.line {
                return Err(ParseError::MultipleAnchors);
            }
            self.has_mapping_anchor = Some(previous_anchor.clone());
        }
        self.has_anchor = Some(anchor_token);
        Ok(())
    }

    pub fn anchor(&self) -> Option<StringRange> {
        self.has_anchor.as_ref().and_then(|t| match &t.data {
            TokenData::Anchor(r) => Some(*r),
            _ => None,
        })
    }

    pub fn anchor_line(&self) -> Option<Line> {
        self.has_anchor.as_ref().map(|t| t.line)
    }

    pub fn anchor_indent(&self) -> Option<Indent> {
        self.has_anchor.as_ref().map(|t| t.indent)
    }

    pub fn mapping_anchor(&self) -> Option<StringRange> {
        self.has_mapping_anchor.as_ref().and_then(|t| match &t.data {
            TokenData::Anchor(r) => Some(*r),
            _ => None,
        })
    }

    pub fn implicit_key_anchors(&self, implicit_key_line: Line) -> ImplicitKeyAnchors {
        if let Some(mapping_anchor) = &self.has_mapping_anchor {
            debug_assert!(self.has_anchor.is_some());
            return ImplicitKeyAnchors {
                key_anchor: self.has_anchor.as_ref().and_then(|t| match &t.data {
                    TokenData::Anchor(r) => Some(*r),
                    _ => None,
                }),
                mapping_anchor: match &mapping_anchor.data {
                    TokenData::Anchor(r) => Some(*r),
                    _ => None,
                },
            };
        }

        if let Some(mystery_anchor) = &self.has_anchor {
            // might be the anchor for the key, or anchor for the mapping
            let r = match &mystery_anchor.data {
                TokenData::Anchor(r) => Some(*r),
                _ => None,
            };
            if mystery_anchor.line == implicit_key_line {
                return ImplicitKeyAnchors { key_anchor: r, mapping_anchor: None };
            }
            return ImplicitKeyAnchors { key_anchor: None, mapping_anchor: r };
        }

        ImplicitKeyAnchors { key_anchor: None, mapping_anchor: None }
    }

    pub fn set_tag(&mut self, tag_token: Token<Enc>) -> Result<(), ParseError> {
        if let Some(previous_tag) = &self.has_tag {
            if previous_tag.line == tag_token.line {
                return Err(ParseError::MultipleTags);
            }
            self.has_mapping_tag = Some(previous_tag.clone());
        }
        self.has_tag = Some(tag_token);
        Ok(())
    }

    pub fn tag(&self) -> NodeTag {
        self.has_tag
            .as_ref()
            .and_then(|t| match &t.data {
                TokenData::Tag(tg) => Some(*tg),
                _ => None,
            })
            .unwrap_or(NodeTag::None)
    }

    pub fn tag_line(&self) -> Option<Line> {
        self.has_tag.as_ref().map(|t| t.line)
    }

    pub fn tag_indent(&self) -> Option<Indent> {
        self.has_tag.as_ref().map(|t| t.indent)
    }
}

// ───────────────────────────────────────────────────────────────────────────
// ParseNodeOptions
// ───────────────────────────────────────────────────────────────────────────

pub struct ParseNodeOptions<Enc: Encoding> {
    pub current_mapping_indent: Option<Indent>,
    pub explicit_mapping_key: bool,
    pub scanned_tag: Option<Token<Enc>>,
    pub scanned_anchor: Option<Token<Enc>>,
}

impl<Enc: Encoding> Default for ParseNodeOptions<Enc> {
    fn default() -> Self {
        Self {
            current_mapping_indent: None,
            explicit_mapping_key: false,
            scanned_tag: None,
            scanned_anchor: None,
        }
    }
}

// ───────────────────────────────────────────────────────────────────────────
// ScanOptions
// ───────────────────────────────────────────────────────────────────────────

#[derive(Clone, Copy)]
pub struct ScanOptions {
    /// Used by compact sequences. We need to add the parent indentation
    pub additional_parent_indent: Option<Indent>,
    /// If a scalar is scanned, this tag might be used.
    pub tag: NodeTag,
    /// The scanner only counts indentation after a newline (or in compact
    /// collections). First scan needs to count indentation.
    pub first_scan: bool,
    pub outside_context: bool,
}

impl Default for ScanOptions {
    fn default() -> Self {
        Self {
            additional_parent_indent: None,
            tag: NodeTag::None,
            first_scan: false,
            outside_context: false,
        }
    }
}

// ───────────────────────────────────────────────────────────────────────────
// Escape
// ───────────────────────────────────────────────────────────────────────────

#[derive(Clone, Copy, PartialEq, Eq, core::marker::ConstParamTy)]
#[repr(u8)]
pub enum Escape {
    X = 2,
    LowerU = 4,
    UpperU = 8,
}

impl Escape {
    pub const fn characters(self) -> u8 {
        self as u8
    }
}

// ───────────────────────────────────────────────────────────────────────────
// FirstChar (for tryResolveNumber)
// ───────────────────────────────────────────────────────────────────────────

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum FirstChar {
    Positive,
    Negative,
    Dot,
    Other,
}

// ───────────────────────────────────────────────────────────────────────────
// Parser methods (continued)
// ───────────────────────────────────────────────────────────────────────────

impl<'i, Enc: Encoding> Parser<'i, Enc> {
    fn parse_node(&mut self, opts: ParseNodeOptions<Enc>) -> Result<Expr, ParseError> {
        if !self.stack_check.is_safe_to_recurse() {
            return Err(ParseError::StackOverflow);
        }

        // c-ns-properties
        let mut node_props: NodeProperties<Enc> = NodeProperties::default();

        if let Some(tag) = opts.scanned_tag {
            node_props.set_tag(tag)?;
        }
        if let Some(anchor) = opts.scanned_anchor {
            node_props.set_anchor(anchor)?;
        }

        // PORT NOTE: labeled-switch loop on `self.token.data`. The Zig
        // `continue :node self.token.data` re-enters with the new token after
        // scanning. We loop and re-match.
        let node: Expr = 'node: loop {
            match &self.token.data {
                TokenData::Eof | TokenData::DocumentStart | TokenData::DocumentEnd => {
                    break 'node Expr::init(E::Null, E::Null {}, self.token.start.loc());
                }

                TokenData::Anchor(_anchor) => {
                    node_props.set_anchor(self.token.clone())?;
                    self.scan(ScanOptions { tag: node_props.tag(), ..Default::default() })?;
                    continue;
                }

                TokenData::Tag(tag) => {
                    let tag = *tag;
                    node_props.set_tag(self.token.clone())?;
                    self.scan(ScanOptions { tag, ..Default::default() })?;
                    continue;
                }

                TokenData::Alias(alias) => {
                    let alias = *alias;
                    let alias_start = self.token.start;
                    let alias_indent = self.token.indent;
                    let alias_line = self.token.line;

                    if let Some(anchor) = &node_props.has_anchor {
                        if anchor.line == alias_line {
                            return Err(Self::unexpected_token());
                        }
                    }
                    if let Some(tag) = &node_props.has_tag {
                        if tag.line == alias_line {
                            return Err(Self::unexpected_token());
                        }
                    }

                    let mut copy = match self.anchors.get(alias.slice(self.input)) {
                        Some(e) => e.clone(),
                        None => {
                            // we failed to find the alias, but it might be cyclic and
                            // available later. (see Zig comment block)
                            return Err(ParseError::UnresolvedAlias);
                        }
                    };

                    // update position from the anchor node to the alias node.
                    copy.loc = alias_start.loc();

                    self.scan(ScanOptions::default())?;

                    if matches!(self.token.data, TokenData::MappingValue) {
                        if alias_line != self.token.line && !opts.explicit_mapping_key {
                            return Err(ParseError::MultilineImplicitKey);
                        }

                        if self.context.get() == Context::FlowKey {
                            return Ok(copy);
                        }

                        if let Some(current_mapping_indent) = opts.current_mapping_indent {
                            if current_mapping_indent == alias_indent {
                                return Ok(copy);
                            }
                        }

                        let map = self.parse_block_mapping(copy, alias_start, alias_indent, alias_line)?;
                        return Ok(map);
                    }

                    break 'node copy;
                }

                TokenData::SequenceStart => {
                    let sequence_start = self.token.start;
                    let sequence_indent = self.token.indent;
                    let sequence_line = self.token.line;
                    let seq = self.parse_flow_sequence()?;

                    if matches!(self.token.data, TokenData::MappingValue) {
                        if sequence_line != self.token.line && !opts.explicit_mapping_key {
                            return Err(ParseError::MultilineImplicitKey);
                        }

                        if self.context.get() == Context::FlowKey {
                            break 'node seq;
                        }

                        if let Some(current_mapping_indent) = opts.current_mapping_indent {
                            if current_mapping_indent == sequence_indent {
                                break 'node seq;
                            }
                        }

                        let implicit_key_anchors = node_props.implicit_key_anchors(sequence_line);

                        if let Some(key_anchor) = implicit_key_anchors.key_anchor {
                            self.anchors.put(key_anchor.slice(self.input), seq.clone())?;
                        }

                        let map = self.parse_block_mapping(seq, sequence_start, sequence_indent, sequence_line)?;

                        if let Some(mapping_anchor) = implicit_key_anchors.mapping_anchor {
                            self.anchors.put(mapping_anchor.slice(self.input), map.clone())?;
                        }

                        return Ok(map);
                    }

                    break 'node seq;
                }

                TokenData::CollectEntry | TokenData::SequenceEnd | TokenData::MappingEnd => {
                    if node_props.has_anchor_or_tag() {
                        break 'node Expr::init(E::Null, E::Null {}, self.pos.loc());
                    }
                    return Err(Self::unexpected_token());
                }

                TokenData::SequenceEntry => {
                    if let Some(anchor_line) = node_props.anchor_line() {
                        if anchor_line == self.token.line {
                            return Err(Self::unexpected_token());
                        }
                    }
                    if let Some(tag_line) = node_props.tag_line() {
                        if tag_line == self.token.line {
                            return Err(Self::unexpected_token());
                        }
                    }
                    break 'node self.parse_block_sequence()?;
                }

                TokenData::MappingStart => {
                    let mapping_start = self.token.start;
                    let mapping_indent = self.token.indent;
                    let mapping_line = self.token.line;

                    let map = self.parse_flow_mapping()?;

                    if matches!(self.token.data, TokenData::MappingValue) {
                        if mapping_line != self.token.line && !opts.explicit_mapping_key {
                            return Err(ParseError::MultilineImplicitKey);
                        }

                        if self.context.get() == Context::FlowKey {
                            break 'node map;
                        }

                        if let Some(current_mapping_indent) = opts.current_mapping_indent {
                            if current_mapping_indent == mapping_indent {
                                break 'node map;
                            }
                        }

                        let implicit_key_anchors = node_props.implicit_key_anchors(mapping_line);

                        if let Some(key_anchor) = implicit_key_anchors.key_anchor {
                            self.anchors.put(key_anchor.slice(self.input), map.clone())?;
                        }

                        let parent_map = self.parse_block_mapping(map, mapping_start, mapping_indent, mapping_line)?;

                        if let Some(mapping_anchor) = implicit_key_anchors.mapping_anchor {
                            self.anchors.put(mapping_anchor.slice(self.input), parent_map.clone())?;
                        }

                        break 'node parent_map;
                    }
                    break 'node map;
                }

                TokenData::MappingKey => {
                    let mapping_start = self.token.start;
                    let mapping_indent = self.token.indent;
                    let mapping_line = self.token.line;

                    self.block_indents.push(mapping_indent)?;

                    self.scan(ScanOptions::default())?;

                    let key = self.parse_node(ParseNodeOptions {
                        explicit_mapping_key: true,
                        current_mapping_indent: Some(opts.current_mapping_indent.unwrap_or(mapping_indent)),
                        ..Default::default()
                    })?;

                    self.block_indents.pop();

                    if let Some(current_mapping_indent) = opts.current_mapping_indent {
                        if current_mapping_indent == mapping_indent {
                            return Ok(key);
                        }
                    }

                    break 'node self.parse_block_mapping(key, mapping_start, mapping_indent, mapping_line)?;
                }

                TokenData::MappingValue => {
                    if self.context.get() == Context::FlowKey {
                        break 'node Expr::init(E::Null, E::Null {}, self.token.start.loc());
                    }
                    if let Some(current_mapping_indent) = opts.current_mapping_indent {
                        if current_mapping_indent == self.token.indent {
                            break 'node Expr::init(E::Null, E::Null {}, self.token.start.loc());
                        }
                    }
                    let first_key = Expr::init(E::Null, E::Null {}, self.token.start.loc());
                    break 'node self.parse_block_mapping(
                        first_key,
                        self.token.start,
                        self.token.indent,
                        self.token.line,
                    )?;
                }

                TokenData::Scalar(_) => {
                    let scalar_start = self.token.start;
                    let scalar_indent = self.token.indent;
                    let scalar_line = self.token.line;

                    // PORT NOTE: reshaped for borrowck — we must hold the scalar
                    // payload across `self.scan()` which replaces self.token.
                    // Take it out before scanning.
                    let scalar = match core::mem::replace(
                        &mut self.token.data,
                        TokenData::Eof, // placeholder; overwritten by scan() below
                    ) {
                        TokenData::Scalar(s) => s,
                        _ => unreachable!(),
                    };

                    self.scan(ScanOptions {
                        tag: node_props.tag(),
                        outside_context: true,
                        ..Default::default()
                    })?;

                    if matches!(self.token.data, TokenData::MappingValue) {
                        // this might be the start of a new object with an implicit key
                        // (see Zig comments for cases 1-4)
                        if let Some(current_mapping_indent) = opts.current_mapping_indent {
                            if current_mapping_indent == scalar_indent {
                                // 3
                                break 'node scalar.data.to_expr(scalar_start, self.input);
                            }
                        }

                        match self.context.get() {
                            Context::FlowKey => {
                                // 1
                                break 'node scalar.data.to_expr(scalar_start, self.input);
                            }
                            Context::FlowIn | Context::BlockOut | Context::BlockIn => {
                                if scalar_line != self.token.line && !opts.explicit_mapping_key {
                                    return Err(ParseError::MultilineImplicitKey);
                                }
                            }
                        }

                        let implicit_key = scalar.data.to_expr(scalar_start, self.input);

                        let implicit_key_anchors = node_props.implicit_key_anchors(scalar_line);

                        if let Some(key_anchor) = implicit_key_anchors.key_anchor {
                            self.anchors.put(key_anchor.slice(self.input), implicit_key.clone())?;
                        }

                        let mapping = self.parse_block_mapping(
                            implicit_key,
                            scalar_start,
                            scalar_indent,
                            scalar_line,
                        )?;

                        if let Some(mapping_anchor) = implicit_key_anchors.mapping_anchor {
                            self.anchors.put(mapping_anchor.slice(self.input), mapping.clone())?;
                        }

                        return Ok(mapping);
                    }

                    break 'node scalar.data.to_expr(scalar_start, self.input);
                }

                TokenData::Directive => return Err(Self::unexpected_token()),
                TokenData::Reserved => return Err(Self::unexpected_token()),
            }
        };

        if let Some(mapping_anchor) = node_props.has_mapping_anchor {
            self.token = mapping_anchor;
            return Err(ParseError::MultipleAnchors);
        }

        if let Some(mapping_tag) = node_props.has_mapping_tag {
            self.token = mapping_tag;
            return Err(ParseError::MultipleTags);
        }

        let resolved = match &node.data {
            ast::ExprData::ENull(_) => node_props.tag().resolve_null(node.loc),
            _ => node,
        };

        if let Some(anchor) = node_props.anchor() {
            self.anchors.put(anchor.slice(self.input), resolved.clone())?;
        }

        Ok(resolved)
    }

    fn next(&self) -> Enc::Unit {
        let pos = self.pos;
        if pos.is_less_than(self.input.len()) {
            return self.input[pos.cast()];
        }
        Enc::NUL
    }

    fn fold_lines(&mut self) -> usize {
        let mut total: usize = 0;
        // PORT NOTE: labeled-switch loop
        let mut __c = Enc::wide(self.next());
        loop {
            match __c {
                0x0D /* '\r' */ => {
                    if Enc::wide(self.peek(1)) == 0x0A {
                        self.inc(1);
                    }
                    __c = 0x0A;
                    continue;
                }
                0x0A /* '\n' */ => {
                    total += 1;
                    self.newline();
                    self.inc(1);
                    __c = Enc::wide(self.next());
                    continue;
                }
                0x20 /* ' ' */ => {
                    let mut indent = Indent::from(1);
                    self.inc(1);
                    while Enc::wide(self.next()) == 0x20 {
                        self.inc(1);
                        indent.inc(1);
                    }
                    self.line_indent = indent;
                    self.skip_s_white();
                    __c = Enc::wide(self.next());
                    continue;
                }
                0x09 /* '\t' */ => {
                    // there's no indentation, but we still skip the whitespace
                    self.inc(1);
                    self.skip_s_white();
                    __c = Enc::wide(self.next());
                    continue;
                }
                _ => return total,
            }
        }
    }

    // ── scanPlainScalar ─────────────────────────────────────────────────────
    //
    // This is the largest function in the file: a labeled-switch state machine
    // with an inner local struct `ScalarResolverCtx` that holds `*Parser` AND a
    // `StringBuilder` that ALSO holds `*Parser`. Both are BACKREF in
    // LIFETIMES.tsv → modeled as raw `*mut Parser` here.
    //
    // TODO(port): borrowck reshape — Phase B should either (a) move
    // `whitespace_buf` out of Parser, or (b) restructure ctx to take `&mut self`
    // per call instead of storing it. The raw-pointer aliasing below is sound
    // because `ctx` never outlives `&mut self` and never re-enters Parser
    // methods that re-borrow `whitespace_buf`/`input` concurrently.

    fn scan_plain_scalar(&mut self, opts: ScanOptions) -> Result<Token<Enc>, ParseError> {
        let parser: *mut Parser<'i, Enc> = self;
        // SAFETY: ctx outlived by &mut self in scan_plain_scalar; no other
        // borrow of *self exists across these unsafe derefs.
        let mut ctx = ScalarResolverCtx::<Enc> {
            str_builder: unsafe { (*parser).string_builder_raw() },
            resolved: false,
            scalar: None,
            tag: opts.tag,
            parser,
            resolved_scalar_len: 0,
            start: self.pos,
            line: self.line,
            line_indent: self.line_indent,
            multiline: false,
        };

        // PORT NOTE: labeled-switch loop
        let mut __c = Enc::wide(self.next());
        loop {
            match __c {
                0 => {
                    return Ok(ctx.done());
                }

                0x2D /* '-' */ => {
                    if self.line_indent == Indent::NONE
                        && self.remain_starts_with(Enc::literal(b"---"))
                        && self.is_any_or_eof_at(Enc::literal(b" \t\n\r"), 3)
                    {
                        return Ok(ctx.done());
                    }

                    if !ctx.resolved && ctx.str_builder.len() == 0 {
                        ctx.append_source(Enc::ch(b'-'), self.pos)?;
                        self.inc(1);
                        ctx.try_resolve_number(self, FirstChar::Negative)?;
                        __c = Enc::wide(self.next());
                        continue;
                    }

                    ctx.append_source(Enc::ch(b'-'), self.pos)?;
                    self.inc(1);
                    __c = Enc::wide(self.next());
                    continue;
                }

                0x2E /* '.' */ => {
                    if self.line_indent == Indent::NONE
                        && self.remain_starts_with(Enc::literal(b"..."))
                        && self.is_any_or_eof_at(Enc::literal(b" \t\n\r"), 3)
                    {
                        return Ok(ctx.done());
                    }

                    if !ctx.resolved && ctx.str_builder.len() == 0 {
                        match Enc::wide(self.peek(1)) {
                            0x6E | 0x4E | 0x69 | 0x49 /* 'n' 'N' 'i' 'I' */ => {
                                ctx.append_source(Enc::ch(b'.'), self.pos)?;
                                self.inc(1);
                                ctx.try_resolve_number(self, FirstChar::Dot)?;
                                __c = Enc::wide(self.next());
                                continue;
                            }
                            _ => {
                                ctx.try_resolve_number(self, FirstChar::Other)?;
                                __c = Enc::wide(self.next());
                                continue;
                            }
                        }
                    }

                    ctx.append_source(Enc::ch(b'.'), self.pos)?;
                    self.inc(1);
                    __c = Enc::wide(self.next());
                    continue;
                }

                0x3A /* ':' */ => {
                    if self.is_s_white_or_b_char_or_eof_at(1) {
                        return Ok(ctx.done());
                    }

                    match self.context.get() {
                        Context::BlockOut | Context::BlockIn | Context::FlowIn => {}
                        Context::FlowKey => match Enc::wide(self.peek(1)) {
                            0x2C | 0x5B | 0x5D | 0x7B | 0x7D /* , [ ] { } */ => {
                                return Ok(ctx.done());
                            }
                            _ => {}
                        },
                    }

                    ctx.append_source(Enc::ch(b':'), self.pos)?;
                    self.inc(1);
                    __c = Enc::wide(self.next());
                    continue;
                }

                0x23 /* '#' */ => {
                    let prev = self.input[self.pos.sub(1).cast()];
                    if self.pos == Pos::ZERO
                        || matches!(Enc::wide(prev), 0x20 | 0x09 | 0x0D | 0x0A)
                    {
                        return Ok(ctx.done());
                    }

                    ctx.append_source(Enc::ch(b'#'), self.pos)?;
                    self.inc(1);
                    __c = Enc::wide(self.next());
                    continue;
                }

                0x2C | 0x5B | 0x5D | 0x7B | 0x7D /* , [ ] { } */ => {
                    match self.context.get() {
                        Context::BlockIn | Context::BlockOut => {}
                        Context::FlowIn | Context::FlowKey => {
                            return Ok(ctx.done());
                        }
                    }

                    let c = self.next();
                    ctx.append_source(c, self.pos)?;
                    self.inc(1);
                    __c = Enc::wide(self.next());
                    continue;
                }

                0x20 | 0x09 /* ' ' '\t' */ => {
                    let c = self.next();
                    ctx.append_source_whitespace(c, self.pos)?;
                    self.inc(1);
                    __c = Enc::wide(self.next());
                    continue;
                }

                0x0D /* '\r' */ => {
                    if Enc::wide(self.peek(1)) == 0x0A {
                        self.inc(1);
                    }
                    __c = 0x0A;
                    continue;
                }

                0x0A /* '\n' */ => {
                    self.newline();
                    self.inc(1);

                    let lines = self.fold_lines();

                    if let Some(block_indent) = self.block_indents.get() {
                        match self.line_indent.cmp(block_indent) {
                            Ordering::Greater => {
                                // continue (whitespace already stripped)
                            }
                            Ordering::Less | Ordering::Equal => {
                                // end here. this is the start of a new value.
                                return Ok(ctx.done());
                            }
                        }
                    }

                    // clear the leading whitespace before the newline.
                    // SAFETY: ctx.parser == self; whitespace_buf not borrowed.
                    unsafe { (*ctx.parser).whitespace_buf.clear(); }

                    if lines == 0 && !self.is_eof() {
                        ctx.append_whitespace(Enc::ch(b' '))?;
                    }

                    ctx.append_whitespace_n_times(Enc::ch(b'\n'), lines)?;

                    __c = Enc::wide(self.next());
                    continue;
                }

                _ => {
                    let c = self.next();
                    if ctx.resolved || ctx.str_builder.len() != 0 {
                        let start = self.pos;
                        self.inc(1);
                        ctx.append_source(c, start)?;
                        __c = Enc::wide(self.next());
                        continue;
                    }

                    // first non-whitespace

                    // TODO: make more better
                    match __c {
                        0x6E /* 'n' */ => {
                            let n_start = self.pos;
                            self.inc(1);
                            if self.remain_starts_with(Enc::literal(b"ull")) {
                                ctx.resolve(NodeScalar::Null, n_start, Enc::literal(b"null"))?;
                                self.inc(3);
                                __c = Enc::wide(self.next());
                                continue;
                            }
                            ctx.append_source(c, n_start)?;
                            __c = Enc::wide(self.next());
                            continue;
                        }
                        0x4E /* 'N' */ => {
                            let n_start = self.pos;
                            self.inc(1);
                            if self.remain_starts_with(Enc::literal(b"ull")) {
                                ctx.resolve(NodeScalar::Null, n_start, Enc::literal(b"Null"))?;
                                self.inc(3);
                                __c = Enc::wide(self.next());
                                continue;
                            }
                            if self.remain_starts_with(Enc::literal(b"ULL")) {
                                ctx.resolve(NodeScalar::Null, n_start, Enc::literal(b"NULL"))?;
                                self.inc(3);
                                __c = Enc::wide(self.next());
                                continue;
                            }
                            ctx.append_source(c, n_start)?;
                            __c = Enc::wide(self.next());
                            continue;
                        }
                        0x7E /* '~' */ => {
                            let start = self.pos;
                            self.inc(1);
                            ctx.resolve(NodeScalar::Null, start, Enc::literal(b"~"))?;
                            __c = Enc::wide(self.next());
                            continue;
                        }
                        0x74 /* 't' */ => {
                            let t_start = self.pos;
                            self.inc(1);
                            if self.remain_starts_with(Enc::literal(b"rue")) {
                                ctx.resolve(NodeScalar::Boolean(true), t_start, Enc::literal(b"true"))?;
                                self.inc(3);
                                __c = Enc::wide(self.next());
                                continue;
                            }
                            ctx.append_source(c, t_start)?;
                            __c = Enc::wide(self.next());
                            continue;
                        }
                        0x54 /* 'T' */ => {
                            let t_start = self.pos;
                            self.inc(1);
                            if self.remain_starts_with(Enc::literal(b"rue")) {
                                ctx.resolve(NodeScalar::Boolean(true), t_start, Enc::literal(b"True"))?;
                                self.inc(3);
                                __c = Enc::wide(self.next());
                                continue;
                            }
                            if self.remain_starts_with(Enc::literal(b"RUE")) {
                                ctx.resolve(NodeScalar::Boolean(true), t_start, Enc::literal(b"TRUE"))?;
                                self.inc(3);
                                __c = Enc::wide(self.next());
                                continue;
                            }
                            ctx.append_source(c, t_start)?;
                            __c = Enc::wide(self.next());
                            continue;
                        }
                        0x66 /* 'f' */ => {
                            let f_start = self.pos;
                            self.inc(1);
                            if self.remain_starts_with(Enc::literal(b"alse")) {
                                ctx.resolve(NodeScalar::Boolean(false), f_start, Enc::literal(b"false"))?;
                                self.inc(4);
                                __c = Enc::wide(self.next());
                                continue;
                            }
                            ctx.append_source(c, f_start)?;
                            __c = Enc::wide(self.next());
                            continue;
                        }
                        0x46 /* 'F' */ => {
                            let f_start = self.pos;
                            self.inc(1);
                            if self.remain_starts_with(Enc::literal(b"alse")) {
                                ctx.resolve(NodeScalar::Boolean(false), f_start, Enc::literal(b"False"))?;
                                self.inc(4);
                                __c = Enc::wide(self.next());
                                continue;
                            }
                            if self.remain_starts_with(Enc::literal(b"ALSE")) {
                                ctx.resolve(NodeScalar::Boolean(false), f_start, Enc::literal(b"FALSE"))?;
                                self.inc(4);
                                __c = Enc::wide(self.next());
                                continue;
                            }
                            ctx.append_source(c, f_start)?;
                            __c = Enc::wide(self.next());
                            continue;
                        }

                        0x2D /* '-' */ => {
                            ctx.append_source(Enc::ch(b'-'), self.pos)?;
                            self.inc(1);
                            ctx.try_resolve_number(self, FirstChar::Negative)?;
                            __c = Enc::wide(self.next());
                            continue;
                        }

                        0x2B /* '+' */ => {
                            ctx.append_source(Enc::ch(b'+'), self.pos)?;
                            self.inc(1);
                            ctx.try_resolve_number(self, FirstChar::Positive)?;
                            __c = Enc::wide(self.next());
                            continue;
                        }

                        0x30..=0x39 /* '0'..'9' */ => {
                            ctx.try_resolve_number(self, FirstChar::Other)?;
                            __c = Enc::wide(self.next());
                            continue;
                        }

                        0x2E /* '.' */ => {
                            match Enc::wide(self.peek(1)) {
                                0x6E | 0x4E | 0x69 | 0x49 /* 'n' 'N' 'i' 'I' */ => {
                                    ctx.append_source(Enc::ch(b'.'), self.pos)?;
                                    self.inc(1);
                                    ctx.try_resolve_number(self, FirstChar::Dot)?;
                                    __c = Enc::wide(self.next());
                                    continue;
                                }
                                _ => {
                                    ctx.try_resolve_number(self, FirstChar::Other)?;
                                    __c = Enc::wide(self.next());
                                    continue;
                                }
                            }
                        }

                        _ => {
                            let start = self.pos;
                            self.inc(1);
                            ctx.append_source(c, start)?;
                            __c = Enc::wide(self.next());
                            continue;
                        }
                    }
                }
            }
        }
    }

    // ── scanBlockHeader ─────────────────────────────────────────────────────

    fn scan_block_header(&mut self) -> Result<(IndentIndicator, Chomp), ParseError> {
        let mut indent_indicator: Option<IndentIndicator> = None;
        let mut chomp: Option<Chomp> = None;

        // PORT NOTE: labeled-switch loop
        let mut __c = Enc::wide(self.next());
        loop {
            match __c {
                0 => {
                    return Ok((
                        indent_indicator.unwrap_or(IndentIndicator::DEFAULT),
                        chomp.unwrap_or(Chomp::DEFAULT),
                    ));
                }
                0x31..=0x39 /* '1'..'9' */ => {
                    if indent_indicator.is_some() {
                        return Err(ParseError::UnexpectedCharacter);
                    }
                    indent_indicator = Some(IndentIndicator::from_raw(u8::try_from(__c - 0x30).unwrap()));
                    self.inc(1);
                    __c = Enc::wide(self.next());
                    continue;
                }
                0x2D /* '-' */ => {
                    if chomp.is_some() {
                        return Err(ParseError::UnexpectedCharacter);
                    }
                    chomp = Some(Chomp::Strip);
                    self.inc(1);
                    __c = Enc::wide(self.next());
                    continue;
                }
                0x2B /* '+' */ => {
                    if chomp.is_some() {
                        return Err(ParseError::UnexpectedCharacter);
                    }
                    chomp = Some(Chomp::Keep);
                    self.inc(1);
                    __c = Enc::wide(self.next());
                    continue;
                }
                0x20 | 0x09 /* ' ' | '\t' */ => {
                    self.inc(1);
                    self.skip_s_white();
                    if Enc::wide(self.next()) == 0x23 /* '#' */ {
                        self.inc(1);
                        while !self.is_b_char_or_eof() {
                            self.inc(1);
                        }
                    }
                    __c = Enc::wide(self.next());
                    continue;
                }
                0x0D /* '\r' */ => {
                    if Enc::wide(self.peek(1)) == 0x0A {
                        self.inc(1);
                    }
                    __c = 0x0A;
                    continue;
                }
                0x0A /* '\n' */ => {
                    // the first newline is always excluded from a literal
                    self.inc(1);
                    if Enc::wide(self.next()) == 0x09 {
                        // tab for indentation
                        return Err(ParseError::UnexpectedCharacter);
                    }
                    return Ok((
                        indent_indicator.unwrap_or(IndentIndicator::DEFAULT),
                        chomp.unwrap_or(Chomp::DEFAULT),
                    ));
                }
                _ => return Err(ParseError::UnexpectedCharacter),
            }
        }
    }

    // ── scanAutoIndentedLiteralScalar ───────────────────────────────────────
    //
    // TODO(port): Another large labeled-switch state machine (yaml.zig:2703-2979)
    // with an inner `LiteralScalarCtx` struct. The two-phase loop (find
    // content_indent, then scan body) with `ctx.append`/`ctx.done` and chomp
    // handling is preserved structurally below but Phase B must verify the
    // nested `newlines:` switch translation.

    fn scan_auto_indented_literal_scalar(
        &mut self,
        chomp: Chomp,
        folded: bool,
        start: Pos,
        line: Line,
    ) -> Result<Token<Enc>, ParseError> {
        struct LiteralScalarCtx<Enc: Encoding> {
            chomp: Chomp,
            leading_newlines: usize,
            text: Vec<Enc::Unit>,
            start: Pos,
            content_indent: Indent,
            previous_indent: Indent,
            max_leading_indent: Indent,
            line: Line,
            folded: bool,
        }

        impl<Enc: Encoding> LiteralScalarCtx<Enc> {
            fn done(mut self, was_eof: bool) -> Result<Token<Enc>, AllocError> {
                match self.chomp {
                    Chomp::Keep => {
                        if was_eof {
                            for _ in 0..self.leading_newlines + 1 {
                                self.text.push(Enc::ch(b'\n'));
                            }
                        } else if !self.text.is_empty() {
                            for _ in 0..self.leading_newlines {
                                self.text.push(Enc::ch(b'\n'));
                            }
                        }
                    }
                    Chomp::Clip => {
                        if was_eof || !self.text.is_empty() {
                            self.text.push(Enc::ch(b'\n'));
                        }
                    }
                    Chomp::Strip => {
                        // no trailing newlines
                    }
                }

                Ok(Token::scalar(ScalarInit {
                    start: self.start,
                    indent: self.content_indent,
                    line: self.line,
                    resolved: TokenScalar {
                        data: NodeScalar::String(YamlString::List(self.text)),
                        multiline: true,
                    },
                }))
            }

            fn append(&mut self, c: Enc::Unit) -> Result<(), ParseError> {
                if self.text.is_empty() {
                    if self.content_indent.is_less_than(self.max_leading_indent) {
                        return Err(ParseError::UnexpectedCharacter);
                    }
                }
                if self.folded {
                    match self.leading_newlines {
                        0 => self.text.push(c),
                        1 => {
                            if self.previous_indent == self.content_indent {
                                self.text.push(Enc::ch(b' '));
                                self.text.push(c);
                            } else {
                                self.text.push(Enc::ch(b'\n'));
                                self.text.push(c);
                            }
                            self.leading_newlines = 0;
                        }
                        _ => {
                            self.text.reserve(self.leading_newlines);
                            // PERF(port): was ensureUnusedCapacity + assume_capacity
                            for _ in 0..self.leading_newlines - 1 {
                                self.text.push(Enc::ch(b'\n'));
                            }
                            self.text.push(c);
                            self.leading_newlines = 0;
                        }
                    }
                } else {
                    self.text.reserve(self.leading_newlines + 1);
                    // PERF(port): was ensureUnusedCapacity + assume_capacity
                    for _ in 0..self.leading_newlines {
                        self.text.push(Enc::ch(b'\n'));
                    }
                    self.text.push(c);
                    self.leading_newlines = 0;
                }
                Ok(())
            }
        }

        let mut ctx = LiteralScalarCtx::<Enc> {
            chomp,
            text: Vec::new(),
            folded,
            start,
            line,
            leading_newlines: 0,
            content_indent: Indent::NONE,
            previous_indent: Indent::NONE,
            max_leading_indent: Indent::NONE,
        };

        // Phase 1: find content_indent and first non-ws char
        // PORT NOTE: labeled-switch loop
        let (content_indent, first): (Indent, u32) = 'phase1: loop {
            let __c = Enc::wide(self.next());
            match __c {
                0 => {
                    return Ok(Token::scalar(ScalarInit {
                        start,
                        indent: self.line_indent,
                        line,
                        resolved: TokenScalar {
                            data: NodeScalar::String(YamlString::List(Vec::new())),
                            multiline: true,
                        },
                    }));
                }
                0x0D => {
                    if Enc::wide(self.peek(1)) == 0x0A {
                        self.inc(1);
                    }
                    // fallthrough to '\n' handling
                    self.newline();
                    self.inc(1);
                    if Enc::wide(self.next()) == 0x09 {
                        return Err(ParseError::UnexpectedCharacter);
                    }
                    ctx.leading_newlines += 1;
                    continue;
                }
                0x0A => {
                    self.newline();
                    self.inc(1);
                    if Enc::wide(self.next()) == 0x09 {
                        return Err(ParseError::UnexpectedCharacter);
                    }
                    ctx.leading_newlines += 1;
                    continue;
                }
                0x20 => {
                    let mut indent = Indent::from(1);
                    self.inc(1);
                    while Enc::wide(self.next()) == 0x20 {
                        indent.inc(1);
                        self.inc(1);
                    }
                    if ctx.max_leading_indent.is_less_than(indent) {
                        ctx.max_leading_indent = indent;
                    }
                    self.line_indent = indent;
                    continue;
                }
                c => break 'phase1 (self.line_indent, c),
            }
        };
        ctx.content_indent = content_indent;
        ctx.previous_indent = ctx.content_indent;

        // Phase 2: scan body
        // PORT NOTE: labeled-switch loop with nested `newlines:` switch
        let mut __c = first;
        loop {
            match __c {
                0 => return Ok(ctx.done(true)?),
                0x0D => {
                    if Enc::wide(self.peek(1)) == 0x0A {
                        self.inc(1);
                    }
                    __c = 0x0A;
                    continue;
                }
                0x0A => {
                    ctx.leading_newlines += 1;
                    self.newline();
                    self.inc(1);
                    // nested newlines: switch
                    loop {
                        let nc = Enc::wide(self.next());
                        match nc {
                            0x0D => {
                                if Enc::wide(self.peek(1)) == 0x0A {
                                    self.inc(1);
                                }
                                // fall into '\n'
                                ctx.leading_newlines += 1;
                                self.newline();
                                self.inc(1);
                                if Enc::wide(self.next()) == 0x09 {
                                    return Err(ParseError::UnexpectedCharacter);
                                }
                                continue;
                            }
                            0x0A => {
                                ctx.leading_newlines += 1;
                                self.newline();
                                self.inc(1);
                                if Enc::wide(self.next()) == 0x09 {
                                    return Err(ParseError::UnexpectedCharacter);
                                }
                                continue;
                            }
                            0x20 => {
                                let mut indent = Indent::from(0);
                                while Enc::wide(self.next()) == 0x20 {
                                    indent.inc(1);
                                    if ctx.content_indent.is_less_than(indent) {
                                        if folded {
                                            match ctx.leading_newlines {
                                                0 => ctx.text.push(Enc::ch(b' ')),
                                                _ => {
                                                    ctx.text.reserve(ctx.leading_newlines + 1);
                                                    // PERF(port): was assume_capacity
                                                    for _ in 0..ctx.leading_newlines {
                                                        ctx.text.push(Enc::ch(b'\n'));
                                                    }
                                                    ctx.text.push(Enc::ch(b' '));
                                                    ctx.leading_newlines = 0;
                                                }
                                            }
                                        } else {
                                            ctx.text.reserve(ctx.leading_newlines + 1);
                                            // PERF(port): was assume_capacity
                                            for _ in 0..ctx.leading_newlines {
                                                ctx.text.push(Enc::ch(b'\n'));
                                            }
                                            ctx.leading_newlines = 0;
                                            ctx.text.push(Enc::ch(b' '));
                                        }
                                    }
                                    self.inc(1);
                                }
                                if ctx.content_indent.is_less_than(indent) {
                                    ctx.previous_indent = self.line_indent;
                                }
                                self.line_indent = indent;
                                __c = Enc::wide(self.next());
                                break;
                            }
                            other => {
                                __c = other;
                                break;
                            }
                        }
                    }
                    continue;
                }
                0x2D /* '-' */ => {
                    if self.line_indent == Indent::NONE
                        && self.remain_starts_with(Enc::literal(b"---"))
                        && self.is_any_or_eof_at(Enc::literal(b" \t\n\r"), 3)
                    {
                        return Ok(ctx.done(false)?);
                    }
                    if let Some(block_indent) = self.block_indents.get() {
                        if self.line_indent.is_less_than_or_equal(block_indent) {
                            return Ok(ctx.done(false)?);
                        }
                    } else if self.line_indent.is_less_than(ctx.content_indent) {
                        return Ok(ctx.done(false)?);
                    }
                    ctx.append(Enc::ch(b'-'))?;
                    self.inc(1);
                    __c = Enc::wide(self.next());
                    continue;
                }
                0x2E /* '.' */ => {
                    if self.line_indent == Indent::NONE
                        && self.remain_starts_with(Enc::literal(b"..."))
                        && self.is_any_or_eof_at(Enc::literal(b" \t\n\r"), 3)
                    {
                        return Ok(ctx.done(false)?);
                    }
                    if let Some(block_indent) = self.block_indents.get() {
                        if self.line_indent.is_less_than_or_equal(block_indent) {
                            return Ok(ctx.done(false)?);
                        }
                    } else if self.line_indent.is_less_than(ctx.content_indent) {
                        return Ok(ctx.done(false)?);
                    }
                    ctx.append(Enc::ch(b'.'))?;
                    self.inc(1);
                    __c = Enc::wide(self.next());
                    continue;
                }
                c => {
                    if let Some(block_indent) = self.block_indents.get() {
                        if self.line_indent.is_less_than_or_equal(block_indent) {
                            return Ok(ctx.done(false)?);
                        }
                    } else if self.line_indent.is_less_than(ctx.content_indent) {
                        return Ok(ctx.done(false)?);
                    }
                    // TODO(port): need Enc::Unit from u32; assuming Enc::Unit: From<u8> for ASCII range only.
                    // For non-ASCII units we need to read self.next() directly.
                    let unit = self.next();
                    let _ = c;
                    ctx.append(unit)?;
                    self.inc(1);
                    __c = Enc::wide(self.next());
                    continue;
                }
            }
        }
    }

    fn scan_literal_scalar(&mut self) -> Result<Token<Enc>, ParseError> {
        // defer self.whitespace_buf.clearRetainingCapacity();
        let start = self.pos;
        let line = self.line;

        let (indent_indicator, chomp) = self.scan_block_header()?;
        let _ = indent_indicator;

        let result = self.scan_auto_indented_literal_scalar(chomp, false, start, line);
        self.whitespace_buf.clear();
        result
    }

    fn scan_folded_scalar(&mut self) -> Result<Token<Enc>, ParseError> {
        let start = self.pos;
        let line = self.line;

        let (indent_indicator, chomp) = self.scan_block_header()?;
        let _ = indent_indicator;

        self.scan_auto_indented_literal_scalar(chomp, true, start, line)
    }

    fn scan_single_quoted_scalar(&mut self) -> Result<Token<Enc>, ParseError> {
        let start = self.pos;
        let scalar_line = self.line;
        let scalar_indent = self.line_indent;

        let mut text: Vec<Enc::Unit> = Vec::new();
        let mut nl = false;

        // PORT NOTE: labeled-switch loop
        loop {
            let c = Enc::wide(self.next());
            match c {
                0 => return Err(ParseError::UnexpectedCharacter),
                0x2E /* '.' */ => {
                    if nl && self.line_indent == Indent::NONE
                        && self.remain_starts_with(Enc::literal(b"..."))
                        && self.is_s_white_or_b_char_at(3)
                    {
                        return Err(ParseError::UnexpectedDocumentEnd);
                    }
                    nl = false;
                    text.push(Enc::ch(b'.'));
                    self.inc(1);
                }
                0x2D /* '-' */ => {
                    if nl && self.line_indent == Indent::NONE
                        && self.remain_starts_with(Enc::literal(b"---"))
                        && self.is_s_white_or_b_char_at(3)
                    {
                        return Err(ParseError::UnexpectedDocumentStart);
                    }
                    nl = false;
                    text.push(Enc::ch(b'-'));
                    self.inc(1);
                }
                0x0D | 0x0A => {
                    nl = true;
                    self.newline();
                    self.inc(1);
                    match self.fold_lines() {
                        0 => text.push(Enc::ch(b' ')),
                        lines => {
                            for _ in 0..lines {
                                text.push(Enc::ch(b'\n'));
                            }
                        }
                    }
                    if let Some(block_indent) = self.block_indents.get() {
                        if self.line_indent.is_less_than_or_equal(block_indent) {
                            return Err(ParseError::UnexpectedCharacter);
                        }
                    }
                }
                0x20 | 0x09 => {
                    nl = false;
                    let off = self.pos;
                    self.inc(1);
                    self.skip_s_white();
                    if !self.is_b_char() {
                        text.extend_from_slice(self.slice(off, self.pos));
                    }
                }
                0x27 /* '\'' */ => {
                    nl = false;
                    self.inc(1);
                    if Enc::wide(self.next()) == 0x27 {
                        text.push(Enc::ch(b'\''));
                        self.inc(1);
                        continue;
                    }
                    return Ok(Token::scalar(ScalarInit {
                        start,
                        indent: scalar_indent,
                        line: scalar_line,
                        resolved: TokenScalar {
                            // TODO: wrong! (matches Zig comment)
                            multiline: self.line != scalar_line,
                            data: NodeScalar::String(YamlString::List(text)),
                        },
                    }));
                }
                _ => {
                    nl = false;
                    text.push(self.next());
                    self.inc(1);
                }
            }
        }
    }

    fn scan_double_quoted_scalar(&mut self) -> Result<Token<Enc>, ParseError> {
        let start = self.pos;
        let scalar_line = self.line;
        let scalar_indent = self.line_indent;
        let mut text: Vec<Enc::Unit> = Vec::new();

        let mut nl = false;

        // PORT NOTE: labeled-switch loop
        loop {
            let c = Enc::wide(self.next());
            match c {
                0 => return Err(ParseError::UnexpectedCharacter),
                0x2E /* '.' */ => {
                    if nl && self.line_indent == Indent::NONE
                        && self.remain_starts_with(Enc::literal(b"..."))
                        && self.is_s_white_or_b_char_at(3)
                    {
                        return Err(ParseError::UnexpectedDocumentEnd);
                    }
                    nl = false;
                    text.push(Enc::ch(b'.'));
                    self.inc(1);
                }
                0x2D /* '-' */ => {
                    if nl && self.line_indent == Indent::NONE
                        && self.remain_starts_with(Enc::literal(b"---"))
                        && self.is_s_white_or_b_char_at(3)
                    {
                        return Err(ParseError::UnexpectedDocumentStart);
                    }
                    nl = false;
                    text.push(Enc::ch(b'-'));
                    self.inc(1);
                }
                0x0D | 0x0A => {
                    self.newline();
                    self.inc(1);
                    match self.fold_lines() {
                        0 => text.push(Enc::ch(b' ')),
                        lines => {
                            for _ in 0..lines {
                                text.push(Enc::ch(b'\n'));
                            }
                        }
                    }
                    if let Some(block_indent) = self.block_indents.get() {
                        if self.line_indent.is_less_than_or_equal(block_indent) {
                            return Err(ParseError::UnexpectedCharacter);
                        }
                    }
                    nl = true;
                }
                0x20 | 0x09 => {
                    nl = false;
                    let off = self.pos;
                    self.inc(1);
                    self.skip_s_white();
                    if !self.is_b_char() {
                        text.extend_from_slice(self.slice(off, self.pos));
                    }
                }
                0x22 /* '"' */ => {
                    nl = false;
                    self.inc(1);
                    return Ok(Token::scalar(ScalarInit {
                        start,
                        indent: scalar_indent,
                        line: scalar_line,
                        resolved: TokenScalar {
                            // TODO: wrong! (matches Zig comment)
                            multiline: self.line != scalar_line,
                            data: NodeScalar::String(YamlString::List(text)),
                        },
                    }));
                }
                0x5C /* '\\' */ => {
                    nl = false;
                    self.inc(1);
                    match Enc::wide(self.next()) {
                        0x0D | 0x0A => {
                            self.newline();
                            self.inc(1);
                            let lines = self.fold_lines();
                            if let Some(block_indent) = self.block_indents.get() {
                                if self.line_indent.is_less_than_or_equal(block_indent) {
                                    return Err(ParseError::UnexpectedCharacter);
                                }
                            }
                            for _ in 0..lines {
                                text.push(Enc::ch(b'\n'));
                            }
                            self.skip_s_white();
                            continue;
                        }
                        // escaped whitespace
                        0x20 => text.push(Enc::ch(b' ')),
                        0x09 => text.push(Enc::ch(b'\t')),

                        0x30 /* '0' */ => text.push(Enc::NUL),
                        0x61 /* 'a' */ => text.push(Enc::ch(0x07)),
                        0x62 /* 'b' */ => text.push(Enc::ch(0x08)),
                        0x74 /* 't' */ => text.push(Enc::ch(b'\t')),
                        0x6E /* 'n' */ => text.push(Enc::ch(b'\n')),
                        0x76 /* 'v' */ => text.push(Enc::ch(0x0B)),
                        0x66 /* 'f' */ => text.push(Enc::ch(0x0C)),
                        0x72 /* 'r' */ => text.push(Enc::ch(0x0D)),
                        0x65 /* 'e' */ => text.push(Enc::ch(0x1B)),
                        0x22 /* '"' */ => text.push(Enc::ch(b'"')),
                        0x2F /* '/' */ => text.push(Enc::ch(b'/')),
                        0x5C /* '\\' */ => text.push(Enc::ch(b'\\')),

                        0x4E /* 'N' */ => match Enc::KIND {
                            EncodingKind::Utf8 => text.extend_from_slice(Enc::literal(&[0xC2, 0x85])),
                            EncodingKind::Utf16 => {
                                // TODO(port): need to push u16 0x0085 — Enc::ch only takes u8.
                                // Phase B: add Enc::unit_from_u16.
                                return Err(ParseError::UnexpectedCharacter);
                            }
                            EncodingKind::Latin1 => return Err(ParseError::UnexpectedCharacter),
                        },
                        0x5F /* '_' */ => match Enc::KIND {
                            EncodingKind::Utf8 => text.extend_from_slice(Enc::literal(&[0xC2, 0xA0])),
                            EncodingKind::Utf16 => return Err(ParseError::UnexpectedCharacter), // TODO(port)
                            EncodingKind::Latin1 => return Err(ParseError::UnexpectedCharacter),
                        },
                        0x4C /* 'L' */ => match Enc::KIND {
                            EncodingKind::Utf8 => text.extend_from_slice(Enc::literal(&[0xE2, 0x80, 0xA8])),
                            EncodingKind::Utf16 => return Err(ParseError::UnexpectedCharacter), // TODO(port)
                            EncodingKind::Latin1 => return Err(ParseError::UnexpectedCharacter),
                        },
                        0x50 /* 'P' */ => match Enc::KIND {
                            EncodingKind::Utf8 => text.extend_from_slice(Enc::literal(&[0xE2, 0x80, 0xA9])),
                            EncodingKind::Utf16 => return Err(ParseError::UnexpectedCharacter), // TODO(port)
                            EncodingKind::Latin1 => return Err(ParseError::UnexpectedCharacter),
                        },

                        0x78 /* 'x' */ => self.decode_hex_code_point::<{ Escape::X }>(&mut text)?,
                        0x75 /* 'u' */ => self.decode_hex_code_point::<{ Escape::LowerU }>(&mut text)?,
                        0x55 /* 'U' */ => self.decode_hex_code_point::<{ Escape::UpperU }>(&mut text)?,

                        _ => return Err(ParseError::UnexpectedCharacter),
                    }
                    self.inc(1);
                }
                _ => {
                    nl = false;
                    text.push(self.next());
                    self.inc(1);
                }
            }
        }
    }

    // TODO: should this append replacement characters instead of erroring?
    fn decode_hex_code_point<const ESCAPE: Escape>(
        &mut self,
        text: &mut Vec<Enc::Unit>,
    ) -> Result<(), ParseError> {
        let mut value: u32 = 0;
        for _ in 0..(ESCAPE as u8) {
            self.inc(1);
            let digit = Enc::wide(self.next());
            let num: u8 = match digit {
                0x30..=0x39 => u8::try_from(digit - 0x30).unwrap(),
                0x61..=0x66 => u8::try_from(digit - 0x61 + 10).unwrap(),
                0x41..=0x46 => u8::try_from(digit - 0x41 + 10).unwrap(),
                _ => return Err(ParseError::UnexpectedCharacter),
            };
            value = value * 16 + num as u32;
        }

        if value > 0x10_FFFF {
            return Err(ParseError::UnexpectedCharacter);
        }
        let cp = value;

        match Enc::KIND {
            EncodingKind::Utf8 => {
                let ch = char::from_u32(cp).ok_or(ParseError::UnexpectedCharacter)?;
                let mut buf = [0u8; 4];
                let s = ch.encode_utf8(&mut buf);
                // TODO(port): need to push &[u8] into Vec<Enc::Unit>; Enc::Unit==u8 here.
                for b in s.bytes() {
                    text.push(Enc::ch(b));
                }
            }
            EncodingKind::Utf16 => {
                // Zig: std.unicode.utf16CodepointSequenceLength + manual surrogate split.
                let len: u8 = if cp < 0x10000 { 1 } else { 2 };
                // TODO(port): need Enc::Unit==u16 push helper; Enc::ch only takes u8.
                // Phase B: add `Enc::ch16(u16) -> Self::Unit` or specialize per encoding.
                match len {
                    1 => {
                        let unit = u16::try_from(cp).unwrap();
                        let _ = unit;
                        // text.push(Enc::ch16(unit));
                    }
                    2 => {
                        let high = 0xD800u16 + u16::try_from((cp - 0x10000) >> 10).unwrap();
                        let low = 0xDC00u16 + u16::try_from((cp - 0x10000) & 0x3FF).unwrap();
                        let _ = (high, low);
                        // text.push(Enc::ch16(high));
                        // text.push(Enc::ch16(low));
                    }
                    _ => unreachable!(),
                }
                let _ = text;
            }
            EncodingKind::Latin1 => {
                if cp > 0xFF {
                    return Err(ParseError::UnexpectedCharacter);
                }
                text.push(Enc::ch(u8::try_from(cp).unwrap()));
            }
        }
        Ok(())
    }
}

// ───────────────────────────────────────────────────────────────────────────
// Parser methods (scan + helpers)
// ───────────────────────────────────────────────────────────────────────────

impl<'i, Enc: Encoding> Parser<'i, Enc> {
    // c-ns-tag-property
    fn scan_tag_property(&mut self) -> Result<Token<Enc>, ParseError> {
        let start = self.pos;

        // already at '!'
        self.inc(1);

        match Enc::wide(self.next()) {
            0 | 0x20 | 0x09 | 0x0A | 0x0D => {
                // c-non-specific-tag / primary tag handle
                return Ok(Token::tag(TagInit {
                    start,
                    indent: self.line_indent,
                    line: self.line,
                    tag: NodeTag::NonSpecific,
                }));
            }
            0x3C /* '<' */ => {
                // c-verbatim-tag
                self.inc(1);

                let prefix = 'prefix: {
                    if Enc::wide(self.next()) == 0x21 /* '!' */ {
                        self.inc(1);
                        let range = self.string_range();
                        self.skip_ns_uri_chars();
                        break 'prefix range.end();
                    }
                    if let Some(len) = self.is_ns_tag_char() {
                        let range = self.string_range();
                        self.inc(len as usize);
                        self.skip_ns_uri_chars();
                        break 'prefix range.end();
                    }
                    return Err(ParseError::UnexpectedCharacter);
                };

                self.try_skip_char(Enc::ch(b'>'))?;

                return Ok(Token::tag(TagInit {
                    start,
                    indent: self.line_indent,
                    line: self.line,
                    tag: NodeTag::Verbatim(prefix),
                }));
            }
            0x21 /* '!' */ => {
                // c-ns-shorthand-tag / secondary tag handle
                self.inc(1);
                let range = self.string_range();
                self.try_skip_ns_tag_chars()?;

                // s-separate
                match Enc::wide(self.next()) {
                    0 | 0x20 | 0x09 | 0x0D | 0x0A => {}
                    0x2C | 0x5B | 0x5D | 0x7B | 0x7D => match self.context.get() {
                        Context::BlockOut | Context::BlockIn => {
                            return Err(ParseError::UnexpectedCharacter);
                        }
                        Context::FlowIn | Context::FlowKey => {}
                    },
                    _ => return Err(ParseError::UnexpectedCharacter),
                }

                let shorthand = range.end();
                let tag = self.shorthand_to_tag(shorthand);

                return Ok(Token::tag(TagInit {
                    start,
                    indent: self.line_indent,
                    line: self.line,
                    tag,
                }));
            }
            _ => {
                // c-ns-shorthand-tag / named tag handle
                let mut range = self.string_range();
                let off = range.off;
                self.try_skip_ns_word_chars()?;
                let mut handle_or_shorthand = range.end();

                if Enc::wide(self.next()) == 0x21 /* '!' */ {
                    self.inc(1);
                    if !self.tag_handles.contains(handle_or_shorthand.slice(self.input)) {
                        self.pos = off;
                        return Err(ParseError::UnresolvedTagHandle);
                    }

                    range = self.string_range();
                    self.try_skip_ns_tag_chars()?;
                    let shorthand = range.end();

                    return Ok(Token::tag(TagInit {
                        start,
                        indent: self.line_indent,
                        line: self.line,
                        tag: NodeTag::Unknown(shorthand),
                    }));
                }

                // primary
                self.skip_ns_tag_chars();
                handle_or_shorthand = StringRange { off, end: self.pos };

                let tag = self.shorthand_to_tag(handle_or_shorthand);

                Ok(Token::tag(TagInit {
                    start,
                    indent: self.line_indent,
                    line: self.line,
                    tag,
                }))
            }
        }
    }

    fn shorthand_to_tag(&self, shorthand: StringRange) -> NodeTag {
        let s = shorthand.slice(self.input);
        // TODO(port): comparing &[Enc::Unit] to ASCII literals; assumes u8-compatible.
        if eq_ascii::<Enc>(s, b"bool") { return NodeTag::Bool; }
        if eq_ascii::<Enc>(s, b"int") { return NodeTag::Int; }
        if eq_ascii::<Enc>(s, b"float") { return NodeTag::Float; }
        if eq_ascii::<Enc>(s, b"null") { return NodeTag::Null; }
        if eq_ascii::<Enc>(s, b"str") { return NodeTag::Str; }
        NodeTag::Unknown(shorthand)
    }

    // ── scan ────────────────────────────────────────────────────────────────

    fn scan(&mut self, opts: ScanOptions) -> Result<(), ParseError> {
        // ScanCtx state inlined
        let mut count_indentation = opts.first_scan || opts.additional_parent_indent.is_some();
        let mut additional_parent_indent = opts.additional_parent_indent;

        let previous_token_line = self.token.line;

        // PORT NOTE: labeled-switch loop with `inline` whitespace dispatch.
        // We loop on `Enc::wide(self.next())` and break with the resulting token.
        let token: Token<Enc> = 'next: loop {
            let c = Enc::wide(self.next());
            match c {
                0 => {
                    let start = self.pos;
                    break 'next Token::eof(TokenInit { start, indent: self.line_indent, line: self.line });
                }
                0x2D /* '-' */ => {
                    let start = self.pos;
                    if self.line_indent == Indent::NONE
                        && self.remain_starts_with(Enc::literal(b"---"))
                        && self.is_s_white_or_b_char_or_eof_at(3)
                    {
                        self.inc(3);
                        break 'next Token::document_start(TokenInit { start, indent: self.line_indent, line: self.line });
                    }

                    match Enc::wide(self.peek(1)) {
                        0 | 0x0A | 0x0D | 0x20 | 0x09 => {
                            self.inc(1);
                            match self.context.get() {
                                Context::BlockOut | Context::BlockIn => {}
                                Context::FlowIn | Context::FlowKey => {
                                    self.token.start = start;
                                    return Err(Self::unexpected_token());
                                }
                            }
                            break 'next Token::sequence_entry(TokenInit { start, indent: self.line_indent, line: self.line });
                        }
                        0x2C | 0x5D | 0x5B | 0x7D | 0x7B => match self.context.get() {
                            Context::FlowIn | Context::FlowKey => {
                                self.inc(1);
                                self.token = Token::sequence_entry(TokenInit { start, indent: self.line_indent, line: self.line });
                                return Err(Self::unexpected_token());
                            }
                            Context::BlockIn | Context::BlockOut => {
                                // scanPlainScalar
                            }
                        },
                        _ => {
                            // scanPlainScalar
                        }
                    }
                    break 'next self.scan_plain_scalar(opts)?;
                }
                0x2E /* '.' */ => {
                    let start = self.pos;
                    if self.line_indent == Indent::NONE
                        && self.remain_starts_with(Enc::literal(b"..."))
                        && self.is_s_white_or_b_char_or_eof_at(3)
                    {
                        self.inc(3);
                        break 'next Token::document_end(TokenInit { start, indent: self.line_indent, line: self.line });
                    }
                    break 'next self.scan_plain_scalar(opts)?;
                }
                0x3F /* '?' */ => {
                    let start = self.pos;
                    match Enc::wide(self.peek(1)) {
                        0 | 0x20 | 0x09 | 0x0A | 0x0D => {
                            self.inc(1);
                            break 'next Token::mapping_key(TokenInit { start, indent: self.line_indent, line: self.line });
                        }
                        0x2C | 0x5D | 0x5B | 0x7D | 0x7B => match self.context.get() {
                            Context::BlockIn | Context::BlockOut => {}
                            Context::FlowIn | Context::FlowKey => {
                                self.inc(1);
                                break 'next Token::mapping_key(TokenInit { start, indent: self.line_indent, line: self.line });
                            }
                        },
                        _ => {}
                    }
                    break 'next self.scan_plain_scalar(opts)?;
                }
                0x3A /* ':' */ => {
                    let start = self.pos;
                    match Enc::wide(self.peek(1)) {
                        0 | 0x20 | 0x09 | 0x0A | 0x0D => {
                            self.inc(1);
                            break 'next Token::mapping_value(TokenInit { start, indent: self.line_indent, line: self.line });
                        }
                        0x2C | 0x5D | 0x5B | 0x7D | 0x7B => match self.context.get() {
                            Context::BlockIn | Context::BlockOut => {}
                            Context::FlowIn | Context::FlowKey => {
                                self.inc(1);
                                break 'next Token::mapping_value(TokenInit { start, indent: self.line_indent, line: self.line });
                            }
                        },
                        _ => match self.context.get() {
                            Context::BlockIn | Context::BlockOut | Context::FlowIn => {}
                            Context::FlowKey => {
                                self.inc(1);
                                break 'next Token::mapping_value(TokenInit { start, indent: self.line_indent, line: self.line });
                            }
                        },
                    }
                    break 'next self.scan_plain_scalar(opts)?;
                }
                0x2C /* ',' */ => {
                    let start = self.pos;
                    match self.context.get() {
                        Context::FlowIn | Context::FlowKey => {
                            self.inc(1);
                            break 'next Token::collect_entry(TokenInit { start, indent: self.line_indent, line: self.line });
                        }
                        Context::BlockIn | Context::BlockOut => {}
                    }
                    break 'next self.scan_plain_scalar(opts)?;
                }
                0x5B /* '[' */ => {
                    let start = self.pos;
                    self.inc(1);
                    break 'next Token::sequence_start(TokenInit { start, indent: self.line_indent, line: self.line });
                }
                0x5D /* ']' */ => {
                    let start = self.pos;
                    self.inc(1);
                    break 'next Token::sequence_end(TokenInit { start, indent: self.line_indent, line: self.line });
                }
                0x7B /* '{' */ => {
                    let start = self.pos;
                    self.inc(1);
                    break 'next Token::mapping_start(TokenInit { start, indent: self.line_indent, line: self.line });
                }
                0x7D /* '}' */ => {
                    let start = self.pos;
                    self.inc(1);
                    break 'next Token::mapping_end(TokenInit { start, indent: self.line_indent, line: self.line });
                }
                0x23 /* '#' */ => {
                    let start = self.pos;
                    let prev = if start == Pos::ZERO { 0 } else { Enc::wide(self.input[start.cast() - 1]) };
                    match prev {
                        0 | 0x20 | 0x09 | 0x0A | 0x0D => {}
                        _ => {
                            // TODO: prove this is unreachable
                            return Err(ParseError::UnexpectedCharacter);
                        }
                    }
                    self.inc(1);
                    while !self.is_b_char_or_eof() {
                        self.inc(1);
                    }
                    continue;
                }
                0x26 /* '&' */ => {
                    let start = self.pos;
                    self.inc(1);
                    let range = self.string_range();
                    self.try_skip_ns_anchor_chars()?;
                    let anchor = Token::anchor(AnchorInit {
                        start,
                        indent: self.line_indent,
                        line: self.line,
                        name: range.end(),
                    });
                    match Enc::wide(self.next()) {
                        0 | 0x20 | 0x09 | 0x0A | 0x0D => break 'next anchor,
                        0x2C | 0x5D | 0x5B | 0x7D | 0x7B => match self.context.get() {
                            Context::BlockIn | Context::BlockOut => {}
                            Context::FlowKey | Context::FlowIn => break 'next anchor,
                        },
                        _ => {}
                    }
                    return Err(ParseError::UnexpectedCharacter);
                }
                0x2A /* '*' */ => {
                    let start = self.pos;
                    self.inc(1);
                    let range = self.string_range();
                    self.try_skip_ns_anchor_chars()?;
                    let alias = Token::alias(AliasInit {
                        start,
                        indent: self.line_indent,
                        line: self.line,
                        name: range.end(),
                    });
                    match Enc::wide(self.next()) {
                        0 | 0x20 | 0x09 | 0x0A | 0x0D => break 'next alias,
                        0x2C | 0x5D | 0x5B | 0x7D | 0x7B => match self.context.get() {
                            Context::BlockIn | Context::BlockOut => {}
                            Context::FlowKey | Context::FlowIn => break 'next alias,
                        },
                        _ => {}
                    }
                    return Err(ParseError::UnexpectedCharacter);
                }
                0x21 /* '!' */ => {
                    break 'next self.scan_tag_property()?;
                }
                0x7C /* '|' */ => {
                    let start = self.pos;
                    match self.context.get() {
                        Context::BlockOut | Context::BlockIn => {
                            self.inc(1);
                            break 'next self.scan_literal_scalar()?;
                        }
                        Context::FlowIn | Context::FlowKey => {}
                    }
                    self.token.start = start;
                    return Err(Self::unexpected_token());
                }
                0x3E /* '>' */ => {
                    let start = self.pos;
                    match self.context.get() {
                        Context::BlockOut | Context::BlockIn => {
                            self.inc(1);
                            break 'next self.scan_folded_scalar()?;
                        }
                        Context::FlowIn | Context::FlowKey => {}
                    }
                    self.token.start = start;
                    return Err(Self::unexpected_token());
                }
                0x27 /* '\'' */ => {
                    self.inc(1);
                    break 'next self.scan_single_quoted_scalar()?;
                }
                0x22 /* '"' */ => {
                    self.inc(1);
                    break 'next self.scan_double_quoted_scalar()?;
                }
                0x25 /* '%' */ => {
                    let start = self.pos;
                    self.inc(1);
                    break 'next Token::directive(TokenInit { start, indent: self.line_indent, line: self.line });
                }
                0x40 /* '@' */ | 0x60 /* '`' */ => {
                    let start = self.pos;
                    self.inc(1);
                    self.token = Token::reserved(TokenInit { start, indent: self.line_indent, line: self.line });
                    return Err(Self::unexpected_token());
                }
                // PORT NOTE: ScanCtx.scanWhitespace inlined.
                // whitespace — Zig used `inline '\r','\n',' ','\t' => |ws| ctx.scanWhitespace(ws)`
                0x0D /* '\r' */ => {
                    if Enc::wide(self.peek(1)) == 0x0A {
                        self.inc(1);
                    }
                    // fallthrough to '\n'
                    count_indentation = true;
                    additional_parent_indent = None;
                    self.newline();
                    self.inc(1);
                    continue;
                }
                0x0A /* '\n' */ => {
                    count_indentation = true;
                    additional_parent_indent = None;
                    self.newline();
                    self.inc(1);
                    continue;
                }
                0x20 /* ' ' */ => {
                    let mut total: usize = 1;
                    self.inc(1);
                    while Enc::wide(self.next()) == 0x20 {
                        self.inc(1);
                        total += 1;
                    }
                    if count_indentation {
                        let parent_indent = additional_parent_indent.map(|a| a.cast()).unwrap_or(0);
                        self.line_indent = Indent::from(total + parent_indent);
                    }
                    count_indentation = false;
                    continue;
                }
                0x09 /* '\t' */ => {
                    if count_indentation && self.context.get() == Context::BlockIn {
                        return Err(ParseError::UnexpectedCharacter);
                    }
                    count_indentation = false;
                    self.inc(1);
                    continue;
                }
                _ => {
                    break 'next self.scan_plain_scalar(opts)?;
                }
            }
        };
        self.token = token;

        match self.context.get() {
            Context::BlockOut | Context::BlockIn => {}
            Context::FlowIn | Context::FlowKey => {
                if let Some(block_indent) = self.block_indents.get() {
                    if !opts.outside_context
                        && self.token.line != previous_token_line
                        && self.token.indent.is_less_than_or_equal(block_indent)
                    {
                        return Err(Self::unexpected_token());
                    }
                }
            }
        }

        Ok(())
    }

    // ── character predicates / skip helpers ─────────────────────────────────

    fn is_char(&self, ch: Enc::Unit) -> bool {
        let pos = self.pos;
        if pos.is_less_than(self.input.len()) {
            return self.input[pos.cast()] == ch;
        }
        false
    }

    fn try_skip_char(&mut self, ch: Enc::Unit) -> Result<(), ParseError> {
        if !self.is_char(ch) {
            return Err(ParseError::UnexpectedCharacter);
        }
        self.inc(1);
        Ok(())
    }

    fn is_ns_word_char(&self) -> bool {
        let pos = self.pos;
        if pos.is_less_than(self.input.len()) {
            return chars::is_ns_word_char::<Enc>(self.input[pos.cast()]);
        }
        false
    }

    /// ns-char
    fn is_ns_char(&self) -> bool {
        let pos = self.pos;
        if pos.is_less_than(self.input.len()) {
            return chars::is_ns_char::<Enc>(self.input[pos.cast()]);
        }
        false
    }

    fn skip_ns_chars(&mut self) {
        while self.is_ns_char() {
            self.inc(1);
        }
    }

    fn try_skip_ns_chars(&mut self) -> Result<(), ParseError> {
        if !self.is_ns_char() {
            return Err(ParseError::UnexpectedCharacter);
        }
        self.skip_ns_chars();
        Ok(())
    }

    fn is_ns_tag_char(&self) -> Option<u8> {
        chars::is_ns_tag_char::<Enc>(self.remain())
    }

    fn skip_ns_tag_chars(&mut self) {
        while let Some(len) = self.is_ns_tag_char() {
            self.inc(len as usize);
        }
    }

    fn try_skip_ns_tag_chars(&mut self) -> Result<(), ParseError> {
        let first_len = self.is_ns_tag_char().ok_or(ParseError::UnexpectedCharacter)?;
        self.inc(first_len as usize);
        while let Some(len) = self.is_ns_tag_char() {
            self.inc(len as usize);
        }
        Ok(())
    }

    fn is_ns_anchor_char(&self) -> bool {
        let pos = self.pos;
        if pos.is_less_than(self.input.len()) {
            return chars::is_ns_anchor_char::<Enc>(self.input[pos.cast()]);
        }
        false
    }

    fn try_skip_ns_anchor_chars(&mut self) -> Result<(), ParseError> {
        if !self.is_ns_anchor_char() {
            return Err(ParseError::UnexpectedCharacter);
        }
        self.inc(1);
        while self.is_ns_anchor_char() {
            self.inc(1);
        }
        Ok(())
    }

    /// s-l-comments
    /// positions `pos` on the next newline, or eof.
    fn try_skip_to_new_line(&mut self) -> Result<(), ParseError> {
        let mut whitespace = false;

        if self.is_s_white() {
            whitespace = true;
            self.skip_s_white();
        }

        if self.is_char(Enc::ch(b'#')) {
            if !whitespace {
                return Err(ParseError::UnexpectedCharacter);
            }
            self.inc(1);
            while !self.is_char(Enc::ch(b'\n')) && !self.is_char(Enc::ch(b'\r')) {
                self.inc(1);
            }
        }

        if self.pos.is_less_than(self.input.len())
            && !self.is_char(Enc::ch(b'\n'))
            && !self.is_char(Enc::ch(b'\r'))
        {
            return Err(ParseError::UnexpectedCharacter);
        }
        Ok(())
    }

    fn is_s_white_or_b_char_or_eof_at(&self, n: usize) -> bool {
        let pos = self.pos.add(n);
        if pos.is_less_than(self.input.len()) {
            let c = Enc::wide(self.input[pos.cast()]);
            return c == 0x20 || c == 0x09 || c == 0x0A || c == 0x0D;
        }
        true
    }

    fn is_s_white_or_b_char_at(&self, n: usize) -> bool {
        let pos = self.pos.add(n);
        if pos.is_less_than(self.input.len()) {
            let c = Enc::wide(self.input[pos.cast()]);
            return c == 0x20 || c == 0x09 || c == 0x0A || c == 0x0D;
        }
        false
    }

    fn is_any_at(&self, values: &[Enc::Unit], n: usize) -> bool {
        let pos = self.pos.add(n);
        if pos.is_less_than(self.input.len()) {
            return values.contains(&self.input[pos.cast()]);
        }
        false
    }

    fn is_any_or_eof_at(&self, values: &[Enc::Unit], n: usize) -> bool {
        let pos = self.pos.add(n);
        if pos.is_less_than(self.input.len()) {
            return values.contains(&self.input[pos.cast()]);
        }
        false
        // PORT NOTE: Zig returns `false` for EOF here despite the name (matches source).
    }

    fn is_eof(&self) -> bool {
        !self.pos.is_less_than(self.input.len())
    }

    fn is_eof_at(&self, n: usize) -> bool {
        !self.pos.add(n).is_less_than(self.input.len())
    }

    fn is_b_char(&self) -> bool {
        let pos = self.pos;
        if pos.is_less_than(self.input.len()) {
            return chars::is_b_char::<Enc>(self.input[pos.cast()]);
        }
        false
    }

    fn is_b_char_or_eof(&self) -> bool {
        let pos = self.pos;
        if pos.is_less_than(self.input.len()) {
            return chars::is_b_char::<Enc>(self.input[pos.cast()]);
        }
        true
    }

    fn is_s_white_or_b_char_or_eof(&self) -> bool {
        let pos = self.pos;
        if pos.is_less_than(self.input.len()) {
            let c = self.input[pos.cast()];
            return chars::is_s_white::<Enc>(c) || chars::is_b_char::<Enc>(c);
        }
        true
    }

    fn is_s_white(&self) -> bool {
        let pos = self.pos;
        if pos.is_less_than(self.input.len()) {
            return chars::is_s_white::<Enc>(self.input[pos.cast()]);
        }
        false
    }

    fn is_s_white_at(&self, n: usize) -> bool {
        let pos = self.pos.add(n);
        if pos.is_less_than(self.input.len()) {
            return chars::is_s_white::<Enc>(self.input[pos.cast()]);
        }
        false
    }

    fn skip_s_white(&mut self) {
        while self.is_s_white() {
            self.inc(1);
        }
    }

    fn try_skip_s_white(&mut self) -> Result<(), ParseError> {
        if !self.is_s_white() {
            return Err(ParseError::UnexpectedCharacter);
        }
        while self.is_s_white() {
            self.inc(1);
        }
        Ok(())
    }

    fn is_ns_hex_digit(&self) -> bool {
        let pos = self.pos;
        if pos.is_less_than(self.input.len()) {
            return chars::is_ns_hex_digit::<Enc>(self.input[pos.cast()]);
        }
        false
    }

    fn is_ns_dec_digit(&self) -> bool {
        let pos = self.pos;
        if pos.is_less_than(self.input.len()) {
            return chars::is_ns_dec_digit::<Enc>(self.input[pos.cast()]);
        }
        false
    }

    fn skip_ns_dec_digits(&mut self) {
        while self.is_ns_dec_digit() {
            self.inc(1);
        }
    }

    fn try_skip_ns_dec_digits(&mut self) -> Result<(), ParseError> {
        if !self.is_ns_dec_digit() {
            return Err(ParseError::UnexpectedCharacter);
        }
        self.skip_ns_dec_digits();
        Ok(())
    }

    fn skip_ns_word_chars(&mut self) {
        while self.is_ns_word_char() {
            self.inc(1);
        }
    }

    fn try_skip_ns_word_chars(&mut self) -> Result<(), ParseError> {
        if !self.is_ns_word_char() {
            return Err(ParseError::UnexpectedCharacter);
        }
        self.skip_ns_word_chars();
        Ok(())
    }

    fn is_ns_uri_char(&self) -> bool {
        chars::is_ns_uri_char::<Enc>(self.remain())
    }

    fn skip_ns_uri_chars(&mut self) {
        while self.is_ns_uri_char() {
            self.inc(1);
        }
    }

    fn try_skip_ns_uri_chars(&mut self) -> Result<(), ParseError> {
        if !self.is_ns_uri_char() {
            return Err(ParseError::UnexpectedCharacter);
        }
        self.skip_ns_uri_chars();
        Ok(())
    }

    fn string_range(&self) -> StringRangeStart<'_, Enc> {
        StringRangeStart { off: self.pos, parser: self }
    }

    fn string_builder(&mut self) -> StringBuilder<'_, Enc> {
        // TODO(port): borrowck — see StringBuilder note.
        StringBuilder {
            parser: self,
            str: YamlString::Range(StringRange { off: Pos::ZERO, end: Pos::ZERO }),
        }
    }

    // SAFETY: caller guarantees the returned builder does not outlive `*self`
    // and that no other &mut borrow of `*self` overlaps with builder method
    // calls that touch `whitespace_buf`/`input`. Used by scan_plain_scalar.
    unsafe fn string_builder_raw(&mut self) -> StringBuilder<'i, Enc> {
        // TODO(port): borrowck reshape — raw transmute of the &mut self lifetime
        // to 'i so the builder can be stored in ScalarResolverCtx alongside
        // `*mut Parser`. Phase B: change StringBuilder.parser to *mut Parser.
        StringBuilder {
            parser: unsafe { &mut *(self as *mut Parser<'i, Enc>) },
            str: YamlString::Range(StringRange { off: Pos::ZERO, end: Pos::ZERO }),
        }
    }
}

// ───────────────────────────────────────────────────────────────────────────
// helpers
// ───────────────────────────────────────────────────────────────────────────

fn eq_ascii<Enc: Encoding>(s: &[Enc::Unit], lit: &[u8]) -> bool {
    s.len() == lit.len() && s.iter().zip(lit).all(|(a, b)| Enc::wide(*a) == *b as u32)
}

// ───────────────────────────────────────────────────────────────────────────
// Omitted: large commented-out blocks from yaml.zig
//   - `Node` struct (lines 4758-4881) — commented out in source
//   - `Printer` fn   (lines 4927-5248) — commented out in source
// These were not active code; intentionally not ported.
// ───────────────────────────────────────────────────────────────────────────

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/interchange/yaml.zig (5743 lines)
//   confidence: medium
//   todos:      36
//   notes:      scan_plain_scalar ported 1:1 with ScalarResolverCtx using *mut Parser backref (Phase B: reshape borrowck); Encoding modeled as trait (assoc Unit type); defer context.unset/block_indents.pop translated as manual unwind (skipped on `?` paths — Phase B scopeguard); Utf16 literal()/ch16 push paths stubbed; parseUnsigned/parseDouble over &[Enc::Unit] stubbed; ast::ExprData variant names guessed.
// ──────────────────────────────────────────────────────────────────────────
