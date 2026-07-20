use core::ptr;

use bun_alloc::ArenaVecExt as _;
use bun_alloc::{AllocError, Arena as Bump};
// `bun.SmallList` lives in `bun_css` (higher tier). Semantically it
// is `smallvec::SmallVec` (inline-N, heap-spill). PORTING.md §Collections.
use self::StringEncoding as Encoding;
use bun_alloc::ArenaVec as BumpVec;
use bun_core::SmolStr;
use smallvec::SmallVec;

// ═══════════════════════════════════════════════════════════════════════════
// Moved from `bun_shell`:
//   StringEncoding, SrcAscii, SrcUnicode, ShellCharIter, CharIter, has_eq_sign
// These live here so `bun_shell` (higher tier) can depend on `shell_parser`
// without a back-edge. `bun_shell` re-exports these under its old paths.
// ═══════════════════════════════════════════════════════════════════════════

use bun_core::strings;
use bun_core::strings::CodePoint; // i32
use bun_core::strings::{CodepointIterator, Cursor};

/// Encoding of the shell input bytes being expanded.
#[derive(Clone, Copy, PartialEq, Eq, core::marker::ConstParamTy)]
pub enum StringEncoding {
    Ascii,
    Wtf8,
    Utf16,
}

// ─── SrcAscii ──────────────────────────────────────────────────────────────

// Copy: bitwise OK — `bytes` borrows caller-owned input (BACKREF, non-owning).
#[derive(Copy, Clone)]
struct SrcAscii {
    bytes: *const [u8], // raw slice ptr — borrowed caller input; lifetime erased (BACKREF).
    i: usize,
}

// PERF: `char` is u32 so ascii/unicode share one `InputChar` shape and
// `ShellCharIter<const E>` needs no type-level branching on `E`. Could split per
// encoding if profiling shows it matters.
#[derive(Copy, Clone)]
pub struct InputChar {
    pub char: u32,
    pub escaped: bool,
}

#[derive(Copy, Clone)]
struct AsciiIndexValue {
    char: u32,
    escaped: bool,
}

impl SrcAscii {
    #[inline]
    fn init(bytes: &[u8]) -> Self {
        Self {
            bytes: std::ptr::from_ref::<[u8]>(bytes),
            i: 0,
        }
    }
    #[inline]
    fn bytes(&self) -> &[u8] {
        // SAFETY: `bytes` outlives the iter by construction (caller contract).
        unsafe { &*self.bytes }
    }
    #[inline]
    fn index(&self) -> Option<AsciiIndexValue> {
        let b = self.bytes();
        if self.i >= b.len() {
            return None;
        }
        Some(AsciiIndexValue {
            char: u32::from(b[self.i]),
            escaped: false,
        })
    }
    #[inline]
    fn index_next(&self) -> Option<AsciiIndexValue> {
        let b = self.bytes();
        if self.i + 1 >= b.len() {
            return None;
        }
        Some(AsciiIndexValue {
            char: u32::from(b[self.i + 1]),
            escaped: false,
        })
    }
    #[inline]
    fn eat(&mut self, escaped: bool) {
        self.i += 1 + escaped as usize;
    }
}

// ─── SrcUnicode ────────────────────────────────────────────────────────────

struct SrcUnicode {
    iter: CodepointIterator<'static>, // lifetime erased; see SrcAscii.bytes note.
    cursor: Cursor,
    next_cursor: Cursor,
}

#[derive(Copy, Clone)]
struct UnicodeIndexValue {
    char: u32,
    width: u8,
}

impl SrcUnicode {
    #[inline]
    fn next_cursor(iter: &CodepointIterator<'static>, cursor: &mut Cursor) {
        if !CodepointIterator::next(iter, cursor) {
            // This will make `i > sourceBytes.len` so the condition in `index` will fail
            cursor.i = u32::try_from(iter.bytes.len() + 1).unwrap();
            cursor.width = 1;
            cursor.c = CodepointIterator::ZERO_VALUE;
        }
    }
    fn init(bytes: &[u8]) -> Self {
        // SAFETY: erase lifetime — caller guarantees `bytes` outlives the iter.
        let bytes: &'static [u8] =
            unsafe { core::slice::from_raw_parts(bytes.as_ptr(), bytes.len()) };
        let iter = CodepointIterator::init(bytes);
        let mut cursor = Cursor::default();
        Self::next_cursor(&iter, &mut cursor);
        let mut next_cursor = cursor;
        Self::next_cursor(&iter, &mut next_cursor);
        Self {
            iter,
            cursor,
            next_cursor,
        }
    }
    #[inline]
    fn index(&self) -> Option<UnicodeIndexValue> {
        if self.cursor.width as usize + self.cursor.i as usize > self.iter.bytes.len() {
            return None;
        }
        Some(UnicodeIndexValue {
            char: self.cursor.c as u32,
            width: self.cursor.width,
        })
    }
    #[inline]
    fn index_next(&self) -> Option<UnicodeIndexValue> {
        if self.next_cursor.width as usize + self.next_cursor.i as usize > self.iter.bytes.len() {
            return None;
        }
        Some(UnicodeIndexValue {
            char: self.next_cursor.c as u32,
            width: self.next_cursor.width,
        })
    }
    #[inline]
    fn eat(&mut self, escaped: bool) {
        if escaped {
            // eat two codepoints
            Self::next_cursor(&self.iter, &mut self.next_cursor);
            self.cursor = self.next_cursor;
            Self::next_cursor(&self.iter, &mut self.next_cursor);
        } else {
            // eat one codepoint
            self.cursor = self.next_cursor;
            Self::next_cursor(&self.iter, &mut self.next_cursor);
        }
    }
}

// ─── ShellCharIter ─────────────────────────────────────────────────────────

#[derive(Copy, Clone, PartialEq, Eq)]
pub enum ShellCharIterState {
    Normal,
    Single,
    Double,
}

// PERF: Rust const
// generics can't pick a field type from an enum value without an aux trait, so we
// store both arms in a small enum and branch at runtime. Could split into three
// `impl CharIter for ShellCharIter<{StringEncoding::*}>` blocks if profiling
// shows the branch matters.
enum ShellSrc {
    Ascii(SrcAscii),
    Unicode(SrcUnicode),
}

pub struct ShellCharIter<const E: StringEncoding> {
    src: ShellSrc,
    pub state: ShellCharIterState,
    pub prev: Option<InputChar>,
    pub current: Option<InputChar>,
}

/// Surface trait so callers can name `<ShellCharIter<E> as CharIter>::InputChar` /
/// `::CodepointType` without inherent associated types.
pub trait CharIter: Sized {
    type CodepointType: Copy;
    type InputChar: Copy;
    fn init(bytes: &[u8]) -> Self;
    fn eat(&mut self) -> Option<Self::InputChar>;
    fn peek(&mut self) -> Option<Self::InputChar>;
    fn read_char(&mut self) -> Option<Self::InputChar>;
    fn src_bytes(&self) -> &[u8];
    fn src_bytes_at_cursor(&self) -> &[u8];
    fn cursor_pos(&self) -> usize;
}

impl<const E: StringEncoding> ShellCharIter<E> {
    #[inline]
    pub fn is_whitespace(c: InputChar) -> bool {
        matches!(
            c.char,
            0x09 /* \t */ | 0x0D /* \r */ | 0x0A /* \n */ | 0x20 /* ' ' */
        )
    }
}

impl<const E: StringEncoding> CharIter for ShellCharIter<E> {
    // PERF: unified to u32 for ascii and unicode (see InputChar note).
    type CodepointType = u32;
    type InputChar = InputChar;

    fn init(bytes: &[u8]) -> Self {
        let src = if E == StringEncoding::Ascii {
            ShellSrc::Ascii(SrcAscii::init(bytes))
        } else {
            ShellSrc::Unicode(SrcUnicode::init(bytes))
        };
        Self {
            src,
            state: ShellCharIterState::Normal,
            prev: None,
            current: None,
        }
    }

    fn src_bytes(&self) -> &[u8] {
        match &self.src {
            ShellSrc::Ascii(a) => a.bytes(),
            ShellSrc::Unicode(u) => u.iter.bytes,
        }
    }

    fn src_bytes_at_cursor(&self) -> &[u8] {
        let bytes = self.src_bytes();
        match &self.src {
            ShellSrc::Ascii(a) => {
                if a.i >= bytes.len() {
                    return b"";
                }
                &bytes[a.i..]
            }
            ShellSrc::Unicode(u) => {
                if u.cursor.i as usize >= bytes.len() {
                    return b"";
                }
                &bytes[u.cursor.i as usize..]
            }
        }
    }

    fn cursor_pos(&self) -> usize {
        match &self.src {
            ShellSrc::Ascii(a) => a.i,
            ShellSrc::Unicode(u) => u.cursor.i as usize,
        }
    }

