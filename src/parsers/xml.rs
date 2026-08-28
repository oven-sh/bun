//! XML 1.0 (Fifth Edition) parser — a non-validating processor that does not
//! read external entities (§5.1).
//!
//! Stage 1 ([`crate::xml_index`]) is the SIMD structural index of the
//! document: every `<`, `>`, `&`, `\r` and forbidden control character, plus
//! the whitespace, quotes and `=` inside tags. Stage 2 is this file: the
//! scanner walks the document from index entry to index entry — character
//! data, attribute values, comments, CDATA sections and processing
//! instructions are never visited byte by byte — and hands tokens to a
//! recursive-descent parser that checks the grammar and the well-formedness
//! constraints and writes the result as immutable rows on an `E::JsonTape`
//! (the same node representation the JSON parser produces).
//!
//! What stays byte-level: names (they have to be validated character by
//! character anyway), the document type declaration, and entity replacement
//! text, which is not part of the indexed buffer — an included entity (§4.4)
//! is pushed as a new input frame and scanned with the scalar classifier the
//! index is built from. Tokens carry the id of the frame they came from so
//! the parser can enforce that elements and declarations start and end in
//! the same entity.
//!
//! Two value shapes are built from the same token stream (see `Sink`): the
//! compact object (`{"@attr": .., child: .., "#text": ..}`) used by
//! `Bun.XML.parse` by default and by the module loader, and the ordered node
//! tree (`{name, attributes, children}`) for `{ compact: false }`.

use bun_alloc::Arena as Bump;
use bun_alloc::ArenaVec;
use bun_alloc::ArenaVecExt as _;
use bun_ast::expr::Data;
use bun_ast::{self as ast, E, Expr, Loc, Log, Source, StoreRef};
use bun_collections::HashMap;
use bun_core::{StackCheck, strings};
use bun_simdutf_sys::simdutf;

use crate::xml_index::StructuralIndex;
use crate::xml_index::byte_class::{CLASS_ALWAYS, CLASS_GT, CLASS_LT, CLASS_TAG, XML_BYTE_CLASS};

/// Scalar stop classes for the contexts that skip ahead (see `Scanner::next_stop`).
const STOP_CONTENT: u8 = CLASS_LT | CLASS_GT | CLASS_ALWAYS;
const STOP_ATT_VALUE: u8 = CLASS_LT | CLASS_GT | CLASS_ALWAYS | CLASS_TAG;
const STOP_SKIPPED: u8 = CLASS_ALWAYS;

// ── public entry point ──────────────────────────────────────────────────────

pub struct XML;

#[derive(Copy, Clone)]
pub struct Options {
    /// Build the compact object shape (`true`) or the node tree (`false`).
    pub compact: bool,
    pub encoding: InputEncoding,
}

/// What the bytes handed to the parser are, which decides how much of
/// §4.3.3 (BOM / UTF-16 detection, the `encoding` declaration) applies.
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum InputEncoding {
    /// Raw bytes (`XML.parse` of a Buffer/Blob): full detection, and a
    /// declaration that contradicts the bytes is an error.
    Bytes,
    /// A file read by the module loader: detection applies, but the file
    /// reader has already converted UTF-16LE-with-BOM to UTF-8 and stripped
    /// UTF-8 byte-order marks, so a UTF-16 declaration on UTF-8 input is
    /// taken as already satisfied rather than as a contradiction.
    File,
    /// Already-decoded text (a JS string, re-encoded as UTF-8): nothing to
    /// detect; the declaration is checked for syntax but not acted upon.
    Text,
    /// Already-decoded text, one byte per character (a Latin-1 JS string,
    /// borrowed as is). Strings in the result are Latin-1 too; a character
    /// reference above U+00FF cannot be represented and the parse stops
    /// with [`crate::Error::NeedsWiderEncoding`].
    Latin1,
}

impl XML {
    /// Parses `source` (UTF-8 bytes, or Latin-1 with `InputEncoding::Latin1`)
    /// into `E::ObjectJSON` / `E::ArrayJSON` rows whose tape (and every string
    /// that does not borrow the source) lives in `bump`.
    pub fn parse<'a>(
        source: &'a Source,
        log: &mut Log,
        bump: &'a Bump,
        options: Options,
    ) -> crate::Result<Expr> {
        let contents: &'a [u8] = source.contents.as_ref();
        Self::parse_units(source, contents, log, bump, options)
    }

    /// [`parse`](Self::parse) for a UTF-16 document (a 16-bit JS string):
    /// the strings in the result are UTF-16 as well. `source` is only what
    /// diagnostics are attributed to and what the length limit is checked on.
    pub fn parse_utf16<'a>(
        source: &'a Source,
        units: &'a [u16],
        log: &mut Log,
        bump: &'a Bump,
        mut options: Options,
    ) -> crate::Result<Expr> {
        options.encoding = InputEncoding::Text;
        Self::parse_units(source, units, log, bump, options)
    }

    fn parse_units<'a, U: Unit>(
        source: &'a Source,
        contents: &'a [U],
        log: &mut Log,
        bump: &'a Bump,
        options: Options,
    ) -> crate::Result<Expr> {
        source.check_parseable_len(log, "XML document")?;
        let mut tape = Tape::new_in(bump, core::mem::size_of_val(contents));
        // SAFETY: see `Tape::object_from`.
        unsafe { tape.tape.as_mut() }.encoding = if U::WIDE {
            E::StrEncoding::Utf16
        } else if options.encoding == InputEncoding::Latin1 {
            E::StrEncoding::Latin1
        } else {
            E::StrEncoding::Utf8
        };
        let result = if options.compact {
            Parser::new(source, contents, log, bump, options, CompactSink::new(tape))
                .parse_document()
        } else {
            Parser::new(source, contents, log, bump, options, NodeSink::new(tape)).parse_document()
        };
        match result {
            Ok(root) => Ok(root),
            Err(PErr::Syntax) => Err(crate::Error::SyntaxError),
            Err(PErr::StackOverflow) => Err(crate::Error::StackOverflow),
            Err(PErr::NeedsWiderEncoding) => Err(crate::Error::NeedsWiderEncoding),
        }
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum PErr {
    /// Already logged.
    Syntax,
    StackOverflow,
    /// See `InputEncoding::Latin1`.
    NeedsWiderEncoding,
}

type PResult<T> = Result<T, PErr>;

/// Entity expansion is bounded the way expat bounds it (billion laughs): once
/// the text produced by parsing passes the threshold, it may not exceed
/// `MAX_AMPLIFICATION` times the size of the document. (expat activates at
/// 8 MiB; internal entities are the only kind expanded here, and a document
/// that small legitimately producing more than 1 MiB from them is unheard of,
/// so the work an attacker can force is capped lower.)
const AMPLIFICATION_THRESHOLD: u64 = 1024 * 1024;
const MAX_AMPLIFICATION: u64 = 100;
/// Entity references open at any one time (the depth of the reference chain).
const MAX_ENTITY_DEPTH: usize = 256;

// ── code units ──────────────────────────────────────────────────────────────

/// The parser runs over UTF-8 / Latin-1 bytes or UTF-16 code units alike:
/// it only ever dispatches on ASCII units and hands anything else to
/// `decode`, so a code unit type just has to say how it maps to those.
pub trait Unit: Copy + Eq + Ord + core::hash::Hash + Default + 'static {
    /// Two bytes per unit.
    const WIDE: bool;
    /// The unit if it is below U+0100, else 0xFF: what byte-oriented
    /// dispatch (`peek`) sees. Never an ASCII value for a non-ASCII unit.
    fn low(self) -> u8;
    fn value(self) -> u32;
    fn ascii(b: u8) -> Self;
    /// The units' storage, for tape strings (whose encoding tag says how
    /// to read them back).
    fn bytes(units: &[Self]) -> &[u8];
    /// The fixed keys of the two output shapes, in this unit type.
    const KEY_TEXT: &'static [Self];
    const KEY_NAME: &'static [Self];
    const KEY_ATTRIBUTES: &'static [Self];
    const KEY_CHILDREN: &'static [Self];
    const KEY_COMMENT: &'static [Self];
    const KEY_TARGET: &'static [Self];
    const KEY_DATA: &'static [Self];
}

impl Unit for u8 {
    const WIDE: bool = false;
    #[inline(always)]
    fn low(self) -> u8 {
        self
    }
    #[inline(always)]
    fn value(self) -> u32 {
        u32::from(self)
    }
    #[inline(always)]
    fn ascii(b: u8) -> Self {
        b
    }
    #[inline(always)]
    fn bytes(units: &[Self]) -> &[u8] {
        units
    }
    const KEY_TEXT: &'static [Self] = b"#text";
    const KEY_NAME: &'static [Self] = b"name";
    const KEY_ATTRIBUTES: &'static [Self] = b"attributes";
    const KEY_CHILDREN: &'static [Self] = b"children";
    const KEY_COMMENT: &'static [Self] = b"comment";
    const KEY_TARGET: &'static [Self] = b"target";
    const KEY_DATA: &'static [Self] = b"data";
}

macro_rules! utf16 {
    ($s:literal) => {{
        const B: &[u8] = $s;
        const N: usize = B.len();
        const fn widen() -> [u16; N] {
            let mut out = [0u16; N];
            let mut i = 0;
            while i < N {
                out[i] = B[i] as u16;
                i += 1;
            }
            out
        }
        const W: [u16; N] = widen();
        &W
    }};
}

impl Unit for u16 {
    const WIDE: bool = true;
    #[inline(always)]
    fn low(self) -> u8 {
        if self < 0x100 { self as u8 } else { 0xFF }
    }
    #[inline(always)]
    fn value(self) -> u32 {
        u32::from(self)
    }
    #[inline(always)]
    fn ascii(b: u8) -> Self {
        u16::from(b)
    }
    #[inline(always)]
    fn bytes(units: &[Self]) -> &[u8] {
        bytemuck::cast_slice(units)
    }
    const KEY_TEXT: &'static [Self] = utf16!(b"#text");
    const KEY_NAME: &'static [Self] = utf16!(b"name");
    const KEY_ATTRIBUTES: &'static [Self] = utf16!(b"attributes");
    const KEY_CHILDREN: &'static [Self] = utf16!(b"children");
    const KEY_COMMENT: &'static [Self] = utf16!(b"comment");
    const KEY_TARGET: &'static [Self] = utf16!(b"target");
    const KEY_DATA: &'static [Self] = utf16!(b"data");
}

#[inline(always)]
fn unit_from_u16<U: Unit>(u: u16) -> U {
    debug_assert!(U::WIDE);
    // SAFETY: only called when `U` is `u16` (`U::WIDE`).
    unsafe { core::mem::transmute_copy(&u) }
}

/// `units` spell the ASCII `lit`.
#[inline]
fn eq_ascii<U: Unit>(units: &[U], lit: &[u8]) -> bool {
    units.len() == lit.len() && units.iter().zip(lit).all(|(&u, &b)| u.low() == b)
}

#[inline]
fn eq_ascii_ignore_case<U: Unit>(units: &[U], lit: &[u8]) -> bool {
    units.len() == lit.len()
        && units
            .iter()
            .zip(lit)
            .all(|(&u, &b)| u.low().eq_ignore_ascii_case(&b))
}

#[inline]
fn starts_with_ascii<U: Unit>(units: &[U], lit: &[u8]) -> bool {
    units.len() >= lit.len() && eq_ascii(&units[..lit.len()], lit)
}

/// The first occurrence of the ASCII `lit` in `units`.
fn find_ascii<U: Unit>(units: &[U], lit: &[u8]) -> Option<usize> {
    if !U::WIDE {
        // SAFETY: `!WIDE` units are bytes.
        let bytes: &[u8] =
            unsafe { core::slice::from_raw_parts(units.as_ptr().cast(), units.len()) };
        return strings::index_of(bytes, lit);
    }
    let first = lit[0];
    let mut i = 0;
    while i + lit.len() <= units.len() {
        if units[i].low() == first && eq_ascii(&units[i..i + lit.len()], lit) {
            return Some(i);
        }
        i += 1;
    }
    None
}

// ── character classes ───────────────────────────────────────────────────────

/// `S` (§2.3 [3]).
#[inline]
fn is_ws(c: u8) -> bool {
    matches!(c, b' ' | b'\t' | b'\n' | b'\r')
}

/// Bit 0: an ASCII `NameStartChar`; bit 1: an ASCII `NameChar`. Zero for
/// bytes >= 0x80, which callers decode separately.
static NAME_ASCII: [u8; 256] = {
    let mut t = [0u8; 256];
    let mut c = 0usize;
    while c < 0x80 {
        let b = c as u8;
        let start = b.is_ascii_alphabetic() || b == b'_' || b == b':';
        let cont = start || b.is_ascii_digit() || b == b'-' || b == b'.';
        t[c] = (start as u8) | ((cont as u8) << 1);
        c += 1;
    }
    t
};

#[inline]
fn is_name_start_ascii(c: u8) -> bool {
    NAME_ASCII[c as usize] & 1 != 0
}

#[inline]
fn is_name_char_ascii(c: u8) -> bool {
    NAME_ASCII[c as usize] & 2 != 0
}

/// `NameStartChar` (§2.3 [4]) above ASCII.
fn is_name_start_code_point(cp: u32) -> bool {
    matches!(
        cp,
        0xC0..=0xD6
            | 0xD8..=0xF6
            | 0xF8..=0x2FF
            | 0x370..=0x37D
            | 0x37F..=0x1FFF
            | 0x200C..=0x200D
            | 0x2070..=0x218F
            | 0x2C00..=0x2FEF
            | 0x3001..=0xD7FF
            | 0xF900..=0xFDCF
            | 0xFDF0..=0xFFFD
            | 0x10000..=0xEFFFF
    )
}

/// `NameChar` (§2.3 [4a]) above ASCII.
fn is_name_code_point(cp: u32) -> bool {
    is_name_start_code_point(cp) || cp == 0xB7 || matches!(cp, 0x300..=0x36F | 0x203F..=0x2040)
}

/// `Char` (§2.2 [2]).
pub fn is_xml_char(cp: u32) -> bool {
    matches!(cp, 0x9 | 0xA | 0xD | 0x20..=0xD7FF | 0xE000..=0xFFFD | 0x10000..=0x10FFFF)
}

/// `NameStartChar` (§2.3 [4]) for any code point; used by `XML.stringify`
/// to refuse names the parser would reject.
pub fn is_name_start_char(cp: u32) -> bool {
    if cp < 0x80 {
        is_name_start_ascii(cp as u8)
    } else {
        is_name_start_code_point(cp)
    }
}

/// `NameChar` (§2.3 [4a]) for any code point.
pub fn is_name_char(cp: u32) -> bool {
    if cp < 0x80 {
        is_name_char_ascii(cp as u8)
    } else {
        is_name_code_point(cp)
    }
}

/// `PubidChar` (§2.3 [13]).
fn is_pubid_char(c: u8) -> bool {
    c.is_ascii_alphanumeric()
        || matches!(
            c,
            b' ' | b'\r'
                | b'\n'
                | b'-'
                | b'\''
                | b'('
                | b')'
                | b'+'
                | b','
                | b'.'
                | b'/'
                | b':'
                | b'='
                | b'?'
                | b';'
                | b'!'
                | b'*'
                | b'#'
                | b'@'
                | b'$'
                | b'_'
                | b'%'
        )
}

/// `text` with `S` trimmed from both ends.
#[inline]
fn trim_ws<U: Unit>(text: &[U]) -> &[U] {
    trim_ws_end(trim_ws_start(text))
}

#[inline]
fn trim_ws_start<U: Unit>(text: &[U]) -> &[U] {
    let mut a = 0;
    while a < text.len() && is_ws(text[a].low()) {
        a += 1;
    }
    &text[a..]
}

#[inline]
fn trim_ws_end<U: Unit>(text: &[U]) -> &[U] {
    let mut b = text.len();
    while b > 0 && is_ws(text[b - 1].low()) {
        b -= 1;
    }
    &text[..b]
}

/// `a == b` for the short slices names are, without a `memcmp` call.
#[inline]
fn name_eq<T: Copy + Eq>(a: &[T], b: &[T]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    if a.len() >= 16 {
        return a == b;
    }
    let mut i = 0;
    while i < a.len() {
        if a[i] != b[i] {
            return false;
        }
        i += 1;
    }
    true
}

// ── tokens ──────────────────────────────────────────────────────────────────

