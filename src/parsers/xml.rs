//! XML 1.0 (Fifth Edition) scanner/parser — a non-validating processor that
//! does not read external entities (§5.1).
//!
//! Architecture (mirrors `yaml.rs`): the scanner turns bytes into tokens and
//! the parser is recursive descent over tokens, never touching source bytes.
//! Outside element content XML's lexical grammar is uniform — names, quoted
//! literals, a handful of punctuation marks and the `<!…` / `<?…` openers —
//! so a single `Scanner::next` loop serves the XML declaration, the document
//! type declaration with its internal subset, and tags: it walks byte by
//! byte, whitespace is just an arm that advances and continues, and every
//! other byte immediately identifies the token to scan. Where the grammar
//! makes whitespace required or forbidden (§2.3 `S`, `)*`, `?>`), the parser
//! checks the token's `spaced` flag. The one context-sensitive lexeme is the
//! quoted literal (`AttValue`, `EntityValue`, `SystemLiteral` and
//! `PubidLiteral` decode differently), so `next` takes the `Literal` kind the
//! parser's grammar position calls for. Element content, where whitespace is
//! character data, has its own loop (`Scanner::next_content`).
//!
//! Entity replacement (§4.4) is character-level substitution, so it lives in
//! the scanner: an entity reference in a context where the spec says
//! "included" pushes the replacement text as a new input frame and scanning
//! continues there. Tokens carry the id of the frame they came from so the
//! parser can enforce the structural rules (an element or markup declaration
//! must start and end in the same entity). The parser feeds declarations from
//! the internal DTD subset back to the scanner's entity tables; per §5.1 those
//! declarations are used to expand internal entities, supply attribute
//! defaults, and normalize attribute values, and declarations after a
//! reference to a parameter entity that is not read are ignored (unless
//! `standalone="yes"`).
//!
//! Two JS value shapes are built from the same token stream (see `Sink`): the
//! compact object (`{"@attr": .., child: .., "#text": ..}`) used by
//! `Bun.XML.parse` by default and by the module loader, and the ordered node
//! tree (`{name, attributes, children}`) for `{ compact: false }`.

use bun_alloc::Arena as Bump;
use bun_alloc::ArenaVec;
use bun_alloc::ArenaVecExt as _;
use bun_ast::{self as ast, E, Expr, G, Loc, Log, Source};
use bun_collections::{HashMap, VecExt};
use bun_core::{StackCheck, strings};
use bun_simdutf_sys::simdutf;

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
}