    fn eat(&mut self) -> Option<InputChar> {
        if let Some(result) = self.read_char() {
            self.prev = self.current;
            self.current = Some(result);
            match &mut self.src {
                ShellSrc::Ascii(a) => a.eat(result.escaped),
                ShellSrc::Unicode(u) => u.eat(result.escaped),
            }
            return Some(result);
        }
        None
    }

    fn peek(&mut self) -> Option<InputChar> {
        self.read_char()
    }

    fn read_char(&mut self) -> Option<InputChar> {
        let (mut ch, _width_or_escaped);
        match &self.src {
            ShellSrc::Ascii(a) => {
                let iv = a.index()?;
                ch = iv.char;
                _width_or_escaped = iv.escaped as u8;
            }
            ShellSrc::Unicode(u) => {
                let iv = u.index()?;
                ch = iv.char;
                _width_or_escaped = iv.width;
            }
        }
        if ch != u32::from(b'\\') || self.state == ShellCharIterState::Single {
            return Some(InputChar {
                char: ch,
                escaped: false,
            });
        }

        // Handle backslash
        match self.state {
            ShellCharIterState::Normal => {
                let peeked = match &self.src {
                    ShellSrc::Ascii(a) => a.index_next()?.char,
                    ShellSrc::Unicode(u) => u.index_next()?.char,
                };
                ch = peeked;
            }
            ShellCharIterState::Double => {
                let peeked = match &self.src {
                    ShellSrc::Ascii(a) => a.index_next()?.char,
                    ShellSrc::Unicode(u) => u.index_next()?.char,
                };
                match peeked {
                    // Backslash only applies to these characters
                    c if c == u32::from(b'$')
                        || c == u32::from(b'`')
                        || c == u32::from(b'"')
                        || c == u32::from(b'\\')
                        || c == u32::from(b'\n')
                        || c == u32::from(b'#') =>
                    {
                        ch = peeked;
                    }
                    _ => {
                        return Some(InputChar {
                            char: ch,
                            escaped: false,
                        });
                    }
                }
            }
            // We checked `self.state == .Single` above so this is impossible.
            // was `unreachable_unchecked()`; the lexer is on a
            // cold path so trade the elided check for a defined panic.
            ShellCharIterState::Single => unreachable!(),
        }

        Some(InputChar {
            char: ch,
            escaped: true,
        })
    }
}

// ─── has_eq_sign ───────────────────────────────────────────────────────────

/// Returns the index of the first `=` in the string, if any
/// (codepoint-aware for non-ASCII input).
pub fn has_eq_sign(str_: &[u8]) -> Option<u32> {
    if strings::is_all_ascii(str_) {
        return bun_core::strings::index_of_char(str_, b'=');
    }

    // TODO actually i think that this can also use the simd stuff
    let iter = CodepointIterator::init(str_);
    let mut cursor = Cursor::default();
    while CodepointIterator::next(&iter, &mut cursor) {
        if cursor.c == b'=' as CodePoint {
            return Some(cursor.i);
        }
    }
    None
}

// ═══════════════════════════════════════════════════════════════════════════

bun_core::declare_scope!(BRACES, visible);

/// Using u16 because anymore tokens than that results in an unreasonably high
/// amount of brace expansion (like around 32k variants to expand)
// Two u16 fields packed into a u32.
#[repr(transparent)]
#[derive(Default, Copy, Clone)]
struct ExpansionVariant(u32);

impl ExpansionVariant {
    #[inline]
    const fn new(start: u16, end: u16) -> Self {
        Self((start as u32) | ((end as u32) << 16))
    }
    #[inline]
    const fn start(self) -> u16 {
        self.0 as u16
    }
    /// must be >= start
    #[inline]
    const fn end(self) -> u16 {
        (self.0 >> 16) as u16
    }
}

#[derive(Default, Copy, Clone, PartialEq, Eq)]
pub struct ExpansionVariants {
    pub idx: u16,
    pub end: u16,
}

#[derive(bun_core::EnumTag)]
#[enum_tag(existing = TokenTag)]
pub enum Token {
    Open(ExpansionVariants),
    Comma,
    Text(SmolStr),
    Close,
    Eof,
}

impl PartialEq for Token {
    fn eq(&self, other: &Self) -> bool {
        match (self, other) {
            (Token::Open(a), Token::Open(b)) => a == b,
            (Token::Comma, Token::Comma) => true,
            // Compare text content; content comparison is the intended semantics.
            (Token::Text(a), Token::Text(b)) => a.slice() == b.slice(),
            (Token::Close, Token::Close) => true,
            (Token::Eof, Token::Eof) => true,
            _ => false,
        }
    }
}
impl Eq for Token {}

impl core::fmt::Debug for Token {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            Token::Open(v) => f
                .debug_struct("Open")
                .field("idx", &v.idx)
                .field("end", &v.end)
                .finish(),
            Token::Comma => f.write_str("Comma"),
            Token::Text(s) => write!(f, "Text({:?})", bstr::BStr::new(s.slice())),
            Token::Close => f.write_str("Close"),
            Token::Eof => f.write_str("Eof"),
        }
    }
}

// Deep-copies via `from_slice` so the parser can own
// its token. PERF: extra alloc on heap-backed SmolStr — profile if hot.
impl Clone for Token {
    fn clone(&self) -> Self {
        match self {
            Token::Open(v) => Token::Open(*v),
            Token::Comma => Token::Comma,
            Token::Text(s) => {
                Token::Text(SmolStr::from_slice(s.slice()).expect("OOM cloning SmolStr"))
            }
            Token::Close => Token::Close,
            Token::Eof => Token::Eof,
        }
    }
}

#[derive(Copy, Clone, PartialEq, Eq)]
pub enum TokenTag {
    Open,
    Comma,
    Text,
    Close,
    Eof,
}

impl Token {
    pub fn to_text(&self) -> SmolStr {
        match self {
            Token::Open(_) => SmolStr::from_char(b'{'),
            Token::Comma => SmolStr::from_char(b','),
            Token::Text(txt) => SmolStr::from_slice(txt.slice()).expect("OOM cloning SmolStr"),
            Token::Close => SmolStr::from_char(b'}'),
            Token::Eof => SmolStr::empty(),
        }
    }
}

// ─── JSON debug formatters ───────────────────────────────────────────────────
// Used by
// `Bun.$.braces(str, {tokenize:true})` / `{parse:true}` (debug-only). The
// encoder emits tagged unions as `{"<tag>": <payload>}`
// and bare-payload structs by field, so the JS-visible
// output shape stays stable.

fn json_escape_into(out: &mut Vec<u8>, s: &[u8]) {
    // debug-only path; canonical's run-batched write_str preserves verbatim
    // bytes so no regression vs old out.push(b).
    let _ = bun_core::fmt::encode_json_string(&mut bun_core::fmt::VecWriter(out), s);
}

pub fn tokens_to_json(tokens: &[Token]) -> Vec<u8> {
    use std::io::Write as _;
    let mut out = Vec::with_capacity(tokens.len() * 16 + 2);
    out.push(b'[');
    for (i, t) in tokens.iter().enumerate() {
        if i > 0 {
            out.push(b',');
        }
        match t {
            Token::Open(v) => {
                let _ = write!(
                    &mut out,
                    "{{\"open\":{{\"idx\":{},\"end\":{}}}}}",
                    v.idx, v.end
                );
            }
            Token::Comma => out.extend_from_slice(b"\"comma\""),
            Token::Close => out.extend_from_slice(b"\"close\""),
            Token::Eof => out.extend_from_slice(b"\"eof\""),
            Token::Text(txt) => {
                out.extend_from_slice(b"{\"text\":");
                json_escape_into(&mut out, txt.slice());
                out.push(b'}');
            }
        }
    }
    out.push(b']');
    out
}

pub fn ast_to_json(root: &ast::Group) -> Vec<u8> {
    let mut out = Vec::new();
    ast_group_to_json(root, &mut out);
    out
}

fn ast_atom_to_json(atom: &ast::Atom, out: &mut Vec<u8>) {
    match atom {
        ast::Atom::Text(txt) => {
            out.extend_from_slice(b"{\"text\":");
            json_escape_into(out, txt.slice());
            out.push(b'}');
        }
        ast::Atom::Expansion(exp) => {
            out.extend_from_slice(b"{\"expansion\":{\"variants\":[");
            // SAFETY: `variants` is a bump-allocated slice live for the parse arena.
            let variants = unsafe { &*exp.variants };
            for (i, g) in variants.iter().enumerate() {
                if i > 0 {
                    out.push(b',');
                }
                ast_group_to_json(g, out);
            }
            out.extend_from_slice(b"]}}");
        }
    }
}