/// What the scanner hands the parser: `Scanner::next` produces everything
/// but `Text`; `Scanner::next_content` produces `Text`, the tags and `Eof`.
#[derive(Clone, Copy)]
struct Token<'a, U: Unit> {
    kind: Kind<'a, U>,
    /// Byte offset in the document, for diagnostics.
    pos: usize,
    /// The input frame (document or entity replacement text) the token was
    /// read from; elements and declarations must begin and end in the same
    /// one.
    frame: u32,
    /// Whether whitespace came directly before the token. `S` is required,
    /// optional or forbidden depending on the position, and the parser
    /// checks that with this flag.
    spaced: bool,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Kind<'a, U: Unit> {
    /// The end of the document or, with its name, of an entity's replacement
    /// text where that is not simply the end of an inclusion.
    Eof(Option<&'a [U]>),
    /// `Name` (§2.3 [5]); keywords such as `SYSTEM` or `CDATA` are names too.
    Name(&'a [U]),
    /// A run of name characters that does not start with a `NameStartChar`,
    /// so only an `Nmtoken` (§2.3 [7]).
    Nmtoken(&'a [U]),
    /// `#` and a name: `#PCDATA`, `#REQUIRED`, `#IMPLIED`, `#FIXED`.
    Hash(&'a [U]),
    /// `%Name;` outside parameter-entity replacement text (inside it, a
    /// reference is included in place, §4.4.8, and never surfaces).
    PeReference(&'a [U]),
    /// `%` not followed by a name: the parameter-entity declaration marker.
    Percent,
    /// `%Name` with no `;`: a malformed reference — or, right after
    /// `<!ENTITY`, a parameter-entity declaration missing its space.
    PercentName(&'a [U]),
    /// A quoted literal, read as the `Literal` kind the parser asked for.
    Literal(&'a [U]),
    Eq,
    Gt,
    SlashGt,
    ParenOpen,
    ParenClose,
    Bar,
    Comma,
    Question,
    Star,
    Plus,
    BracketOpen,
    BracketClose,
    /// `<!DOCTYPE`, `<!ELEMENT`, `<!ATTLIST`, `<!ENTITY`, `<!NOTATION`.
    Decl(DeclKind),
    /// `<?xml` at the very start of the document; its pseudo-attributes
    /// follow as ordinary tokens.
    XmlDecl,
    /// A comment's text, and a processing instruction's target and data
    /// (empty outside element content unless `Scanner::keep_markup`).
    Comment(&'a [U]),
    Pi(&'a [U], &'a [U]),
    /// `<Name`
    StartTag(&'a [U]),
    /// `</Name`
    EndTag(&'a [U]),
    /// Character data with CDATA sections, references and included entities
    /// folded in.
    Text(&'a [U]),
    /// A character that cannot start any token; always an error, which the
    /// parser reports along with what it expected there.
    Unexpected(u32),
}

/// Source text (a name, usually) quoted in a diagnostic: UTF-8 as is, or
/// Latin-1 (`InputEncoding::Latin1`) transcoded so the message stays UTF-8.
struct Show<'b, U: Unit>(&'b [U], bool);

impl<U: Unit> core::fmt::Display for Show<'_, U> {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        if U::WIDE {
            let units = self.0.iter().map(|u| u.value() as u16);
            for c in char::decode_utf16(units) {
                core::fmt::Write::write_char(f, c.unwrap_or(char::REPLACEMENT_CHARACTER))?;
            }
            return Ok(());
        }
        if !self.1 {
            return core::fmt::Display::fmt(bstr::BStr::new(U::bytes(self.0)), f);
        }
        for &b in self.0 {
            core::fmt::Write::write_char(f, char::from(b.low()))?;
        }
        Ok(())
    }
}

/// A token as named in "but found …" diagnostics; `.1` as for `Show`.
struct KindDisplay<'a, U: Unit>(Kind<'a, U>, bool);

impl<U: Unit> core::fmt::Display for KindDisplay<'_, U> {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        let latin1 = self.1;
        let name = |f: &mut core::fmt::Formatter<'_>, prefix: &str, name: &[U], suffix: &str| {
            write!(f, "'{}{}{}'", prefix, Show(name, latin1), suffix)
        };
        match self.0 {
            Kind::Eof(Some(entity)) => write!(f, "the end of entity '{}'", Show(entity, latin1)),
            Kind::Eof(None) => f.write_str("end of input"),
            Kind::Name(n) | Kind::Nmtoken(n) => name(f, "", n, ""),
            Kind::Hash(n) => name(f, "#", n, ""),
            Kind::PeReference(n) => name(f, "%", n, ";"),
            Kind::Percent => f.write_str("'%'"),
            Kind::PercentName(n) => name(f, "%", n, ""),
            Kind::Literal(_) => f.write_str("a quoted string"),
            Kind::Eq => f.write_str("'='"),
            Kind::Gt => f.write_str("'>'"),
            Kind::SlashGt => f.write_str("'/>'"),
            Kind::ParenOpen => f.write_str("'('"),
            Kind::ParenClose => f.write_str("')'"),
            Kind::Bar => f.write_str("'|'"),
            Kind::Comma => f.write_str("','"),
            Kind::Question => f.write_str("'?'"),
            Kind::Star => f.write_str("'*'"),
            Kind::Plus => f.write_str("'+'"),
            Kind::BracketOpen => f.write_str("'['"),
            Kind::BracketClose => f.write_str("']'"),
            Kind::Decl(kind) => f.write_str(kind.opener()),
            Kind::XmlDecl => f.write_str("'<?xml'"),
            Kind::Comment(_) => f.write_str("a comment"),
            Kind::Pi(..) => f.write_str("a processing instruction"),
            Kind::StartTag(n) => name(f, "<", n, ""),
            Kind::EndTag(n) => name(f, "</", n, ""),
            Kind::Text(_) => f.write_str("text"),
            Kind::Unexpected(cp) => match char::from_u32(cp) {
                Some(c) if c.is_ascii_graphic() => write!(f, "'{}'", c),
                Some(c) if !c.is_control() => write!(f, "'{}' (U+{:04X})", c, cp),
                _ => write!(f, "U+{:04X}", cp),
            },
        }
    }
}

/// See `Parser::content_step`.
enum Step {
    /// One content item was consumed (a child opened or the element closed).
    Handled,
    Slow,
}

/// See `Scanner::tag_step`.
enum TagStep<'a, U: Unit> {
    End {
        empty: bool,
    },
    Attr {
        name: &'a [U],
        pos: usize,
        quote: u8,
    },
    Slow,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum DeclKind {
    Doctype,
    Element,
    Attlist,
    Entity,
    Notation,
}

impl DeclKind {
    fn opener(self) -> &'static str {
        match self {
            DeclKind::Doctype => "'<!DOCTYPE'",
            DeclKind::Element => "'<!ELEMENT'",
            DeclKind::Attlist => "'<!ATTLIST'",
            DeclKind::Entity => "'<!ENTITY'",
            DeclKind::Notation => "'<!NOTATION'",
        }
    }
}

/// How the quoted literal at the next token is read. The literal
/// productions (§2.3 [9]–[12]) differ in what they recognize between the
/// quotes, and only the parser knows which one its position calls for.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Literal {
    /// No literal is legal here: a quote is a `Kind::Unexpected` token.
    None,
    /// XML declaration values: no references, and `<` and `>` are rejected
    /// so a missing quote cannot swallow markup.
    Plain,
    /// `AttValue`: references included and whitespace normalized (§4.4.5,
    /// §3.3.3); `collapse` when the attribute is declared with a tokenized
    /// or enumerated type, whose values additionally have leading and
    /// trailing spaces dropped and inner runs collapsed.
    AttValue { collapse: bool },
    /// `EntityValue`: character and parameter-entity references included,
    /// general entity references bypassed (§4.4.5, §4.4.7).
    EntityValue,
    /// `SystemLiteral`: anything up to the closing quote.
    System,
    /// `PubidLiteral`: `PubidChar`s only.
    Pubid,
}

// ── entities and input frames ───────────────────────────────────────────────

#[derive(Copy, Clone)]
enum EntityValue<'a, U: Unit> {
    /// Replacement text: character references (and, in text that came from
    /// a parameter entity, parameter-entity references) already resolved,
    /// general entity references bypassed (§4.4.7), line ends normalized.
    Internal(&'a [U]),
    /// Declared SYSTEM/PUBLIC; never read.
    External,
    /// External with NDATA — not a parsed entity at all.
    Unparsed,
}

struct Entities<'a, U: Unit> {
    general: HashMap<&'a [U], EntityValue<'a, U>>,
    parameter: HashMap<&'a [U], EntityValue<'a, U>>,
}

fn predefined_entity<U: Unit>(name: &[U]) -> Option<u8> {
    match name.len() {
        2 if eq_ascii(name, b"lt") => Some(b'<'),
        2 if eq_ascii(name, b"gt") => Some(b'>'),
        3 if eq_ascii(name, b"amp") => Some(b'&'),
        4 if eq_ascii(name, b"apos") => Some(b'\''),
        4 if eq_ascii(name, b"quot") => Some(b'"'),
        _ => None,
    }
}

