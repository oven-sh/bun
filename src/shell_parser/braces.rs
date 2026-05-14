use core::ptr;

use bun_alloc::ArenaVecExt as _;
use bun_alloc::{AllocError, Arena as Bump};
// PORT NOTE: `bun.SmallList` lives in `bun_css` (higher tier). Semantically it
// is `smallvec::SmallVec` (inline-N, heap-spill). PORTING.md §Collections.
use self::StringEncoding as Encoding;
use bun_alloc::ArenaVec as BumpVec;
use bun_core::SmolStr;
use smallvec::SmallVec;

// ═══════════════════════════════════════════════════════════════════════════
// Moved from `bun_shell` (src/shell/shell.zig):
//   StringEncoding, SrcAscii, SrcUnicode, ShellCharIter, CharIter, has_eq_sign
// These live here so `bun_shell` (higher tier) can depend on `shell_parser`
// without a back-edge. `bun_shell` re-exports these under its old paths.
// ═══════════════════════════════════════════════════════════════════════════

use bun_core::immutable::CodePoint; // i32
use bun_core::immutable::{CodepointIterator, Cursor};
use bun_core::strings;

/// Zig: `pub const StringEncoding = enum { ascii, wtf8, utf16 };`
#[derive(Clone, Copy, PartialEq, Eq, core::marker::ConstParamTy)]
pub enum StringEncoding {
    Ascii,
    Wtf8,
    Utf16,
}

// ─── SrcAscii ──────────────────────────────────────────────────────────────

// Clone: bitwise OK — `bytes` borrows caller-owned input (BACKREF, non-owning).
#[derive(Clone)]
struct SrcAscii {
    bytes: *const [u8], // PORT NOTE: raw slice ptr — Zig held a borrowed `[]const u8`; lifetime erased (BACKREF).
    i: usize,
}

/// Zig: `packed struct(u8) { char: u7, escaped: bool = false }`.
// PERF(port): widened `char` to u32 so ascii/unicode share one `InputChar` shape and
// `ShellCharIter<const E>` needs no type-level branching on `E`. Phase B may split.
#[derive(Copy, Clone)]
pub struct InputChar {
    pub char: u32,
    pub escaped: bool,
}

#[derive(Copy, Clone)]
struct AsciiIndexValue {
    char: u32, // u7 in Zig
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
        // SAFETY: `bytes` outlives the iter by construction (caller contract, same as Zig).
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
    iter: CodepointIterator<'static>, // PORT NOTE: lifetime erased; see SrcAscii.bytes note.
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
        // SAFETY: erase lifetime — caller guarantees `bytes` outlives the iter (same as Zig).
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

// PERF(port): Zig selected `Src` at comptime via `switch (encoding)`. Rust const
// generics can't pick a field type from an enum value without an aux trait, so we
// store both arms in a small enum and branch at runtime. Phase B may split into
// three `impl CharIter for ShellCharIter<{StringEncoding::*}>` blocks if profiling
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
    // PERF(port): Zig used `u7` for ascii; unified to u32 (see InputChar note).
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
            // PORT NOTE: was `unreachable_unchecked()`; the lexer is on a
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

/// Zig: `pub fn hasEqSign(str: []const u8) ?u32`.
pub fn has_eq_sign(str_: &[u8]) -> Option<u32> {
    if strings::is_all_ascii(str_) {
        return bun_core::immutable::index_of_char(str_, b'=');
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
// PORT NOTE: Zig `packed struct(u32)` — two u16 fields packed into a u32.
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

#[derive(Default, Copy, Clone)]
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

// TODO(b2-blocked): bun_core::SmolStr — missing `Clone` impl. Zig copied the
// union by value (bitwise SmolStr copy with shared heap backing). Until the
// lower-tier crate provides `Clone`, deep-copy via `from_slice` so the parser
// can own its token. PERF(port): extra alloc on heap-backed SmolStr — profile
// in Phase B once SmolStr grows Clone.
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
            // TODO(b2-blocked): bun_core::SmolStr — see Clone for Token above.
            Token::Text(txt) => SmolStr::from_slice(txt.slice()).expect("OOM cloning SmolStr"),
            Token::Close => SmolStr::from_char(b'}'),
            Token::Eof => SmolStr::empty(),
        }
    }
}

// ─── JSON debug formatters ───────────────────────────────────────────────────
// Port of Zig's `std.json.fmt(tokens)` / `std.json.fmt(ast_node)` used by
// `Bun.$.braces(str, {tokenize:true})` / `{parse:true}` (debug-only). Zig's
// reflection-driven JSON encoder emits tagged unions as `{"<tag>": <payload>}`
// and bare-payload structs by field; reproduce that shape so the JS-visible
// output is byte-compatible.

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

