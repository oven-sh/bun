//! Tokens.
//!
//! Two token layers, matching C's translation phases:
//!
//! * [`PpToken`] — what the lexer produces and what a preprocessor operates on.
//!   Identifiers are plain identifiers (no keywords yet), numbers are unparsed
//!   pp-numbers, literals keep their source spelling.
//! * [`Token`] — what the parser consumes. [`classify`] converts a `PpToken` into a
//!   `Token` (phase 7): keywords are recognised, numbers are parsed, escape sequences
//!   are decoded.
//!
//! The parser only ever sees `Token`s pulled from a [`TokenSource`]; it never has access
//! to the source bytes.

use std::rc::Rc;

use bun_core::strings;

use crate::extended::{self, Extended};

#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub(crate) struct Loc {
    /// Index into the compilation's file table.
    pub(crate) file: u32,
    /// As `#line` has it, for `__LINE__`; a diagnostic is placed by `offset`.
    pub(crate) line: u32,
    /// Byte offset in the file's contents.
    pub(crate) offset: u32,
}

#[derive(Clone, Debug)]
pub(crate) struct Error {
    pub(crate) loc: Loc,
    pub(crate) msg: String,
    /// Another place worth showing, and what it is.
    pub(crate) note: Option<(Loc, String)>,
}

pub(crate) type Res<T> = Result<T, Error>;

pub(crate) fn err<T>(loc: Loc, msg: impl Into<String>) -> Res<T> {
    Err(Error {
        loc,
        msg: msg.into(),
        note: None,
    })
}