fn ast_group_to_json(group: &ast::Group, out: &mut Vec<u8>) {
    use std::io::Write as _;
    out.extend_from_slice(b"{\"bubble_up\":");
    if group.bubble_up.is_null() {
        out.extend_from_slice(b"null");
    } else {
        // Optional pointers are encoded as the pointer address.
        let _ = write!(out, "{}", group.bubble_up as usize);
    }
    out.extend_from_slice(b",\"bubble_up_next\":");
    match group.bubble_up_next {
        Some(n) => {
            let _ = write!(out, "{}", n);
        }
        None => out.extend_from_slice(b"null"),
    }
    out.extend_from_slice(b",\"atoms\":");
    match &group.atoms {
        ast::GroupAtoms::Single(atom) => {
            out.extend_from_slice(b"{\"single\":");
            ast_atom_to_json(atom, out);
            out.push(b'}');
        }
        ast::GroupAtoms::Many(atoms) => {
            out.extend_from_slice(b"{\"many\":[");
            // SAFETY: bump-allocated slice live for the parse arena.
            let atoms = unsafe { &**atoms };
            for (i, a) in atoms.iter().enumerate() {
                if i > 0 {
                    out.push(b',');
                }
                ast_atom_to_json(a, out);
            }
            out.extend_from_slice(b"]}");
        }
    }
    out.push(b'}');
}

pub mod ast {
    use super::*;

    pub enum Atom {
        Text(SmolStr),
        Expansion(Expansion),
    }

    pub enum GroupAtoms {
        Single(Atom),
        // bump-owned slice; raw because Group has raw backrefs (see bubble_up).
        Many(*mut [Atom]),
    }

    pub struct Group {
        /// BACKREF: child points back to owning parent Group (LIFETIMES.tsv).
        pub bubble_up: *mut Group,
        pub bubble_up_next: Option<u16>,
        pub atoms: GroupAtoms,
    }

    impl Default for Group {
        fn default() -> Self {
            Self {
                bubble_up: ptr::null_mut(),
                bubble_up_next: None,
                atoms: GroupAtoms::Single(Atom::Text(SmolStr::empty())),
            }
        }
    }

    pub struct Expansion {
        // bump-owned mutable slice; raw because expand_nested writes
        // bubble_up backrefs into elements while recursing through the parent.
        pub variants: *mut [Group],
    }
}

const MAX_NESTED_BRACES: usize = 10;

const MAX_BRACE_GROUPS: usize = 256;

/// Cap on how many variants a single `{x..y[..incr]}` sequence expression
/// may expand to. Mirrors the reasoning behind the `u16` `ExpansionVariant`
/// packing above: past a few thousand variants the result is not something
/// anyone actually wants, and without a cap a command like `{1..99999999}`
/// would eagerly materialize tens of millions of tokens before any
/// downstream size check ever runs. A sequence past this limit is treated
/// as not-a-sequence and left as literal text, same as any other malformed
/// sequence expression (e.g. `{1..}`).
const MAX_SEQUENCE_EXPANSION: usize = 10_000;

// ─── Brace sequence expressions (`{x..y}`, `{x..y..incr}`) ─────────────────
//
// Bash's brace expansion has two forms: comma lists (`{a,b,c}`, handled by
// the tokenizer/parser above) and "sequence expressions" — either both
// endpoints decimal integers, or both endpoints a single ASCII letter,
// joined by `..` with an optional third `..incr` term. This section detects
// a sequence expression inside an otherwise-plain brace group and rewrites
// it into the same `Text, Comma, Text, Comma, ..., Text` shape a literal
// comma list would tokenize to, so the existing parser/expander needs no
// changes to support it.
//
// The exact zero-padding and range rules below were verified empirically
// against `bash 5.3.0`, not derived from the manual (which only documents
// the feature informally). Notably: padding triggers only when an operand's
// digit run (after stripping an optional `-`) is longer than one digit and
// starts with `0`; the padded width is the longer of the two operands'
// *full* text length (sign included). A leading `+` sign is deliberately
// NOT accepted as a valid operand — bash accepts it but applies the
// zero-padding rule inconsistently for `+`-prefixed operands in a way that
// doesn't follow from the rule above (verified: `{+01..3}` doesn't pad but
// `{+1..03}` does), and a leading `+` in a brace sequence is vanishingly
// rare in real shell usage. `{+01..3}` therefore falls through as literal
// text rather than attempting to bug-for-bug match that corner.

/// A parsed decimal integer operand of a sequence expression.
struct IntOperand {
    value: i128,
    /// Length of the digit run, excluding an optional leading `-`.
    digit_len: usize,
}

/// Parses `s` as `-?[0-9]+` in full (no surrounding junk). Digit runs longer
/// than 18 characters are rejected rather than risking i128 overflow further
/// down — no legitimate brace sequence needs operands anywhere near that
/// large.
fn parse_int_operand(s: &[u8]) -> Option<IntOperand> {
    if s.is_empty() {
        return None;
    }
    let (negative, digits) = if s[0] == b'-' {
        (true, &s[1..])
    } else {
        (false, s)
    };
    if digits.is_empty() || digits.len() > 18 || !digits.iter().all(u8::is_ascii_digit) {
        return None;
    }
    let mut value: i128 = 0;
    for &b in digits {
        value = value * 10 + i128::from(b - b'0');
    }
    Some(IntOperand {
        value: if negative { -value } else { value },
        digit_len: digits.len(),
    })
}

/// Splits `s` at the first `..`, returning `(before, after)`. Used both to
/// find the `x..y` boundary and, on the remainder, the optional `..incr`.
fn split_once_dotdot(s: &[u8]) -> Option<(&[u8], &[u8])> {
    let mut i = 0;
    while i + 1 < s.len() {
        if s[i] == b'.' && s[i + 1] == b'.' {
            return Some((&s[..i], &s[i + 2..]));
        }
        i += 1;
    }
    None
}

/// The digit immediately after an optional leading `-`.
fn first_digit(operand: &[u8]) -> u8 {
    if operand[0] == b'-' {
        operand[1]
    } else {
        operand[0]
    }
}

fn format_int_padded(v: i128, pad_width: usize) -> Vec<u8> {
    if pad_width == 0 {
        return v.to_string().into_bytes();
    }
    if v < 0 {
        format!("-{:0width$}", -v, width = pad_width.saturating_sub(1)).into_bytes()
    } else {
        format!("{:0width$}", v, width = pad_width).into_bytes()
    }
}

/// Parses the increment term of a sequence expression (the part after the
/// second `..`, if present). An increment of `0` behaves as if omitted
/// (matches bash: `{1..5..0}` expands the same as `{1..5}`); the sign is
/// discarded — direction always comes from comparing the two endpoints,
/// never from the increment (matches bash: `{1..3..-1}` still counts up).
fn parse_step_magnitude(incr: Option<&[u8]>) -> Option<i128> {
    match incr {
        None => Some(1),
        Some(bytes) => {
            let parsed = parse_int_operand(bytes)?;
            Some(if parsed.value == 0 {
                1
            } else {
                parsed.value.abs()
            })
        }
    }
}

/// A validated, size-capped sequence expression, ready to materialize.
/// Computing this (rather than jumping straight to generating the output
/// `Vec<Vec<u8>>`) is what lets `is_valid_brace_sequence` answer a plain
/// yes/no without allocating up to `MAX_SEQUENCE_EXPANSION` strings just to
/// throw them away.
enum SequenceSpec {
    Int {
        start: i128,
        step: i128,
        pad_width: usize,
        count: usize,
    },
    Char {
        start: u8,
        step: i128,
        count: usize,
    },
}

/// `(end - start).abs() / step_mag + 1`, rejecting anything over
/// `MAX_SEQUENCE_EXPANSION`. Always >= 1 for `step_mag > 0` (asserted by
/// callers), so this only ever rejects for being too large.
///
/// Callers currently only ever pass operands bounded to 18 decimal digits
/// (`parse_int_operand` rejects longer ones), so `count` can't get anywhere
/// near overflowing `usize` in practice — but comparing against the cap in
/// the wide `i128` type, before ever casting to `usize`, means that stays
/// true by construction instead of by the caller's current behavior.
fn sequence_count(start: i128, end: i128, step_mag: i128) -> Option<usize> {
    debug_assert!(step_mag > 0);
    let count = (end - start).abs() / step_mag + 1;
    if count > MAX_SEQUENCE_EXPANSION as i128 {
        return None;
    }
    Some(count as usize)
}

