//! YAML parser.
//!
//! `Encoding` is modeled as a trait with an associated `Unit` type (`u8` or
//! `u16`), and `Parser<Enc>` is generic over `Enc: Encoding`.
//!
//! Several scanners are state-machine loops written as
//! `let mut __c = x; loop { match __c { ... } }` with `__c = y; continue;`.
//! Each is marked `// labeled-switch loop`.

use core::cmp::Ordering;
use core::fmt;

use bun_alloc::AllocError;
use bun_ast::{self, E, Expr, G};
use bun_ast::{self as ast, Loc};
use bun_collections::{HashMap, StringHashMap, VecExt};
use bun_core::{self, StackCheck};

// ───────────────────────────────────────────────────────────────────────────
// YAML entry point
// ───────────────────────────────────────────────────────────────────────────

pub struct YAML;

impl YAML {
    /// Parse a YAML document. Self-referential anchors (`&a {self: *a}`) are
    /// rejected with `Unresolved alias` so the returned `Expr` graph is
    /// acyclic; callers that walk it without a seen-set (bundler printer,
    /// `Expr::deep_clone`) stay safe.
    pub fn parse(
        source: &bun_ast::Source,
        log: &mut bun_ast::Log,
        bump: &bun_alloc::Arena,
    ) -> Result<Expr, YamlParseError> {
        Self::parse_impl(source, log, bump, false)
    }

    /// Parse a YAML document with self-referential anchors resolved. The
    /// returned `Expr` graph may contain cycles; the caller must be able to
    /// walk a cyclic graph (as `Bun.YAML.parse`'s `to_js` does via
    /// `seen_objects`).
    pub fn parse_allowing_self_references(
        source: &bun_ast::Source,
        log: &mut bun_ast::Log,
        bump: &bun_alloc::Arena,
    ) -> Result<Expr, YamlParseError> {
        Self::parse_impl(source, log, bump, true)
    }

    fn parse_impl(
        source: &bun_ast::Source,
        log: &mut bun_ast::Log,
        bump: &bun_alloc::Arena,
        allow_self_referential_aliases: bool,
    ) -> Result<Expr, YamlParseError> {
        bun_core::analytics::Features::yaml_parse_inc();

        let mut parser: Parser<Utf8> = Parser::init(bump, source.contents());
        parser.allow_self_referential_aliases = allow_self_referential_aliases;

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
            0 => Ok(Expr::init(E::Null {}, Loc::EMPTY)),
            1 => Ok(stream.docs[0].root),
            _ => {
                // multi-document yaml streams are converted into arrays
                let mut items: ast::ExprNodeList =
                    ast::ExprNodeList::init_capacity(stream.docs.len());
                for doc in &stream.docs {
                    items.push(doc.root);
                }
                Ok(Expr::init(
                    E::Array {
                        items,
                        ..Default::default()
                    },
                    Loc::EMPTY,
                ))
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

bun_core::oom_from_alloc!(YamlParseError);

impl From<YamlParseError> for crate::Error {
    fn from(e: YamlParseError) -> Self {
        match e {
            YamlParseError::OutOfMemory => crate::Error::Alloc(bun_alloc::AllocError),
            YamlParseError::SyntaxError => crate::Error::SyntaxError,
            YamlParseError::StackOverflow => crate::Error::StackOverflow,
        }
    }
}

// ───────────────────────────────────────────────────────────────────────────
// Top-level free functions
// ───────────────────────────────────────────────────────────────────────────

pub fn parse<'i, Enc: Encoding>(
    bump: &'i bun_alloc::Arena,
    input: &'i [Enc::Unit],
) -> ParseResult<'i, Enc> {
    let mut parser: Parser<Enc> = Parser::init(bump, input);

    match parser.parse() {
        Ok(stream) => ParseResult::success(stream, &parser),
        Err(err) => ParseResult::fail(err, &parser),
    }
}

pub fn print<Enc: Encoding, W: fmt::Write>(stream: Stream<'_, Enc>, writer: &mut W) -> fmt::Result {
    // The printer was never implemented; this is a hard panic on the
    // (currently unreachable — `rg yaml::print src/` has no callers) path.
    let _ = (stream, writer);
    panic!(
        "yaml::print: Printer is commented out in the Zig original (dead-by-spec; uses removed Node type)"
    );
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
        match n {
            0 => IndentIndicator::Auto,
            1 => IndentIndicator::N1,
            2 => IndentIndicator::N2,
            3 => IndentIndicator::N3,
            4 => IndentIndicator::N4,
            5 => IndentIndicator::N5,
            6 => IndentIndicator::N6,
            7 => IndentIndicator::N7,
            8 => IndentIndicator::N8,
            9 => IndentIndicator::N9,
            // The only caller (`read_indentation_indicator`) passes `digit - b'0'`
            // after a `b'1'..=b'9'` guard, so this arm is unreachable.
            _ => panic!("invalid IndentIndicator"),
        }
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

    pub fn loc(self) -> bun_ast::Loc {
        bun_ast::Loc {
            start: i32::try_from(self.0).expect("int cast"),
        }
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

// ───────────────────────────────────────────────────────────────────────────
// Encoding trait
// ───────────────────────────────────────────────────────────────────────────

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum EncodingKind {
    Latin1,
    Utf8,
    Utf16,
}

/// Stack buffer for an ASCII literal widened to `Enc::Unit`. Rust cannot do
/// const transcoding behind a trait method, so the literal is widened at the
/// call site into this inline buffer instead.
/// All call sites in this file pass ≤4-byte ASCII; the
/// cap of 8 leaves headroom for new literals.
#[derive(Clone, Copy)]
pub struct EncLit<U: Copy + Default> {
    buf: [U; 8],
    len: u8,
}

impl<U: Copy + Default> EncLit<U> {
    #[inline]
    fn as_slice(&self) -> &[U] {
        &self.buf[..self.len as usize]
    }
}

impl<U: Copy + Default> core::ops::Deref for EncLit<U> {
    type Target = [U];
    #[inline]
    fn deref(&self) -> &[U] {
        self.as_slice()
    }
}

impl<U: Copy + Default> AsRef<[U]> for EncLit<U> {
    #[inline]
    fn as_ref(&self) -> &[U] {
        self.as_slice()
    }
}

/// Code-unit encoding of the parser input; `Unit` is `u8` or `u16`.
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

    /// A string literal in the target encoding. Callers pass ASCII only;
    /// widened into an inline `EncLit` buffer (see `EncLit` doc for the
    /// const-generics rationale).
    fn literal(s: &'static [u8]) -> EncLit<Self::Unit>;

    /// Number of leading units to skip if `input` starts with [3] c-byte-order-mark.
    fn bom_len(input: &[Self::Unit]) -> usize;

    /// Reinterpret a `&[Unit]` slice as `&[u8]` for `StringHashMap` keying
    /// (`anchors` / `tag_handles`). `StringHashMap` is keyed by `&[u8]`, so we
    /// route through this
    /// method — identity for `u8` encodings, byte-reinterpret (`len * 2`) for
    /// `Utf16`. Byte-reinterpret preserves key uniqueness; do **not** use this
    /// for text (see `NodeScalar::to_expr` for the encoding-aware string path).
    fn key_bytes(s: &[Self::Unit]) -> &[u8];

    /// Construct a Unit from a `u16` code unit. Only meaningful for `Utf16`
    /// (identity); the `u8` encodings mark this `unreachable!()` because every
    /// call site is gated on `Enc::KIND == EncodingKind::Utf16`.
    fn unit_from_u16(u: u16) -> Self::Unit;

    /// Reinterpret `&[Unit]` as `&[u16]`. Identity for `Utf16`; the `u8`
    /// encodings keep this default `unreachable!()` because every call site is
    /// gated on `Enc::KIND == EncodingKind::Utf16` (same pattern as
    /// `unit_from_u16`). Feeds [`bun_core::strings::narrow_ascii_u16`].
    #[inline]
    fn as_u16_slice(_s: &[Self::Unit]) -> &[u16] {
        unreachable!("as_u16_slice on u8 encoding")
    }
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
    #[inline]
    fn literal(s: &'static [u8]) -> EncLit<u8> {
        debug_assert!(s.len() <= 8, "Enc::literal: bump EncLit cap");
        let mut buf = [0u8; 8];
        buf[..s.len()].copy_from_slice(s);
        EncLit {
            buf,
            len: s.len() as u8,
        }
    }
    #[inline]
    fn key_bytes(s: &[u8]) -> &[u8] {
        s
    }
    #[inline]
    fn unit_from_u16(_u: u16) -> u8 {
        // Only reachable from `EncodingKind::Utf16`-gated arms.
        unreachable!("unit_from_u16 on Latin1")
    }
    #[inline]
    fn bom_len(_input: &[u8]) -> usize {
        0
    }
}

impl Encoding for Utf8 {
    type Unit = u8;
    const KIND: EncodingKind = EncodingKind::Utf8;
    const NUL: u8 = 0;
    fn ch(c: u8) -> u8 {
        c
    }
    #[inline]
    fn literal(s: &'static [u8]) -> EncLit<u8> {
        debug_assert!(s.len() <= 8, "Enc::literal: bump EncLit cap");
        let mut buf = [0u8; 8];
        buf[..s.len()].copy_from_slice(s);
        EncLit {
            buf,
            len: s.len() as u8,
        }
    }
    #[inline]
    fn key_bytes(s: &[u8]) -> &[u8] {
        s
    }
    #[inline]
    fn unit_from_u16(_u: u16) -> u8 {
        // Only reachable from `EncodingKind::Utf16`-gated arms.
        unreachable!("unit_from_u16 on Utf8")
    }
    #[inline]
    fn bom_len(input: &[u8]) -> usize {
        if input.len() >= 3 && input[0] == 0xEF && input[1] == 0xBB && input[2] == 0xBF {
            3
        } else {
            0
        }
    }
}

impl Encoding for Utf16 {
    type Unit = u16;
    const KIND: EncodingKind = EncodingKind::Utf16;
    const NUL: u16 = 0;
    fn ch(c: u8) -> u16 {
        c as u16
    }
    #[inline]
    fn literal(s: &'static [u8]) -> EncLit<u16> {
        // All call sites pass ASCII, so widen byte-by-byte into the inline buffer.
        debug_assert!(s.len() <= 8, "Enc::literal: bump EncLit cap");
        let mut buf = [0u16; 8];
        let mut i = 0;
        while i < s.len() {
            debug_assert!(s[i] < 0x80, "Enc::literal expects ASCII");
            buf[i] = s[i] as u16;
            i += 1;
        }
        EncLit {
            buf,
            len: s.len() as u8,
        }
    }
    #[inline]
    fn key_bytes(s: &[u16]) -> &[u8] {
        // Reinterpret `&[u16]` as `&[u8]` of `len * 2` for byte-keyed hashing.
        // Uniqueness is preserved (equal u16 slices ⇔ equal byte slices). Same
        // pattern as `bun_ast::E::EString::hash()` for the utf16 arm.
        bytemuck::cast_slice(s)
    }
    #[inline]
    fn unit_from_u16(u: u16) -> u16 {
        u
    }
    #[inline]
    fn bom_len(input: &[u16]) -> usize {
        if input.first() == Some(&0xFEFF) { 1 } else { 0 }
    }
    #[inline]
    fn as_u16_slice(s: &[u16]) -> &[u16] {
        s
    }
}

// ───────────────────────────────────────────────────────────────────────────
// chars — character classification
// ───────────────────────────────────────────────────────────────────────────

pub mod chars {
    use super::{Encoding, EncodingKind};

    pub fn is_ns_dec_digit<Enc: Encoding>(c: Enc::Unit) -> bool {
        matches!(Enc::wide(c), 0x30..=0x39)
    }

    pub fn is_ns_hex_digit<Enc: Encoding>(c: Enc::Unit) -> bool {
        // YAML 1.2 production [36] ns-hex-digit — keep spec name, delegate to canonical.
        bun_core::strings::is_hex_code_point(Enc::wide(c))
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
            0x23 | 0x3B | 0x2F | 0x3F | 0x3A | 0x40 | 0x26 | 0x3D | 0x2B | 0x24 | 0x5F | 0x2E
            | 0x7E | 0x2A | 0x27 | 0x28 | 0x29 => Some(1),

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
            0x2D | 0x3F
                | 0x3A
                | 0x2C
                | 0x5B
                | 0x5D
                | 0x7B
                | 0x7D
                | 0x23
                | 0x26
                | 0x2A
                | 0x21
                | 0x7C
                | 0x3E
                | 0x27
                | 0x22
                | 0x25
                | 0x40
                | 0x60
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
            0x23 | 0x3B | 0x2F | 0x3F | 0x3A | 0x40 | 0x26 | 0x3D | 0x2B | 0x24 | 0x2C | 0x5F
            | 0x2E | 0x21 | 0x7E | 0x2A | 0x27 | 0x28 | 0x29 | 0x5B | 0x5D => true,
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
    #[error("TabIndentation")]
    TabIndentation,
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
    #[error("ExcessiveAliasing")]
    ExcessiveAliasing,
}

bun_core::oom_from_alloc!(ParseError);

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

// Capturing `parser.pos` lazily via a pointer field would pin an immutable
// borrow across mutating scans.
// Capture only `off` and have callers pass the end `Pos` explicitly.
#[derive(Clone, Copy)]
pub struct StringRangeStart {
    pub off: Pos,
}

impl StringRangeStart {
    #[inline]
    pub fn end(self, end: Pos) -> StringRange {
        StringRange { off: self.off, end }
    }
}

#[derive(Clone)]
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
        let l_slice = self.slice(input);
        if l_slice.len() != r.len() {
            return false;
        }
        l_slice
            .iter()
            .zip(r.iter())
            .all(|(a, b)| Enc::wide(*a) == *b as u32)
    }
}

// Plain-scalar string builder. `whitespace_buf` is taken from the parser by
// `string_builder()` and returned by `done()` for capacity reuse.
pub struct StringBuilder<'i, Enc: Encoding> {
    input: &'i [Enc::Unit],
    whitespace_buf: Vec<Whitespace<Enc>>,
    pub str: YamlString<Enc>,
}

impl<'i, Enc: Encoding> StringBuilder<'i, Enc> {
    pub fn append_source(&mut self, unit: Enc::Unit, pos: Pos) -> Result<(), AllocError> {
        self.drain_whitespace()?;

        assert!(self.input[pos.cast()] == unit);
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
        let buf = core::mem::take(&mut self.whitespace_buf);
        let input = self.input;
        for ws in &buf {
            match ws {
                Whitespace::Source { pos, unit } => {
                    assert!(input[pos.cast()] == *unit);
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
                        list.extend_from_slice(range.slice(input));
                        list.push(*unit);
                        self.str = YamlString::List(list);
                    }
                    YamlString::List(list) => list.push(*unit),
                },
            }
        }
        let mut buf = buf;
        buf.clear();
        self.whitespace_buf = buf;
        Ok(())
    }

    /// Discards pending (not yet drained) whitespace.
    pub fn clear_whitespace(&mut self) {
        self.whitespace_buf.clear();
    }

    pub fn append_source_whitespace(
        &mut self,
        unit: Enc::Unit,
        pos: Pos,
    ) -> Result<(), AllocError> {
        self.whitespace_buf.push(Whitespace::Source { unit, pos });
        Ok(())
    }

    pub fn append_whitespace(&mut self, unit: Enc::Unit) -> Result<(), AllocError> {
        self.whitespace_buf.push(Whitespace::New(unit));
        Ok(())
    }

    pub fn append_whitespace_n_times(
        &mut self,
        unit: Enc::Unit,
        n: usize,
    ) -> Result<(), AllocError> {
        for _ in 0..n {
            self.whitespace_buf.push(Whitespace::New(unit));
        }
        Ok(())
    }

