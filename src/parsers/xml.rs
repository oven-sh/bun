//! XML 1.0 (Fifth Edition) scanner/parser — a non-validating processor that
//! does not read external entities (§5.1).
//!
//! Architecture (mirrors `toml.rs` / `json5.rs`): a scanner reads bytes and
//! produces typed tokens; the parser only consumes tokens and never touches
//! source bytes. XML's lexical grammar is entirely positional (a `Name` in a
//! start tag, in an ATTLIST declaration, and after `&` are three different
//! tokens; `%` is a reference in the DTD and data in content), so the parser
//! selects a scan mode per grammar production and each mode returns a narrow
//! token type that can only represent what is legal at that position. Trivia
//! is positional too — where `S` is optional, required, or forbidden differs
//! per production — so each scan mode consumes exactly the whitespace,
//! comments and processing instructions its position allows.
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
//
// Each scan mode returns its own narrow token type: a token that is illegal
// at a grammar position cannot be produced there. `pos` is a byte offset in
// the document for diagnostics; `frame` identifies the input frame (document
// or entity replacement text) the token was read from.

/// What may appear before the root element after the XML declaration.
/// Comments, PIs and whitespace are consumed as trivia.
enum PrologItem<'a> {
    Doctype {
        pos: usize,
    },
    /// `<Name` of the root element; attributes follow via `scan_tag_item`.
    StartTag {
        name: &'a [u8],
        pos: usize,
        frame: u32,
    },
    Eof {
        pos: usize,
    },
}

/// One pseudo-attribute of the XML declaration, or its end.
enum XmlDeclItem<'a> {
    Attr {
        name: &'a [u8],
        value: &'a [u8],
        pos: usize,
    },
    End {
        pos: usize,
    },
}

/// What follows the name in `<!DOCTYPE name ...>`.
enum DoctypeItem {
    /// `SYSTEM "..."` or `PUBLIC "..." "..."`, validated and dropped (the
    /// external subset is not read).
    ExternalId,
    OpenSubset,
    Close,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum DeclKind {
    Element,
    Attlist,
    Entity,
    Notation,
}

/// The next markup declaration in the internal subset, or its end.
/// Whitespace, comments, PIs and parameter-entity references between
/// declarations are consumed as trivia (a reference to an internal parameter
/// entity continues scanning inside its replacement text).
enum SubsetItem {
    Decl {
        kind: DeclKind,
        pos: usize,
        frame: u32,
    },
    Close,
}

/// `contentspec` (§3.2 [46]) opener.
enum ContentSpec {
    Empty,
    Any,
    /// `(` — a `Mixed` or `children` group follows.
    Open,
}

/// Occurrence indicator after a content particle.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Occurrence {
    Once,
    Optional,
    ZeroOrMore,
    OneOrMore,
}

/// What begins a content particle (§3.2.1 [48]).
enum CpItem {
    Name(Occurrence),
    Open,
    PcData,
}

/// What follows a content particle inside a group.
enum CpSep {
    Close(Occurrence),
    Choice,
    Seq,
}

/// The start of one `AttDef` (§3.3 [53]) or the end of the ATTLIST.
enum AttDefItem<'a> {
    Name(&'a [u8]),
    End { frame: u32 },
}

/// `AttType` (§3.3.1 [54]). Only the CDATA/non-CDATA distinction matters to
/// a non-validating processor (attribute-value normalization, §3.3.3).
#[derive(Copy, Clone, PartialEq, Eq)]
enum AttType {
    Cdata,
    /// Tokenized or enumerated: the value is additionally space-collapsed.
    Other,
}

/// `DefaultDecl` (§3.3.2 [60]).
enum DefaultDecl<'a> {
    Required,
    Implied,
    /// The (already normalized) default value; `#FIXED` makes no difference
    /// without validation.
    Value {
        value: &'a [u8],
        is_ascii: bool,
    },
}

/// `S ('%' S)? Name` of an entity declaration.
struct EntityDeclHead<'a> {
    parameter: bool,
    name: &'a [u8],
}

/// `EntityDef` / `PEDef` (§4.2 [73] [74]).
enum EntityDef<'a> {
    Internal(&'a [u8]),
    External { unparsed: bool },
}

/// One attribute of a start tag, or the end of the tag.
enum TagItem<'a> {
    Attr {
        name: &'a [u8],
        value: &'a [u8],
        is_ascii: bool,
        pos: usize,
    },
    End {
        empty: bool,
    },
}

/// Element content (§3.1 [43]). Character data, CDATA sections, references
/// and the text of included entities are folded into maximal `Text` runs;
/// comments and PIs are consumed as trivia.
enum Content<'a> {
    Text {
        text: &'a [u8],
        is_ascii: bool,
        pos: usize,
    },
    StartTag {
        name: &'a [u8],
        pos: usize,
        frame: u32,
    },
    EndTag {
        name: &'a [u8],
        pos: usize,
        frame: u32,
    },
    Eof {
        pos: usize,
    },
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

