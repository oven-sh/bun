//! Tokens. Anything unusual is a [`T::Unknown`], which no rule of the parser accepts.

use crate::js::utils::number::format_trimmed_number;
use bun_core::strings;
use bun_highway::ScannerStops;

macro_rules! tokens {
    ($($plain:ident)* ; $($word:ident $text:literal)*) => {
        #[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Debug)]
        #[repr(u8)]
        pub(super) enum T {
            $($plain,)*
            $($word,)*
        }
        const WORDS: &[(&[u8], T)] = &[$(($text, T::$word),)*];
    };
}

tokens! {
    Unknown Eof
    OpenBrace CloseBrace OpenParen CloseParen OpenBracket CloseBracket
    Dot DotDotDot Semicolon Comma Question QuestionDot Colon Arrow At
    Bang Tilde PlusPlus MinusMinus
    Eq PlusEq MinusEq StarEq StarStarEq SlashEq PercentEq ShlEq ShrEq UShrEq AmpEq BarEq CaretEq AmpAmpEq BarBarEq
    QuestionQuestionEq
    QuestionQuestion BarBar AmpAmp Bar Caret Amp EqEq BangEq EqEqEq BangEqEq Lt Gt LtEq GtEq Shl Shr UShr Plus Minus
    Star Slash Percent StarStar
    Num BigInt Str Regex Template TemplateHead PrivateName JsxText
    Ident ;
    Abstract b"abstract" Accessor b"accessor" Any b"any" As b"as" Asserts b"asserts" Async b"async"
    Bigint b"bigint" Boolean b"boolean" Component b"component" Constructor b"constructor" Declare b"declare"
    Eval b"eval" From b"from" Get b"get" Global b"global" Hook b"hook" Infer b"infer" Intrinsic b"intrinsic" Is b"is"
    Keyof b"keyof" Module b"module" Namespace b"namespace" Never b"never" Number b"number" Object b"object" Of b"of"
    Out b"out" Override b"override" Readonly b"readonly" Require b"require" Satisfies b"satisfies" Set b"set"
    String b"string" Symbol b"symbol" Type b"type" Undefined b"undefined" Unique b"unique" UnknownWord b"unknown"
    Using b"using"
    Arguments b"arguments" Await b"await" Implements b"implements" Interface b"interface" Let b"let"
    Package b"package" Private b"private" Protected b"protected" Public b"public" Static b"static" Yield b"yield"
    Break b"break" Case b"case" Catch b"catch" Class b"class" Const b"const" Continue b"continue"
    Debugger b"debugger" Default b"default" Delete b"delete" Do b"do" Else b"else" Enum b"enum" Export b"export"
    Extends b"extends" False b"false" Finally b"finally" For b"for" Function b"function" If b"if" Import b"import"
    In b"in" Instanceof b"instanceof" New b"new" Null b"null" Return b"return" Super b"super" Switch b"switch"
    This b"this" Throw b"throw" True b"true" Try b"try" Typeof b"typeof" Var b"var" Void b"void" While b"while"
    With b"with"
}

impl T {
    /// Can follow a `.` or be the key of a property.
    #[inline]
    pub(super) fn is_word(self) -> bool {
        self >= T::Ident
    }

    /// Can be the name of a variable anywhere.
    #[inline]
    pub(super) fn is_identifier(self) -> bool {
        T::Ident <= self && self <= T::Using
    }

    /// No expression continues with it.
    #[inline]
    pub(super) fn ends_expression(self) -> bool {
        matches!(
            self,
            T::CloseBrace | T::CloseParen | T::CloseBracket | T::Semicolon | T::Comma | T::Colon
        )
    }

    #[inline]
    pub(super) fn is_assignment(self) -> bool {
        T::Eq <= self && self <= T::QuestionQuestionEq
    }
}

/// The first 8 bytes of `word`
const fn key_of(word: &[u8]) -> u64 {
    let (mut key, mut i) = (0, 0);
    while i < word.len() && i < 8 {
        key |= (word[i] as u64) << (8 * i);
        i += 1;
    }
    key
}

/// A perfect hash
const fn slot(key: u64) -> usize {
    (key.wrapping_mul(0xc134_5b8a_e613_06ed) >> 56) as usize
}

const KEYS: [u64; 256] = {
    let mut table = [u64::MAX; 256];
    let mut i = 0;
    while i < WORDS.len() {
        let key = key_of(WORDS[i].0);
        assert!(table[slot(key)] == u64::MAX);
        table[slot(key)] = key;
        i += 1;
    }
    table
};

const WORD_TOKENS: [T; 256] = {
    let mut table = [T::Unknown; 256];
    let mut i = 0;
    while i < WORDS.len() {
        table[slot(key_of(WORDS[i].0))] = WORDS[i].1;
        i += 1;
    }
    table
};

const FIRST_BYTES: [u64; 65] = {
    let mut table = [u64::MAX; 65];
    let mut i = 0;
    while i < 8 {
        table[i] = (1 << (8 * i)) - 1;
        i += 1;
    }
    table
};

/// `word` starts with the same 8 bytes as the keyword `token`.
#[cold]
fn long_word(word: &[u8], token: T) -> T {
    match WORDS.get((token as usize).wrapping_sub(T::Ident as usize + 1)) {
        Some(&(keyword, _)) if keyword == word => token,
        _ => T::Ident,
    }
}