impl XML {
    pub fn parse<'a>(
        source: &'a Source,
        log: &mut Log,
        bump: &'a Bump,
        options: Options,
    ) -> crate::Result<Expr> {
        bun_core::analytics::Features::xml_parse_inc();
        let result = if options.compact {
            Parser::new(source, log, bump, options, CompactSink::new(bump)).parse_document()
        } else {
            Parser::new(source, log, bump, options, NodeSink::new(bump)).parse_document()
        };
        match result {
            Ok(root) => Ok(root),
            Err(PErr::Syntax) => Err(crate::Error::SyntaxError),
            Err(PErr::Oom) => Err(crate::Error::Alloc(bun_alloc::AllocError)),
            Err(PErr::StackOverflow) => Err(crate::Error::StackOverflow),
        }
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum PErr {
    /// Already logged.
    Syntax,
    Oom,
    StackOverflow,
}

impl From<bun_alloc::AllocError> for PErr {
    fn from(_: bun_alloc::AllocError) -> Self {
        PErr::Oom
    }
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

// ── character classes ───────────────────────────────────────────────────────

/// `S` (§2.3 [3]).
#[inline]
fn is_ws(c: u8) -> bool {
    matches!(c, b' ' | b'\t' | b'\n' | b'\r')
}

#[inline]
fn is_name_start_ascii(c: u8) -> bool {
    c.is_ascii_alphabetic() || c == b'_' || c == b':'
}

#[inline]
fn is_name_char_ascii(c: u8) -> bool {
    is_name_start_ascii(c) || c.is_ascii_digit() || c == b'-' || c == b'.'
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

/// The `S` characters, for `strings::trim`.
const XML_WS: &[u8] = b" \t\n\r";

// ── tokens ──────────────────────────────────────────────────────────────────

/// What the scanner hands the parser: `Scanner::next` produces everything
/// but `Text`; `Scanner::next_content` produces `Text`, the tags and `Eof`.
#[derive(Clone, Copy)]
struct Token<'a> {
    kind: Kind<'a>,
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
enum Kind<'a> {
    /// The end of the document or, with its name, of an entity's replacement
    /// text where that is not simply the end of an inclusion.
    Eof(Option<&'a [u8]>),
    /// `Name` (§2.3 [5]); keywords such as `SYSTEM` or `CDATA` are names too.
    Name(&'a [u8]),
    /// A run of name characters that does not start with a `NameStartChar`,
    /// so only an `Nmtoken` (§2.3 [7]).
    Nmtoken(&'a [u8]),
    /// `#` and a name: `#PCDATA`, `#REQUIRED`, `#IMPLIED`, `#FIXED`.
    Hash(&'a [u8]),
    /// `%Name;` outside parameter-entity replacement text (inside it, a
    /// reference is included in place, §4.4.8, and never surfaces).
    PeReference(&'a [u8]),
    /// `%` not followed by a name: the parameter-entity declaration marker.
    Percent,
    /// `%Name` with no `;`: a malformed reference — or, right after
    /// `<!ENTITY`, a parameter-entity declaration missing its space.
    PercentName(&'a [u8]),
    /// A quoted literal, read as the `Literal` kind the parser asked for.
    Literal {
        value: &'a [u8],
        is_ascii: bool,
    },
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
    /// A comment or processing instruction, checked and dropped.
    Comment,
    Pi,
    /// `<Name`
    StartTag(&'a [u8]),
    /// `</Name`
    EndTag(&'a [u8]),
    /// Character data with CDATA sections, references and included entities
    /// folded in.
    Text {
        text: &'a [u8],
        is_ascii: bool,
    },
    /// A character that cannot start any token; always an error, which the
    /// parser reports along with what it expected there.
    Unexpected(u32),
}

impl core::fmt::Display for Kind<'_> {
    /// How a token is named in "but found …" diagnostics.
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        let name = |f: &mut core::fmt::Formatter<'_>, prefix: &str, name: &[u8], suffix: &str| {
            write!(f, "'{}{}{}'", prefix, bstr::BStr::new(name), suffix)
        };
        match *self {
            Kind::Eof(Some(entity)) => write!(f, "the end of entity '{}'", bstr::BStr::new(entity)),
            Kind::Eof(None) => f.write_str("end of input"),
            Kind::Name(n) | Kind::Nmtoken(n) => name(f, "", n, ""),
            Kind::Hash(n) => name(f, "#", n, ""),
            Kind::PeReference(n) => name(f, "%", n, ";"),
            Kind::Percent => f.write_str("'%'"),
            Kind::PercentName(n) => name(f, "%", n, ""),
            Kind::Literal { .. } => f.write_str("a quoted string"),
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
            Kind::Comment => f.write_str("a comment"),
            Kind::Pi => f.write_str("a processing instruction"),
            Kind::StartTag(n) => name(f, "<", n, ""),
            Kind::EndTag(n) => name(f, "</", n, ""),
            Kind::Text { .. } => f.write_str("text"),
            Kind::Unexpected(cp) => match char::from_u32(cp) {
                Some(c) if c.is_ascii_graphic() => write!(f, "'{}'", c),
                Some(c) if !c.is_control() => write!(f, "'{}' (U+{:04X})", c, cp),
                _ => write!(f, "U+{:04X}", cp),
            },
        }
    }
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
enum EntityValue<'a> {
    /// Replacement text: character references (and, in text that came from
    /// a parameter entity, parameter-entity references) already resolved,
    /// general entity references bypassed (§4.4.7), line ends normalized.
    Internal(&'a [u8]),
    /// Declared SYSTEM/PUBLIC; never read.
    External,
    /// External with NDATA — not a parsed entity at all.
    Unparsed,
}

struct Entities<'a> {
    general: HashMap<&'a [u8], EntityValue<'a>>,
    parameter: HashMap<&'a [u8], EntityValue<'a>>,
}

fn predefined_entity(name: &[u8]) -> Option<u8> {
    match name {
        b"lt" => Some(b'<'),
        b"gt" => Some(b'>'),
        b"amp" => Some(b'&'),
        b"apos" => Some(b'\''),
        b"quot" => Some(b'"'),
        _ => None,
    }
}

/// What a general entity reference contributes where it is included.
enum Resolved<'a> {
    /// A predefined entity's character.
    Byte(u8),
    /// Replacement text to scan in a new input frame.
    Text(&'a [u8]),
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

struct Frame<'a> {
    src: &'a [u8],
    pos: usize,
    id: u32,
    kind: FrameKind,
    /// The entity this frame is the replacement text of: (name, is-parameter).
    entity: Option<(&'a [u8], bool)>,
    /// Where diagnostics for tokens read from this frame point: the position
    /// of the outermost reference in the document.
    report_pos: usize,
}

// ── scanner ─────────────────────────────────────────────────────────────────

/// Owns the byte cursor, the input-frame stack and the entity tables; the
/// only component that reads bytes.
struct Scanner<'a, 'log> {
    /// The frame being read (the fields of `Frame`, unpacked for the hot
    /// path); enclosing frames wait in `suspended`.
    src: &'a [u8],
    pos: usize,
    frame_id: u32,
    frame_kind: FrameKind,
    frame_entity: Option<(&'a [u8], bool)>,
    frame_report_pos: usize,
    suspended: Vec<Frame<'a>>,
    next_frame_id: u32,

    entities: Entities<'a>,
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
    bump: &'a Bump,
    source: &'a Source,
    log: &'log mut Log,
}

impl<'a, 'log> Scanner<'a, 'log> {
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
        name: &[u8],
        after: &'static str,
    ) -> PErr {
        self.err_fmt(
            pos,
            format_args!("{} '{}'{}", before, bstr::BStr::new(name), after),
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
                    format_args!("{} the end of entity '{}'", what, bstr::BStr::new(name)),
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
            self.src[pos]
        } else {
            0
        }
    }

    /// End of the current frame (not necessarily of the document).
    #[inline]
    fn at_end(&self) -> bool {
        self.pos >= self.src.len()
    }

    #[inline]
    fn starts_with(&self, s: &[u8]) -> bool {
        self.src[self.pos.min(self.src.len())..].starts_with(s)
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
        let first = self.peek();
        let len = strings::wtf8_byte_sequence_length(first);
        if len == 1 || self.pos + usize::from(len) > self.src.len() {
            return (u32::from(first), 1);
        }
        let mut bytes = [0u8; 4];
        bytes[..usize::from(len)].copy_from_slice(&self.src[self.pos..self.pos + usize::from(len)]);
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
        let (cp, len) = self.decode_utf8();
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
        text: &'a [u8],
        kind: FrameKind,
        entity: (&'a [u8], bool),
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
        name: &'a [u8],
        ref_pos: usize,
        in_attribute: bool,
    ) -> PResult<Resolved<'a>> {
        if let Some(c) = predefined_entity(name) {
            return Ok(Resolved::Byte(c));
        }
        match self.entities.general.get(name).copied() {
            Some(EntityValue::Internal(text)) => Ok(Resolved::Text(text)),
            // WFC: No External Entity References.
            Some(EntityValue::External) if in_attribute => Err(self.err_named(
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
    fn push_reference(buf: &mut ArenaVec<'a, u8>, name: &[u8], is_ascii: &mut bool) {
        *is_ascii &= name.is_ascii();
        buf.push(b'&');
        buf.extend_from_slice(name);
        buf.push(b';');
    }

    /// Includes the parameter entity `name` as declarations (§4.4.8): pushes
    /// its replacement text (the caller accounts for the space it counts as
    /// on either side), or records that an entity that is not read was
    /// referenced.
    fn include_parameter_entity(&mut self, name: &'a [u8], ref_pos: usize) -> PResult<()> {
        self.saw_pe_reference = true;
        match self.entities.parameter.get(name).copied() {
            Some(EntityValue::Internal(text)) => {
                self.push_frame(text, FrameKind::Declarations, (name, true), ref_pos)
            }
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
        let bytes = self.src;
        if bytes.starts_with(b"\xEF\xBB\xBF") {
            self.pos = 3;
            self.saw_utf8_bom = true;
        } else if self.encoding == InputEncoding::Text {
            // A JS string is characters, not bytes: nothing to detect.
        } else if bytes.starts_with(b"\xFE\xFF") {
            self.transcode_utf16(&bytes[2..], true)?;
        } else if bytes.starts_with(b"\xFF\xFE") {
            self.transcode_utf16(&bytes[2..], false)?;
        } else if bytes.starts_with(b"\x00<") {
            self.transcode_utf16(bytes, true)?;
            self.needs_utf16_declaration = true;
        } else if bytes.starts_with(b"<\x00") {
            self.transcode_utf16(bytes, false)?;
            self.needs_utf16_declaration = true;
        }
        self.content_start = self.pos;
        Ok(self.starts_with(b"<?xml") && is_ws(self.peek_at(self.pos + 5)))
    }

    /// The input must be valid UTF-8 (§4.3.3: malformed byte sequences are
    /// fatal). Run after the XML declaration — whose encoding may first
    /// cause the input to be transcoded — and before anything is decoded.
    fn validate_utf8(&mut self) -> PResult<()> {
        let result = simdutf::validate::with_errors::utf8(self.src);
        if result.is_successful() {
            Ok(())
        } else {
            Err(self.err(result.count, "Invalid UTF-8"))
        }
    }

    fn transcode_utf16(&mut self, payload: &[u8], big_endian: bool) -> PResult<()> {
        let (pairs, rest) = payload.as_chunks::<2>();
        if !rest.is_empty() {
            return Err(self.err(payload.len(), "UTF-16 input has an odd number of bytes"));
        }
        let units: Vec<u16> = pairs
            .iter()
            .map(|&p| {
                if big_endian {
                    u16::from_be_bytes(p)
                } else {
                    u16::from_le_bytes(p)
                }
            })
            .collect();
        let mut utf8 = vec![0u8; simdutf::length::utf8::from::utf16::le(&units)];
        let result = simdutf::convert::utf16::to::utf8::with_errors::le(&units, &mut utf8);
        if !result.is_successful() {
            return Err(self.err(result.count * 2, "Invalid UTF-16"));
        }
        utf8.truncate(result.count);
        self.src = self.bump.alloc_slice_copy(&utf8);
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
    fn apply_declared_encoding(&mut self, name: &[u8], pos: usize) -> PResult<()> {
        if self.encoding == InputEncoding::Text {
            return Ok(());
        }
        let is = |canonical: &str| name.eq_ignore_ascii_case(canonical.as_bytes());
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
            if let Some(utf8) = strings::to_utf8_from_latin1(&self.src[self.pos..]) {
                self.src = self.bump.alloc_slice_copy(&utf8);
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
    fn scan_name(&mut self, what: &'static str) -> PResult<&'a [u8]> {
        let start = self.pos;
        if !self.at_name_start() {
            return Err(self.err_here(what));
        }
        let (_, len) = self.decode_utf8();
        self.pos += len;
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
    fn scan_name_run(&mut self) -> Option<(&'a [u8], bool)> {
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
    fn scan_reference_name(&mut self, what: &'static str) -> PResult<&'a [u8]> {
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

    fn push_code_point(buf: &mut ArenaVec<'a, u8>, cp: u32, is_ascii: &mut bool) {
        let mut tmp = [0u8; 4];
        let n = strings::encode_wtf8_rune(&mut tmp, cp);
        if cp >= 0x80 {
            *is_ascii = false;
        }
        buf.extend_from_slice(&tmp[..n]);
    }

    /// Copies the borrowed run `src[start..end]` into a buffer the first
    /// time decoding has to diverge from the source bytes.
    fn materialize<'b>(
        bump: &'a Bump,
        src: &[u8],
        start: usize,
        end: usize,
        buf: &'b mut Option<ArenaVec<'a, u8>>,
    ) -> &'b mut ArenaVec<'a, u8> {
        if buf.is_none() {
            let mut b: ArenaVec<'a, u8> = ArenaVec::with_capacity_in(end - start + 32, bump);
            b.extend_from_slice(&src[start..end]);
            *buf = Some(b);
        }
        buf.as_mut().expect("just set")
    }

    /// A `Plain`, `System` or `Pubid` literal after the opening quote: no
    /// references are recognized; the kinds differ only in the characters
    /// they admit. Returns (value, is_ascii).
    fn scan_simple_literal(
        &mut self,
        quote: u8,
        open: usize,
        literal: Literal,
    ) -> PResult<(&'a [u8], bool)> {
        let start = self.pos;
        let mut is_ascii = true;
        loop {
            match self.peek() {
                _ if self.at_end() => return Err(self.err(open, "Unterminated quoted string")),
                c if c == quote => {
                    let value = &self.src[start..self.pos];
                    self.pos += 1;
                    return Ok((value, is_ascii));
                }
                c if literal == Literal::Pubid && !is_pubid_char(c) => {
                    return Err(self.err_here("Invalid character in a public identifier:"));
                }
                b'<' | b'>' if literal == Literal::Plain => {
                    return Err(self.err_here("Invalid character in a quoted string:"));
                }
                c if c >= 0x80 => {
                    is_ascii = false;
                    self.pos += self.check_non_ascii_char()?;
                }
                c if c < 0x20 && !is_ws(c) => return Err(self.err_invalid_char()),
                _ => self.pos += 1,
            }
        }
    }

    /// `AttValue` (§2.3 [10]) after the opening quote, normalized per §3.3.3:
    /// a character reference appends the character, an entity reference
    /// appends its (recursively normalized) replacement text, a whitespace
    /// character appends a space; then, for a tokenized type (`collapse`),
    /// spaces are trimmed and collapsed. Returns (value, is_ascii).
    fn scan_att_value(&mut self, quote: u8, collapse: bool) -> PResult<(&'a [u8], bool)> {
        let literal_frame = self.frame_id;
        let open_pos = self.here();
        // The value borrows `src[start..]` until normalization or a
        // reference forces a copy; once `buf` exists everything is appended.
        let start = self.pos;
        let mut buf: Option<ArenaVec<'a, u8>> = None;
        let mut is_ascii = true;
        loop {
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
                    let value = if collapse {
                        collapse_spaces(self.bump, value)
                    } else {
                        value
                    };
                    return Ok((value, is_ascii));
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
                        Self::push_code_point(b, cp, &mut is_ascii);
                    } else {
                        let name = self
                            .scan_reference_name("Expected an entity name after '&' but found")?;
                        match self.resolve_general_entity(name, ref_pos, true)? {
                            Resolved::Byte(byte) => b.push(byte),
                            Resolved::Text(text) => {
                                self.push_frame(text, FrameKind::Literal, (name, false), ref_pos)?
                            }
                            Resolved::Unexpanded => Self::push_reference(b, name, &mut is_ascii),
                        }
                    }
                }
                b'\r' if self.in_document() => {
                    // A line end in the document (CR or CRLF) is one #xA,
                    // hence one space.
                    Self::materialize(self.bump, self.src, start, self.pos, &mut buf).push(b' ');
                    self.pos += 1;
                    if self.peek() == b'\n' {
                        self.pos += 1;
                    }
                }
                b'\t' | b'\n' | b'\r' => {
                    Self::materialize(self.bump, self.src, start, self.pos, &mut buf).push(b' ');
                    self.pos += 1;
                }
                _ if c < 0x20 => return Err(self.err_invalid_char()),
                _ => {
                    let len = if c >= 0x80 {
                        is_ascii = false;
                        self.check_non_ascii_char()?
                    } else {
                        1
                    };
                    if let Some(b) = buf.as_mut() {
                        b.extend_from_slice(&self.src[self.pos..self.pos + len]);
                    }
                    self.pos += len;
                }
            }
        }
    }

    /// `EntityValue` (§2.3 [9]) after the opening quote: character
    /// references are included; parameter-entity references are included in
    /// literal, which is only legal outside the internal subset proper (WFC:
    /// PEs in Internal Subset); general entity references are bypassed —
    /// checked for form and kept verbatim (§4.4.7).
    fn scan_entity_value(&mut self, quote: u8) -> PResult<(&'a [u8], bool)> {
        let literal_frame = self.frame_id;
        let in_internal_subset = self.in_document();
        let open_pos = self.here();
        let mut buf: ArenaVec<'a, u8> = ArenaVec::with_capacity_in(32, self.bump);
        let mut is_ascii = true;
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
                    return Ok((buf.into_bump_slice(), is_ascii));
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
                        Some(EntityValue::Internal(text)) => {
                            self.push_frame(text, FrameKind::Literal, (name, true), ref_pos)?
                        }
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
                        Self::push_code_point(&mut buf, cp, &mut is_ascii);
                    } else {
                        let name = self
                            .scan_reference_name("Expected an entity name after '&' but found")?;
                        Self::push_reference(&mut buf, name, &mut is_ascii);
                    }
                }
                b'\r' if self.in_document() => {
                    buf.push(b'\n');
                    self.pos += 1;
                    if self.peek() == b'\n' {
                        self.pos += 1;
                    }
                }
                _ if c < 0x20 && !is_ws(c) => return Err(self.err_invalid_char()),
                _ => {
                    let len = if c >= 0x80 {
                        is_ascii = false;
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

    // ── comments and processing instructions ───────────────────────────────

    /// The rest of a comment after `<!--` (§2.5 [15]); dropped.
    fn scan_comment(&mut self, start_pos: usize) -> PResult<()> {
        loop {
            match self.peek() {
                _ if self.at_end() => return Err(self.err(start_pos, "Unterminated comment")),
                b'-' if self.peek_at(self.pos + 1) == b'-' => {
                    if self.peek_at(self.pos + 2) != b'>' {
                        return Err(self.err(self.here(), "'--' is not allowed inside a comment"));
                    }
                    self.pos += 3;
                    return Ok(());
                }
                c if c >= 0x80 => self.pos += self.check_non_ascii_char()?,
                c if c < 0x20 && !is_ws(c) => return Err(self.err_invalid_char()),
                _ => self.pos += 1,
            }
        }
    }

    /// The rest of a processing instruction after `<?` (§2.6 [16]); target
    /// and data are checked and dropped. Returns `true` instead, leaving the
    /// pseudo-attributes unread, when this is the XML declaration: `<?xml`
    /// as the very first thing in the document.
    fn scan_pi(&mut self, start_pos: usize) -> PResult<bool> {
        let at_document_start = self.in_document() && start_pos == self.content_start;
        let target =
            self.scan_name("Expected a processing instruction target after '<?' but found")?;
        if target == b"xml" && at_document_start {
            return Ok(true);
        }
        if target.eq_ignore_ascii_case(b"xml") {
            return Err(self.err(
                start_pos,
                "'<?xml' is reserved for the XML declaration, which is only allowed at the very start of the document",
            ));
        }
        if self.starts_with(b"?>") {
            self.pos += 2;
            return Ok(false);
        }
        if !is_ws(self.peek()) {
            return Err(self.err_here(
                "Expected whitespace or '?>' after the processing instruction target but found",
            ));
        }
        loop {
            match self.peek() {
                _ if self.at_end() => {
                    return Err(self.err(start_pos, "Unterminated processing instruction"));
                }
                b'?' if self.peek_at(self.pos + 1) == b'>' => {
                    self.pos += 2;
                    return Ok(false);
                }
                c if c >= 0x80 => self.pos += self.check_non_ascii_char()?,
                c if c < 0x20 && !is_ws(c) => return Err(self.err_invalid_char()),
                _ => self.pos += 1,
            }
        }
    }

    // ── tokens: markup ─────────────────────────────────────────────────────

    /// The next token anywhere outside element content. Whitespace between
    /// tokens is consumed here and reported as `Token::spaced`; a quoted
    /// literal is read the way `literal` says.
    fn next(&mut self, literal: Literal) -> PResult<Token<'a>> {
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
                b'<' => match self.peek_at(self.pos + 1) {
                    b'?' => {
                        self.pos += 2;
                        if self.scan_pi(pos)? {
                            break (Kind::XmlDecl, pos);
                        }
                        break (Kind::Pi, pos);
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
                            self.scan_comment(pos)?;
                            break (Kind::Comment, pos);
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
                            return Err(
                                self.err(pos, "CDATA sections are only allowed inside elements")
                            );
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
                },
                b'"' | b'\'' => {
                    self.pos += 1;
                    let (value, is_ascii) = match literal {
                        Literal::None => break (Kind::Unexpected(u32::from(c)), pos),
                        Literal::AttValue { collapse } => self.scan_att_value(c, collapse)?,
                        Literal::EntityValue => self.scan_entity_value(c)?,
                        Literal::Plain | Literal::System | Literal::Pubid => {
                            self.scan_simple_literal(c, pos, literal)?
                        }
                    };
                    break (Kind::Literal { value, is_ascii }, pos);
                }
                b'=' => {
                    self.pos += 1;
                    break (Kind::Eq, pos);
                }
                b'>' => {
                    self.pos += 1;
                    break (Kind::Gt, pos);
                }
                b'/' => {
                    self.pos += 1;
                    if self.peek() != b'>' {
                        return Err(self.err_here("Expected '>' after '/' but found"));
                    }
                    self.pos += 1;
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
        Ok(Token {
            kind,
            pos,
            frame: self.frame_id,
            spaced,
        })
    }

    // ── tokens: element content ────────────────────────────────────────────

    /// The next token inside an element: one maximal `Text` run (CDATA
    /// sections, references and included entities folded in, comments and
    /// processing instructions dropped), a `StartTag` or `EndTag`, or `Eof`.
    fn next_content(&mut self) -> PResult<Token<'a>> {
        // The run borrows `src[start..pos]` while it is a plain slice of
        // one frame; the first divergence copies it into `buf`, after which
        // everything is appended to `buf` and `start` is kept at `pos`.
        let mut start = self.pos;
        let text_pos = self.here();
        let mut buf: Option<ArenaVec<'a, u8>> = None;
        let mut is_ascii = true;

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
        // skips non-text bytes or changes frame.
        macro_rules! flush {
            () => {
                Self::materialize(self.bump, self.src, start, self.pos, &mut buf)
            };
        }

        loop {
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
                        return Ok(self.finish_text(start, buf, is_ascii, text_pos));
                    }
                    return Ok(Token {
                        kind: Kind::Eof(self.frame_entity.map(|(name, _)| name)),
                        pos: self.here(),
                        frame: self.frame_id,
                        spaced: false,
                    });
                }
                b'<' => {
                    let pos = self.here();
                    let next = self.peek_at(self.pos + 1);
                    if next == b'!' && self.starts_with(b"<!--") {
                        flush!();
                        self.pos += 4;
                        self.scan_comment(pos)?;
                        start = self.pos;
                    } else if next == b'!' && self.starts_with(b"<![CDATA[") {
                        let b = flush!();
                        self.pos += 9;
                        loop {
                            let c = self.peek();
                            match c {
                                _ if self.at_end() => {
                                    return Err(self.err(pos, "Unterminated CDATA section"));
                                }
                                b']' if self.starts_with(b"]]>") => {
                                    self.pos += 3;
                                    break;
                                }
                                b'\r' if self.frame_kind == FrameKind::Document => {
                                    b.push(b'\n');
                                    self.pos += 1;
                                    if self.peek() == b'\n' {
                                        self.pos += 1;
                                    }
                                }
                                _ => {
                                    let len = if c >= 0x80 {
                                        is_ascii = false;
                                        self.check_non_ascii_char()?
                                    } else if c < 0x20 && !is_ws(c) {
                                        return Err(self.err_invalid_char());
                                    } else {
                                        1
                                    };
                                    b.extend_from_slice(&self.src[self.pos..self.pos + len]);
                                    self.pos += len;
                                }
                            }
                        }
                        start = self.pos;
                    } else if next == b'?' {
                        flush!();
                        self.pos += 2;
                        let is_xml_decl = self.scan_pi(pos)?;
                        debug_assert!(!is_xml_decl, "content never starts the document");
                        start = self.pos;
                    } else if have_text!() {
                        // A tag ends the run; leave it for the next call.
                        return Ok(self.finish_text(start, buf, is_ascii, text_pos));
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
                        return Ok(Token {
                            kind,
                            pos,
                            frame,
                            spaced: false,
                        });
                    }
                }
                b'&' => {
                    let ref_pos = self.here();
                    let b = flush!();
                    self.pos += 1;
                    if self.peek() == b'#' {
                        self.pos += 1;
                        let cp = self.scan_char_ref(ref_pos)?;
                        Self::push_code_point(b, cp, &mut is_ascii);
                        start = self.pos;
                    } else {
                        let name = self
                            .scan_reference_name("Expected an entity name after '&' but found")?;
                        match self.resolve_general_entity(name, ref_pos, false)? {
                            Resolved::Byte(byte) => b.push(byte),
                            Resolved::Text(text) => {
                                self.push_frame(text, FrameKind::Content, (name, false), ref_pos)?
                            }
                            Resolved::Unexpanded => Self::push_reference(b, name, &mut is_ascii),
                        }
                        start = self.pos;
                    }
                }
                b']' if self.starts_with(b"]]>") => {
                    return Err(self.err(
                        self.here(),
                        "']]>' is only allowed as the end of a CDATA section",
                    ));
                }
                b'\r' if self.frame_kind == FrameKind::Document => {
                    flush!().push(b'\n');
                    self.pos += 1;
                    if self.peek() == b'\n' {
                        self.pos += 1;
                    }
                    start = self.pos;
                }
                _ if c < 0x20 && !is_ws(c) => return Err(self.err_invalid_char()),
                _ => {
                    // A run of ordinary character data up to the next byte
                    // that needs one of the arms above.
                    let run_start = self.pos;
                    loop {
                        let c = self.peek();
                        if c >= 0x80 {
                            is_ascii = false;
                            self.pos += self.check_non_ascii_char()?;
                        } else if c == b'<'
                            || c == b'&'
                            || (c < 0x20 && !is_ws(c))
                            || (c == b']' && self.starts_with(b"]]>"))
                            || (c == b'\r' && self.frame_kind == FrameKind::Document)
                            || (c == 0 && self.at_end())
                        {
                            break;
                        } else {
                            self.pos += 1;
                        }
                    }
                    if let Some(b) = buf.as_mut() {
                        b.extend_from_slice(&self.src[run_start..self.pos]);
                        start = self.pos;
                    }
                }
            }
        }
    }

    fn finish_text(
        &mut self,
        start: usize,
        buf: Option<ArenaVec<'a, u8>>,
        is_ascii: bool,
        pos: usize,
    ) -> Token<'a> {
        let text: &'a [u8] = match buf {
            Some(mut b) => {
                b.extend_from_slice(&self.src[start..self.pos]);
                b.into_bump_slice()
            }
            None => &self.src[start..self.pos],
        };
        Token {
            kind: Kind::Text { text, is_ascii },
            pos,
            frame: self.frame_id,
            spaced: false,
        }
    }
}

// ── output sinks ────────────────────────────────────────────────────────────

#[derive(Copy, Clone)]
struct Attribute<'a> {
    name: &'a [u8],
    value: &'a [u8],
    is_ascii: bool,
}

/// Receives the document structure from the parser — attributes already
/// deduplicated, normalized and defaulted — and builds the `Expr`.
trait Sink<'a> {
    fn start_element(&mut self, name: &'a [u8], attributes: &[Attribute<'a>], loc: Loc);
    fn text(&mut self, text: &'a [u8], is_ascii: bool, loc: Loc);
    fn end_element(&mut self);
    /// Called once, after the root element has ended.
    fn finish(&mut self) -> Expr;
}

fn string_expr(bump: &Bump, text: &[u8], is_ascii: bool, loc: Loc) -> Expr {
    if is_ascii {
        Expr::init(E::String::init(text), loc)
    } else {
        Expr::init(E::String::init_re_encode_utf8(text, bump), loc)
    }
}

fn name_expr(bump: &Bump, name: &[u8], loc: Loc) -> Expr {
    string_expr(bump, name, name.is_ascii(), loc)
}

/// Builds `{ "@attr": .., child: .., "#text": .. }`; the mapping rules are
/// documented on `Bun.XML.parse` in bun.d.ts.
struct CompactSink<'a> {
    bump: &'a Bump,
    stack: Vec<CompactFrame<'a>>,
    root: Option<(&'a [u8], Expr, Loc)>,
}

struct CompactFrame<'a> {
    name: &'a [u8],
    loc: Loc,
    /// The `@`-prefixed attribute properties, then one property per distinct
    /// child element name in order of first occurrence.
    object: E::Object,
    /// The names behind the child properties (`object.properties[i +
    /// attribute_count]` is `child_names[i]`), for grouping repeats.
    child_names: ArenaVec<'a, &'a [u8]>,
    attribute_count: usize,
    /// `child_names` position by name, built once an element has more than
    /// `LINEAR_CHILD_LIMIT` distinct children.
    child_index: Option<HashMap<&'a [u8], u32>>,
    text: TextAcc<'a>,
    text_is_ascii: bool,
}

/// Up to this many distinct child names, a repeat is found by comparing
/// names pairwise; beyond it, through `CompactFrame::child_index`.
const LINEAR_CHILD_LIMIT: usize = 16;

impl<'a> CompactFrame<'a> {
    /// Adds a child element's value: the first occurrence of a name becomes
    /// a property, a second turns that property into an array, later ones
    /// append to it.
    fn add_child(&mut self, bump: &'a Bump, name: &'a [u8], value: Expr) {
        let existing = match &self.child_index {
            Some(index) => index.get(name).map(|&i| i as usize),
            None => self.child_names.iter().position(|&n| n == name),
        };
        let Some(i) = existing else {
            if let Some(index) = &mut self.child_index {
                index.insert(name, self.child_names.len() as u32);
            } else if self.child_names.len() == LINEAR_CHILD_LIMIT {
                let mut index = HashMap::default();
                for (i, &n) in self.child_names.iter().enumerate() {
                    index.insert(n, i as u32);
                }
                index.insert(name, LINEAR_CHILD_LIMIT as u32);
                self.child_index = Some(index);
            }
            self.child_names.push(name);
            self.object
                .append_property(name_expr(bump, name, value.loc), value);
            return;
        };
        let prop = &mut self.object.properties.slice_mut()[self.attribute_count + i];
        let first = prop.value.expect("child property has a value");
        match first.data {
            ast::expr::Data::EArray(mut array) => {
                array
                    .push(bump, value)
                    .expect("infallible: AstAlloc append");
            }
            _ => {
                let mut items = ast::ExprNodeList::init_capacity(2);
                items.push(first);
                items.push(value);
                prop.value = Some(Expr::init(
                    E::Array {
                        items,
                        ..Default::default()
                    },
                    first.loc,
                ));
            }
        }
    }
}

/// All character data of one element, concatenated. A single borrowed run
/// (the common case) is never copied.
enum TextAcc<'a> {
    Empty,
    One(&'a [u8]),
    Many(ArenaVec<'a, u8>),
}

impl<'a> CompactSink<'a> {
    fn new(bump: &'a Bump) -> Self {
        CompactSink {
            bump,
            stack: Vec::new(),
            root: None,
        }
    }
}

impl<'a> Sink<'a> for CompactSink<'a> {
    fn start_element(&mut self, name: &'a [u8], attributes: &[Attribute<'a>], loc: Loc) {
        let mut object = E::Object {
            properties: G::PropertyList::init_capacity(attributes.len()),
            ..Default::default()
        };
        for attr in attributes {
            let mut key: ArenaVec<'a, u8> =
                ArenaVec::with_capacity_in(attr.name.len() + 1, self.bump);
            key.push(b'@');
            key.extend_from_slice(attr.name);
            object.append_property(
                name_expr(self.bump, key.into_bump_slice(), loc),
                string_expr(self.bump, attr.value, attr.is_ascii, loc),
            );
        }
        self.stack.push(CompactFrame {
            name,
            loc,
            object,
            child_names: ArenaVec::new_in(self.bump),
            attribute_count: attributes.len(),
            child_index: None,
            text: TextAcc::Empty,
            text_is_ascii: true,
        });
    }

    fn text(&mut self, text: &'a [u8], is_ascii: bool, _loc: Loc) {
        let frame = self.stack.last_mut().expect("text outside an element");
        frame.text_is_ascii &= is_ascii;
        frame.text = match core::mem::replace(&mut frame.text, TextAcc::Empty) {
            TextAcc::Empty => TextAcc::One(text),
            TextAcc::One(first) => {
                let mut buf: ArenaVec<'a, u8> =
                    ArenaVec::with_capacity_in(first.len() + text.len(), self.bump);
                buf.extend_from_slice(first);
                buf.extend_from_slice(text);
                TextAcc::Many(buf)
            }
            TextAcc::Many(mut buf) => {
                buf.extend_from_slice(text);
                TextAcc::Many(buf)
            }
        };
    }

    fn end_element(&mut self) {
        let frame = self.stack.pop().expect("end_element without start_element");
        let bump = self.bump;
        let text: &'a [u8] = match frame.text {
            TextAcc::Empty => b"",
            TextAcc::One(one) => one,
            TextAcc::Many(buf) => buf.into_bump_slice(),
        };
        let trimmed = strings::trim(text, XML_WS);
        // No attributes and no child elements: the element is its text.
        let value = if frame.object.properties.is_empty() {
            string_expr(bump, trimmed, frame.text_is_ascii, frame.loc)
        } else {
            let mut object = frame.object;
            if !trimmed.is_empty() {
                object.append_property(
                    name_expr(bump, b"#text", frame.loc),
                    string_expr(bump, trimmed, frame.text_is_ascii, frame.loc),
                );
            }
            Expr::init(object, frame.loc)
        };
        match self.stack.last_mut() {
            Some(parent) => parent.add_child(bump, frame.name, value),
            None => self.root = Some((frame.name, value, frame.loc)),
        }
    }

    fn finish(&mut self) -> Expr {
        let (name, value, loc) = self
            .root
            .take()
            .expect("finish before the root element ended");
        let mut object = E::Object::default();
        object.append_property(name_expr(self.bump, name, loc), value);
        Expr::init(object, loc)
    }
}

/// Builds `{ name, attributes: {..}, children: [..] }` per element; text
/// children are strings, kept exactly (including whitespace-only runs).
struct NodeSink<'a> {
    bump: &'a Bump,
    stack: Vec<NodeFrame<'a>>,
    root: Option<Expr>,
    /// The three keys every node has, allocated once and shared (an `Expr` is
    /// a copyable reference into the AST store; keys are only ever read).
    keys: [Expr; 3],
}

struct NodeFrame<'a> {
    name: &'a [u8],
    loc: Loc,
    attributes: Expr,
    children: ast::ExprNodeList,
}

impl<'a> NodeSink<'a> {
    fn new(bump: &'a Bump) -> Self {
        NodeSink {
            bump,
            stack: Vec::new(),
            root: None,
            keys: [b"name" as &[u8], b"attributes", b"children"]
                .map(|key| Expr::init(E::String::init(key), Loc::EMPTY)),
        }
    }
}

impl<'a> Sink<'a> for NodeSink<'a> {
    fn start_element(&mut self, name: &'a [u8], attributes: &[Attribute<'a>], loc: Loc) {
        let mut object = E::Object {
            properties: G::PropertyList::init_capacity(attributes.len()),
            ..Default::default()
        };
        for attr in attributes {
            object.append_property(
                name_expr(self.bump, attr.name, loc),
                string_expr(self.bump, attr.value, attr.is_ascii, loc),
            );
        }
        self.stack.push(NodeFrame {
            name,
            loc,
            attributes: Expr::init(object, loc),
            children: bun_alloc::AstAlloc::vec(),
        });
    }

    fn text(&mut self, text: &'a [u8], is_ascii: bool, loc: Loc) {
        let frame = self.stack.last_mut().expect("text outside an element");
        frame
            .children
            .push(string_expr(self.bump, text, is_ascii, loc));
    }

    fn end_element(&mut self) {
        let frame = self.stack.pop().expect("end_element without start_element");
        let [name_key, attributes_key, children_key] = self.keys;
        let mut object = E::Object {
            properties: G::PropertyList::init_capacity(3),
            ..Default::default()
        };
        object.append_property(name_key, name_expr(self.bump, frame.name, frame.loc));
        object.append_property(attributes_key, frame.attributes);
        object.append_property(
            children_key,
            Expr::init(
                E::Array {
                    items: frame.children,
                    ..Default::default()
                },
                frame.loc,
            ),
        );
        let node = Expr::init(object, frame.loc);
        match self.stack.last_mut() {
            Some(parent) => parent.children.push(node),
            None => self.root = Some(node),
        }
    }

    fn finish(&mut self) -> Expr {
        self.root
            .take()
            .expect("finish before the root element ended")
    }
}

// ── parser ──────────────────────────────────────────────────────────────────

/// One declared attribute of an element type: its normalization class and
/// its (already normalized) default.
#[derive(Copy, Clone)]
struct AttDef<'a> {
    name: &'a [u8],
    cdata: bool,
    /// The default and whether it is ASCII.
    default: Option<(&'a [u8], bool)>,
}

/// The ATTLIST declarations for one element type, in declaration order (the
/// first declaration of an attribute is binding, §3.3), indexed by name.
#[derive(Default)]
struct AttList<'a> {
    defs: Vec<AttDef<'a>>,
    by_name: HashMap<&'a [u8], u32>,
}

impl<'a> AttList<'a> {
    fn get(&self, name: &[u8]) -> Option<&AttDef<'a>> {
        self.by_name.get(name).map(|&i| &self.defs[i as usize])
    }

    fn declare(&mut self, def: AttDef<'a>) {
        if !self.by_name.contains_key(def.name) {
            self.by_name.insert(def.name, self.defs.len() as u32);
            self.defs.push(def);
        }
    }
}

/// Up to this many attributes on one tag, duplicates are found by comparing
/// names pairwise; beyond it, through `Parser::attribute_names`.
const LINEAR_ATTRIBUTE_LIMIT: usize = 8;

/// Recursive descent over the scanner's tokens: checks the grammar and the
/// structural well-formedness constraints, applies DTD information to
/// attributes, and drives a `Sink`. Never reads source bytes.
struct Parser<'a, 'log, S: Sink<'a>> {
    scanner: Scanner<'a, 'log>,
    /// The current token.
    tok: Token<'a>,
    /// Inside the document type declaration, for diagnostics.
    in_dtd: bool,
    stack_check: StackCheck,
    sink: S,
    attlists: HashMap<&'a [u8], AttList<'a>>,
    /// Scratch list reused for every start tag.
    attributes: Vec<Attribute<'a>>,
    /// Names in `attributes`, maintained only once a tag has more than
    /// `LINEAR_ATTRIBUTE_LIMIT` of them.
    attribute_names: HashMap<&'a [u8], ()>,
}

impl<'a, 'log, S: Sink<'a>> Parser<'a, 'log, S> {
    fn new(
        source: &'a Source,
        log: &'log mut Log,
        bump: &'a Bump,
        options: Options,
        sink: S,
    ) -> Self {
        let contents: &'a [u8] = source.contents.as_ref();
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
                transcoded: false,
                saw_utf8_bom: false,
                needs_utf16_declaration: false,
                content_start: 0,
                encoding: options.encoding,
                bump,
                source,
                log,
            },
            tok: Token {
                kind: Kind::Eof(None),
                pos: 0,
                frame: 0,
                spaced: false,
            },
            in_dtd: false,
            stack_check: StackCheck::init(),
            sink,
            attlists: HashMap::default(),
            attributes: Vec::new(),
            attribute_names: HashMap::default(),
        }
    }

    /// Nesting too deep to recurse into. The message is for the module
    /// loader's log; `Bun.XML.parse` throws a `RangeError` regardless.
    fn stack_overflow(&mut self) -> PErr {
        let _ = self.scanner.err(self.tok.pos, "Nesting is too deep");
        PErr::StackOverflow
    }

    // ── tokens ─────────────────────────────────────────────────────────────

    fn advance(&mut self) -> PResult<()> {
        self.advance_literal(Literal::None)
    }

    /// `advance`, saying how a quoted literal is to be read if one is next.
    fn advance_literal(&mut self, literal: Literal) -> PResult<()> {
        self.tok = self.scanner.next(literal)?;
        Ok(())
    }

    fn advance_content(&mut self) -> PResult<()> {
        self.tok = self.scanner.next_content()?;
        Ok(())
    }

    /// "Expected {expected} but found {the current token}".
    fn unexpected(&mut self, expected: &str) -> PErr {
        // WFC: PEs in Internal Subset is the likeliest reason for a stray
        // reference inside a declaration, so say that instead.
        if self.in_dtd && matches!(self.tok.kind, Kind::PeReference(_)) {
            return self.scanner.err(
                self.tok.pos,
                "Parameter entity references are not allowed inside markup declarations in the internal subset",
            );
        }
        if let Kind::PercentName(name) = self.tok.kind {
            return self.scanner.err_named(
                self.tok.pos,
                "Expected ';' to end the parameter entity reference",
                name,
                "",
            );
        }
        self.scanner.err_fmt(
            self.tok.pos,
            format_args!("Expected {} but found {}", expected, self.tok.kind),
        )
    }

    /// Where the grammar has a required `S` before the current token.
    fn require_spaced(&mut self) -> PResult<()> {
        if self.tok.spaced {
            return Ok(());
        }
        Err(self.scanner.err_fmt(
            self.tok.pos,
            format_args!("Whitespace is required before {}", self.tok.kind),
        ))
    }

    fn expect_name(&mut self, expected: &str) -> PResult<&'a [u8]> {
        match self.tok.kind {
            Kind::Name(name) => Ok(name),
            _ => Err(self.unexpected(expected)),
        }
    }

    /// The `>` ending a declaration or tag; returns the frame it came from.
    fn expect_gt(&mut self, expected: &str) -> PResult<u32> {
        match self.tok.kind {
            Kind::Gt => Ok(self.tok.frame),
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
        }
        self.advance()?;
        let has_xml_decl = self.tok.kind == Kind::XmlDecl;
        if has_xml_decl {
            self.parse_xml_decl()?;
        }
        if validation_deferred {
            self.scanner.check_utf16_declaration()?;
            self.scanner.validate_utf8()?;
        }
        if has_xml_decl {
            self.advance()?;
        }

        // prolog: Misc* (doctypedecl Misc*)?
        let mut seen_doctype = false;
        loop {
            match self.tok.kind {
                Kind::Comment | Kind::Pi => {}
                Kind::Decl(DeclKind::Doctype) if !seen_doctype => {
                    seen_doctype = true;
                    self.parse_doctype()?;
                }
                Kind::Decl(DeclKind::Doctype) => {
                    return Err(self.scanner.err(
                        self.tok.pos,
                        "Only one document type declaration is allowed",
                    ));
                }
                Kind::StartTag(_) => break,
                Kind::Eof(_) => {
                    return Err(self
                        .scanner
                        .err(self.tok.pos, "XML document must have a root element"));
                }
                Kind::Decl(_) | Kind::PeReference(_) | Kind::Percent | Kind::PercentName(_) => {
                    return Err(self.scanner.err(
                        self.tok.pos,
                        "Markup declarations and parameter-entity references are only allowed in the document type declaration",
                    ));
                }
                _ => return Err(self.unexpected("the root element")),
            }
            self.advance()?;
        }

        self.parse_element()?;

        // Misc*
        loop {
            self.advance()?;
            match self.tok.kind {
                Kind::Comment | Kind::Pi => {}
                Kind::Eof(_) => break,
                Kind::StartTag(_) => {
                    return Err(self
                        .scanner
                        .err(self.tok.pos, "Only one root element is allowed"));
                }
                _ => {
                    return Err(self.scanner.err_fmt(
                        self.tok.pos,
                        format_args!("Unexpected {} after the root element", self.tok.kind),
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
            return Err(match self.tok.kind {
                Kind::Name(b"encoding" | b"standalone") => self.scanner.err(
                    self.tok.pos,
                    "The XML declaration must start with version=\"1.0\"",
                ),
                Kind::Question => self
                    .scanner
                    .err(self.tok.pos, "The XML declaration must specify the version"),
                _ => self.unexpected("version=\"1.0\" in the XML declaration"),
            });
        };
        if !(version.len() >= 3
            && version.starts_with(b"1.")
            && version[2..].iter().all(u8::is_ascii_digit))
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
            let valid = name.first().is_some_and(u8::is_ascii_alphabetic)
                && name
                    .iter()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'.' | b'_' | b'-'));
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
                b"yes" => self.scanner.standalone = true,
                b"no" => {}
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
        match self.tok.kind {
            Kind::Question => {
                self.advance()?;
                if self.tok.kind != Kind::Gt || self.tok.spaced {
                    return Err(self.unexpected("'?>' to end the XML declaration"));
                }
            }
            Kind::Name(name @ (b"version" | b"encoding" | b"standalone")) => {
                return Err(self.scanner.err_named(
                    self.tok.pos,
                    "Misplaced",
                    name,
                    " in the XML declaration (the order is version, encoding, standalone)",
                ));
            }
            Kind::Name(name) => {
                return Err(self.scanner.err_named(
                    self.tok.pos,
                    "Unexpected",
                    name,
                    " in the XML declaration (expected version, encoding or standalone)",
                ));
            }
            Kind::Eof(_) => {
                return Err(self
                    .scanner
                    .err(self.tok.pos, "Unterminated XML declaration: expected '?>'"));
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
    fn parse_pseudo_attribute(
        &mut self,
        name: &'static [u8],
    ) -> PResult<Option<(&'a [u8], usize)>> {
        if self.tok.kind != Kind::Name(name) {
            return Ok(None);
        }
        self.require_spaced()?;
        let pos = self.tok.pos;
        self.advance()?;
        if self.tok.kind != Kind::Eq {
            return Err(self.unexpected("'=' after the name in the XML declaration"));
        }
        self.advance_literal(Literal::Plain)?;
        let Kind::Literal { value, .. } = self.tok.kind else {
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
        if let Kind::Name(b"SYSTEM" | b"PUBLIC") = self.tok.kind {
            self.require_spaced()?;
            self.parse_external_id(false)?;
            self.scanner.has_external_subset = true;
        }
        match self.tok.kind {
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
    fn parse_external_id(&mut self, notation: bool) -> PResult<()> {
        if let Kind::Name(b"SYSTEM") = self.tok.kind {
            self.advance_literal(Literal::System)?;
            if !matches!(self.tok.kind, Kind::Literal { .. }) {
                return Err(self.unexpected("a quoted system identifier after SYSTEM"));
            }
            self.require_spaced()?;
            return self.advance();
        }
        self.advance_literal(Literal::Pubid)?;
        if !matches!(self.tok.kind, Kind::Literal { .. }) {
            return Err(self.unexpected("a quoted public identifier after PUBLIC"));
        }
        self.require_spaced()?;
        self.advance_literal(Literal::System)?;
        if matches!(self.tok.kind, Kind::Literal { .. }) {
            self.require_spaced()?;
            return self.advance();
        }
        if notation {
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
            let (pos, frame) = (self.tok.pos, self.tok.frame);
            let end_frame = match self.tok.kind {
                // Only the document's own `]` closes the subset (a frame
                // holding included declarations has a nonzero id).
                Kind::BracketClose if frame == 0 => return Ok(()),
                Kind::BracketClose => {
                    return Err(self.scanner.err(
                        pos,
                        "']' inside a parameter entity cannot close the internal subset",
                    ));
                }
                Kind::Comment | Kind::Pi => continue,
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
        match self.tok.kind {
            Kind::Name(b"EMPTY" | b"ANY") => {
                self.require_spaced()?;
                self.advance()?;
            }
            Kind::ParenOpen => {
                self.require_spaced()?;
                self.advance()?;
                if let Kind::Hash(b"PCDATA") = self.tok.kind {
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
            match self.tok.kind {
                Kind::ParenClose => break,
                Kind::Bar => {
                    self.advance()?;
                    match self.tok.kind {
                        Kind::Name(_) => names += 1,
                        Kind::Hash(_) | Kind::ParenOpen => {
                            return Err(self.scanner.err(
                                self.tok.pos,
                                "Only element names may follow #PCDATA in a mixed content model",
                            ));
                        }
                        _ => return Err(self.unexpected("an element name after '|'")),
                    }
                }
                Kind::Comma => {
                    return Err(self.scanner.err(
                        self.tok.pos,
                        "A mixed content model is separated by '|', not ','",
                    ));
                }
                Kind::Question | Kind::Star | Kind::Plus if !self.tok.spaced && names > 0 => {
                    return Err(self.scanner.err(
                        self.tok.pos,
                        "Names in a mixed content model cannot have occurrence indicators",
                    ));
                }
                _ => return Err(self.unexpected("'|' or ')' in the mixed content model")),
            }
        }
        self.advance()?;
        match self.tok.kind {
            Kind::Star if !self.tok.spaced => self.advance(),
            Kind::Question | Kind::Plus if !self.tok.spaced => Err(self.scanner.err(
                self.tok.pos,
                "A mixed content model may only be followed by '*'",
            )),
            _ if names > 0 => Err(self.scanner.err(
                self.tok.pos,
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
        let mut separator: Option<Kind<'a>> = None;
        loop {
            match self.tok.kind {
                Kind::ParenClose => {
                    self.advance()?;
                    return self.parse_occurrence();
                }
                Kind::Bar | Kind::Comma => {
                    if *separator.get_or_insert(self.tok.kind) != self.tok.kind {
                        return Err(self
                            .scanner
                            .err(self.tok.pos, "A content model group cannot mix ',' and '|'"));
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
        match self.tok.kind {
            Kind::Name(_) => {
                self.advance()?;
                self.parse_occurrence()
            }
            Kind::ParenOpen => {
                self.advance()?;
                self.parse_group()
            }
            Kind::Hash(b"PCDATA") => Err(self.scanner.err(
                self.tok.pos,
                "#PCDATA must come first in a content model, as (#PCDATA|a|b)*",
            )),
            _ => Err(self.unexpected("an element name or '(' in the content model")),
        }
    }

    /// An optional occurrence indicator, which must directly follow its
    /// particle.
    fn parse_occurrence(&mut self) -> PResult<()> {
        match self.tok.kind {
            Kind::Question | Kind::Star | Kind::Plus if !self.tok.spaced => self.advance(),
            Kind::Question | Kind::Star | Kind::Plus => Err(self.scanner.err(
                self.tok.pos,
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
            let name = match self.tok.kind {
                Kind::Gt => return Ok(self.tok.frame),
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
            let cdata = match self.tok.kind {
                Kind::Name(b"CDATA") => {
                    self.require_spaced()?;
                    true
                }
                Kind::Name(
                    b"ID" | b"IDREF" | b"IDREFS" | b"ENTITY" | b"ENTITIES" | b"NMTOKEN"
                    | b"NMTOKENS",
                ) => {
                    self.require_spaced()?;
                    false
                }
                Kind::Name(b"NOTATION") => {
                    self.require_spaced()?;
                    self.advance()?;
                    if self.tok.kind != Kind::ParenOpen {
                        return Err(self.unexpected("'(' after NOTATION"));
                    }
                    self.require_spaced()?;
                    self.parse_enumeration(true)?;
                    false
                }
                Kind::ParenOpen => {
                    self.require_spaced()?;
                    self.parse_enumeration(false)?;
                    false
                }
                _ => return Err(self.unexpected("an attribute type (CDATA, ID, IDREF, IDREFS, ENTITY, ENTITIES, NMTOKEN, NMTOKENS, NOTATION or an enumeration)")),
            };

            // DefaultDecl (§3.3.2). The value is normalized as the type
            // says, like a specified one (§3.3.3).
            let literal = Literal::AttValue { collapse: !cdata };
            self.advance_literal(literal)?;
            let default = match self.tok.kind {
                Kind::Hash(b"REQUIRED" | b"IMPLIED") => {
                    self.require_spaced()?;
                    None
                }
                Kind::Hash(b"FIXED") => {
                    self.require_spaced()?;
                    self.advance_literal(literal)?;
                    let Kind::Literal { value, is_ascii } = self.tok.kind else {
                        return Err(self.unexpected("a quoted default value after #FIXED"));
                    };
                    self.require_spaced()?;
                    Some((value, is_ascii))
                }
                Kind::Literal { value, is_ascii } => {
                    self.require_spaced()?;
                    Some((value, is_ascii))
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
    fn parse_enumeration(&mut self, names: bool) -> PResult<()> {
        loop {
            self.advance()?;
            match self.tok.kind {
                Kind::Name(_) => {}
                Kind::Nmtoken(_) if !names => {}
                _ if names => return Err(self.unexpected("a notation name")),
                _ => return Err(self.unexpected("a name token in the enumeration")),
            }
            self.advance()?;
            match self.tok.kind {
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
        if let Kind::PercentName(_) = self.tok.kind {
            return Err(self.scanner.err(
                self.tok.pos,
                "Whitespace is required between '%' and the name in a parameter entity declaration",
            ));
        }
        let parameter = self.tok.kind == Kind::Percent;
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
        let value = match self.tok.kind {
            Kind::Literal { value, .. } => {
                self.require_spaced()?;
                self.advance()?;
                EntityValue::Internal(value)
            }
            Kind::Name(b"SYSTEM" | b"PUBLIC") => {
                self.require_spaced()?;
                self.parse_external_id(false)?;
                if let Kind::Name(b"NDATA") = self.tok.kind {
                    self.require_spaced()?;
                    if parameter {
                        return Err(self
                            .scanner
                            .err(self.tok.pos, "Parameter entities cannot have NDATA"));
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
        if !matches!(self.tok.kind, Kind::Name(b"SYSTEM" | b"PUBLIC")) {
            return Err(self.unexpected("SYSTEM or PUBLIC in the notation declaration"));
        }
        self.require_spaced()?;
        self.parse_external_id(true)?;
        self.expect_gt("'>' to end the notation declaration")
    }

    // ── elements ───────────────────────────────────────────────────────────

    /// `element` (§3.1 [39]); the current token is its `<Name`. Attributes,
    /// then (unless the tag was empty) content up to the matching end tag.
    fn parse_element(&mut self) -> PResult<()> {
        if !self.stack_check.is_safe_to_recurse() {
            return Err(self.stack_overflow());
        }
        let Token {
            kind: Kind::StartTag(name),
            pos,
            frame,
            ..
        } = self.tok
        else {
            unreachable!("parse_element is called on a start tag");
        };
        let loc = self.scanner.loc(pos);
        let empty = self.parse_attributes(name)?;
        self.sink.start_element(name, &self.attributes, loc);
        if empty {
            self.sink.end_element();
            return Ok(());
        }
        loop {
            self.advance_content()?;
            match self.tok.kind {
                Kind::Text { text, is_ascii } => {
                    let loc = self.scanner.loc(self.tok.pos);
                    self.sink.text(text, is_ascii, loc);
                }
                Kind::StartTag(_) => self.parse_element()?,
                Kind::EndTag(end_name) => {
                    // WFC: Element Type Match.
                    if end_name != name {
                        return Err(self.scanner.err_fmt(
                            self.tok.pos,
                            format_args!(
                                "Expected closing tag </{}> but found </{}>",
                                bstr::BStr::new(name),
                                bstr::BStr::new(end_name)
                            ),
                        ));
                    }
                    if self.tok.frame != frame {
                        return Err(self.scanner.err_named(
                            self.tok.pos,
                            "Element",
                            name,
                            " must start and end within the same entity",
                        ));
                    }
                    self.advance()?;
                    self.expect_gt("'>' to end the closing tag")?;
                    self.sink.end_element();
                    return Ok(());
                }
                Kind::Eof(_) => {
                    return Err(self.scanner.err_named(
                        self.tok.pos,
                        "Missing closing tag for element",
                        name,
                        "",
                    ));
                }
                _ => unreachable!("next_content produces text, tags and end of input"),
            }
        }
    }

    /// The attributes of a start tag, into `self.attributes`: duplicates
    /// rejected (WFC: Unique Att Spec), values normalized per their declared
    /// type (§3.3.3), declared defaults supplied (§3.3.2). Returns whether
    /// the tag was an empty-element tag.
    fn parse_attributes(&mut self, element: &'a [u8]) -> PResult<bool> {
        self.attributes.clear();
        self.attribute_names.clear();
        let empty = loop {
            self.advance()?;
            let name = match self.tok.kind {
                Kind::Gt => break false,
                Kind::SlashGt => break true,
                Kind::Name(name) => name,
                _ => return Err(self.unexpected("an attribute name, '>' or '/>' in the start tag")),
            };
            self.require_spaced()?;
            let pos = self.tok.pos;
            if Self::has_attribute(&self.attributes, &self.attribute_names, name) {
                return Err(self.scanner.err_named(pos, "Duplicate attribute", name, ""));
            }
            self.advance()?;
            if self.tok.kind != Kind::Eq {
                return Err(self.unexpected("'=' after the attribute name"));
            }
            let collapse = self
                .attlists
                .get(element)
                .and_then(|defs| defs.get(name))
                .is_some_and(|def| !def.cdata);
            self.advance_literal(Literal::AttValue { collapse })?;
            let Kind::Literal { value, is_ascii } = self.tok.kind else {
                return Err(self.unexpected("a quoted attribute value"));
            };
            Self::push_attribute(
                &mut self.attributes,
                &mut self.attribute_names,
                Attribute {
                    name,
                    value,
                    is_ascii,
                },
            );
        };
        if let Some(defs) = self.attlists.get(element) {
            for def in &defs.defs {
                if let Some((value, is_ascii)) = def.default {
                    if !Self::has_attribute(&self.attributes, &self.attribute_names, def.name) {
                        Self::push_attribute(
                            &mut self.attributes,
                            &mut self.attribute_names,
                            Attribute {
                                name: def.name,
                                value,
                                is_ascii,
                            },
                        );
                    }
                }
            }
        }
        Ok(empty)
    }

    fn has_attribute(
        attributes: &[Attribute<'a>],
        names: &HashMap<&'a [u8], ()>,
        name: &[u8],
    ) -> bool {
        if attributes.len() <= LINEAR_ATTRIBUTE_LIMIT {
            attributes.iter().any(|attr| attr.name == name)
        } else {
            names.contains_key(name)
        }
    }

    fn push_attribute(
        attributes: &mut Vec<Attribute<'a>>,
        names: &mut HashMap<&'a [u8], ()>,
        attribute: Attribute<'a>,
    ) {
        attributes.push(attribute);
        if attributes.len() == LINEAR_ATTRIBUTE_LIMIT + 1 {
            for attr in attributes.iter() {
                names.insert(attr.name, ());
            }
        } else if attributes.len() > LINEAR_ATTRIBUTE_LIMIT + 1 {
            names.insert(attribute.name, ());
        }
    }
}

/// The extra normalization for attributes declared with a tokenized or
/// enumerated type (§3.3.3): leading and trailing spaces removed, runs of
/// spaces collapsed. All whitespace in `value` is already #x20.
fn collapse_spaces<'a>(bump: &'a Bump, value: &'a [u8]) -> &'a [u8] {
    let trimmed = strings::trim(value, b" ");
    if strings::index_of(trimmed, b"  ").is_none() {
        return trimmed;
    }
    let mut out: ArenaVec<'a, u8> = ArenaVec::with_capacity_in(trimmed.len(), bump);
    let mut previous_space = false;
    for &c in trimmed {
        if c != b' ' || !previous_space {
            out.push(c);
        }
        previous_space = c == b' ';
    }
    out.into_bump_slice()
}
