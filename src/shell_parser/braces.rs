use core::ptr;

use bun_alloc::{AllocError, Arena as Bump};
use bun_collections::SmallList;
// TODO(b0): CharIter, ShellCharIter, has_eq_sign, StringEncoding arrive from move-in (MOVE_DOWN/TYPE_ONLY bun_shell → shell_parser)
use crate::{has_eq_sign as shell_has_eq_sign, CharIter, ShellCharIter, StringEncoding as Encoding};
use bun_str::{strings, SmolStr};
use bumpalo::collections::Vec as BumpVec;

bun_output::declare_scope!(BRACES, visible);

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

// TODO(port): Token Clone semantics — verify `SmolStr: Clone` is a cheap bitwise/refcount copy
// (Zig copied the union by value).
#[derive(Clone)]
pub enum Token {
    Open(ExpansionVariants),
    Comma,
    Text(SmolStr),
    Close,
    Eof,
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
    #[inline]
    pub fn tag(&self) -> TokenTag {
        match self {
            Token::Open(_) => TokenTag::Open,
            Token::Comma => TokenTag::Comma,
            Token::Text(_) => TokenTag::Text,
            Token::Close => TokenTag::Close,
            Token::Eof => TokenTag::Eof,
        }
    }

    pub fn to_text(&self) -> SmolStr {
        match self {
            Token::Open(_) => SmolStr::from_char(b'{'),
            Token::Comma => SmolStr::from_char(b','),
            Token::Text(txt) => txt.clone(),
            Token::Close => SmolStr::from_char(b'}'),
            Token::Eof => SmolStr::empty(),
        }
    }
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

impl From<AllocError> for ParserError {
    fn from(_: AllocError) -> Self {
        ParserError::OutOfMemory
    }
}

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
    unsafe { expand_nested(&mut root_node as *mut ast::Group, out, 0, &mut out_key_counter, 0) }
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
    if let ast::GroupAtoms::Single(_) = (*root).atoms {
        if start > 0 {
            if !(*root).bubble_up.is_null() {
                let bubble_up = (*root).bubble_up;
                let next = (*root).bubble_up_next.unwrap();
                return expand_nested(bubble_up, out, out_key, out_key_counter, u32::from(next));
            }
            return Ok(());
        }

        match &(*root).atoms {
            ast::GroupAtoms::Single(ast::Atom::Text(txt)) => {
                out[usize::from(out_key)].extend_from_slice(txt.slice());
                if !(*root).bubble_up.is_null() {
                    let bubble_up = (*root).bubble_up;
                    let next = (*root).bubble_up_next.unwrap();
                    return expand_nested(bubble_up, out, out_key, out_key_counter, u32::from(next));
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
                let variants_len = (*variants).len();
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
    let many_len = (*many).len();

    if start as usize >= many_len {
        if !(*root).bubble_up.is_null() {
            let bubble_up = (*root).bubble_up;
            let next = (*root).bubble_up_next.unwrap();
            return expand_nested(bubble_up, out, out_key, out_key_counter, u32::from(next));
        }
        return Ok(());
    }

    for i_ in (start as usize)..many_len {
        let i: u16 = u16::try_from(i_).unwrap();
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
                let variants_len = (*variants).len();
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
    bun_output::scoped_log!(BRACES, "expandFlat [{}, {}]", start, end);
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

                let variants =
                    &expansion_table[usize::from(expansion_variants.idx)..usize::from(expansion_variants.end)];
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
            let many = nodes.into_bump_slice_mut() as *mut [ast::Atom];
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
                let many = group.into_bump_slice_mut() as *mut [ast::Atom];
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
            variants: variants.into_bump_slice_mut() as *mut [ast::Group],
        })
    }

    #[allow(dead_code)]
    fn has_eq_sign(&self, str_: &[u8]) -> Option<u32> {
        shell_has_eq_sign(str_)
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
            Self { segment_product: 1, accumulator: 0 }
        }
    }
    let mut nested_brace_stack: SmallList<StackEntry, MAX_NESTED_BRACES> = SmallList::default();
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
    let mut brace_stack: SmallList<BraceState, MAX_NESTED_BRACES> = SmallList::default();

    let mut i: u16 = 0;
    let mut prev_close = false;
    while (i as usize) < tokens.len() {
        match &mut tokens[i as usize] {
            Token::Open(open) => {
                let table_idx: u16 = u16::try_from(table.len()).unwrap();
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
                    open.end = u16::try_from(table.len()).unwrap();
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
        let mut brace_stack: SmallList<u32, MAX_NESTED_BRACES> = SmallList::default();

        loop {
            let Some(input) = self.eat() else { break };
            let char = input.char;
            let escaped = input.escaped;

            if !escaped {
                // TODO(port): `char`'s type is `Chars<ENCODING>::CodepointType` (u8 for ascii,
                // u32 for wtf8/wtf16). Comparison against ASCII bytes assumes it widens.
                match char.into() {
                    b'{' => {
                        brace_stack.push(u32::try_from(self.tokens.len()).unwrap());
                        self.tokens.push(Token::Open(ExpansionVariants::default()));
                        continue;
                    }
                    b'}' => {
                        if brace_stack.len() > 0 {
                            let _ = brace_stack.pop();
                            self.tokens.push(Token::Close);
                            continue;
                        }
                    }
                    b',' => {
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
        let mut brace_count: u32 = if matches!(self.tokens[0], Token::Open(_)) { 1 } else { 0 };
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
                let len = strings::encode_wtf8_rune(
                    &mut buf,
                    // SAFETY: CodepointType for non-ascii encodings is u32; same-size bitcast to i32.
                    unsafe { core::mem::transmute::<_, i32>(char) },
                );
                last.append_slice(&buf[..len])?;
                return Ok(());
            }
        }

        if ENCODING == Encoding::Ascii {
            self.tokens.push(Token::Text(SmolStr::from_slice(&[char as u8])?));
        } else {
            let mut buf = [0u8; 4];
            let len = strings::encode_wtf8_rune(
                &mut buf,
                // SAFETY: see above.
                unsafe { core::mem::transmute::<_, i32>(char) },
            );
            self.tokens.push(Token::Text(SmolStr::from_slice(&buf[..len])?));
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
                vec![Token::Open(ExpansionVariants::default()), Token::Close, Token::Eof],
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/shell_parser/braces.zig (740 lines)
//   confidence: medium
//   todos:      6
//   notes:      AST uses raw *mut slices + BACKREF (LIFETIMES.tsv); expand_nested is unsafe-heavy by design. ShellCharIter associated types (CodepointType/InputChar) need a trait in bun_shell. Borrowck reshaping snapshots prefix Vecs in expand_* loops.
// ──────────────────────────────────────────────────────────────────────────