/// The token that a byte is or starts, unless [`NEEDS_LOOK`] says otherwise.
const TOKEN_OF_BYTE: [T; 256] = {
    let mut table = [T::Unknown; 256];
    let mut i = 0;
    while i < 128 {
        table[i] = match i as u8 {
            b'a'..=b'z' | b'A'..=b'Z' | b'_' | b'$' => T::Ident,
            b'(' => T::OpenParen,
            b')' => T::CloseParen,
            b'{' => T::OpenBrace,
            b'}' => T::CloseBrace,
            b'[' => T::OpenBracket,
            b']' => T::CloseBracket,
            b',' => T::Comma,
            b';' => T::Semicolon,
            b':' => T::Colon,
            b'>' => T::Gt,
            b'.' => T::Dot,
            b'~' => T::Tilde,
            b'@' => T::At,
            b'=' => T::Eq,
            b'!' => T::Bang,
            b'?' => T::Question,
            b'&' => T::Amp,
            b'|' => T::Bar,
            b'<' => T::Lt,
            b'+' => T::Plus,
            b'-' => T::Minus,
            b'*' => T::Star,
            b'%' => T::Percent,
            b'^' => T::Caret,
            _ => T::Unknown,
        };
        i += 1;
    }
    table
};

const ALWAYS: u8 = 1;
const OPERATOR: u8 = 2;
const DOT: u8 = 4;
const CLOSING: u8 = 8;

/// `[first, second]`: a token needs a closer look if the entries for its first byte and the one after it have a bit in
/// common.
const NEEDS_LOOK: [[u8; 256]; 2] = {
    let mut table = [[0; 256]; 2];
    let mut i = 0;
    while i < 256 {
        table[0][i] = match (i as u8, TOKEN_OF_BYTE[i]) {
            (_, T::Unknown) => ALWAYS,
            (b'=' | b'!' | b'?' | b'&' | b'|' | b'<' | b'+' | b'-' | b'*' | b'%' | b'^', _) => {
                OPERATOR
            }
            (b'.', _) => DOT,
            (b'}' | b'>', _) => CLOSING,
            _ => 0,
        };
        table[1][i] = ALWAYS
            | match i as u8 {
                b'=' | b'>' | b'?' | b'&' | b'|' | b'<' | b'!' | b'+' | b'-' | b'*' => OPERATOR,
                b'.' => OPERATOR | DOT,
                b'0'..=b'9' => DOT,
                _ => 0,
            };
        i += 1;
    }
    table
};

/// More whitespace may hide a line break.
const UNCLEAR_GAP: u8 = 64;

/// `[first, second]`: the bits that the entries for the two bytes after a token have in common are traits of the next
/// token.
const GAP_AFTER: [[u8; 256]; 2] = {
    let mut table = [[0; 256], [!UNCLEAR_GAP; 256]];
    table[0][b'\n' as usize] = NEWLINE_BEFORE | OTHER_GAP;
    table[0][b' ' as usize] = SPACE | UNCLEAR_GAP;
    table[0][b'\t' as usize] = UNCLEAR_GAP << 1;
    table[1][b'\n' as usize] = !SPACE;
    table[1][b' ' as usize] = !SPACE;
    table[1][b'\t' as usize] = !SPACE;
    table
};

const IS_NAME_PART: [bool; 256] = {
    let mut table = [false; 256];
    let mut i = 0;
    while i < 128 {
        let c = i as u8;
        table[i] = c.is_ascii_alphanumeric() || c == b'_' || c == b'$';
        i += 1;
    }
    table
};

#[inline]
pub(super) fn is_name_part(c: u8) -> bool {
    IS_NAME_PART[c as usize]
}

/// True if the word at `start` isn't a keyword of any kind, or is `this`.
pub(super) fn is_plain_name_at(src: &[u8], start: usize) -> bool {
    let rest = src.get(start..).unwrap_or_default();
    let len = rest.iter().take_while(|&&c| is_name_part(c)).count();
    let word = rest.get(..len).unwrap_or_default();
    let key = key_of(word);
    KEYS[slot(key)] != key || matches!(long_word(word, WORD_TOKENS[slot(key)]), T::Ident | T::This)
}

#[derive(Copy, Clone, Debug)]
pub(super) struct Comment {
    pub(super) start: u32,
    pub(super) end: u32,
    pub(super) is_line: bool,
    /// Only whitespace is before it on its line.
    pub(super) is_first_on_line: bool,
}

pub(super) mod trait_of {
    /// One space is between it and the previous token.
    pub(in super::super) const SPACE: u8 = 1;
    /// Something else is.
    pub(in super::super) const OTHER_GAP: u8 = 2;
    pub(in super::super) const GAP: u8 = SPACE | OTHER_GAP;
    pub(in super::super) const NEWLINE_BEFORE: u8 = 4;
    pub(in super::super) const COMMENT_BEFORE: u8 = 8;
    pub(in super::super) const MULTILINE: u8 = 16;
    /// A string with a backslash, or a template with an escape that only a tag allows.
    pub(in super::super) const ESCAPE: u8 = 32;
    /// It has a character that isn't one column wide, or it's a number that isn't just digits.
    pub(in super::super) const UNUSUAL: u8 = 64;
}