/// What a general entity reference contributes where it is included.
enum Resolved<'a, U: Unit> {
    /// A predefined entity's character.
    Byte(u8),
    /// Replacement text to scan in a new input frame.
    Text(&'a [U]),
    /// Nothing known: the reference itself is kept as character data.
    Unexpanded,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum FrameKind {
    /// The document entity. Line ends are normalized while scanning it.
    Document,
    /// A general entity included in content (§4.4.2).
    Content,
    /// An entity included in a literal (§4.4.5): quotes inside it are data.
    Literal,
    /// A parameter entity included in the DTD (§4.4.8).
    Declarations,
}

bun_core::bool_enum!(
    /// General (`&name;`) or parameter (`%name;`) entity.
    EntityKind { General, Parameter }
);

bun_core::bool_enum!(
    /// Where a general entity reference stands: element content or an attribute value.
    RefContext { Content, Attribute }
);

bun_core::bool_enum!(Endian { Little, Big });

struct Frame<'a, U: Unit> {
    src: &'a [U],
    pos: usize,
    id: u32,
    kind: FrameKind,
    /// The entity this frame is the replacement text of: (name, is-parameter).
    entity: Option<(&'a [U], EntityKind)>,
    /// Where diagnostics for tokens read from this frame point: the position
    /// of the outermost reference in the document.
    report_pos: usize,
}

// ── scanner ─────────────────────────────────────────────────────────────────

/// Owns the byte cursor, the input-frame stack and the entity tables; the
/// only component that reads bytes.
struct Scanner<'a, 'log, U: Unit> {
    /// The frame being read (the fields of `Frame`, unpacked for the hot
    /// path); enclosing frames wait in `suspended`.
    src: &'a [U],
    pos: usize,
    frame_id: u32,
    frame_kind: FrameKind,
    frame_entity: Option<(&'a [U], EntityKind)>,
    frame_report_pos: usize,
    suspended: Vec<Frame<'a, U>>,
    next_frame_id: u32,

    entities: Entities<'a, U>,
    /// Bytes of replacement text pushed so far, for the amplification limit.
    expanded_bytes: u64,
    document_len: u64,

    /// Facts about the document that well-formedness rules depend on.
    standalone: bool,
    has_external_subset: bool,
    /// A parameter-entity reference was seen in the DTD.
    saw_pe_reference: bool,
    /// A reference to a parameter entity that was not read (external or
    /// undeclared) was seen: later declarations may depend on it.
    saw_unread_pe: bool,

    /// Positions cannot be mapped back to `source` once the input has been
    /// transcoded, so diagnostics carry no location in that case.
    transcoded: bool,
    saw_utf8_bom: bool,
    needs_utf16_declaration: bool,
    /// Where the document proper starts (after a byte-order mark): the only
    /// place an XML declaration may stand.
    content_start: usize,
    encoding: InputEncoding,

    /// The structural index of the document buffer (`src` of frame 0), built
    /// once the encoding is settled and the input validated; `cursor` is the
    /// scanner's position in it.
    idx: Option<StructuralIndex<'a, U>>,
    cursor: usize,
    /// One byte per character (`InputEncoding::Latin1`).
    latin1: bool,
    /// Comments and processing instructions in element content become
    /// tokens (the node tree keeps them) instead of vanishing inside a text
    /// run.
    keep_markup: bool,
    /// The current token: `next` / `next_content` write it in place.
    tok: Token<'a, U>,
    /// A `>` was read as literal data since the last `<`: the index producer
    /// (which does not track quotes — XML has two quote characters that
    /// only mean anything inside tags, so quote state and in-tag state are
    /// circular) took it for the end of the tag, so until markup next
    /// closes or opens a tag its in-tag entries are missing and attribute
    /// values are scanned bytewise. Set by every literal scanner
    /// (`saw_gt_in_literal`), cleared wherever a `<`, `>` or `/>` is
    /// consumed as markup.
    tag_degraded: bool,

    bump: &'a Bump,
    source: &'a Source,
    log: &'log mut Log,
}

impl<'a, 'log, U: Unit> Scanner<'a, 'log, U> {
    // ── structural index ───────────────────────────────────────────────────

    fn build_index(&mut self) {
        self.idx = Some(StructuralIndex::new(self.src));
        self.cursor = 0;
    }

    /// The next position at or after the cursor that the current context
    /// has to look at, or the end of the frame. In the document that is the
    /// next index entry (whatever its class — callers treat an entry they do
    /// not care about as one ordinary byte); in entity replacement text, the
    /// next byte whose class is in `scalar_mask`.
    #[inline(always)]
    fn next_stop(&mut self, scalar_mask: u8) -> usize {
        if self.frame_kind == FrameKind::Document
            && let Some(idx) = self.idx.as_mut()
        {
            let (cursor, p) = idx.seek(self.cursor, self.pos);
            self.cursor = cursor;
            if !self.tag_degraded {
                return p;
            }
            // The in-tag entries may be missing, but the ones the index
            // always has (control and non-characters among them) still count.
            return p.min(self.scalar_stop(scalar_mask));
        }
        self.scalar_stop(scalar_mask)
    }

    #[inline]
    fn scalar_stop(&self, mask: u8) -> usize {
        let mut p = self.pos;
        while p < self.src.len() && XML_BYTE_CLASS[self.src[p].low() as usize] & mask == 0 {
            p += 1;
        }
        p
    }

    /// The error for an index entry that is not markup: a control character,
    /// or the last byte of an encoded U+FFFE / U+FFFF.
    #[cold]
    fn err_at_entry(&mut self, c: u8) -> PErr {
        if c >= 0x80 && !U::WIDE {
            self.pos -= 2;
        }
        self.err_invalid_char()
    }

    /// See `tag_degraded`: call for every `>` consumed as literal data.
    #[inline]
    fn saw_gt_in_literal(&mut self) {
        if self.in_document() {
            self.tag_degraded = true;
        }
    }

    // ── error helpers ──────────────────────────────────────────────────────

    fn loc(&self, pos: usize) -> Loc {
        if self.transcoded {
            Loc::EMPTY
        } else {
            Loc {
                start: i32::try_from(pos).unwrap_or(i32::MAX),
            }
        }
    }

    fn err(&mut self, pos: usize, msg: &'static str) -> PErr {
        self.err_fmt(pos, format_args!("{}", msg))
    }

    fn err_fmt(&mut self, pos: usize, args: core::fmt::Arguments<'_>) -> PErr {
        let loc = self.loc(pos);
        self.log.add_error_fmt_opts(
            args,
            ast::AddErrorOptions {
                source: Some(self.source),
                loc,
                len: 0,
                redact_sensitive_information: false,
            },
        );
        PErr::Syntax
    }

    /// `{before} '{name}'{after}`.
    fn err_named(
        &mut self,
        pos: usize,
        before: &'static str,
        name: &[U],
        after: &'static str,
    ) -> PErr {
        self.err_fmt(
            pos,
            format_args!("{} '{}'{}", before, Show(name, self.latin1), after),
        )
    }

    /// `{what} {the character at the cursor}` — for "expected X but found"
    /// diagnostics.
    fn err_here(&mut self, what: &'static str) -> PErr {
        let pos = self.here();
        if self.at_end() {
            return match self.frame_entity {
                Some((name, _)) => self.err_fmt(
                    pos,
                    format_args!("{} the end of entity '{}'", what, Show(name, self.latin1)),
                ),
                None => self.err_fmt(pos, format_args!("{} end of input", what)),
            };
        }
        let c = self.peek();
        if c.is_ascii_graphic() {
            self.err_fmt(pos, format_args!("{} '{}'", what, c as char))
        } else if c >= 0x80 {
            let (cp, _) = self.decode_utf8();
            match char::from_u32(cp) {
                Some(ch) if !ch.is_control() => {
                    self.err_fmt(pos, format_args!("{} '{}' (U+{:04X})", what, ch, cp))
                }
                _ => self.err_fmt(pos, format_args!("{} U+{:04X}", what, cp)),
            }
        } else {
            let name = match c {
                b' ' => "space",
                b'\t' => "tab",
                b'\n' | b'\r' => "newline",
                _ => "",
            };
            if name.is_empty() {
                self.err_fmt(pos, format_args!("{} control character 0x{:02X}", what, c))
            } else {
                self.err_fmt(pos, format_args!("{} {}", what, name))
            }
        }
    }

    fn err_invalid_char(&mut self) -> PErr {
        self.err_here("Invalid character in XML:")
    }

    // ── byte cursor ────────────────────────────────────────────────────────

    /// Document position for diagnostics about the byte at the cursor.
    #[inline]
    fn here(&self) -> usize {
        if self.in_document() {
            self.pos
        } else {
            self.frame_report_pos
        }
    }

    #[inline]
    fn peek(&self) -> u8 {
        self.peek_at(self.pos)
    }

    #[inline]
    fn peek_at(&self, pos: usize) -> u8 {
        if pos < self.src.len() {
            self.src[pos].low()
        } else {
            0
        }
    }

    /// The code unit at the cursor (which must not be at the end).
    #[inline]
    fn unit(&self) -> U {
        self.src[self.pos]
    }

    /// End of the current frame (not necessarily of the document).
    #[inline]
    fn at_end(&self) -> bool {
        self.pos >= self.src.len()
    }

    #[inline]
    fn starts_with(&self, s: &[u8]) -> bool {
        starts_with_ascii(&self.src[self.pos.min(self.src.len())..], s)
    }

    #[inline]
    fn in_document(&self) -> bool {
        self.frame_kind == FrameKind::Document
    }

    /// Decodes the UTF-8 sequence at the cursor: (code point, byte length).
    /// Only the XML declaration is tokenized before the input is validated;
    /// there a malformed sequence decodes as (0, len) or, when cut off by
    /// the end of the frame, as (lead byte, 1) — never past the end, and
    /// never as a character a name or the parser accepts.
    fn decode_utf8(&self) -> (u32, usize) {
        let first = self.unit();
        if U::WIDE {
            // UTF-16: a surrogate pair is one character; a lone surrogate
            // stands for itself (and is no name character).
            let lead = first.value();
            if (0xD800..0xDC00).contains(&lead) && self.pos + 1 < self.src.len() {
                let trail = self.src[self.pos + 1].value();
                if (0xDC00..0xE000).contains(&trail) {
                    return (0x10000 + ((lead - 0xD800) << 10) + (trail - 0xDC00), 2);
                }
            }
            return (lead, 1);
        }
        if self.latin1 {
            return (first.value(), 1);
        }
        let first = first.low();
        let len = strings::wtf8_byte_sequence_length(first);
        if len == 1 || self.pos + usize::from(len) > self.src.len() {
            return (u32::from(first), 1);
        }
        let mut bytes = [0u8; 4];
        for (i, b) in bytes[..usize::from(len)].iter_mut().enumerate() {
            *b = self.src[self.pos + i].low();
        }
        (
            strings::decode_wtf8_rune_t(bytes, len, 0u32),
            usize::from(len),
        )
    }

    /// Validates the non-ASCII sequence at the cursor as a `Char` (in valid
    /// UTF-8 only U+FFFE and U+FFFF are excluded) and returns its byte
    /// length. A malformed sequence can only be met inside the XML
    /// declaration, before the input has been validated.
    fn check_non_ascii_char(&mut self) -> PResult<usize> {
        if self.latin1 {
            return Ok(1);
        }
        let (cp, len) = self.decode_utf8();
        if U::WIDE {
            if cp == 0xFFFE || cp == 0xFFFF || (0xD800..0xE000).contains(&cp) {
                return Err(self.err_invalid_char());
            }
            return Ok(len);
        }
        if len == 1 || cp == 0 {
            return Err(self.err(self.here(), "Invalid UTF-8"));
        }
        if cp == 0xFFFE || cp == 0xFFFF {
            return Err(self.err_invalid_char());
        }
        Ok(len)
    }

    // ── input frames and entities ──────────────────────────────────────────

    fn push_frame(
        &mut self,
        text: &'a [U],
        kind: FrameKind,
        entity: (&'a [U], EntityKind),
        ref_pos: usize,
    ) -> PResult<()> {
        if self.suspended.len() >= MAX_ENTITY_DEPTH {
            return Err(self.err(ref_pos, "Entity references are nested too deeply"));
        }
        // WFC: No Recursion.
        if self.frame_entity == Some(entity)
            || self.suspended.iter().any(|f| f.entity == Some(entity))
        {
            return Err(self.err_named(ref_pos, "Entity", entity.0, " refers to itself"));
        }
        self.expanded_bytes += text.len() as u64;
        let produced = self.document_len + self.expanded_bytes;
        if produced > AMPLIFICATION_THRESHOLD
            && produced > MAX_AMPLIFICATION * self.document_len.max(1)
        {
            return Err(self.err(ref_pos, "Entity expansion exceeds the amplification limit"));
        }
        let report_pos = if self.in_document() {
            ref_pos
        } else {
            self.frame_report_pos
        };
        self.suspended.push(Frame {
            src: self.src,
            pos: self.pos,
            id: self.frame_id,
            kind: self.frame_kind,
            entity: self.frame_entity,
            report_pos: self.frame_report_pos,
        });
        self.src = text;
        self.pos = 0;
        self.frame_id = self.next_frame_id;
        self.next_frame_id += 1;
        self.frame_kind = kind;
        self.frame_entity = Some(entity);
        self.frame_report_pos = report_pos;
        Ok(())
    }

    fn pop_frame(&mut self) {
        let frame = self
            .suspended
            .pop()
            .expect("pop_frame without a suspended frame");
        self.src = frame.src;
        self.pos = frame.pos;
        self.frame_id = frame.id;
        self.frame_kind = frame.kind;
        self.frame_entity = frame.entity;
        self.frame_report_pos = frame.report_pos;
    }

    /// Resolves `&name;` for inclusion in content or an attribute value.
    fn resolve_general_entity(
        &mut self,
        name: &'a [U],
        ref_pos: usize,
        in_attribute: RefContext,
    ) -> PResult<Resolved<'a, U>> {
        if let Some(c) = predefined_entity(name) {
            return Ok(Resolved::Byte(c));
        }
        match self.entities.general.get(name).copied() {
            Some(EntityValue::Internal(text)) => Ok(Resolved::Text(text)),
            // WFC: No External Entity References.
            Some(EntityValue::External) if in_attribute == RefContext::Attribute => Err(self
                .err_named(
                    ref_pos,
                    "Attribute values cannot reference external entity",
                    name,
                    "",
                )),
            // A non-validating processor may decline to include an external
            // entity but must let the application know it was there
            // (§4.4.3): the reference is kept as written.
            Some(EntityValue::External) => Ok(Resolved::Unexpanded),
            // WFC: Parsed Entity.
            Some(EntityValue::Unparsed) => {
                Err(self.err_named(ref_pos, "Unparsed entity", name, " cannot be referenced"))
            }
            // WFC: Entity Declared applies to documents without a DTD, with
            // standalone="yes", or whose DTD has no parameter-entity
            // references and no external subset. Otherwise the declaration
            // may live in the part of the DTD that is not loaded, an
            // undeclared entity is only a validity error, and the reference
            // is kept as written.
            None if self.standalone || !(self.has_external_subset || self.saw_pe_reference) => {
                Err(self.err_named(ref_pos, "Entity", name, " is not declared"))
            }
            None => Ok(Resolved::Unexpanded),
        }
    }

    /// Appends `&name;` for a reference that is kept rather than expanded.
    fn push_reference(buf: &mut ArenaVec<'a, U>, name: &[U]) {
        buf.push(U::ascii(b'&'));
        buf.extend_from_slice(name);
        buf.push(U::ascii(b';'));
    }

    /// Includes the parameter entity `name` as declarations (§4.4.8): pushes
    /// its replacement text (the caller accounts for the space it counts as
    /// on either side), or records that an entity that is not read was
    /// referenced.
    fn include_parameter_entity(&mut self, name: &'a [U], ref_pos: usize) -> PResult<()> {
        self.saw_pe_reference = true;
        match self.entities.parameter.get(name).copied() {
            Some(EntityValue::Internal(text)) => self.push_frame(
                text,
                FrameKind::Declarations,
                (name, EntityKind::Parameter),
                ref_pos,
            ),
            Some(_) => {
                self.saw_unread_pe = true;
                Ok(())
            }
            // Undeclared: only a well-formedness error when standalone (WFC:
            // Entity Declared); otherwise the DTD is merely incomplete.
            None if self.standalone => {
                Err(self.err_named(ref_pos, "Parameter entity", name, " is not declared"))
            }
            None => {
                self.saw_unread_pe = true;
                Ok(())
            }
        }
    }

    // ── document setup ─────────────────────────────────────────────────────

    /// Byte-order mark handling and UTF-16 detection (§4.3.3, Appendix F);
    /// UTF-16 input is transcoded to UTF-8 up front. Returns whether an XML
    /// declaration may follow, in which case validating the input has to
    /// wait for the encoding it declares.
    fn init_document(&mut self) -> PResult<bool> {
        if U::WIDE {
            // A UTF-16 JS string: characters, nothing to detect but a BOM.
            if !self.src.is_empty() && self.src[0].value() == 0xFEFF {
                self.pos = 1;
            }
        } else {
            let bytes = U::bytes(self.src);
            if bytes.starts_with(b"\xEF\xBB\xBF") {
                self.pos = 3;
                self.saw_utf8_bom = true;
            } else if matches!(self.encoding, InputEncoding::Text | InputEncoding::Latin1) {
                // A JS string is characters, not bytes: nothing to detect.
            } else if bytes.starts_with(b"\xFE\xFF") {
                self.transcode_utf16(&bytes[2..], Endian::Big)?;
            } else if bytes.starts_with(b"\xFF\xFE") {
                self.transcode_utf16(&bytes[2..], Endian::Little)?;
            } else if bytes.starts_with(b"\x00<") {
                self.transcode_utf16(bytes, Endian::Big)?;
                self.needs_utf16_declaration = true;
            } else if bytes.starts_with(b"<\x00") {
                self.transcode_utf16(bytes, Endian::Little)?;
                self.needs_utf16_declaration = true;
            }
        }
        self.content_start = self.pos;
        Ok(self.starts_with(b"<?xml") && is_ws(self.peek_at(self.pos + 5)))
    }

    /// Bytes produced here (a transcoded document) as the unit type, which
    /// is `u8` whenever this is reached.
    fn units_of(bytes: &'a [u8]) -> &'a [U] {
        assert!(!U::WIDE);
        // SAFETY: `U` is `u8` (asserted).
        unsafe { core::slice::from_raw_parts(bytes.as_ptr().cast(), bytes.len()) }
    }

    /// The input must be valid UTF-8 (§4.3.3: malformed byte sequences are
    /// fatal). Run after the XML declaration — whose encoding may first
    /// cause the input to be transcoded — and before anything is decoded.
    fn validate_utf8(&mut self) -> PResult<()> {
        // Text re-encoded from a JS string, or transcoded here from UTF-16 /
        // Latin-1, is valid UTF-8 by construction; only raw bytes need it.
        if U::WIDE
            || matches!(self.encoding, InputEncoding::Text | InputEncoding::Latin1)
            || self.transcoded
        {
            return Ok(());
        }
        let result = simdutf::validate::with_errors::utf8(U::bytes(self.src));
        if result.is_successful() {
            Ok(())
        } else {
            Err(self.err(result.count, "Invalid UTF-8"))
        }
    }

    fn transcode_utf16(&mut self, payload: &[u8], big_endian: Endian) -> PResult<()> {
        let (pairs, rest) = payload.as_chunks::<2>();
        if !rest.is_empty() {
            return Err(self.err(payload.len(), "UTF-16 input has an odd number of bytes"));
        }
        let units: Vec<u16> = pairs
            .iter()
            .map(|&p| {
                if big_endian == Endian::Big {
                    u16::from_be_bytes(p)
                } else {
                    u16::from_le_bytes(p)
                }
            })
            .collect();
        let len = simdutf::length::utf8::from::utf16::le(&units);
        let slot = self.bump.alloc_uninit_slice::<u8>(len);
        // SAFETY: simdutf only writes into `utf8`; only the `result.count` bytes it wrote are read.
        let utf8: &'a mut [u8] =
            unsafe { core::slice::from_raw_parts_mut(slot.as_mut_ptr().cast::<u8>(), len) };
        let result = simdutf::convert::utf16::to::utf8::with_errors::le(&units, utf8);
        if !result.is_successful() {
            return Err(self.err(result.count * 2, "Invalid UTF-16"));
        }
        self.src = Self::units_of(&utf8[..result.count]);
        self.pos = 0;
        self.transcoded = true;
        Ok(())
    }

    /// UTF-16 without a byte-order mark is only legal with an encoding
    /// declaration naming UTF-16 (§4.3.3); `apply_declared_encoding` clears
    /// the requirement when it sees one.
    fn check_utf16_declaration(&mut self) -> PResult<()> {
        if self.needs_utf16_declaration {
            return Err(self.err(
                0,
                "UTF-16 input must start with a byte-order mark or declare encoding=\"UTF-16\"",
            ));
        }
        Ok(())
    }

    /// Acts on the encoding named by the XML declaration (the cursor is just
    /// past the declaration, which is ASCII in every supported encoding).
    fn apply_declared_encoding(&mut self, name: &[U], pos: usize) -> PResult<()> {
        if U::WIDE || matches!(self.encoding, InputEncoding::Text | InputEncoding::Latin1) {
            return Ok(());
        }
        let is = |canonical: &str| eq_ascii_ignore_case(name, canonical.as_bytes());
        if is("UTF-8") || is("UTF8") || is("US-ASCII") || is("ASCII") {
            if self.transcoded {
                return Err(self.err_named(
                    pos,
                    "Document is UTF-16 but declares encoding",
                    name,
                    "",
                ));
            }
            Ok(())
        } else if is("UTF-16") || is("UTF-16LE") || is("UTF-16BE") {
            if !self.transcoded && self.encoding == InputEncoding::Bytes {
                return Err(self.err_named(
                    pos,
                    "Document is not UTF-16 but declares encoding",
                    name,
                    "",
                ));
            }
            self.needs_utf16_declaration = false;
            Ok(())
        } else if is("ISO-8859-1") || is("ISO_8859-1") || is("LATIN1") || is("L1") || is("CP819") {
            if self.transcoded {
                return Err(self.err_named(
                    pos,
                    "Document is UTF-16 but declares encoding",
                    name,
                    "",
                ));
            }
            if self.saw_utf8_bom {
                return Err(self.err_named(
                    pos,
                    "Document has a UTF-8 byte-order mark but declares encoding",
                    name,
                    "",
                ));
            }
            if let Some(utf8) = strings::to_utf8_from_latin1(U::bytes(&self.src[self.pos..])) {
                self.src = Self::units_of(self.bump.alloc_slice_copy(&utf8));
                self.pos = 0;
                self.content_start = usize::MAX;
                self.transcoded = true;
            }
            Ok(())
        } else {
            Err(self.err_named(
                pos,
                "Unsupported encoding",
                name,
                " (supported: UTF-8, UTF-16, ISO-8859-1)",
            ))
        }
    }

    // ── names, references, literals ────────────────────────────────────────

    /// `Name` (§2.3 [5]) at the cursor, where the grammar allows nothing
    /// else (after `<`, `</`, `&`, `%`, `#`, `<?`). `what` phrases the "but
    /// found" error.
    #[inline(always)]
    fn scan_name(&mut self, what: &'static str) -> PResult<&'a [U]> {
        let start = self.pos;
        let c = self.peek();
        if is_name_start_ascii(c) {
            self.pos += 1;
        } else if c >= 0x80 && is_name_start_code_point(self.decode_utf8().0) {
            self.pos += self.decode_utf8().1;
        } else {
            return Err(self.err_here(what));
        }
        self.scan_name_chars();
        Ok(&self.src[start..self.pos])
    }

    /// Whether a `NameStartChar` is at the cursor.
    fn at_name_start(&self) -> bool {
        let c = self.peek();
        if c < 0x80 {
            is_name_start_ascii(c)
        } else {
            is_name_start_code_point(self.decode_utf8().0)
        }
    }

    #[inline(always)]
    fn scan_name_chars(&mut self) {
        loop {
            let c = self.peek();
            if is_name_char_ascii(c) {
                self.pos += 1;
            } else if c >= 0x80 {
                let (cp, len) = self.decode_utf8();
                if !is_name_code_point(cp) {
                    return;
                }
                self.pos += len;
            } else {
                return;
            }
        }
    }

    /// A maximal run of `NameChar`s at the cursor and whether it starts with
    /// a `NameStartChar` (a `Name`) or not (only an `Nmtoken`); `None` if the
    /// character at the cursor cannot start either.
    fn scan_name_run(&mut self) -> Option<(&'a [U], bool)> {
        let start = self.pos;
        let c = self.peek();
        let (is_name, len) = if c < 0x80 {
            if is_name_start_ascii(c) {
                (true, 1)
            } else if is_name_char_ascii(c) {
                (false, 1)
            } else {
                return None;
            }
        } else {
            let (cp, len) = self.decode_utf8();
            if is_name_start_code_point(cp) {
                (true, len)
            } else if is_name_code_point(cp) {
                (false, len)
            } else {
                return None;
            }
        };
        self.pos += len;
        self.scan_name_chars();
        Some((&self.src[start..self.pos], is_name))
    }

    /// `Name ';'` after `&` or `%`.
    fn scan_reference_name(&mut self, what: &'static str) -> PResult<&'a [U]> {
        let name = self.scan_name(what)?;
        if self.peek() != b';' {
            return Err(self.err_here("Expected ';' after the entity name but found"));
        }
        self.pos += 1;
        Ok(name)
    }

    /// The rest of `&#...;` / `&#x...;` after `&#`. Returns the code point,
    /// which must be a `Char` (WFC: Legal Character).
    fn scan_char_ref(&mut self, ref_pos: usize) -> PResult<u32> {
        let text_start = self.pos - 2;
        let hex = self.peek() == b'x';
        if hex {
            self.pos += 1;
        }
        let mut value: u32 = 0;
        let mut digits = 0;
        loop {
            let c = self.peek();
            let digit = match c {
                b'0'..=b'9' => u32::from(c - b'0'),
                b'a'..=b'f' if hex => u32::from(c - b'a' + 10),
                b'A'..=b'F' if hex => u32::from(c - b'A' + 10),
                _ => break,
            };
            value = value
                .saturating_mul(if hex { 16 } else { 10 })
                .saturating_add(digit);
            digits += 1;
            self.pos += 1;
        }
        if digits == 0 || self.peek() != b';' {
            return Err(self.err_here(
                "Invalid character reference: expected a number followed by ';' but found",
            ));
        }
        self.pos += 1;
        if !is_xml_char(value) {
            let text = &self.src[text_start..self.pos];
            return Err(self.err_named(
                ref_pos,
                "Character reference",
                text,
                " is not a valid XML character",
            ));
        }
        Ok(value)
    }

    fn push_code_point(&self, buf: &mut ArenaVec<'a, U>, cp: u32) -> PResult<()> {
        if U::WIDE {
            let mut tmp = [0u16; 2];
            for u in char::from_u32(cp).expect("a Char").encode_utf16(&mut tmp) {
                buf.push(unit_from_u16::<U>(*u));
            }
            return Ok(());
        }
        if self.latin1 {
            let Ok(byte) = u8::try_from(cp) else {
                return Err(PErr::NeedsWiderEncoding);
            };
            buf.push(U::ascii(byte));
            return Ok(());
        }
        let mut tmp = [0u8; 4];
        let n = strings::encode_wtf8_rune(&mut tmp, cp);
        for &b in &tmp[..n] {
            buf.push(U::ascii(b));
        }
        Ok(())
    }

    /// Copies the borrowed run `src[start..end]` into a buffer the first
    /// time decoding has to diverge from the source bytes.
    fn materialize<'b>(
        bump: &'a Bump,
        src: &[U],
        start: usize,
        end: usize,
        buf: &'b mut Option<ArenaVec<'a, U>>,
    ) -> &'b mut ArenaVec<'a, U> {
        if buf.is_none() {
            let mut b: ArenaVec<'a, U> = ArenaVec::with_capacity_in(end - start + 32, bump);
            b.extend_from_slice(&src[start..end]);
            *buf = Some(b);
        }
        buf.as_mut().expect("just set")
    }

    /// A `Plain`, `System` or `Pubid` literal after the opening quote: no
    /// references are recognized; the kinds differ only in the characters
    /// they admit.
    fn scan_simple_literal(
        &mut self,
        quote: u8,
        open: usize,
        literal: Literal,
    ) -> PResult<&'a [U]> {
        let start = self.pos;
        loop {
            match self.peek() {
                _ if self.at_end() => return Err(self.err(open, "Unterminated quoted string")),
                c if c == quote => {
                    let value = &self.src[start..self.pos];
                    self.pos += 1;
                    return Ok(value);
                }
                c if literal == Literal::Pubid && !is_pubid_char(c) => {
                    return Err(self.err_here("Invalid character in a public identifier:"));
                }
                b'<' | b'>' if literal == Literal::Plain => {
                    return Err(self.err_here("Invalid character in a quoted string:"));
                }
                b'>' => {
                    self.saw_gt_in_literal();
                    self.pos += 1;
                }
                c if c >= 0x80 => self.pos += self.check_non_ascii_char()?,
                c if c < 0x20 && !is_ws(c) => return Err(self.err_invalid_char()),
                _ => self.pos += 1,
            }
        }
    }

    /// `AttValue` (§2.3 [10]) after the opening quote, normalized per §3.3.3:
    /// a character reference appends the character, an entity reference
    /// appends its (recursively normalized) replacement text, a whitespace
    /// character appends a space; then, for a tokenized type (`collapse`),
    /// spaces are trimmed and collapsed.
    #[inline(always)]
    fn scan_att_value(&mut self, quote: u8, collapse: bool) -> PResult<&'a [U]> {
        // Nothing but ordinary characters up to the closing quote: the
        // overwhelmingly common case, one index hop.
        if self.in_document() && !self.tag_degraded && self.idx.is_some() && !collapse {
            let start = self.pos;
            let stop = self.next_stop(STOP_ATT_VALUE);
            if stop < self.src.len() && self.src[stop].low() == quote {
                self.pos = stop + 1;
                return Ok(&self.src[start..stop]);
            }
        }
        self.scan_att_value_general(quote, collapse)
    }

    fn scan_att_value_general(&mut self, quote: u8, collapse: bool) -> PResult<&'a [U]> {
        let literal_frame = self.frame_id;
        let open_pos = self.here();
        // The value borrows `src[start..]` until normalization or a
        // reference forces a copy; once `buf` exists everything is appended.
        let start = self.pos;
        let mut buf: Option<ArenaVec<'a, U>> = None;
        loop {
            let stop = self.next_stop(STOP_ATT_VALUE);
            if stop != self.pos {
                if let Some(b) = buf.as_mut() {
                    b.extend_from_slice(&self.src[self.pos..stop]);
                }
                self.pos = stop;
            }
            let c = self.peek();
            match c {
                _ if self.at_end() => {
                    if self.frame_id != literal_frame {
                        self.pop_frame();
                        continue;
                    }
                    return Err(self.err(open_pos, "Unterminated attribute value"));
                }
                _ if c == quote && self.frame_id == literal_frame => {
                    let end = self.pos;
                    self.pos += 1;
                    let value = match buf {
                        Some(b) => b.into_bump_slice(),
                        None => &self.src[start..end],
                    };
                    return Ok(if collapse {
                        collapse_spaces(self.bump, value)
                    } else {
                        value
                    });
                }
                // WFC: No < in Attribute Values (also via replacement text).
                b'<' => return Err(self.err(self.here(), "'<' is not allowed in attribute values")),
                b'&' => {
                    let ref_pos = self.here();
                    let b = Self::materialize(self.bump, self.src, start, self.pos, &mut buf);
                    self.pos += 1;
                    if self.peek() == b'#' {
                        self.pos += 1;
                        let cp = self.scan_char_ref(ref_pos)?;
                        self.push_code_point(b, cp)?;
                    } else {
                        let name = self
                            .scan_reference_name("Expected an entity name after '&' but found")?;
                        match self.resolve_general_entity(name, ref_pos, RefContext::Attribute)? {
                            Resolved::Byte(byte) => b.push(U::ascii(byte)),
                            Resolved::Text(text) => self.push_frame(
                                text,
                                FrameKind::Literal,
                                (name, EntityKind::General),
                                ref_pos,
                            )?,
                            Resolved::Unexpanded => Self::push_reference(b, name),
                        }
                    }
                }
                b'\r' if self.in_document() => {
                    // A line end in the document (CR or CRLF) is one #xA,
                    // hence one space.
                    Self::materialize(self.bump, self.src, start, self.pos, &mut buf)
                        .push(U::ascii(b' '));
                    self.pos += 1;
                    if self.peek() == b'\n' {
                        self.pos += 1;
                    }
                }
                b'\t' | b'\n' | b'\r' => {
                    Self::materialize(self.bump, self.src, start, self.pos, &mut buf)
                        .push(U::ascii(b' '));
                    self.pos += 1;
                }
                _ if c < 0x20 || (c >= 0x80 && !self.latin1) => return Err(self.err_at_entry(c)),
                // `>`, `=` or the other quote (or, in Latin-1, a byte the
                // index took for part of a non-character): plain data here.
                _ => {
                    if c == b'>' {
                        self.saw_gt_in_literal();
                    }
                    if let Some(b) = buf.as_mut() {
                        b.push(self.unit());
                    }
                    self.pos += 1;
                }
            }
        }
    }

    /// `EntityValue` (§2.3 [9]) after the opening quote: character
    /// references are included; parameter-entity references are included in
    /// literal, which is only legal outside the internal subset proper (WFC:
    /// PEs in Internal Subset); general entity references are bypassed —
    /// checked for form and kept verbatim (§4.4.7).
    fn scan_entity_value(&mut self, quote: u8) -> PResult<&'a [U]> {
        let literal_frame = self.frame_id;
        let in_internal_subset = self.in_document();
        let open_pos = self.here();
        let mut buf: ArenaVec<'a, U> = ArenaVec::with_capacity_in(32, self.bump);
        loop {
            let c = self.peek();
            match c {
                _ if self.at_end() => {
                    if self.frame_id != literal_frame {
                        self.pop_frame();
                        continue;
                    }
                    return Err(self.err(open_pos, "Unterminated entity value"));
                }
                _ if c == quote && self.frame_id == literal_frame => {
                    self.pos += 1;
                    return Ok(buf.into_bump_slice());
                }
                b'%' => {
                    let ref_pos = self.here();
                    self.pos += 1;
                    let name = self.scan_reference_name(
                        "Expected a parameter entity name after '%' but found",
                    )?;
                    if in_internal_subset {
                        return Err(self.err(ref_pos, "Parameter entity references are not allowed inside markup declarations in the internal subset"));
                    }
                    self.saw_pe_reference = true;
                    match self.entities.parameter.get(name).copied() {
                        Some(EntityValue::Internal(text)) => self.push_frame(
                            text,
                            FrameKind::Literal,
                            (name, EntityKind::Parameter),
                            ref_pos,
                        )?,
                        Some(_) => {
                            return Err(self.err_named(
                                ref_pos,
                                "External parameter entity",
                                name,
                                " cannot be included because external entities are not loaded",
                            ));
                        }
                        None => {
                            return Err(self.err_named(
                                ref_pos,
                                "Parameter entity",
                                name,
                                " is not declared",
                            ));
                        }
                    }
                }
                b'&' => {
                    let ref_pos = self.here();
                    self.pos += 1;
                    if self.peek() == b'#' {
                        self.pos += 1;
                        let cp = self.scan_char_ref(ref_pos)?;
                        self.push_code_point(&mut buf, cp)?;
                    } else {
                        let name = self
                            .scan_reference_name("Expected an entity name after '&' but found")?;
                        Self::push_reference(&mut buf, name);
                    }
                }
                b'\r' if self.in_document() => {
                    buf.push(U::ascii(b'\n'));
                    self.pos += 1;
                    if self.peek() == b'\n' {
                        self.pos += 1;
                    }
                }
                _ if c < 0x20 && !is_ws(c) => return Err(self.err_invalid_char()),
                _ => {
                    if c == b'>' {
                        self.saw_gt_in_literal();
                    }
                    let len = if c >= 0x80 {
                        self.check_non_ascii_char()?
                    } else {
                        1
                    };
                    buf.extend_from_slice(&self.src[self.pos..self.pos + len]);
                    self.pos += len;
                }
            }
        }
    }

    // ── comments, processing instructions, CDATA ─────────────────────────────

    /// Moves the cursor to `limit` over bytes that are dropped (a comment or
    /// processing instruction body), rejecting invalid characters on the way.
    fn skip_dropped(&mut self, limit: usize) -> PResult<()> {
        loop {
            let stop = self.next_stop(STOP_SKIPPED).min(limit);
            self.pos = stop;
            if stop >= limit {
                return Ok(());
            }
            let c = self.peek();
            if (c < 0x20 && !is_ws(c)) || (c >= 0x80 && !self.latin1) {
                return Err(self.err_at_entry(c));
            }
            self.pos += 1;
        }
    }

    /// The rest of a comment after `<!--` (§2.5 [15]): its text.
    fn scan_comment(&mut self, start_pos: usize) -> PResult<&'a [U]> {
        let body_start = self.pos;
        let dashes = find_ascii(&self.src[self.pos..], b"--").map(|i| self.pos + i);
        self.skip_dropped(dashes.unwrap_or(self.src.len()))?;
        match dashes {
            None => Err(self.err(start_pos, "Unterminated comment")),
            Some(d) if self.peek_at(d + 2) == b'>' => {
                self.pos = d + 3;
                Ok(self.kept(body_start, d))
            }
            Some(_) => Err(self.err(self.here(), "'--' is not allowed inside a comment")),
        }
    }

    /// `src[start..end]` as data handed on (a kept comment or processing
    /// instruction): line ends normalized if this is the document entity.
    fn kept(&self, start: usize, end: usize) -> &'a [U] {
        if !self.keep_markup {
            return &[];
        }
        let raw = &self.src[start..end];
        if self.frame_kind != FrameKind::Document {
            return raw;
        }
        let Some(mut i) = find_ascii(raw, b"\r") else {
            return raw;
        };
        let mut out: ArenaVec<'a, U> = ArenaVec::with_capacity_in(raw.len(), self.bump);
        out.extend_from_slice(&raw[..i]);
        while i < raw.len() {
            if raw[i].low() == b'\r' {
                out.push(U::ascii(b'\n'));
                if i + 1 < raw.len() && raw[i + 1].low() == b'\n' {
                    i += 1;
                }
            } else {
                out.push(raw[i]);
            }
            i += 1;
        }
        out.into_bump_slice()
    }

    /// The rest of a processing instruction after `<?` (§2.6 [16]): its
    /// target and data. Returns `None` instead, leaving the
    /// pseudo-attributes unread, when this is the XML declaration: `<?xml`
    /// as the very first thing in the document.
    fn scan_pi(&mut self, start_pos: usize) -> PResult<Option<(&'a [U], &'a [U])>> {
        let at_document_start = self.in_document() && start_pos == self.content_start;
        let target =
            self.scan_name("Expected a processing instruction target after '<?' but found")?;
        if eq_ascii(target, b"xml") && at_document_start {
            return Ok(None);
        }
        if eq_ascii_ignore_case(target, b"xml") {
            return Err(self.err(
                start_pos,
                "'<?xml' is reserved for the XML declaration, which is only allowed at the very start of the document",
            ));
        }
        if self.starts_with(b"?>") {
            self.pos += 2;
            return Ok(Some((target, &[])));
        }
        if !is_ws(self.peek()) {
            return Err(self.err_here(
                "Expected whitespace or '?>' after the processing instruction target but found",
            ));
        }
        while !self.at_end() && is_ws(self.peek()) {
            self.pos += 1;
        }
        let data_start = self.pos;
        let close = find_ascii(&self.src[self.pos..], b"?>").map(|i| self.pos + i);
        self.skip_dropped(close.unwrap_or(self.src.len()))?;
        match close {
            None => Err(self.err(start_pos, "Unterminated processing instruction")),
            Some(end) => {
                self.pos = end + 2;
                Ok(Some((target, self.kept(data_start, end))))
            }
        }
    }

    /// The body of a CDATA section after `<![CDATA[`, appended to `out` with
    /// line ends normalized; the cursor ends after `]]>`.
    fn scan_cdata(&mut self, start_pos: usize, out: &mut ArenaVec<'a, U>) -> PResult<()> {
        let close = find_ascii(&self.src[self.pos..], b"]]>").map(|i| self.pos + i);
        let limit = close.unwrap_or(self.src.len());
        loop {
            let stop = self.next_stop(STOP_SKIPPED).min(limit);
            out.extend_from_slice(&self.src[self.pos..stop]);
            self.pos = stop;
            if stop >= limit {
                break;
            }
            match self.peek() {
                b'\r' if self.in_document() => {
                    out.push(U::ascii(b'\n'));
                    self.pos += 1;
                    if self.peek() == b'\n' {
                        self.pos += 1;
                    }
                }
                c if (c < 0x20 && !is_ws(c)) || (c >= 0x80 && !self.latin1) => {
                    return Err(self.err_at_entry(c));
                }
                _ => {
                    out.push(self.unit());
                    self.pos += 1;
                }
            }
        }
        if close.is_none() {
            return Err(self.err(start_pos, "Unterminated CDATA section"));
        }
        self.pos = limit + 3;
        Ok(())
    }

    // ── tokens: markup ─────────────────────────────────────────────────────

    /// The next token anywhere outside element content. Whitespace between
    /// tokens is consumed here and reported as `Token::spaced`; a quoted
    /// literal is read the way `literal` says.
    fn next(&mut self, literal: Literal) -> PResult<()> {
        let mut spaced = false;
        let (kind, pos) = loop {
            let c = self.peek();
            let pos = self.here();
            match c {
                _ if self.at_end() => {
                    // Parameter-entity text included as declarations just
                    // ends here, counting as whitespace (§4.4.8); the end of
                    // any other frame is for the parser to reject, or the
                    // end of the document.
                    if self.frame_kind == FrameKind::Declarations {
                        self.pop_frame();
                        spaced = true;
                        continue;
                    }
                    break (Kind::Eof(self.frame_entity.map(|(name, _)| name)), pos);
                }
                b' ' | b'\t' | b'\n' | b'\r' => {
                    self.pos += 1;
                    spaced = true;
                }
                b'<' => {
                    self.tag_degraded &= !self.in_document();
                    match self.peek_at(self.pos + 1) {
                        b'?' => {
                            self.pos += 2;
                            match self.scan_pi(pos)? {
                                None => break (Kind::XmlDecl, pos),
                                Some((target, data)) => break (Kind::Pi(target, data), pos),
                            }
                        }
                        b'/' => {
                            self.pos += 2;
                            let name =
                                self.scan_name("Expected an element name after '</' but found")?;
                            break (Kind::EndTag(name), pos);
                        }
                        b'!' => {
                            if self.starts_with(b"<!--") {
                                self.pos += 4;
                                let body = self.scan_comment(pos)?;
                                break (Kind::Comment(body), pos);
                            }
                            const OPENERS: [(&[u8], DeclKind); 5] = [
                                (b"<!DOCTYPE", DeclKind::Doctype),
                                (b"<!ELEMENT", DeclKind::Element),
                                (b"<!ATTLIST", DeclKind::Attlist),
                                (b"<!ENTITY", DeclKind::Entity),
                                (b"<!NOTATION", DeclKind::Notation),
                            ];
                            if let Some(&(opener, kind)) =
                                OPENERS.iter().find(|(opener, _)| self.starts_with(opener))
                            {
                                self.pos += opener.len();
                                break (Kind::Decl(kind), pos);
                            }
                            if self.starts_with(b"<![CDATA[") {
                                return Err(self
                                    .err(pos, "CDATA sections are only allowed inside elements"));
                            }
                            if self.starts_with(b"<![") {
                                return Err(self.err(
                                    pos,
                                    "Conditional sections are only allowed in the external DTD subset",
                                ));
                            }
                            return Err(self.err(pos, "'<!' must begin a comment, '<![CDATA[', or a DOCTYPE, ELEMENT, ATTLIST, ENTITY or NOTATION declaration"));
                        }
                        _ => {
                            self.pos += 1;
                            let name =
                                self.scan_name("Expected an element name after '<' but found")?;
                            break (Kind::StartTag(name), pos);
                        }
                    }
                }
                b'"' | b'\'' => {
                    self.pos += 1;
                    let value = match literal {
                        Literal::None => break (Kind::Unexpected(u32::from(c)), pos),
                        Literal::AttValue { collapse } => self.scan_att_value(c, collapse)?,
                        Literal::EntityValue => self.scan_entity_value(c)?,
                        Literal::Plain | Literal::System | Literal::Pubid => {
                            self.scan_simple_literal(c, pos, literal)?
                        }
                    };
                    break (Kind::Literal(value), pos);
                }
                b'=' => {
                    self.pos += 1;
                    break (Kind::Eq, pos);
                }
                b'>' => {
                    self.pos += 1;
                    self.tag_degraded &= !self.in_document();
                    break (Kind::Gt, pos);
                }
                b'/' => {
                    self.pos += 1;
                    if self.peek() != b'>' {
                        return Err(self.err_here("Expected '>' after '/' but found"));
                    }
                    self.pos += 1;
                    self.tag_degraded &= !self.in_document();
                    break (Kind::SlashGt, pos);
                }
                b'(' => {
                    self.pos += 1;
                    break (Kind::ParenOpen, pos);
                }
                b')' => {
                    self.pos += 1;
                    break (Kind::ParenClose, pos);
                }
                b'|' => {
                    self.pos += 1;
                    break (Kind::Bar, pos);
                }
                b',' => {
                    self.pos += 1;
                    break (Kind::Comma, pos);
                }
                b'?' => {
                    self.pos += 1;
                    break (Kind::Question, pos);
                }
                b'*' => {
                    self.pos += 1;
                    break (Kind::Star, pos);
                }
                b'+' => {
                    self.pos += 1;
                    break (Kind::Plus, pos);
                }
                b'[' => {
                    self.pos += 1;
                    break (Kind::BracketOpen, pos);
                }
                b']' => {
                    self.pos += 1;
                    break (Kind::BracketClose, pos);
                }
                b'#' => {
                    self.pos += 1;
                    let keyword = self.scan_name("Expected a keyword after '#' but found")?;
                    break (Kind::Hash(keyword), pos);
                }
                b'%' => {
                    self.pos += 1;
                    if !self.at_name_start() {
                        break (Kind::Percent, pos);
                    }
                    let name =
                        self.scan_name("Expected a parameter entity name after '%' but found")?;
                    if self.peek() != b';' {
                        break (Kind::PercentName(name), pos);
                    }
                    self.pos += 1;
                    if self.frame_kind != FrameKind::Declarations {
                        break (Kind::PeReference(name), pos);
                    }
                    // In replacement text a reference may stand between any
                    // two tokens of a declaration (§2.8) and is included in
                    // place, counting as whitespace on both sides (§4.4.8).
                    self.include_parameter_entity(name, pos)?;
                    spaced = true;
                }
                _ if c < 0x20 => return Err(self.err_invalid_char()),
                _ => match self.scan_name_run() {
                    Some((run, true)) => break (Kind::Name(run), pos),
                    Some((run, false)) => break (Kind::Nmtoken(run), pos),
                    None => {
                        let len = if c >= 0x80 {
                            self.check_non_ascii_char()?
                        } else {
                            1
                        };
                        let (cp, _) = self.decode_utf8();
                        self.pos += len;
                        break (Kind::Unexpected(cp), pos);
                    }
                },
            }
        };
        self.tok = Token {
            kind,
            pos,
            frame: self.frame_id,
            spaced,
        };
        Ok(())
    }

    // ── tags: the fast path ────────────────────────────────────────────────

    /// One step through a start tag in the document entity, straight off the
    /// bytes: the end of the tag, or an attribute's `S Name Eq` and opening
    /// quote (the cursor is left after the quote). Anything else — which
    /// includes everything that is an error — is `Slow` with the cursor
    /// unchanged, for the token path to read and report.
    #[inline(always)]
    fn tag_step(&mut self) -> TagStep<'a, U> {
        let src = self.src;
        let at = |p: usize| if p < src.len() { src[p].low() } else { 0 };
        let mut p = self.pos;
        let unspaced = p;
        while is_ws(at(p)) {
            p += 1;
        }
        match at(p) {
            b'>' => {
                self.pos = p + 1;
                self.tag_degraded = false;
                TagStep::End { empty: false }
            }
            b'/' if at(p + 1) == b'>' => {
                self.pos = p + 2;
                self.tag_degraded = false;
                TagStep::End { empty: true }
            }
            c if p > unspaced && is_name_start_ascii(c) => {
                let name_start = p;
                p += 1;
                while is_name_char_ascii(at(p)) {
                    p += 1;
                }
                if at(p) >= 0x80 {
                    return TagStep::Slow;
                }
                let name = &src[name_start..p];
                while is_ws(at(p)) {
                    p += 1;
                }
                if at(p) != b'=' {
                    return TagStep::Slow;
                }
                p += 1;
                while is_ws(at(p)) {
                    p += 1;
                }
                match at(p) {
                    quote @ (b'"' | b'\'') => {
                        self.pos = p + 1;
                        TagStep::Attr {
                            name,
                            pos: name_start,
                            quote,
                        }
                    }
                    _ => TagStep::Slow,
                }
            }
            _ => TagStep::Slow,
        }
    }

    /// Consumes `S? '>'` if that is what comes next.
    #[inline(always)]
    fn take_gt(&mut self) -> bool {
        let mut p = self.pos;
        while p < self.src.len() && is_ws(self.src[p].low()) {
            p += 1;
        }
        if p < self.src.len() && self.src[p].low() == b'>' {
            self.pos = p + 1;
            self.tag_degraded &= !self.in_document();
            return true;
        }
        false
    }

    // ── tokens: element content ────────────────────────────────────────────

    /// The next token inside an element: one maximal `Text` run (CDATA
    /// sections, references and included entities folded in, comments and
    /// processing instructions dropped), a `StartTag` or `EndTag`, or `Eof`.
    fn next_content(&mut self) -> PResult<()> {
        // The run borrows `src[start..pos]` while it is a plain slice of
        // one frame; the first divergence copies it into `buf`, after which
        // everything is appended to `buf` and `start` is kept at `pos`.
        let mut start = self.pos;
        let text_pos = self.here();
        let mut buf: Option<ArenaVec<'a, U>> = None;

        // Whether any text has been collected so far.
        macro_rules! have_text {
            () => {
                match &buf {
                    Some(b) => !b.is_empty() || self.pos > start,
                    None => self.pos > start,
                }
            };
        }
        // Moves the borrowed run into `buf` (creating it) before the cursor
        // skips non-text bytes or changes frame. Once `buf` exists, every
        // arm keeps `start == pos`.
        macro_rules! flush {
            () => {
                Self::materialize(self.bump, self.src, start, self.pos, &mut buf)
            };
        }
        // An index entry that is ordinary character data in this context.
        macro_rules! data_byte {
            ($c:expr) => {{
                let _ = $c;
                if let Some(b) = buf.as_mut() {
                    b.push(self.unit());
                    start = self.pos + 1;
                }
                self.pos += 1;
            }};
        }

        loop {
            // Ordinary character data up to the next byte one of the arms
            // below has to see.
            let stop = self.next_stop(STOP_CONTENT);
            if stop != self.pos {
                self.pos = stop;
                if let Some(b) = buf.as_mut() {
                    b.extend_from_slice(&self.src[start..self.pos]);
                    start = self.pos;
                }
            }
            let c = self.peek();
            match c {
                _ if self.at_end() => {
                    if self.frame_kind == FrameKind::Content {
                        flush!();
                        self.pop_frame();
                        start = self.pos;
                        continue;
                    }
                    if have_text!() {
                        self.finish_text(start, buf, text_pos);
                        return Ok(());
                    }
                    self.tok = Token {
                        kind: Kind::Eof(self.frame_entity.map(|(name, _)| name)),
                        pos: self.here(),
                        frame: self.frame_id,
                        spaced: false,
                    };
                    return Ok(());
                }
                b'<' => {
                    self.tag_degraded &= !self.in_document();
                    let pos = self.here();
                    let next = self.peek_at(self.pos + 1);
                    if next == b'?' || (next == b'!' && self.starts_with(b"<!--")) {
                        if !self.keep_markup {
                            flush!();
                        } else if have_text!() {
                            // The comment / PI is a token of its own; the run ends here.
                            self.finish_text(start, buf, text_pos);
                            return Ok(());
                        }
                        let frame = self.frame_id;
                        let kind = if next == b'?' {
                            self.pos += 2;
                            let Some((target, data)) = self.scan_pi(pos)? else {
                                unreachable!("content never starts the document");
                            };
                            Kind::Pi(target, data)
                        } else {
                            self.pos += 4;
                            Kind::Comment(self.scan_comment(pos)?)
                        };
                        if self.keep_markup {
                            self.tok = Token {
                                kind,
                                pos,
                                frame,
                                spaced: false,
                            };
                            return Ok(());
                        }
                        start = self.pos;
                    } else if next == b'!' && self.starts_with(b"<![CDATA[") {
                        let mut b = match buf.take() {
                            Some(mut b) => {
                                b.extend_from_slice(&self.src[start..self.pos]);
                                b
                            }
                            None => {
                                let mut b =
                                    ArenaVec::with_capacity_in(self.pos - start + 32, self.bump);
                                b.extend_from_slice(&self.src[start..self.pos]);
                                b
                            }
                        };
                        self.pos += 9;
                        self.scan_cdata(pos, &mut b)?;
                        buf = Some(b);
                        start = self.pos;
                    } else if have_text!() {
                        // A tag ends the run; leave it for the next call.
                        self.finish_text(start, buf, text_pos);
                        return Ok(());
                    } else if next == b'!' {
                        return Err(self.err(pos, "Expected a comment or CDATA section after '<!'"));
                    } else {
                        let frame = self.frame_id;
                        let kind = if next == b'/' {
                            self.pos += 2;
                            Kind::EndTag(
                                self.scan_name("Expected an element name after '</' but found")?,
                            )
                        } else {
                            self.pos += 1;
                            Kind::StartTag(
                                self.scan_name("Expected an element name after '<' but found")?,
                            )
                        };
                        self.tok = Token {
                            kind,
                            pos,
                            frame,
                            spaced: false,
                        };
                        return Ok(());
                    }
                }
                b'&' => {
                    let ref_pos = self.here();
                    let b = flush!();
                    self.pos += 1;
                    if self.peek() == b'#' {
                        self.pos += 1;
                        let cp = self.scan_char_ref(ref_pos)?;
                        self.push_code_point(b, cp)?;
                        start = self.pos;
                    } else {
                        let name = self
                            .scan_reference_name("Expected an entity name after '&' but found")?;
                        match self.resolve_general_entity(name, ref_pos, RefContext::Content)? {
                            Resolved::Byte(byte) => b.push(U::ascii(byte)),
                            Resolved::Text(text) => self.push_frame(
                                text,
                                FrameKind::Content,
                                (name, EntityKind::General),
                                ref_pos,
                            )?,
                            Resolved::Unexpanded => Self::push_reference(b, name),
                        }
                        start = self.pos;
                    }
                }
                b'>' => {
                    if self.pos >= 2 && eq_ascii(&self.src[self.pos - 2..self.pos], b"]]") {
                        let at = if self.in_document() {
                            self.pos - 2
                        } else {
                            self.here()
                        };
                        return Err(
                            self.err(at, "']]>' is only allowed as the end of a CDATA section")
                        );
                    }
                    data_byte!(c);
                }
                b'\r' if self.frame_kind == FrameKind::Document => {
                    flush!().push(U::ascii(b'\n'));
                    self.pos += 1;
                    if self.peek() == b'\n' {
                        self.pos += 1;
                    }
                    start = self.pos;
                }
                b'\r' => data_byte!(c),
                _ if c >= 0x80 && self.latin1 => data_byte!(c),
                _ => return Err(self.err_at_entry(c)),
            }
        }
    }

    fn finish_text(&mut self, start: usize, buf: Option<ArenaVec<'a, U>>, pos: usize) {
        let text: &'a [U] = match buf {
            Some(mut b) => {
                b.extend_from_slice(&self.src[start..self.pos]);
                b.into_bump_slice()
            }
            None => &self.src[start..self.pos],
        };
        self.tok = Token {
            kind: Kind::Text(text),
            pos,
            frame: self.frame_id,
            spaced: false,
        };
    }
}