fn parse_sequence_spec(text: &[u8]) -> Option<SequenceSpec> {
    let (first, rest) = split_once_dotdot(text)?;
    let (second, incr) = match split_once_dotdot(rest) {
        Some((second, incr)) => (second, Some(incr)),
        None => (rest, None),
    };
    if first.is_empty() || second.is_empty() {
        return None;
    }

    if let (Some(x), Some(y)) = (parse_int_operand(first), parse_int_operand(second)) {
        let step_mag = parse_step_magnitude(incr)?;
        let count = sequence_count(x.value, y.value, step_mag)?;
        let pad_width = if (x.digit_len > 1 && first_digit(first) == b'0')
            || (y.digit_len > 1 && first_digit(second) == b'0')
        {
            first.len().max(second.len())
        } else {
            0
        };
        let step = if x.value <= y.value {
            step_mag
        } else {
            -step_mag
        };
        return Some(SequenceSpec::Int {
            start: x.value,
            step,
            pad_width,
            count,
        });
    }

    if first.len() == 1
        && second.len() == 1
        && first[0].is_ascii_alphabetic()
        && second[0].is_ascii_alphabetic()
    {
        let step_mag = parse_step_magnitude(incr)?;
        let count = sequence_count(i128::from(first[0]), i128::from(second[0]), step_mag)?;
        let step = if first[0] <= second[0] {
            step_mag
        } else {
            -step_mag
        };
        return Some(SequenceSpec::Char {
            start: first[0],
            step,
            count,
        });
    }

    None
}

/// Cheap yes/no check for whether `text` is a valid bash brace sequence
/// expression — same grammar and cap as `parse_brace_sequence`, without
/// materializing the (possibly thousands of) expanded variants just to
/// discard them. Used by the parser's `brace_expansion_hint` computation.
pub(crate) fn is_valid_brace_sequence(text: &[u8]) -> bool {
    parse_sequence_spec(text).is_some()
}

/// Recognizes `text` as a bash brace sequence expression — `x..y` or
/// `x..y..incr`, where `x`/`y` are both decimal integers or both single
/// ASCII letters — and returns the expanded variants in order. Returns
/// `None` for anything else (comma lists, plain words, malformed sequences
/// like `{1..}`), in which case the caller leaves the brace group untouched.
pub(crate) fn parse_brace_sequence(text: &[u8]) -> Option<Vec<Vec<u8>>> {
    // Compute each value fresh from `start + offset * step` (`offset` bounded
    // by `count <= MAX_SEQUENCE_EXPANSION`), not by repeatedly adding `step`
    // to a running value: when the step doesn't evenly divide the distance
    // (e.g. `{0..5..2}`, verified against bash to stop at 4, not reach 5),
    // stepping until equal to `end` overshoots and never terminates — an
    // infinite loop that would OOM well before any caller notices. Offset
    // multiplication also means the loop never adds past the last value
    // actually used, unlike a running `v += step` that still executes (and
    // could in principle overflow) once more after the final push.
    match parse_sequence_spec(text)? {
        SequenceSpec::Int {
            start,
            step,
            pad_width,
            count,
        } => {
            let mut out = Vec::with_capacity(count);
            for offset in 0..count as i128 {
                out.push(format_int_padded(start + offset * step, pad_width));
            }
            Some(out)
        }
        SequenceSpec::Char { start, step, count } => {
            let mut out = Vec::with_capacity(count);
            for offset in 0..count as i128 {
                out.push(vec![(i128::from(start) + offset * step) as u8]);
            }
            Some(out)
        }
    }
}

fn check_brace_group_count(tokens: &[Token]) -> Result<(), ParserError> {
    let opens = tokens
        .iter()
        .filter(|t| matches!(t, Token::Open(_)))
        .count();
    if opens > MAX_BRACE_GROUPS {
        return Err(ParserError::TooManyBraces);
    }
    Ok(())
}

#[derive(thiserror::Error, strum::IntoStaticStr, Debug, Copy, Clone, PartialEq, Eq)]
pub enum ParserError {
    #[error("OutOfMemory")]
    OutOfMemory,
    #[error("UnexpectedToken")]
    UnexpectedToken,
    #[error("TooManyBraces")]
    TooManyBraces,
}

bun_core::oom_from_alloc!(ParserError);

impl From<ParserError> for crate::Error {
    fn from(e: ParserError) -> Self {
        match e {
            ParserError::OutOfMemory => crate::Error::Alloc(bun_alloc::AllocError),
            ParserError::UnexpectedToken => crate::Error::UnexpectedToken,
            ParserError::TooManyBraces => crate::Error::TooManyBraces,
        }
    }
}

pub(crate) type ExpandError = ParserError;

/// `out` is preallocated by using the result from `calculateExpandedAmount`
pub fn expand(
    bump: &Bump,
    tokens: &mut [Token],
    out: &mut [Vec<u8>],
    contains_nested: bool,
) -> Result<(), ExpandError> {
    check_brace_group_count(tokens)?;
    let mut out_key_counter: u16 = 1;
    if !contains_nested {
        let expansions_table = build_expansion_table_alloc(tokens)?;

        return expand_flat(
            tokens,
            &expansions_table[..],
            out,
            0,
            &mut out_key_counter,
            0,
            0,
            tokens.len(),
        );
    }

    let mut parser = Parser::init(tokens, bump);
    let mut root_node = parser.parse()?;
    // SAFETY: root_node lives on this stack frame for the duration of expand_nested;
    // all bubble_up backrefs written during recursion point into bump-owned Groups
    // or back at this root.
    unsafe { expand_nested(&raw mut root_node, out, 0, &mut out_key_counter, 0) }
}

// SAFETY contract: `root` must be a valid *mut Group whose `atoms` slices and
// `expansion.variants` slices are bump-owned and outlive this call. The function
// writes `bubble_up` backrefs (raw pointers) into child Groups and re-enters the
// parent through them; raw-pointer access is used throughout to avoid creating
// overlapping `&mut` borrows.
//
// Aliasing audit: no reference is held across a recursive call. The shared
// borrows created from raw pointers (`&(*root).atoms` match scrutinees,
// `&(*many)[i_]`, `expansion`) are consumed before recursion — `variants` is
// hoisted to a raw pointer copy ahead of the variant loop, and every arm that
// recurses either tail-returns or returns immediately after its loop. Writes
// during recursion target only `Group` structs (the stack root or bump-owned
// `variants` elements), never the `[Atom]` slices a caller frame borrowed
// from, and bubble-up re-entry always resumes past the caller's in-progress
// atom index, so no frame's expansion is mutated while it is on the stack.
unsafe fn expand_nested(
    root: *mut ast::Group,
    out: &mut [Vec<u8>],
    out_key: u16,
    out_key_counter: &mut u16,
    start: u32,
) -> Result<(), ExpandError> {
    // SAFETY: see fn doc comment —
    // bump-owned Groups outlive this call, no overlapping `&mut` borrows are held.
    unsafe {
        if let ast::GroupAtoms::Single(_) = (*root).atoms {
            if start > 0 {
                if !(*root).bubble_up.is_null() {
                    let bubble_up = (*root).bubble_up;
                    let next = (*root).bubble_up_next.unwrap();
                    return expand_nested(
                        bubble_up,
                        out,
                        out_key,
                        out_key_counter,
                        u32::from(next),
                    );
                }
                return Ok(());
            }

            match &(*root).atoms {
                ast::GroupAtoms::Single(ast::Atom::Text(txt)) => {
                    out[usize::from(out_key)].extend_from_slice(txt.slice());
                    if !(*root).bubble_up.is_null() {
                        let bubble_up = (*root).bubble_up;
                        let next = (*root).bubble_up_next.unwrap();
                        return expand_nested(
                            bubble_up,
                            out,
                            out_key,
                            out_key_counter,
                            u32::from(next),
                        );
                    }
                    return Ok(());
                }
                ast::GroupAtoms::Single(ast::Atom::Expansion(expansion)) => {
                    let length = out[usize::from(out_key)].len();
                    // reshaped for borrowck — snapshot prefix once.
                    // PERF: extra Vec alloc for prefix snapshot — profile if hot.
                    let prefix: Vec<u8> = out[usize::from(out_key)][..length].to_vec();
                    let variants = expansion.variants;
                    let variants_len = variants.len();
                    for j in 0..variants_len {
                        let group: *mut ast::Group = (*variants).as_mut_ptr().add(j);
                        (*group).bubble_up = root;
                        (*group).bubble_up_next = Some(1);
                        let new_key = if j == 0 {
                            out_key
                        } else {
                            let new_key = *out_key_counter;
                            out[usize::from(new_key)].extend_from_slice(&prefix);
                            *out_key_counter += 1;
                            new_key
                        };

                        expand_nested(group, out, new_key, out_key_counter, 0)?;
                    }
                    return Ok(());
                }
                ast::GroupAtoms::Many(_) => unreachable!(),
            }
        }

        let many: *mut [ast::Atom] = match &(*root).atoms {
            ast::GroupAtoms::Many(m) => *m,
            _ => unreachable!(),
        };
        let many_len = many.len();

        if start as usize >= many_len {
            if !(*root).bubble_up.is_null() {
                let bubble_up = (*root).bubble_up;
                let next = (*root).bubble_up_next.unwrap();
                return expand_nested(bubble_up, out, out_key, out_key_counter, u32::from(next));
            }
            return Ok(());
        }

        for i_ in (start as usize)..many_len {
            let i: u16 = u16::try_from(i_).expect("int cast");
            let atom: &ast::Atom = &(*many)[i_];
            match atom {
                ast::Atom::Text(txt) => {
                    out[usize::from(out_key)].extend_from_slice(txt.slice());
                }
                ast::Atom::Expansion(expansion) => {
                    let length = out[usize::from(out_key)].len();
                    // reshaped for borrowck — see above.
                    let prefix: Vec<u8> = out[usize::from(out_key)][..length].to_vec();
                    let variants = expansion.variants;
                    let variants_len = variants.len();
                    for j in 0..variants_len {
                        let group: *mut ast::Group = (*variants).as_mut_ptr().add(j);
                        (*group).bubble_up = root;
                        (*group).bubble_up_next = Some(i + 1);
                        let new_key = if j == 0 {
                            out_key
                        } else {
                            let new_key = *out_key_counter;
                            out[usize::from(new_key)].extend_from_slice(&prefix);
                            *out_key_counter += 1;
                            new_key
                        };

                        expand_nested(group, out, new_key, out_key_counter, 0)?;
                    }
                    return Ok(());
                }
            }
        }

        // After execution we need to go up a level
        if !(*root).bubble_up.is_null() {
            let bubble_up = (*root).bubble_up;
            let next = (*root).bubble_up_next.unwrap();
            return expand_nested(bubble_up, out, out_key, out_key_counter, u32::from(next));
        }
        Ok(())
    } // unsafe
}