/// What's printed between two tokens that are on the same line.
#[derive(Copy, Clone, PartialEq, Eq)]
#[repr(u8)]
pub(super) enum Gap {
    None = 0,
    Space = SPACE,
    /// It's up to the other token.
    Open = GAP + 1,
}
use trait_of::*;

#[derive(Copy, Clone)]
pub(super) struct Token {
    start: u32,
    end: u32,
    token: T,
    traits: u8,
}

impl Token {
    const NONE: Token = Token {
        start: 0,
        end: 0,
        token: T::Unknown,
        traits: 0,
    };
}

/// One bit for each of 64 bytes
#[derive(Copy, Clone)]
struct Block {
    /// A token or comment can start here.
    starts: u64,
    is_not_name: u64,
}

/// What a parser that goes back has to restore.
#[derive(Copy, Clone)]
pub(super) struct Position {
    pub(super) token: T,
    pub(super) traits: u8,
    pub(super) start: u32,
    pub(super) end: u32,
    pub(super) prev_end: u32,
    /// There's no line break between this offset and `prev_end`, and it's after the start of a token before one.
    pub(super) prev_line: u32,
    /// The same for comments.
    pub(super) prev_comment: u32,
    /// The same for what may not be printed as it is. See [`super::tree::flag::ODD`].
    pub(super) prev_odd: u32,
    /// What the previous token is followed by.
    gap: Gap,
    /// The index of the next token.
    next: u32,
}

#[derive(Default)]
pub(super) struct Buffers {
    tokens: Vec<Token>,
    blocks: Vec<Block>,
    line_feeds: Vec<u64>,
    comments: Vec<Comment>,
    wide_lines: Vec<(u32, u32)>,
    long_lines: Vec<(u32, u32)>,
}

const BATCH: usize = 64;
/// A token that starts in a block is looked at through this many bytes from the start of the block.
const WINDOW: usize = 64 + 64 + 8;

/// It works ahead of the parser. Where the tokens depend on the syntax, the parser has it go back.
pub(super) struct Lexer<'a> {
    pub(super) src: &'a [u8],
    stops: ScannerStops<'a>,
    pub(super) at: Position,
    tokens: Vec<Token>,
    /// The number of `tokens` that are in use.
    len: usize,
    blocks: Vec<Block>,
    line_feeds: Vec<u64>,
    pub(super) comments: Vec<Comment>,
    /// Start and end of each line that may be wider than the limit, last to first.
    wide_lines: Vec<(u32, u32)>,
    /// See [`Lexer::find_long_lines`].
    pub(super) long_lines: Vec<(u32, u32)>,
    /// Text can follow a `}` or `>` unless it's 0.
    pub(super) markup_depth: u32,
    /// The tokens from this index on depend on a decision of the parser.
    last_rescan: u32,
    /// The number of bytes that were scanned in vain.
    pub(super) wasted: u32,
    /// The end of the last token.
    scanned: u32,
    line_width: u32,
    /// 0 if there are no tabs.
    columns_per_tab: u32,
}

impl<'a> Lexer<'a> {
    pub(super) fn new(
        src: &'a [u8],
        stops: ScannerStops<'a>,
        mut buffers: Buffers,
        line_width: u32,
        columns_per_tab: u32,
    ) -> Self {
        buffers.comments.clear();
        buffers.long_lines.clear();
        buffers.wide_lines.clear();
        bun_highway::byte_bits(src, b'\n', &mut buffers.line_feeds);
        let mut was_not_name = 1;
        buffers.blocks.clear();
        buffers
            .blocks
            .extend(
                buffers
                    .line_feeds
                    .iter()
                    .chain(&[0; 2])
                    .enumerate()
                    .map(|(i, line_feeds)| {
                        let is_not_name = stops.after_name.block(i);
                        let is_first = is_not_name | is_not_name << 1 | was_not_name;
                        was_not_name = is_not_name >> 63;
                        Block {
                            starts: stops.after_blanks.block(i) & !line_feeds & is_first,
                            is_not_name,
                        }
                    }),
            );
        let hashbang = match src.starts_with(b"#!") {
            true => strings::index_of_char_usize(src, b'\n').unwrap_or(src.len()) as u32,
            false => 0,
        };
        let mut lexer = Lexer {
            src,
            stops,
            at: Position {
                token: T::Unknown,
                traits: 0,
                start: hashbang,
                end: hashbang,
                prev_end: hashbang,
                prev_line: 0,
                prev_comment: 0,
                prev_odd: 0,
                gap: Gap::Open,
                next: 0,
            },
            tokens: buffers.tokens,
            len: 0,
            blocks: buffers.blocks,
            line_feeds: buffers.line_feeds,
            comments: buffers.comments,
            wide_lines: buffers.wide_lines,
            long_lines: buffers.long_lines,
            markup_depth: 0,
            last_rescan: 0,
            wasted: 0,
            scanned: hashbang,
            line_width,
            columns_per_tab: u32::from(strings::contains_char(src, b'\t')) * columns_per_tab,
        };
        lexer.find_wide_lines();
        lexer
    }

    pub(super) fn into_buffers(self) -> Buffers {
        Buffers {
            tokens: self.tokens,
            blocks: self.blocks,
            line_feeds: self.line_feeds,
            comments: self.comments,
            wide_lines: self.wide_lines,
            long_lines: self.long_lines,
        }
    }