// ── output: rows on a JsonTape ────────────────────────────────────────────

/// Receives the document structure from the parser — attributes already
/// deduplicated, normalized and defaulted — and builds the rows.
trait Sink<'a, U: Unit> {
    /// `begin_element`, any number of `attribute`s; then content (`text`
    /// and child elements); then `end_element`.
    fn begin_element(&mut self, name: &'a [U], loc: Loc);
    fn attribute(&mut self, name: &'a [U], value: &'a [U]);
    fn text(&mut self, text: &'a [U], loc: Loc);
    /// Only called when `Scanner::keep_markup`.
    fn comment(&mut self, _text: &'a [U], _loc: Loc) {}
    fn pi(&mut self, _target: &'a [U], _data: &'a [U], _loc: Loc) {}
    fn end_element(&mut self);
    /// `text` (the element's only content) then `end_element`, in one step.
    fn end_leaf(&mut self, text: &'a [U], loc: Loc);
    /// Called once, after the root element has ended.
    fn finish(&mut self) -> Expr;
}

/// Rows staged for the tape, in the two columns the tape appends them as.
struct Rows<T> {
    values: Vec<T>,
    locs: Vec<Loc>,
}

impl<T: Copy> Rows<T> {
    fn with_capacity(capacity: usize) -> Self {
        Rows {
            values: Vec::with_capacity(capacity),
            locs: Vec::with_capacity(capacity),
        }
    }

    #[inline]
    fn len(&self) -> usize {
        self.values.len()
    }

    #[inline]
    fn push(&mut self, value: T, loc: Loc) {
        self.values.push(value);
        self.locs.push(loc);
    }

    #[inline]
    fn truncate(&mut self, len: usize) {
        self.values.truncate(len);
        self.locs.truncate(len);
    }

    fn reset(&mut self, len: usize, value: T, loc: Loc) {
        self.values.clear();
        self.values.resize(len, value);
        self.locs.clear();
        self.locs.resize(len, loc);
    }

    #[inline]
    fn set(&mut self, i: usize, value: T, loc: Loc) {
        self.values[i] = value;
        self.locs[i] = loc;
    }

    #[inline]
    fn columns(&self, range: core::ops::Range<usize>) -> (&[T], &[Loc]) {
        (&self.values[range.clone()], &self.locs[range])
    }
}

/// The document's `E::JsonTape` plus the scratch stacks rows are staged on
/// until their object or array is complete (a node's rows are contiguous on
/// the tape, so they can only be appended once all of them are known).
struct Tape<'a> {
    tape: core::ptr::NonNull<E::JsonTape>,
    bump: &'a Bump,
    props: Rows<E::PropertyJSON>,
    items: Rows<E::JsonValue>,
    /// `{}` and `[]` are immutable and carry no data, so one row of each
    /// serves every empty object / array in the document.
    empty_object: Option<StoreRef<E::ObjectJSON>>,
    empty_array: Option<StoreRef<E::ArrayJSON>>,
}

impl<'a> Tape<'a> {
    fn new_in(bump: &'a Bump, source_len: usize) -> Self {
        let alloc = E::TapeAlloc::Arena(core::ptr::NonNull::from(bump));
        let tape = bump.alloc(E::JsonTape::empty_in(alloc));
        // A first guess so typical documents do not regrow the tape (each
        // growth step copies it); bounded so a huge text-heavy input does
        // not reserve memory it will never use.
        let rows = (source_len / 32).min(1 << 20);
        tape.reserve(rows, rows / 2);
        Tape {
            tape: tape.root_ptr(),
            bump,
            props: Rows::with_capacity(rows / 4 + 16),
            items: Rows::with_capacity(rows / 8 + 16),
            empty_object: None,
            empty_array: None,
        }
    }

    #[inline]
    fn str<U: Unit>(units: &[U]) -> E::JsonValue {
        E::JsonValue::String(E::Str::new(U::bytes(units)))
    }

    #[inline]
    fn push_prop(&mut self, key: &[u8], value: E::JsonValue, loc: Loc) {
        self.props.push(
            E::PropertyJSON {
                key: E::Str::new(key),
                key_loc: loc,
                value,
            },
            loc,
        );
    }

    #[inline]
    fn push_item(&mut self, value: E::JsonValue, loc: Loc) {
        self.items.push(value, loc);
    }

    /// Moves the properties staged since `mark` to the tape as one object.
    #[inline]
    fn object_from(&mut self, mark: usize, loc: Loc) -> StoreRef<E::ObjectJSON> {
        let empty = mark == self.props.len();
        if empty && let Some(row) = self.empty_object {
            return row;
        }
        let row = self.object_from_rows(mark, loc);
        if empty {
            self.empty_object = Some(row);
        }
        row
    }

    fn object_from_rows(&mut self, mark: usize, loc: Loc) -> StoreRef<E::ObjectJSON> {
        // SAFETY: `tape` is the arena allocation's own pointer (`root_ptr`),
        // written only through here, and the arena outlives the AST.
        let tape = unsafe { self.tape.as_mut() };
        let (props, locs) = self.props.columns(mark..self.props.len());
        let (first, count) = tape.append_props(props, locs);
        self.props.truncate(mark);
        // SAFETY: as above — the tape's own pointer, and it outlives the node.
        let object =
            unsafe { E::ObjectJSON::new(self.tape, first, count, E::IsSingleLine::No, loc) };
        let Data::EObjectJSON(row) = Expr::init(object, loc).data else {
            unreachable!()
        };
        row
    }

    /// Moves the items staged since `mark` to the tape as one array.
    #[inline]
    fn array_from(&mut self, mark: usize, loc: Loc) -> StoreRef<E::ArrayJSON> {
        if mark == self.items.len() {
            if let Some(empty) = self.empty_array {
                return empty;
            }
            let row = Self::array_of(self.tape, &[], &[], loc);
            self.empty_array = Some(row);
            return row;
        }
        let (items, locs) = self.items.columns(mark..self.items.len());
        let row = Self::array_of(self.tape, items, locs, loc);
        self.items.truncate(mark);
        row
    }

    fn array_of(
        mut tape: core::ptr::NonNull<E::JsonTape>,
        items: &[E::JsonValue],
        locs: &[Loc],
        loc: Loc,
    ) -> StoreRef<E::ArrayJSON> {
        // SAFETY: see `object_from`.
        let (first, count) = unsafe { tape.as_mut() }.append_items(items, locs);
        // SAFETY: see `object_from`.
        let array = unsafe { E::ArrayJSON::new(tape, first, count, E::IsSingleLine::No, loc) };
        let Data::EArrayJSON(row) = Expr::init(array, loc).data else {
            unreachable!()
        };
        row
    }

    fn root(object: StoreRef<E::ObjectJSON>, loc: Loc) -> Expr {
        Expr {
            data: Data::EObjectJSON(object),
            loc,
        }
    }
}

/// Builds `{ "@attr": .., child: .., "#text": .. }`; the mapping rules are
/// documented on `Bun.XML.parse` in bun.d.ts.
struct CompactSink<'a, U: Unit> {
    tape: Tape<'a>,
    stack: Vec<CompactFrame<'a, U>>,
    /// The text runs of every open element, oldest first, each with whether
    /// it is whitespace only; a frame owns the tail from its `text_mark`.
    /// Concatenated when the element ends.
    text_runs: Vec<(&'a [U], bool)>,
    /// Recently built `@name` keys, direct-mapped by a cheap hash of the
    /// name: attribute names repeat, their keys need not be rebuilt.
    key_cache: [Option<E::Str>; KEY_CACHE_SIZE],
    /// Scratch for `end_element`'s grouping of repeated child names.
    group_of: Vec<u32>,
    groups: Vec<Group>,
    gathered: Rows<E::JsonValue>,
    group_index: HashMap<&'a [u8], u32>,
    root: Option<(&'a [U], E::JsonValue, Loc)>,
}

/// An open element. Its properties are staged on `Tape::props` from
/// `props_mark`: the `@`-attributes, then one per child element as each one
/// ends (repeats are folded when this element ends), with a `#text`
/// placeholder where the first text run that is not whitespace-only fell
/// among them.
struct CompactFrame<'a, U: Unit> {
    name: &'a [U],
    loc: Loc,
    attribute_count: u32,
    props_mark: u32,
    text_mark: u32,
    /// Index on `Tape::props` of this element's `#text` placeholder, or `u32::MAX`.
    text_prop: u32,
}

const KEY_CACHE_SIZE: usize = 64;

#[inline]
fn key_cache_slot(name: &[u8]) -> usize {
    let n = name.len();
    if n == 0 {
        return 0;
    }
    (n.wrapping_mul(31)
        ^ (name[0] as usize).wrapping_mul(7)
        ^ (name[n - 1] as usize)
        ^ ((name[n / 2] as usize) << 2))
        % KEY_CACHE_SIZE
}

struct Group {
    /// Index of the name's first property in the frame's child run.
    first: u32,
    count: u32,
    /// While gathering a repeated group: the next free slot of its run in
    /// `CompactSink::gathered`.
    cursor: u32,
}

/// Up to this many child properties, a repeat is found by comparing names
/// pairwise; beyond it, through a hash map.
const LINEAR_CHILD_LIMIT: usize = 16;

fn is_ws_only<U: Unit>(text: &[U]) -> bool {
    text.iter().all(|u| is_ws(u.low()))
}

impl<'a, U: Unit> CompactSink<'a, U> {
    fn new(tape: Tape<'a>) -> Self {
        CompactSink {
            stack: Vec::with_capacity(64),
            text_runs: Vec::with_capacity(tape.items.values.capacity()),
            tape,
            key_cache: [None; KEY_CACHE_SIZE],
            group_of: Vec::new(),
            groups: Vec::new(),
            gathered: Rows::with_capacity(0),
            group_index: HashMap::default(),
            root: None,
        }
    }

    /// The runs from `mark`, concatenated — all of them, or only those that
    /// are not whitespace-only. A single surviving run is borrowed, not
    /// copied.
    fn concat_text(&self, mark: usize, skip_ws_only: bool) -> &'a [U] {
        let runs = &self.text_runs[mark..];
        let mut kept = runs.iter().filter(|(_, ws)| !(skip_ws_only && *ws));
        let Some(&(first, _)) = kept.next() else {
            return &[];
        };
        let Some(&(second, _)) = kept.next() else {
            return first;
        };
        let len = first.len() + second.len() + kept.map(|(r, _)| r.len()).sum::<usize>();
        let mut buf: ArenaVec<'a, U> = ArenaVec::with_capacity_in(len, self.tape.bump);
        for &(run, ws) in runs {
            if !(skip_ws_only && ws) {
                buf.extend_from_slice(run);
            }
        }
        buf.into_bump_slice()
    }

    /// Folds the child properties staged from `mark` so each name keeps one
    /// property, in order of first occurrence, a repeated name holding the
    /// array of its values.
    #[inline]
    fn fold_repeats(&mut self, mark: usize) {
        let children = &self.tape.props.values[mark..];
        let n = children.len();
        // Usually every name is distinct: settle that cheaply first. A
        // 64-slot filter on (length, first, last byte) says "all distinct"
        // with no comparisons; a collision falls to comparing pairwise.
        let slot = |key: &[u8]| -> u64 {
            let h = key.len() ^ (usize::from(key[0]) << 1) ^ (usize::from(key[key.len() - 1]) << 3);
            1u64 << (h & 63)
        };
        if n > 8 {
            let mut seen = 0u64;
            let mut collided = false;
            for child in children {
                let bit = slot(child.key.slice());
                collided |= seen & bit != 0;
                seen |= bit;
            }
            if !collided {
                return;
            }
        }
        if n <= LINEAR_CHILD_LIMIT {
            let mut repeated = false;
            'scan: for i in 1..n {
                let name = children[i].key.slice();
                for prev in &children[..i] {
                    if name_eq(prev.key.slice(), name) {
                        repeated = true;
                        break 'scan;
                    }
                }
            }
            if !repeated {
                return;
            }
        }
        self.fold_repeats_slow(mark);
    }

    #[cold]
    fn fold_repeats_slow(&mut self, mark: usize) {
        let children = &self.tape.props.values[mark..];
        let n = children.len();
        // Group by name.
        self.groups.clear();
        self.group_of.clear();
        if n <= LINEAR_CHILD_LIMIT {
            'next: for (i, child) in children.iter().enumerate() {
                let name = child.key.slice();
                for (g, group) in self.groups.iter_mut().enumerate() {
                    if name_eq(children[group.first as usize].key.slice(), name) {
                        group.count += 1;
                        self.group_of.push(g as u32);
                        continue 'next;
                    }
                }
                self.group_of.push(self.groups.len() as u32);
                self.groups.push(Group {
                    first: i as u32,
                    count: 1,
                    cursor: 0,
                });
            }
        } else {
            let index = &mut self.group_index;
            index.clear();
            for (i, child) in children.iter().enumerate() {
                let next = self.groups.len() as u32;
                let g = *index.entry(child.key.slice()).or_insert_with(|| next);
                if g == next {
                    self.groups.push(Group {
                        first: i as u32,
                        count: 0,
                        cursor: 0,
                    });
                }
                self.groups[g as usize].count += 1;
                self.group_of.push(g);
            }
        }
        if self.groups.len() == n {
            return;
        }
        // Lay the values of repeated names out group by group and cut one
        // array per repeated group.
        let mut next = 0u32;
        for g in self.groups.iter_mut() {
            g.cursor = next;
            if g.count > 1 {
                next += g.count;
            }
        }
        self.gathered
            .reset(next as usize, E::JsonValue::Null, Loc::EMPTY);
        for (i, &g) in self.group_of.iter().enumerate() {
            let group = &mut self.groups[g as usize];
            if group.count > 1 {
                self.gathered.set(
                    group.cursor as usize,
                    children[i].value,
                    self.tape.props.locs[mark + i],
                );
                group.cursor += 1;
            }
        }
        // Compact the run to one property per group (a group's first
        // property is never behind its final slot, so this is in place).
        for (slot, g) in self.groups.iter().enumerate() {
            let mut prop = self.tape.props.values[mark + g.first as usize];
            if g.count > 1 {
                let run = (g.cursor - g.count) as usize..g.cursor as usize;
                let (values, locs) = self.gathered.columns(run);
                prop.value =
                    E::JsonValue::Array(Tape::array_of(self.tape.tape, values, locs, prop.key_loc));
            }
            self.tape.props.set(mark + slot, prop, prop.key_loc);
        }
        self.tape.props.truncate(mark + self.groups.len());
    }

    /// An element with no child elements: its text if it has no attributes
    /// either, else `{ "@attr".., "#text" }` (`#text` only if there is any).
    #[inline]
    fn leaf_value(&mut self, frame: &CompactFrame<'a, U>, text: &'a [U]) -> E::JsonValue {
        if frame.attribute_count == 0 {
            return Tape::str(text);
        }
        if !text.is_empty() {
            self.tape
                .push_prop(U::bytes(U::KEY_TEXT), Tape::str(text), frame.loc);
        }
        E::JsonValue::Object(self.tape.object_from(frame.props_mark as usize, frame.loc))
    }

    /// Hands a finished element to its parent (or keeps it as the root).
    #[inline]
    fn deliver(&mut self, name: &'a [U], value: E::JsonValue, loc: Loc) {
        match self.stack.last() {
            Some(_) => self.tape.push_prop(U::bytes(name), value, loc),
            None => self.root = Some((name, value, loc)),
        }
    }
}

