use core::cell::Cell;

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
//   StringEncoding, SrcAscii, SrcUnicode, ShellCharIter, CharIter
// These live here so `bun_shell` (higher tier) can depend on `shell_parser`
// without a back-edge. `bun_shell` re-exports these under its old paths.
// ═══════════════════════════════════════════════════════════════════════════

use bun_core::strings::{CodepointIterator, Cursor};

/// Encoding of the shell input bytes being expanded.
#[derive(Clone, Copy, PartialEq, Eq, core::marker::ConstParamTy)]
pub enum StringEncoding {
    Ascii,
    Wtf8,
}

// ─── SrcAscii ──────────────────────────────────────────────────────────────

#[derive(Copy, Clone)]
struct SrcAscii<'a> {
    bytes: &'a [u8],
    i: usize,
}

// PERF: `char` is u32 so ascii/unicode share one `InputChar` shape and
// `ShellCharIter<const E>` needs no type-level branching on `E`. Could split per
// encoding if profiling shows it matters.
#[derive(Copy, Clone)]
pub struct InputChar {
    pub(crate) char: u32,
    pub(crate) escaped: bool,
}

#[derive(Copy, Clone)]
struct AsciiIndexValue {
    char: u32,
}

impl<'a> SrcAscii<'a> {
    #[inline]
    fn init(bytes: &'a [u8]) -> Self {
        Self { bytes, i: 0 }
    }
    #[inline]
    fn index(&self) -> Option<AsciiIndexValue> {
        let b = self.bytes;
        if self.i >= b.len() {
            return None;
        }
        Some(AsciiIndexValue {
            char: u32::from(b[self.i]),
        })
    }
    #[inline]
    fn index_next(&self) -> Option<AsciiIndexValue> {
        let b = self.bytes;
        if self.i + 1 >= b.len() {
            return None;
        }
        Some(AsciiIndexValue {
            char: u32::from(b[self.i + 1]),
        })
    }
    #[inline]
    fn eat(&mut self, escaped: bool) {
        self.i += 1 + escaped as usize;
    }
}

// ─── SrcUnicode ────────────────────────────────────────────────────────────

struct SrcUnicode<'a> {
    iter: CodepointIterator<'a>,
    cursor: Cursor,
    next_cursor: Cursor,
}

#[derive(Copy, Clone)]
struct UnicodeIndexValue {
    char: u32,
}