/// This function is fast but does not work for nested brace expansions
/// TODO optimization: allocate into one buffer of chars
fn expand_flat(
    tokens: &[Token],
    expansion_table: &[ExpansionVariant],
    out: &mut [Vec<u8>],
    out_key: u16,
    out_key_counter: &mut u16,
    depth_: u8,
    start: usize,
    end: usize,
) -> Result<(), ExpandError> {
    bun_core::scoped_log!(BRACES, "expandFlat [{}, {}]", start, end);
    if start >= tokens.len() || end > tokens.len() {
        return Ok(());
    }

    let mut depth = depth_;
    for atom in tokens[start..end].iter() {
        match atom {
            Token::Text(txt) => {
                out[usize::from(out_key)].extend_from_slice(txt.slice());
            }
            Token::Close => {
                depth -= 1;
            }
            Token::Open(expansion_variants) => {
                depth += 1;
                debug_assert!(expansion_variants.end - expansion_variants.idx >= 1);

                let variants = &expansion_table
                    [usize::from(expansion_variants.idx)..usize::from(expansion_variants.end)];
                let skip_over_idx = variants[variants.len() - 1].end();

                let starting_len = out[usize::from(out_key)].len();
                // reshaped for borrowck — snapshot prefix once.
                let prefix: Vec<u8> = out[usize::from(out_key)][..starting_len].to_vec();
                for (i, variant) in variants.iter().enumerate() {
                    let new_key = if i == 0 {
                        out_key
                    } else {
                        let new_key = *out_key_counter;
                        out[usize::from(new_key)].extend_from_slice(&prefix);
                        *out_key_counter += 1;
                        new_key
                    };
                    expand_flat(
                        tokens,
                        expansion_table,
                        out,
                        new_key,
                        out_key_counter,
                        depth,
                        variant.start() as usize,
                        variant.end() as usize,
                    )?;
                    expand_flat(
                        tokens,
                        expansion_table,
                        out,
                        new_key,
                        out_key_counter,
                        depth,
                        skip_over_idx as usize,
                        end,
                    )?;
                }
                return Ok(());
            }
            _ => {}
        }
    }
    Ok(())
}

// FIXME error location
// lifetime on transient parser struct; `tokens`/`bump` borrowed from caller
// for the parse() call only — not an AST node.
pub struct Parser<'a> {
    current: usize,
    tokens: &'a [Token],
    bump: &'a Bump,
}

impl<'a> Parser<'a> {
    pub fn init(tokens: &'a [Token], bump: &'a Bump) -> Parser<'a> {
        Parser {
            current: 0,
            tokens,
            bump,
        }
    }

    pub fn parse(&mut self) -> Result<ast::Group, ParserError> {
        check_brace_group_count(self.tokens)?;
        let mut nodes: BumpVec<'a, ast::Atom> = BumpVec::new_in(self.bump);
        while !self.r#match(TokenTag::Eof) {
            match self.parse_atom()? {
                Some(atom) => nodes.push(atom),
                None => break,
            }
        }

        if nodes.len() == 1 {
            let single = nodes.into_iter().next().unwrap();
            Ok(ast::Group {
                bubble_up: ptr::null_mut(),
                bubble_up_next: None,
                atoms: ast::GroupAtoms::Single(single),
            })
        } else {
            let many = std::ptr::from_mut::<[ast::Atom]>(nodes.into_bump_slice_mut());
            Ok(ast::Group {
                bubble_up: ptr::null_mut(),
                bubble_up_next: None,
                atoms: ast::GroupAtoms::Many(many),
            })
        }
    }

    fn parse_atom(&mut self) -> Result<Option<ast::Atom>, ParserError> {
        match self.advance() {
            Token::Open(_) => {
                let expansion_ptr = self.parse_expansion()?;
                Ok(Some(ast::Atom::Expansion(expansion_ptr)))
            }
            Token::Text(txt) => Ok(Some(ast::Atom::Text(txt))),
            Token::Eof => Ok(None),
            Token::Close | Token::Comma => Err(ParserError::UnexpectedToken),
        }
    }

    fn parse_expansion(&mut self) -> Result<ast::Expansion, ParserError> {
        let mut variants: BumpVec<'a, ast::Group> = BumpVec::new_in(self.bump);
        while !self.match_any(&[TokenTag::Close, TokenTag::Eof]) {
            let mut group: BumpVec<'a, ast::Atom> = BumpVec::new_in(self.bump);
            let mut close = false;
            while !self.r#match(TokenTag::Eof) {
                if self.r#match(TokenTag::Close) {
                    close = true;
                    break;
                }
                if self.r#match(TokenTag::Comma) {
                    break;
                }
                let group_atom = match self.parse_atom()? {
                    Some(a) => a,
                    None => break,
                };
                group.push(group_atom);
            }
            if group.len() == 1 {
                let single = group.into_iter().next().unwrap();
                variants.push(ast::Group {
                    bubble_up: ptr::null_mut(),
                    bubble_up_next: None,
                    atoms: ast::GroupAtoms::Single(single),
                });
            } else {
                let many = std::ptr::from_mut::<[ast::Atom]>(group.into_bump_slice_mut());
                variants.push(ast::Group {
                    bubble_up: ptr::null_mut(),
                    bubble_up_next: None,
                    atoms: ast::GroupAtoms::Many(many),
                });
            }
            if close {
                break;
            }
        }

        Ok(ast::Expansion {
            variants: std::ptr::from_mut::<[ast::Group]>(variants.into_bump_slice_mut()),
        })
    }

    fn advance(&mut self) -> Token {
        if !self.is_at_end() {
            self.current += 1;
        }
        if self.current > 0 {
            self.prev()
        } else {
            self.peek().clone()
        }
    }

    fn is_at_end(&self) -> bool {
        matches!(self.peek(), Token::Eof)
    }

    /// Consumes token if it matches
    fn r#match(&mut self, toktag: TokenTag) -> bool {
        if self.peek().tag() == toktag {
            let _ = self.advance();
            return true;
        }
        false
    }

    fn match_any(&mut self, toktags: &[TokenTag]) -> bool {
        let peeked = self.peek().tag();
        for &tag in toktags {
            if peeked == tag {
                let _ = self.advance();
                return true;
            }
        }
        false
    }

    fn peek(&self) -> &Token {
        &self.tokens[self.current]
    }

    fn prev(&self) -> Token {
        self.tokens[self.current - 1].clone()
    }
}

pub fn calculate_expanded_amount(tokens: &[Token]) -> u32 {
    #[derive(Copy, Clone)]
    struct StackEntry {
        segment_product: u32,
        accumulator: u32,
    }
    impl Default for StackEntry {
        fn default() -> Self {
            Self {
                segment_product: 1,
                accumulator: 0,
            }
        }
    }
    let mut nested_brace_stack: SmallVec<[StackEntry; MAX_NESTED_BRACES]> = SmallVec::new();
    let mut variant_count: u32 = 0;

    for tok in tokens {
        match tok {
            Token::Open(_) => nested_brace_stack.push(StackEntry::default()),
            Token::Comma => {
                let top = nested_brace_stack.last_mut().unwrap();
                top.accumulator = top.accumulator.saturating_add(top.segment_product);
                top.segment_product = 1;
            }
            Token::Close => {
                let entry = nested_brace_stack.pop().unwrap();
                let total = entry.accumulator.saturating_add(entry.segment_product);
                if nested_brace_stack.len() > 0 {
                    let parent = nested_brace_stack.last_mut().unwrap();
                    parent.segment_product = parent.segment_product.saturating_mul(total);
                } else if variant_count == 0 {
                    variant_count = total;
                } else {
                    variant_count = variant_count.saturating_mul(total);
                }
            }
            _ => {}
        }
    }

    variant_count
}