    fn is_wide(&self, start: u32, end: u32) -> bool {
        let mut width = end - start;
        if self.columns_per_tab != 0 {
            let text = (self.src.get(start as usize..end as usize)).unwrap_or_default();
            width += strings::count_char(text, b'\t') as u32 * self.columns_per_tab;
        }
        width >= self.line_width
    }

    fn find_wide_lines(&mut self) {
        let (mut wide_lines, mut line) = (std::mem::take(&mut self.wide_lines), 0);
        let only_first_can_be_wide = self.line_width >= 64 && self.columns_per_tab == 0;
        for (i, &(mut line_feeds)) in self.line_feeds.iter().enumerate() {
            let block = i as u32 * 64;
            if only_first_can_be_wide {
                let end = block + line_feeds.trailing_zeros();
                if (line_feeds != 0) & (end - line >= self.line_width) {
                    wide_lines.push((line, end));
                }
                let next = block + 64 - line_feeds.leading_zeros();
                line = std::hint::select_unpredictable(line_feeds != 0, next, line);
                continue;
            }
            while line_feeds != 0 {
                let end = block + line_feeds.trailing_zeros();
                line_feeds &= line_feeds - 1;
                if self.is_wide(line, end) {
                    wide_lines.push((line, end));
                }
                line = end + 1;
            }
        }
        wide_lines.reverse();
        self.wide_lines = wide_lines;
    }

    /// Adds the start and end of the code on each line that starts before the current token and may be wider than the
    /// limit.
    pub(super) fn find_long_lines(&mut self) {
        let next = self.at.start;
        while let Some(&(start, mut end)) = self.wide_lines.last().filter(|it| it.0 < next) {
            if end < next {
                self.wide_lines.pop();
                let before = self.comments.partition_point(|it| it.start < end);
                let last = before.checked_sub(1).and_then(|it| self.comments.get(it));
                if let Some(comment) = last.filter(|it| {
                    it.end >= end && (it.is_line || it.is_first_on_line || it.start < start)
                }) {
                    let code = self.src.get(start as usize..comment.start as usize);
                    end = start + code.unwrap_or_default().trim_ascii_end().len() as u32;
                }
                if self.is_wide(start, end) {
                    self.long_lines.push((start, end));
                }
            } else {
                return self.long_lines.push((start, end));
            }
        }
    }

    /// The parser won't go back to anything before the current token.
    pub(super) fn forget_past(&mut self) {
        let next = self.at.next as usize;
        self.long_lines.clear();
        if next > 4 * BATCH && next <= self.len && self.len <= self.tokens.len() {
            self.tokens.copy_within(next..self.len, 0);
            (self.len, self.at.next, self.last_rescan) = (self.len - next, 0, 0);
        }
    }

    #[inline]
    fn byte(&self, at: usize) -> u8 {
        self.src.get(at).copied().unwrap_or(0)
    }

    #[inline(always)]
    fn leave_token(&mut self, before: Gap, after: Gap) {
        let at = &mut self.at;
        let before = if before == Gap::Open { at.gap } else { before };
        let is_odd = at.traits & GAP != before as u8;
        at.prev_odd = std::hint::select_unpredictable(is_odd, at.start, at.prev_odd);
        at.gap = after;
        at.prev_end = at.end;
        let has_newline = at.traits & NEWLINE_BEFORE != 0;
        at.prev_line = std::hint::select_unpredictable(has_newline, at.start, at.prev_line);
        if at.traits & (COMMENT_BEFORE | MULTILINE | UNUSUAL) != 0 {
            if at.traits & UNUSUAL != 0 {
                at.prev_odd = at.end;
            }
            if at.traits & COMMENT_BEFORE != 0 {
                at.prev_comment = at.start;
            }
            if at.traits & MULTILINE != 0 {
                at.prev_line = at.end;
            }
        }
    }

    #[inline(always)]
    fn upcoming(&mut self) -> Token {
        let next = self.at.next as usize;
        if next >= self.len {
            self.scan();
        }
        self.tokens.get(next).copied().unwrap_or(Token::NONE)
    }

    #[inline(always)]
    pub(super) fn next(&mut self, before: Gap, after: Gap) {
        self.leave_token(before, after);
        let token = self.upcoming();
        let at = &mut self.at;
        (at.token, at.traits, at.start, at.end) =
            (token.token, token.traits, token.start, token.end);
        at.next += 1;
    }

    /// The next token, and whether a line break is before it.
    #[inline]
    pub(super) fn peek(&mut self) -> (T, bool) {
        let token = self.upcoming();
        (token.token, token.traits & NEWLINE_BEFORE != 0)
    }

    /// Adds at least one token.
    #[inline(never)]
    fn scan(&mut self) {
        let mut tokens = std::mem::take(&mut self.tokens);
        if tokens.len() < self.len + BATCH {
            tokens.resize(2 * (self.len + BATCH), Token::NONE);
        }
        if let Some(out) = (tokens.get_mut(self.len..)).and_then(<[Token]>::first_chunk_mut) {
            self.len += self.scan_into(out);
        }
        self.tokens = tokens;
    }

    /// The traits of the token after `end`, as far as the whitespace there tells.
    #[inline(always)]
    fn gap_after(&self, end: usize, first: u8, second: u8) -> u8 {
        let traits = GAP_AFTER[0][first as usize] & GAP_AFTER[1][second as usize];
        match traits < UNCLEAR_GAP {
            true => traits,
            false => self.unclear_gap_after(end),
        }
    }