pub fn ast_to_json(root: ast::Group) -> Vec<u8> {
    let mut out = Vec::new();
    ast_group_to_json(&root, &mut out);
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
        // Zig's std.json.fmt encodes `?*T` as the pointer address.
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
        // PORT NOTE: bump-owned slice; raw because Group has raw backrefs (see bubble_up).
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
        // PORT NOTE: bump-owned mutable slice; raw because expand_nested writes
        // bubble_up backrefs into elements while recursing through the parent.
        pub variants: *mut [Group],
    }
}

const MAX_NESTED_BRACES: usize = 10;

#[derive(thiserror::Error, strum::IntoStaticStr, Debug, Copy, Clone, PartialEq, Eq)]
pub enum ParserError {
    #[error("OutOfMemory")]
    OutOfMemory,
    #[error("UnexpectedToken")]
    UnexpectedToken,
}

bun_core::oom_from_alloc!(ParserError);

impl From<ParserError> for bun_core::Error {
    fn from(e: ParserError) -> Self {
        match e {
            ParserError::OutOfMemory => bun_core::err!("OutOfMemory"),
            ParserError::UnexpectedToken => bun_core::err!("UnexpectedToken"),
        }
    }
}

pub type ExpandError = ParserError;

/// `out` is preallocated by using the result from `calculateExpandedAmount`
pub fn expand(
    bump: &Bump,
    tokens: &mut [Token],
    out: &mut [Vec<u8>],
    contains_nested: bool,
) -> Result<(), ExpandError> {
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
// overlapping `&mut` borrows. Mirrors Zig pointer semantics 1:1.
// TODO(port): audit aliasing soundness in Phase B (no long-lived `&mut` is held
// across recursion, only raw derefs).
unsafe fn expand_nested(
    root: *mut ast::Group,
    out: &mut [Vec<u8>],
    out_key: u16,
    out_key_counter: &mut u16,
    start: u32,
) -> Result<(), ExpandError> {
    // SAFETY: see fn doc comment — raw-pointer derefs mirror Zig pointer semantics;
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
                    // PORT NOTE: reshaped for borrowck — snapshot prefix once; Zig re-sliced
                    // out[out_key].items[0..length] each iteration (same bytes).
                    // PERF(port): extra Vec alloc for prefix snapshot — profile in Phase B
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
                    // PORT NOTE: reshaped for borrowck — see above.
                    // PERF(port): extra Vec alloc for prefix snapshot — profile in Phase B
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
    for (_j, atom) in tokens[start..end].iter().enumerate() {
        match atom {
            Token::Text(txt) => {
                out[usize::from(out_key)].extend_from_slice(txt.slice());
            }
            Token::Close => {
                depth -= 1;
            }
            Token::Open(expansion_variants) => {
                depth += 1;
                if cfg!(debug_assertions) {
                    debug_assert!(expansion_variants.end - expansion_variants.idx >= 1);
                }

                let variants = &expansion_table
                    [usize::from(expansion_variants.idx)..usize::from(expansion_variants.end)];
                let skip_over_idx = variants[variants.len() - 1].end();

                let starting_len = out[usize::from(out_key)].len();
                // PORT NOTE: reshaped for borrowck — snapshot prefix once.
                // PERF(port): extra Vec alloc for prefix snapshot — profile in Phase B
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

#[allow(dead_code)]
fn calculate_variants_amount(tokens: &[Token]) -> u32 {
    let mut brace_count: u32 = 0;
    let mut count: u32 = 0;
    for tok in tokens {
        match tok {
            Token::Comma => count += 1,
            Token::Open(_) => brace_count += 1,
            Token::Close => {
                if brace_count == 1 {
                    count += 1;
                }
                brace_count -= 1;
            }
            _ => {}
        }
    }
    count
}

// FIXME error location
pub struct ParserErrorMsg {
    pub msg: Vec<u8>,
}

// PORT NOTE: lifetime on transient parser struct; `tokens`/`bump` borrowed from caller
// for the parse() call only — not an AST node.
pub struct Parser<'a> {
    current: usize,
    tokens: &'a [Token],
    bump: &'a Bump,
    errors: Vec<ParserErrorMsg>,
}

impl<'a> Parser<'a> {
    pub fn init(tokens: &'a [Token], bump: &'a Bump) -> Parser<'a> {
        Parser {
            current: 0,
            tokens,
            bump,
            errors: Vec::new(),
        }
    }

    pub fn parse(&mut self) -> Result<ast::Group, ParserError> {
        // PERF(port): was stack-fallback alloc (@sizeOf(AST.Atom)) — profile in Phase B
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
            if self.r#match(TokenTag::Eof) {
                break;
            }
            // PERF(port): was stack-fallback alloc (@sizeOf(AST.Atom)) — profile in Phase B
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

    #[allow(dead_code)]
    fn has_eq_sign(&self, str_: &[u8]) -> Option<u32> {
        has_eq_sign(str_)
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

    #[allow(dead_code)]
    fn expect(&mut self, toktag: TokenTag) -> Token {
        debug_assert!(toktag == self.peek().tag());
        if self.check(toktag) {
            return self.advance();
        }
        unreachable!()
    }

    /// Consumes token if it matches
    fn r#match(&mut self, toktag: TokenTag) -> bool {
        if self.peek().tag() == toktag {
            let _ = self.advance();
            return true;
        }
        false
    }

    #[allow(dead_code)]
    fn match_any2(&mut self, toktags: &[TokenTag]) -> Option<Token> {
        let peeked = self.peek().clone();
        // PERF(port): was `inline for` — profile in Phase B
        for &tag in toktags {
            if peeked.tag() == tag {
                let _ = self.advance();
                return Some(peeked);
            }
        }
        None
    }

    fn match_any(&mut self, toktags: &[TokenTag]) -> bool {
        let peeked = self.peek().tag();
        // PERF(port): was `inline for` — profile in Phase B
        for &tag in toktags {
            if peeked == tag {
                let _ = self.advance();
                return true;
            }
        }
        false
    }

    fn check(&self, toktag: TokenTag) -> bool {
        self.peek().tag() == toktag
    }

    fn peek(&self) -> &Token {
        &self.tokens[self.current]
    }

    #[allow(dead_code)]
    fn peek_n(&self, n: u32) -> &Token {
        if self.current + n as usize >= self.tokens.len() {
            return &self.tokens[self.tokens.len() - 1];
        }
        &self.tokens[self.current + n as usize]
    }

    fn prev(&self) -> Token {
        self.tokens[self.current - 1].clone()
    }

    #[allow(dead_code)]
    fn add_error(&mut self, args: core::fmt::Arguments<'_>) -> Result<(), ParserError> {
        use std::io::Write;
        let mut error_msg: Vec<u8> = Vec::new();
        write!(&mut error_msg, "{}", args).map_err(|_| ParserError::OutOfMemory)?;
        self.errors.push(ParserErrorMsg { msg: error_msg });
        Ok(())
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
    // PERF(port): was arena bulk-free — Zig fed the same allocator to Parser and this
    // table; table is local POD dropped at end of expand(), so global Vec is logic-neutral.
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

// TODO(port): `ShellCharIter<ENCODING>` associated items `CodepointType` / `InputChar`
// require either a trait or inherent associated types. Phase B: define a
// `CharIter` trait in `bun_shell` exposing `type Codepoint; type InputChar; fn eat; fn read_char;`.
type Chars<const E: Encoding> = ShellCharIter<E>;

pub struct LexerOutput {
    pub tokens: Vec<Token>,
    pub contains_nested: bool,
}

pub type BraceLexerError = AllocError;

pub struct NewLexer<const ENCODING: Encoding> {
    chars: Chars<ENCODING>,
    tokens: Vec<Token>,
    contains_nested: bool,
}

impl<const ENCODING: Encoding> NewLexer<ENCODING> {
    pub fn tokenize(src: &[u8]) -> Result<LexerOutput, BraceLexerError> {
        let mut this = Self {
            chars: Chars::<ENCODING>::init(src),
            tokens: Vec::new(),
            contains_nested: false,
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

        loop {
            let Some(input) = self.eat() else { break };
            let char = input.char;
            let escaped = input.escaped;

            if !escaped {
                // PORT NOTE: `char` is u32 (CodepointType unified across encodings).
                match char {
                    c if c == u32::from(b'{') => {
                        brace_stack.push(u32::try_from(self.tokens.len()).expect("int cast"));
                        self.tokens.push(Token::Open(ExpansionVariants::default()));
                        continue;
                    }
                    c if c == u32::from(b'}') => {
                        if brace_stack.len() > 0 {
                            let _ = brace_stack.pop();
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

        self.flatten_tokens()?;
        self.tokens.push(Token::Eof);

        Ok(self.contains_nested)
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
            // PORT NOTE: reshaped for borrowck — Zig held two `&mut` into self.tokens
            // simultaneously. We branch on tags first, then borrow once.
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

    // TODO(port): `char` parameter type is `Chars<ENCODING>::CodepointType` —
    // u8 for ascii, u32 for wtf8/wtf16. Phase B: thread the associated type.
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

    #[allow(dead_code)]
    fn read_char(&mut self) -> Option<<Chars<ENCODING> as CharIter>::InputChar> {
        self.chars.read_char()
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
            // TODO(port): Token needs PartialEq for this assertion (SmolStr: PartialEq).
            assert_eq!(result.tokens.len(), expected.len());
        }
    }
}

// ported from: src/shell_parser/braces.zig