fn build_expansion_table_alloc(tokens: &mut [Token]) -> Result<Vec<ExpansionVariant>, ParserError> {
    // PERF: the table is local POD dropped at the end of expand(), so a
    // plain global-allocator Vec is logic-neutral here.
    let mut table: Vec<ExpansionVariant> = Vec::new();
    build_expansion_table(tokens, &mut table)?;
    Ok(table)
}

fn build_expansion_table(
    tokens: &mut [Token],
    table: &mut Vec<ExpansionVariant>,
) -> Result<(), ParserError> {
    #[derive(Copy, Clone)]
    struct BraceState {
        tok_idx: u16,
        variants: u16,
        prev_tok_end: u16,
    }
    let mut brace_stack: SmallVec<[BraceState; MAX_NESTED_BRACES]> = SmallVec::new();

    if tokens.len() > u16::MAX as usize {
        return Err(ParserError::UnexpectedToken);
    }

    let mut i: u16 = 0;
    let mut prev_close = false;
    while (i as usize) < tokens.len() {
        match &mut tokens[i as usize] {
            Token::Open(open) => {
                let table_idx: u16 = u16::try_from(table.len()).expect("int cast");
                open.idx = table_idx;
                brace_stack.push(BraceState {
                    tok_idx: i,
                    variants: 0,
                    prev_tok_end: i,
                });
            }
            Token::Close => {
                let mut top = brace_stack.pop().unwrap();

                table.push(ExpansionVariant::new(top.prev_tok_end + 1, i));

                top.prev_tok_end = i;
                top.variants += 1;

                if let Token::Open(open) = &mut tokens[top.tok_idx as usize] {
                    open.end = u16::try_from(table.len()).expect("int cast");
                }
                prev_close = true;
            }
            Token::Comma => {
                let top = brace_stack.last_mut().unwrap();

                table.push(ExpansionVariant::new(top.prev_tok_end + 1, i));

                prev_close = false;

                top.prev_tok_end = i;
                top.variants += 1;
            }
            _ => {
                prev_close = false;
            }
        }
        i += 1;
    }
    let _ = prev_close;

    if cfg!(debug_assertions) {
        for variant in table.iter() {
            debug_assert!(variant.start() != 0 && variant.end() != 0);
        }
    }
    Ok(())
}

pub type Lexer = NewLexer<{ Encoding::Ascii }>;

type Chars<const E: Encoding> = ShellCharIter<E>;

pub struct LexerOutput {
    pub tokens: Vec<Token>,
    pub contains_nested: bool,
}

pub(crate) type BraceLexerError = AllocError;

pub struct NewLexer<const ENCODING: Encoding> {
    chars: Chars<ENCODING>,
    tokens: Vec<Token>,
    contains_nested: bool,
    /// Ordinals (Nth `Open` token seen, 0-indexed — NOT a token index; see
    /// the comment in `tokenize_impl`) of `Open`s whose group contained a
    /// backslash-escaped byte anywhere at its own level.
    escaped_group_opens: Vec<u32>,
}

impl<const ENCODING: Encoding> NewLexer<ENCODING> {
    pub fn tokenize(src: &[u8]) -> Result<LexerOutput, BraceLexerError> {
        let mut this = Self {
            chars: Chars::<ENCODING>::init(src),
            tokens: Vec::new(),
            contains_nested: false,
            escaped_group_opens: Vec::new(),
        };

        let contains_nested = this.tokenize_impl()?;

        Ok(LexerOutput {
            tokens: this.tokens,
            contains_nested,
        })
    }

    // FIXME: implement rollback on invalid brace
    fn tokenize_impl(&mut self) -> Result<bool, BraceLexerError> {
        // Unclosed brace expansion algorithm
        // {hi,hey
        // *xx*xxx
        //
        // {hi, hey
        // *xxx$
        //
        // {hi,{a,b} sdkjfs}
        // *xx**x*x*$
        //
        // 00000100000000000010000000000000
        // echo {foo,bar,baz,{hi,hey},oh,no
        // xxxxx*xxx*xxx*xxx**xx*xxx**xx*xx
        //
        // {hi,h{ey }
        // *xx*x*xx$
        //
        // - Replace chars with special tokens
        // - If unclosed or encounter bad token:
        //   - Start at beginning of brace, replacing special tokens back with
        //     chars, skipping over actual closed braces
        let mut brace_stack: SmallVec<[u32; MAX_NESTED_BRACES]> = SmallVec::new();
        // Tracks whether the innermost currently-open group has seen an
        // escaped byte directly at its own level (not a nested child's).
        // Bash disqualifies a group from sequence-expression recognition if
        // ANY byte inside it was backslash-escaped, even one unrelated to
        // the `..` — verified against bash 5.3.0: `{\1..3}`, `{1..\3}`, and
        // `{1\..3}` all stay fully literal. Recorded into
        // `self.escaped_group_opens` by raw token index on close; remapped
        // to the stable "Nth Open" ordinal `expand_brace_sequences` uses
        // once rollback (which can delete an outer unclosed Open while
        // leaving an inner closed one intact — see
        // `remap_escaped_group_opens_to_ordinals`) has settled which Opens
        // actually survive.
        let mut brace_has_escape: SmallVec<[bool; MAX_NESTED_BRACES]> = SmallVec::new();

        loop {
            let Some(input) = self.eat() else { break };
            let char = input.char;
            let escaped = input.escaped;

            if escaped {
                if let Some(top) = brace_has_escape.last_mut() {
                    *top = true;
                }
            } else {
                // `char` is u32 (CodepointType unified across encodings).
                match char {
                    c if c == u32::from(b'{') => {
                        brace_stack.push(u32::try_from(self.tokens.len()).expect("int cast"));
                        brace_has_escape.push(false);
                        self.tokens.push(Token::Open(ExpansionVariants::default()));
                        continue;
                    }
                    c if c == u32::from(b'}') => {
                        if brace_stack.len() > 0 {
                            let open_idx = brace_stack.pop().unwrap();
                            if brace_has_escape.pop() == Some(true) {
                                self.escaped_group_opens.push(open_idx);
                            }
                            self.tokens.push(Token::Close);
                            continue;
                        }
                    }
                    c if c == u32::from(b',') => {
                        if brace_stack.len() > 0 {
                            self.tokens.push(Token::Comma);
                            continue;
                        }
                    }
                    _ => {}
                }
            }

            // if (char_stack.push(char) == char_stack.Error.StackFull) {
            //     try self.app
            // }
            self.append_char(char)?;
        }

        // Unclosed braces
        while brace_stack.len() > 0 {
            let top_idx = brace_stack.pop().unwrap();
            self.rollback_braces(top_idx);
        }

        self.remap_escaped_group_opens_to_ordinals();
        self.flatten_tokens()?;
        self.expand_brace_sequences()?;
        self.tokens.push(Token::Eof);

        Ok(self.contains_nested)
    }

    /// Converts `self.escaped_group_opens` from raw token indices (assigned
    /// while `tokenize_impl`'s main loop runs, before rollback) to ordinals
    /// — "the Nth `Open` token, 0-indexed" — counted over the *current*
    /// (post-rollback) token stream. Must run after the unclosed-braces
    /// rollback loop and before `flatten_tokens`/`expand_brace_sequences`.
    ///
    /// Rollback can convert an outer *unclosed* `Open` back into literal
    /// `Text` while leaving an inner, already-closed group's `Open` intact
    /// (`rollback_braces`'s "skip over actual closed braces"). A raw token
    /// index recorded before that happens can point at content that is no
    /// longer an `Open` at all once rollback settles, and — because the
    /// disappeared token shifts every ordinal after it — a survivor's own
    /// ordinal can change too. Recomputing ordinals from the token indices
    /// fixes both: an index whose token is no longer `Open` is dropped (its
    /// group doesn't exist as a candidate anymore anyway), and a surviving
    /// index gets the ordinal it actually has *now*, matching what
    /// `expand_brace_sequences`'s own left-to-right Open-count will later
    /// see. `flatten_tokens`, which runs after this, never removes or
    /// reorders `Open` tokens, so that ordinal stays valid through it.
    fn remap_escaped_group_opens_to_ordinals(&mut self) {
        if self.escaped_group_opens.is_empty() {
            return;
        }
        let mut by_index = core::mem::take(&mut self.escaped_group_opens);
        // Not sorted on entry: nested escaped groups close LIFO (innermost
        // first), which is the *opposite* of their token-index order (the
        // innermost `{` was opened later, so it has the larger index) — so
        // without this, the lookup below would need a linear scan.
        by_index.sort_unstable();
        let mut ordinal: u32 = 0;
        for (idx, tok) in self.tokens.iter().enumerate() {
            if !matches!(tok, Token::Open(_)) {
                continue;
            }
            let idx = u32::try_from(idx).expect("int cast");
            if by_index.binary_search(&idx).is_ok() {
                self.escaped_group_opens.push(ordinal);
            }
            ordinal += 1;
        }
        // Ascending by construction (`idx` is scanned in increasing order),
        // which `expand_brace_sequences` relies on for a binary-search
        // lookup instead of a linear scan.
        debug_assert!(self.escaped_group_opens.is_sorted());
    }