impl<'a> SrcUnicode<'a> {
    #[inline]
    fn next_cursor(iter: &CodepointIterator<'a>, cursor: &mut Cursor) {
        if !CodepointIterator::next(iter, cursor) {
            // This will make `i > sourceBytes.len` so the condition in `index` will fail
            cursor.i = u32::try_from(iter.bytes.len() + 1).unwrap();
            cursor.width = 1;
            cursor.c = CodepointIterator::ZERO_VALUE;
        }
    }
    fn init(bytes: &'a [u8]) -> Self {
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
        })
    }
    #[inline]
    fn index_next(&self) -> Option<UnicodeIndexValue> {
        if self.next_cursor.width as usize + self.next_cursor.i as usize > self.iter.bytes.len() {
            return None;
        }
        Some(UnicodeIndexValue {
            char: self.next_cursor.c as u32,
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

// PERF: Rust const
// generics can't pick a field type from an enum value without an aux trait, so we
// store both arms in a small enum and branch at runtime. Could split into three
// `impl CharIter for ShellCharIter<{StringEncoding::*}>` blocks if profiling
// shows the branch matters.
enum ShellSrc<'a> {
    Ascii(SrcAscii<'a>),
    Unicode(SrcUnicode<'a>),
}

pub struct ShellCharIter<'a, const E: StringEncoding> {
    src: ShellSrc<'a>,
}

/// Surface trait so callers can name `<ShellCharIter<E> as CharIter>::InputChar` /
/// `::CodepointType` without inherent associated types.
trait CharIter<'a>: Sized {
    type CodepointType: Copy;
    type InputChar: Copy;
    fn init(bytes: &'a [u8]) -> Self;
    fn eat(&mut self) -> Option<Self::InputChar>;
    fn read_char(&mut self) -> Option<Self::InputChar>;
}

impl<'a, const E: StringEncoding> CharIter<'a> for ShellCharIter<'a, E> {
    // PERF: unified to u32 for ascii and unicode (see InputChar note).
    type CodepointType = u32;
    type InputChar = InputChar;

    fn init(bytes: &'a [u8]) -> Self {
        let src = if E == StringEncoding::Ascii {
            ShellSrc::Ascii(SrcAscii::init(bytes))
        } else {
            ShellSrc::Unicode(SrcUnicode::init(bytes))
        };
        Self { src }
    }

    fn eat(&mut self) -> Option<InputChar> {
        if let Some(result) = self.read_char() {
            match &mut self.src {
                ShellSrc::Ascii(a) => a.eat(result.escaped),
                ShellSrc::Unicode(u) => u.eat(result.escaped),
            }
            return Some(result);
        }
        None
    }

    fn read_char(&mut self) -> Option<InputChar> {
        let mut ch = match &self.src {
            ShellSrc::Ascii(a) => a.index()?.char,
            ShellSrc::Unicode(u) => u.index()?.char,
        };
        if ch != u32::from(b'\\') {
            return Some(InputChar {
                char: ch,
                escaped: false,
            });
        }

        // Handle backslash
        ch = match &self.src {
            ShellSrc::Ascii(a) => a.index_next()?.char,
            ShellSrc::Unicode(u) => u.index_next()?.char,
        };

        Some(InputChar {
            char: ch,
            escaped: true,
        })
    }
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
    pub(crate) idx: u16,
    pub(crate) end: u16,
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
    pub(crate) fn to_text(&self) -> SmolStr {
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

pub fn ast_to_json(root: &ast::Group<'_>) -> Vec<u8> {
    let mut out = Vec::new();
    ast_group_to_json(root, &mut out);
    out
}

fn ast_atom_to_json(atom: &ast::Atom<'_>, out: &mut Vec<u8>) {
    match atom {
        ast::Atom::Text(txt) => {
            out.extend_from_slice(b"{\"text\":");
            json_escape_into(out, txt.slice());
            out.push(b'}');
        }
        ast::Atom::Expansion(exp) => {
            out.extend_from_slice(b"{\"expansion\":{\"variants\":[");
            for (i, g) in exp.variants.iter().enumerate() {
                if i > 0 {
                    out.push(b',');
                }
                ast_group_to_json(g, out);
            }
            out.extend_from_slice(b"]}}");
        }
    }
}

fn ast_group_to_json(group: &ast::Group<'_>, out: &mut Vec<u8>) {
    use std::io::Write as _;
    out.extend_from_slice(b"{\"bubble_up\":");
    match group.bubble_up.get() {
        None => out.extend_from_slice(b"null"),
        Some(bubble_up) => {
            // Optional pointers are encoded as the pointer address.
            let _ = write!(out, "{}", std::ptr::from_ref(bubble_up) as usize);
        }
    }
    out.extend_from_slice(b",\"bubble_up_next\":");
    match group.bubble_up_next.get() {
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

    pub enum Atom<'a> {
        Text(SmolStr),
        Expansion(Expansion<'a>),
    }

    pub enum GroupAtoms<'a> {
        Single(Atom<'a>),
        // bump-owned slice
        Many(&'a [Atom<'a>]),
    }

    pub struct Group<'a> {
        /// BACKREF: child points back to owning parent Group (LIFETIMES.tsv).
        pub(crate) bubble_up: Cell<Option<&'a Group<'a>>>,
        pub(crate) bubble_up_next: Cell<Option<u16>>,
        pub(crate) atoms: GroupAtoms<'a>,
    }

    pub struct Expansion<'a> {
        // bump-owned slice; expand_nested writes the `bubble_up` cells of its
        // elements while recursing through the parent.
        pub(crate) variants: &'a [Group<'a>],
    }
}

const MAX_NESTED_BRACES: usize = 10;

const MAX_BRACE_GROUPS: usize = 256;

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
    let mut out_key_counter: usize = 1;
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
    let root_node = parser.parse()?;
    expand_nested(&root_node, out, 0, &mut out_key_counter, 0)
}