impl<'a, U: Unit> Sink<'a, U> for CompactSink<'a, U> {
    #[inline]
    fn begin_element(&mut self, name: &'a [U], loc: Loc) {
        self.stack.push(CompactFrame {
            name,
            loc,
            attribute_count: 0,
            props_mark: self.tape.props.len() as u32,
            text_mark: self.text_runs.len() as u32,
            text_prop: u32::MAX,
        });
    }

    #[inline]
    fn attribute(&mut self, name: &'a [U], value: &'a [U]) {
        let frame = self
            .stack
            .last_mut()
            .expect("attribute outside a start tag");
        frame.attribute_count += 1;
        let loc = frame.loc;
        let unit = core::mem::size_of::<U>();
        let slot = key_cache_slot(U::bytes(name));
        let key = match self.key_cache[slot] {
            Some(key) if name_eq(&key.slice()[unit..], U::bytes(name)) => key,
            _ => {
                // `@name`, in the tape's encoding.
                let joined = self.tape.bump.alloc_slice_fill_default::<U>(name.len() + 1);
                joined[0] = U::ascii(b'@');
                joined[1..].copy_from_slice(name);
                let key = E::Str::new(U::bytes(joined));
                self.key_cache[slot] = Some(key);
                key
            }
        };
        self.tape.push_prop(key.slice(), Tape::str(value), loc);
    }

    #[inline]
    fn text(&mut self, text: &'a [U], _loc: Loc) {
        let ws_only = is_ws_only(text);
        self.text_runs.push((text, ws_only));
        if !ws_only {
            let frame = self.stack.last_mut().expect("text outside an element");
            if frame.text_prop == u32::MAX {
                // Reserve `#text`'s place among the children; filled in at the end.
                frame.text_prop = self.tape.props.len() as u32;
                let loc = frame.loc;
                self.tape
                    .push_prop(U::bytes(U::KEY_TEXT), E::JsonValue::Null, loc);
            }
        }
    }

    #[inline]
    fn end_leaf(&mut self, text: &'a [U], _loc: Loc) {
        let frame = self.stack.pop().expect("end_leaf without start_element");
        let value = self.leaf_value(&frame, text);
        self.deliver(frame.name, value, frame.loc);
    }

    fn end_element(&mut self) {
        let frame = self.stack.pop().expect("end_element without start_element");
        let text_mark = frame.text_mark as usize;
        let children_mark = frame.props_mark as usize + frame.attribute_count as usize;
        let has_text = frame.text_prop != u32::MAX;
        // Past the attributes, `props` holds one entry per child element plus
        // the `#text` placeholder if there is one.
        let has_elements = self.tape.props.len() > children_mark + usize::from(has_text);
        let value = if !has_elements {
            // Every run, exactly; the placeholder (if any) is re-made last.
            let text = self.concat_text(text_mark, false);
            self.tape.props.truncate(children_mark);
            self.leaf_value(&frame, text)
        } else {
            // Whitespace-only runs between child elements are layout.
            if has_text {
                let text = self.concat_text(text_mark, true);
                self.tape.props.values[frame.text_prop as usize].value = Tape::str(text);
            }
            if self.tape.props.len() > children_mark + 1 {
                self.fold_repeats(children_mark);
            }
            E::JsonValue::Object(self.tape.object_from(frame.props_mark as usize, frame.loc))
        };
        self.text_runs.truncate(text_mark);
        self.deliver(frame.name, value, frame.loc);
    }

    fn finish(&mut self) -> Expr {
        let (name, value, loc) = self
            .root
            .take()
            .expect("finish before the root element ended");
        let mark = self.tape.props.len();
        self.tape.push_prop(U::bytes(name), value, loc);
        Tape::root(self.tape.object_from(mark, loc), loc)
    }
}