pub(crate) fn err_with_note<T>(
    loc: Loc,
    msg: impl Into<String>,
    note_loc: Loc,
    note: &str,
) -> Res<T> {
    Err(Error {
        loc,
        msg: msg.into(),
        note: Some((note_loc, note.to_owned())),
    })
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Punct {
    LBracket,
    RBracket,
    LParen,
    RParen,
    LBrace,
    RBrace,
    Dot,
    Arrow,
    PlusPlus,
    MinusMinus,
    Amp,
    Star,
    Plus,
    Minus,
    Tilde,
    Bang,
    Slash,
    Percent,
    Shl,
    Shr,
    Lt,
    Gt,
    Le,
    Ge,
    EqEq,
    Ne,
    Caret,
    Pipe,
    AmpAmp,
    PipePipe,
    Question,
    Colon,
    Semi,
    Ellipsis,
    Assign,
    StarAssign,
    SlashAssign,
    PercentAssign,
    PlusAssign,
    MinusAssign,
    ShlAssign,
    ShrAssign,
    AmpAssign,
    CaretAssign,
    PipeAssign,
    Comma,
    Hash,
    HashHash,
}

impl Punct {
    pub(crate) fn spelling(self) -> &'static str {
        match self {
            Punct::LBracket => "[",
            Punct::RBracket => "]",
            Punct::LParen => "(",
            Punct::RParen => ")",
            Punct::LBrace => "{",
            Punct::RBrace => "}",
            Punct::Dot => ".",
            Punct::Arrow => "->",
            Punct::PlusPlus => "++",
            Punct::MinusMinus => "--",
            Punct::Amp => "&",
            Punct::Star => "*",
            Punct::Plus => "+",
            Punct::Minus => "-",
            Punct::Tilde => "~",
            Punct::Bang => "!",
            Punct::Slash => "/",
            Punct::Percent => "%",
            Punct::Shl => "<<",
            Punct::Shr => ">>",
            Punct::Lt => "<",
            Punct::Gt => ">",
            Punct::Le => "<=",
            Punct::Ge => ">=",
            Punct::EqEq => "==",
            Punct::Ne => "!=",
            Punct::Caret => "^",
            Punct::Pipe => "|",
            Punct::AmpAmp => "&&",
            Punct::PipePipe => "||",
            Punct::Question => "?",
            Punct::Colon => ":",
            Punct::Semi => ";",
            Punct::Ellipsis => "...",
            Punct::Assign => "=",
            Punct::StarAssign => "*=",
            Punct::SlashAssign => "/=",
            Punct::PercentAssign => "%=",
            Punct::PlusAssign => "+=",
            Punct::MinusAssign => "-=",
            Punct::ShlAssign => "<<=",
            Punct::ShrAssign => ">>=",
            Punct::AmpAssign => "&=",
            Punct::CaretAssign => "^=",
            Punct::PipeAssign => "|=",
            Punct::Comma => ",",
            Punct::Hash => "#",
            Punct::HashHash => "##",
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum PpKind {
    Ident,
    Number,
    CharLit,
    StrLit,
    Punct(Punct),
    /// A character that is no other token (`@`, `\`), or an unmatched quote with the rest
    /// of its line. Valid while preprocessing; an error if it reaches the parser.
    Other,
    /// A `#pragma` the parser acts on, made by the preprocessor. `text` is its canonical
    /// spelling after `#pragma `: `pack set 4`, `pack set default`, `pack push 1`,
    /// `pack push default`, `pack pop`, `weak name`, `redefine_extname name symbol`.
    Pragma,
    Eof,
}

/// A preprocessing token. `text` is the spelling with line splices removed; for
/// punctuators and end of file it is empty.
#[derive(Clone, Debug)]
pub(crate) struct PpToken {
    pub(crate) kind: PpKind,
    pub(crate) text: Vec<u8>,
    pub(crate) loc: Loc,
    pub(crate) at_start_of_line: bool,
    pub(crate) has_leading_space: bool,
}

/// Anything the parser can pull preprocessing tokens from: the lexer today, the
/// preprocessor (a token -> token stage) later.
pub(crate) trait TokenSource {
    fn next_token(&mut self) -> Res<PpToken>;
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Kw {
    Alignas,
    Alignof,
    Asm,
    Atomic,
    Attribute,
    Auto,
    Bool,
    Break,
    Case,
    Char,
    Complex,
    Const,
    Continue,
    Default,
    Do,
    Double,
    Else,
    Enum,
    Extension,
    Extern,
    Float,
    For,
    Generic,
    Goto,
    If,
    Inline,
    Int,
    Int128,
    Long,
    Noreturn,
    Register,
    Restrict,
    Return,
    Short,
    Signed,
    Sizeof,
    Static,
    StaticAssert,
    Struct,
    Switch,
    ThreadLocal,
    Typedef,
    Typeof,
    Union,
    Unsigned,
    Void,
    Volatile,
    While,
    // Microsoft's, which only Windows targets have.
    /// `__int64`. (`__int8`, `__int16` and `__int32` are `char`, `short` and `int`.)
    Int64,
    /// `__forceinline`.
    ForceInline,
    /// Calling conventions and pointer decorations that say nothing on a 64-bit target.
    MsIgnored,
    /// `__vectorcall`: a calling convention of its own, which is not implemented.
    VectorCall,
    Try,
    Except,
    Finally,
    Leave,
}

/// What of the language depends on the target: the signedness of plain `char`, which decides
/// the value of character constants such as `'\xff'`, and whether Microsoft's keywords exist.
#[derive(Clone, Copy)]
pub(crate) struct Dialect {
    pub(crate) char_is_signed: bool,
    pub(crate) microsoft: bool,
}

fn microsoft_keyword(ident: &[u8]) -> Option<Kw> {
    Some(match ident {
        b"__int8" => Kw::Char,
        b"__int16" => Kw::Short,
        b"__int32" => Kw::Int,
        b"__int64" => Kw::Int64,
        b"__forceinline" => Kw::ForceInline,
        b"_inline" => Kw::Inline,
        b"_asm" => Kw::Asm,
        b"_alignof" => Kw::Alignof,
        b"__cdecl" | b"_cdecl" | b"__stdcall" | b"_stdcall" | b"__fastcall" | b"_fastcall"
        | b"__thiscall" | b"__clrcall" | b"__unaligned" | b"__ptr32" | b"__ptr64" | b"__sptr"
        | b"__uptr" | b"__w64" => Kw::MsIgnored,
        b"__vectorcall" => Kw::VectorCall,
        b"__try" => Kw::Try,
        b"__except" => Kw::Except,
        b"__finally" => Kw::Finally,
        b"__leave" => Kw::Leave,
        _ => return None,
    })
}

fn keyword(ident: &[u8]) -> Option<Kw> {
    Some(match ident {
        b"_Alignas" | b"alignas" => Kw::Alignas,
        b"_Alignof" | b"alignof" | b"__alignof__" | b"__alignof" => Kw::Alignof,
        b"asm" | b"__asm__" | b"__asm" => Kw::Asm,
        b"_Atomic" => Kw::Atomic,
        b"__attribute__" | b"__attribute" | b"__declspec" | b"_declspec" => Kw::Attribute,
        b"auto" => Kw::Auto,
        b"_Bool" => Kw::Bool,
        b"break" => Kw::Break,
        b"case" => Kw::Case,
        b"char" => Kw::Char,
        b"_Complex" | b"_Imaginary" | b"__complex__" => Kw::Complex,
        b"const" | b"__const" | b"__const__" => Kw::Const,
        b"continue" => Kw::Continue,
        b"default" => Kw::Default,
        b"do" => Kw::Do,
        b"double" => Kw::Double,
        b"else" => Kw::Else,
        b"enum" => Kw::Enum,
        b"__extension__" => Kw::Extension,
        b"extern" => Kw::Extern,
        b"float" => Kw::Float,
        b"for" => Kw::For,
        b"_Generic" => Kw::Generic,
        b"goto" => Kw::Goto,
        b"if" => Kw::If,
        b"inline" | b"__inline" | b"__inline__" => Kw::Inline,
        b"int" => Kw::Int,
        b"__int128" => Kw::Int128,
        b"long" => Kw::Long,
        b"_Noreturn" => Kw::Noreturn,
        b"register" => Kw::Register,
        b"restrict" | b"__restrict" | b"__restrict__" => Kw::Restrict,
        b"return" => Kw::Return,
        b"short" => Kw::Short,
        b"signed" | b"__signed__" | b"__signed" => Kw::Signed,
        b"sizeof" => Kw::Sizeof,
        b"static" => Kw::Static,
        b"_Static_assert" | b"static_assert" => Kw::StaticAssert,
        b"struct" => Kw::Struct,
        b"switch" => Kw::Switch,
        b"_Thread_local" | b"thread_local" | b"__thread" => Kw::ThreadLocal,
        b"typedef" => Kw::Typedef,
        b"typeof" | b"__typeof__" | b"__typeof" | b"typeof_unqual" => Kw::Typeof,
        b"union" => Kw::Union,
        b"unsigned" => Kw::Unsigned,
        b"void" => Kw::Void,
        b"volatile" | b"__volatile__" | b"__volatile" => Kw::Volatile,
        b"while" => Kw::While,
        _ => return None,
    })
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) struct IntSuffix {
    pub(crate) unsigned: bool,
    /// Number of `l`s: 0, 1 (`l`) or 2 (`ll`).
    pub(crate) longs: u8,
}

/// The element type of a prefixed literal: `wchar_t`, `char16_t` or `char32_t`.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum WideKind {
    Wchar,
    Char16,
    Char32,
}

#[derive(Clone, PartialEq, Debug)]
pub(crate) enum Tok {
    Eof,
    Ident(Rc<str>),
    Kw(Kw),
    /// `decimal` distinguishes `10` from `0xa`/`012`: they are typed differently.
    Int {
        value: u64,
        decimal: bool,
        suffix: IntSuffix,
    },
    /// `single` is an `f` suffix.
    Float {
        value: f64,
        single: bool,
        /// An `l` suffix: the value in the x87 format (`value` is it as a `double`).
        long_double: Option<Extended>,
        /// A GNU `i` or `j` suffix: an imaginary constant.
        imaginary: bool,
    },
    /// A character constant; its type is `int`.
    Char(i64),
    /// Decoded bytes of one string literal, without the terminating NUL.
    Str(Vec<u8>),
    /// An `L`, `u` or `U` character constant.
    WideChar(WideKind, u32),
    /// An `L`, `u` or `U` string literal as code points (escapes give raw values).
    WideStr(WideKind, Vec<u32>),
    Punct(Punct),
    /// `#pragma pack`: in effect from this point of the token stream on.
    PragmaPack(PackOp),
    /// `#pragma weak name`.
    PragmaWeak(Rc<str>),
    /// `#pragma ms_struct on` / `off`.
    PragmaMsStruct(bool),
    /// `#pragma redefine_extname name symbol`: `name` is linked as `symbol`.
    PragmaRedefine(Rc<str>, Rc<str>),
}

/// What a `#pragma pack` does to the maximum member alignment. `None` is the default
/// (natural alignment).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum PackOp {
    Set(Option<u32>),
    Push(Option<u32>),
    Pop,
}

#[derive(Clone, Debug)]
pub(crate) struct Token {
    pub(crate) tok: Tok,
    pub(crate) loc: Loc,
}

impl Tok {
    pub(crate) fn describe(&self) -> String {
        match self {
            Tok::Eof => "end of file".to_string(),
            Tok::Ident(name) => format!("'{name}'"),
            Tok::Kw(kw) => format!("keyword '{}'", format!("{kw:?}").to_lowercase()),
            Tok::Int { .. } | Tok::Float { .. } => "number".to_string(),
            Tok::Char(_) | Tok::WideChar(..) => "character constant".to_string(),
            Tok::Str(_) | Tok::WideStr(..) => "string literal".to_string(),
            Tok::Punct(p) => format!("'{}'", p.spelling()),
            Tok::PragmaPack(_) => "'#pragma pack'".to_string(),
            Tok::PragmaWeak(_) => "'#pragma weak'".to_string(),
            Tok::PragmaMsStruct(_) => "'#pragma ms_struct'".to_string(),
            Tok::PragmaRedefine(..) => "'#pragma redefine_extname'".to_string(),
        }
    }
}

// ───────────────────────────── phase 7: PpToken -> Token ─────────────────────────────

pub(crate) fn classify(pp: &PpToken, dialect: Dialect) -> Res<Token> {
    let loc = pp.loc;
    let char_is_signed = dialect.char_is_signed;
    let microsoft = |text: &[u8]| {
        if dialect.microsoft {
            microsoft_keyword(text)
        } else {
            None
        }
    };
    let tok = match pp.kind {
        PpKind::Eof => Tok::Eof,
        PpKind::Punct(p) => Tok::Punct(p),
        PpKind::Ident => match keyword(&pp.text).or_else(|| microsoft(&pp.text)) {
            Some(kw) => Tok::Kw(kw),
            None => match std::str::from_utf8(&pp.text) {
                Ok(s) => Tok::Ident(Rc::from(s)),
                Err(_) => return err(loc, "identifier is not valid UTF-8"),
            },
        },
        PpKind::Number => parse_number(&pp.text, loc)?,
        PpKind::Pragma => {
            let value = |text: &[u8]| -> Option<u32> {
                std::str::from_utf8(text).ok().and_then(|t| t.parse().ok())
            };
            let text = pp.text.as_slice();
            if text == b"ms_struct on" {
                Tok::PragmaMsStruct(true)
            } else if text == b"ms_struct off" {
                Tok::PragmaMsStruct(false)
            } else if text == b"pack pop" {
                Tok::PragmaPack(PackOp::Pop)
            } else if let Some(n) = text.strip_prefix(b"pack set ") {
                Tok::PragmaPack(PackOp::Set(value(n)))
            } else if let Some(n) = text.strip_prefix(b"pack push ") {
                Tok::PragmaPack(PackOp::Push(value(n)))
            } else if let Some(names) = text.strip_prefix(b"redefine_extname ") {
                let space = strings::index_of_char_usize(names, b' ').unwrap_or(names.len());
                let (old, new) = (&names[..space], &names[(space + 1).min(names.len())..]);
                match (std::str::from_utf8(old), std::str::from_utf8(new)) {
                    (Ok(old), Ok(new)) => Tok::PragmaRedefine(Rc::from(old), Rc::from(new)),
                    _ => return err(loc, "identifier is not valid UTF-8"),
                }
            } else if let Some(name) = text.strip_prefix(b"weak ") {
                match std::str::from_utf8(name) {
                    Ok(name) => Tok::PragmaWeak(Rc::from(name)),
                    Err(_) => return err(loc, "identifier is not valid UTF-8"),
                }
            } else {
                return err(loc, "internal error: unknown pragma token");
            }
        }
        PpKind::Other => {
            return err(
                loc,
                match pp.text.first() {
                    Some(b'"') => "unterminated string literal".to_string(),
                    Some(b'\'') => "unterminated character constant".to_string(),
                    Some(&b) if (0x20..0x7f).contains(&b) => {
                        format!("unexpected character '{}'", b as char)
                    }
                    Some(&b) => format!("unexpected character byte 0x{b:02x}"),
                    None => "unexpected character".to_string(),
                },
            );
        }
        PpKind::CharLit if wide_kind(&pp.text).is_some() => {
            let kind = wide_kind(&pp.text).unwrap_or(WideKind::Wchar);
            let body = literal_body(&pp.text, b'\'', loc)?;
            match decode_wide(body, loc)?.as_slice() {
                [] => return err(loc, "empty character constant"),
                [c] => Tok::WideChar(kind, *c),
                _ => return err(loc, "multi-character character constants are not supported"),
            }
        }
        PpKind::StrLit if wide_kind(&pp.text).is_some() => {
            let kind = wide_kind(&pp.text).unwrap_or(WideKind::Wchar);
            let body = literal_body(&pp.text, b'"', loc)?;
            Tok::WideStr(kind, decode_wide(body, loc)?)
        }
        PpKind::CharLit => {
            let body = literal_body(&pp.text, b'\'', loc)?;
            let bytes = decode_escapes(body, loc)?;
            match bytes.as_slice() {
                [] => return err(loc, "empty character constant"),
                [b] => Tok::Char(if char_is_signed {
                    i64::from(*b as i8)
                } else {
                    i64::from(*b)
                }),
                // Implementation-defined; as GCC and Clang have it, an int made of the last four
                // characters, the first of them in the most significant byte.
                several => Tok::Char(i64::from(
                    several
                        .iter()
                        .fold(0u32, |value, b| (value << 8) | u32::from(*b))
                        as i32,
                )),
            }
        }
        PpKind::StrLit => {
            let body = literal_body(&pp.text, b'"', loc)?;
            Tok::Str(decode_escapes(body, loc)?)
        }
    };
    Ok(Token { tok, loc })
}

fn wide_kind(text: &[u8]) -> Option<WideKind> {
    match text {
        [b'L', b'"' | b'\'', ..] => Some(WideKind::Wchar),
        [b'u', b'"' | b'\'', ..] => Some(WideKind::Char16),
        [b'U', b'"' | b'\'', ..] => Some(WideKind::Char32),
        _ => None,
    }
}

/// Strips the encoding prefix and the quotes from a literal's spelling.
fn literal_body(text: &[u8], quote: u8, loc: Loc) -> Res<&[u8]> {
    let start = strings::index_of_char_usize(text, quote).unwrap_or(0);
    if text.len() < start + 2 || text[text.len() - 1] != quote {
        return err(loc, "malformed literal");
    }
    Ok(&text[start + 1..text.len() - 1])
}

/// Decodes the body of a wide literal: source characters are UTF-8 code points, numeric
/// escapes are taken as written.
fn decode_wide(body: &[u8], loc: Loc) -> Res<Vec<u32>> {
    let mut out = Vec::new();
    let mut i = 0;
    while i < body.len() {
        if body[i] != b'\\' {
            let rest = &body[i..];
            let len = match rest[0] {
                0..=0x7f => 1,
                0xc0..=0xdf => 2,
                0xe0..=0xef => 3,
                _ => 4,
            };
            match rest
                .get(..len)
                .and_then(|chunk| std::str::from_utf8(chunk).ok())
                .and_then(|t| t.chars().next())
            {
                Some(c) => {
                    out.push(c as u32);
                    i += len;
                }
                None => {
                    out.push(u32::from(rest[0]));
                    i += 1;
                }
            }
            continue;
        }
        // Find the extent of the escape, then reuse the narrow decoder for simple ones.
        let Some(&e) = body.get(i + 1) else {
            return err(loc, "incomplete escape sequence");
        };
        i += 2;
        match e {
            b'x' => {
                let mut v: u32 = 0;
                let mut n = 0;
                while let Some(d) = body.get(i).and_then(|&b| hex_digit(b)) {
                    v = v.wrapping_mul(16).wrapping_add(d);
                    i += 1;
                    n += 1;
                }
                if n == 0 {
                    return err(loc, "\\x used with no following hex digits");
                }
                out.push(v);
            }
            b'0'..=b'7' => {
                let mut v = u32::from(e - b'0');
                let mut n = 1;
                while n < 3 && i < body.len() && (b'0'..=b'7').contains(&body[i]) {
                    v = v * 8 + u32::from(body[i] - b'0');
                    i += 1;
                    n += 1;
                }
                out.push(v);
            }
            b'u' | b'U' => {
                let want = if e == b'u' { 4 } else { 8 };
                let mut v: u32 = 0;
                for _ in 0..want {
                    let Some(d) = body.get(i).and_then(|&b| hex_digit(b)) else {
                        return err(loc, "incomplete universal character name");
                    };
                    v = v.wrapping_mul(16).wrapping_add(d);
                    i += 1;
                }
                out.push(v);
            }
            _ => {
                let simple = decode_escapes(&[b'\\', e], loc)?;
                out.extend(simple.iter().map(|&b| u32::from(b)));
            }
        }
    }
    Ok(out)
}

/// Bytes as text for diagnostics; invalid UTF-8 sequences become U+FFFD.
pub(crate) fn display_bytes(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len());
    for chunk in bytes.utf8_chunks() {
        out.push_str(chunk.valid());
        if !chunk.invalid().is_empty() {
            out.push('\u{fffd}');
        }
    }
    out
}

fn hex_digit(b: u8) -> Option<u32> {
    (b as char).to_digit(16)
}

fn decode_escapes(body: &[u8], loc: Loc) -> Res<Vec<u8>> {
    let mut out = Vec::with_capacity(body.len());
    let mut i = 0;
    while i < body.len() {
        let b = body[i];
        i += 1;
        if b != b'\\' {
            out.push(b);
            continue;
        }
        let Some(&e) = body.get(i) else {
            return err(loc, "incomplete escape sequence");
        };
        i += 1;
        match e {
            b'n' => out.push(b'\n'),
            b't' => out.push(b'\t'),
            b'r' => out.push(b'\r'),
            b'a' => out.push(7),
            b'b' => out.push(8),
            b'f' => out.push(12),
            b'v' => out.push(11),
            b'e' => out.push(27),
            b'\\' | b'\'' | b'"' | b'?' => out.push(e),
            b'0'..=b'7' => {
                let mut v = u32::from(e - b'0');
                let mut n = 1;
                while n < 3 && i < body.len() && (b'0'..=b'7').contains(&body[i]) {
                    v = v * 8 + u32::from(body[i] - b'0');
                    i += 1;
                    n += 1;
                }
                if v > 255 {
                    return err(loc, "octal escape sequence out of range");
                }
                out.push(v as u8);
            }
            b'x' => {
                let mut v: u32 = 0;
                let mut n = 0;
                while let Some(d) = body.get(i).and_then(|&b| hex_digit(b)) {
                    v = v.saturating_mul(16).saturating_add(d);
                    i += 1;
                    n += 1;
                }
                if n == 0 {
                    return err(loc, "\\x used with no following hex digits");
                }
                if v > 255 {
                    return err(loc, "hex escape sequence out of range");
                }
                out.push(v as u8);
            }
            b'u' | b'U' => {
                let want = if e == b'u' { 4 } else { 8 };
                let mut v: u32 = 0;
                for _ in 0..want {
                    let Some(d) = body.get(i).and_then(|&b| hex_digit(b)) else {
                        return err(loc, "incomplete universal character name");
                    };
                    v = v.wrapping_mul(16).wrapping_add(d);
                    i += 1;
                }
                let Some(c) = char::from_u32(v) else {
                    return err(loc, "invalid universal character name");
                };
                let mut buf = [0u8; 4];
                out.extend_from_slice(c.encode_utf8(&mut buf).as_bytes());
            }
            _ => return err(loc, format!("unknown escape sequence '\\{}'", e as char)),
        }
    }
    Ok(out)
}

fn parse_number(text: &[u8], loc: Loc) -> Res<Tok> {
    // GNU imaginary constants: one `i` or `j` among the suffix letters (`1.0iF`, `2if`, `3j`).
    let mut suffix_start = text.len();
    while suffix_start > 0
        && matches!(
            text[suffix_start - 1] | 0x20,
            b'f' | b'l' | b'u' | b'i' | b'j'
        )
    {
        suffix_start -= 1;
    }
    let mut imaginary_at = None;
    for (offset, b) in text[suffix_start..].iter().enumerate() {
        if matches!(b | 0x20, b'i' | b'j') {
            if imaginary_at.is_some() {
                return err(loc, format!("invalid constant '{}'", display_bytes(text)));
            }
            imaginary_at = Some(suffix_start + offset);
        }
    }
    if let Some(at) = imaginary_at {
        let mut real = text.to_vec();
        real.remove(at);
        return Ok(match parse_number(&real, loc)? {
            Tok::Float {
                value,
                single,
                long_double,
                ..
            } => Tok::Float {
                value,
                single,
                long_double,
                imaginary: true,
            },
            // An integer imaginary constant is given type `double _Complex`.
            Tok::Int { value, .. } => Tok::Float {
                value: value as f64,
                single: false,
                long_double: None,
                imaginary: true,
            },
            other => other,
        });
    }
    let is_hex = text.len() > 2 && text[0] == b'0' && (text[1] | 0x20) == b'x';
    let is_float = strings::index_of_any(text, if is_hex { b".pP" } else { b".eE" }).is_some();
    if is_float {
        parse_float(text, is_hex, loc)
    } else {
        parse_int(text, is_hex, loc)
    }
}

fn parse_int(text: &[u8], is_hex: bool, loc: Loc) -> Res<Tok> {
    let is_bin = text.len() > 2 && text[0] == b'0' && (text[1] | 0x20) == b'b';
    let (radix, digits_start) = if is_hex {
        (16, 2)
    } else if is_bin {
        (2, 2)
    } else if text.len() > 1 && text[0] == b'0' {
        (8, 1)
    } else {
        (10, 0)
    };
    let mut i = digits_start;
    let mut value: u64 = 0;
    let mut ndigits = 0;
    while i < text.len() {
        let b = text[i];
        if b == b'\'' {
            i += 1;
            continue;
        }
        let Some(d) = (b as char).to_digit(radix) else {
            break;
        };
        value = match value
            .checked_mul(u64::from(radix))
            .and_then(|v| v.checked_add(u64::from(d)))
        {
            Some(v) => v,
            None => return err(loc, "integer constant is too large"),
        };
        ndigits += 1;
        i += 1;
    }
    if ndigits == 0 && digits_start > 0 && radix != 8 {
        return err(loc, "invalid integer constant");
    }
    let suffix_text = text[i..].to_ascii_lowercase();
    let suffix = match suffix_text.as_slice() {
        b"" => IntSuffix {
            unsigned: false,
            longs: 0,
        },
        b"u" => IntSuffix {
            unsigned: true,
            longs: 0,
        },
        b"l" => IntSuffix {
            unsigned: false,
            longs: 1,
        },
        b"ul" | b"lu" => IntSuffix {
            unsigned: true,
            longs: 1,
        },
        b"ll" => IntSuffix {
            unsigned: false,
            longs: 2,
        },
        b"ull" | b"llu" => IntSuffix {
            unsigned: true,
            longs: 2,
        },
        // Microsoft's: the width in bits.
        b"i8" | b"i16" | b"i32" => IntSuffix {
            unsigned: false,
            longs: 0,
        },
        b"ui8" | b"ui16" | b"ui32" => IntSuffix {
            unsigned: true,
            longs: 0,
        },
        b"i64" => IntSuffix {
            unsigned: false,
            longs: 2,
        },
        b"ui64" => IntSuffix {
            unsigned: true,
            longs: 2,
        },
        _ => {
            return err(
                loc,
                format!("invalid integer constant '{}'", display_bytes(text)),
            );
        }
    };
    // `1lL` is not a valid suffix even though it lowercases to `ll`.
    let raw_suffix = &text[i..];
    if strings::contains_char(raw_suffix, b'l') && strings::contains_char(raw_suffix, b'L') {
        return err(loc, "invalid integer suffix");
    }
    Ok(Tok::Int {
        value,
        decimal: radix == 10,
        suffix,
    })
}

fn parse_float(text: &[u8], is_hex: bool, loc: Loc) -> Res<Tok> {
    let bad = || -> Res<Tok> {
        err(
            loc,
            format!("invalid floating constant '{}'", display_bytes(text)),
        )
    };
    let (body, single, long_double) = match text.last().map(|b| b | 0x20) {
        Some(b'f') if !is_hex || strings::index_of_any(text, b"pP").is_some() => {
            (&text[..text.len() - 1], true, false)
        }
        Some(b'l') => (&text[..text.len() - 1], false, true),
        _ => (text, false, false),
    };
    // An `l` constant is also rounded to the x87 format, for the targets whose `long double`
    // that is.
    let (value, extended) = if is_hex {
        let Some((mantissa, exponent, sticky)) = parse_hex_float(&body[2..]) else {
            return bad();
        };
        (
            extended::round_to_f64(mantissa, exponent, sticky),
            long_double.then(|| Extended::from_scaled(false, mantissa, exponent, sticky)),
        )
    } else {
        let valid = body
            .iter()
            .all(|&b| b.is_ascii_digit() || matches!(b, b'.' | b'e' | b'E' | b'+' | b'-'));
        let parsed = std::str::from_utf8(body)
            .ok()
            .filter(|_| valid)
            .and_then(|s| s.parse::<f64>().ok());
        let (Some(value), Some((digits, exponent))) = (parsed, parse_decimal_float(body)) else {
            return bad();
        };
        (
            value,
            long_double.then(|| Extended::from_decimal(&digits, exponent)),
        )
    };
    // Round once, to the constant's own type.
    let value = if single {
        f64::from(value as f32)
    } else {
        value
    };
    Ok(Tok::Float {
        value,
        single,
        long_double: extended,
        imaginary: false,
    })
}

/// Parses `hexdigits[.hexdigits]p[+-]digits` (the part after `0x`): the value is
/// `mantissa * 2^exponent`, and `sticky` says nonzero digits beyond the mantissa were dropped.
fn parse_hex_float(s: &[u8]) -> Option<(u128, i64, bool)> {
    let mut mantissa: u128 = 0;
    let mut exponent: i64 = 0;
    let mut seen_digit = false;
    let mut seen_point = false;
    let mut sticky = false;
    let mut i = 0;
    while i < s.len() {
        let b = s[i];
        if b == b'.' {
            if seen_point {
                return None;
            }
            seen_point = true;
        } else if let Some(d) = hex_digit(b) {
            seen_digit = true;
            if mantissa >> 120 == 0 {
                mantissa = mantissa * 16 + u128::from(d);
                if seen_point {
                    exponent -= 4;
                }
            } else {
                // Digits beyond 120 bits of precision only scale the value, and decide ties.
                sticky |= d != 0;
                if !seen_point {
                    exponent += 4;
                }
            }
        } else {
            break;
        }
        i += 1;
    }
    if !seen_digit || i >= s.len() || (s[i] | 0x20) != b'p' {
        return None;
    }
    i += 1;
    let mut negative = false;
    if let Some(&sign) = s.get(i) {
        if sign == b'+' || sign == b'-' {
            negative = sign == b'-';
            i += 1;
        }
    }
    if i >= s.len() {
        return None;
    }
    let mut exp: i64 = 0;
    while i < s.len() {
        if !s[i].is_ascii_digit() {
            return None;
        }
        exp = (exp * 10 + i64::from(s[i] - b'0')).min(100_000);
        i += 1;
    }
    exponent += if negative { -exp } else { exp };
    Some((mantissa, exponent.clamp(-100_000, 100_000), sticky))
}

/// The digits of `digits[.digits][e[+-]digits]` without the point, and the power of ten they
/// are scaled by.
fn parse_decimal_float(s: &[u8]) -> Option<(Vec<u8>, i64)> {
    let mut digits = Vec::with_capacity(s.len());
    let mut exponent: i64 = 0;
    let mut seen_point = false;
    let mut i = 0;
    while i < s.len() {
        match s[i] {
            b'.' if !seen_point => seen_point = true,
            d @ b'0'..=b'9' => {
                digits.push(d);
                exponent -= i64::from(seen_point);
            }
            _ => break,
        }
        i += 1;
    }
    if digits.is_empty() {
        return None;
    }
    if i == s.len() {
        return Some((digits, exponent));
    }
    if (s[i] | 0x20) != b'e' {
        return None;
    }
    i += 1;
    let negative = s.get(i) == Some(&b'-');
    if matches!(s.get(i), Some(b'+' | b'-')) {
        i += 1;
    }
    if i >= s.len() {
        return None;
    }
    let mut written: i64 = 0;
    for &d in &s[i..] {
        if !d.is_ascii_digit() {
            return None;
        }
        written = (written * 10 + i64::from(d - b'0')).min(1_000_000);
    }
    Some((digits, exponent + if negative { -written } else { written }))
}