/// Owns the byte cursor, the input-frame stack and the entity tables. The only
/// component that reads bytes; every method scans one token (or one fixed
/// construct) for one grammar position.
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
    /// The input has been validated by the time names and text are scanned;
    /// a sequence cut off by the end of the frame decodes as its lead byte so
    /// the cursor can never pass the end.
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

    /// Validates the non-ASCII sequence at the cursor as a `Char` (once the
    /// input is valid UTF-8 only U+FFFE and U+FFFF are excluded) and returns
    /// its byte length.
    fn check_non_ascii_char(&mut self) -> PResult<usize> {
        let (cp, len) = self.decode_utf8();
        if cp == 0xFFFE || cp == 0xFFFF {
            return Err(self.err_invalid_char());
        }
        Ok(len)
    }

    /// Skips `S`; returns whether there was any.
    fn skip_ws(&mut self) -> bool {
        let start = self.pos;
        while is_ws(self.peek()) {
            self.pos += 1;
        }
        self.pos != start
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

    // ── document setup ─────────────────────────────────────────────────────

    /// Byte-order mark handling and UTF-16 detection (§4.3.3, Appendix F).
    /// UTF-16 input is transcoded to UTF-8 up front.
    fn init_document(&mut self) -> PResult<()> {
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
        Ok(())
    }

    /// The rest of the input must be valid UTF-8 (§4.3.3: malformed byte
    /// sequences are fatal). Run after the XML declaration, whose encoding
    /// may first cause the input to be transcoded.
    fn validate_utf8(&mut self) -> PResult<()> {
        let result = simdutf::validate::with_errors::utf8(&self.src[self.pos..]);
        if result.is_successful() {
            Ok(())
        } else {
            let pos = self.pos + result.count;
            Err(self.err(pos, "Invalid UTF-8"))
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

    /// `Name` (§2.3 [5]) at the cursor. `what` phrases the "but found" error.
    fn scan_name(&mut self, what: &'static str) -> PResult<&'a [u8]> {
        let start = self.pos;
        let c = self.peek();
        if is_name_start_ascii(c) {
            self.pos += 1;
        } else if c >= 0x80 {
            let (cp, len) = self.decode_utf8();
            if !is_name_start_code_point(cp) {
                return Err(self.err_here(what));
            }
            self.pos += len;
        } else {
            return Err(self.err_here(what));
        }
        self.skip_name_chars();
        Ok(&self.src[start..self.pos])
    }

    fn skip_name_chars(&mut self) {
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

    /// `Nmtoken` (§2.3 [7]) at the cursor.
    fn scan_nmtoken(&mut self) -> PResult<&'a [u8]> {
        let start = self.pos;
        self.skip_name_chars();
        if self.pos == start {
            return Err(self.err_here("Expected a name token but found"));
        }
        Ok(&self.src[start..self.pos])
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
            return Err(self.err_fmt(
                ref_pos,
                format_args!(
                    "Character reference &#x{:X}; is not a valid XML character",
                    value
                ),
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

    fn expect_quote(&mut self, what: &'static str) -> PResult<u8> {
        match self.peek() {
            q @ (b'"' | b'\'') => {
                self.pos += 1;
                Ok(q)
            }
            _ => Err(self.err_here(what)),
        }
    }

    /// `SystemLiteral` (§2.3 [11]), validated and dropped.
    fn skip_system_literal(&mut self) -> PResult<()> {
        let open = self.here();
        let quote = self.expect_quote("Expected a quoted system identifier but found")?;
        loop {
            match self.peek() {
                _ if self.at_end() => return Err(self.err(open, "Unterminated system identifier")),
                c if c == quote => {
                    self.pos += 1;
                    return Ok(());
                }
                c if c >= 0x80 => self.pos += self.check_non_ascii_char()?,
                c if c < 0x20 && !is_ws(c) => return Err(self.err_invalid_char()),
                _ => self.pos += 1,
            }
        }
    }

    /// `PubidLiteral` (§2.3 [12]), validated and dropped.
    fn skip_pubid_literal(&mut self) -> PResult<()> {
        let open = self.here();
        let quote = self.expect_quote("Expected a quoted public identifier but found")?;
        loop {
            match self.peek() {
                _ if self.at_end() => return Err(self.err(open, "Unterminated public identifier")),
                c if c == quote => {
                    self.pos += 1;
                    return Ok(());
                }
                c if is_pubid_char(c) => self.pos += 1,
                _ => return Err(self.err_here("Invalid character in a public identifier:")),
            }
        }
    }

    /// `AttValue` (§2.3 [10]) after the opening quote, normalized per §3.3.3:
    /// a character reference appends the character, an entity reference
    /// appends its (recursively normalized) replacement text, a whitespace
    /// character appends a space. Used for start tags and ATTLIST defaults.
    /// Returns (value, is_ascii).
    fn scan_att_value(&mut self, quote: u8) -> PResult<(&'a [u8], bool)> {
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
                    return Ok(match buf {
                        Some(b) => (b.into_bump_slice(), is_ascii),
                        None => (&self.src[start..end], is_ascii),
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
    fn scan_entity_value(&mut self, quote: u8) -> PResult<&'a [u8]> {
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

    // ── trivia: comments and processing instructions ───────────────────────

    /// The rest of a comment after `<!--` (§2.5 [15]).
    fn skip_comment(&mut self, start_pos: usize) -> PResult<()> {
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

    /// The rest of a processing instruction after `<?` (§2.6 [16]). The
    /// target and data are validated and dropped.
    fn skip_pi(&mut self, start_pos: usize) -> PResult<()> {
        let target =
            self.scan_name("Expected a processing instruction target after '<?' but found")?;
        if target.eq_ignore_ascii_case(b"xml") {
            return Err(self.err(
                start_pos,
                "'<?xml' is reserved for the XML declaration, which is only allowed at the very start of the document",
            ));
        }
        if self.starts_with(b"?>") {
            self.pos += 2;
            return Ok(());
        }
        if !self.skip_ws() {
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
                    return Ok(());
                }
                c if c >= 0x80 => self.pos += self.check_non_ascii_char()?,
                c if c < 0x20 && !is_ws(c) => return Err(self.err_invalid_char()),
                _ => self.pos += 1,
            }
        }
    }

    // ── scan modes: prolog and epilog ──────────────────────────────────────

    /// `<?xml` followed by whitespace, at the very start of the document.
    fn scan_xml_decl_start(&mut self) -> bool {
        if self.starts_with(b"<?xml") && is_ws(self.peek_at(self.pos + 5)) {
            self.pos += 5;
            true
        } else {
            false
        }
    }

    /// One `name="value"` pseudo-attribute of the XML declaration (after
    /// required whitespace), or `?>`. Values are returned raw; the parser
    /// checks names, order and values.
    fn scan_xml_decl_item(&mut self) -> PResult<XmlDeclItem<'a>> {
        let had_ws = self.skip_ws();
        let pos = self.here();
        if self.starts_with(b"?>") {
            self.pos += 2;
            return Ok(XmlDeclItem::End { pos });
        }
        if self.at_end() {
            return Err(self.err_here("Unterminated XML declaration: expected '?>' but found"));
        }
        if !had_ws {
            return Err(self.err_here("Expected whitespace in the XML declaration before"));
        }
        // Not `scan_name`: this runs before the input is known to be valid
        // UTF-8, and the three legal names are ASCII.
        let start = self.pos;
        while self.peek().is_ascii_alphanumeric() {
            self.pos += 1;
        }
        if self.pos == start {
            return Err(self.err_here(
                "Expected version, encoding, standalone or '?>' in the XML declaration but found",
            ));
        }
        let name = &self.src[start..self.pos];
        self.skip_ws();
        if self.peek() != b'=' {
            return Err(self.err_here("Expected '=' in the XML declaration but found"));
        }
        self.pos += 1;
        self.skip_ws();
        let quote =
            self.expect_quote("Expected a quoted value in the XML declaration but found")?;
        let start = self.pos;
        while self.peek() != quote {
            if self.at_end() {
                return Err(self.err(pos, "Unterminated value in the XML declaration"));
            }
            // The legal values are ASCII tokens (checked by the parser); stop
            // markup from being swallowed by a missing quote.
            if matches!(self.peek(), b'<' | b'>') || (self.peek() < 0x20 && !is_ws(self.peek())) {
                return Err(self.err_here("Invalid character in an XML declaration value:"));
            }
            self.pos += 1;
        }
        let value = &self.src[start..self.pos];
        self.pos += 1;
        Ok(XmlDeclItem::Attr { name, value, pos })
    }

    /// `Misc*` then the DOCTYPE or the root element's `<Name`.
    fn scan_prolog_item(&mut self) -> PResult<PrologItem<'a>> {
        loop {
            self.skip_ws();
            let pos = self.here();
            if self.at_end() {
                return Ok(PrologItem::Eof { pos });
            }
            if self.peek() != b'<' {
                return Err(self.err_here("Expected the root element but found"));
            }
            if self.starts_with(b"<?") {
                self.pos += 2;
                self.skip_pi(pos)?;
            } else if self.starts_with(b"<!--") {
                self.pos += 4;
                self.skip_comment(pos)?;
            } else if self.starts_with(b"<!DOCTYPE") {
                self.pos += 9;
                return Ok(PrologItem::Doctype { pos });
            } else if self.starts_with(b"<!") {
                return Err(self.err(pos, "Expected '<!DOCTYPE', a comment, or the root element"));
            } else {
                self.pos += 1;
                let name = self.scan_name("Expected an element name after '<' but found")?;
                return Ok(PrologItem::StartTag {
                    name,
                    pos,
                    frame: self.frame_id,
                });
            }
        }
    }

    /// `Misc*` after the root element, to the end of the document.
    fn scan_epilog(&mut self) -> PResult<()> {
        loop {
            self.skip_ws();
            let pos = self.here();
            if self.at_end() {
                return Ok(());
            }
            if self.starts_with(b"<?") {
                self.pos += 2;
                self.skip_pi(pos)?;
            } else if self.starts_with(b"<!--") {
                self.pos += 4;
                self.skip_comment(pos)?;
            } else if self.peek() == b'<' {
                return Err(self.err(pos, "Only one root element is allowed"));
            } else {
                return Err(self.err_here("Unexpected content after the root element:"));
            }
        }
    }

    // ── scan modes: document type declaration ──────────────────────────────

    /// `S Name` after `<!DOCTYPE`.
    fn scan_doctype_name(&mut self) -> PResult<&'a [u8]> {
        if !self.skip_ws() {
            return Err(self.err_here("Expected whitespace after '<!DOCTYPE' but found"));
        }
        self.scan_name("Expected the document type name but found")
    }

    /// After the DOCTYPE name (`after_name`) or after its external ID: an
    /// external ID (directly after the name only, and only after
    /// whitespace), `[`, or `>`.
    fn scan_doctype_item(&mut self, after_name: bool) -> PResult<DoctypeItem> {
        let had_ws = self.skip_ws();
        match self.peek() {
            b'[' => {
                self.pos += 1;
                Ok(DoctypeItem::OpenSubset)
            }
            b'>' => {
                self.pos += 1;
                Ok(DoctypeItem::Close)
            }
            _ if self.at_end() => {
                Err(self.err_here("Unterminated document type declaration: expected '>' but found"))
            }
            _ if after_name => {
                if !had_ws {
                    return Err(self.err_here(
                        "Expected whitespace, '[' or '>' after the document type name but found",
                    ));
                }
                self.scan_external_id(false)?;
                Ok(DoctypeItem::ExternalId)
            }
            _ => {
                Err(self.err_here("Expected '[' or '>' in the document type declaration but found"))
            }
        }
    }

    /// `S? '>'` closing the DOCTYPE after the internal subset's `]`.
    fn scan_doctype_close(&mut self) -> PResult<()> {
        self.skip_ws();
        if self.peek() != b'>' {
            return Err(
                self.err_here("Expected '>' to close the document type declaration but found")
            );
        }
        self.pos += 1;
        Ok(())
    }

    /// `ExternalID` (§4.2.2 [75]) at the cursor: `SYSTEM S SystemLiteral`
    /// or `PUBLIC S PubidLiteral S SystemLiteral`; for NOTATION declarations
    /// (`public_only_ok`, [83]) the system literal after PUBLIC is optional.
    /// The identifiers are validated and dropped.
    fn scan_external_id(&mut self, public_only_ok: bool) -> PResult<()> {
        if self.starts_with(b"SYSTEM") {
            self.pos += 6;
            if !self.skip_ws() {
                return Err(self.err_here("Expected whitespace after SYSTEM but found"));
            }
            self.skip_system_literal()
        } else if self.starts_with(b"PUBLIC") {
            self.pos += 6;
            if !self.skip_ws() {
                return Err(self.err_here("Expected whitespace after PUBLIC but found"));
            }
            self.skip_pubid_literal()?;
            let had_ws = self.skip_ws();
            match self.peek() {
                b'"' | b'\'' => {
                    if !had_ws {
                        return Err(self.err_here("Expected whitespace between the public and system identifiers but found"));
                    }
                    self.skip_system_literal()
                }
                _ if public_only_ok => Ok(()),
                _ => Err(self.err_here(
                    "Expected a system identifier after the public identifier but found",
                )),
            }
        } else {
            Err(self.err_here("Expected SYSTEM or PUBLIC but found"))
        }
    }

    /// `DeclSep*` then the next markup declaration keyword or the closing
    /// `]` (§2.8 [28a] [28b] [29]).
    fn scan_subset_item(&mut self) -> PResult<SubsetItem> {
        loop {
            self.skip_ws();
            let pos = self.here();
            if self.at_end() {
                if self.frame_kind == FrameKind::Declarations {
                    self.pop_frame();
                    continue;
                }
                return Err(self.err_here("Unterminated internal subset: expected ']' but found"));
            }
            match self.peek() {
                b']' if self.in_document() => {
                    self.pos += 1;
                    return Ok(SubsetItem::Close);
                }
                b'%' => {
                    self.pos += 1;
                    self.include_parameter_entity(pos)?;
                }
                b'<' => {
                    let frame = self.frame_id;
                    let kind = if self.starts_with(b"<!ELEMENT") {
                        self.pos += 9;
                        DeclKind::Element
                    } else if self.starts_with(b"<!ATTLIST") {
                        self.pos += 9;
                        DeclKind::Attlist
                    } else if self.starts_with(b"<!ENTITY") {
                        self.pos += 8;
                        DeclKind::Entity
                    } else if self.starts_with(b"<!NOTATION") {
                        self.pos += 10;
                        DeclKind::Notation
                    } else if self.starts_with(b"<?") {
                        self.pos += 2;
                        self.skip_pi(pos)?;
                        continue;
                    } else if self.starts_with(b"<!--") {
                        self.pos += 4;
                        self.skip_comment(pos)?;
                        continue;
                    } else if self.starts_with(b"<![") {
                        return Err(self.err(
                            pos,
                            "Conditional sections are only allowed in the external DTD subset",
                        ));
                    } else {
                        return Err(self.err(pos, "Expected a markup declaration (<!ELEMENT, <!ATTLIST, <!ENTITY, <!NOTATION), a comment, or a processing instruction"));
                    };
                    return Ok(SubsetItem::Decl { kind, pos, frame });
                }
                _ => return Err(self.err_here("Unexpected character in the internal subset:")),
            }
        }
    }

    /// The rest of `%Name;` after `%` where a parameter entity is included as
    /// declarations: pushes the replacement text padded with one space on
    /// each side (§4.4.8), or records that an unread entity was referenced.
    fn include_parameter_entity(&mut self, ref_pos: usize) -> PResult<()> {
        let name =
            self.scan_reference_name("Expected a parameter entity name after '%' but found")?;
        self.saw_pe_reference = true;
        match self.entities.parameter.get(name).copied() {
            Some(EntityValue::Internal(text)) => {
                let mut padded: ArenaVec<'a, u8> =
                    ArenaVec::with_capacity_in(text.len() + 2, self.bump);
                padded.push(b' ');
                padded.extend_from_slice(text);
                padded.push(b' ');
                self.push_frame(
                    padded.into_bump_slice(),
                    FrameKind::Declarations,
                    (name, true),
                    ref_pos,
                )
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

    /// Separator inside a markup declaration; returns whether there was
    /// any. Inside the replacement text of a parameter entity, a
    /// parameter-entity reference between tokens is included right here and
    /// an exhausted one is left (§2.8: PEs may occur between tokens of
    /// declarations outside the internal subset proper); in the internal
    /// subset itself that is a well-formedness error (WFC: PEs in Internal
    /// Subset).
    fn skip_decl_ws(&mut self) -> PResult<bool> {
        let mut any = false;
        loop {
            any |= self.skip_ws();
            if self.at_end() && self.frame_kind == FrameKind::Declarations {
                self.pop_frame();
                any = true;
                continue;
            }
            if self.peek() == b'%' {
                // `%` followed by whitespace is the marker of a parameter
                // entity declaration, not a reference.
                let next = self.peek_at(self.pos + 1);
                if is_ws(next) || next == 0 {
                    return Ok(any);
                }
                let pos = self.here();
                if self.in_document() {
                    return Err(self.err(pos, "Parameter entity references are not allowed inside markup declarations in the internal subset"));
                }
                self.pos += 1;
                self.include_parameter_entity(pos)?;
                any = true;
                continue;
            }
            return Ok(any);
        }
    }

    fn require_decl_ws(&mut self, what: &'static str) -> PResult<()> {
        if self.skip_decl_ws()? {
            Ok(())
        } else {
            Err(self.err_here(what))
        }
    }

    /// `S Name` after a declaration keyword.
    fn scan_decl_name(&mut self) -> PResult<&'a [u8]> {
        self.require_decl_ws("Expected whitespace after the declaration keyword but found")?;
        self.scan_name("Expected a name in the markup declaration but found")
    }

    /// `S? '>'` ending a declaration. Returns the frame the `>` came from.
    fn scan_decl_end(&mut self) -> PResult<u32> {
        self.skip_decl_ws()?;
        if self.peek() != b'>' {
            return Err(self.err_here("Expected '>' to end the markup declaration but found"));
        }
        let frame = self.frame_id;
        self.pos += 1;
        Ok(frame)
    }

    // `<!ELEMENT` ───────────────────────────────────────────────────────────

    /// `S contentspec` opener after the element name.
    fn scan_content_spec(&mut self) -> PResult<ContentSpec> {
        self.require_decl_ws("Expected whitespace after the element name but found")?;
        if self.starts_with(b"EMPTY") {
            self.pos += 5;
            Ok(ContentSpec::Empty)
        } else if self.starts_with(b"ANY") {
            self.pos += 3;
            Ok(ContentSpec::Any)
        } else if self.peek() == b'(' {
            self.pos += 1;
            Ok(ContentSpec::Open)
        } else {
            Err(self.err_here("Expected EMPTY, ANY or '(' in the element declaration but found"))
        }
    }

    fn scan_occurrence(&mut self) -> Occurrence {
        let occurrence = match self.peek() {
            b'?' => Occurrence::Optional,
            b'*' => Occurrence::ZeroOrMore,
            b'+' => Occurrence::OneOrMore,
            _ => return Occurrence::Once,
        };
        self.pos += 1;
        occurrence
    }

    /// A content particle position: `S?` then a name (with its occurrence
    /// indicator, which must follow immediately), `(`, or `#PCDATA`.
    fn scan_cp_item(&mut self) -> PResult<CpItem> {
        self.skip_decl_ws()?;
        match self.peek() {
            b'(' => {
                self.pos += 1;
                Ok(CpItem::Open)
            }
            b'#' => {
                if !self.starts_with(b"#PCDATA") {
                    return Err(self.err_here("Expected '#PCDATA' but found"));
                }
                self.pos += 7;
                Ok(CpItem::PcData)
            }
            _ => {
                self.scan_name(
                    "Expected an element name, '(' or '#PCDATA' in the content model but found",
                )?;
                Ok(CpItem::Name(self.scan_occurrence()))
            }
        }
    }

    /// After a content particle: `S?` then `)` (with its occurrence
    /// indicator), `|`, or `,`.
    fn scan_cp_sep(&mut self) -> PResult<CpSep> {
        self.skip_decl_ws()?;
        match self.peek() {
            b')' => {
                self.pos += 1;
                Ok(CpSep::Close(self.scan_occurrence()))
            }
            b'|' => {
                self.pos += 1;
                Ok(CpSep::Choice)
            }
            b',' => {
                self.pos += 1;
                Ok(CpSep::Seq)
            }
            _ => Err(self.err_here("Expected ')', '|' or ',' in the content model but found")),
        }
    }

    // `<!ATTLIST` ───────────────────────────────────────────────────────────

    /// The next attribute definition's name (after required whitespace) or
    /// the `>` ending the ATTLIST.
    fn scan_attdef_item(&mut self) -> PResult<AttDefItem<'a>> {
        let had_ws = self.skip_decl_ws()?;
        if self.peek() == b'>' {
            let frame = self.frame_id;
            self.pos += 1;
            return Ok(AttDefItem::End { frame });
        }
        if !had_ws {
            return Err(self.err_here("Expected whitespace before the attribute name in the ATTLIST declaration but found"));
        }
        let name = self
            .scan_name("Expected an attribute name or '>' in the ATTLIST declaration but found")?;
        Ok(AttDefItem::Name(name))
    }

    /// `S AttType`.
    fn scan_att_type(&mut self) -> PResult<AttType> {
        self.require_decl_ws("Expected whitespace after the attribute name but found")?;
        if self.peek() == b'(' {
            self.pos += 1;
            self.skip_enumeration(false)?;
            return Ok(AttType::Other);
        }
        // Longer keywords first (IDREFS before IDREF before ID).
        const KEYWORDS: [(&[u8], AttType); 8] = [
            (b"CDATA", AttType::Cdata),
            (b"IDREFS", AttType::Other),
            (b"IDREF", AttType::Other),
            (b"ID", AttType::Other),
            (b"ENTITIES", AttType::Other),
            (b"ENTITY", AttType::Other),
            (b"NMTOKENS", AttType::Other),
            (b"NMTOKEN", AttType::Other),
        ];
        for (keyword, att_type) in KEYWORDS {
            if self.starts_with(keyword) {
                self.pos += keyword.len();
                return Ok(att_type);
            }
        }
        if self.starts_with(b"NOTATION") {
            self.pos += 8;
            self.require_decl_ws("Expected whitespace after NOTATION but found")?;
            if self.peek() != b'(' {
                return Err(self.err_here("Expected '(' after NOTATION but found"));
            }
            self.pos += 1;
            self.skip_enumeration(true)?;
            return Ok(AttType::Other);
        }
        Err(self.err_here("Expected an attribute type (CDATA, ID, IDREF, IDREFS, ENTITY, ENTITIES, NMTOKEN, NMTOKENS, NOTATION or an enumeration) but found"))
    }

    /// The rest of `'(' S? x (S? '|' S? x)* S? ')'` after `(`, where `x` is
    /// a Name (NOTATION types) or an Nmtoken (enumerations).
    fn skip_enumeration(&mut self, names: bool) -> PResult<()> {
        loop {
            self.skip_decl_ws()?;
            if names {
                self.scan_name("Expected a notation name but found")?;
            } else {
                self.scan_nmtoken()?;
            }
            self.skip_decl_ws()?;
            match self.peek() {
                b'|' => self.pos += 1,
                b')' => {
                    self.pos += 1;
                    return Ok(());
                }
                _ => return Err(self.err_here("Expected '|' or ')' in the enumeration but found")),
            }
        }
    }

    /// `S DefaultDecl`.
    fn scan_default_decl(&mut self) -> PResult<DefaultDecl<'a>> {
        self.require_decl_ws("Expected whitespace after the attribute type but found")?;
        if self.starts_with(b"#REQUIRED") {
            self.pos += 9;
            return Ok(DefaultDecl::Required);
        }
        if self.starts_with(b"#IMPLIED") {
            self.pos += 8;
            return Ok(DefaultDecl::Implied);
        }
        if self.starts_with(b"#FIXED") {
            self.pos += 6;
            self.require_decl_ws("Expected whitespace after #FIXED but found")?;
        }
        let quote = self.expect_quote(
            "Expected #REQUIRED, #IMPLIED, #FIXED or a quoted default value but found",
        )?;
        let (value, is_ascii) = self.scan_att_value(quote)?;
        Ok(DefaultDecl::Value { value, is_ascii })
    }

    // `<!ENTITY` ────────────────────────────────────────────────────────────

    /// `S ('%' S)? Name`.
    fn scan_entity_decl_head(&mut self) -> PResult<EntityDeclHead<'a>> {
        self.require_decl_ws("Expected whitespace after '<!ENTITY' but found")?;
        let parameter = self.peek() == b'%';
        if parameter {
            self.pos += 1;
            self.require_decl_ws("Expected whitespace after '%' but found")?;
        }
        let name = self.scan_name("Expected an entity name but found")?;
        Ok(EntityDeclHead { parameter, name })
    }

    /// `S (EntityValue | ExternalID NDataDecl?)`; trailing `S` is consumed.
    fn scan_entity_def(&mut self, parameter: bool) -> PResult<EntityDef<'a>> {
        self.require_decl_ws("Expected whitespace after the entity name but found")?;
        if let q @ (b'"' | b'\'') = self.peek() {
            self.pos += 1;
            return Ok(EntityDef::Internal(self.scan_entity_value(q)?));
        }
        self.scan_external_id(false)?;
        // NDataDecl ::= S 'NDATA' S Name — general entities only.
        let had_ws = self.skip_decl_ws()?;
        if had_ws && self.starts_with(b"NDATA") {
            if parameter {
                return Err(self.err_here("Parameter entities cannot have NDATA:"));
            }
            self.pos += 5;
            self.require_decl_ws("Expected whitespace after NDATA but found")?;
            self.scan_name("Expected a notation name after NDATA but found")?;
            return Ok(EntityDef::External { unparsed: true });
        }
        Ok(EntityDef::External { unparsed: false })
    }

    // `<!NOTATION` ──────────────────────────────────────────────────────────

    /// `S (ExternalID | PublicID)`.
    fn scan_notation_id(&mut self) -> PResult<()> {
        self.require_decl_ws("Expected whitespace after the notation name but found")?;
        self.scan_external_id(true)
    }

    // ── scan modes: tags ───────────────────────────────────────────────────

    /// Inside a start tag after the name: an attribute (after required
    /// whitespace) or the end of the tag.
    fn scan_tag_item(&mut self) -> PResult<TagItem<'a>> {
        let had_ws = self.skip_ws();
        match self.peek() {
            b'>' => {
                self.pos += 1;
                Ok(TagItem::End { empty: false })
            }
            b'/' => {
                self.pos += 1;
                if self.peek() != b'>' {
                    return Err(self.err_here("Expected '>' after '/' in the tag but found"));
                }
                self.pos += 1;
                Ok(TagItem::End { empty: true })
            }
            _ if self.at_end() => {
                Err(self.err_here("Unterminated start tag: expected '>' but found"))
            }
            _ => {
                if !had_ws {
                    return Err(self.err_here("Expected whitespace, '>' or '/>' after the previous name or value in the tag but found"));
                }
                let pos = self.here();
                let name = self.scan_name("Expected an attribute name but found")?;
                self.skip_ws();
                if self.peek() != b'=' {
                    return Err(self.err_here("Expected '=' after the attribute name but found"));
                }
                self.pos += 1;
                self.skip_ws();
                let quote = self.expect_quote("Expected a quoted attribute value but found")?;
                let (value, is_ascii) = self.scan_att_value(quote)?;
                Ok(TagItem::Attr {
                    name,
                    value,
                    is_ascii,
                    pos,
                })
            }
        }
    }

    // ── scan modes: content ────────────────────────────────────────────────

    /// Element content: the next tag, or one maximal text run with CDATA
    /// sections, references and included entities folded in and comments
    /// and PIs skipped, or the end of input.
    fn scan_content(&mut self) -> PResult<Content<'a>> {
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
                    return Ok(if have_text!() {
                        self.finish_text(start, buf, is_ascii, text_pos)
                    } else {
                        Content::Eof { pos: self.here() }
                    });
                }
                b'<' => {
                    let pos = self.here();
                    let next = self.peek_at(self.pos + 1);
                    if next == b'!' && self.starts_with(b"<!--") {
                        flush!();
                        self.pos += 4;
                        self.skip_comment(pos)?;
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
                        self.skip_pi(pos)?;
                        start = self.pos;
                    } else if have_text!() {
                        // A tag ends the run; leave it for the next call.
                        return Ok(self.finish_text(start, buf, is_ascii, text_pos));
                    } else if next == b'/' {
                        self.pos += 2;
                        let frame = self.frame_id;
                        let name =
                            self.scan_name("Expected an element name after '</' but found")?;
                        self.skip_ws();
                        if self.peek() != b'>' {
                            return Err(
                                self.err_here("Expected '>' to end the closing tag but found")
                            );
                        }
                        self.pos += 1;
                        return Ok(Content::EndTag { name, pos, frame });
                    } else if next == b'!' {
                        return Err(self.err(pos, "Expected a comment or CDATA section after '<!'"));
                    } else {
                        self.pos += 1;
                        let frame = self.frame_id;
                        let name =
                            self.scan_name("Expected an element name after '<' but found")?;
                        return Ok(Content::StartTag { name, pos, frame });
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
    ) -> Content<'a> {
        let text: &'a [u8] = match buf {
            Some(mut b) => {
                b.extend_from_slice(&self.src[start..self.pos]);
                b.into_bump_slice()
            }
            None => &self.src[start..self.pos],
        };
        Content::Text {
            text,
            is_ascii,
            pos,
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

/// Consumes tokens from the scanner, checks the grammar and the structural
/// well-formedness constraints, applies DTD information to attributes, and
/// drives a `Sink`. Has no access to source bytes.
struct Parser<'a, 'log, S: Sink<'a>> {
    scanner: Scanner<'a, 'log>,
    bump: &'a Bump,
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
                encoding: options.encoding,
                bump,
                source,
                log,
            },
            bump,
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
        let pos = self.scanner.here();
        let _ = self.scanner.err(pos, "Nesting is too deep");
        PErr::StackOverflow
    }

    // ── document ───────────────────────────────────────────────────────────

    /// `document ::= prolog element Misc*` (§2.1 [1]).
    fn parse_document(mut self) -> PResult<Expr> {
        self.scanner.init_document()?;
        if self.scanner.scan_xml_decl_start() {
            self.parse_xml_decl()?;
        }
        self.scanner.check_utf16_declaration()?;
        self.scanner.validate_utf8()?;
        let mut seen_doctype = false;
        loop {
            match self.scanner.scan_prolog_item()? {
                PrologItem::Doctype { pos } => {
                    if seen_doctype {
                        return Err(self
                            .scanner
                            .err(pos, "Only one document type declaration is allowed"));
                    }
                    seen_doctype = true;
                    self.parse_doctype()?;
                }
                PrologItem::StartTag { name, pos, frame } => {
                    self.parse_element(name, pos, frame)?;
                    break;
                }
                PrologItem::Eof { pos } => {
                    return Err(self
                        .scanner
                        .err(pos, "XML document must have a root element"));
                }
            }
        }
        self.scanner.scan_epilog()?;
        Ok(self.sink.finish())
    }

    /// `XMLDecl ::= '<?xml' VersionInfo EncodingDecl? SDDecl? S? '?>'`
    /// (§2.8 [23]) after `<?xml`.
    fn parse_xml_decl(&mut self) -> PResult<()> {
        #[derive(PartialEq, PartialOrd)]
        enum Seen {
            Nothing,
            Version,
            Encoding,
            Standalone,
        }
        let mut seen = Seen::Nothing;
        let mut encoding: Option<(&'a [u8], usize)> = None;
        loop {
            match self.scanner.scan_xml_decl_item()? {
                XmlDeclItem::End { pos } => {
                    if seen == Seen::Nothing {
                        return Err(self
                            .scanner
                            .err(pos, "The XML declaration must specify the version"));
                    }
                    break;
                }
                XmlDeclItem::Attr { name, value, pos } => {
                    match name {
                        b"version" if seen == Seen::Nothing => {
                            // VersionNum ::= '1.' [0-9]+ — a 1.x document other
                            // than 1.0 is processed as 1.0 (§2.8, erratum E10).
                            let valid = value.len() >= 3
                                && value.starts_with(b"1.")
                                && value[2..].iter().all(u8::is_ascii_digit);
                            if !valid {
                                return Err(self.scanner.err_named(
                                    pos,
                                    "Unsupported XML version",
                                    value,
                                    " (this is an XML 1.0 parser)",
                                ));
                            }
                            seen = Seen::Version;
                        }
                        b"encoding" if seen == Seen::Version => {
                            // EncName ::= [A-Za-z] ([A-Za-z0-9._] | '-')*
                            let valid = value.first().is_some_and(u8::is_ascii_alphabetic)
                                && value.iter().all(|c| {
                                    c.is_ascii_alphanumeric() || matches!(c, b'.' | b'_' | b'-')
                                });
                            if !valid {
                                return Err(self.scanner.err_named(
                                    pos,
                                    "Invalid encoding name",
                                    value,
                                    " in the XML declaration",
                                ));
                            }
                            encoding = Some((value, pos));
                            seen = Seen::Encoding;
                        }
                        b"standalone" if seen == Seen::Version || seen == Seen::Encoding => {
                            match value {
                                b"yes" => self.scanner.standalone = true,
                                b"no" => {}
                                _ => {
                                    return Err(self.scanner.err_named(pos, "Invalid value", value, " for standalone in the XML declaration (expected yes or no)"));
                                }
                            }
                            seen = Seen::Standalone;
                        }
                        b"encoding" | b"standalone" if seen == Seen::Nothing => {
                            return Err(self
                                .scanner
                                .err(pos, "The XML declaration must start with version=\"1.0\""));
                        }
                        b"version" | b"encoding" | b"standalone" => {
                            return Err(self.scanner.err_named(pos, "Misplaced", name, " in the XML declaration (the order is version, encoding, standalone)"));
                        }
                        _ => {
                            return Err(self.scanner.err_named(pos, "Unexpected", name, " in the XML declaration (expected version, encoding or standalone)"));
                        }
                    }
                }
            }
        }
        if let Some((name, pos)) = encoding {
            self.scanner.apply_declared_encoding(name, pos)?;
        }
        Ok(())
    }

    // ── document type declaration ──────────────────────────────────────────

    /// `doctypedecl` (§2.8 [28]) after `<!DOCTYPE`.
    fn parse_doctype(&mut self) -> PResult<()> {
        self.scanner.scan_doctype_name()?;
        let mut item = self.scanner.scan_doctype_item(true)?;
        if let DoctypeItem::ExternalId = item {
            self.scanner.has_external_subset = true;
            item = self.scanner.scan_doctype_item(false)?;
        }
        match item {
            DoctypeItem::ExternalId => {
                unreachable!("scan_doctype_item(false) does not produce ExternalId")
            }
            DoctypeItem::Close => {}
            DoctypeItem::OpenSubset => {
                self.parse_internal_subset()?;
                self.scanner.scan_doctype_close()?;
            }
        }
        Ok(())
    }

    /// Whether ENTITY and ATTLIST declarations are still processed: not
    /// after a reference to a parameter entity that was not read, unless
    /// standalone="yes" (§5.1).
    fn processing_declarations(&self) -> bool {
        self.scanner.standalone || !self.scanner.saw_unread_pe
    }

    /// `intSubset ::= (markupdecl | DeclSep)*` (§2.8 [28b]) up to `]`.
    fn parse_internal_subset(&mut self) -> PResult<()> {
        loop {
            match self.scanner.scan_subset_item()? {
                SubsetItem::Close => return Ok(()),
                SubsetItem::Decl { kind, pos, frame } => {
                    let end_frame = match kind {
                        DeclKind::Element => self.parse_element_decl()?,
                        DeclKind::Attlist => self.parse_attlist_decl()?,
                        DeclKind::Entity => self.parse_entity_decl()?,
                        DeclKind::Notation => self.parse_notation_decl()?,
                    };
                    // WFC: PE Between Declarations, and VC-turned-fatal
                    // Proper Declaration/PE Nesting for what we do read.
                    if end_frame != frame {
                        return Err(self.scanner.err(
                            pos,
                            "A markup declaration must begin and end in the same entity",
                        ));
                    }
                }
            }
        }
    }

    /// `elementdecl` (§3.2 [45]) after `<!ELEMENT`. The content model is
    /// checked and dropped.
    fn parse_element_decl(&mut self) -> PResult<u32> {
        self.scanner.scan_decl_name()?;
        match self.scanner.scan_content_spec()? {
            ContentSpec::Empty | ContentSpec::Any => {}
            ContentSpec::Open => match self.scanner.scan_cp_item()? {
                CpItem::PcData => self.parse_mixed()?,
                first => self.parse_children(first)?,
            },
        }
        self.scanner.scan_decl_end()
    }

    /// `Mixed` (§3.2.2 [51]) after `'(' S? '#PCDATA'`.
    fn parse_mixed(&mut self) -> PResult<()> {
        let mut names = 0usize;
        loop {
            match self.scanner.scan_cp_sep()? {
                CpSep::Choice => match self.scanner.scan_cp_item()? {
                    CpItem::Name(Occurrence::Once) => names += 1,
                    CpItem::Name(_) => {
                        return Err(self.scanner.err(
                            self.scanner.here(),
                            "Names in a mixed content model cannot have occurrence indicators",
                        ));
                    }
                    CpItem::Open | CpItem::PcData => {
                        return Err(self.scanner.err(
                            self.scanner.here(),
                            "Only element names may follow #PCDATA in a mixed content model",
                        ));
                    }
                },
                CpSep::Seq => {
                    return Err(self.scanner.err(
                        self.scanner.here(),
                        "A mixed content model is separated by '|', not ','",
                    ));
                }
                CpSep::Close(occurrence) => {
                    return match (names, occurrence) {
                        (_, Occurrence::ZeroOrMore) | (0, Occurrence::Once) => Ok(()),
                        (0, _) => Err(self
                            .scanner
                            .err(self.scanner.here(), "(#PCDATA) may only be followed by '*'")),
                        _ => Err(self.scanner.err(
                            self.scanner.here(),
                            "A mixed content model with element names must end with ')*'",
                        )),
                    };
                }
            }
        }
    }

    /// `choice` / `seq` (§3.2.1 [49] [50]) after `(` with the first
    /// particle already scanned; nested groups recurse.
    fn parse_children(&mut self, first: CpItem) -> PResult<()> {
        if !self.stack_check.is_safe_to_recurse() {
            return Err(self.stack_overflow());
        }
        let mut item = first;
        let mut separator: Option<bool> = None; // Some(true): '|', Some(false): ','
        loop {
            match item {
                CpItem::Name(_) => {}
                CpItem::Open => {
                    let inner = self.scanner.scan_cp_item()?;
                    self.parse_children(inner)?;
                }
                CpItem::PcData => {
                    return Err(self.scanner.err(
                        self.scanner.here(),
                        "#PCDATA must be the first item of a content model group",
                    ));
                }
            }
            let is_choice = match self.scanner.scan_cp_sep()? {
                CpSep::Close(_) => return Ok(()),
                CpSep::Choice => true,
                CpSep::Seq => false,
            };
            if *separator.get_or_insert(is_choice) != is_choice {
                return Err(self.scanner.err(
                    self.scanner.here(),
                    "A content model group cannot mix ',' and '|'",
                ));
            }
            item = self.scanner.scan_cp_item()?;
        }
    }

    /// `AttlistDecl` (§3.3 [52]) after `<!ATTLIST`.
    fn parse_attlist_decl(&mut self) -> PResult<u32> {
        let element = self.scanner.scan_decl_name()?;
        loop {
            let name = match self.scanner.scan_attdef_item()? {
                AttDefItem::End { frame } => return Ok(frame),
                AttDefItem::Name(name) => name,
            };
            let att_type = self.scanner.scan_att_type()?;
            let default = self.scanner.scan_default_decl()?;
            if !self.processing_declarations() {
                continue;
            }
            let cdata = att_type == AttType::Cdata;
            let default = match default {
                DefaultDecl::Required | DefaultDecl::Implied => None,
                DefaultDecl::Value { value, is_ascii } if cdata => Some((value, is_ascii)),
                DefaultDecl::Value { value, is_ascii } => {
                    Some((collapse_spaces(self.bump, value), is_ascii))
                }
            };
            self.attlists.entry(element).or_default().declare(AttDef {
                name,
                cdata,
                default,
            });
        }
    }

    /// `EntityDecl` (§4.2 [70]) after `<!ENTITY`.
    fn parse_entity_decl(&mut self) -> PResult<u32> {
        let head = self.scanner.scan_entity_decl_head()?;
        let def = self.scanner.scan_entity_def(head.parameter)?;
        let frame = self.scanner.scan_decl_end()?;
        if self.processing_declarations() {
            let value = match def {
                EntityDef::Internal(value) => EntityValue::Internal(value),
                EntityDef::External { unparsed: false } => EntityValue::External,
                EntityDef::External { unparsed: true } => EntityValue::Unparsed,
            };
            let table = if head.parameter {
                &mut self.scanner.entities.parameter
            } else {
                &mut self.scanner.entities.general
            };
            // The first declaration is binding (§4.2).
            table.entry(head.name).or_insert_with(|| value);
        }
        Ok(frame)
    }

    /// `NotationDecl` (§4.7 [82]) after `<!NOTATION`.
    fn parse_notation_decl(&mut self) -> PResult<u32> {
        self.scanner.scan_decl_name()?;
        self.scanner.scan_notation_id()?;
        self.scanner.scan_decl_end()
    }

    // ── elements ───────────────────────────────────────────────────────────

    /// `element` (§3.1 [39]) after `<Name`: attributes, then (unless the tag
    /// was empty) content up to the matching end tag.
    fn parse_element(&mut self, name: &'a [u8], pos: usize, frame: u32) -> PResult<()> {
        if !self.stack_check.is_safe_to_recurse() {
            return Err(self.stack_overflow());
        }
        let loc = self.scanner.loc(pos);
        let empty = self.parse_attributes(name)?;
        self.sink.start_element(name, &self.attributes, loc);
        if empty {
            self.sink.end_element();
            return Ok(());
        }
        loop {
            match self.scanner.scan_content()? {
                Content::Text {
                    text,
                    is_ascii,
                    pos,
                } => {
                    let loc = self.scanner.loc(pos);
                    self.sink.text(text, is_ascii, loc);
                }
                Content::StartTag { name, pos, frame } => self.parse_element(name, pos, frame)?,
                Content::EndTag {
                    name: end_name,
                    pos: end_pos,
                    frame: end_frame,
                } => {
                    // WFC: Element Type Match.
                    if end_name != name {
                        return Err(self.scanner.err_fmt(
                            end_pos,
                            format_args!(
                                "Expected closing tag </{}> but found </{}>",
                                bstr::BStr::new(name),
                                bstr::BStr::new(end_name)
                            ),
                        ));
                    }
                    if end_frame != frame {
                        return Err(self.scanner.err_named(
                            end_pos,
                            "Element",
                            name,
                            " must start and end within the same entity",
                        ));
                    }
                    self.sink.end_element();
                    return Ok(());
                }
                Content::Eof { pos: eof_pos } => {
                    return Err(self.scanner.err_named(
                        eof_pos,
                        "Missing closing tag for element",
                        name,
                        "",
                    ));
                }
            }
        }
    }

    /// The attributes of a start tag, into `self.attributes`: duplicates
    /// rejected (WFC: Unique Att Spec), declared non-CDATA attributes further
    /// normalized (§3.3.3), declared defaults supplied (§3.3.2). Returns
    /// whether the tag was an empty-element tag.
    fn parse_attributes(&mut self, element: &'a [u8]) -> PResult<bool> {
        self.attributes.clear();
        self.attribute_names.clear();
        let defs = self.attlists.get(element);
        let empty = loop {
            match self.scanner.scan_tag_item()? {
                TagItem::End { empty } => break empty,
                TagItem::Attr {
                    name,
                    mut value,
                    is_ascii,
                    pos,
                } => {
                    if Self::has_attribute(&self.attributes, &self.attribute_names, name) {
                        return Err(self.scanner.err_named(pos, "Duplicate attribute", name, ""));
                    }
                    if let Some(def) = defs.and_then(|defs| defs.get(name)) {
                        if !def.cdata {
                            value = collapse_spaces(self.bump, value);
                        }
                    }
                    Self::push_attribute(
                        &mut self.attributes,
                        &mut self.attribute_names,
                        Attribute {
                            name,
                            value,
                            is_ascii,
                        },
                    );
                }
            }
        };
        if let Some(defs) = defs {
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

/// The extra normalization for attributes declared with a non-CDATA type
/// (§3.3.3): leading and trailing spaces removed, runs of spaces collapsed.
/// All whitespace in `value` is already #x20.
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