    #[cold]
    fn unclear_gap_after(&self, end: usize) -> u8 {
        match self.byte(self.stops.after_blanks.next(end)) {
            b'\n' => OTHER_GAP | NEWLINE_BEFORE,
            _ => OTHER_GAP,
        }
    }

    #[inline(always)]
    fn scan_into(&mut self, out: &mut [Token; BATCH]) -> usize {
        let closing = if self.markup_depth > 0 { CLOSING } else { 0 };
        let (src, mut count, mut from) = (self.src, 0, self.scanned as usize);
        let mut traits = self.gap_after(from, self.byte(from), self.byte(from + 1));
        let (mut padded, mut is_after_token) = ([0; WINDOW], true);
        loop {
            let base = from & !63;
            let Some(&[block, next]) = self.blocks.get(from / 64..).and_then(<[_]>::first_chunk)
            else {
                return count;
            };
            let window: &[u8; WINDOW] = match src.get(base..).and_then(<[u8]>::first_chunk) {
                Some(window) => window,
                None => {
                    padded.fill(0);
                    let rest = src.get(base..).unwrap_or_default();
                    padded
                        .iter_mut()
                        .zip(rest)
                        .for_each(|(to, from)| *to = *from);
                    &padded
                }
            };
            let is_not_name = u128::from(block.is_not_name) | u128::from(next.is_not_name) << 64;
            let name_at_from = !block.is_not_name & u64::from(is_after_token) << (from % 64);
            let mut starts = block.starts & u64::MAX << (from % 64) | name_at_from;
            (from, is_after_token) = (base + 64, false);
            while starts != 0 {
                let at = starts.trailing_zeros() as usize;
                starts &= starts - 1;
                let bytes = window[at..at + 8]
                    .first_chunk()
                    .map_or(0, |it| u64::from_le_bytes(*it));
                let (first, second) = (bytes as u8, (bytes >> 8) as u8);
                let name_len = ((is_not_name >> at) as u64).trailing_zeros() as usize;
                let start = base + at;
                if NEEDS_LOOK[0][first as usize] & (NEEDS_LOOK[1][second as usize] | closing) != 0
                    || name_len == 64
                {
                    let end = match (first, second) {
                        (b'/', b'/' | b'*') if let Some(end) = self.comment(start) => {
                            let text = src.get(start..end).unwrap_or_default();
                            traits |= COMMENT_BEFORE | OTHER_GAP;
                            if second == b'*' && strings::contains_char(text, b'\n') {
                                traits |= NEWLINE_BEFORE;
                            }
                            traits |= self.gap_after(end, self.byte(end), self.byte(end + 1));
                            end
                        }
                        _ => {
                            let (token, len, more) = self.uncommon_token(start, first);
                            let end = start + len;
                            out[count % BATCH] = Token {
                                start: start as u32,
                                end: end as u32,
                                token,
                                traits: traits | more,
                            };
                            count += 1;
                            if count == BATCH || self.may_be_rescanned(token, end) {
                                self.scanned = end as u32;
                                return count;
                            }
                            traits = self.gap_after(end, self.byte(end), self.byte(end + 1));
                            end
                        }
                    };
                    if end >= from {
                        (from, is_after_token) = (end, true);
                        break;
                    }
                    let bit = 1u64 << (end % 64);
                    starts = block.starts & bit.wrapping_neg() | !block.is_not_name & bit;
                    continue;
                }
                let key = bytes & FIRST_BYTES[name_len];
                let is_keyword = KEYS[slot(key)] == key;
                let mut token = std::hint::select_unpredictable(
                    is_keyword,
                    WORD_TOKENS[slot(key)],
                    TOKEN_OF_BYTE[first as usize],
                );
                if is_keyword & (name_len >= 8) {
                    token = long_word(&window[at..at + name_len], token);
                }
                let len = name_len.max(1);
                out[count % BATCH] = Token {
                    start: start as u32,
                    end: (start + len) as u32,
                    token,
                    traits,
                };
                count += 1;
                if count == BATCH {
                    self.scanned = (start + len) as u32;
                    return count;
                }
                traits = self.gap_after(start + len, window[at + len], window[at + len + 1]);
            }
        }
    }

    /// True if it's likely that what follows `token`, which ends at `end`, isn't made of ordinary tokens.
    #[inline]
    fn may_be_rescanned(&self, token: T, end: usize) -> bool {
        match token {
            T::Unknown | T::Eof | T::TemplateHead | T::CloseBrace | T::Gt | T::SlashEq => true,
            T::Slash => !matches!(self.byte(end), b' ' | b'>'),
            _ => false,
        }
    }

    /// Returns the token, its length and its traits.
    #[inline]
    fn uncommon_token(&mut self, start: usize, c: u8) -> (T, usize, u8) {
        let (token, len) = match c {
            b'"' | b'\'' => return self.string(start, c),
            b'`' => return self.template(start),
            b'0'..=b'9' => return self.number(start),
            b'.' => match (self.byte(start + 1), self.byte(start + 2)) {
                (b'0'..=b'9', _) => return self.number(start),
                (b'.', b'.') => (T::DotDotDot, 3),
                _ => (T::Dot, 1),
            },
            b'}' => (T::CloseBrace, 1),
            b'>' => (T::Gt, 1),
            _ if is_name_part(c) => (T::Ident, self.name_len(start)),
            _ => self.operator(start, c),
        };
        (token, len, 0)
    }