fn expand_nested<'a>(
    root: &'a ast::Group<'a>,
    out: &mut [Vec<u8>],
    out_key: usize,
    out_key_counter: &mut usize,
    start: u32,
) -> Result<(), ExpandError> {
    if let ast::GroupAtoms::Single(_) = root.atoms {
        if start > 0 {
            if let Some(bubble_up) = root.bubble_up.get() {
                let next = root.bubble_up_next.get().unwrap();
                return expand_nested(bubble_up, out, out_key, out_key_counter, u32::from(next));
            }
            return Ok(());
        }

        match &root.atoms {
            ast::GroupAtoms::Single(ast::Atom::Text(txt)) => {
                out[out_key].extend_from_slice(txt.slice());
                if let Some(bubble_up) = root.bubble_up.get() {
                    let next = root.bubble_up_next.get().unwrap();
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
                let length = out[out_key].len();
                for (j, group) in expansion.variants.iter().enumerate() {
                    group.bubble_up.set(Some(root));
                    group.bubble_up_next.set(Some(1));
                    let new_key = if j == 0 {
                        out_key
                    } else {
                        let new_key = *out_key_counter;
                        // new_key > out_key always (counter is bumped past out_key before
                        // any recursion into it), and the j==0 recursion only appends to
                        // out[out_key], so its [..length] prefix is stable.
                        let (lo, hi) = out.split_at_mut(new_key);
                        hi[0].extend_from_slice(&lo[out_key][..length]);
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

    let many: &[ast::Atom<'a>] = match &root.atoms {
        ast::GroupAtoms::Many(m) => m,
        _ => unreachable!(),
    };
    let many_len = many.len();

    if start as usize >= many_len {
        if let Some(bubble_up) = root.bubble_up.get() {
            let next = root.bubble_up_next.get().unwrap();
            return expand_nested(bubble_up, out, out_key, out_key_counter, u32::from(next));
        }
        return Ok(());
    }

    for i_ in (start as usize)..many_len {
        let i: u16 = u16::try_from(i_).expect("int cast");
        let atom: &ast::Atom<'a> = &many[i_];
        match atom {
            ast::Atom::Text(txt) => {
                out[out_key].extend_from_slice(txt.slice());
            }
            ast::Atom::Expansion(expansion) => {
                let length = out[out_key].len();
                for (j, group) in expansion.variants.iter().enumerate() {
                    group.bubble_up.set(Some(root));
                    group.bubble_up_next.set(Some(i + 1));
                    let new_key = if j == 0 {
                        out_key
                    } else {
                        let new_key = *out_key_counter;
                        let (lo, hi) = out.split_at_mut(new_key);
                        hi[0].extend_from_slice(&lo[out_key][..length]);
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
    if let Some(bubble_up) = root.bubble_up.get() {
        let next = root.bubble_up_next.get().unwrap();
        return expand_nested(bubble_up, out, out_key, out_key_counter, u32::from(next));
    }
    Ok(())
}

/// This function is fast but does not work for nested brace expansions
/// TODO optimization: allocate into one buffer of chars
fn expand_flat(
    tokens: &[Token],
    expansion_table: &[ExpansionVariant],
    out: &mut [Vec<u8>],
    out_key: usize,
    out_key_counter: &mut usize,
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
                out[out_key].extend_from_slice(txt.slice());
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

                let starting_len = out[out_key].len();
                for (i, variant) in variants.iter().enumerate() {
                    let new_key = if i == 0 {
                        out_key
                    } else {
                        let new_key = *out_key_counter;
                        // new_key > out_key always; the i==0 recursion only appends to
                        // out[out_key], so its [..starting_len] prefix is stable.
                        let (lo, hi) = out.split_at_mut(new_key);
                        hi[0].extend_from_slice(&lo[out_key][..starting_len]);
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
// `tokens`/`bump` borrowed from caller; the AST that parse() returns lives in `bump`.
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

    pub fn parse(&mut self) -> Result<ast::Group<'a>, ParserError> {
        check_brace_group_count(self.tokens)?;
        let mut nodes: BumpVec<'a, ast::Atom<'a>> = BumpVec::new_in(self.bump);
        while !self.r#match(TokenTag::Eof) {
            match self.parse_atom()? {
                Some(atom) => nodes.push(atom),
                None => break,
            }
        }

        if nodes.len() == 1 {
            let single = nodes.into_iter().next().unwrap();
            Ok(ast::Group {
                bubble_up: Cell::new(None),
                bubble_up_next: Cell::new(None),
                atoms: ast::GroupAtoms::Single(single),
            })
        } else {
            let many = nodes.into_bump_slice();
            Ok(ast::Group {
                bubble_up: Cell::new(None),
                bubble_up_next: Cell::new(None),
                atoms: ast::GroupAtoms::Many(many),
            })
        }
    }

    fn parse_atom(&mut self) -> Result<Option<ast::Atom<'a>>, ParserError> {
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

    fn parse_expansion(&mut self) -> Result<ast::Expansion<'a>, ParserError> {
        let mut variants: BumpVec<'a, ast::Group<'a>> = BumpVec::new_in(self.bump);
        loop {
            let mut group: BumpVec<'a, ast::Atom<'a>> = BumpVec::new_in(self.bump);
            // Only this inner loop consumes Close/Eof so a trailing empty
            // variant (`{a,}`) is pushed before the outer loop exits.
            let close = loop {
                if self.match_any(&[TokenTag::Close, TokenTag::Eof]) {
                    break true;
                }
                if self.r#match(TokenTag::Comma) {
                    break false;
                }
                match self.parse_atom()? {
                    Some(a) => group.push(a),
                    None => break true,
                }
            };
            if group.len() == 1 {
                let single = group.into_iter().next().unwrap();
                variants.push(ast::Group {
                    bubble_up: Cell::new(None),
                    bubble_up_next: Cell::new(None),
                    atoms: ast::GroupAtoms::Single(single),
                });
            } else {
                let many = group.into_bump_slice();
                variants.push(ast::Group {
                    bubble_up: Cell::new(None),
                    bubble_up_next: Cell::new(None),
                    atoms: ast::GroupAtoms::Many(many),
                });
            }
            if close {
                break;
            }
        }

        Ok(ast::Expansion {
            variants: variants.into_bump_slice(),
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
        prev_tok_end: u16,
    }
    let mut brace_stack: SmallVec<[BraceState; MAX_NESTED_BRACES]> = SmallVec::new();

    if tokens.len() > u16::MAX as usize {
        return Err(ParserError::UnexpectedToken);
    }

    let mut i: u16 = 0;
    while (i as usize) < tokens.len() {
        match &mut tokens[i as usize] {
            Token::Open(open) => {
                let table_idx: u16 = u16::try_from(table.len()).expect("int cast");
                open.idx = table_idx;
                brace_stack.push(BraceState {
                    tok_idx: i,
                    prev_tok_end: i,
                });
            }
            Token::Close => {
                let top = brace_stack.pop().unwrap();

                table.push(ExpansionVariant::new(top.prev_tok_end + 1, i));

                if let Token::Open(open) = &mut tokens[top.tok_idx as usize] {
                    open.end = u16::try_from(table.len()).expect("int cast");
                }
            }
            Token::Comma => {
                let top = brace_stack.last_mut().unwrap();

                table.push(ExpansionVariant::new(top.prev_tok_end + 1, i));

                top.prev_tok_end = i;
            }
            _ => {}
        }
        i += 1;
    }

    if cfg!(debug_assertions) {
        for variant in table.iter() {
            debug_assert!(variant.start() != 0 && variant.end() != 0);
        }
    }
    Ok(())
}

pub type Lexer<'a> = NewLexer<'a, { Encoding::Ascii }>;

type Chars<'a, const E: Encoding> = ShellCharIter<'a, E>;

pub struct LexerOutput {
    pub tokens: Vec<Token>,
    pub contains_nested: bool,
}

pub(crate) type BraceLexerError = AllocError;

pub struct NewLexer<'a, const ENCODING: Encoding> {
    chars: Chars<'a, ENCODING>,
    tokens: Vec<Token>,
    contains_nested: bool,
}

impl<'a, const ENCODING: Encoding> NewLexer<'a, ENCODING> {
    pub fn tokenize(src: &'a [u8]) -> Result<LexerOutput, BraceLexerError> {
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
        #[derive(Copy, Clone)]
        struct OpenBrace {
            tok_idx: u32,
            has_comma: bool,
        }
        let mut brace_stack: SmallVec<[OpenBrace; MAX_NESTED_BRACES]> = SmallVec::new();

        loop {
            let Some(input) = self.eat() else { break };
            let char = input.char;
            let escaped = input.escaped;

            if !escaped {
                // `char` is u32 (CodepointType unified across encodings).
                match char {
                    c if c == u32::from(b'{') => {
                        brace_stack.push(OpenBrace {
                            tok_idx: u32::try_from(self.tokens.len()).expect("int cast"),
                            has_comma: false,
                        });
                        self.tokens.push(Token::Open(ExpansionVariants::default()));
                        continue;
                    }
                    c if c == u32::from(b'}') => {
                        if let Some(top) = brace_stack.pop() {
                            if top.has_comma {
                                self.tokens.push(Token::Close);
                            } else {
                                // A `{...}` group with no top-level comma is not a
                                // brace expansion (bash semantics): demote the Open
                                // back to a literal `{` and emit this `}` as text.
                                self.replace_token_with_string(top.tok_idx);
                                self.tokens.push(Token::Text(SmolStr::from_char(b'}')));
                            }
                            continue;
                        }
                    }
                    c if c == u32::from(b',') => {
                        if let Some(top) = brace_stack.last_mut() {
                            top.has_comma = true;
                            self.tokens.push(Token::Comma);
                            continue;
                        }
                    }
                    _ => {}
                }
            }

            self.append_char(char)?;
        }

        // Unclosed braces
        while let Some(top) = brace_stack.pop() {
            self.rollback_braces(top.tok_idx);
        }

        self.flatten_tokens()?;
        self.tokens.push(Token::Eof);

        Ok(self.contains_nested)
    }

    fn flatten_tokens(&mut self) -> Result<(), AllocError> {
        let mut brace_count: u32 = 0;
        let mut write = 0usize;
        for read in 0..self.tokens.len() {
            match &self.tokens[read] {
                Token::Open(_) => {
                    brace_count += 1;
                    if brace_count > 1 {
                        self.contains_nested = true;
                    }
                }
                Token::Close => brace_count -= 1,
                _ => {}
            }
            if write > 0
                && matches!(self.tokens[write - 1], Token::Text(_))
                && matches!(self.tokens[read], Token::Text(_))
            {
                let taken = core::mem::replace(&mut self.tokens[read], Token::Eof);
                if let (Token::Text(prev), Token::Text(cur)) = (&mut self.tokens[write - 1], taken)
                {
                    prev.append_slice(cur.slice())?;
                }
            } else {
                self.tokens.swap(write, read);
                write += 1;
            }
        }
        self.tokens.truncate(write);
        Ok(())
    }

    fn rollback_braces(&mut self, starting_idx: u32) {
        if cfg!(debug_assertions) {
            let first = &self.tokens[starting_idx as usize];
            debug_assert!(matches!(first, Token::Open(_)));
        }

        let mut braces: u32 = 0;

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
        char: <Chars<'a, ENCODING> as CharIter<'a>>::CodepointType,
    ) -> Result<(), AllocError> {
        if !self.tokens.is_empty() {
            let last_idx = self.tokens.len() - 1;
            if let Token::Text(last) = &mut self.tokens[last_idx] {
                if ENCODING == Encoding::Ascii {
                    // SAFETY: ascii codepoint is u8
                    last.append_slice(&[char as u8])?;
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

    fn eat(&mut self) -> Option<<Chars<'a, ENCODING> as CharIter<'a>>::InputChar> {
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
            // No comma: the whole group is literal text.
            TestCase(
                b"{}",
                vec![Token::Text(SmolStr::from_slice(b"{}").unwrap()), Token::Eof],
            ),
            TestCase(
                b"{foo}",
                vec![
                    Token::Text(SmolStr::from_slice(b"{foo}").unwrap()),
                    Token::Eof,
                ],
            ),
            // With a comma: a real brace group.
            TestCase(
                b"{a,b}",
                vec![
                    Token::Open(ExpansionVariants::default()),
                    Token::Text(SmolStr::from_slice(b"a").unwrap()),
                    Token::Comma,
                    Token::Text(SmolStr::from_slice(b"b").unwrap()),
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
}