    pub fn append_source_slice(&mut self, off: Pos, end: Pos) -> Result<(), AllocError> {
        self.drain_whitespace()?;
        let input = self.input;
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
                list.extend_from_slice(&input[off.cast()..end.cast()]);
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

        let input = self.input;
        assert!(&input[off.cast()..end.cast()] == expected);

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
                list.extend_from_slice(&input[off.cast()..end.cast()]);
            }
        }
        Ok(())
    }

    pub fn append(&mut self, unit: Enc::Unit) -> Result<(), AllocError> {
        self.drain_whitespace()?;
        let input = self.input;
        match &mut self.str {
            YamlString::Range(range) => {
                let mut list: Vec<Enc::Unit> = Vec::with_capacity(range.len() + 1);
                list.extend_from_slice(range.slice(input));
                list.push(unit);
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
        let input = self.input;
        match &mut self.str {
            YamlString::Range(range) => {
                let mut list: Vec<Enc::Unit> = Vec::with_capacity(range.len() + s.len());
                list.extend_from_slice(range.slice(input));
                list.extend_from_slice(s);
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
        let input = self.input;
        match &mut self.str {
            YamlString::Range(range) => {
                let mut list: Vec<Enc::Unit> = Vec::with_capacity(range.len() + n);
                list.extend_from_slice(range.slice(input));
                bun_core::vec::push_n(&mut list, unit, n);
                self.str = YamlString::List(list);
            }
            YamlString::List(list) => bun_core::vec::push_n(list, unit, n),
        }
        Ok(())
    }

    pub fn len(&self) -> usize {
        self.str.len()
    }

    /// Returns the built string and hands the whitespace buffer back to the parser.
    pub fn done(mut self, parser: &mut Parser<'i, Enc>) -> YamlString<Enc> {
        self.whitespace_buf.clear();
        parser.whitespace_buf = core::mem::take(&mut self.whitespace_buf);
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

pub struct ScalarResolverCtx<'i, Enc: Encoding> {
    pub str_builder: StringBuilder<'i, Enc>,

    pub resolved: bool,
    pub scalar: Option<NodeScalar<Enc>>,
    pub tag: NodeTag,

    pub resolved_scalar_len: usize,

    pub start: Pos,
    pub line: Line,
    pub line_indent: Indent,
    pub multiline: bool,
}

impl<'i, Enc: Encoding> ScalarResolverCtx<'i, Enc> {
    pub fn done(self, parser: &mut Parser<'i, Enc>) -> Token<Enc> {
        let multiline = self.multiline;
        let start = self.start;
        let line_indent = self.line_indent;
        let line = self.line;
        let resolved_scalar_len = self.resolved_scalar_len;
        let scalar_opt = self.scalar;

        let scalar: TokenScalar<Enc> = 'scalar: {
            let scalar_str = self.str_builder.done(parser);

            if let Some(scalar) = scalar_opt {
                if scalar_str.len() == resolved_scalar_len {
                    drop(scalar_str);
                    break 'scalar TokenScalar {
                        multiline,
                        is_quoted: false,
                        data: scalar,
                    };
                }
                // the first characters resolved to something
                // but there were more characters afterwards
            }

            break 'scalar TokenScalar {
                multiline,
                is_quoted: false,
                data: NodeScalar::String(scalar_str),
            };
        };

        Token::scalar(ScalarInit {
            start,
            indent: line_indent,
            line,
            resolved: scalar,
        })
    }

    pub fn check_append(&mut self, parser: &Parser<'i, Enc>) {
        if self.str_builder.len() == 0 {
            self.line_indent = parser.line_indent;
            self.line = parser.line;
        } else if self.line != parser.line {
            self.multiline = true;
        }
    }

    pub fn append_source(
        &mut self,
        parser: &Parser<'i, Enc>,
        unit: Enc::Unit,
        pos: Pos,
    ) -> Result<(), AllocError> {
        self.check_append(parser);
        self.str_builder.append_source(unit, pos)
    }

    pub fn append_source_whitespace(
        &mut self,
        unit: Enc::Unit,
        pos: Pos,
    ) -> Result<(), AllocError> {
        self.str_builder.append_source_whitespace(unit, pos)
    }

    pub fn append_source_slice(
        &mut self,
        parser: &Parser<'i, Enc>,
        off: Pos,
        end: Pos,
    ) -> Result<(), AllocError> {
        self.check_append(parser);
        self.str_builder.append_source_slice(off, end)
    }

    // may or may not contain whitespace
    pub fn append_unknown_source_slice(
        &mut self,
        parser: &Parser<'i, Enc>,
        off: Pos,
        end: Pos,
    ) -> Result<(), AllocError> {
        for _pos in off.cast()..end.cast() {
            let pos = Pos::from(_pos);
            let unit = parser.input[pos.cast()];
            match Enc::wide(unit) {
                0x20 | 0x09 | 0x0D | 0x0A => {
                    self.str_builder.append_source_whitespace(unit, pos)?;
                }
                _ => {
                    self.check_append(parser);
                    self.str_builder.append_source(unit, pos)?;
                }
            }
        }
        Ok(())
    }

    pub fn append(&mut self, parser: &Parser<'i, Enc>, unit: Enc::Unit) -> Result<(), AllocError> {
        self.check_append(parser);
        self.str_builder.append(unit)
    }

    pub fn append_whitespace(&mut self, unit: Enc::Unit) -> Result<(), AllocError> {
        self.str_builder.append_whitespace(unit)
    }

    pub fn append_slice(
        &mut self,
        parser: &Parser<'i, Enc>,
        str: &[Enc::Unit],
    ) -> Result<(), AllocError> {
        self.check_append(parser);
        self.str_builder.append_slice(str)
    }

    pub fn append_n_times(
        &mut self,
        parser: &Parser<'i, Enc>,
        unit: Enc::Unit,
        n: usize,
    ) -> Result<(), AllocError> {
        if n == 0 {
            return Ok(());
        }
        self.check_append(parser);
        self.str_builder.append_n_times(unit, n)
    }

    pub fn append_whitespace_n_times(
        &mut self,
        unit: Enc::Unit,
        n: usize,
    ) -> Result<(), AllocError> {
        if n == 0 {
            return Ok(());
        }
        self.str_builder.append_whitespace_n_times(unit, n)
    }

    pub fn resolve(
        &mut self,
        scalar: NodeScalar<Enc>,
        off: Pos,
        text: impl AsRef<[Enc::Unit]>,
    ) -> Result<(), AllocError> {
        let text = text.as_ref();
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
            }
            NodeTag::Int => {
                if matches!(scalar, NodeScalar::Number(_)) {
                    self.resolved_scalar_len = self.str_builder.len();
                    self.scalar = Some(scalar);
                }
            }
            NodeTag::Float => {
                if matches!(scalar, NodeScalar::Number(_)) {
                    self.resolved_scalar_len = self.str_builder.len();
                    self.scalar = Some(scalar);
                }
            }
            NodeTag::Null => {
                if matches!(scalar, NodeScalar::Null) {
                    self.resolved_scalar_len = self.str_builder.len();
                    self.scalar = Some(scalar);
                }
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
                    self.append_source(parser, Enc::ch(b'n'), n_start)?;
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
                    self.append_source(parser, Enc::ch(b'N'), n_start)?;
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
                    self.append_source(parser, Enc::ch(b'i'), i_start)?;
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
                    self.append_source(parser, Enc::ch(b'I'), i_start)?;
                    return Ok(());
                }
                _ => {}
            },
            FirstChar::Negative | FirstChar::Positive => {
                if Enc::wide(parser.next()) == 0x2E
                    && (Enc::wide(parser.peek(1)) == 0x69 || Enc::wide(parser.peek(1)) == 0x49)
                {
                    self.append_source(parser, Enc::ch(b'.'), parser.pos)?;
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
                            self.append_source(parser, Enc::ch(b'i'), i_start)?;
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
                            self.append_source(parser, Enc::ch(b'I'), i_start)?;
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

        // For Negative/Positive the sign was consumed by the caller; the first
        // body char (digit or `.`) is at `pos`. For Other/Dot the caller left
        // `pos` at the first body char too. Either way, advance past it so the
        // loop starts at the second body char with the `decimal`/digit flags
        // already reflecting the first.
        if !matches!(first_char, FirstChar::Negative | FirstChar::Positive) || decimal {
            parser.inc(1);
        }

        let mut first = true;

        // labeled-switch loop
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
                    break 'end (parser.pos, false);
                }
            }
        };
        let _ = plus;

        self.append_unknown_source_slice(parser, start, end)?;

        if !valid {
            return Ok(());
        }

        let lexed = parser.slice(start, end);
        let mut scalar: NodeScalar<Enc> = 'scalar: {
            if x || o || hex {
                let unsigned = match parse_unsigned_radix0::<Enc>(lexed) {
                    Ok(v) => v,
                    Err(_) => return Ok(()),
                };
                break 'scalar NodeScalar::Number(unsigned as f64);
            }
            // [10.2.1.4] Core schema float/int regex. The lexer loop above is
            // permissive (accepts `+`/`-`/`e`/`.` at any position) and
            // `wtf::parse_double` prefix-parses, so `1+1` would resolve as 1.
            // Validate the consumed slice matches the schema before parsing.
            if !is_core_schema_number::<Enc>(lexed, first_char) {
                return Ok(());
            }
            let float = match parse_double_generic::<Enc>(lexed) {
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

/// [10.2.1.4] Core schema int/float pattern. The slice may already have had a
/// leading `.` or `+`/`-` consumed by the caller before `start` was captured;
/// `first_char` carries that.
///   `[-+]? ( \. [0-9]+ | [0-9]+ ( \. [0-9]* )? ) ( [eE] [-+]? [0-9]+ )?`
fn is_core_schema_number<Enc: Encoding>(s: &[Enc::Unit], first_char: FirstChar) -> bool {
    let mut i = 0usize;
    let len = s.len();
    let at = |j: usize| Enc::wide(s[j]);
    let is_digit = |c: u32| (0x30..=0x39).contains(&c);

    // Mantissa: \. [0-9]+  |  [0-9]+ ( \. [0-9]* )?
    let saw_leading_dot = first_char == FirstChar::Dot
        || (i < len && at(i) == 0x2E && {
            i += 1;
            true
        });
    if saw_leading_dot {
        if i >= len || !is_digit(at(i)) {
            return false;
        }
        while i < len && is_digit(at(i)) {
            i += 1;
        }
    } else {
        if i >= len || !is_digit(at(i)) {
            return false;
        }
        while i < len && is_digit(at(i)) {
            i += 1;
        }
        if i < len && at(i) == 0x2E {
            i += 1;
            while i < len && is_digit(at(i)) {
                i += 1;
            }
        }
    }
    // Optional exponent: [eE] [-+]? [0-9]+
    if i < len && matches!(at(i), 0x65 | 0x45) {
        i += 1;
        if i < len && matches!(at(i), 0x2B | 0x2D) {
            i += 1;
        }
        if i >= len || !is_digit(at(i)) {
            return false;
        }
        while i < len && is_digit(at(i)) {
            i += 1;
        }
    }
    i == len
}

/// Port of `bun.jsc.wtf.parseDouble(slice)` over an encoding-generic slice.
/// `bun_core::wtf::parse_double` takes `&[u8]`; for `Utf8`/`Latin1` we narrow
/// via `Enc::key_bytes` (identity). For `Utf16` the lexer guarantees the
/// slice is ASCII-only, so it is narrowed via
/// [`bun_core::strings::narrow_ascii_u16`].
fn parse_double_generic<Enc: Encoding>(s: &[Enc::Unit]) -> Result<f64, ()> {
    match Enc::KIND {
        EncodingKind::Utf8 | EncodingKind::Latin1 => {
            bun_core::wtf::parse_double(Enc::key_bytes(s)).map_err(|_| ())
        }
        EncodingKind::Utf16 => {
            let mut buf = vec![0u8; s.len()];
            bun_core::strings::narrow_ascii_u16(Enc::as_u16_slice(s), &mut buf)
                .expect("lexer guarantees ASCII");
            bun_core::wtf::parse_double(&buf).map_err(|_| ())
        }
    }
}

/// Parses a `u64` from an encoding-generic slice with radix
/// auto-detection: `0x`/`0X` (hex), `0o`/`0O` (oct), `0b`/`0B`
/// (bin), else decimal; `_` is a digit separator. Utf8/Latin1 narrow via
/// `Enc::key_bytes`; Utf16 narrows via [`bun_core::strings::narrow_ascii_u16`].
fn parse_unsigned_radix0<Enc: Encoding>(s: &[Enc::Unit]) -> Result<u64, ()> {
    match Enc::KIND {
        EncodingKind::Utf8 | EncodingKind::Latin1 => {
            bun_core::fmt::parse_unsigned::<u64>(Enc::key_bytes(s), 0).map_err(|_| ())
        }
        EncodingKind::Utf16 => {
            let mut buf = vec![0u8; s.len()];
            bun_core::strings::narrow_ascii_u16(Enc::as_u16_slice(s), &mut buf)
                .expect("lexer guarantees ASCII");
            bun_core::fmt::parse_unsigned::<u64>(&buf, 0).map_err(|_| ())
        }
    }
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
    pub fn resolve_null(self, loc: bun_ast::Loc) -> Expr {
        match self {
            NodeTag::None
            | NodeTag::Bool
            | NodeTag::Int
            | NodeTag::Float
            | NodeTag::Null
            | NodeTag::Verbatim(_)
            | NodeTag::Unknown(_) => Expr::init(E::Null {}, loc),

            // non-specific tags become seq, map, or str
            NodeTag::NonSpecific | NodeTag::Str => Expr::init(E::String::default(), loc),
        }
    }
}

#[derive(Clone)]
pub enum NodeScalar<Enc: Encoding> {
    Null,
    Boolean(bool),
    Number(f64),
    String(YamlString<Enc>),
}

impl<Enc: Encoding> NodeScalar<Enc> {
    pub fn to_expr(&self, pos: Pos, input: &[Enc::Unit], bump: &bun_alloc::Arena) -> Expr {
        match self {
            NodeScalar::Null => Expr::init(E::Null {}, pos.loc()),
            NodeScalar::Boolean(value) => Expr::init(E::Boolean { value: *value }, pos.loc()),
            NodeScalar::Number(value) => Expr::init(E::Number::new(*value), pos.loc()),
            NodeScalar::String(value) => {
                // For `Utf16` we route through `E::String::init_utf16`.
                //
                // LIFETIME: `YamlString::List` is a global-alloc `Vec` that is
                // dropped with the local `scalar` immediately after this
                // returns — the resulting `EString.data` would dangle. Dupe
                // the list bytes into the bump arena; `.range` already borrows
                // `input` (source text) which outlives the Expr → JS
                // conversion.
                let s: &[Enc::Unit] = match value {
                    YamlString::Range(range) => range.slice(input),
                    YamlString::List(list) => bump.alloc_slice_copy(list.as_slice()),
                };
                let estring = match Enc::KIND {
                    EncodingKind::Utf16 => {
                        // SAFETY: `Enc::Unit == u16` when `KIND == Utf16`;
                        // reinterpret with the same element count for
                        // `E::String::init_utf16` (which sets `is_utf16`).
                        let s16 = unsafe {
                            core::slice::from_raw_parts(s.as_ptr().cast::<u16>(), s.len())
                        };
                        E::String::init_utf16(s16)
                    }
                    _ => E::String::init(Enc::key_bytes(s)),
                };
                Expr::init(estring, pos.loc())
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

/// Should only be used with expressions created with the YAML parser. It assumes
/// only null, boolean, number, string, array, object are possible. It also only
/// does pointer comparison with arrays and objects (so exponential merges are avoided).
/// Operates on already-built `Expr`s, so it is independent of the input encoding.
fn yaml_merge_key_expr_eql(l: &Expr, r: &Expr) -> bool {
    if core::mem::discriminant(&l.data) != core::mem::discriminant(&r.data) {
        return false;
    }
    match (&l.data, &r.data) {
        (ast::ExprData::ENull(_), _) => true,
        (ast::ExprData::EBoolean(lb), ast::ExprData::EBoolean(rb)) => lb.value == rb.value,
        (ast::ExprData::ENumber(ln), ast::ExprData::ENumber(rn)) => ln.value() == rn.value(),
        (ast::ExprData::EString(ls), ast::ExprData::EString(rs)) => {
            // UTF-8/UTF-16-aware string equality.
            if ls.is_utf16 != rs.is_utf16 {
                if ls.is_utf16 {
                    rs.eql_bytes(ls.data.slice())
                } else {
                    ls.eql_bytes(rs.data.slice())
                }
            } else if ls.is_utf16 {
                ls.slice16() == rs.slice16()
            } else {
                ls.data == rs.data
            }
        }
        // pointer comparison
        (ast::ExprData::EArray(la), ast::ExprData::EArray(ra)) => la.as_ptr() == ra.as_ptr(),
        (ast::ExprData::EObject(lo), ast::ExprData::EObject(ro)) => lo.as_ptr() == ro.as_ptr(),
        _ => false,
    }
}

/// Encoding-independent companion to [`yaml_merge_key_expr_eql`].
fn yaml_merge_key_expr_hash(key: &Expr) -> u64 {
    match &key.data {
        ast::ExprData::ENull(_) => 0,
        ast::ExprData::EBoolean(b) => 1 + b.value as u64,
        ast::ExprData::ENumber(n) => {
            let value = if n.value() == 0.0 { 0.0 } else { n.value() };
            value.to_bits()
        }
        ast::ExprData::EString(s) => s.hash(),
        ast::ExprData::EArray(a) => a.as_ptr() as usize as u64,
        ast::ExprData::EObject(o) => o.as_ptr() as usize as u64,
        _ => u64::MAX,
    }
}

pub struct Stream<'i, Enc: Encoding> {
    pub docs: Vec<Document>,
    /// Borrows the parser input.
    pub input: &'i [Enc::Unit],
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

// `Clone` deep-copies the `Vec` inside `YamlString::List`, which is fine for
// the read-only uses here.
#[derive(Clone)]
pub struct Token<Enc: Encoding> {
    pub start: Pos,
    pub indent: Indent,
    pub line: Line,
    pub data: TokenData<Enc>,
}

#[derive(Clone)]
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

#[derive(Clone)]
pub struct TokenScalar<Enc: Encoding> {
    pub data: NodeScalar<Enc>,
    pub multiline: bool,
    pub is_quoted: bool,
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
        Self {
            start: init.start,
            indent: init.indent,
            line: init.line,
            data: TokenData::Eof,
        }
    }
    pub fn sequence_entry(init: TokenInit) -> Self {
        Self {
            start: init.start,
            indent: init.indent,
            line: init.line,
            data: TokenData::SequenceEntry,
        }
    }
    pub fn mapping_key(init: TokenInit) -> Self {
        Self {
            start: init.start,
            indent: init.indent,
            line: init.line,
            data: TokenData::MappingKey,
        }
    }
    pub fn mapping_value(init: TokenInit) -> Self {
        Self {
            start: init.start,
            indent: init.indent,
            line: init.line,
            data: TokenData::MappingValue,
        }
    }
    pub fn collect_entry(init: TokenInit) -> Self {
        Self {
            start: init.start,
            indent: init.indent,
            line: init.line,
            data: TokenData::CollectEntry,
        }
    }
    pub fn sequence_start(init: TokenInit) -> Self {
        Self {
            start: init.start,
            indent: init.indent,
            line: init.line,
            data: TokenData::SequenceStart,
        }
    }
    pub fn sequence_end(init: TokenInit) -> Self {
        Self {
            start: init.start,
            indent: init.indent,
            line: init.line,
            data: TokenData::SequenceEnd,
        }
    }
    pub fn mapping_start(init: TokenInit) -> Self {
        Self {
            start: init.start,
            indent: init.indent,
            line: init.line,
            data: TokenData::MappingStart,
        }
    }
    pub fn mapping_end(init: TokenInit) -> Self {
        Self {
            start: init.start,
            indent: init.indent,
            line: init.line,
            data: TokenData::MappingEnd,
        }
    }
    pub fn anchor(init: AnchorInit) -> Self {
        Self {
            start: init.start,
            indent: init.indent,
            line: init.line,
            data: TokenData::Anchor(init.name),
        }
    }
    pub fn alias(init: AliasInit) -> Self {
        Self {
            start: init.start,
            indent: init.indent,
            line: init.line,
            data: TokenData::Alias(init.name),
        }
    }
    pub fn tag(init: TagInit) -> Self {
        Self {
            start: init.start,
            indent: init.indent,
            line: init.line,
            data: TokenData::Tag(init.tag),
        }
    }
    pub fn directive(init: TokenInit) -> Self {
        Self {
            start: init.start,
            indent: init.indent,
            line: init.line,
            data: TokenData::Directive,
        }
    }
    pub fn reserved(init: TokenInit) -> Self {
        Self {
            start: init.start,
            indent: init.indent,
            line: init.line,
            data: TokenData::Reserved,
        }
    }
    pub fn document_start(init: TokenInit) -> Self {
        Self {
            start: init.start,
            indent: init.indent,
            line: init.line,
            data: TokenData::DocumentStart,
        }
    }
    pub fn document_end(init: TokenInit) -> Self {
        Self {
            start: init.start,
            indent: init.indent,
            line: init.line,
            data: TokenData::DocumentEnd,
        }
    }
    pub fn scalar(init: ScalarInit<Enc>) -> Self {
        Self {
            start: init.start,
            indent: init.indent,
            line: init.line,
            data: TokenData::Scalar(init.resolved),
        }
    }
}

// ───────────────────────────────────────────────────────────────────────────
// ParseResult
// ───────────────────────────────────────────────────────────────────────────

pub enum ParseResult<'i, Enc: Encoding> {
    Result(ParseResultOk<'i, Enc>),
    Err(ParseResultError),
}

pub struct ParseResultOk<'i, Enc: Encoding> {
    pub stream: Stream<'i, Enc>,
    // allocator dropped — global mimalloc
}

pub enum ParseResultError {
    Oom,
    StackOverflow,
    UnexpectedEof { pos: Pos },
    UnexpectedToken { pos: Pos },
    UnexpectedCharacter { pos: Pos },
    TabIndentation { pos: Pos },
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
    ExcessiveAliasing { pos: Pos },
}

impl ParseResultError {
    pub fn add_to_log(
        &self,
        source: &bun_ast::Source,
        log: &mut bun_ast::Log,
    ) -> Result<(), YamlParseError> {
        match self {
            ParseResultError::Oom => return Err(YamlParseError::OutOfMemory),
            ParseResultError::StackOverflow => return Err(YamlParseError::StackOverflow),
            ParseResultError::UnexpectedEof { pos } => {
                log.add_error(Some(source), pos.loc(), b"Unexpected EOF");
            }
            ParseResultError::UnexpectedToken { pos } => {
                log.add_error(Some(source), pos.loc(), b"Unexpected token");
            }
            ParseResultError::UnexpectedCharacter { pos } => {
                log.add_error(Some(source), pos.loc(), b"Unexpected character");
            }
            ParseResultError::TabIndentation { pos } => {
                log.add_error(
                    Some(source),
                    pos.loc(),
                    b"Tab characters cannot be used as indentation",
                );
            }
            ParseResultError::InvalidDirective { pos } => {
                log.add_error(Some(source), pos.loc(), b"Invalid directive");
            }
            ParseResultError::UnresolvedTagHandle { pos } => {
                log.add_error(Some(source), pos.loc(), b"Unresolved tag handle");
            }
            ParseResultError::UnresolvedAlias { pos } => {
                log.add_error(Some(source), pos.loc(), b"Unresolved alias");
            }
            ParseResultError::MultilineImplicitKey { pos } => {
                log.add_error(Some(source), pos.loc(), b"Multiline implicit key");
            }
            ParseResultError::MultipleAnchors { pos } => {
                log.add_error(Some(source), pos.loc(), b"Multiple anchors");
            }
            ParseResultError::MultipleTags { pos } => {
                log.add_error(Some(source), pos.loc(), b"Multiple tags");
            }
            ParseResultError::UnexpectedDocumentStart { pos } => {
                log.add_error(Some(source), pos.loc(), b"Unexpected document start");
            }
            ParseResultError::UnexpectedDocumentEnd { pos } => {
                log.add_error(Some(source), pos.loc(), b"Unexpected document end");
            }
            ParseResultError::MultipleYamlDirectives { pos } => {
                log.add_error(Some(source), pos.loc(), b"Multiple YAML directives");
            }
            ParseResultError::InvalidIndentation { pos } => {
                log.add_error(Some(source), pos.loc(), b"Invalid indentation");
            }
            ParseResultError::ExcessiveAliasing { pos } => {
                log.add_error(Some(source), pos.loc(), b"Excessive aliasing");
            }
        }
        Ok(())
    }
}

impl<'i, Enc: Encoding> ParseResult<'i, Enc> {
    pub fn success(stream: Stream<'i, Enc>, _parser: &Parser<'_, Enc>) -> Self {
        ParseResult::Result(ParseResultOk { stream })
    }

    pub fn fail(err: ParseError, parser: &Parser<'_, Enc>) -> Self {
        let e = match err {
            ParseError::OutOfMemory => ParseResultError::Oom,
            ParseError::StackOverflow => ParseResultError::StackOverflow,
            ParseError::UnexpectedToken => ParseResultError::UnexpectedToken {
                pos: parser.token.start,
            },
            ParseError::UnexpectedEof => ParseResultError::UnexpectedEof {
                pos: parser.token.start,
            },
            ParseError::TabIndentation => ParseResultError::TabIndentation {
                pos: parser.token.start,
            },
            ParseError::InvalidDirective => ParseResultError::InvalidDirective {
                pos: parser.token.start,
            },
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
            ParseError::UnresolvedAlias => ParseResultError::UnresolvedAlias {
                pos: parser.token.start,
            },
            ParseError::MultilineImplicitKey => ParseResultError::MultilineImplicitKey {
                pos: parser.token.start,
            },
            ParseError::MultipleAnchors => ParseResultError::MultipleAnchors {
                pos: parser.token.start,
            },
            ParseError::MultipleTags => ParseResultError::MultipleTags {
                pos: parser.token.start,
            },
            ParseError::UnexpectedDocumentStart => {
                ParseResultError::UnexpectedDocumentStart { pos: parser.pos }
            }
            ParseError::UnexpectedDocumentEnd => {
                ParseResultError::UnexpectedDocumentEnd { pos: parser.pos }
            }
            ParseError::MultipleYamlDirectives => ParseResultError::MultipleYamlDirectives {
                pos: parser.token.start,
            },
            ParseError::InvalidIndentation => {
                ParseResultError::InvalidIndentation { pos: parser.pos }
            }
            ParseError::ExcessiveAliasing => ParseResultError::ExcessiveAliasing {
                pos: parser.token.start,
            },
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
    /// Position of the first byte of the current line (one past the most
    /// recently consumed `\n`/`\r`). Set in `newline()`.
    pub line_start_pos: Pos,
    pub line_indent: Indent,
    /// A tab was seen between the line's s-indent (or post-indicator
    /// additional_parent_indent position) and the current token's content.
    /// [62]/[63] s-indent is spaces only; tab here is s-separate-in-line, valid
    /// before [197] flow-in-block content but not before a [185] compact
    /// construct or a sibling block entry. Reset on newline().
    pub tab_after_indent: bool,
    pub line: Line,
    pub token: Token<Enc>,

    /// Growable buffers use the global
    /// allocator (and `Drop`); the arena is threaded for the few places that
    /// must hand a borrowed slice into the long-lived `Expr` tree (see
    /// `NodeScalar::to_expr`).
    pub bump: &'i bun_alloc::Arena,

    pub context: ContextStack,
    pub block_indents: IndentStack,

    pub explicit_document_start_line: Option<Line>,

    pub anchors: StringHashMap<Expr>,
    pub tag_handles: StringHashMap<()>,

    /// Backing storage lent to `StringBuilder`; empty while a builder is live.
    pub whitespace_buf: Vec<Whitespace<Enc>>,

    pub stack_check: StackCheck,

    pub merge_props_budget: usize,
    pub alias_expansion_budget: usize,

    /// When false (the default), self-referential anchors are not
    /// pre-registered and `*a` inside `&a {...}` keeps failing with
    /// `UnresolvedAlias`, guaranteeing an acyclic `Expr` graph.
    pub allow_self_referential_aliases: bool,
    /// Collection nodes whose anchor is registered but whose body is still
    /// being parsed. An alias that resolves to one of these is a
    /// self-reference (`&a {self: *a}`). A merge key that resolves to one is
    /// rejected because the placeholder is still empty at merge time.
    pub open_anchors: Vec<*const ()>,
    /// Collection nodes known to be on a cycle. `charge_alias_expansion`
    /// must not descend into these. O(1) membership keeps the per-node work
    /// in `charge_alias_expansion` constant regardless of how many
    /// self-referential anchors the document declares.
    pub self_referential: HashMap<*const (), ()>,
}

impl<'i, Enc: Encoding> Parser<'i, Enc> {
    /// Total number of nodes that may be reached through alias expansion in a
    /// single document. Repeated merges of the same anchor (`<<: [*a, *a, ...]`)
    /// charge the anchor's full subtree per occurrence even though merge keys
    /// deduplicate, so this needs enough headroom for legitimate documents that
    /// reuse a large anchor many times while still rejecting exponential
    /// (billion-laughs style) expansion.
    pub const MAX_ALIAS_EXPANSION: usize = 16 * 1024 * 1024;

    pub fn init(bump: &'i bun_alloc::Arena, input: &'i [Enc::Unit]) -> Self {
        // [206] l-document-prefix ::= c-byte-order-mark? l-comment*
        let start = Pos::from(Enc::bom_len(input));
        Self {
            input,
            bump,
            pos: start,
            line_start_pos: start,
            line_indent: Indent::NONE,
            tab_after_indent: false,
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
            merge_props_budget: MappingProps::MAX_MERGED_PROPERTIES,
            alias_expansion_budget: Self::MAX_ALIAS_EXPANSION,
            allow_self_referential_aliases: false,
            open_anchors: Vec::new(),
            self_referential: HashMap::default(),
        }
    }

    // deinit → impl Drop is automatic; all fields are Vec/HashMap.

    fn unexpected_token() -> ParseError {
        ParseError::UnexpectedToken
    }

    pub fn parse(&mut self) -> Result<Stream<'i, Enc>, ParseError> {
        self.scan(ScanOptions {
            first_scan: true,
            ..Default::default()
        })?;
        self.parse_stream()
    }

    pub fn parse_stream(&mut self) -> Result<Stream<'i, Enc>, ParseError> {
        let mut docs: Vec<Document> = Vec::new();

        // we want one null document if eof, not zero documents.
        let mut first = true;
        while first || !matches!(self.token.data, TokenData::Eof) {
            first = false;
            let doc = self.parse_document()?;
            docs.push(doc);
        }

        Ok(Stream {
            docs,
            input: self.input,
        })
    }

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
        self.tab_after_indent = false;
        // Every caller is `newline(); inc(1);` with `pos` at the b-break byte.
        self.line_start_pos = self.pos.add(1);
        self.line.inc(1);
    }

    #[inline]
    fn token_init(&self, start: Pos) -> TokenInit {
        TokenInit {
            start,
            indent: self.line_indent,
            line: self.line,
        }
    }

    fn slice(&self, off: Pos, end: Pos) -> &[Enc::Unit] {
        &self.input[off.cast()..end.cast()]
    }

    fn remain(&self) -> &[Enc::Unit] {
        &self.input[self.pos.cast()..]
    }

    fn remain_starts_with(&self, cs: impl AsRef<[Enc::Unit]>) -> bool {
        self.remain().starts_with(cs.as_ref())
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
            let handle = range.end(self.pos);
            self.try_skip_char(Enc::ch(b'!'))?;
            self.try_skip_s_white()?;

            self.tag_handles
                .put(Enc::key_bytes(handle.slice(self.input)), ())?;

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
        let reserved = range.end(self.pos);

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
            return Ok(DirectiveTagPrefix::Local(range.end(self.pos)));
        }

        // global tag prefix
        if let Some(char_len) = self.is_ns_tag_char() {
            let range = self.string_range();
            self.inc(char_len as usize);
            self.skip_ns_uri_chars();
            return Ok(DirectiveTagPrefix::Global(range.end(self.pos)));
        }

        Err(ParseError::InvalidDirective)
    }

    pub fn parse_document(&mut self) -> Result<Document, ParseError> {
        let mut directives: Vec<Directive> = Vec::new();

        self.anchors.clear();
        self.tag_handles.clear();
        self.open_anchors.clear();
        self.self_referential.clear();

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
                let mut document_end_line = self.token.line;
                self.scan(ScanOptions::default())?;

                // consume all bare documents
                while matches!(self.token.data, TokenData::DocumentEnd) {
                    document_end_line = self.token.line;
                    self.scan(ScanOptions::default())?;
                }

                if self.token.line == document_end_line
                    && !matches!(self.token.data, TokenData::Eof)
                {
                    return Err(Self::unexpected_token());
                }
            }
            _ => {
                return Err(Self::unexpected_token());
            }
        }

        Ok(Document { root, directives })
    }

    /// [149] c-ns-flow-map-json-key-entry — when a JSON-style key (quoted
    /// scalar, flow sequence, flow mapping) appears in flow context, the scan
    /// for a following `:` is in `flow-key` (per [150] c-s-implicit-json-key),
    /// so an adjacent `:` with no separation is recognized. Returns true iff
    /// FlowKey was pushed; the caller must then `unset_json_key()` once after
    /// the relevant scan, regardless of its result.
    fn maybe_set_json_key(&mut self, allowed: bool) -> Result<bool, ParseError> {
        if allowed && self.context.get() == Context::FlowIn {
            self.context.set(Context::FlowKey)?;
            return Ok(true);
        }
        Ok(false)
    }

    fn unset_json_key(&mut self, was_set: bool) {
        if was_set {
            self.context.unset(Context::FlowKey);
        }
    }

    /// [142]/[143] Consume the `?` and parse the flow explicit-entry key.
    /// Returns e-node `null` when nothing precedes `,` / `}` / `]` / `:`.
    /// The caller (parse_flow_mapping / parse_flow_sequence) then handles the
    /// optional `:` and value with its normal entry path.
    fn parse_flow_explicit_key(&mut self) -> Result<Expr, ParseError> {
        debug_assert!(matches!(self.token.data, TokenData::MappingKey));
        let start = self.token.start;

        // The post-`?` scan stays in the enclosing flow-in context so a
        // `:`-prefixed plain scalar (`[? :b]`) tokenizes as ns-plain-first
        // per [126], not as `c-ns-flow-map-separate-value`.
        self.scan(ScanOptions::default())?;

        if matches!(
            self.token.data,
            TokenData::MappingValue
                | TokenData::CollectEntry
                | TokenData::MappingEnd
                | TokenData::SequenceEnd
        ) {
            return Ok(Expr::init(E::Null {}, start.loc()));
        }

        // [143] the explicit key after `?` is ns-flow-map-implicit-entry,
        // whose own key is a ns-flow-yaml-node / c-flow-json-node — neither
        // admits another `?`.
        if matches!(self.token.data, TokenData::MappingKey) {
            return Err(Self::unexpected_token());
        }

        // Consume c-ns-properties here (still in flow-in) so the post-property
        // re-scan tokenizes `:b` as ns-plain-first per [126], same as the
        // first scan above. The FlowKey wrap is only for the content parse so
        // a JSON-style key early-returns at the trailing `:`.
        let mut scanned_tag: Option<Token<Enc>> = None;
        let mut scanned_anchor: Option<Token<Enc>> = None;
        loop {
            match self.token.data {
                TokenData::Anchor(_) if scanned_anchor.is_none() => {
                    scanned_anchor = Some(self.token.clone());
                }
                TokenData::Tag(_) if scanned_tag.is_none() => {
                    scanned_tag = Some(self.token.clone());
                }
                _ => break,
            }
            let tag = match &scanned_tag {
                Some(Token {
                    data: TokenData::Tag(t),
                    ..
                }) => *t,
                _ => NodeTag::None,
            };
            self.scan(ScanOptions {
                tag,
                ..Default::default()
            })?;
            if matches!(
                self.token.data,
                TokenData::MappingValue
                    | TokenData::CollectEntry
                    | TokenData::MappingEnd
                    | TokenData::SequenceEnd
            ) {
                return self.props_to_e_node(&scanned_tag, &scanned_anchor, start.loc());
            }
        }

        self.context.set(Context::FlowKey)?;
        let k = self.parse_node(ParseNodeOptions {
            explicit_mapping_key: true,
            scanned_tag,
            scanned_anchor,
            ..Default::default()
        });
        self.context.unset(Context::FlowKey);
        k
    }

    fn parse_flow_sequence(&mut self) -> Result<Expr, ParseError> {
        let sequence_start = self.token.start;
        let _sequence_indent = self.token.indent;
        let _sequence_line = self.line;

        let mut seq: ast::ExprNodeList = bun_alloc::AstAlloc::vec();

        self.context.set(Context::FlowIn)?;

        // Capture the fallible body's result and unset `FlowIn` on EVERY exit
        // (including `?` paths). The post-`]` scan happens AFTER `FlowIn` is
        // popped, so only the loop body lives inside the closure.
        let result: Result<(), ParseError> = (|| {
            self.scan(ScanOptions::default())?;
            while !matches!(self.token.data, TokenData::SequenceEnd) {
                let item = if matches!(self.token.data, TokenData::MappingKey) {
                    // [150] ns-flow-pair ::= '?' s-separate ns-flow-map-explicit-entry
                    let pair_start = self.token.start;
                    let key = self.parse_flow_explicit_key()?;
                    let value = if matches!(self.token.data, TokenData::MappingValue) {
                        self.scan(ScanOptions::default())?;
                        if matches!(
                            self.token.data,
                            TokenData::CollectEntry | TokenData::SequenceEnd
                        ) {
                            Expr::init(E::Null {}, self.token.start.loc())
                        } else {
                            // [147] the value is ns-flow-node; threading the
                            // value's own indent as current_mapping_indent
                            // makes the Scalar arm's cmi==scalar_indent check
                            // return the bare scalar instead of consuming a
                            // trailing `: …` as a nested mapping.
                            self.parse_node(ParseNodeOptions {
                                current_mapping_indent: Some(self.token.indent),
                                ..Default::default()
                            })?
                        }
                    } else {
                        Expr::init(E::Null {}, self.token.start.loc())
                    };
                    let mut props = MappingProps::init();
                    props.append_maybe_merge(
                        key,
                        value,
                        &mut self.merge_props_budget,
                        &self.open_anchors,
                    )?;
                    Expr::init(
                        E::Object {
                            properties: props.move_list(),
                            ..Default::default()
                        },
                        pair_start.loc(),
                    )
                } else {
                    self.parse_node(ParseNodeOptions {
                        flow_pair_allowed: true,
                        ..Default::default()
                    })?
                };
                seq.push(item);

                if matches!(self.token.data, TokenData::SequenceEnd) {
                    break;
                }

                if !matches!(self.token.data, TokenData::CollectEntry) {
                    return Err(Self::unexpected_token());
                }

                self.scan(ScanOptions::default())?;
            }

            Ok(())
        })();

        self.context.unset(Context::FlowIn);
        result?;

        self.scan(ScanOptions::default())?;

        Ok(Expr::init(
            E::Array {
                items: core::mem::replace(&mut seq, bun_alloc::AstAlloc::vec()),
                ..Default::default()
            },
            sequence_start.loc(),
        ))
    }

    fn parse_flow_mapping(&mut self) -> Result<Expr, ParseError> {
        let mapping_start = self.token.start;
        let _mapping_indent = self.token.indent;
        let _mapping_line = self.token.line;

        let mut props = MappingProps::init();

        self.context.set(Context::FlowIn)?;

        // Capture the fallible body's result and unset `FlowIn` on EVERY exit
        // (including `?` paths). The post-`}` scan happens AFTER `FlowIn` is
        // popped, so only the loop body lives inside the closure.
        let result: Result<(), ParseError> = (|| {
            {
                // Unset `FlowKey` before propagating.
                self.context.set(Context::FlowKey)?;
                let r = self.scan(ScanOptions::default());
                self.context.unset(Context::FlowKey);
                r?;
            }

            while !matches!(self.token.data, TokenData::MappingEnd) {
                // [142] `? …` and bare `:` are handled here so the key parse
                // never reaches parse_node's MappingKey arm (which routes
                // through block-mapping logic).
                let key = if matches!(self.token.data, TokenData::MappingKey) {
                    self.parse_flow_explicit_key()?
                } else if matches!(self.token.data, TokenData::MappingValue) {
                    // [147] e-node key followed by `:`
                    Expr::init(E::Null {}, self.token.start.loc())
                } else {
                    self.context.set(Context::FlowKey)?;
                    let k = self.parse_node(ParseNodeOptions::default());
                    self.context.unset(Context::FlowKey);
                    k?
                };

                match self.token.data {
                    TokenData::CollectEntry => {
                        let value = Expr::init(E::Null {}, self.token.start.loc());
                        props.append(G::Property {
                            key: Some(key),
                            value: Some(value),
                            ..Default::default()
                        })?;

                        self.context.set(Context::FlowKey)?;
                        let r = self.scan(ScanOptions::default());
                        self.context.unset(Context::FlowKey);
                        r?;
                        continue;
                    }
                    TokenData::MappingEnd => {
                        let value = Expr::init(E::Null {}, self.token.start.loc());
                        props.append(G::Property {
                            key: Some(key),
                            value: Some(value),
                            ..Default::default()
                        })?;
                        continue;
                    }
                    TokenData::MappingValue => {}
                    _ => {
                        return Err(Self::unexpected_token());
                    }
                }

                self.scan(ScanOptions::default())?;

                if matches!(
                    self.token.data,
                    TokenData::MappingEnd | TokenData::CollectEntry
                ) {
                    let value = Expr::init(E::Null {}, self.token.start.loc());
                    props.append(G::Property {
                        key: Some(key),
                        value: Some(value),
                        ..Default::default()
                    })?;
                } else {
                    // [147] the value is ns-flow-node; threading the value's
                    // own indent as current_mapping_indent makes the Scalar
                    // arm's cmi==scalar_indent check return the bare scalar
                    // instead of consuming a trailing `: …` as a nested
                    // mapping (`{a: b: c}`).
                    let value = self.parse_node(ParseNodeOptions {
                        current_mapping_indent: Some(self.token.indent),
                        ..Default::default()
                    })?;
                    props.append_maybe_merge(
                        key,
                        value,
                        &mut self.merge_props_budget,
                        &self.open_anchors,
                    )?;
                }

                // [140] ns-s-flow-map-entries: after an entry, only `,` or `}`.
                match self.token.data {
                    TokenData::CollectEntry => {
                        self.context.set(Context::FlowKey)?;
                        let r = self.scan(ScanOptions::default());
                        self.context.unset(Context::FlowKey);
                        r?;
                    }
                    TokenData::MappingEnd => {}
                    _ => return Err(Self::unexpected_token()),
                }
            }

            Ok(())
        })();

        self.context.unset(Context::FlowIn);
        result?;

        self.scan(ScanOptions::default())?;

        Ok(Expr::init(
            E::Object {
                properties: props.move_list(),
                ..Default::default()
            },
            mapping_start.loc(),
        ))
    }

    fn parse_block_sequence(&mut self) -> Result<Expr, ParseError> {
        let sequence_start = self.token.start;
        let sequence_indent = self.token.indent;

        // [200] s-l+block-collection requires s-l-comments (a line break)
        // before l+block-sequence; same-line content after `---` can only be
        // a flow node via s-separate-in-line.
        if let Some(explicit_document_start_line) = self.explicit_document_start_line {
            if self.token.line == explicit_document_start_line {
                return Err(ParseError::UnexpectedToken);
            }
        }

        self.block_indents.push(sequence_indent)?;

        // Capture the fallible body's result and pop `block_indents` on EVERY
        // exit (including `?` paths).
        let result: Result<Expr, ParseError> = (|| {
            let mut seq: ast::ExprNodeList = bun_alloc::AstAlloc::vec();

            let mut prev_line = Line::from(0);

            while matches!(self.token.data, TokenData::SequenceEntry)
                && self.token.indent == sequence_indent
            {
                // [184] each `-` sits at s-indent(n) (spaces only).
                if self.tab_after_indent {
                    return Err(ParseError::TabIndentation);
                }
                let entry_line = self.token.line;
                let entry_start = self.token.start;

                if !seq.is_empty() && prev_line == entry_line {
                    // only the first entry can be another sequence entry on the
                    // same line
                    break;
                }

                prev_line = entry_line;

                self.scan(ScanOptions {
                    additional_parent_indent: Some(sequence_indent.add(1)),
                    ..Default::default()
                })?;

                let item = self.parse_block_indented(
                    sequence_indent,
                    entry_line,
                    entry_start.add(2),
                    BlockIndentedKind::SeqEntry,
                )?;

                seq.push(item);
            }

            Ok(Expr::init(
                E::Array {
                    items: core::mem::replace(&mut seq, bun_alloc::AstAlloc::vec()),
                    ..Default::default()
                },
                sequence_start.loc(),
            ))
        })();

        self.block_indents.pop();
        result
    }

    fn parse_block_mapping(
        &mut self,
        first_key: Expr,
        mapping_start: Pos,
        mapping_indent: Indent,
        mapping_line: Line,
        flow_pair_allowed: bool,
    ) -> Result<Expr, ParseError> {
        if let Some(explicit_document_start_line) = self.explicit_document_start_line {
            if mapping_line == explicit_document_start_line {
                // TODO: more specific error
                return Err(ParseError::UnexpectedToken);
            }
        }

        // The block_indents stack drives scan()'s flow-context indent guard
        // (continuation lines in a flow collection must be at indent > the
        // enclosing block's). When reached via the implicit-pair path from a
        // flow collection (`["a": b]`), the key's column is not a block
        // boundary — pushing it would reject `["a":\nb]` per [149]/[80].
        let pushed_block_indent = !matches!(self.context.get(), Context::FlowIn | Context::FlowKey);
        if pushed_block_indent {
            self.block_indents.push(mapping_indent)?;
        }

        // Capture the fallible body's result and pop `block_indents` on EVERY
        // exit (including `?` paths).
        let result: Result<Expr, ParseError> = (|| {
            let mut props = MappingProps::init();
            let mut first_entry_end_line = mapping_line;

            {
                // get the first value
                let mapping_value_start = self.token.start;
                let mapping_value_line = self.token.line;

                let value: Expr = match self.token.data {
                    // it's a !!set entry
                    TokenData::MappingKey => {
                        if self.token.line == mapping_line {
                            return Err(Self::unexpected_token());
                        }
                        Expr::init(E::Null {}, mapping_value_start.loc())
                    }
                    TokenData::MappingValue => 'value: {
                        first_entry_end_line = mapping_value_line;
                        // [191] l-block-map-explicit-value(n) ::= s-indent(n) ':' …
                        // The `:` must be at exactly the `?` indent (block ctx).
                        if mapping_value_line != mapping_line
                            && !matches!(self.context.get(), Context::FlowIn | Context::FlowKey)
                            && (self.token.indent != mapping_indent || self.tab_after_indent)
                        {
                            if self.token.indent.is_less_than(mapping_indent) {
                                // [189] e-node — `:` belongs to an outer
                                // construct; this entry has no value.
                                break 'value Expr::init(E::Null {}, mapping_value_start.loc());
                            }
                            return Err(if self.tab_after_indent {
                                ParseError::TabIndentation
                            } else {
                                Self::unexpected_token()
                            });
                        }
                        // [191] explicit `:` is on a new line at mapping_indent;
                        // a same-line `- ` after it is a compact sequence whose
                        // indent is column-based, not line-based.
                        let parent_indent = if mapping_value_line != mapping_line {
                            Some(mapping_indent.add(1))
                        } else {
                            None
                        };
                        self.scan(ScanOptions {
                            additional_parent_indent: parent_indent,
                            ..Default::default()
                        })?;

                        break 'value self.parse_block_indented(
                            mapping_indent,
                            mapping_value_line,
                            mapping_value_start,
                            BlockIndentedKind::MapValue { flow_pair_allowed },
                        )?;
                    }
                    // [189] explicit-value is optional; the current token is the
                    // next entry (or end of mapping). Implicit first entries
                    // always arrive here with `:` so this arm is explicit-only.
                    _ => Expr::init(E::Null {}, mapping_value_start.loc()),
                };

                props.append_maybe_merge(
                    first_key,
                    value,
                    &mut self.merge_props_budget,
                    &self.open_anchors,
                )?;
            }

            if self.context.get() == Context::FlowIn {
                return Ok(Expr::init(
                    E::Object {
                        properties: props.move_list(),
                        ..Default::default()
                    },
                    mapping_start.loc(),
                ));
            }

            self.context.set(Context::BlockIn)?;

            // Same capture-then-unset pattern, nested.
            let inner: Result<Expr, ParseError> = (|| {
                let mut previous_line = first_entry_end_line;

                while !matches!(
                    self.token.data,
                    TokenData::Eof | TokenData::DocumentStart | TokenData::DocumentEnd
                ) && self.token.indent == mapping_indent
                    && self.token.line != previous_line
                {
                    // [192]/[195] each entry sits at s-indent(n) (spaces only).
                    if self.tab_after_indent {
                        return Err(ParseError::TabIndentation);
                    }
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
                                let value = Expr::init(E::Null {}, self.pos.loc());
                                props.append(G::Property {
                                    key: Some(key),
                                    value: Some(value),
                                    ..Default::default()
                                })?;
                                continue;
                            }
                            return Err(Self::unexpected_token());
                        }
                        TokenData::MappingValue if explicit_key => {
                            // [191] l-block-map-explicit-value ::= s-indent(n) ':' …
                            if self.token.indent != mapping_indent || self.tab_after_indent {
                                if self.token.indent.is_less_than(mapping_indent) {
                                    // [189] e-node — `:` belongs to an outer
                                    // construct; this entry has no value.
                                    let value = Expr::init(E::Null {}, self.pos.loc());
                                    props.append(G::Property {
                                        key: Some(key),
                                        value: Some(value),
                                        ..Default::default()
                                    })?;
                                    continue;
                                }
                                return Err(if self.tab_after_indent {
                                    ParseError::TabIndentation
                                } else {
                                    Self::unexpected_token()
                                });
                            }
                        }
                        TokenData::MappingValue => {
                            if key_line != self.token.line {
                                return Err(ParseError::MultilineImplicitKey);
                            }
                        }
                        TokenData::MappingKey => {}
                        _ => {
                            if explicit_key {
                                // [189] explicit-value is optional; the current
                                // token is the next entry's key.
                                let value = Expr::init(E::Null {}, self.pos.loc());
                                props.append(G::Property {
                                    key: Some(key),
                                    value: Some(value),
                                    ..Default::default()
                                })?;
                                continue;
                            }
                            return Err(Self::unexpected_token());
                        }
                    }

                    let mapping_value_line = self.token.line;
                    let mapping_value_start = self.token.start;
                    // Mirrors first_entry_end_line: when this entry has an
                    // explicit `:`, the next entry must start on a later line.
                    if matches!(self.token.data, TokenData::MappingValue) {
                        previous_line = mapping_value_line;
                    }

                    let value: Expr = match self.token.data {
                        // it's a !!set entry
                        TokenData::MappingKey => {
                            if self.token.line == key_line {
                                return Err(Self::unexpected_token());
                            }
                            Expr::init(E::Null {}, mapping_value_start.loc())
                        }
                        _ => {
                            let parent_indent = if mapping_value_line != key_line {
                                Some(mapping_indent.add(1))
                            } else {
                                None
                            };
                            self.scan(ScanOptions {
                                additional_parent_indent: parent_indent,
                                ..Default::default()
                            })?;

                            self.parse_block_indented(
                                mapping_indent,
                                mapping_value_line,
                                mapping_value_start,
                                BlockIndentedKind::MapValue {
                                    flow_pair_allowed: false,
                                },
                            )?
                        }
                    };

                    props.append_maybe_merge(
                        key,
                        value,
                        &mut self.merge_props_budget,
                        &self.open_anchors,
                    )?;
                }

                Ok(Expr::init(
                    E::Object {
                        properties: props.move_list(),
                        ..Default::default()
                    },
                    mapping_start.loc(),
                ))
            })();

            self.context.unset(Context::BlockIn);
            inner
        })();

        if pushed_block_indent {
            self.block_indents.pop();
        }
        result
    }
}