    /// Returns the end of the comment at `start`, or `None` if it isn't closed.
    fn comment(&mut self, start: usize) -> Option<usize> {
        let rest = self.src.get(start + 2..)?;
        let is_line = self.byte(start + 1) == b'/';
        let before = self
            .src
            .get(..start)?
            .iter()
            .rfind(|b| !matches!(b, b' ' | b'\t'));
        let end = match is_line {
            true => start + 2 + strings::index_of_char_usize(rest, b'\n').unwrap_or(rest.len()),
            false => {
                let Some(len) = strings::index_of(rest, b"*/") else {
                    self.wasted = self.wasted.saturating_add(rest.len() as u32);
                    return None;
                };
                start + 2 + len + 2
            }
        };
        self.comments.push(Comment {
            start: start as u32,
            end: end as u32,
            is_line,
            is_first_on_line: matches!(before, None | Some(b'\n')),
        });
        Some(end)
    }

    /// Drops the tokens after the current one. The next one is looked for from `from` on.
    fn scan_again_from(&mut self, from: u32) {
        self.last_rescan = self.at.next;
        self.len = self.at.next as usize;
        let scanned = std::mem::replace(&mut self.scanned, from);
        if scanned != from {
            self.wasted = self.wasted.saturating_add(scanned.saturating_sub(from));
            while self.comments.pop_if(|it| it.start >= from).is_some() {}
        }
    }

    pub(super) fn go_back(&mut self, to: Position) {
        self.at = to;
        if self.last_rescan >= to.next {
            self.scan_again_from(to.end);
        }
    }

    /// Makes the current token longer.
    fn extend_token(&mut self, token: T, end: usize) {
        let end = end as u32;
        while self.at.end < end {
            let next = self.upcoming();
            if next.end > end || next.start != self.at.end {
                self.scan_again_from(self.at.end);
                self.scanned = end;
                break;
            }
            (self.at.end, self.at.next) = (next.end, self.at.next + 1);
        }
        (self.at.token, self.at.end) = (token, end);
    }

    /// Moves on to the token after `end`, which is at the end of a line.
    pub(super) fn skip_to(&mut self, end: u32) {
        self.scan_again_from(self.at.end);
        self.at.end = end;
        self.at.traits |= MULTILINE;
        self.scanned = end;
        self.next(Gap::Open, Gap::Open);
    }

    #[inline]
    fn name_len(&self, start: usize) -> usize {
        self.stops.after_name.next(start) - start
    }

    fn operator(&self, start: usize, c: u8) -> (T, usize) {
        let (second, third) = (self.byte(start + 1), self.byte(start + 2));
        match (c, second, third) {
            (b'=', b'=', b'=') => (T::EqEqEq, 3),
            (b'=', b'=', _) => (T::EqEq, 2),
            (b'=', b'>', _) => (T::Arrow, 2),
            (b'=', ..) => (T::Eq, 1),
            (b'!', b'=', b'=') => (T::BangEqEq, 3),
            (b'!', b'=', _) => (T::BangEq, 2),
            (b'!', ..) => (T::Bang, 1),
            (b'?', b'?', b'=') => (T::QuestionQuestionEq, 3),
            (b'?', b'?', _) => (T::QuestionQuestion, 2),
            (b'?', b'.', b'0'..=b'9') => (T::Question, 1),
            (b'?', b'.', _) => (T::QuestionDot, 2),
            (b'?', ..) => (T::Question, 1),
            (b'&', b'&', b'=') => (T::AmpAmpEq, 3),
            (b'&', b'&', _) => (T::AmpAmp, 2),
            (b'&', b'=', _) => (T::AmpEq, 2),
            (b'&', ..) => (T::Amp, 1),
            (b'|', b'|', b'=') => (T::BarBarEq, 3),
            (b'|', b'|', _) => (T::BarBar, 2),
            (b'|', b'=', _) => (T::BarEq, 2),
            (b'|', ..) => (T::Bar, 1),
            // `<!--` starts a comment in a script.
            (b'<', b'!', b'-') => (T::Unknown, 1),
            (b'<', b'<', b'=') => (T::ShlEq, 3),
            (b'<', b'<', _) => (T::Shl, 2),
            (b'<', b'=', _) => (T::LtEq, 2),
            (b'<', ..) => (T::Lt, 1),
            (b'+', b'+', _) => (T::PlusPlus, 2),
            (b'+', b'=', _) => (T::PlusEq, 2),
            (b'+', ..) => (T::Plus, 1),
            (b'-', b'-', b'>') => (T::Unknown, 1),
            (b'-', b'-', _) => (T::MinusMinus, 2),
            (b'-', b'=', _) => (T::MinusEq, 2),
            (b'-', ..) => (T::Minus, 1),
            (b'*', b'*', b'=') => (T::StarStarEq, 3),
            (b'*', b'*', _) => (T::StarStar, 2),
            (b'*', b'=', _) => (T::StarEq, 2),
            (b'*', ..) => (T::Star, 1),
            (b'/', b'*', _) => (T::Unknown, 1),
            (b'/', b'=', _) => (T::SlashEq, 2),
            (b'/', ..) => (T::Slash, 1),
            (b'%', b'=', _) => (T::PercentEq, 2),
            (b'%', ..) => (T::Percent, 1),
            (b'^', b'=', _) => (T::CaretEq, 2),
            (b'^', ..) => (T::Caret, 1),
            (b'#', b'a'..=b'z' | b'A'..=b'Z' | b'_' | b'$', _) => {
                (T::PrivateName, 1 + self.name_len(start + 1))
            }
            _ if start >= self.src.len() => (T::Eof, 0),
            _ => (T::Unknown, 1),
        }
    }