/// Builds `{ name, attributes: {..}, children: [..] }` per element; text
/// children are strings, kept exactly (including whitespace-only runs).
struct NodeSink<'a, U: Unit> {
    tape: Tape<'a>,
    stack: Vec<NodeFrame<'a, U>>,
    root: Option<StoreRef<E::ObjectJSON>>,
}

struct NodeFrame<'a, U: Unit> {
    name: &'a [U],
    loc: Loc,
    /// The attributes are staged on `Tape::props` from here until the
    /// element ends (nothing else of this element goes on `props`).
    props_mark: u32,
    children_mark: u32,
}

impl<'a, U: Unit> NodeSink<'a, U> {
    fn new(tape: Tape<'a>) -> Self {
        NodeSink {
            tape,
            stack: Vec::new(),
            root: None,
        }
    }
}

impl<'a, U: Unit> Sink<'a, U> for NodeSink<'a, U> {
    #[inline]
    fn begin_element(&mut self, name: &'a [U], loc: Loc) {
        self.stack.push(NodeFrame {
            name,
            loc,
            props_mark: self.tape.props.len() as u32,
            children_mark: self.tape.items.len() as u32,
        });
    }

    #[inline]
    fn attribute(&mut self, name: &'a [U], value: &'a [U]) {
        let loc = self
            .stack
            .last()
            .expect("attribute outside a start tag")
            .loc;
        self.tape.push_prop(U::bytes(name), Tape::str(value), loc);
    }

    fn text(&mut self, text: &'a [U], loc: Loc) {
        self.tape.push_item(Tape::str(text), loc);
    }

    fn comment(&mut self, text: &'a [U], loc: Loc) {
        let mark = self.tape.props.len();
        self.tape
            .push_prop(U::bytes(U::KEY_COMMENT), Tape::str(text), loc);
        let node = self.tape.object_from(mark, loc);
        self.tape.push_item(E::JsonValue::Object(node), loc);
    }

    fn pi(&mut self, target: &'a [U], data: &'a [U], loc: Loc) {
        let mark = self.tape.props.len();
        self.tape
            .push_prop(U::bytes(U::KEY_TARGET), Tape::str(target), loc);
        self.tape
            .push_prop(U::bytes(U::KEY_DATA), Tape::str(data), loc);
        let node = self.tape.object_from(mark, loc);
        self.tape.push_item(E::JsonValue::Object(node), loc);
    }

    #[inline]
    fn end_leaf(&mut self, text: &'a [U], loc: Loc) {
        if !text.is_empty() {
            self.tape.push_item(Tape::str(text), loc);
        }
        self.end_element();
    }

    fn end_element(&mut self) {
        let frame = self.stack.pop().expect("end_element without start_element");
        let attributes = self.tape.object_from(frame.props_mark as usize, frame.loc);
        let children = self
            .tape
            .array_from(frame.children_mark as usize, frame.loc);
        let mark = self.tape.props.len();
        self.tape
            .push_prop(U::bytes(U::KEY_NAME), Tape::str(frame.name), frame.loc);
        self.tape.push_prop(
            U::bytes(U::KEY_ATTRIBUTES),
            E::JsonValue::Object(attributes),
            frame.loc,
        );
        self.tape.push_prop(
            U::bytes(U::KEY_CHILDREN),
            E::JsonValue::Array(children),
            frame.loc,
        );
        let node = self.tape.object_from(mark, frame.loc);
        match self.stack.last() {
            Some(_) => self.tape.push_item(E::JsonValue::Object(node), frame.loc),
            None => self.root = Some(node),
        }
    }

    fn finish(&mut self) -> Expr {
        let root = self
            .root
            .take()
            .expect("finish before the root element ended");
        Tape::root(root, Loc { start: 0 })
    }
}

// ── parser ──────────────────────────────────────────────────────────────────

/// One declared attribute of an element type: its normalization class and
/// its (already normalized) default.
#[derive(Copy, Clone)]
struct AttDef<'a, U: Unit> {
    name: &'a [U],
    cdata: bool,
    /// The default, already normalized.
    default: Option<&'a [U]>,
}

/// The ATTLIST declarations for one element type, in declaration order (the
/// first declaration of an attribute is binding, §3.3), indexed by name.
#[derive(Default)]
struct AttList<'a, U: Unit> {
    defs: Vec<AttDef<'a, U>>,
    by_name: HashMap<&'a [U], u32>,
}

impl<'a, U: Unit> AttList<'a, U> {
    fn get(&self, name: &[U]) -> Option<&AttDef<'a, U>> {
        self.by_name.get(name).map(|&i| &self.defs[i as usize])
    }

    fn declare(&mut self, def: AttDef<'a, U>) {
        if !self.by_name.contains_key(def.name) {
            self.by_name.insert(def.name, self.defs.len() as u32);
            self.defs.push(def);
        }
    }
}

/// Up to this many attributes on one tag, duplicates are found by comparing
/// names pairwise (`Parser::attribute_first`); beyond it, through
/// `Parser::attribute_names`.
const LINEAR_ATTRIBUTE_LIMIT: usize = 8;

bun_core::bool_enum!(
    /// The declaration an `ExternalID` belongs to; a NOTATION also admits a bare `PublicID`.
    ForNotation
);

bun_core::bool_enum!(
    /// What an ATTLIST `( x | y )` group lists: name tokens (an enumeration) or notation names.
    EnumerationOf { Nmtokens, NotationNames }
);

/// Elements open at once. Parsing is iterative, so this is not about the
/// native stack; it bounds memory on hostile input and keeps the (recursive)
/// consumers of the result safe. `Bun.XML.parse` reports it as a `RangeError`.
const MAX_DEPTH: usize = 100_000;