    /// Rewrites every simple `Open, Text, Close` group (i.e. a brace group
    /// with no comma and no nesting — exactly the shape a `{x..y}` sequence
    /// tokenizes to before this pass runs) whose text is a valid sequence
    /// expression into `Open, Text, Comma, Text, ..., Close`: the same token
    /// shape a literal comma list produces. Must run after `flatten_tokens`
    /// (which merges adjacent `Text` tokens and computes `contains_nested`)
    /// and before `Token::Eof` is pushed. Groups that aren't a sequence
    /// expression (including malformed ones like `{1..}`) are left
    /// untouched, so this can't change behavior for anything that isn't a
    /// brace sequence.
    fn expand_brace_sequences(&mut self) -> Result<(), AllocError> {
        let mut i = 0;
        // Must count every `Open` in encounter order (matching the ordinal
        // numbering `tokenize_impl` assigned) to look `self.escaped_group_opens`
        // up correctly — see the field doc comment.
        let mut open_ordinal: u32 = 0;
        while i < self.tokens.len() {
            if !matches!(self.tokens[i], Token::Open(_)) {
                i += 1;
                continue;
            }
            let ordinal = open_ordinal;
            open_ordinal += 1;

            let is_simple_group = i + 2 < self.tokens.len()
                && matches!(self.tokens[i + 1], Token::Text(_))
                && matches!(self.tokens[i + 2], Token::Close);
            if !is_simple_group || self.escaped_group_opens.binary_search(&ordinal).is_ok() {
                i += 1;
                continue;
            }
            let Token::Text(text) = &self.tokens[i + 1] else {
                unreachable!()
            };
            let Some(variants) = parse_brace_sequence(text.slice()) else {
                i += 1;
                continue;
            };

            let mut replacement: Vec<Token> = Vec::with_capacity(variants.len() * 2 - 1);
            for (idx, variant) in variants.iter().enumerate() {
                if idx > 0 {
                    replacement.push(Token::Comma);
                }
                replacement.push(Token::Text(SmolStr::from_slice(variant)?));
            }
            let replacement_len = replacement.len();
            self.tokens.splice(i + 1..i + 2, replacement);
            i += replacement_len + 2; // skip past Open + replacement + Close
        }
        Ok(())
    }

    fn flatten_tokens(&mut self) -> Result<(), AllocError> {
        if self.tokens.is_empty() {
            return Ok(());
        }
        let mut brace_count: u32 = if matches!(self.tokens[0], Token::Open(_)) {
            1
        } else {
            0
        };
        let mut i: u32 = 0;
        let mut j: u32 = 1;
        while (i as usize) < self.tokens.len() && (j as usize) < self.tokens.len() {
            // reshaped for borrowck — branch on tags first, then borrow once.
            let itok_is_text = matches!(self.tokens[i as usize], Token::Text(_));
            let jtok_is_text = matches!(self.tokens[j as usize], Token::Text(_));

            if itok_is_text && jtok_is_text {
                let jtok_text = self.tokens[j as usize].to_text();
                if let Token::Text(itxt) = &mut self.tokens[i as usize] {
                    itxt.append_slice(jtok_text.slice())?;
                }
                let _ = self.tokens.remove(j as usize);
            } else {
                match &self.tokens[j as usize] {
                    Token::Close => {
                        brace_count -= 1;
                    }
                    Token::Open(_) => {
                        brace_count += 1;
                        if brace_count > 1 {
                            self.contains_nested = true;
                        }
                    }
                    _ => {}
                }
                i += 1;
                j += 1;
            }
        }
        Ok(())
    }

    fn rollback_braces(&mut self, starting_idx: u32) {
        if cfg!(debug_assertions) {
            let first = &self.tokens[starting_idx as usize];
            debug_assert!(matches!(first, Token::Open(_)));
        }

        let mut braces: u8 = 0;

        self.replace_token_with_string(starting_idx);
        let mut i: u32 = starting_idx + 1;
        while (i as usize) < self.tokens.len() {
            if braces > 0 {
                match &self.tokens[i as usize] {
                    Token::Open(_) => {
                        braces += 1;
                    }
                    Token::Close => {
                        braces -= 1;
                    }
                    _ => {}
                }
                i += 1;
                continue;
            }

            match &self.tokens[i as usize] {
                Token::Open(_) => {
                    braces += 1;
                    i += 1;
                    continue;
                }
                Token::Close | Token::Comma | Token::Text(_) => {
                    self.replace_token_with_string(i);
                }
                Token::Eof => {}
            }
            i += 1;
        }
    }

    fn replace_token_with_string(&mut self, token_idx: u32) {
        let tok = &mut self.tokens[token_idx as usize];
        let tok_text = tok.to_text();
        *tok = Token::Text(tok_text);
    }

    fn append_char(
        &mut self,
        char: <Chars<ENCODING> as CharIter>::CodepointType,
    ) -> Result<(), AllocError> {
        if !self.tokens.is_empty() {
            let last_idx = self.tokens.len() - 1;
            if let Token::Text(last) = &mut self.tokens[last_idx] {
                if ENCODING == Encoding::Ascii {
                    // SAFETY: ascii codepoint is u8
                    last.append_char(char as u8)?;
                    return Ok(());
                }
                let mut buf = [0u8; 4];
                let len = bun_core::encode_wtf8_rune(&mut buf, char);
                last.append_slice(&buf[..len])?;
                return Ok(());
            }
        }

        if ENCODING == Encoding::Ascii {
            self.tokens
                .push(Token::Text(SmolStr::from_slice(&[char as u8])?));
        } else {
            let mut buf = [0u8; 4];
            let len = bun_core::encode_wtf8_rune(&mut buf, char);
            self.tokens
                .push(Token::Text(SmolStr::from_slice(&buf[..len])?));
        }
        Ok(())
    }