// ───────────────────────────────────────────────────────────────────────────
// MappingProps
// ───────────────────────────────────────────────────────────────────────────

pub struct MappingProps {
    list: G::PropertyList,
    merge_index: bun_collections::HashMap<u64, Vec<u32>>,
    merge_indexed: usize,
}

impl MappingProps {
    pub const MAX_MERGED_PROPERTIES: usize = 1024 * 1024;

    pub fn init() -> Self {
        Self {
            list: bun_alloc::AstAlloc::vec(),
            merge_index: bun_collections::HashMap::default(),
            merge_indexed: 0,
        }
    }

    pub fn append(&mut self, mut prop: G::Property) -> Result<(), AllocError> {
        if let Some(key) = &prop.key {
            prop.flags |= E::own_key_property_flags(key);
        }
        self.list.push(prop);
        Ok(())
    }

    pub fn merge(
        &mut self,
        merge_props: &[G::Property],
        budget: &mut usize,
    ) -> Result<(), AllocError> {
        self.list.reserve(merge_props.len().min(*budget));

        while self.merge_indexed < self.list.len() {
            let idx = self.merge_indexed;
            let key = self.list[idx].key.as_ref().unwrap();
            let hash = yaml_merge_key_expr_hash(key);
            self.merge_index
                .get_or_put(hash)?
                .value_ptr
                .push(idx as u32);
            self.merge_indexed += 1;
        }

        'next_merge_prop: for merge_prop in merge_props.iter().rev() {
            let merge_key = merge_prop.key.as_ref().unwrap();
            let merge_hash = yaml_merge_key_expr_hash(merge_key);
            if let Some(candidates) = self.merge_index.get(&merge_hash) {
                for existing_idx in candidates.iter() {
                    let existing_key = self.list[*existing_idx as usize].key.as_ref().unwrap();
                    if yaml_merge_key_expr_eql(existing_key, merge_key) {
                        continue 'next_merge_prop;
                    }
                }
            }
            *budget = budget.checked_sub(1).ok_or(AllocError)?;
            // `G::Property` is not `Clone`; reconstruct from its `Copy` fields.
            self.list.push(G::Property {
                key: merge_prop.key,
                value: merge_prop.value,
                kind: merge_prop.kind,
                flags: merge_prop.flags,
                initializer: merge_prop.initializer,
                ..Default::default()
            });
            self.merge_index
                .get_or_put(merge_hash)?
                .value_ptr
                .push((self.list.len() - 1) as u32);
            self.merge_indexed = self.list.len();
        }
        Ok(())
    }

    pub fn append_maybe_merge(
        &mut self,
        key: Expr,
        value: Expr,
        budget: &mut usize,
        open_anchors: &[*const ()],
    ) -> Result<(), ParseError> {
        let is_merge_key = match &key.data {
            ast::ExprData::EString(key_str) => key_str.eql_comptime(b"<<"),
            _ => false,
        };

        if !is_merge_key {
            return Ok(self.append(G::Property {
                key: Some(key),
                value: Some(value),
                ..Default::default()
            })?);
        }

        match &value.data {
            ast::ExprData::EObject(value_obj) => {
                if open_anchors.contains(&(value_obj.as_ptr() as *const ())) {
                    return Err(ParseError::UnresolvedAlias);
                }
                Ok(self.merge(value_obj.properties.slice(), budget)?)
            }
            ast::ExprData::EArray(value_arr) => {
                if open_anchors.contains(&(value_arr.as_ptr() as *const ())) {
                    return Err(ParseError::UnresolvedAlias);
                }
                for item in value_arr.items.slice() {
                    let item_obj = match &item.data {
                        ast::ExprData::EObject(obj) => obj,
                        _ => continue,
                    };
                    if open_anchors.contains(&(item_obj.as_ptr() as *const ())) {
                        return Err(ParseError::UnresolvedAlias);
                    }
                    self.merge(item_obj.properties.slice(), budget)?;
                }
                Ok(())
            }
            _ => Ok(self.append(G::Property {
                key: Some(key),
                value: Some(value),
                ..Default::default()
            })?),
        }
    }

    pub fn move_list(&mut self) -> G::PropertyList {
        self.merge_index.clear();
        self.merge_indexed = 0;
        core::mem::replace(&mut self.list, bun_alloc::AstAlloc::vec())
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
        Self {
            has_anchor: None,
            has_tag: None,
            has_mapping_anchor: None,
            has_mapping_tag: None,
        }
    }
}