    /// At a `>` in an expression.
    pub(super) fn rescan_greater_than(&mut self) {
        let start = self.at.start as usize;
        let (token, len) = match (
            self.byte(start + 1),
            self.byte(start + 2),
            self.byte(start + 3),
        ) {
            (b'>', b'>', b'=') => (T::UShrEq, 4),
            (b'>', b'>', _) => (T::UShr, 3),
            (b'>', b'=', _) => (T::ShrEq, 3),
            (b'>', ..) => (T::Shr, 2),
            (b'=', ..) => (T::GtEq, 2),
            _ => (T::Gt, 1),
        };
        self.extend_token(token, start + len);
    }

    fn digits(&self, mut i: usize, is_digit: impl Fn(u8) -> bool) -> Option<usize> {
        if !is_digit(self.byte(i)) {
            return None;
        }
        loop {
            i += 1;
            match self.byte(i) {
                b'_' if is_digit(self.byte(i + 1)) => i += 1,
                c if is_digit(c) => {}
                _ => return Some(i),
            }
        }
    }

    fn number(&self, start: usize) -> (T, usize, u8) {
        let Some((token, end)) =
            (self.number_end(start)).filter(|it| !is_name_part(self.byte(it.1)))
        else {
            return (T::Unknown, 1, 0);
        };
        let text = self.src.get(start..end).unwrap_or_default();
        let is_plain = text.iter().all(u8::is_ascii_digit)
            || (token == T::Num && *format_trimmed_number(text) == *text);
        (token, end - start, if is_plain { 0 } else { UNUSUAL })
    }

    fn number_end(&self, start: usize) -> Option<(T, usize)> {
        let decimal = |c: u8| c.is_ascii_digit();
        let integer = |end: usize| match self.byte(end) {
            b'n' => (T::BigInt, end + 1),
            _ => (T::Num, end),
        };
        let mut i = start;
        match (self.byte(start), self.byte(start + 1)) {
            (b'0', b'x' | b'X') => {
                return self
                    .digits(start + 2, |c| c.is_ascii_hexdigit())
                    .map(integer);
            }
            (b'0', b'o' | b'O') => {
                return self
                    .digits(start + 2, |c| matches!(c, b'0'..=b'7'))
                    .map(integer);
            }
            (b'0', b'b' | b'B') => {
                return self
                    .digits(start + 2, |c| matches!(c, b'0' | b'1'))
                    .map(integer);
            }
            (b'0', b'0'..=b'9' | b'_') => return None,
            (b'.', _) => {}
            _ => {
                i = self.digits(start, decimal)?;
                if !matches!(self.byte(i), b'.' | b'e' | b'E') {
                    return Some(integer(i));
                }
            }
        }
        if self.byte(i) == b'.' {
            i = self.digits(i + 1, decimal).unwrap_or(i + 1);
        }
        if matches!(self.byte(i), b'e' | b'E') {
            let sign = usize::from(matches!(self.byte(i + 1), b'+' | b'-'));
            i = self.digits(i + 1 + sign, decimal)?;
        }
        Some((T::Num, i))
    }

    /// Returns the end of the escape sequence whose backslash is at `at`, if it's valid everywhere.
    fn escape_end(&self, at: usize) -> Option<usize> {
        let hex = |from: usize, count: usize| {
            (from..from + count)
                .all(|i| self.byte(i).is_ascii_hexdigit())
                .then_some(from + count)
        };
        match self.byte(at + 1) {
            b'0' if !self.byte(at + 2).is_ascii_digit() => Some(at + 2),
            b'0'..=b'9' | 0..0x20 => None,
            b'x' => hex(at + 2, 2),
            b'u' if self.byte(at + 2) == b'{' => {
                let count = (at + 3..at + 9)
                    .take_while(|&i| self.byte(i).is_ascii_hexdigit())
                    .count();
                ((1..=5).contains(&count) && self.byte(at + 3 + count) == b'}')
                    .then_some(at + 4 + count)
            }
            b'u' => hex(at + 2, 4),
            _ => Some(at + 2),
        }
    }

    fn string(&self, start: usize, quote: u8) -> (T, usize, u8) {
        let (mut i, mut traits) = (start + 1, 0);
        loop {
            i = self.stops.in_string.next(i);
            match self.byte(i) {
                c if c == quote => return (T::Str, i + 1 - start, traits),
                b'\\' => {
                    traits |= ESCAPE;
                    let Some(end) = self.escape_end(i) else {
                        return (T::Unknown, 1, 0);
                    };
                    i = end;
                }
                0..0x20 => return (T::Unknown, 1, 0),
                0x80.. => (i, traits) = (i + 1, traits | UNUSUAL),
                _ => i += 1,
            }
        }
    }