    fn eat(&mut self) -> Option<<Chars<ENCODING> as CharIter>::InputChar> {
        self.chars.eat()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lexer() {
        struct TestCase(&'static [u8], Vec<Token>);
        let test_cases: Vec<TestCase> = vec![
            TestCase(
                b"{}",
                vec![
                    Token::Open(ExpansionVariants::default()),
                    Token::Close,
                    Token::Eof,
                ],
            ),
            TestCase(
                b"{foo}",
                vec![
                    Token::Open(ExpansionVariants::default()),
                    Token::Text(SmolStr::from_slice(b"foo").unwrap()),
                    Token::Close,
                    Token::Eof,
                ],
            ),
        ];

        for test_case in test_cases {
            let TestCase(src, expected) = test_case;
            // NOTE: don't use arena here so that we can test for memory leaks
            let result = Lexer::tokenize(src).unwrap();
            assert_eq!(result.tokens, expected);
        }
    }

    fn seq(strs: &[&str]) -> Option<Vec<Vec<u8>>> {
        Some(strs.iter().map(|s| s.as_bytes().to_vec()).collect())
    }

    #[test]
    fn brace_sequence_parsing() {
        // Verified against `bash 5.3.0`.
        assert_eq!(
            parse_brace_sequence(b"1..5"),
            seq(&["1", "2", "3", "4", "5"])
        );
        assert_eq!(
            parse_brace_sequence(b"5..1"),
            seq(&["5", "4", "3", "2", "1"])
        );
        assert_eq!(parse_brace_sequence(b"1..1"), seq(&["1"]));
        assert_eq!(
            parse_brace_sequence(b"-3..3"),
            seq(&["-3", "-2", "-1", "0", "1", "2", "3"])
        );
        assert_eq!(
            parse_brace_sequence(b"3..-3"),
            seq(&["3", "2", "1", "0", "-1", "-2", "-3"])
        );

        // Custom increment; sign of the increment is ignored, direction comes
        // from the endpoints. Increment of 0 behaves like no increment.
        assert_eq!(
            parse_brace_sequence(b"0..10..2"),
            seq(&["0", "2", "4", "6", "8", "10"])
        );
        assert_eq!(
            parse_brace_sequence(b"10..0..2"),
            seq(&["10", "8", "6", "4", "2", "0"])
        );
        assert_eq!(parse_brace_sequence(b"1..3..-1"), seq(&["1", "2", "3"]));
        assert_eq!(
            parse_brace_sequence(b"1..5..0"),
            seq(&["1", "2", "3", "4", "5"])
        );

        // Zero-padding: triggers only when an operand's digit run (after an
        // optional `-`) has length > 1 and starts with `0`; width is the
        // longer operand's full text length (sign included).
        assert_eq!(
            parse_brace_sequence(b"01..10"),
            seq(&["01", "02", "03", "04", "05", "06", "07", "08", "09", "10"])
        );
        assert_eq!(
            parse_brace_sequence(b"1..10"),
            seq(&["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"])
        ); // no leading zero -> no padding
        assert_eq!(parse_brace_sequence(b"0..3"), seq(&["0", "1", "2", "3"])); // bare "0" doesn't count as a leading zero
        assert_eq!(
            parse_brace_sequence(b"00..3"),
            seq(&["00", "01", "02", "03"])
        );
        assert_eq!(
            parse_brace_sequence(b"-5..05"),
            seq(&[
                "-5", "-4", "-3", "-2", "-1", "00", "01", "02", "03", "04", "05"
            ])
        );
        assert_eq!(
            parse_brace_sequence(b"-05..5"),
            seq(&[
                "-05", "-04", "-03", "-02", "-01", "000", "001", "002", "003", "004", "005"
            ])
        );
        assert_eq!(
            parse_brace_sequence(b"-1..-5"),
            seq(&["-1", "-2", "-3", "-4", "-5"])
        ); // same digit width, but no leading zero -> no padding

        // Character sequences: raw codepoint stepping between the two
        // endpoints (inclusive of non-letter bytes in between), no padding.
        assert_eq!(
            parse_brace_sequence(b"a..e"),
            seq(&["a", "b", "c", "d", "e"])
        );
        assert_eq!(
            parse_brace_sequence(b"e..a"),
            seq(&["e", "d", "c", "b", "a"])
        );
        assert_eq!(parse_brace_sequence(b"a..a"), seq(&["a"]));
        assert_eq!(
            parse_brace_sequence(b"z..a..5"),
            seq(&["z", "u", "p", "k", "f", "a"])
        );
        assert_eq!(
            parse_brace_sequence(b"Z..a"),
            seq(&["Z", "[", "\\", "]", "^", "_", "`", "a"])
        );

        // Not a sequence expression -> caller must leave the group literal.
        assert_eq!(parse_brace_sequence(b"1.."), None);
        assert_eq!(parse_brace_sequence(b"1..2.."), None);
        assert_eq!(parse_brace_sequence(b"foo"), None);
        assert_eq!(parse_brace_sequence(b"aa..cc"), None); // multi-char operands aren't a char sequence
        assert_eq!(parse_brace_sequence(b"+01..3"), None); // leading `+` not supported (see doc comment)
        assert_eq!(parse_brace_sequence(b""), None);

        // Safety cap: an unreasonably large sequence is treated as
        // not-a-sequence rather than eagerly materializing millions of
        // tokens.
        assert_eq!(parse_brace_sequence(b"1..99999999"), None);

        // Non-dividing step: must stop at the last value that doesn't
        // overshoot `end`, not loop forever trying to land on it exactly
        // (verified against bash: `{0..5..2}` -> "0 2 4", not "0 2 4 6").
        assert_eq!(parse_brace_sequence(b"0..5..2"), seq(&["0", "2", "4"]));
        assert_eq!(parse_brace_sequence(b"5..0..2"), seq(&["5", "3", "1"]));
        assert_eq!(parse_brace_sequence(b"a..d..2"), seq(&["a", "c"]));
    }

    #[test]
    fn is_valid_brace_sequence_matches_parse_brace_sequence() {
        for text in [
            "1..5".as_bytes(),
            b"5..1",
            b"0..10..2",
            b"01..10",
            b"a..e",
            b"z..a..5",
            b"1..",
            b"1..2..",
            b"foo",
            b"aa..cc",
            b"+01..3",
            b"",
            b"1..99999999",
            b"0..5..2",
        ] {
            assert_eq!(
                is_valid_brace_sequence(text),
                parse_brace_sequence(text).is_some(),
                "mismatch for {:?}",
                bstr::BStr::new(text)
            );
        }
    }

    #[test]
    fn lexer_sequence_expansion() {
        // `{1..3}` must tokenize exactly like the literal comma list
        // `{1,2,3}` does, so the existing parser/expander handles both
        // identically.
        let from_range = Lexer::tokenize(b"{1..3}").unwrap();
        let from_commas = Lexer::tokenize(b"{1,2,3}").unwrap();
        assert_eq!(from_range.tokens, from_commas.tokens);

        // A malformed sequence is left completely untouched.
        let unclosed_range = Lexer::tokenize(b"{1..}").unwrap();
        assert_eq!(
            unclosed_range.tokens,
            vec![
                Token::Open(ExpansionVariants::default()),
                Token::Text(SmolStr::from_slice(b"1..").unwrap()),
                Token::Close,
                Token::Eof,
            ]
        );
    }

    #[test]
    fn lexer_escaped_dot_disqualifies_sequence() {
        // Bash disqualifies sequence recognition if ANY byte inside the
        // group is backslash-escaped, even one that isn't part of the `..`
        // itself — verified against bash 5.3.0: `{\1..3}`, `{1..\3}`, and
        // `{1\..3}` all stay fully literal (unlike unescaped `{1..3}`,
        // which expands to "1 2 3").
        for src in [&b"{1\\..3}"[..], b"{1..\\3}", b"{\\1..3}"] {
            let result = Lexer::tokenize(src).unwrap();
            assert_eq!(
                result.tokens.len(),
                4,
                "expected [Open, Text, Close, Eof] for {:?}, got {:?}",
                bstr::BStr::new(src),
                result.tokens
            );
            assert!(
                matches!(result.tokens[0], Token::Open(_)),
                "{:?}",
                bstr::BStr::new(src)
            );
            assert!(
                matches!(result.tokens[1], Token::Text(_)),
                "escaped group should stay a single literal Text token, not be split into a comma sequence: {:?}",
                bstr::BStr::new(src)
            );
            assert_eq!(result.tokens[2], Token::Close);
        }

        // Sanity: the unescaped counterpart DOES expand, into
        // Open, Text("1"), Comma, Text("2"), Comma, Text("3"), Close, Eof.
        let unescaped = Lexer::tokenize(b"{1..3}").unwrap();
        assert_eq!(unescaped.tokens.len(), 8);
    }

    #[test]
    fn escaped_group_survives_rollback_of_an_outer_unclosed_brace() {
        // Regression test: an escaped, *closed* group nested inside an
        // *unclosed* outer group. Rollback converts the outer `{` back to
        // literal text (and everything at its level up to the surviving
        // inner group), which used to desync the escaped-group bookkeeping
        // — either because a raw token index went stale once
        // `flatten_tokens` shifted indices, or (the bug this test guards
        // against) because assigning the inner group's ordinal *before*
        // rollback didn't account for the outer `Open` disappearing and
        // shifting every ordinal after it. Both are closed by recording
        // token indices during the scan and remapping them to ordinals
        // only after rollback has settled which `Open`s survive.
        let src = b"{a,{1\\..3}";
        let result = Lexer::tokenize(src).unwrap();

        // The outer `{` and `,` roll back to literal text and merge with
        // the leading "a"; the inner group survives as real Open/Text/Close
        // tokens, and — because it's escaped — its Text stays a single
        // literal chunk instead of being split into a comma sequence.
        assert_eq!(
            result.tokens,
            vec![
                Token::Text(SmolStr::from_slice(b"{a,").unwrap()),
                Token::Open(ExpansionVariants::default()),
                Token::Text(SmolStr::from_slice(b"1..3").unwrap()),
                Token::Close,
                Token::Eof,
            ]
        );
    }

    #[test]
    fn remap_handles_out_of_order_nested_escaped_groups() {
        // Coverage for `remap_escaped_group_opens_to_ordinals` with two
        // *closed* escaped groups, one nested inside the other. Nested
        // groups close LIFO (innermost first), which is the *opposite* of
        // their token-index order (the innermost `{` opens later, so it has
        // the larger index) — so the raw-index list this function remaps is
        // `[inner_idx, outer_idx]` with `inner_idx > outer_idx`: descending,
        // not sorted. (`Vec::contains` used to give the right answer here
        // regardless of order, just via an O(n) scan per lookup instead of
        // the O(log n) binary search sorting first enables — this was a
        // perf finding, not a correctness one, but exercising it with a
        // real sequence-shaped inner group is still worth locking in.)
        let src = b"{a\\b{1\\..2}c}";
        let result = Lexer::tokenize(src).unwrap();

        // The inner group's de-escaped text ("1..2") looks like a valid
        // sequence — if the escape record were ever missed, it would wrongly
        // expand into `Text("1"), Comma, Text("2")`.
        assert!(
            !result.tokens.iter().any(|t| matches!(t, Token::Comma)),
            "the escaped inner group should not have been expanded into a sequence: {:?}",
            result.tokens
        );
        assert!(
            result
                .tokens
                .iter()
                .any(|t| matches!(t, Token::Text(s) if s.slice() == b"1..2")),
            "expected the inner group's text to survive verbatim: {:?}",
            result.tokens
        );
    }
}