/// Checks the grammar and the structural well-formedness constraints over
/// the scanner's tokens (and, in the document entity, its fast paths),
/// applies DTD information to attributes, and drives a `Sink`.
/// `repr(C)` with `sink` last: everything the sink-independent methods (the
/// DTD parser) touch sits at the same offset for every `S`, so those
/// instantiations are identical and the linker folds them.
#[repr(C)]
struct Parser<'a, 'log, U: Unit, S: Sink<'a, U>> {
    scanner: Scanner<'a, 'log, U>,
    /// For the content-model parser, which does recurse.
    stack_check: StackCheck,
    attlists: HashMap<&'a [U], AttList<'a, U>>,
    /// The open elements: name and the input frame the start tag was in.
    open: Vec<(&'a [U], u32)>,
    /// The current start tag's attribute names: the first few in `first`,
    /// and once there are more than `LINEAR_ATTRIBUTE_LIMIT`, all in `names`.
    attribute_first: [&'a [U]; LINEAR_ATTRIBUTE_LIMIT],
    attribute_names: HashMap<&'a [U], ()>,
    attribute_count: usize,
    /// Inside the document type declaration, for diagnostics.
    in_dtd: bool,
    sink: S,
}

impl<'a, 'log, U: Unit, S: Sink<'a, U>> Parser<'a, 'log, U, S> {
    fn new(
        source: &'a Source,
        contents: &'a [U],
        log: &'log mut Log,
        bump: &'a Bump,
        options: Options,
        sink: S,
    ) -> Self {
        Parser {
            scanner: Scanner {
                src: contents,
                pos: 0,
                frame_id: 0,
                frame_kind: FrameKind::Document,
                frame_entity: None,
                frame_report_pos: 0,
                suspended: Vec::new(),
                next_frame_id: 1,
                entities: Entities {
                    general: HashMap::default(),
                    parameter: HashMap::default(),
                },
                expanded_bytes: 0,
                document_len: contents.len() as u64,
                standalone: false,
                has_external_subset: false,
                saw_pe_reference: false,
                saw_unread_pe: false,
                // UTF-16 unit offsets are not byte offsets into `source`.
                transcoded: U::WIDE,
                saw_utf8_bom: false,
                needs_utf16_declaration: false,
                content_start: 0,
                encoding: options.encoding,
                idx: None,
                cursor: 0,
                latin1: options.encoding == InputEncoding::Latin1,
                keep_markup: !options.compact,
                tok: Token {
                    kind: Kind::Eof(None),
                    pos: 0,
                    frame: 0,
                    spaced: false,
                },
                tag_degraded: false,
                bump,
                source,
                log,
            },
            in_dtd: false,
            stack_check: StackCheck::init(),
            sink,
            attlists: HashMap::default(),
            open: Vec::new(),
            attribute_first: [&[]; LINEAR_ATTRIBUTE_LIMIT],
            attribute_names: HashMap::default(),
            attribute_count: 0,
        }
    }

    /// Nesting too deep to recurse into. The message is for the module
    /// loader's log; `Bun.XML.parse` throws a `RangeError` regardless.
    fn stack_overflow(&mut self) -> PErr {
        let _ = self
            .scanner
            .err(self.scanner.tok.pos, "Nesting is too deep");
        PErr::StackOverflow
    }

    // ── tokens ─────────────────────────────────────────────────────────────

    fn advance(&mut self) -> PResult<()> {
        self.advance_literal(Literal::None)
    }

    /// `advance`, saying how a quoted literal is to be read if one is next.
    #[inline]
    fn advance_literal(&mut self, literal: Literal) -> PResult<()> {
        self.scanner.next(literal)
    }

    #[inline]
    fn advance_content(&mut self) -> PResult<()> {
        self.scanner.next_content()
    }

    /// "Expected {expected} but found {the current token}".
    fn unexpected(&mut self, expected: &str) -> PErr {
        // WFC: PEs in Internal Subset is the likeliest reason for a stray
        // reference inside a declaration, so say that instead.
        if self.in_dtd && matches!(self.scanner.tok.kind, Kind::PeReference(_)) {
            return self.scanner.err(
                self.scanner.tok.pos,
                "Parameter entity references are not allowed inside markup declarations in the internal subset",
            );
        }
        if let Kind::PercentName(name) = self.scanner.tok.kind {
            return self.scanner.err_named(
                self.scanner.tok.pos,
                "Expected ';' to end the parameter entity reference",
                name,
                "",
            );
        }
        let tok = self.scanner.tok;
        self.scanner.err_fmt(
            tok.pos,
            format_args!(
                "Expected {} but found {}",
                expected,
                KindDisplay(tok.kind, self.scanner.latin1)
            ),
        )
    }

    /// Where the grammar has a required `S` before the current token.
    fn require_spaced(&mut self) -> PResult<()> {
        if self.scanner.tok.spaced {
            return Ok(());
        }
        let tok = self.scanner.tok;
        Err(self.scanner.err_fmt(
            tok.pos,
            format_args!(
                "Whitespace is required before {}",
                KindDisplay(tok.kind, self.scanner.latin1)
            ),
        ))
    }

    fn expect_name(&mut self, expected: &str) -> PResult<&'a [U]> {
        match self.scanner.tok.kind {
            Kind::Name(name) => Ok(name),
            _ => Err(self.unexpected(expected)),
        }
    }

    /// The `>` ending a declaration or tag; returns the frame it came from.
    fn expect_gt(&mut self, expected: &str) -> PResult<u32> {
        match self.scanner.tok.kind {
            Kind::Gt => Ok(self.scanner.tok.frame),
            _ => Err(self.unexpected(expected)),
        }
    }

    // ── document ───────────────────────────────────────────────────────────

    /// `document ::= prolog element Misc*` (§2.1 [1]).
    fn parse_document(mut self) -> PResult<Expr> {
        // An XML declaration has to be read before the encoding it declares
        // can be applied and the input validated (its tokens are checked
        // against ASCII names and values, so nothing mis-decoded survives).
        let validation_deferred = self.scanner.init_document()?;
        if !validation_deferred {
            self.scanner.check_utf16_declaration()?;
            self.scanner.validate_utf8()?;
            self.scanner.build_index();
        }
        self.advance()?;
        let has_xml_decl = self.scanner.tok.kind == Kind::XmlDecl;
        if has_xml_decl {
            self.parse_xml_decl()?;
        }
        if validation_deferred {
            self.scanner.check_utf16_declaration()?;
            self.scanner.validate_utf8()?;
            self.scanner.build_index();
        }
        if has_xml_decl {
            self.advance()?;
        }

        // prolog: Misc* (doctypedecl Misc*)?
        let mut seen_doctype = false;
        loop {
            match self.scanner.tok.kind {
                Kind::Comment(_) | Kind::Pi(..) => {}
                Kind::Decl(DeclKind::Doctype) if !seen_doctype => {
                    seen_doctype = true;
                    self.parse_doctype()?;
                }
                Kind::Decl(DeclKind::Doctype) => {
                    return Err(self.scanner.err(
                        self.scanner.tok.pos,
                        "Only one document type declaration is allowed",
                    ));
                }
                Kind::StartTag(_) => break,
                Kind::Eof(_) => {
                    return Err(self.scanner.err(
                        self.scanner.tok.pos,
                        "XML document must have a root element",
                    ));
                }
                Kind::Decl(_) | Kind::PeReference(_) | Kind::Percent | Kind::PercentName(_) => {
                    return Err(self.scanner.err(
                        self.scanner.tok.pos,
                        "Markup declarations and parameter-entity references are only allowed in the document type declaration",
                    ));
                }
                _ => return Err(self.unexpected("the root element")),
            }
            self.advance()?;
        }

        self.parse_tree()?;

        // Misc*
        loop {
            self.advance()?;
            match self.scanner.tok.kind {
                Kind::Comment(_) | Kind::Pi(..) => {}
                Kind::Eof(_) => break,
                Kind::StartTag(_) => {
                    return Err(self
                        .scanner
                        .err(self.scanner.tok.pos, "Only one root element is allowed"));
                }
                _ => {
                    let tok = self.scanner.tok;
                    return Err(self.scanner.err_fmt(
                        tok.pos,
                        format_args!(
                            "Unexpected {} after the root element",
                            KindDisplay(tok.kind, self.scanner.latin1)
                        ),
                    ));
                }
            }
        }
        Ok(self.sink.finish())
    }

    /// `XMLDecl ::= '<?xml' VersionInfo EncodingDecl? SDDecl? S? '?>'`
    /// (§2.8 [23]); the current token is `<?xml`. Ends on the `>` of `?>`.
    fn parse_xml_decl(&mut self) -> PResult<()> {
        self.advance()?;

        // VersionInfo. VersionNum ::= '1.' [0-9]+; a 1.x document other
        // than 1.0 is processed as 1.0 (§2.8, erratum E10).
        let Some((version, pos)) = self.parse_pseudo_attribute(b"version")? else {
            return Err(match self.scanner.tok.kind {
                Kind::Name(n) if eq_ascii(n, b"encoding") || eq_ascii(n, b"standalone") => {
                    self.scanner.err(
                        self.scanner.tok.pos,
                        "The XML declaration must start with version=\"1.0\"",
                    )
                }
                Kind::Question => self.scanner.err(
                    self.scanner.tok.pos,
                    "The XML declaration must specify the version",
                ),
                _ => self.unexpected("version=\"1.0\" in the XML declaration"),
            });
        };
        if !(version.len() >= 3
            && starts_with_ascii(version, b"1.")
            && version[2..].iter().all(|u| u.low().is_ascii_digit()))
        {
            return Err(self.scanner.err_named(
                pos,
                "Unsupported XML version",
                version,
                " (this is an XML 1.0 parser)",
            ));
        }

        // EncodingDecl. EncName ::= [A-Za-z] ([A-Za-z0-9._] | '-')*
        let encoding = self.parse_pseudo_attribute(b"encoding")?;
        if let Some((name, pos)) = encoding {
            let valid = name.first().is_some_and(|u| u.low().is_ascii_alphabetic())
                && name.iter().all(|u| {
                    let c = u.low();
                    c.is_ascii_alphanumeric() || matches!(c, b'.' | b'_' | b'-')
                });
            if !valid {
                return Err(self.scanner.err_named(
                    pos,
                    "Invalid encoding name",
                    name,
                    " in the XML declaration",
                ));
            }
        }

        // SDDecl.
        if let Some((value, pos)) = self.parse_pseudo_attribute(b"standalone")? {
            match value {
                v if eq_ascii(v, b"yes") => self.scanner.standalone = true,
                v if eq_ascii(v, b"no") => {}
                _ => {
                    return Err(self.scanner.err_named(
                        pos,
                        "Invalid value",
                        value,
                        " for standalone in the XML declaration (expected yes or no)",
                    ));
                }
            }
        }

        // S? '?>'
        match self.scanner.tok.kind {
            Kind::Question => {
                self.advance()?;
                if self.scanner.tok.kind != Kind::Gt || self.scanner.tok.spaced {
                    return Err(self.unexpected("'?>' to end the XML declaration"));
                }
            }
            Kind::Name(name)
                if eq_ascii(name, b"version")
                    || eq_ascii(name, b"encoding")
                    || eq_ascii(name, b"standalone") =>
            {
                return Err(self.scanner.err_named(
                    self.scanner.tok.pos,
                    "Misplaced",
                    name,
                    " in the XML declaration (the order is version, encoding, standalone)",
                ));
            }
            Kind::Name(name) => {
                return Err(self.scanner.err_named(
                    self.scanner.tok.pos,
                    "Unexpected",
                    name,
                    " in the XML declaration (expected version, encoding or standalone)",
                ));
            }
            Kind::Eof(_) => {
                return Err(self.scanner.err(
                    self.scanner.tok.pos,
                    "Unterminated XML declaration: expected '?>'",
                ));
            }
            _ => return Err(self.unexpected("'?>' to end the XML declaration")),
        }

        if let Some((name, pos)) = encoding {
            self.scanner.apply_declared_encoding(name, pos)?;
        }
        Ok(())
    }

    /// `S name Eq "value"` in the XML declaration if the current token is
    /// `name`: returns the value and the name's position and advances past
    /// it; otherwise consumes nothing.
    fn parse_pseudo_attribute(&mut self, name: &'static [u8]) -> PResult<Option<(&'a [U], usize)>> {
        if !matches!(self.scanner.tok.kind, Kind::Name(n) if eq_ascii(n, name)) {
            return Ok(None);
        }
        self.require_spaced()?;
        let pos = self.scanner.tok.pos;
        self.advance()?;
        if self.scanner.tok.kind != Kind::Eq {
            return Err(self.unexpected("'=' after the name in the XML declaration"));
        }
        self.advance_literal(Literal::Plain)?;
        let Kind::Literal(value) = self.scanner.tok.kind else {
            return Err(self.unexpected("a quoted value in the XML declaration"));
        };
        self.advance()?;
        Ok(Some((value, pos)))
    }

    // ── document type declaration ──────────────────────────────────────────

    /// `doctypedecl` (§2.8 [28]); the current token is `<!DOCTYPE`. Ends on
    /// its `>`.
    fn parse_doctype(&mut self) -> PResult<()> {
        self.in_dtd = true;
        self.advance()?;
        self.expect_name("the document type name")?;
        self.require_spaced()?;
        self.advance()?;
        if matches!(self.scanner.tok.kind, Kind::Name(n) if eq_ascii(n, b"SYSTEM") || eq_ascii(n, b"PUBLIC"))
        {
            self.require_spaced()?;
            self.parse_external_id(ForNotation::No)?;
            self.scanner.has_external_subset = true;
        }
        match self.scanner.tok.kind {
            Kind::Gt => {}
            Kind::BracketOpen => {
                self.parse_internal_subset()?;
                self.advance()?;
                self.expect_gt("'>' to close the document type declaration")?;
            }
            _ => {
                return Err(
                    self.unexpected("SYSTEM, PUBLIC, '[' or '>' in the document type declaration")
                );
            }
        }
        self.in_dtd = false;
        Ok(())
    }

    /// `ExternalID` (§4.2.2 [75]) — or, for a NOTATION (`notation`, [83]),
    /// also a `PublicID` without system identifier; the current token is
    /// `SYSTEM` or `PUBLIC`. The identifiers are checked and dropped (nothing
    /// external is read). Ends on the token after the last literal.
    fn parse_external_id(&mut self, notation: ForNotation) -> PResult<()> {
        if matches!(self.scanner.tok.kind, Kind::Name(n) if eq_ascii(n, b"SYSTEM")) {
            self.advance_literal(Literal::System)?;
            if !matches!(self.scanner.tok.kind, Kind::Literal(_)) {
                return Err(self.unexpected("a quoted system identifier after SYSTEM"));
            }
            self.require_spaced()?;
            return self.advance();
        }
        self.advance_literal(Literal::Pubid)?;
        if !matches!(self.scanner.tok.kind, Kind::Literal(_)) {
            return Err(self.unexpected("a quoted public identifier after PUBLIC"));
        }
        self.require_spaced()?;
        self.advance_literal(Literal::System)?;
        if matches!(self.scanner.tok.kind, Kind::Literal(_)) {
            self.require_spaced()?;
            return self.advance();
        }
        if notation == ForNotation::Yes {
            return Ok(());
        }
        Err(self.unexpected("a quoted system identifier after the public identifier"))
    }

    /// Whether ENTITY and ATTLIST declarations are still processed: not
    /// after a reference to a parameter entity that was not read, unless
    /// standalone="yes" (§5.1).
    fn processing_declarations(&self) -> bool {
        self.scanner.standalone || !self.scanner.saw_unread_pe
    }

    /// `intSubset ::= (markupdecl | DeclSep)*` (§2.8 [28b]); the current
    /// token is `[`. Ends on the matching `]`.
    fn parse_internal_subset(&mut self) -> PResult<()> {
        loop {
            self.advance()?;
            let (pos, frame) = (self.scanner.tok.pos, self.scanner.tok.frame);
            let end_frame = match self.scanner.tok.kind {
                // Only the document's own `]` closes the subset (a frame
                // holding included declarations has a nonzero id).
                Kind::BracketClose if frame == 0 => return Ok(()),
                Kind::BracketClose => {
                    return Err(self.scanner.err(
                        pos,
                        "']' inside a parameter entity cannot close the internal subset",
                    ));
                }
                Kind::Comment(_) | Kind::Pi(..) => continue,
                Kind::PeReference(name) => {
                    self.scanner.include_parameter_entity(name, pos)?;
                    continue;
                }
                Kind::Decl(DeclKind::Element) => self.parse_element_decl()?,
                Kind::Decl(DeclKind::Attlist) => self.parse_attlist_decl()?,
                Kind::Decl(DeclKind::Entity) => self.parse_entity_decl()?,
                Kind::Decl(DeclKind::Notation) => self.parse_notation_decl()?,
                Kind::Decl(DeclKind::Doctype) => {
                    return Err(self
                        .scanner
                        .err(pos, "'<!DOCTYPE' cannot appear inside the internal subset"));
                }
                Kind::Eof(_) => {
                    return Err(self
                        .scanner
                        .err(pos, "Unterminated internal subset: expected ']'"));
                }
                _ => {
                    return Err(
                        self.unexpected("a markup declaration or ']' in the internal subset")
                    );
                }
            };
            // WFC: PE Between Declarations (and, for what is read, proper
            // declaration/PE nesting): a declaration ends in the entity it
            // began in.
            if end_frame != frame {
                return Err(self.scanner.err(
                    pos,
                    "A markup declaration must begin and end in the same entity",
                ));
            }
        }
    }

    /// `elementdecl` (§3.2 [45]); the current token is `<!ELEMENT`. The
    /// content model is checked and dropped. Returns the frame of its `>`.
    fn parse_element_decl(&mut self) -> PResult<u32> {
        self.advance()?;
        self.expect_name("an element name after '<!ELEMENT'")?;
        self.require_spaced()?;
        self.advance()?;
        match self.scanner.tok.kind {
            Kind::Name(n) if eq_ascii(n, b"EMPTY") || eq_ascii(n, b"ANY") => {
                self.require_spaced()?;
                self.advance()?;
            }
            Kind::ParenOpen => {
                self.require_spaced()?;
                self.advance()?;
                if matches!(self.scanner.tok.kind, Kind::Hash(n) if eq_ascii(n, b"PCDATA")) {
                    self.parse_mixed()?;
                } else {
                    self.parse_group()?;
                }
            }
            _ => return Err(self.unexpected("EMPTY, ANY or '(' in the element declaration")),
        }
        self.expect_gt("'>' to end the element declaration")
    }

    /// `Mixed` (§3.2.2 [51]) after `(`; the current token is `#PCDATA`.
    /// Ends on the token after the group (and its `*`).
    fn parse_mixed(&mut self) -> PResult<()> {
        let mut names = 0usize;
        loop {
            self.advance()?;
            match self.scanner.tok.kind {
                Kind::ParenClose => break,
                Kind::Bar => {
                    self.advance()?;
                    match self.scanner.tok.kind {
                        Kind::Name(_) => names += 1,
                        Kind::Hash(_) | Kind::ParenOpen => {
                            return Err(self.scanner.err(
                                self.scanner.tok.pos,
                                "Only element names may follow #PCDATA in a mixed content model",
                            ));
                        }
                        _ => return Err(self.unexpected("an element name after '|'")),
                    }
                }
                Kind::Comma => {
                    return Err(self.scanner.err(
                        self.scanner.tok.pos,
                        "A mixed content model is separated by '|', not ','",
                    ));
                }
                Kind::Question | Kind::Star | Kind::Plus
                    if !self.scanner.tok.spaced && names > 0 =>
                {
                    return Err(self.scanner.err(
                        self.scanner.tok.pos,
                        "Names in a mixed content model cannot have occurrence indicators",
                    ));
                }
                _ => return Err(self.unexpected("'|' or ')' in the mixed content model")),
            }
        }
        self.advance()?;
        match self.scanner.tok.kind {
            Kind::Star if !self.scanner.tok.spaced => self.advance(),
            Kind::Question | Kind::Plus if !self.scanner.tok.spaced => Err(self.scanner.err(
                self.scanner.tok.pos,
                "A mixed content model may only be followed by '*'",
            )),
            _ if names > 0 => Err(self.scanner.err(
                self.scanner.tok.pos,
                "A mixed content model with element names must end with ')*'",
            )),
            _ => Ok(()),
        }
    }

    /// The rest of a `choice` or `seq` (§3.2.1 [49] [50]) after `(`; the
    /// current token starts its first particle. Ends on the token after
    /// the group's `)` and occurrence indicator.
    fn parse_group(&mut self) -> PResult<()> {
        self.parse_particle()?;
        let mut separator: Option<Kind<'a, U>> = None;
        loop {
            match self.scanner.tok.kind {
                Kind::ParenClose => {
                    self.advance()?;
                    return self.parse_occurrence();
                }
                Kind::Bar | Kind::Comma => {
                    if *separator.get_or_insert(self.scanner.tok.kind) != self.scanner.tok.kind {
                        return Err(self.scanner.err(
                            self.scanner.tok.pos,
                            "A content model group cannot mix ',' and '|'",
                        ));
                    }
                    self.advance()?;
                    self.parse_particle()?;
                }
                _ => return Err(self.unexpected("')', '|' or ',' in the content model")),
            }
        }
    }

    /// `cp ::= (Name | choice | seq) ('?' | '*' | '+')?` (§3.2.1 [48]); the
    /// current token starts the particle. Ends on the token after it.
    fn parse_particle(&mut self) -> PResult<()> {
        if !self.stack_check.is_safe_to_recurse() {
            return Err(self.stack_overflow());
        }
        match self.scanner.tok.kind {
            Kind::Name(_) => {
                self.advance()?;
                self.parse_occurrence()
            }
            Kind::ParenOpen => {
                self.advance()?;
                self.parse_group()
            }
            Kind::Hash(n) if eq_ascii(n, b"PCDATA") => Err(self.scanner.err(
                self.scanner.tok.pos,
                "#PCDATA must come first in a content model, as (#PCDATA|a|b)*",
            )),
            _ => Err(self.unexpected("an element name or '(' in the content model")),
        }
    }

    /// An optional occurrence indicator, which must directly follow its
    /// particle.
    fn parse_occurrence(&mut self) -> PResult<()> {
        match self.scanner.tok.kind {
            Kind::Question | Kind::Star | Kind::Plus if !self.scanner.tok.spaced => self.advance(),
            Kind::Question | Kind::Star | Kind::Plus => Err(self.scanner.err(
                self.scanner.tok.pos,
                "An occurrence indicator must directly follow the name or ')' it applies to",
            )),
            _ => Ok(()),
        }
    }

    /// `AttlistDecl` (§3.3 [52]); the current token is `<!ATTLIST`. Returns
    /// the frame of its `>`.
    fn parse_attlist_decl(&mut self) -> PResult<u32> {
        self.advance()?;
        let element = self.expect_name("an element name after '<!ATTLIST'")?;
        self.require_spaced()?;
        loop {
            self.advance()?;
            let name = match self.scanner.tok.kind {
                Kind::Gt => return Ok(self.scanner.tok.frame),
                Kind::Name(name) => name,
                _ => {
                    return Err(
                        self.unexpected("an attribute name or '>' in the ATTLIST declaration")
                    );
                }
            };
            self.require_spaced()?;

            // AttType (§3.3.1): without validation only CDATA versus the
            // rest matters, for attribute-value normalization (§3.3.3).
            self.advance()?;
            let cdata = match self.scanner.tok.kind {
                Kind::Name(n) if eq_ascii(n, b"CDATA") => {
                    self.require_spaced()?;
                    true
                }
                Kind::Name(n) if eq_ascii(n, b"ID") || eq_ascii(n, b"IDREF") || eq_ascii(n, b"IDREFS") || eq_ascii(n, b"ENTITY") || eq_ascii(n, b"ENTITIES") || eq_ascii(n, b"NMTOKEN") || eq_ascii(n, b"NMTOKENS") => {
                    self.require_spaced()?;
                    false
                }
                Kind::Name(n) if eq_ascii(n, b"NOTATION") => {
                    self.require_spaced()?;
                    self.advance()?;
                    if self.scanner.tok.kind != Kind::ParenOpen {
                        return Err(self.unexpected("'(' after NOTATION"));
                    }
                    self.require_spaced()?;
                    self.parse_enumeration(EnumerationOf::NotationNames)?;
                    false
                }
                Kind::ParenOpen => {
                    self.require_spaced()?;
                    self.parse_enumeration(EnumerationOf::Nmtokens)?;
                    false
                }
                _ => return Err(self.unexpected("an attribute type (CDATA, ID, IDREF, IDREFS, ENTITY, ENTITIES, NMTOKEN, NMTOKENS, NOTATION or an enumeration)")),
            };

            // DefaultDecl (§3.3.2). The value is normalized as the type
            // says, like a specified one (§3.3.3).
            let literal = Literal::AttValue { collapse: !cdata };
            self.advance_literal(literal)?;
            let default = match self.scanner.tok.kind {
                Kind::Hash(n) if eq_ascii(n, b"REQUIRED") || eq_ascii(n, b"IMPLIED") => {
                    self.require_spaced()?;
                    None
                }
                Kind::Hash(n) if eq_ascii(n, b"FIXED") => {
                    self.require_spaced()?;
                    self.advance_literal(literal)?;
                    let Kind::Literal(value) = self.scanner.tok.kind else {
                        return Err(self.unexpected("a quoted default value after #FIXED"));
                    };
                    self.require_spaced()?;
                    Some(value)
                }
                Kind::Literal(value) => {
                    self.require_spaced()?;
                    Some(value)
                }
                _ => {
                    return Err(
                        self.unexpected("#REQUIRED, #IMPLIED, #FIXED or a quoted default value")
                    );
                }
            };

            if self.processing_declarations() {
                self.attlists.entry(element).or_default().declare(AttDef {
                    name,
                    cdata,
                    default,
                });
            }
        }
    }

    /// `'(' S? x (S? '|' S? x)* S? ')'` where `x` is a `Name` (NOTATION
    /// types, `names`) or an `Nmtoken` (enumerations); the current token is
    /// `(`. Ends on `)`.
    fn parse_enumeration(&mut self, names: EnumerationOf) -> PResult<()> {
        let names = names == EnumerationOf::NotationNames;
        loop {
            self.advance()?;
            match self.scanner.tok.kind {
                Kind::Name(_) => {}
                Kind::Nmtoken(_) if !names => {}
                _ if names => return Err(self.unexpected("a notation name")),
                _ => return Err(self.unexpected("a name token in the enumeration")),
            }
            self.advance()?;
            match self.scanner.tok.kind {
                Kind::Bar => {}
                Kind::ParenClose => return Ok(()),
                _ => return Err(self.unexpected("'|' or ')' in the enumeration")),
            }
        }
    }

    /// `EntityDecl` (§4.2 [70]); the current token is `<!ENTITY`. Returns
    /// the frame of its `>`.
    fn parse_entity_decl(&mut self) -> PResult<u32> {
        self.advance()?;
        if let Kind::PercentName(_) = self.scanner.tok.kind {
            return Err(self.scanner.err(
                self.scanner.tok.pos,
                "Whitespace is required between '%' and the name in a parameter entity declaration",
            ));
        }
        let parameter = self.scanner.tok.kind == Kind::Percent;
        if parameter {
            self.require_spaced()?;
            self.advance()?;
        }
        let name = self.expect_name(if parameter {
            "the parameter entity name after '%'"
        } else {
            "an entity name or '%' after '<!ENTITY'"
        })?;
        self.require_spaced()?;

        self.advance_literal(Literal::EntityValue)?;
        let value = match self.scanner.tok.kind {
            Kind::Literal(value) => {
                self.require_spaced()?;
                self.advance()?;
                EntityValue::Internal(value)
            }
            Kind::Name(n) if eq_ascii(n, b"SYSTEM") || eq_ascii(n, b"PUBLIC") => {
                self.require_spaced()?;
                self.parse_external_id(ForNotation::No)?;
                if matches!(self.scanner.tok.kind, Kind::Name(n) if eq_ascii(n, b"NDATA")) {
                    self.require_spaced()?;
                    if parameter {
                        return Err(self
                            .scanner
                            .err(self.scanner.tok.pos, "Parameter entities cannot have NDATA"));
                    }
                    self.advance()?;
                    self.expect_name("a notation name after NDATA")?;
                    self.require_spaced()?;
                    self.advance()?;
                    EntityValue::Unparsed
                } else {
                    EntityValue::External
                }
            }
            _ => return Err(self.unexpected("a quoted entity value, SYSTEM or PUBLIC")),
        };
        let frame = self.expect_gt("'>' to end the entity declaration")?;

        if self.processing_declarations() {
            let table = if parameter {
                &mut self.scanner.entities.parameter
            } else {
                &mut self.scanner.entities.general
            };
            // The first declaration is binding (§4.2).
            table.entry(name).or_insert_with(|| value);
        }
        Ok(frame)
    }

    /// `NotationDecl` (§4.7 [82]); the current token is `<!NOTATION`.
    /// Returns the frame of its `>`.
    fn parse_notation_decl(&mut self) -> PResult<u32> {
        self.advance()?;
        self.expect_name("a notation name after '<!NOTATION'")?;
        self.require_spaced()?;
        self.advance()?;
        if !matches!(self.scanner.tok.kind, Kind::Name(n) if eq_ascii(n, b"SYSTEM") || eq_ascii(n, b"PUBLIC"))
        {
            return Err(self.unexpected("SYSTEM or PUBLIC in the notation declaration"));
        }
        self.require_spaced()?;
        self.parse_external_id(ForNotation::Yes)?;
        self.expect_gt("'>' to end the notation declaration")
    }

    // ── elements ───────────────────────────────────────────────────────────

    /// The root `element` (§3.1 [39]) and everything inside it; the current
    /// token is its `<Name`. Iterative: `open` is the element stack.
    fn parse_tree(&mut self) -> PResult<()> {
        self.open_element()?;
        while let Some(&(name, frame)) = self.open.last() {
            // The common shapes straight off the index; everything else
            // through `next_content`'s tokens.
            if self.scanner.in_document() && self.scanner.idx.is_some() {
                match self.content_step(name, frame)? {
                    Step::Handled => continue,
                    Step::Slow => {}
                }
            }
            self.advance_content()?;
            match self.scanner.tok.kind {
                Kind::Text(text) => {
                    let loc = self.scanner.loc(self.scanner.tok.pos);
                    self.sink.text(text, loc);
                }
                Kind::StartTag(_) => self.open_element()?,
                Kind::EndTag(end_name) => {
                    let pos = self.scanner.tok.pos;
                    let end_frame = self.scanner.tok.frame;
                    self.close_element(name, frame, end_name, pos, end_frame)?;
                }
                Kind::Comment(text) => {
                    let loc = self.scanner.loc(self.scanner.tok.pos);
                    self.sink.comment(text, loc);
                }
                Kind::Pi(target, data) => {
                    let loc = self.scanner.loc(self.scanner.tok.pos);
                    self.sink.pi(target, data, loc);
                }
                Kind::Eof(_) => {
                    return Err(self.scanner.err_named(
                        self.scanner.tok.pos,
                        "Missing closing tag for element",
                        name,
                        "",
                    ));
                }
                _ => unreachable!("next_content produces text, tags and end of input"),
            }
        }
        Ok(())
    }

    /// The start tag whose `<Name` is the current token: attributes, then
    /// push the element (or finish it, for an empty-element tag).
    #[inline]
    fn open_element(&mut self) -> PResult<()> {
        let Token {
            kind: Kind::StartTag(name),
            pos,
            frame,
            ..
        } = self.scanner.tok
        else {
            unreachable!("open_element is called on a start tag");
        };
        if self.open.len() >= MAX_DEPTH {
            return Err(self.stack_overflow());
        }
        let loc = self.scanner.loc(pos);
        self.sink.begin_element(name, loc);
        let empty = self.parse_attributes(name)?;
        if empty {
            self.sink.end_element();
        } else if !self.leaf_fast(name, frame)? {
            self.open.push((name, frame));
        }
        Ok(())
    }

    /// The commonest element of all — plain text (or nothing) then its own
    /// end tag — finished without going round the content loop: `true` if
    /// that is what followed (and it is consumed), `false` (cursor unmoved)
    /// for the loop to take over.
    #[inline]
    fn leaf_fast(&mut self, name: &'a [U], frame: u32) -> PResult<bool> {
        let sc = &mut self.scanner;
        if !sc.in_document() || sc.idx.is_none() || sc.frame_id != frame {
            return Ok(false);
        }
        let src = sc.src;
        let start = sc.pos;
        let stop = sc.next_stop(STOP_CONTENT);
        let n = name.len();
        let close = stop + 2 + n;
        if close < src.len()
            && src[stop].low() == b'<'
            && src[stop + 1].low() == b'/'
            && src[close].low() == b'>'
            && name_eq(&src[stop + 2..close], name)
        {
            sc.pos = close + 1;
            sc.tag_degraded = false;
            let loc = sc.loc(start);
            self.sink.end_leaf(&src[start..stop], loc);
            return Ok(true);
        }
        Ok(false)
    }

    /// The checks on an end tag `</end_name` at `pos` for the open element
    /// `name`, its `>`, and pop.
    fn close_element(
        &mut self,
        name: &'a [U],
        frame: u32,
        end_name: &[U],
        pos: usize,
        end_frame: u32,
    ) -> PResult<()> {
        // WFC: Element Type Match.
        if !core::ptr::eq(end_name, name) && end_name != name {
            return Err(self.scanner.err_fmt(
                pos,
                format_args!(
                    "Expected closing tag </{}> but found </{}>",
                    Show(name, self.scanner.latin1),
                    Show(end_name, self.scanner.latin1)
                ),
            ));
        }
        if end_frame != frame {
            return Err(self.scanner.err_named(
                pos,
                "Element",
                name,
                " must start and end within the same entity",
            ));
        }
        if !self.scanner.take_gt() {
            self.advance()?;
            self.expect_gt("'>' to end the closing tag")?;
        }
        self.sink.end_element();
        self.open.pop();
        Ok(())
    }

    /// One item of element content in the document entity, straight off the
    /// index: a text run followed by a child's start tag or by the end tag of
    /// `name`. Everything else (references, comments, CDATA sections,
    /// processing instructions, line ends to normalize, errors) is `Slow`
    /// with the cursor back at the start of the run, for `next_content`.
    #[inline(always)]
    fn content_step(&mut self, name: &'a [U], frame: u32) -> PResult<Step> {
        let sc = &mut self.scanner;
        let src = sc.src;
        let start = sc.pos;
        let stop = sc.next_stop(STOP_CONTENT);
        if stop + 1 >= src.len() || src[stop].low() != b'<' {
            return Ok(Step::Slow);
        }
        let next = src[stop + 1].low();
        if next == b'!' || next == b'?' {
            return Ok(Step::Slow);
        }
        if stop > start {
            let loc = sc.loc(start);
            self.sink.text(&src[start..stop], loc);
        }
        if next == b'/' {
            sc.pos = stop + 2;
            let n = name.len();
            let fast_match = src.len() - sc.pos > n
                && name_eq(&src[sc.pos..sc.pos + n], name)
                && !is_name_char_ascii(src[sc.pos + n].low())
                && src[sc.pos + n].low() < 0x80;
            let end_name = if fast_match {
                sc.pos += n;
                name
            } else {
                sc.scan_name("Expected an element name after '</' but found")?
            };
            let end_frame = sc.frame_id;
            self.close_element(name, frame, end_name, stop, end_frame)?;
            return Ok(Step::Handled);
        }
        sc.pos = stop + 1;
        sc.tag_degraded = false;
        let child = sc.scan_name("Expected an element name after '<' but found")?;
        sc.tok = Token {
            kind: Kind::StartTag(child),
            pos: stop,
            frame: sc.frame_id,
            spaced: false,
        };
        self.open_element()?;
        Ok(Step::Handled)
    }

    /// The attributes of the start tag of `element`, streamed to the sink:
    /// duplicates rejected (WFC: Unique Att Spec), values normalized per
    /// their declared type (§3.3.3), declared defaults supplied (§3.3.2).
    /// Returns whether the tag was an empty-element tag.
    #[inline]
    fn parse_attributes(&mut self, element: &'a [U]) -> PResult<bool> {
        self.attribute_count = 0;
        // The element's ATTLIST, if any. It is not modified while a start tag
        // is read (declarations precede the root element), so a raw pointer
        // sidesteps borrowing `self` for the whole loop.
        let defs: Option<*const AttList<'a, U>> = if self.attlists.is_empty() {
            None
        } else {
            self.attlists.get(element).map(core::ptr::from_ref)
        };
        let collapse_for = |_: &HashMap<&'a [U], AttList<'a, U>>, name: &[U]| {
            // SAFETY: see `defs`.
            defs.is_some_and(|d| unsafe { &*d }.get(name).is_some_and(|def| !def.cdata))
        };
        let empty = loop {
            // The common shapes straight off the bytes; anything else (and
            // so every error) goes through the token path below.
            if self.scanner.in_document() {
                match self.scanner.tag_step() {
                    TagStep::End { empty } => break empty,
                    TagStep::Attr { name, pos, quote } => {
                        if self.has_attribute(name) {
                            return Err(self.scanner.err_named(
                                pos,
                                "Duplicate attribute",
                                name,
                                "",
                            ));
                        }
                        let collapse = collapse_for(&self.attlists, name);
                        let value = self.scanner.scan_att_value(quote, collapse)?;
                        self.push_attribute(name, value);
                        continue;
                    }
                    TagStep::Slow => {}
                }
            }
            self.scanner.next(Literal::None)?;
            let name = match self.scanner.tok.kind {
                Kind::Gt => break false,
                Kind::SlashGt => break true,
                Kind::Name(name) => name,
                _ => return Err(self.unexpected("an attribute name, '>' or '/>' in the start tag")),
            };
            self.require_spaced()?;
            let pos = self.scanner.tok.pos;
            if self.has_attribute(name) {
                return Err(self.scanner.err_named(pos, "Duplicate attribute", name, ""));
            }
            self.scanner.next(Literal::None)?;
            if self.scanner.tok.kind != Kind::Eq {
                return Err(self.unexpected("'=' after the attribute name"));
            }
            let collapse = collapse_for(&self.attlists, name);
            self.scanner.next(Literal::AttValue { collapse })?;
            let Kind::Literal(value) = self.scanner.tok.kind else {
                return Err(self.unexpected("a quoted attribute value"));
            };
            self.push_attribute(name, value);
        };
        if let Some(defs) = defs {
            // SAFETY: see `defs`.
            let defs = unsafe { &*defs };
            for def in &defs.defs {
                if let Some(value) = def.default
                    && !self.has_attribute(def.name)
                {
                    self.push_attribute(def.name, value);
                }
            }
        }
        Ok(empty)
    }

    #[inline(always)]
    fn has_attribute(&self, name: &[U]) -> bool {
        if self.attribute_count <= LINEAR_ATTRIBUTE_LIMIT {
            self.attribute_first[..self.attribute_count]
                .iter()
                .any(|&first| name_eq(first, name))
        } else {
            self.attribute_names.contains_key(name)
        }
    }

    #[inline(always)]
    fn push_attribute(&mut self, name: &'a [U], value: &'a [U]) {
        self.sink.attribute(name, value);
        if self.attribute_count < LINEAR_ATTRIBUTE_LIMIT {
            self.attribute_first[self.attribute_count] = name;
        } else {
            self.spill_attribute_name(name);
        }
        self.attribute_count += 1;
    }

    #[cold]
    fn spill_attribute_name(&mut self, name: &'a [U]) {
        if self.attribute_count == LINEAR_ATTRIBUTE_LIMIT {
            self.attribute_names.clear();
            for first in self.attribute_first {
                self.attribute_names.insert(first, ());
            }
        }
        self.attribute_names.insert(name, ());
    }
}

/// The extra normalization for attributes declared with a tokenized or
/// enumerated type (§3.3.3): leading and trailing spaces removed, runs of
/// spaces collapsed. All whitespace in `value` is already #x20.
fn collapse_spaces<'a, U: Unit>(bump: &'a Bump, value: &'a [U]) -> &'a [U] {
    // All whitespace in `value` is already #x20, so `trim_ws` trims spaces.
    let trimmed = trim_ws(value);
    if find_ascii(trimmed, b"  ").is_none() {
        return trimmed;
    }
    let mut out: ArenaVec<'a, U> = ArenaVec::with_capacity_in(trimmed.len(), bump);
    let mut previous_space = false;
    for &c in trimmed {
        let space = c.low() == b' ';
        if !space || !previous_space {
            out.push(c);
        }
        previous_space = space;
    }
    out.into_bump_slice()
}