    /// `start` is the position of the `` ` `` or the `}`.
    fn template(&mut self, start: usize) -> (T, usize, u8) {
        let (mut i, mut traits) = (start + 1, 0);
        loop {
            i = self.stops.in_string.next(i);
            match self.byte(i) {
                b'`' => return (T::Template, i + 1 - start, traits),
                b'$' if self.byte(i + 1) == b'{' => {
                    return (T::TemplateHead, i + 2 - start, traits);
                }
                b'\\' => match self.escape_end(i) {
                    Some(end) => i = end,
                    None => {
                        traits |= if self.byte(i + 1) == b'\n' { 0 } else { ESCAPE };
                        i += 1;
                    }
                },
                b'\n' => {
                    traits |= MULTILINE;
                    i += 1;
                }
                b'\t' | 0x80.. => (i, traits) = (i + 1, traits | UNUSUAL),
                0..0x20 => {
                    self.wasted = self.wasted.saturating_add((i - start) as u32);
                    return (T::Unknown, 1, 0);
                }
                _ => i += 1,
            }
        }
    }

    /// At the `}` that ends a substitution.
    pub(super) fn rescan_template(&mut self) {
        self.scan_again_from(self.at.end);
        let (token, len, traits) = self.template(self.at.start as usize);
        (self.at.token, self.at.end) = (token, self.at.start + len as u32);
        self.at.traits |= traits;
        self.scanned = self.at.end;
    }

    /// At a `/` or `/=` that starts an expression.
    pub(super) fn rescan_regex(&mut self) {
        let start = self.at.start as usize;
        let (mut i, mut is_in_class) = (start + 1, false);
        self.at.token = T::Unknown;
        loop {
            match self.byte(i) {
                0..0x20 => return,
                b'\\' if self.byte(i + 1) < 0x20 => return,
                b'\\' if self.byte(i + 1) >= 0x80 => {}
                b'\\' => i += 1,
                0x80.. => self.at.traits |= UNUSUAL,
                b'[' => is_in_class = true,
                b']' => is_in_class = false,
                b'/' if !is_in_class => break,
                _ => {}
            }
            i += 1;
        }
        let end = i + 1 + self.name_len(i + 1);
        let flags = self.src.get(i + 1..end).unwrap_or_default();
        let are_sorted = flags.is_sorted_by(|a, b| a < b);
        let are_known = (flags.iter())
            .all(|c| matches!(c, b'd' | b'g' | b'i' | b'm' | b's' | b'u' | b'v' | b'y'));
        if are_sorted && are_known && !strings::contains(flags, b"uv") {
            self.scan_again_from(self.at.end);
            (self.at.token, self.at.end, self.scanned) = (T::Regex, end as u32, end as u32);
        }
    }

    /// At a word in a JSX tag, which can contain `-`.
    pub(super) fn rescan_jsx_name(&mut self) {
        let mut end = self.at.end as usize;
        while self.byte(end) == b'-' {
            end += 1 + self.name_len(end + 1);
        }
        self.extend_token(T::Ident, end);
    }

    /// Like [`Lexer::next`], after the `=` of a JSX attribute. A string has no escapes there.
    pub(super) fn next_jsx_attribute_value(&mut self) {
        let start = self.at.end as usize;
        let quote = self.byte(start);
        let next = self.upcoming();
        if !matches!(quote, b'"' | b'\'') || (next.token, next.traits) == (T::Str, 0) {
            return self.next(Gap::None, Gap::None);
        }
        let rest = self.src.get(start + 1..).unwrap_or_default();
        let len = rest
            .iter()
            .take_while(|&&c| c != quote && c >= 0x20)
            .count();
        match self.byte(start + 1 + len) == quote {
            true => self.next_is(Gap::None, T::Str, start + len + 2),
            false => self.next_is(Gap::None, T::Unknown, start + 1),
        }
        self.at.traits = UNUSUAL;
    }

    /// Moves on to `token`, which is directly after the current one and has no line break.
    fn next_is(&mut self, before: Gap, token: T, end: usize) {
        self.scan_again_from(self.at.end);
        self.leave_token(before, Gap::Open);
        let at = &mut self.at;
        (at.token, at.traits, at.start, at.end) = (token, 0, at.end, end as u32);
        self.scanned = at.end;
    }

    /// Like [`Lexer::next`], between the tags of a JSX element.
    pub(super) fn next_jsx_child(&mut self) {
        let start = self.at.end;
        if matches!(self.byte(start as usize), b'\n' | b'{' | b'<') {
            let next = self.upcoming();
            if matches!(next.token, T::OpenBrace | T::Lt) && next.traits & COMMENT_BEFORE == 0 {
                if next.start == start {
                    self.next(Gap::None, Gap::Open);
                    self.at.traits = 0;
                } else {
                    self.leave_token(Gap::None, Gap::Open);
                    let at = &mut self.at;
                    (at.token, at.traits) = (T::JsxText, MULTILINE);
                    (at.start, at.end) = (start, next.start);
                }
                return;
            }
        }
        self.next_is(Gap::None, T::Unknown, start as usize);
        let mut i = start as usize;
        loop {
            match self.byte(i) {
                b'{' | b'<' if i > start as usize => break,
                b'\n' => self.at.traits = MULTILINE,
                b'\t' => {}
                b'{' | b'<' | b'>' | b'}' | 0..0x20 => return,
                _ => {}
            }
            i += 1;
        }
        (self.at.token, self.at.end, self.scanned) = (T::JsxText, i as u32, i as u32);
    }
}