pub struct ImplicitKeyAnchors {
    pub key_anchor: Option<StringRange>,
    pub mapping_anchor: Option<StringRange>,
}

#[derive(Clone, Copy)]
pub enum AnchorPlaceholder {
    Array,
    Object,
}

impl<Enc: Encoding> NodeProperties<Enc> {
    pub fn has_anchor_or_tag(&self) -> bool {
        self.has_anchor.is_some() || self.has_tag.is_some()
    }

    pub fn set_anchor(&mut self, anchor_token: Token<Enc>) -> Result<(), ParseError> {
        if let Some(previous_anchor) = &self.has_anchor {
            if previous_anchor.line == anchor_token.line || self.has_mapping_anchor.is_some() {
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
        self.has_mapping_anchor
            .as_ref()
            .and_then(|t| match &t.data {
                TokenData::Anchor(r) => Some(*r),
                _ => None,
            })
    }

    pub fn implicit_key_anchors(
        &self,
        implicit_key_line: Line,
    ) -> Result<ImplicitKeyAnchors, ParseError> {
        if let Some(mapping_anchor) = &self.has_mapping_anchor {
            // Two anchors recorded: the outer anchors the [200] block
            // collection; the inner anchors the implicit first key. The key's
            // c-ns-properties are in BLOCK-KEY context (s-separate-in-line),
            // so the inner anchor must share the key's line.
            let inner = self.has_anchor.as_ref();
            if inner.is_some_and(|t| t.line != implicit_key_line) {
                return Err(ParseError::MultipleAnchors);
            }
            return Ok(ImplicitKeyAnchors {
                key_anchor: inner.and_then(|t| match &t.data {
                    TokenData::Anchor(r) => Some(*r),
                    _ => None,
                }),
                mapping_anchor: match &mapping_anchor.data {
                    TokenData::Anchor(r) => Some(*r),
                    _ => None,
                },
            });
        }

        if let Some(mystery_anchor) = &self.has_anchor {
            // might be the anchor for the key, or anchor for the mapping
            let r = match &mystery_anchor.data {
                TokenData::Anchor(r) => Some(*r),
                _ => None,
            };
            if mystery_anchor.line == implicit_key_line {
                return Ok(ImplicitKeyAnchors {
                    key_anchor: r,
                    mapping_anchor: None,
                });
            }
            return Ok(ImplicitKeyAnchors {
                key_anchor: None,
                mapping_anchor: r,
            });
        }

        Ok(ImplicitKeyAnchors {
            key_anchor: None,
            mapping_anchor: None,
        })
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

    pub fn take_tag(&mut self) -> NodeTag {
        let t = self.tag();
        self.has_tag = None;
        t
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
    /// [139] ns-flow-seq-entry may be a [150] ns-flow-pair, so a JSON-style
    /// node followed by an adjacent `:` is a key. Set by parse_flow_sequence;
    /// flow-mapping values are plain ns-flow-node and must not become a pair.
    pub flow_pair_allowed: bool,
    pub scanned_tag: Option<Token<Enc>>,
    pub scanned_anchor: Option<Token<Enc>>,
}

impl<Enc: Encoding> Default for ParseNodeOptions<Enc> {
    fn default() -> Self {
        Self {
            current_mapping_indent: None,
            explicit_mapping_key: false,
            flow_pair_allowed: false,
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

// PERF: a const-generic parameter would need nightly `adt_const_params`
// (ConstParamTy). Kept as a runtime arg — branch is trivially
// predicted (3 fixed call sites). Re-evaluate.
#[derive(Clone, Copy, PartialEq, Eq)]
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
// Parser methods (continued)
// ───────────────────────────────────────────────────────────────────────────

/// Spec-level kind of the [185] s-l+block-indented call site.
#[derive(Clone, Copy, PartialEq, Eq)]
enum BlockIndentedKind {
    /// [186] `c-l-block-seq-entry`: c = BLOCK-IN.
    SeqEntry,
    /// [190] `c-l-block-map-explicit-key`: c = BLOCK-OUT.
    MapExplicitKey,
    /// [191]/[194] block-map value: c = BLOCK-OUT. Carries the [149]
    /// flow-pair gate for the first-value call reached from flow context.
    MapValue { flow_pair_allowed: bool },
}

impl<'i, Enc: Encoding> Parser<'i, Enc> {
    /// [185] `s-l+block-indented(n, c)` dispatch shared by the block-mapping
    /// value (`:`), explicit key (`?`), and block-sequence item (`-`) paths.
    /// The current token is the post-indicator token.
    ///
    /// Owns the property loop: anchor/tag tokens are consumed here so the
    /// indent rules below re-run on what follows ([161] c-ns-properties may
    /// stand alone as e-scalar when the next token belongs to the parent).
    /// A second anchor or tag falls through to `_` so parse_node's
    /// mapping-anchor split applies ([200] collection vs first-key).
    fn parse_block_indented(
        &mut self,
        n: Indent,
        indicator_line: Line,
        indicator_start: Pos,
        kind: BlockIndentedKind,
    ) -> Result<Expr, ParseError> {
        let mut value_tag: Option<Token<Enc>> = None;
        let mut value_anchor: Option<Token<Enc>> = None;

        // The [196] indent dispatch below is block-semantics; in flow context
        // ([149]/[80] s-separate(n,FLOW-IN) = s-separate-lines, any indent on
        // a continuation line) it does not apply. Reached via the
        // implicit-pair fallthrough when `parse_block_mapping` is entered
        // from a flow-seq item (`["a":\nb]`).
        let in_flow = matches!(self.context.get(), Context::FlowIn | Context::FlowKey);

        loop {
            // [196] s-l+block-node(n) reaches content via [197] flow-in-block
            // (s-separate-lines(n+1)) or [200] block-collection. Either way a
            // token on a later line at indent ≤ n belongs to the parent —
            // properties collected so far attach to e-scalar per [161].
            // [201] seq-space: a nested block sequence may sit at indent n in
            // BLOCK-OUT, but needs n+1 in BLOCK-IN.
            if !in_flow && self.token.line != indicator_line {
                let belongs_to_parent = if matches!(self.token.data, TokenData::SequenceEntry)
                    && kind != BlockIndentedKind::SeqEntry
                {
                    self.token.indent.is_less_than(n)
                } else {
                    self.token.indent.is_less_than_or_equal(n)
                };
                if belongs_to_parent {
                    // The post-property re-scan baked `value_tag` into a plain
                    // scalar's resolution (`ScanOptions.tag`); if that scalar
                    // is now abandoned to the parent, rewind to its start and
                    // re-scan tag-neutral so the sibling key resolves under
                    // the default schema. Only plain single-line scalars are
                    // tag-resolved at scan time; quoted scalars ignore
                    // ScanOptions.tag (and their token.start is past the
                    // opening quote, so rewind would be wrong); multiline
                    // plain scalars may have advanced parser state across
                    // lines that a positional rewind cannot fully restore.
                    if value_tag.is_some()
                        && matches!(
                            &self.token.data,
                            TokenData::Scalar(TokenScalar {
                                is_quoted: false,
                                multiline: false,
                                ..
                            })
                        )
                    {
                        self.pos = self.token.start;
                        self.line = self.token.line;
                        self.line_indent = self.token.indent;
                        // tab_after_indent is preserved: the original scan
                        // recorded it for this token's leading whitespace,
                        // and the re-scan (in_indent_position=false) won't
                        // re-detect it since pos is already past the tab.
                        self.scan(ScanOptions::default())?;
                    }
                    return self.props_to_e_node(&value_tag, &value_anchor, indicator_start.loc());
                }
            }

            match self.token.data {
                TokenData::Anchor(_) if value_anchor.is_none() => {
                    value_anchor = Some(self.token.clone());
                }
                TokenData::Tag(_) if value_tag.is_none() => {
                    value_tag = Some(self.token.clone());
                }
                // [185] a compact construct on the indicator's line must be at
                // indent ≥ n+1 via s-indent (spaces only); tab separation
                // either leaves the token at the line's natural indent (≤ n)
                // or, when spaces preceded the tab, taints tab_after_indent.
                TokenData::SequenceEntry | TokenData::MappingKey
                    if self.token.line == indicator_line
                        && (self.token.indent.is_less_than_or_equal(n)
                            || self.tab_after_indent) =>
                {
                    return Err(if self.tab_after_indent {
                        ParseError::TabIndentation
                    } else {
                        Self::unexpected_token()
                    });
                }
                // [149] e-node pair value in flow (`"a":,` / `"a":]`). Gated
                // on flow_pair_allowed so this only fires for [139]
                // ns-flow-seq-entry positions.
                TokenData::CollectEntry | TokenData::SequenceEnd
                    if matches!(
                        kind,
                        BlockIndentedKind::MapValue {
                            flow_pair_allowed: true
                        }
                    ) && matches!(self.context.get(), Context::FlowIn | Context::FlowKey) =>
                {
                    return self.props_to_e_node(&value_tag, &value_anchor, indicator_start.loc());
                }
                _ => {
                    return self.parse_node(ParseNodeOptions {
                        current_mapping_indent: Some(n),
                        explicit_mapping_key: kind == BlockIndentedKind::MapExplicitKey,
                        scanned_tag: value_tag,
                        scanned_anchor: value_anchor,
                        ..Default::default()
                    });
                }
            }

            // recorded a property — re-dispatch on what follows
            let tag = match &value_tag {
                Some(Token {
                    data: TokenData::Tag(t),
                    ..
                }) => *t,
                _ => NodeTag::None,
            };
            self.scan(ScanOptions {
                tag,
                ..Default::default()
            })?;
        }
    }

    /// [161] e-scalar with a property's tag resolved and anchor registered.
    /// Used by call-site property loops when the post-property token is not
    /// content for this position.
    fn props_to_e_node(
        &mut self,
        tag: &Option<Token<Enc>>,
        anchor: &Option<Token<Enc>>,
        loc: Loc,
    ) -> Result<Expr, ParseError> {
        let resolved_tag = match tag {
            Some(Token {
                data: TokenData::Tag(t),
                ..
            }) => *t,
            _ => NodeTag::None,
        };
        let e_node = resolved_tag.resolve_null(loc);
        if let Some(Token {
            data: TokenData::Anchor(name),
            ..
        }) = anchor
        {
            self.anchors
                .put(Enc::key_bytes(name.slice(self.input)), e_node)?;
        }
        Ok(e_node)
    }

    fn collection_ptr(expr: &Expr) -> Option<*const ()> {
        match &expr.data {
            ast::ExprData::EArray(arr) => Some(arr.as_ptr() as *const ()),
            ast::ExprData::EObject(obj) => Some(obj.as_ptr() as *const ()),
            _ => None,
        }
    }

    /// Register `anchor` with an empty collection node before parsing the
    /// body so a self-referential alias inside the body resolves to it.
    /// Returns the placeholder; the caller passes it to
    /// `adopt_preregistered` once the body is parsed. The placeholder is
    /// only allocated when `anchor` is `Some`.
    fn preregister_collection_anchor(
        &mut self,
        anchor: Option<StringRange>,
        kind: AnchorPlaceholder,
        loc: Loc,
    ) -> Result<Option<Expr>, ParseError> {
        if !self.allow_self_referential_aliases {
            return Ok(None);
        }
        let Some(anchor) = anchor else {
            return Ok(None);
        };
        let name = Enc::key_bytes(anchor.slice(self.input));
        if self.anchors.get(name).is_some() {
            // Redefinition: an alias inside this body should keep resolving
            // to the previous definition (matching the pre-self-reference
            // behaviour). The post-body put still overwrites for later
            // aliases.
            return Ok(None);
        }
        let placeholder = match kind {
            AnchorPlaceholder::Array => Expr::init(E::Array::default(), loc),
            AnchorPlaceholder::Object => Expr::init(E::Object::default(), loc),
        };
        self.anchors.put(name, placeholder)?;
        if let Some(ptr) = Self::collection_ptr(&placeholder) {
            self.open_anchors.push(ptr);
        }
        Ok(Some(placeholder))
    }

    /// Move the parsed collection's contents into the pre-registered
    /// placeholder so every alias that resolved to the placeholder during
    /// parsing now sees the final contents through the same arena pointer.
    fn adopt_preregistered(&mut self, placeholder: Option<Expr>, parsed: Expr) -> Expr {
        let Some(placeholder) = placeholder else {
            return parsed;
        };
        if let Some(ptr) = Self::collection_ptr(&placeholder) {
            if let Some(pos) = self.open_anchors.iter().rposition(|p| *p == ptr) {
                self.open_anchors.remove(pos);
            }
        }
        match (placeholder.data, parsed.data) {
            (ast::ExprData::EArray(mut ph), ast::ExprData::EArray(mut pr)) => {
                core::mem::swap(&mut *ph, &mut *pr);
                Expr {
                    loc: parsed.loc,
                    data: placeholder.data,
                }
            }
            (ast::ExprData::EObject(mut ph), ast::ExprData::EObject(mut pr)) => {
                core::mem::swap(&mut *ph, &mut *pr);
                Expr {
                    loc: parsed.loc,
                    data: placeholder.data,
                }
            }
            _ => parsed,
        }
    }

    fn charge_alias_expansion(&mut self, root: Expr) -> Result<(), ParseError> {
        let mut stack: Vec<Expr> = vec![root];
        while let Some(node) = stack.pop() {
            self.alias_expansion_budget = self
                .alias_expansion_budget
                .checked_sub(1)
                .ok_or(ParseError::ExcessiveAliasing)?;
            match &node.data {
                ast::ExprData::EArray(arr) => {
                    if self.self_referential.contains(&(arr.as_ptr() as *const ())) {
                        continue;
                    }
                    stack.extend_from_slice(arr.items.slice());
                }
                ast::ExprData::EObject(obj) => {
                    if self.self_referential.contains(&(obj.as_ptr() as *const ())) {
                        continue;
                    }
                    for prop in obj.properties.slice() {
                        if let Some(key) = prop.key {
                            stack.push(key);
                        }
                        if let Some(value) = prop.value {
                            stack.push(value);
                        }
                    }
                }
                _ => {}
            }
        }
        Ok(())
    }

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

        // labeled-switch loop on `self.token.data`: loop and re-match with
        // the new token after scanning.
        let node: Expr = 'node: loop {
            match &self.token.data {
                TokenData::Eof | TokenData::DocumentStart | TokenData::DocumentEnd => {
                    break 'node Expr::init(E::Null {}, self.token.start.loc());
                }

                TokenData::Anchor(_anchor) => {
                    node_props.set_anchor(self.token.clone())?;
                    self.scan(ScanOptions {
                        tag: node_props.tag(),
                        ..Default::default()
                    })?;
                    continue;
                }

                TokenData::Tag(tag) => {
                    let tag = *tag;
                    node_props.set_tag(self.token.clone())?;
                    self.scan(ScanOptions {
                        tag,
                        ..Default::default()
                    })?;
                    continue;
                }

                TokenData::Alias(alias) => {
                    let alias = *alias;
                    let alias_start = self.token.start;
                    let alias_indent = self.token.indent;
                    let alias_line = self.token.line;
                    let alias_tab_after_indent = self.tab_after_indent;

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

                    let mut copy = match self.anchors.get(Enc::key_bytes(alias.slice(self.input))) {
                        Some(e) => *e,
                        None => {
                            return Err(ParseError::UnresolvedAlias);
                        }
                    };

                    if let Some(ptr) = Self::collection_ptr(&copy) {
                        if self.open_anchors.contains(&ptr) {
                            // Self-reference: the anchored node is still being
                            // parsed. Mark it so later alias charges don't walk
                            // the cycle; the placeholder is empty here so there
                            // is nothing to charge for its body yet.
                            self.self_referential.put(ptr, ())?;
                        }
                    }
                    self.charge_alias_expansion(copy)?;

                    // update position from the anchor node to the alias node.
                    copy.loc = alias_start.loc();

                    self.scan(ScanOptions::default())?;

                    if matches!(self.token.data, TokenData::MappingValue) {
                        if self.token.indent.is_less_than(alias_indent)
                            || (opts.explicit_mapping_key
                                && alias_line != self.token.line
                                && self.token.indent.is_less_than_or_equal(alias_indent))
                        {
                            break 'node copy;
                        }
                        if self.context.get() == Context::FlowKey {
                            return Ok(copy);
                        }
                        // [154] ns-s-implicit-yaml-key uses s-separate-in-line
                        // (same line only); [145] in flow-map uses s-separate
                        // (spans lines, per yaml-test-suite 4MUZ etc.),
                        // handled by the FlowKey return above.
                        if alias_line != self.token.line && !opts.explicit_mapping_key {
                            return Err(ParseError::MultilineImplicitKey);
                        }

                        // [192] implicit key sits at s-indent(n) (spaces only).
                        if alias_tab_after_indent
                            && matches!(self.context.get(), Context::BlockOut | Context::BlockIn)
                        {
                            return Err(ParseError::TabIndentation);
                        }

                        if let Some(current_mapping_indent) = opts.current_mapping_indent {
                            if current_mapping_indent == alias_indent {
                                return Ok(copy);
                            }
                        }

                        // [147] flow-map value is ns-flow-node, not a pair.
                        if self.context.get() == Context::FlowIn && !opts.flow_pair_allowed {
                            return Ok(copy);
                        }

                        let map = self.parse_block_mapping(
                            copy,
                            alias_start,
                            alias_indent,
                            alias_line,
                            opts.flow_pair_allowed,
                        )?;
                        return Ok(map);
                    }

                    break 'node copy;
                }

                TokenData::SequenceStart => {
                    let sequence_start = self.token.start;
                    let sequence_indent = self.token.indent;
                    let sequence_line = self.token.line;
                    let sequence_tab_after_indent = self.tab_after_indent;
                    // A prior-line anchor may belong to the enclosing block
                    // mapping (implicit_key_anchors decides after the body is
                    // parsed); only a same-line anchor is guaranteed to anchor
                    // this flow sequence itself.
                    let preregistered = self.preregister_collection_anchor(
                        node_props
                            .anchor()
                            .filter(|_| node_props.anchor_line() == Some(sequence_line)),
                        AnchorPlaceholder::Array,
                        sequence_start.loc(),
                    )?;
                    let json_key = self.maybe_set_json_key(opts.flow_pair_allowed)?;
                    let seq = self.parse_flow_sequence();
                    self.unset_json_key(json_key);
                    let seq = self.adopt_preregistered(preregistered, seq?);

                    if matches!(self.token.data, TokenData::MappingValue) {
                        if self.token.indent.is_less_than(sequence_indent)
                            || (opts.explicit_mapping_key
                                && sequence_line != self.token.line
                                && self.token.indent.is_less_than_or_equal(sequence_indent))
                        {
                            break 'node seq;
                        }
                        if self.context.get() == Context::FlowKey {
                            break 'node seq;
                        }
                        if sequence_line != self.token.line && !opts.explicit_mapping_key {
                            return Err(ParseError::MultilineImplicitKey);
                        }

                        // [192] implicit key sits at s-indent(n) (spaces only).
                        if sequence_tab_after_indent
                            && matches!(self.context.get(), Context::BlockOut | Context::BlockIn)
                        {
                            return Err(ParseError::TabIndentation);
                        }

                        if let Some(current_mapping_indent) = opts.current_mapping_indent {
                            if current_mapping_indent == sequence_indent {
                                break 'node seq;
                            }
                        }

                        // [147] flow-map value is ns-flow-node, not a pair.
                        if self.context.get() == Context::FlowIn && !opts.flow_pair_allowed {
                            break 'node seq;
                        }

                        let implicit_key_anchors =
                            node_props.implicit_key_anchors(sequence_line)?;

                        if let Some(key_anchor) = implicit_key_anchors.key_anchor {
                            self.anchors
                                .put(Enc::key_bytes(key_anchor.slice(self.input)), seq)?;
                        }

                        let preregistered_map = self.preregister_collection_anchor(
                            implicit_key_anchors.mapping_anchor,
                            AnchorPlaceholder::Object,
                            sequence_start.loc(),
                        )?;
                        let map = self.parse_block_mapping(
                            seq,
                            sequence_start,
                            sequence_indent,
                            sequence_line,
                            opts.flow_pair_allowed,
                        )?;
                        let map = self.adopt_preregistered(preregistered_map, map);

                        if let Some(mapping_anchor) = implicit_key_anchors.mapping_anchor {
                            self.anchors
                                .put(Enc::key_bytes(mapping_anchor.slice(self.input)), map)?;
                        }

                        return Ok(map);
                    }

                    break 'node seq;
                }

                TokenData::CollectEntry | TokenData::SequenceEnd | TokenData::MappingEnd => {
                    if node_props.has_anchor_or_tag() {
                        break 'node Expr::init(E::Null {}, self.pos.loc());
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
                    let preregistered = self.preregister_collection_anchor(
                        node_props.anchor(),
                        AnchorPlaceholder::Array,
                        self.token.start.loc(),
                    )?;
                    let seq = self.parse_block_sequence()?;
                    break 'node self.adopt_preregistered(preregistered, seq);
                }

                TokenData::MappingStart => {
                    let mapping_start = self.token.start;
                    let mapping_indent = self.token.indent;
                    let mapping_line = self.token.line;
                    let mapping_tab_after_indent = self.tab_after_indent;

                    // Same-line only; a prior-line anchor may belong to the
                    // enclosing block mapping (see SequenceStart above).
                    let preregistered = self.preregister_collection_anchor(
                        node_props
                            .anchor()
                            .filter(|_| node_props.anchor_line() == Some(mapping_line)),
                        AnchorPlaceholder::Object,
                        mapping_start.loc(),
                    )?;
                    let json_key = self.maybe_set_json_key(opts.flow_pair_allowed)?;
                    let map = self.parse_flow_mapping();
                    self.unset_json_key(json_key);
                    let map = self.adopt_preregistered(preregistered, map?);

                    if matches!(self.token.data, TokenData::MappingValue) {
                        if self.token.indent.is_less_than(mapping_indent)
                            || (opts.explicit_mapping_key
                                && mapping_line != self.token.line
                                && self.token.indent.is_less_than_or_equal(mapping_indent))
                        {
                            break 'node map;
                        }
                        if self.context.get() == Context::FlowKey {
                            break 'node map;
                        }
                        if mapping_line != self.token.line && !opts.explicit_mapping_key {
                            return Err(ParseError::MultilineImplicitKey);
                        }

                        // [192] implicit key sits at s-indent(n) (spaces only).
                        if mapping_tab_after_indent
                            && matches!(self.context.get(), Context::BlockOut | Context::BlockIn)
                        {
                            return Err(ParseError::TabIndentation);
                        }

                        if let Some(current_mapping_indent) = opts.current_mapping_indent {
                            if current_mapping_indent == mapping_indent {
                                break 'node map;
                            }
                        }

                        // [147] flow-map value is ns-flow-node, not a pair.
                        if self.context.get() == Context::FlowIn && !opts.flow_pair_allowed {
                            break 'node map;
                        }

                        let implicit_key_anchors = node_props.implicit_key_anchors(mapping_line)?;

                        if let Some(key_anchor) = implicit_key_anchors.key_anchor {
                            self.anchors
                                .put(Enc::key_bytes(key_anchor.slice(self.input)), map)?;
                        }

                        let preregistered_parent = self.preregister_collection_anchor(
                            implicit_key_anchors.mapping_anchor,
                            AnchorPlaceholder::Object,
                            mapping_start.loc(),
                        )?;
                        let parent_map = self.parse_block_mapping(
                            map,
                            mapping_start,
                            mapping_indent,
                            mapping_line,
                            opts.flow_pair_allowed,
                        )?;
                        let parent_map = self.adopt_preregistered(preregistered_parent, parent_map);

                        if let Some(mapping_anchor) = implicit_key_anchors.mapping_anchor {
                            self.anchors.put(
                                Enc::key_bytes(mapping_anchor.slice(self.input)),
                                parent_map,
                            )?;
                        }

                        break 'node parent_map;
                    }
                    break 'node map;
                }

                TokenData::MappingKey => {
                    if matches!(self.context.get(), Context::FlowIn | Context::FlowKey) {
                        // Only reachable when a flow `?` appears in a position
                        // where ns-flow-pair is not allowed (e.g. as a flow-map
                        // value, or after another `?`). Both parse_flow_mapping
                        // and parse_flow_sequence intercept `?` themselves for
                        // the legitimate paths.
                        return Err(Self::unexpected_token());
                    }
                    // [195] each `?` sits at s-indent(n) (spaces only).
                    if self.tab_after_indent {
                        return Err(ParseError::TabIndentation);
                    }

                    let mapping_start = self.token.start;
                    let mapping_indent = self.token.indent;
                    let mapping_line = self.token.line;

                    self.block_indents.push(mapping_indent)?;

                    self.scan(ScanOptions {
                        additional_parent_indent: Some(mapping_indent.add(1)),
                        ..Default::default()
                    })?;

                    let key = self.parse_block_indented(
                        mapping_indent,
                        mapping_line,
                        mapping_start,
                        BlockIndentedKind::MapExplicitKey,
                    )?;

                    self.block_indents.pop();

                    if let Some(current_mapping_indent) = opts.current_mapping_indent {
                        if current_mapping_indent == mapping_indent {
                            return Ok(key);
                        }
                    }

                    let preregistered = self.preregister_collection_anchor(
                        node_props.anchor(),
                        AnchorPlaceholder::Object,
                        mapping_start.loc(),
                    )?;
                    let mapping = self.parse_block_mapping(
                        key,
                        mapping_start,
                        mapping_indent,
                        mapping_line,
                        opts.flow_pair_allowed,
                    )?;
                    break 'node self.adopt_preregistered(preregistered, mapping);
                }

                TokenData::MappingValue => {
                    if self.context.get() == Context::FlowKey {
                        break 'node Expr::init(E::Null {}, self.token.start.loc());
                    }
                    // [195] block `:` (e-node key) sits at s-indent(n) only.
                    if self.tab_after_indent && !matches!(self.context.get(), Context::FlowIn) {
                        return Err(ParseError::TabIndentation);
                    }
                    if let Some(current_mapping_indent) = opts.current_mapping_indent {
                        if current_mapping_indent == self.token.indent {
                            break 'node Expr::init(E::Null {}, self.token.start.loc());
                        }
                    }
                    // [200]/[193] split: a property on the `:` line is the
                    // e-node key's (`!!str : x` → key ""); on a prior line
                    // it is the [200] block-collection's. Only the key's tag
                    // affects resolution.
                    let colon_line = self.token.line;
                    let key_tag = if node_props.tag_line() == Some(colon_line) {
                        node_props.take_tag()
                    } else {
                        NodeTag::None
                    };
                    let first_key = key_tag.resolve_null(self.token.start.loc());

                    let implicit_key_anchors = node_props.implicit_key_anchors(colon_line)?;
                    if let Some(key_anchor) = implicit_key_anchors.key_anchor {
                        self.anchors
                            .put(Enc::key_bytes(key_anchor.slice(self.input)), first_key)?;
                    }

                    let preregistered = self.preregister_collection_anchor(
                        implicit_key_anchors.mapping_anchor,
                        AnchorPlaceholder::Object,
                        self.token.start.loc(),
                    )?;
                    let mapping = self.parse_block_mapping(
                        first_key,
                        self.token.start,
                        self.token.indent,
                        colon_line,
                        opts.flow_pair_allowed,
                    )?;
                    let mapping = self.adopt_preregistered(preregistered, mapping);

                    if let Some(mapping_anchor) = implicit_key_anchors.mapping_anchor {
                        self.anchors
                            .put(Enc::key_bytes(mapping_anchor.slice(self.input)), mapping)?;
                    }
                    // Anchors are fully consumed by implicit_key_anchors;
                    // clear both so the post-loop fallback doesn't re-register
                    // (or over-reject `&outer\n&inner : x` via the
                    // has_mapping_anchor guard). Tag fields stay so the
                    // has_mapping_tag guard still catches `!!a\n!!b\n: x`.
                    node_props.has_anchor = None;
                    node_props.has_mapping_anchor = None;
                    break 'node mapping;
                }

                TokenData::Scalar(_) => {
                    let scalar_start = self.token.start;
                    let scalar_indent = self.token.indent;
                    let scalar_line = self.token.line;
                    let scalar_tab_after_indent = self.tab_after_indent;

                    // reshaped for borrowck — we must hold the scalar
                    // payload across `self.scan()` which replaces self.token.
                    // Take it out before scanning.
                    let scalar = match core::mem::replace(
                        &mut self.token.data,
                        TokenData::Eof, // placeholder; overwritten by scan() below
                    ) {
                        TokenData::Scalar(s) => s,
                        _ => unreachable!("token.data was Scalar at match guard"),
                    };

                    let json_key = if scalar.is_quoted {
                        self.maybe_set_json_key(opts.flow_pair_allowed)?
                    } else {
                        false
                    };
                    let r = self.scan(ScanOptions {
                        tag: node_props.tag(),
                        outside_context: true,
                        ..Default::default()
                    });
                    self.unset_json_key(json_key);
                    r?;

                    if matches!(self.token.data, TokenData::MappingValue) {
                        // this might be the start of a new object with an implicit key
                        if self.token.indent.is_less_than(scalar_indent)
                            || (opts.explicit_mapping_key
                                && scalar_line != self.token.line
                                && self.token.indent.is_less_than_or_equal(scalar_indent))
                        {
                            // `:` belongs to an outer construct (e.g. the
                            // explicit-value indicator after `? - a` or
                            // `? sky\n: blue`). This scalar is not a key.
                            break 'node scalar.data.to_expr(scalar_start, self.input, self.bump);
                        }
                        // [192] ns-l-block-map-implicit-entry: the key is at
                        // s-indent(n) (spaces only). A tab between s-indent
                        // and the key means it cannot be a sibling block-map
                        // entry; in compact position ([185]) it cannot be the
                        // compact mapping's first key either.
                        if scalar_tab_after_indent
                            && matches!(self.context.get(), Context::BlockOut | Context::BlockIn)
                        {
                            return Err(ParseError::TabIndentation);
                        }
                        if let Some(current_mapping_indent) = opts.current_mapping_indent {
                            if current_mapping_indent == scalar_indent {
                                // 3
                                break 'node scalar.data.to_expr(
                                    scalar_start,
                                    self.input,
                                    self.bump,
                                );
                            }
                        }

                        match self.context.get() {
                            Context::FlowKey => {
                                // 1
                                break 'node scalar.data.to_expr(
                                    scalar_start,
                                    self.input,
                                    self.bump,
                                );
                            }
                            Context::FlowIn | Context::BlockOut | Context::BlockIn => {
                                if scalar_line != self.token.line && !opts.explicit_mapping_key {
                                    return Err(ParseError::MultilineImplicitKey);
                                }
                            }
                        }

                        // [147] flow-map value is ns-flow-node, not a pair.
                        // Return the bare scalar; the leftover `:` reaches the
                        // caller's [140] check. The cmi==scalar_indent path
                        // above already handles the same-line case; this
                        // covers the multiline-property case where they
                        // diverge.
                        if self.context.get() == Context::FlowIn && !opts.flow_pair_allowed {
                            break 'node scalar.data.to_expr(scalar_start, self.input, self.bump);
                        }

                        let implicit_key = scalar.data.to_expr(scalar_start, self.input, self.bump);

                        let implicit_key_anchors = node_props.implicit_key_anchors(scalar_line)?;

                        if let Some(key_anchor) = implicit_key_anchors.key_anchor {
                            self.anchors
                                .put(Enc::key_bytes(key_anchor.slice(self.input)), implicit_key)?;
                        }

                        let preregistered = self.preregister_collection_anchor(
                            implicit_key_anchors.mapping_anchor,
                            AnchorPlaceholder::Object,
                            scalar_start.loc(),
                        )?;
                        let mapping = self.parse_block_mapping(
                            implicit_key,
                            scalar_start,
                            scalar_indent,
                            scalar_line,
                            opts.flow_pair_allowed,
                        )?;
                        let mapping = self.adopt_preregistered(preregistered, mapping);

                        if let Some(mapping_anchor) = implicit_key_anchors.mapping_anchor {
                            self.anchors
                                .put(Enc::key_bytes(mapping_anchor.slice(self.input)), mapping)?;
                        }

                        return Ok(mapping);
                    }

                    break 'node scalar.data.to_expr(scalar_start, self.input, self.bump);
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
            self.anchors
                .put(Enc::key_bytes(anchor.slice(self.input)), resolved)?;
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
        // labeled-switch loop
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
                    if Enc::wide(self.next()) == 0x09 {
                        self.tab_after_indent = true;
                    }
                    self.skip_s_white();
                    __c = Enc::wide(self.next());
                    continue;
                }
                0x09 /* '\t' */ => {
                    // there's no indentation, but we still skip the whitespace
                    self.tab_after_indent = true;
                    self.inc(1);
                    self.skip_s_white();
                    __c = Enc::wide(self.next());
                    continue;
                }
                _ => return total,
            }
        }
    }

    fn string_builder(&mut self) -> StringBuilder<'i, Enc> {
        StringBuilder {
            input: self.input,
            whitespace_buf: core::mem::take(&mut self.whitespace_buf),
            str: YamlString::Range(StringRange {
                off: Pos::ZERO,
                end: Pos::ZERO,
            }),
        }
    }

    // ── scanPlainScalar ─────────────────────────────────────────────────────
    //
    // This is the largest function in the file: a labeled-switch state machine
    // with an inner `ScalarResolverCtx`.

    fn scan_plain_scalar(&mut self, opts: ScanOptions) -> Result<Token<Enc>, ParseError> {
        let mut ctx = ScalarResolverCtx::<Enc> {
            str_builder: self.string_builder(),
            resolved: false,
            scalar: None,
            tag: opts.tag,
            resolved_scalar_len: 0,
            start: self.pos,
            line: self.line,
            line_indent: self.line_indent,
            multiline: false,
        };

        // labeled-switch loop
        let mut __c = Enc::wide(self.next());
        loop {
            match __c {
                0 => {
                    return Ok(ctx.done(self));
                }

                0x2D /* '-' */ => {
                    // [203] c-directives-end is line-starting at column 0.
                    if self.is_at_line_start()
                        && self.line_indent == Indent::NONE
                        && self.remain_starts_with(Enc::literal(b"---"))
                        && self.is_any_or_eof_at(Enc::literal(b" \t\n\r"), 3)
                    {
                        return Ok(ctx.done(self));
                    }

                    if !ctx.resolved && ctx.str_builder.len() == 0 {
                        ctx.append_source(self, Enc::ch(b'-'), self.pos)?;
                        self.inc(1);
                        ctx.try_resolve_number(self, FirstChar::Negative)?;
                        __c = Enc::wide(self.next());
                        continue;
                    }

                    ctx.append_source(self, Enc::ch(b'-'), self.pos)?;
                    self.inc(1);
                    __c = Enc::wide(self.next());
                    continue;
                }

                0x2E /* '.' */ => {
                    if self.is_at_line_start()
                        && self.line_indent == Indent::NONE
                        && self.remain_starts_with(Enc::literal(b"..."))
                        && self.is_any_or_eof_at(Enc::literal(b" \t\n\r"), 3)
                    {
                        return Ok(ctx.done(self));
                    }

                    if !ctx.resolved && ctx.str_builder.len() == 0 {
                        match Enc::wide(self.peek(1)) {
                            0x6E | 0x4E | 0x69 | 0x49 /* 'n' 'N' 'i' 'I' */ => {
                                ctx.append_source(self, Enc::ch(b'.'), self.pos)?;
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

                    ctx.append_source(self, Enc::ch(b'.'), self.pos)?;
                    self.inc(1);
                    __c = Enc::wide(self.next());
                    continue;
                }

                0x3A /* ':' */ => {
                    if self.is_s_white_or_b_char_or_eof_at(1) {
                        return Ok(ctx.done(self));
                    }

                    match self.context.get() {
                        Context::BlockOut | Context::BlockIn => {}
                        // [130] `:` is ns-plain-char only when followed by
                        // ns-plain-safe(c); in flow context that excludes
                        // c-flow-indicator.
                        Context::FlowIn | Context::FlowKey => {
                            match Enc::wide(self.peek(1)) {
                                0x2C | 0x5B | 0x5D | 0x7B | 0x7D /* , [ ] { } */ => {
                                    return Ok(ctx.done(self));
                                }
                                _ => {}
                            }
                        }
                    }

                    ctx.append_source(self, Enc::ch(b':'), self.pos)?;
                    self.inc(1);
                    __c = Enc::wide(self.next());
                    continue;
                }

                0x23 /* '#' */ => {
                    if self.is_at_line_start()
                        || matches!(
                            Enc::wide(self.input[self.pos.sub(1).cast()]),
                            0x20 | 0x09 | 0x0D | 0x0A
                        )
                    {
                        return Ok(ctx.done(self));
                    }

                    ctx.append_source(self, Enc::ch(b'#'), self.pos)?;
                    self.inc(1);
                    __c = Enc::wide(self.next());
                    continue;
                }

                0x2C | 0x5B | 0x5D | 0x7B | 0x7D /* , [ ] { } */ => {
                    match self.context.get() {
                        Context::BlockIn | Context::BlockOut => {}
                        Context::FlowIn | Context::FlowKey => {
                            return Ok(ctx.done(self));
                        }
                    }

                    let c = self.next();
                    ctx.append_source(self, c, self.pos)?;
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
                                return Ok(ctx.done(self));
                            }
                        }
                    }

                    // clear the leading whitespace before the newline.
                    ctx.str_builder.clear_whitespace();

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
                        ctx.append_source(self, c, start)?;
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
                            ctx.append_source(self, c, n_start)?;
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
                            ctx.append_source(self, c, n_start)?;
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
                            ctx.append_source(self, c, t_start)?;
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
                            ctx.append_source(self, c, t_start)?;
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
                            ctx.append_source(self, c, f_start)?;
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
                            ctx.append_source(self, c, f_start)?;
                            __c = Enc::wide(self.next());
                            continue;
                        }

                        0x2D /* '-' */ => {
                            ctx.append_source(self, Enc::ch(b'-'), self.pos)?;
                            self.inc(1);
                            ctx.try_resolve_number(self, FirstChar::Negative)?;
                            __c = Enc::wide(self.next());
                            continue;
                        }

                        0x2B /* '+' */ => {
                            ctx.append_source(self, Enc::ch(b'+'), self.pos)?;
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
                                    ctx.append_source(self, Enc::ch(b'.'), self.pos)?;
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
                            ctx.append_source(self, c, start)?;
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

        // labeled-switch loop
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
                    indent_indicator = Some(IndentIndicator::from_raw(u8::try_from(__c - 0x30).expect("int cast")));
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
                    self.newline();
                    self.inc(1);
                    if Enc::wide(self.next()) == 0x09 {
                        // tab for indentation
                        return Err(ParseError::TabIndentation);
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
    // Another large labeled-switch state machine with an inner
    // `LiteralScalarCtx` struct: a two-phase loop (find content_indent,
    // then scan body) with `ctx.append`/`ctx.done` (verified against the
    // official yaml-test-suite):
    // - explicit `indent_indicator` support;
    // - EOF chomping normalized via `leading_newlines` in `done()` so Clip and
    //   Keep agree with eemeli/yaml + js-yaml (L24T/01, JEF9/02);
    // - folded more-indented lines tracked with `prev/cur_more_indented`
    //   flags, so breaks adjacent to more-indented lines are not folded
    //   (spec [73]-[74]);
    // - the per-line indent guard is the precomputed `min_indent`
    //   (>= content_indent AND > parent block indent);
    // - `---`/`...` document markers additionally require line start.

    fn scan_auto_indented_literal_scalar(
        &mut self,
        indent_indicator: IndentIndicator,
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
            max_leading_indent: Indent,
            line: Line,
            folded: bool,
            explicit_indent: bool,
            /// Folded: was the previous content line more-indented (started with
            /// space/tab beyond content_indent)? Breaks adjacent to such lines
            /// are not folded.
            prev_more_indented: bool,
            /// Folded: is the line currently being appended more-indented?
            cur_more_indented: bool,
        }

        impl<Enc: Encoding> LiteralScalarCtx<Enc> {
            fn done(mut self) -> Result<Token<Enc>, AllocError> {
                // [165] b-chomped-last(CLIP|KEEP) ::= b-as-line-feed | <end-of-input>
                // When the last content line ends at EOF without a break, treat
                // the EOF as an implicit final break so Clip and Keep agree.
                // This matches the official test suite (L24T/01) and the 1.2.2
                // reference parsers eemeli/yaml + js-yaml.
                if !self.text.is_empty() && self.leading_newlines == 0 {
                    self.leading_newlines = 1;
                }
                match self.chomp {
                    Chomp::Keep => {
                        for _ in 0..self.leading_newlines {
                            self.text.push(Enc::ch(b'\n'));
                        }
                    }
                    Chomp::Clip => {
                        if !self.text.is_empty() {
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
                        is_quoted: false,
                    },
                }))
            }

            fn append(&mut self, c: Enc::Unit) -> Result<(), ParseError> {
                if self.text.is_empty() {
                    if !self.explicit_indent
                        && self.content_indent.is_less_than(self.max_leading_indent)
                    {
                        return Err(ParseError::UnexpectedCharacter);
                    }
                    self.text.reserve(self.leading_newlines + 1);
                    for _ in 0..self.leading_newlines {
                        self.text.push(Enc::ch(b'\n'));
                    }
                    self.text.push(c);
                    self.leading_newlines = 0;
                    self.prev_more_indented = self.cur_more_indented;
                    return Ok(());
                }
                if self.leading_newlines == 0 {
                    self.text.push(c);
                    return Ok(());
                }
                // First content of a new line after one or more line breaks:
                // flush them, then remember whether *this* line is more-indented
                // for the next fold decision.
                if self.folded && !self.prev_more_indented && !self.cur_more_indented {
                    if self.leading_newlines == 1 {
                        self.text.push(Enc::ch(b' '));
                    } else {
                        self.text.reserve(self.leading_newlines);
                        for _ in 0..self.leading_newlines - 1 {
                            self.text.push(Enc::ch(b'\n'));
                        }
                    }
                } else {
                    self.text.reserve(self.leading_newlines + 1);
                    for _ in 0..self.leading_newlines {
                        self.text.push(Enc::ch(b'\n'));
                    }
                }
                self.text.push(c);
                self.leading_newlines = 0;
                self.prev_more_indented = self.cur_more_indented;
                Ok(())
            }
        }

        let explicit_indent: Option<Indent> = match indent_indicator {
            IndentIndicator::Auto => None,
            n => {
                let parent = self.block_indents.get().map(Indent::cast).unwrap_or(0);
                Some(Indent::from(parent + usize::from(n.get())))
            }
        };

        let mut ctx = LiteralScalarCtx::<Enc> {
            chomp,
            text: Vec::new(),
            folded,
            start,
            line,
            leading_newlines: 0,
            content_indent: explicit_indent.unwrap_or(Indent::NONE),
            max_leading_indent: Indent::NONE,
            explicit_indent: explicit_indent.is_some(),
            prev_more_indented: false,
            cur_more_indented: false,
        };

        // Phase 1: find content_indent and first non-ws char
        // labeled-switch loop
        let mut consumed_indent_this_line = false;
        let (content_indent, first): (Indent, u32) = 'phase1: loop {
            let __c = Enc::wide(self.next());
            match __c {
                0 => {
                    // Official yaml-test-suite JEF9/02: trailing indentation
                    // at EOF without a final break counts as one trailing
                    // empty line for chomping (matches eemeli/yaml + js-yaml).
                    if consumed_indent_this_line {
                        ctx.leading_newlines += 1;
                    }
                    if explicit_indent.is_none() {
                        ctx.content_indent = self.line_indent;
                    }
                    return Ok(ctx.done()?);
                }
                0x0D => {
                    if Enc::wide(self.peek(1)) == 0x0A {
                        self.inc(1);
                    }
                    // fallthrough to '\n' handling
                    self.newline();
                    self.inc(1);
                    if Enc::wide(self.next()) == 0x09 {
                        return Err(ParseError::TabIndentation);
                    }
                    ctx.leading_newlines += 1;
                    consumed_indent_this_line = false;
                    continue;
                }
                0x0A => {
                    self.newline();
                    self.inc(1);
                    if Enc::wide(self.next()) == 0x09 {
                        return Err(ParseError::TabIndentation);
                    }
                    ctx.leading_newlines += 1;
                    consumed_indent_this_line = false;
                    continue;
                }
                0x20 => {
                    let mut indent = Indent::from(1);
                    self.inc(1);
                    if let Some(ci) = explicit_indent {
                        while indent.is_less_than(ci) && Enc::wide(self.next()) == 0x20 {
                            indent.inc(1);
                            self.inc(1);
                        }
                        self.line_indent = indent;
                        if !indent.is_less_than(ci) {
                            consumed_indent_this_line = true;
                        }
                        if matches!(Enc::wide(self.next()), 0 | 0x0A | 0x0D) {
                            continue;
                        }
                        break 'phase1 (ci, Enc::wide(self.next()));
                    }
                    consumed_indent_this_line = true;
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
                c => {
                    if let Some(ci) = explicit_indent {
                        break 'phase1 (ci, c);
                    }
                    break 'phase1 (self.line_indent, c);
                }
            }
        };
        ctx.content_indent = content_indent;
        ctx.cur_more_indented = matches!(first, 0x20 | 0x09);
        if first == 0x09 {
            self.tab_after_indent = true;
        }

        // A line is part of the body iff its indentation is >= content_indent
        // and strictly > the parent block's indent. Collapse both into one
        // bound so the per-character body loop does a single comparison.
        let min_indent = match self.block_indents.get() {
            Some(b) => Indent::from(content_indent.cast().max(b.cast() + 1)),
            None => content_indent,
        };

        // Phase 2: scan body
        // labeled-switch loop with nested `newlines:` switch
        let mut __c = first;
        loop {
            match __c {
                0 => return Ok(ctx.done()?),
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
                                    return Err(ParseError::TabIndentation);
                                }
                                continue;
                            }
                            0x0A => {
                                ctx.leading_newlines += 1;
                                self.newline();
                                self.inc(1);
                                if Enc::wide(self.next()) == 0x09 {
                                    return Err(ParseError::TabIndentation);
                                }
                                continue;
                            }
                            0x20 => {
                                let mut indent = Indent::from(0);
                                while indent.is_less_than(ctx.content_indent)
                                    && Enc::wide(self.next()) == 0x20
                                {
                                    indent.inc(1);
                                    self.inc(1);
                                }
                                self.line_indent = indent;
                                let nc = Enc::wide(self.next());
                                ctx.cur_more_indented = matches!(nc, 0x20 | 0x09);
                                if nc == 0x09 {
                                    self.tab_after_indent = true;
                                }
                                __c = nc;
                                break;
                            }
                            other => {
                                ctx.cur_more_indented = other == 0x09;
                                if other == 0x09 {
                                    self.tab_after_indent = true;
                                }
                                __c = other;
                                break;
                            }
                        }
                    }
                    continue;
                }
                0x2D /* '-' */ => {
                    if self.is_at_line_start()
                        && self.line_indent == Indent::NONE
                        && self.remain_starts_with(Enc::literal(b"---"))
                        && self.is_any_or_eof_at(Enc::literal(b" \t\n\r"), 3)
                    {
                        return Ok(ctx.done()?);
                    }
                    if self.line_indent.is_less_than(min_indent) {
                        return Ok(ctx.done()?);
                    }
                    ctx.append(Enc::ch(b'-'))?;
                    self.inc(1);
                    __c = Enc::wide(self.next());
                    continue;
                }
                0x2E /* '.' */ => {
                    if self.is_at_line_start()
                        && self.line_indent == Indent::NONE
                        && self.remain_starts_with(Enc::literal(b"..."))
                        && self.is_any_or_eof_at(Enc::literal(b" \t\n\r"), 3)
                    {
                        return Ok(ctx.done()?);
                    }
                    if self.line_indent.is_less_than(min_indent) {
                        return Ok(ctx.done()?);
                    }
                    ctx.append(Enc::ch(b'.'))?;
                    self.inc(1);
                    __c = Enc::wide(self.next());
                    continue;
                }
                c => {
                    if self.line_indent.is_less_than(min_indent) {
                        return Ok(ctx.done()?);
                    }
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

        let result =
            self.scan_auto_indented_literal_scalar(indent_indicator, chomp, false, start, line);
        self.whitespace_buf.clear();
        result
    }

    fn scan_folded_scalar(&mut self) -> Result<Token<Enc>, ParseError> {
        let start = self.pos;
        let line = self.line;

        let (indent_indicator, chomp) = self.scan_block_header()?;

        self.scan_auto_indented_literal_scalar(indent_indicator, chomp, true, start, line)
    }

    fn scan_single_quoted_scalar(&mut self) -> Result<Token<Enc>, ParseError> {
        let start = self.pos;
        let scalar_line = self.line;
        let scalar_indent = self.line_indent;

        let mut text: Vec<Enc::Unit> = Vec::new();

        // labeled-switch loop
        loop {
            let c = Enc::wide(self.next());
            match c {
                0 => return Err(ParseError::UnexpectedCharacter),
                0x2E /* '.' */ => {
                    if self.is_at_line_start()
                        && self.remain_starts_with(Enc::literal(b"..."))
                        && self.is_s_white_or_b_char_at(3)
                    {
                        return Err(ParseError::UnexpectedDocumentEnd);
                    }
                    text.push(Enc::ch(b'.'));
                    self.inc(1);
                }
                0x2D /* '-' */ => {
                    if self.is_at_line_start()
                        && self.remain_starts_with(Enc::literal(b"---"))
                        && self.is_s_white_or_b_char_at(3)
                    {
                        return Err(ParseError::UnexpectedDocumentStart);
                    }
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
                }
                0x20 | 0x09 => {
                    let off = self.pos;
                    self.inc(1);
                    self.skip_s_white();
                    if !self.is_b_char() {
                        text.extend_from_slice(self.slice(off, self.pos));
                    }
                }
                0x27 /* '\'' */ => {
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
                            // TODO: wrong!
                            multiline: self.line != scalar_line,
                            is_quoted: true,
                            data: NodeScalar::String(YamlString::List(text)),
                        },
                    }));
                }
                _ => {
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

        // labeled-switch loop
        loop {
            let c = Enc::wide(self.next());
            match c {
                0 => return Err(ParseError::UnexpectedCharacter),
                0x2E /* '.' */ => {
                    if self.is_at_line_start()
                        && self.remain_starts_with(Enc::literal(b"..."))
                        && self.is_s_white_or_b_char_at(3)
                    {
                        return Err(ParseError::UnexpectedDocumentEnd);
                    }
                    text.push(Enc::ch(b'.'));
                    self.inc(1);
                }
                0x2D /* '-' */ => {
                    if self.is_at_line_start()
                        && self.remain_starts_with(Enc::literal(b"---"))
                        && self.is_s_white_or_b_char_at(3)
                    {
                        return Err(ParseError::UnexpectedDocumentStart);
                    }
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
                }
                0x20 | 0x09 => {
                    let off = self.pos;
                    self.inc(1);
                    self.skip_s_white();
                    if !self.is_b_char() {
                        text.extend_from_slice(self.slice(off, self.pos));
                    }
                }
                0x22 /* '"' */ => {
                    self.inc(1);
                    return Ok(Token::scalar(ScalarInit {
                        start,
                        indent: scalar_indent,
                        line: scalar_line,
                        resolved: TokenScalar {
                            // TODO: wrong!
                            multiline: self.line != scalar_line,
                            is_quoted: true,
                            data: NodeScalar::String(YamlString::List(text)),
                        },
                    }));
                }
                0x5C /* '\\' */ => {
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
                            EncodingKind::Utf8 => text.extend_from_slice(&Enc::literal(&[0xC2, 0x85])),
                            EncodingKind::Utf16 => text.push(Enc::unit_from_u16(0x0085)),
                            EncodingKind::Latin1 => return Err(ParseError::UnexpectedCharacter),
                        },
                        0x5F /* '_' */ => match Enc::KIND {
                            EncodingKind::Utf8 => text.extend_from_slice(&Enc::literal(&[0xC2, 0xA0])),
                            EncodingKind::Utf16 => text.push(Enc::unit_from_u16(0x00A0)),
                            EncodingKind::Latin1 => return Err(ParseError::UnexpectedCharacter),
                        },
                        0x4C /* 'L' */ => match Enc::KIND {
                            EncodingKind::Utf8 => text.extend_from_slice(&Enc::literal(&[0xE2, 0x80, 0xA8])),
                            EncodingKind::Utf16 => text.push(Enc::unit_from_u16(0x2028)),
                            EncodingKind::Latin1 => return Err(ParseError::UnexpectedCharacter),
                        },
                        0x50 /* 'P' */ => match Enc::KIND {
                            EncodingKind::Utf8 => text.extend_from_slice(&Enc::literal(&[0xE2, 0x80, 0xA9])),
                            EncodingKind::Utf16 => text.push(Enc::unit_from_u16(0x2029)),
                            EncodingKind::Latin1 => return Err(ParseError::UnexpectedCharacter),
                        },

                        0x78 /* 'x' */ => self.decode_hex_code_point(Escape::X, &mut text)?,
                        0x75 /* 'u' */ => self.decode_hex_code_point(Escape::LowerU, &mut text)?,
                        0x55 /* 'U' */ => self.decode_hex_code_point(Escape::UpperU, &mut text)?,

                        _ => return Err(ParseError::UnexpectedCharacter),
                    }
                    self.inc(1);
                }
                _ => {
                    text.push(self.next());
                    self.inc(1);
                }
            }
        }
    }

    fn read_hex_digits(&mut self, count: u8) -> Result<u32, ParseError> {
        let mut value: u32 = 0;
        for _ in 0..count {
            self.inc(1);
            let digit = Enc::wide(self.next());
            let num =
                bun_core::fmt::hex_digit_value_u32(digit).ok_or(ParseError::UnexpectedCharacter)?;
            value = value * 16 + num as u32;
        }
        Ok(value)
    }

    fn decode_hex_code_point(
        &mut self,
        escape: Escape,
        text: &mut Vec<Enc::Unit>,
    ) -> Result<(), ParseError> {
        let mut cp = self.read_hex_digits(escape as u8)?;

        if cp > 0x10_FFFF {
            return Err(ParseError::UnexpectedCharacter);
        }

        // JSON encodes supplementary code points as a `\uD8xx\uDCxx` surrogate
        // pair; YAML 1.2 is a JSON superset. Lone surrogates remain an error.
        if (0xD800..=0xDFFF).contains(&cp) {
            if !matches!(escape, Escape::LowerU)
                || !bun_core::strings::u16_is_lead(cp as u16)
                || Enc::wide(self.peek(1)) != 0x5C /* '\\' */
                || Enc::wide(self.peek(2)) != 0x75
            /* 'u' */
            {
                return Err(ParseError::UnexpectedCharacter);
            }
            self.inc(2);
            let low = self.read_hex_digits(Escape::LowerU as u8)?;
            if !bun_core::strings::u16_is_trail(low as u16) {
                return Err(ParseError::UnexpectedCharacter);
            }
            cp = bun_core::strings::u16_get_supplementary(cp as u16, low as u16);
        }

        match Enc::KIND {
            EncodingKind::Utf8 => {
                let ch = char::from_u32(cp).ok_or(ParseError::UnexpectedCharacter)?;
                let mut buf = [0u8; 4];
                let s = ch.encode_utf8(&mut buf);
                for b in s.bytes() {
                    text.push(Enc::ch(b));
                }
            }
            EncodingKind::Utf16 => {
                if cp < 0x10000 {
                    text.push(Enc::unit_from_u16(cp as u16));
                } else {
                    let [hi, lo] = bun_core::strings::encode_surrogate_pair(cp);
                    text.push(Enc::unit_from_u16(hi));
                    text.push(Enc::unit_from_u16(lo));
                }
            }
            EncodingKind::Latin1 => {
                if cp > 0xFF {
                    return Err(ParseError::UnexpectedCharacter);
                }
                text.push(Enc::ch(u8::try_from(cp).expect("int cast")));
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
                        break 'prefix range.end(self.pos);
                    }
                    if let Some(len) = self.is_ns_tag_char() {
                        let range = self.string_range();
                        self.inc(len as usize);
                        self.skip_ns_uri_chars();
                        break 'prefix range.end(self.pos);
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

                let shorthand = range.end(self.pos);
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
                let mut handle_or_shorthand = range.end(self.pos);

                if Enc::wide(self.next()) == 0x21 /* '!' */ {
                    self.inc(1);
                    if !self
                        .tag_handles
                        .contains_key(Enc::key_bytes(handle_or_shorthand.slice(self.input)))
                    {
                        self.pos = off;
                        return Err(ParseError::UnresolvedTagHandle);
                    }

                    range = self.string_range();
                    self.try_skip_ns_tag_chars()?;
                    let shorthand = range.end(self.pos);

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
        if eq_ascii::<Enc>(s, b"bool") {
            return NodeTag::Bool;
        }
        if eq_ascii::<Enc>(s, b"int") {
            return NodeTag::Int;
        }
        if eq_ascii::<Enc>(s, b"float") {
            return NodeTag::Float;
        }
        if eq_ascii::<Enc>(s, b"null") {
            return NodeTag::Null;
        }
        if eq_ascii::<Enc>(s, b"str") {
            return NodeTag::Str;
        }
        NodeTag::Unknown(shorthand)
    }

    // ── scan ────────────────────────────────────────────────────────────────

    fn scan(&mut self, opts: ScanOptions) -> Result<(), ParseError> {
        // ScanCtx state inlined
        let mut count_indentation = opts.first_scan || opts.additional_parent_indent.is_some();
        // Tracks whether we are still in leading whitespace (after a newline
        // or after an indicator with additional_parent_indent), so a tab at
        // this position can taint `tab_after_indent`. Unlike count_indentation
        // it stays true through the space arm.
        let mut in_indent_position = count_indentation;
        if in_indent_position {
            self.tab_after_indent = false;
        }
        let mut additional_parent_indent = opts.additional_parent_indent;

        let previous_token_line = self.token.line;

        // labeled-switch loop with `inline` whitespace dispatch.
        // We loop on `Enc::wide(self.next())` and break with the resulting token.
        let token: Token<Enc> = 'next: loop {
            let c = Enc::wide(self.next());
            match c {
                0 => {
                    let start = self.pos;
                    break 'next Token::eof(self.token_init(start));
                }
                0x2D /* '-' */ => {
                    let start = self.pos;
                    // [203] c-directives-end is line-starting at column 0.
                    // `line_indent == 0` is the line's indent, true everywhere
                    // on a column-0 line; is_at_line_start() (pos ==
                    // line_start_pos) confirms we are at the actual start.
                    if self.is_at_line_start()
                        && self.line_indent == Indent::NONE
                        && self.remain_starts_with(Enc::literal(b"---"))
                        && self.is_s_white_or_b_char_or_eof_at(3)
                    {
                        self.inc(3);
                        break 'next Token::document_start(self.token_init(start));
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
                            break 'next Token::sequence_entry(self.token_init(start));
                        }
                        0x2C | 0x5D | 0x5B | 0x7D | 0x7B => match self.context.get() {
                            Context::FlowIn | Context::FlowKey => {
                                self.inc(1);
                                self.token = Token::sequence_entry(self.token_init(start));
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
                    if self.is_at_line_start()
                        && self.line_indent == Indent::NONE
                        && self.remain_starts_with(Enc::literal(b"..."))
                        && self.is_s_white_or_b_char_or_eof_at(3)
                    {
                        self.inc(3);
                        break 'next Token::document_end(self.token_init(start));
                    }
                    break 'next self.scan_plain_scalar(opts)?;
                }
                0x3F /* '?' */ => {
                    let start = self.pos;
                    match Enc::wide(self.peek(1)) {
                        0 | 0x20 | 0x09 | 0x0A | 0x0D => {
                            self.inc(1);
                            break 'next Token::mapping_key(self.token_init(start));
                        }
                        0x2C | 0x5D | 0x5B | 0x7D | 0x7B => match self.context.get() {
                            Context::BlockIn | Context::BlockOut => {}
                            Context::FlowIn | Context::FlowKey => {
                                self.inc(1);
                                break 'next Token::mapping_key(self.token_init(start));
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
                            break 'next Token::mapping_value(self.token_init(start));
                        }
                        0x2C | 0x5D | 0x5B | 0x7D | 0x7B => match self.context.get() {
                            Context::BlockIn | Context::BlockOut => {}
                            Context::FlowIn | Context::FlowKey => {
                                self.inc(1);
                                break 'next Token::mapping_value(self.token_init(start));
                            }
                        },
                        _ => match self.context.get() {
                            Context::BlockIn | Context::BlockOut | Context::FlowIn => {}
                            Context::FlowKey => {
                                self.inc(1);
                                break 'next Token::mapping_value(self.token_init(start));
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
                            break 'next Token::collect_entry(self.token_init(start));
                        }
                        Context::BlockIn | Context::BlockOut => {}
                    }
                    break 'next self.scan_plain_scalar(opts)?;
                }
                0x5B /* '[' */ => {
                    let start = self.pos;
                    self.inc(1);
                    break 'next Token::sequence_start(self.token_init(start));
                }
                0x5D /* ']' */ => {
                    let start = self.pos;
                    self.inc(1);
                    break 'next Token::sequence_end(self.token_init(start));
                }
                0x7B /* '{' */ => {
                    let start = self.pos;
                    self.inc(1);
                    break 'next Token::mapping_start(self.token_init(start));
                }
                0x7D /* '}' */ => {
                    let start = self.pos;
                    self.inc(1);
                    break 'next Token::mapping_end(self.token_init(start));
                }
                0x23 /* '#' */ => {
                    let start = self.pos;
                    if !self.is_at_line_start()
                        && !matches!(
                            Enc::wide(self.input[start.cast() - 1]),
                            0x20 | 0x09 | 0x0A | 0x0D
                        )
                    {
                        // TODO: prove this is unreachable
                        return Err(ParseError::UnexpectedCharacter);
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
                        name: range.end(self.pos),
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
                        name: range.end(self.pos),
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
                            let indicator_indent = self.line_indent;
                            self.inc(1);
                            let mut tok = self.scan_literal_scalar()?;
                            // Token.indent for a block scalar is the
                            // indicator's s-indent, not the auto-detected
                            // content indent — keeps belongs_to_parent and
                            // other indent comparisons consistent across
                            // scalar kinds.
                            tok.indent = indicator_indent;
                            break 'next tok;
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
                            let indicator_indent = self.line_indent;
                            self.inc(1);
                            let mut tok = self.scan_folded_scalar()?;
                            tok.indent = indicator_indent;
                            break 'next tok;
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
                    break 'next Token::directive(self.token_init(start));
                }
                0x40 /* '@' */ | 0x60 /* '`' */ => {
                    let start = self.pos;
                    self.inc(1);
                    self.token = Token::reserved(self.token_init(start));
                    return Err(Self::unexpected_token());
                }
                // ScanCtx.scanWhitespace inlined.
                0x0D /* '\r' */ => {
                    if Enc::wide(self.peek(1)) == 0x0A {
                        self.inc(1);
                    }
                    // fallthrough to '\n'
                    count_indentation = true;
                    in_indent_position = true;
                    additional_parent_indent = None;
                    self.newline();
                    self.inc(1);
                    continue;
                }
                0x0A /* '\n' */ => {
                    count_indentation = true;
                    in_indent_position = true;
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
                    if count_indentation
                        && additional_parent_indent.is_none()
                        && self.context.get() == Context::BlockIn
                    {
                        return Err(ParseError::TabIndentation);
                    }
                    if in_indent_position {
                        // [63] s-indent is spaces only. A tab here is
                        // s-separate-in-line — valid before [197]
                        // flow-in-block content, but not before a [185]
                        // compact construct or a sibling block entry. The
                        // parser-side checks distinguish; here we record the
                        // taint and drop additional_parent_indent (so the
                        // resulting token's indent is what the *spaces*
                        // reached, not column-based).
                        self.tab_after_indent = true;
                        additional_parent_indent = None;
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
        let first_len = self
            .is_ns_tag_char()
            .ok_or(ParseError::UnexpectedCharacter)?;
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
            while !self.is_b_char_or_eof() {
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

    /// True iff `self.pos` is at column 0 — i.e., start of input or
    /// immediately after a b-break. Used by [203]/[204] doc-marker
    /// recognition (which is line-starting, not just `line_indent == 0`).
    fn is_at_line_start(&self) -> bool {
        self.pos == self.line_start_pos
    }

    fn is_s_white_or_b_char_at(&self, n: usize) -> bool {
        let pos = self.pos.add(n);
        if pos.is_less_than(self.input.len()) {
            let c = Enc::wide(self.input[pos.cast()]);
            return c == 0x20 || c == 0x09 || c == 0x0A || c == 0x0D;
        }
        false
    }

    fn is_any_or_eof_at(&self, values: impl AsRef<[Enc::Unit]>, n: usize) -> bool {
        let pos = self.pos.add(n);
        if pos.is_less_than(self.input.len()) {
            return values.as_ref().contains(&self.input[pos.cast()]);
        }
        true
    }

    fn is_eof(&self) -> bool {
        !self.pos.is_less_than(self.input.len())
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

    fn string_range(&self) -> StringRangeStart {
        StringRangeStart { off: self.pos }
    }
}

// ───────────────────────────────────────────────────────────────────────────
// helpers
// ───────────────────────────────────────────────────────────────────────────

fn eq_ascii<Enc: Encoding>(s: &[Enc::Unit], lit: &[u8]) -> bool {
    s.len() == lit.len() && s.iter().zip(lit).all(|(a, b)| Enc::wide(*a) == *b as u32)
}
