// internal/scanner/scanner.go: the scanner, the text of tokens, trivia, the error range of a node, line and column maps, comment ranges.
use crate::ast::{
    self, Arg, Ast, CommentDirective, CommentDirectiveKind, CommentRange, Kind, NodeFlags, NodeId,
    SourceFileLike, TokenFlags,
};
use crate::core::{
    LanguageVariant, ScriptTarget, TextPos, TextRange, UTF16Offset, new_text_range, utf16_len,
};
use crate::diagnostics::{self, MessageId};
use crate::jsnum;
use crate::scanner::utilities::token_is_identifier_or_keyword;
use crate::stringutil;
use crate::stringutil::util::{utf8, utf16};
use bun_core::strings;
use std::borrow::Cow;

// A rune is Go's int32 here: `char` answers -1 at the end of the text, and the escapes answer -1 for an invalid one.
type Rune = i32;

// utf8.RuneSelf
const RUNE_SELF: Rune = 0x80;
// utf8.RuneError
const RUNE_ERROR: Rune = 0xFFFD;

// A rune literal.
const fn r(ch: char) -> Rune {
    ch as Rune
}

// The character that a `switch` over ASCII cases tests: a value outside ASCII matches none of them.
#[inline]
fn ascii(ch: Rune) -> char {
    match u8::try_from(ch) {
        Ok(b) if b < 0x80 => b as char,
        _ => '\u{FFFF}',
    }
}

// `text[pos]` as a rune: -1 outside the text, where Go panics.
#[inline]
fn at(text: &[u8], pos: i32) -> Rune {
    match usize::try_from(pos).ok().and_then(|pos| text.get(pos)) {
        Some(&b) => Rune::from(b),
        None => -1,
    }
}

// `text[start:end]`: an index outside the text is moved to the nearest end of it, where Go panics.
#[inline]
fn slice(text: &[u8], start: i32, end: i32) -> &[u8] {
    let end = usize::try_from(end).unwrap_or(0).min(text.len());
    let start = usize::try_from(start).unwrap_or(0).min(end);
    text.get(start..end).unwrap_or(&[])
}

// `text[start:]`
#[inline]
fn slice_from(text: &[u8], start: i32) -> &[u8] {
    let start = usize::try_from(start).unwrap_or(0).min(text.len());
    text.get(start..).unwrap_or(&[])
}

// `len(text)` as a position.
#[inline]
fn len(text: &[u8]) -> i32 {
    i32::try_from(text.len()).unwrap_or(i32::MAX)
}

// utf8.DecodeRuneInString: (RuneError, 0) for an empty text, (RuneError, 1) for a byte that starts no valid encoding.
#[inline]
fn decode_rune(text: &[u8]) -> (Rune, i32) {
    let (ch, size) = utf8::decode_rune_in_string(text);
    (ch as Rune, size as i32)
}

// utf8.DecodeLastRuneInString
#[inline]
fn decode_last_rune(text: &[u8]) -> (Rune, i32) {
    let (ch, size) = utf8::decode_last_rune_in_string(text);
    (ch as Rune, size as i32)
}

// string(rune) and strings.Builder.WriteRune: a value that is no code point is written as U+FFFD.
#[inline]
fn append_rune(out: &mut Vec<u8>, ch: Rune) {
    utf8::append_rune(out, u32::try_from(ch).unwrap_or(0xFFFD));
}

fn rune_to_string(ch: Rune) -> Vec<u8> {
    let mut out = Vec::with_capacity(4);
    append_rune(&mut out, ch);
    out
}

#[inline]
fn is_line_break(ch: Rune) -> bool {
    stringutil::is_line_break(ch as u32)
}

#[inline]
fn is_white_space_single_line(ch: Rune) -> bool {
    stringutil::is_white_space_single_line(ch as u32)
}

#[inline]
fn is_white_space_like(ch: Rune) -> bool {
    stringutil::is_white_space_like(ch as u32)
}

#[inline]
fn is_digit(ch: Rune) -> bool {
    stringutil::is_digit(ch as u32)
}

#[inline]
fn is_octal_digit(ch: Rune) -> bool {
    stringutil::is_octal_digit(ch as u32)
}

#[inline]
fn is_hex_digit(ch: Rune) -> bool {
    stringutil::is_hex_digit(ch as u32)
}

#[inline]
fn is_ascii_letter(ch: Rune) -> bool {
    stringutil::is_ascii_letter(ch as u32)
}

// strconv.ParseInt of digits without a sign: the largest value of the bit size when the digits do not fit, 0 for a text that is no number.
fn parse_int(digits: &[u8], base: u32, bit_size: u32) -> i64 {
    let max: i64 = if bit_size >= 64 {
        i64::MAX
    } else {
        (1i64 << (bit_size - 1)) - 1
    };
    if digits.is_empty() {
        return 0;
    }
    let mut value: i64 = 0;
    let mut overflow = false;
    for &b in digits {
        let digit = match (b as char).to_digit(base) {
            Some(digit) => i64::from(digit),
            None => return 0,
        };
        if !overflow {
            match value
                .checked_mul(i64::from(base))
                .and_then(|v| v.checked_add(digit))
            {
                Some(v) if v <= max => value = v,
                _ => overflow = true,
            }
        }
    }
    if overflow { max } else { value }
}

// strconv.FormatInt of a value that is not negative.
fn format_int(value: i64, base: i64) -> Vec<u8> {
    if value <= 0 {
        return b"0".to_vec();
    }
    let mut digits = Vec::new();
    let mut value = value;
    while value > 0 {
        let digit = (value % base) as u8;
        digits.push(if digit < 10 {
            b'0' + digit
        } else {
            b'a' + (digit - 10)
        });
        value /= base;
    }
    digits.reverse();
    digits
}

// fmt.Sprintf("\\x%02x", code)
fn format_hex_escape(code: i64) -> Vec<u8> {
    let mut out = b"\\x".to_vec();
    let digits = format_int(code, 16);
    if digits.len() < 2 {
        out.push(b'0');
    }
    out.extend_from_slice(&digits);
    out
}

#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq, Hash, Default, Debug)]
pub struct EscapeSequenceScanningFlags(pub i32);

impl EscapeSequenceScanningFlags {
    pub const NONE: Self = Self(0);
    pub const STRING: Self = Self(1 << 0);
    pub const REPORT_ERRORS: Self = Self(1 << 1);
    pub const REGULAR_EXPRESSION: Self = Self(1 << 2);
    pub const ANNEX_B: Self = Self(1 << 3);
    pub const ANY_UNICODE_MODE: Self = Self(1 << 4);
    pub const ATOM_ESCAPE: Self = Self(1 << 5);
    pub const REPORT_INVALID_ESCAPE_ERRORS: Self =
        Self(Self::REGULAR_EXPRESSION.0 | Self::REPORT_ERRORS.0);
    pub const ALLOW_EXTENDED_UNICODE_ESCAPE: Self = Self(Self::STRING.0 | Self::ANY_UNICODE_MODE.0);

    #[inline]
    pub const fn intersects(self, other: Self) -> bool {
        self.0 & other.0 != 0
    }
}

impl std::ops::BitOr for EscapeSequenceScanningFlags {
    type Output = Self;
    #[inline]
    fn bitor(self, rhs: Self) -> Self {
        Self(self.0 | rhs.0)
    }
}

pub type ErrorCallback<'a> = Box<dyn FnMut(MessageId, i32, i32, &[Arg<'_>]) + 'a>;

// textToKeyword
pub(crate) fn text_to_keyword(text: &[u8]) -> Kind {
    match text {
        b"abstract" => Kind::AbstractKeyword,
        b"accessor" => Kind::AccessorKeyword,
        b"any" => Kind::AnyKeyword,
        b"as" => Kind::AsKeyword,
        b"asserts" => Kind::AssertsKeyword,
        b"assert" => Kind::AssertKeyword,
        b"bigint" => Kind::BigIntKeyword,
        b"boolean" => Kind::BooleanKeyword,
        b"break" => Kind::BreakKeyword,
        b"case" => Kind::CaseKeyword,
        b"catch" => Kind::CatchKeyword,
        b"class" => Kind::ClassKeyword,
        b"continue" => Kind::ContinueKeyword,
        b"const" => Kind::ConstKeyword,
        b"constructor" => Kind::ConstructorKeyword,
        b"debugger" => Kind::DebuggerKeyword,
        b"declare" => Kind::DeclareKeyword,
        b"default" => Kind::DefaultKeyword,
        b"defer" => Kind::DeferKeyword,
        b"delete" => Kind::DeleteKeyword,
        b"do" => Kind::DoKeyword,
        b"else" => Kind::ElseKeyword,
        b"enum" => Kind::EnumKeyword,
        b"export" => Kind::ExportKeyword,
        b"extends" => Kind::ExtendsKeyword,
        b"false" => Kind::FalseKeyword,
        b"finally" => Kind::FinallyKeyword,
        b"for" => Kind::ForKeyword,
        b"from" => Kind::FromKeyword,
        b"function" => Kind::FunctionKeyword,
        b"get" => Kind::GetKeyword,
        b"if" => Kind::IfKeyword,
        b"immediate" => Kind::ImmediateKeyword,
        b"implements" => Kind::ImplementsKeyword,
        b"import" => Kind::ImportKeyword,
        b"in" => Kind::InKeyword,
        b"infer" => Kind::InferKeyword,
        b"instanceof" => Kind::InstanceOfKeyword,
        b"interface" => Kind::InterfaceKeyword,
        b"intrinsic" => Kind::IntrinsicKeyword,
        b"is" => Kind::IsKeyword,
        b"keyof" => Kind::KeyOfKeyword,
        b"let" => Kind::LetKeyword,
        b"module" => Kind::ModuleKeyword,
        b"namespace" => Kind::NamespaceKeyword,
        b"never" => Kind::NeverKeyword,
        b"new" => Kind::NewKeyword,
        b"null" => Kind::NullKeyword,
        b"number" => Kind::NumberKeyword,
        b"object" => Kind::ObjectKeyword,
        b"package" => Kind::PackageKeyword,
        b"private" => Kind::PrivateKeyword,
        b"protected" => Kind::ProtectedKeyword,
        b"public" => Kind::PublicKeyword,
        b"override" => Kind::OverrideKeyword,
        b"out" => Kind::OutKeyword,
        b"readonly" => Kind::ReadonlyKeyword,
        b"require" => Kind::RequireKeyword,
        b"global" => Kind::GlobalKeyword,
        b"return" => Kind::ReturnKeyword,
        b"satisfies" => Kind::SatisfiesKeyword,
        b"set" => Kind::SetKeyword,
        b"static" => Kind::StaticKeyword,
        b"string" => Kind::StringKeyword,
        b"super" => Kind::SuperKeyword,
        b"switch" => Kind::SwitchKeyword,
        b"symbol" => Kind::SymbolKeyword,
        b"this" => Kind::ThisKeyword,
        b"throw" => Kind::ThrowKeyword,
        b"true" => Kind::TrueKeyword,
        b"try" => Kind::TryKeyword,
        b"type" => Kind::TypeKeyword,
        b"typeof" => Kind::TypeOfKeyword,
        b"undefined" => Kind::UndefinedKeyword,
        b"unique" => Kind::UniqueKeyword,
        b"unknown" => Kind::UnknownKeyword,
        b"using" => Kind::UsingKeyword,
        b"var" => Kind::VarKeyword,
        b"void" => Kind::VoidKeyword,
        b"while" => Kind::WhileKeyword,
        b"with" => Kind::WithKeyword,
        b"yield" => Kind::YieldKeyword,
        b"async" => Kind::AsyncKeyword,
        b"await" => Kind::AwaitKeyword,
        b"of" => Kind::OfKeyword,
        _ => Kind::Unknown,
    }
}

// textToToken: the punctuation, then the keywords.
fn text_to_token(text: &[u8]) -> Kind {
    match text {
        b"{" => Kind::OpenBraceToken,
        b"}" => Kind::CloseBraceToken,
        b"(" => Kind::OpenParenToken,
        b")" => Kind::CloseParenToken,
        b"[" => Kind::OpenBracketToken,
        b"]" => Kind::CloseBracketToken,
        b"." => Kind::DotToken,
        b"..." => Kind::DotDotDotToken,
        b";" => Kind::SemicolonToken,
        b"," => Kind::CommaToken,
        b"<" => Kind::LessThanToken,
        b">" => Kind::GreaterThanToken,
        b"<=" => Kind::LessThanEqualsToken,
        b">=" => Kind::GreaterThanEqualsToken,
        b"==" => Kind::EqualsEqualsToken,
        b"!=" => Kind::ExclamationEqualsToken,
        b"===" => Kind::EqualsEqualsEqualsToken,
        b"!==" => Kind::ExclamationEqualsEqualsToken,
        b"=>" => Kind::EqualsGreaterThanToken,
        b"+" => Kind::PlusToken,
        b"-" => Kind::MinusToken,
        b"**" => Kind::AsteriskAsteriskToken,
        b"*" => Kind::AsteriskToken,
        b"/" => Kind::SlashToken,
        b"%" => Kind::PercentToken,
        b"++" => Kind::PlusPlusToken,
        b"--" => Kind::MinusMinusToken,
        b"<<" => Kind::LessThanLessThanToken,
        b"</" => Kind::LessThanSlashToken,
        b">>" => Kind::GreaterThanGreaterThanToken,
        b">>>" => Kind::GreaterThanGreaterThanGreaterThanToken,
        b"&" => Kind::AmpersandToken,
        b"|" => Kind::BarToken,
        b"^" => Kind::CaretToken,
        b"!" => Kind::ExclamationToken,
        b"~" => Kind::TildeToken,
        b"&&" => Kind::AmpersandAmpersandToken,
        b"||" => Kind::BarBarToken,
        b"?" => Kind::QuestionToken,
        b"??" => Kind::QuestionQuestionToken,
        b"?." => Kind::QuestionDotToken,
        b":" => Kind::ColonToken,
        b"=" => Kind::EqualsToken,
        b"+=" => Kind::PlusEqualsToken,
        b"-=" => Kind::MinusEqualsToken,
        b"*=" => Kind::AsteriskEqualsToken,
        b"**=" => Kind::AsteriskAsteriskEqualsToken,
        b"/=" => Kind::SlashEqualsToken,
        b"%=" => Kind::PercentEqualsToken,
        b"<<=" => Kind::LessThanLessThanEqualsToken,
        b">>=" => Kind::GreaterThanGreaterThanEqualsToken,
        b">>>=" => Kind::GreaterThanGreaterThanGreaterThanEqualsToken,
        b"&=" => Kind::AmpersandEqualsToken,
        b"|=" => Kind::BarEqualsToken,
        b"^=" => Kind::CaretEqualsToken,
        b"||=" => Kind::BarBarEqualsToken,
        b"&&=" => Kind::AmpersandAmpersandEqualsToken,
        b"??=" => Kind::QuestionQuestionEqualsToken,
        b"@" => Kind::AtToken,
        b"#" => Kind::HashToken,
        b"`" => Kind::BacktickToken,
        _ => text_to_keyword(text),
    }
}

// tokenToText: the inverse of textToToken.
fn token_to_text(token: Kind) -> &'static [u8] {
    match token {
        Kind::OpenBraceToken => b"{",
        Kind::CloseBraceToken => b"}",
        Kind::OpenParenToken => b"(",
        Kind::CloseParenToken => b")",
        Kind::OpenBracketToken => b"[",
        Kind::CloseBracketToken => b"]",
        Kind::DotToken => b".",
        Kind::DotDotDotToken => b"...",
        Kind::SemicolonToken => b";",
        Kind::CommaToken => b",",
        Kind::LessThanToken => b"<",
        Kind::GreaterThanToken => b">",
        Kind::LessThanEqualsToken => b"<=",
        Kind::GreaterThanEqualsToken => b">=",
        Kind::EqualsEqualsToken => b"==",
        Kind::ExclamationEqualsToken => b"!=",
        Kind::EqualsEqualsEqualsToken => b"===",
        Kind::ExclamationEqualsEqualsToken => b"!==",
        Kind::EqualsGreaterThanToken => b"=>",
        Kind::PlusToken => b"+",
        Kind::MinusToken => b"-",
        Kind::AsteriskAsteriskToken => b"**",
        Kind::AsteriskToken => b"*",
        Kind::SlashToken => b"/",
        Kind::PercentToken => b"%",
        Kind::PlusPlusToken => b"++",
        Kind::MinusMinusToken => b"--",
        Kind::LessThanLessThanToken => b"<<",
        Kind::LessThanSlashToken => b"</",
        Kind::GreaterThanGreaterThanToken => b">>",
        Kind::GreaterThanGreaterThanGreaterThanToken => b">>>",
        Kind::AmpersandToken => b"&",
        Kind::BarToken => b"|",
        Kind::CaretToken => b"^",
        Kind::ExclamationToken => b"!",
        Kind::TildeToken => b"~",
        Kind::AmpersandAmpersandToken => b"&&",
        Kind::BarBarToken => b"||",
        Kind::QuestionToken => b"?",
        Kind::QuestionQuestionToken => b"??",
        Kind::QuestionDotToken => b"?.",
        Kind::ColonToken => b":",
        Kind::EqualsToken => b"=",
        Kind::PlusEqualsToken => b"+=",
        Kind::MinusEqualsToken => b"-=",
        Kind::AsteriskEqualsToken => b"*=",
        Kind::AsteriskAsteriskEqualsToken => b"**=",
        Kind::SlashEqualsToken => b"/=",
        Kind::PercentEqualsToken => b"%=",
        Kind::LessThanLessThanEqualsToken => b"<<=",
        Kind::GreaterThanGreaterThanEqualsToken => b">>=",
        Kind::GreaterThanGreaterThanGreaterThanEqualsToken => b">>>=",
        Kind::AmpersandEqualsToken => b"&=",
        Kind::BarEqualsToken => b"|=",
        Kind::CaretEqualsToken => b"^=",
        Kind::BarBarEqualsToken => b"||=",
        Kind::AmpersandAmpersandEqualsToken => b"&&=",
        Kind::QuestionQuestionEqualsToken => b"??=",
        Kind::AtToken => b"@",
        Kind::HashToken => b"#",
        Kind::BacktickToken => b"`",
        Kind::AbstractKeyword => b"abstract",
        Kind::AccessorKeyword => b"accessor",
        Kind::AnyKeyword => b"any",
        Kind::AsKeyword => b"as",
        Kind::AssertsKeyword => b"asserts",
        Kind::AssertKeyword => b"assert",
        Kind::BigIntKeyword => b"bigint",
        Kind::BooleanKeyword => b"boolean",
        Kind::BreakKeyword => b"break",
        Kind::CaseKeyword => b"case",
        Kind::CatchKeyword => b"catch",
        Kind::ClassKeyword => b"class",
        Kind::ContinueKeyword => b"continue",
        Kind::ConstKeyword => b"const",
        Kind::ConstructorKeyword => b"constructor",
        Kind::DebuggerKeyword => b"debugger",
        Kind::DeclareKeyword => b"declare",
        Kind::DefaultKeyword => b"default",
        Kind::DeferKeyword => b"defer",
        Kind::DeleteKeyword => b"delete",
        Kind::DoKeyword => b"do",
        Kind::ElseKeyword => b"else",
        Kind::EnumKeyword => b"enum",
        Kind::ExportKeyword => b"export",
        Kind::ExtendsKeyword => b"extends",
        Kind::FalseKeyword => b"false",
        Kind::FinallyKeyword => b"finally",
        Kind::ForKeyword => b"for",
        Kind::FromKeyword => b"from",
        Kind::FunctionKeyword => b"function",
        Kind::GetKeyword => b"get",
        Kind::IfKeyword => b"if",
        Kind::ImmediateKeyword => b"immediate",
        Kind::ImplementsKeyword => b"implements",
        Kind::ImportKeyword => b"import",
        Kind::InKeyword => b"in",
        Kind::InferKeyword => b"infer",
        Kind::InstanceOfKeyword => b"instanceof",
        Kind::InterfaceKeyword => b"interface",
        Kind::IntrinsicKeyword => b"intrinsic",
        Kind::IsKeyword => b"is",
        Kind::KeyOfKeyword => b"keyof",
        Kind::LetKeyword => b"let",
        Kind::ModuleKeyword => b"module",
        Kind::NamespaceKeyword => b"namespace",
        Kind::NeverKeyword => b"never",
        Kind::NewKeyword => b"new",
        Kind::NullKeyword => b"null",
        Kind::NumberKeyword => b"number",
        Kind::ObjectKeyword => b"object",
        Kind::PackageKeyword => b"package",
        Kind::PrivateKeyword => b"private",
        Kind::ProtectedKeyword => b"protected",
        Kind::PublicKeyword => b"public",
        Kind::OverrideKeyword => b"override",
        Kind::OutKeyword => b"out",
        Kind::ReadonlyKeyword => b"readonly",
        Kind::RequireKeyword => b"require",
        Kind::GlobalKeyword => b"global",
        Kind::ReturnKeyword => b"return",
        Kind::SatisfiesKeyword => b"satisfies",
        Kind::SetKeyword => b"set",
        Kind::StaticKeyword => b"static",
        Kind::StringKeyword => b"string",
        Kind::SuperKeyword => b"super",
        Kind::SwitchKeyword => b"switch",
        Kind::SymbolKeyword => b"symbol",
        Kind::ThisKeyword => b"this",
        Kind::ThrowKeyword => b"throw",
        Kind::TrueKeyword => b"true",
        Kind::TryKeyword => b"try",
        Kind::TypeKeyword => b"type",
        Kind::TypeOfKeyword => b"typeof",
        Kind::UndefinedKeyword => b"undefined",
        Kind::UniqueKeyword => b"unique",
        Kind::UnknownKeyword => b"unknown",
        Kind::UsingKeyword => b"using",
        Kind::VarKeyword => b"var",
        Kind::VoidKeyword => b"void",
        Kind::WhileKeyword => b"while",
        Kind::WithKeyword => b"with",
        Kind::YieldKeyword => b"yield",
        Kind::AsyncKeyword => b"async",
        Kind::AwaitKeyword => b"await",
        Kind::OfKeyword => b"of",
        _ => b"",
    }
}

#[derive(Clone, Default)]
pub struct ScannerState<'a> {
    // Current position in text (and ending position of current token)
    pos: i32,
    // Starting position of current token including preceding whitespace
    full_start_pos: i32,
    // Starting position of non-whitespace part of current token
    token_start: i32,
    // Kind of current token
    token: Kind,
    // Parsed value of current token
    token_value: Cow<'a, [u8]>,
    // Flags for current token
    token_flags: TokenFlags,
    comment_directives: Vec<CommentDirective>,
    // Leading asterisks to skip when scanning types inside JSDoc. Should be 0 outside JSDoc
    skip_jsdoc_leading_asterisks: i32,
}

// Upstream also keeps three caches of normalized number texts per scanner: a cached text is the text that the scan computes, so they are left out.
pub struct Scanner<'a> {
    text: &'a [u8],
    end: i32,
    language_variant: LanguageVariant,
    script_target: ScriptTarget,
    on_error: Option<ErrorCallback<'a>>,
    skip_trivia: bool,
    state: ScannerState<'a>,
}

fn default_scanner<'a>() -> Scanner<'a> {
    Scanner {
        text: b"",
        end: 0,
        language_variant: LanguageVariant::default(),
        script_target: ScriptTarget::default(),
        on_error: None,
        skip_trivia: true,
        state: ScannerState::default(),
    }
}

pub fn new_scanner<'a>() -> Scanner<'a> {
    default_scanner()
}

impl<'a> Scanner<'a> {
    pub fn reset(&mut self) {
        *self = default_scanner();
    }

    pub fn text(&self) -> &'a [u8] {
        self.text
    }

    pub fn token(&self) -> Kind {
        self.state.token
    }

    pub fn token_flags(&self) -> TokenFlags {
        self.state.token_flags
    }

    pub fn token_full_start(&self) -> i32 {
        self.state.full_start_pos
    }

    pub fn token_start(&self) -> i32 {
        self.state.token_start
    }

    pub fn token_end(&self) -> i32 {
        self.state.pos
    }

    pub fn token_text(&self) -> &'a [u8] {
        slice(self.text, self.state.token_start, self.state.pos)
    }

    pub fn token_value(&self) -> &[u8] {
        &self.state.token_value
    }

    pub fn token_range(&self) -> TextRange {
        new_text_range(self.state.token_start as _, self.state.pos as _)
    }

    pub fn comment_directives(&self) -> &[CommentDirective] {
        &self.state.comment_directives
    }

    pub fn mark(&self) -> ScannerState<'a> {
        self.state.clone()
    }

    pub fn rewind(&mut self, state: ScannerState<'a>) {
        self.state = state;
    }

    // Err is upstream's panic with its message: the scanner is left as it was.
    pub fn reset_pos(&mut self, pos: i32) -> Result<(), &'static str> {
        if pos < 0 {
            return Err("Cannot reset token state to negative position");
        }
        self.state.pos = pos;
        self.state.full_start_pos = pos;
        self.state.token_start = pos;
        Ok(())
    }

    // Err is upstream's panic with its message: the scanner is left as it was.
    pub fn reset_token_state(&mut self, pos: i32) -> Result<(), &'static str> {
        self.reset_pos(pos)?;
        self.state.token = Kind::Unknown;
        self.state.token_value = Cow::Borrowed(b"");
        self.state.token_flags = TokenFlags::NONE;
        Ok(())
    }

    pub fn set_skip_jsdoc_leading_asterisks(&mut self, skip: bool) {
        if skip {
            self.state.skip_jsdoc_leading_asterisks += 1;
        } else {
            self.state.skip_jsdoc_leading_asterisks += -1;
        }
    }

    pub fn set_skip_trivia(&mut self, skip: bool) {
        self.skip_trivia = skip;
    }

    pub fn has_unicode_escape(&self) -> bool {
        self.state
            .token_flags
            .intersects(TokenFlags::UNICODE_ESCAPE)
    }

    pub fn has_extended_unicode_escape(&self) -> bool {
        self.state
            .token_flags
            .intersects(TokenFlags::EXTENDED_UNICODE_ESCAPE)
    }

    pub fn has_preceding_line_break(&self) -> bool {
        self.state
            .token_flags
            .intersects(TokenFlags::PRECEDING_LINE_BREAK)
    }

    pub fn has_preceding_jsdoc_comment(&self) -> bool {
        self.state
            .token_flags
            .intersects(TokenFlags::PRECEDING_JSDOC_COMMENT)
    }

    pub fn has_preceding_jsdoc_leading_asterisks(&self) -> bool {
        self.state
            .token_flags
            .intersects(TokenFlags::PRECEDING_JSDOC_LEADING_ASTERISKS)
    }

    pub fn has_preceding_jsdoc_with_deprecated_tag(&self) -> bool {
        self.state
            .token_flags
            .intersects(TokenFlags::PRECEDING_JSDOC_WITH_DEPRECATED)
    }

    pub fn has_preceding_jsdoc_with_see_or_link(&self) -> bool {
        self.state
            .token_flags
            .intersects(TokenFlags::PRECEDING_JSDOC_WITH_SEE_OR_LINK)
    }

    // scanJSDocCommentForTags scans a JSDoc comment for @deprecated, @see, and @link tags, setting the appropriate token flags. Called during scanning when a JSDoc comment is detected.
    fn scan_jsdoc_comment_for_tags(&mut self, comment_text: &[u8]) {
        let mut comment_text = comment_text;
        loop {
            let Some(i) = strings::index_of_char_usize(comment_text, b'@') else {
                return;
            };
            comment_text = comment_text.get(i + 1..).unwrap_or(&[]);
            if !self
                .state
                .token_flags
                .intersects(TokenFlags::PRECEDING_JSDOC_WITH_DEPRECATED)
                && has_jsdoc_tag(comment_text, &[b"deprecated"])
            {
                self.state.token_flags |= TokenFlags::PRECEDING_JSDOC_WITH_DEPRECATED;
            }
            if !self
                .state
                .token_flags
                .intersects(TokenFlags::PRECEDING_JSDOC_WITH_SEE_OR_LINK)
                && has_jsdoc_tag(comment_text, &[b"see", b"link", b"linkcode", b"linkplain"])
            {
                self.state.token_flags |= TokenFlags::PRECEDING_JSDOC_WITH_SEE_OR_LINK;
            }
            let both = TokenFlags::PRECEDING_JSDOC_WITH_DEPRECATED
                | TokenFlags::PRECEDING_JSDOC_WITH_SEE_OR_LINK;
            if self.state.token_flags & both == both {
                return;
            }
        }
    }
}

// hasJSDocTag reports whether text starts with one of the given tag names followed by a valid JSDoc tag terminator (whitespace, '}', '*', or end-of-string).
fn has_jsdoc_tag(text: &[u8], tags: &[&[u8]]) -> bool {
    for &tag in tags {
        if !strings::has_prefix(text, tag) {
            continue;
        }
        match text.get(tag.len()) {
            None => return true,
            Some(b' ' | b'\t' | b'\n' | b'\r' | b'}' | b'*') => return true,
            Some(_) => {}
        }
    }
    false
}

impl<'a> Scanner<'a> {
    pub fn set_text(&mut self, text: &'a [u8]) {
        self.text = text;
        self.end = len(text);
        self.state = ScannerState::default();
    }

    pub fn set_on_error(&mut self, error_callback: Option<ErrorCallback<'a>>) {
        self.on_error = error_callback;
    }

    pub fn set_language_variant(&mut self, language_variant: LanguageVariant) {
        self.language_variant = language_variant;
    }

    pub fn set_script_target(&mut self, script_target: ScriptTarget) {
        self.script_target = script_target;
    }

    pub fn language_version(&self) -> ScriptTarget {
        if self.script_target == ScriptTarget::NONE {
            return ScriptTarget::LATEST;
        }
        self.script_target
    }

    fn error(&mut self, diagnostic: MessageId) {
        self.error_at(diagnostic, self.state.pos, 0, &[]);
    }

    pub(crate) fn error_at(
        &mut self,
        diagnostic: MessageId,
        pos: i32,
        length: i32,
        args: &[Arg<'_>],
    ) {
        if let Some(on_error) = self.on_error.as_mut() {
            on_error(diagnostic, pos, length, args);
        }
    }

    // NOTE: even though this returns a rune, it only decodes the current byte. It must be checked against utf8.RuneSelf to verify that a call to charAndSize is not needed.
    #[inline]
    pub(crate) fn char(&self) -> Rune {
        if self.state.pos < self.end {
            return at(self.text, self.state.pos);
        }
        -1
    }

    // NOTE: this returns a rune, but only decodes the byte at the offset.
    #[inline]
    pub(crate) fn char_at(&self, offset: i32) -> Rune {
        if self.state.pos + offset < self.end {
            return at(self.text, self.state.pos + offset);
        }
        -1
    }

    #[inline]
    fn char_and_size(&self) -> (Rune, i32) {
        // Fast path: a single ASCII byte. The vast majority of source bytes are ASCII.
        if self.state.pos < self.end {
            let b = at(self.text, self.state.pos);
            if (0..RUNE_SELF).contains(&b) {
                return (b, 1);
            }
        }
        decode_rune(slice_from(self.text, self.state.pos))
    }

    // scanASCIIWhile advances s.pos over the longest run of ASCII bytes for which pred returns true. It stops at end-of-text, the first non-ASCII byte, or the first byte where pred is false.
    #[inline]
    fn scan_ascii_while(&mut self, pred: impl Fn(u8) -> bool) {
        let text = slice(self.text, self.state.pos, self.end);
        let mut i = 0;
        while let Some(&b) = text.get(i) {
            if b >= 0x80 || !pred(b) {
                break;
            }
            i += 1;
        }
        self.state.pos += i as i32;
    }

    pub fn scan(&mut self) -> Kind {
        self.state.full_start_pos = self.state.pos;
        self.state.token_flags = TokenFlags::NONE;
        'scan: loop {
            let ch = self.char();
            self.state.token_start = self.state.pos;

            // A `break 'token` is upstream's `break` out of the switch: the token is complete.
            'token: {
                match ascii(ch) {
                    '\t' | '\x0B' | '\x0C' | ' ' => {
                        self.state.pos += 1;
                        if self.skip_trivia {
                            continue 'scan;
                        }
                        loop {
                            let (ch, size) = self.char_and_size();
                            if !is_white_space_single_line(ch) {
                                break;
                            }
                            self.state.pos += size;
                        }
                        self.state.token = Kind::WhitespaceTrivia;
                    }
                    '\n' | '\r' => {
                        self.state.token_flags |= TokenFlags::PRECEDING_LINE_BREAK;
                        if self.skip_trivia {
                            self.state.pos += 1;
                            self.scan_ascii_while(|b| b == b' ' || (b'\t'..=b'\r').contains(&b));
                            continue 'scan;
                        }
                        if ch == r('\r') && self.char_at(1) == r('\n') {
                            self.state.pos += 2;
                        } else {
                            self.state.pos += 1;
                        }
                        self.state.token = Kind::NewLineTrivia;
                    }
                    '!' => {
                        if self.char_at(1) == r('=') {
                            if self.char_at(2) == r('=') {
                                self.state.pos += 3;
                                self.state.token = Kind::ExclamationEqualsEqualsToken;
                            } else {
                                self.state.pos += 2;
                                self.state.token = Kind::ExclamationEqualsToken;
                            }
                        } else {
                            self.state.pos += 1;
                            self.state.token = Kind::ExclamationToken;
                        }
                    }
                    '"' | '\'' => {
                        self.state.token_value = self.scan_string(false);
                        self.state.token = Kind::StringLiteral;
                    }
                    '`' => {
                        self.state.token = self.scan_template_and_set_token_value(false);
                    }
                    '%' => {
                        if self.char_at(1) == r('=') {
                            self.state.pos += 2;
                            self.state.token = Kind::PercentEqualsToken;
                        } else {
                            self.state.pos += 1;
                            self.state.token = Kind::PercentToken;
                        }
                    }
                    '&' => {
                        let next = self.char_at(1);
                        if next == r('&') {
                            if self.char_at(2) == r('=') {
                                self.state.pos += 3;
                                self.state.token = Kind::AmpersandAmpersandEqualsToken;
                            } else {
                                self.state.pos += 2;
                                self.state.token = Kind::AmpersandAmpersandToken;
                            }
                        } else if next == r('=') {
                            self.state.pos += 2;
                            self.state.token = Kind::AmpersandEqualsToken;
                        } else {
                            self.state.pos += 1;
                            self.state.token = Kind::AmpersandToken;
                        }
                    }
                    '(' => {
                        self.state.pos += 1;
                        self.state.token = Kind::OpenParenToken;
                    }
                    ')' => {
                        self.state.pos += 1;
                        self.state.token = Kind::CloseParenToken;
                    }
                    '*' => {
                        let next = self.char_at(1);
                        if next == r('=') {
                            self.state.pos += 2;
                            self.state.token = Kind::AsteriskEqualsToken;
                        } else if next == r('*') {
                            if self.char_at(2) == r('=') {
                                self.state.pos += 3;
                                self.state.token = Kind::AsteriskAsteriskEqualsToken;
                            } else {
                                self.state.pos += 2;
                                self.state.token = Kind::AsteriskAsteriskToken;
                            }
                        } else {
                            self.state.pos += 1;
                            if self.state.skip_jsdoc_leading_asterisks != 0
                                && !self
                                    .state
                                    .token_flags
                                    .intersects(TokenFlags::PRECEDING_JSDOC_LEADING_ASTERISKS)
                                && self
                                    .state
                                    .token_flags
                                    .intersects(TokenFlags::PRECEDING_LINE_BREAK)
                            {
                                self.state.token_flags |=
                                    TokenFlags::PRECEDING_JSDOC_LEADING_ASTERISKS;
                                continue 'scan;
                            }
                            self.state.token = Kind::AsteriskToken;
                        }
                    }
                    '+' => {
                        let next = self.char_at(1);
                        if next == r('=') {
                            self.state.pos += 2;
                            self.state.token = Kind::PlusEqualsToken;
                        } else if next == r('+') {
                            self.state.pos += 2;
                            self.state.token = Kind::PlusPlusToken;
                        } else {
                            self.state.pos += 1;
                            self.state.token = Kind::PlusToken;
                        }
                    }
                    ',' => {
                        self.state.pos += 1;
                        self.state.token = Kind::CommaToken;
                    }
                    '-' => {
                        let next = self.char_at(1);
                        if next == r('=') {
                            self.state.pos += 2;
                            self.state.token = Kind::MinusEqualsToken;
                        } else if next == r('-') {
                            self.state.pos += 2;
                            self.state.token = Kind::MinusMinusToken;
                        } else {
                            self.state.pos += 1;
                            self.state.token = Kind::MinusToken;
                        }
                    }
                    '.' => {
                        let next = self.char_at(1);
                        if is_digit(next) {
                            self.state.token = self.scan_number();
                        } else if next == r('.') && self.char_at(2) == r('.') {
                            self.state.pos += 3;
                            self.state.token = Kind::DotDotDotToken;
                        } else {
                            self.state.pos += 1;
                            self.state.token = Kind::DotToken;
                        }
                    }
                    '/' => {
                        // Single-line comment
                        if self.char_at(1) == r('/') {
                            self.state.pos += 2;

                            loop {
                                self.scan_ascii_while(|b| b != b'\n' && b != b'\r');
                                let (ch1, size) = self.char_and_size();
                                if size == 0 || is_line_break(ch1) {
                                    break;
                                }
                                self.state.pos += size;
                            }

                            self.process_comment_directive(
                                self.state.token_start,
                                self.state.pos,
                                false,
                            );

                            if self.skip_trivia {
                                continue 'scan;
                            }
                            self.state.token = Kind::SingleLineCommentTrivia;
                            return self.state.token;
                        }
                        // Multi-line comment
                        if self.char_at(1) == r('*') {
                            self.state.pos += 2;
                            let is_jsdoc = self.char() == r('*') && self.char_at(1) != r('/');

                            let mut comment_closed = false;
                            let mut last_line_start = self.state.token_start;
                            loop {
                                self.scan_ascii_while(|b| b != b'*' && b != b'\n' && b != b'\r');
                                let (ch1, size) = self.char_and_size();
                                if size == 0 {
                                    break;
                                }

                                if ch1 == r('*') && self.char_at(1) == r('/') {
                                    self.state.pos += 2;
                                    comment_closed = true;
                                    break;
                                }

                                self.state.pos += size;

                                if is_line_break(ch1) {
                                    last_line_start = self.state.pos;
                                    self.state.token_flags |= TokenFlags::PRECEDING_LINE_BREAK;
                                }
                            }

                            if is_jsdoc {
                                self.state.token_flags |= TokenFlags::PRECEDING_JSDOC_COMMENT;
                                let comment =
                                    slice(self.text, self.state.token_start, self.state.pos);
                                self.scan_jsdoc_comment_for_tags(comment);
                            }

                            self.process_comment_directive(last_line_start, self.state.pos, true);

                            if !comment_closed {
                                self.error(diagnostics::ASTERISK_SLASH_EXPECTED);
                            }

                            if self.skip_trivia {
                                continue 'scan;
                            }

                            if !comment_closed {
                                self.state.token_flags |= TokenFlags::UNTERMINATED;
                            }
                            self.state.token = Kind::MultiLineCommentTrivia;
                            return self.state.token;
                        }
                        if self.char_at(1) == r('=') {
                            self.state.pos += 2;
                            self.state.token = Kind::SlashEqualsToken;
                        } else {
                            self.state.pos += 1;
                            self.state.token = Kind::SlashToken;
                        }
                    }
                    '0'..='9' => {
                        if ch == r('0') {
                            if self.char_at(1) == r('X') || self.char_at(1) == r('x') {
                                let start = self.state.pos;
                                self.state.pos += 2;
                                let mut digits = self.scan_hex_digits(1, true, true);
                                if digits.is_empty() {
                                    self.error(diagnostics::HEXADECIMAL_DIGIT_EXPECTED);
                                    digits = Cow::Borrowed(b"0");
                                }
                                let raw_text = slice(self.text, start, self.state.pos);
                                if strings::has_prefix(raw_text, b"0x")
                                    && raw_text.get(2..) == Some(&*digits)
                                {
                                    self.state.token_value = Cow::Borrowed(raw_text);
                                } else {
                                    let mut value = b"0x".to_vec();
                                    value.extend_from_slice(&digits);
                                    self.state.token_value = Cow::Owned(value);
                                }
                                self.state.token_flags |= TokenFlags::HEX_SPECIFIER;
                                self.state.token = self.scan_big_int_suffix();
                                break 'token;
                            }
                            if self.char_at(1) == r('B') || self.char_at(1) == r('b') {
                                self.state.pos += 2;
                                let mut digits = self.scan_binary_or_octal_digits(2);
                                if digits.is_empty() {
                                    self.error(diagnostics::BINARY_DIGIT_EXPECTED);
                                    digits = b"0".to_vec();
                                }
                                let mut value = b"0b".to_vec();
                                value.extend_from_slice(&digits);
                                self.state.token_value = Cow::Owned(value);
                                self.state.token_flags |= TokenFlags::BINARY_SPECIFIER;
                                self.state.token = self.scan_big_int_suffix();
                                break 'token;
                            }
                            if self.char_at(1) == r('O') || self.char_at(1) == r('o') {
                                self.state.pos += 2;
                                let mut digits = self.scan_binary_or_octal_digits(8);
                                if digits.is_empty() {
                                    self.error(diagnostics::OCTAL_DIGIT_EXPECTED);
                                    digits = b"0".to_vec();
                                }
                                let mut value = b"0o".to_vec();
                                value.extend_from_slice(&digits);
                                self.state.token_value = Cow::Owned(value);
                                self.state.token_flags |= TokenFlags::OCTAL_SPECIFIER;
                                self.state.token = self.scan_big_int_suffix();
                                break 'token;
                            }
                        }
                        self.state.token = self.scan_number();
                    }
                    ':' => {
                        self.state.pos += 1;
                        self.state.token = Kind::ColonToken;
                    }
                    ';' => {
                        self.state.pos += 1;
                        self.state.token = Kind::SemicolonToken;
                    }
                    '<' => {
                        if self.char_at(1) == r('<')
                            && is_conflict_marker_trivia(self.text, self.state.pos)
                        {
                            self.scan_conflict_marker();
                            if self.skip_trivia {
                                continue 'scan;
                            } else {
                                self.state.token = Kind::ConflictMarkerTrivia;
                                return self.state.token;
                            }
                        }
                        if self.char_at(1) == r('<') {
                            if self.char_at(2) == r('=') {
                                self.state.pos += 3;
                                self.state.token = Kind::LessThanLessThanEqualsToken;
                            } else {
                                self.state.pos += 2;
                                self.state.token = Kind::LessThanLessThanToken;
                            }
                        } else if self.char_at(1) == r('=') {
                            self.state.pos += 2;
                            self.state.token = Kind::LessThanEqualsToken;
                        } else if self.language_variant == LanguageVariant::JSX
                            && self.char_at(1) == r('/')
                            && self.char_at(2) != r('*')
                        {
                            self.state.pos += 2;
                            self.state.token = Kind::LessThanSlashToken;
                        } else {
                            self.state.pos += 1;
                            self.state.token = Kind::LessThanToken;
                        }
                    }
                    '=' => {
                        if self.char_at(1) == r('=')
                            && is_conflict_marker_trivia(self.text, self.state.pos)
                        {
                            self.scan_conflict_marker();
                            if self.skip_trivia {
                                continue 'scan;
                            } else {
                                self.state.token = Kind::ConflictMarkerTrivia;
                                return self.state.token;
                            }
                        }
                        if self.char_at(1) == r('=') {
                            if self.char_at(2) == r('=') {
                                self.state.pos += 3;
                                self.state.token = Kind::EqualsEqualsEqualsToken;
                            } else {
                                self.state.pos += 2;
                                self.state.token = Kind::EqualsEqualsToken;
                            }
                        } else if self.char_at(1) == r('>') {
                            self.state.pos += 2;
                            self.state.token = Kind::EqualsGreaterThanToken;
                        } else {
                            self.state.pos += 1;
                            self.state.token = Kind::EqualsToken;
                        }
                    }
                    '>' => {
                        if self.char_at(1) == r('>')
                            && is_conflict_marker_trivia(self.text, self.state.pos)
                        {
                            self.scan_conflict_marker();
                            if self.skip_trivia {
                                continue 'scan;
                            } else {
                                self.state.token = Kind::ConflictMarkerTrivia;
                                return self.state.token;
                            }
                        }
                        self.state.pos += 1;
                        self.state.token = Kind::GreaterThanToken;
                    }
                    '?' => {
                        if self.char_at(1) == r('.') && !is_digit(self.char_at(2)) {
                            self.state.pos += 2;
                            self.state.token = Kind::QuestionDotToken;
                        } else if self.char_at(1) == r('?') {
                            if self.char_at(2) == r('=') {
                                self.state.pos += 3;
                                self.state.token = Kind::QuestionQuestionEqualsToken;
                            } else {
                                self.state.pos += 2;
                                self.state.token = Kind::QuestionQuestionToken;
                            }
                        } else {
                            self.state.pos += 1;
                            self.state.token = Kind::QuestionToken;
                        }
                    }
                    '[' => {
                        self.state.pos += 1;
                        self.state.token = Kind::OpenBracketToken;
                    }
                    ']' => {
                        self.state.pos += 1;
                        self.state.token = Kind::CloseBracketToken;
                    }
                    '^' => {
                        if self.char_at(1) == r('=') {
                            self.state.pos += 2;
                            self.state.token = Kind::CaretEqualsToken;
                        } else {
                            self.state.pos += 1;
                            self.state.token = Kind::CaretToken;
                        }
                    }
                    '{' => {
                        self.state.pos += 1;
                        self.state.token = Kind::OpenBraceToken;
                    }
                    '|' => {
                        if self.char_at(1) == r('|')
                            && is_conflict_marker_trivia(self.text, self.state.pos)
                        {
                            self.scan_conflict_marker();
                            if self.skip_trivia {
                                continue 'scan;
                            } else {
                                self.state.token = Kind::ConflictMarkerTrivia;
                                return self.state.token;
                            }
                        }
                        if self.char_at(1) == r('|') {
                            if self.char_at(2) == r('=') {
                                self.state.pos += 3;
                                self.state.token = Kind::BarBarEqualsToken;
                            } else {
                                self.state.pos += 2;
                                self.state.token = Kind::BarBarToken;
                            }
                        } else if self.char_at(1) == r('=') {
                            self.state.pos += 2;
                            self.state.token = Kind::BarEqualsToken;
                        } else {
                            self.state.pos += 1;
                            self.state.token = Kind::BarToken;
                        }
                    }
                    '}' => {
                        self.state.pos += 1;
                        self.state.token = Kind::CloseBraceToken;
                    }
                    '~' => {
                        self.state.pos += 1;
                        self.state.token = Kind::TildeToken;
                    }
                    '@' => {
                        self.state.pos += 1;
                        self.state.token = Kind::AtToken;
                    }
                    '\\' => {
                        let cp = self.peek_unicode_escape();
                        if cp >= 0 && is_identifier_start(cp as u32) {
                            let mut value = rune_to_string(self.scan_unicode_escape(true));
                            value.extend_from_slice(&self.scan_identifier_parts());
                            self.state.token = get_identifier_token(&value);
                            self.state.token_value = Cow::Owned(value);
                        } else {
                            self.scan_invalid_character();
                        }
                    }
                    '#' => {
                        if self.char_at(1) == r('!') {
                            if self.state.pos == 0 {
                                self.state.pos += 2;
                                loop {
                                    let (ch, size) = self.char_and_size();
                                    if !(size > 0 && !is_line_break(ch)) {
                                        break;
                                    }
                                    self.state.pos += size;
                                }
                                continue 'scan;
                            }
                            self.error_at(
                                diagnostics::X_CAN_ONLY_BE_USED_AT_THE_START_OF_A_FILE,
                                self.state.pos,
                                2,
                                &[],
                            );
                            self.state.pos += 1;
                            self.state.token = Kind::Unknown;
                            break 'token;
                        }
                        if self.char_at(1) == r('\\') {
                            self.state.pos += 1;
                            let cp = self.peek_unicode_escape();
                            if cp >= 0 && is_identifier_start(cp as u32) {
                                let mut value = b"#".to_vec();
                                append_rune(&mut value, self.scan_unicode_escape(true));
                                value.extend_from_slice(&self.scan_identifier_parts());
                                self.state.token_value = Cow::Owned(value);
                                self.state.token = Kind::PrivateIdentifier;
                                break 'token;
                            }
                            self.state.pos -= 1;
                        }
                        if !self.scan_identifier(1) {
                            self.error_at(
                                diagnostics::INVALID_CHARACTER,
                                self.state.pos - 1,
                                1,
                                &[],
                            );
                            self.state.token_value = Cow::Borrowed(b"#");
                        }
                        self.state.token = Kind::PrivateIdentifier;
                    }
                    _ => {
                        if ch < 0 {
                            self.state.token = Kind::EndOfFile;
                            break 'token;
                        }
                        if self.scan_identifier(0) {
                            self.state.token = get_identifier_token(&self.state.token_value);
                            break 'token;
                        }
                        let (mut ch, mut size) = self.char_and_size();
                        if ch == RUNE_ERROR {
                            self.error_at(diagnostics::FILE_APPEARS_TO_BE_BINARY, 0, 0, &[]);
                            self.state.pos = len(self.text);
                            self.state.token = Kind::NonTextFileMarkerTrivia;
                            break 'token;
                        }
                        if is_white_space_single_line(ch) {
                            self.state.pos += size;

                            // If we get here and it's not 0x0085 (nextLine), then we're handling non-ASCII whitespace. Handle skipTrivia like we do in the space case above.
                            if ch == 0x0085 || self.skip_trivia {
                                continue 'scan;
                            }

                            loop {
                                (ch, size) = self.char_and_size();
                                if !is_white_space_single_line(ch) {
                                    break;
                                }
                                self.state.pos += size;
                            }
                            self.state.token = Kind::WhitespaceTrivia;
                            return self.state.token;
                        }
                        if is_line_break(ch) {
                            self.state.token_flags |= TokenFlags::PRECEDING_LINE_BREAK;
                            self.state.pos += size;
                            continue 'scan;
                        }
                        self.scan_invalid_character();
                    }
                }
            }
            return self.state.token;
        }
    }

    // `s.pos = scanConflictMarkerTrivia(s.text, s.pos, s.errorAt)`
    fn scan_conflict_marker(&mut self) {
        let text = self.text;
        let pos = self.state.pos;
        let end = scan_conflict_marker_trivia(
            text,
            pos,
            Some(&mut |diagnostic, pos, length, args: &[Arg<'_>]| {
                self.error_at(diagnostic, pos, length, args)
            }),
        );
        self.state.pos = end;
    }

    fn process_comment_directive(&mut self, start: i32, end: i32, multiline: bool) {
        let text = self.text;
        // Skip starting slashes and whitespace
        let mut pos = start;
        if multiline {
            // Skip whitespace
            while pos < end && (at(text, pos) == r(' ') || at(text, pos) == r('\t')) {
                pos += 1;
            }
            // Skip combinations of / and *
            while pos < end && (at(text, pos) == r('/') || at(text, pos) == r('*')) {
                pos += 1;
            }
        } else {
            // Skip opening //
            pos += 2;
            // Skip another / if present
            while pos < end && at(text, pos) == r('/') {
                pos += 1;
            }
        }
        // Skip whitespace
        while pos < end && (at(text, pos) == r(' ') || at(text, pos) == r('\t')) {
            pos += 1;
        }
        // Directive must start with '@'
        if !(pos < end && at(text, pos) == r('@')) {
            return;
        }
        pos += 1;
        let rest = slice_from(text, pos);
        let kind = if strings::has_prefix(rest, b"ts-expect-error") {
            CommentDirectiveKind::EXPECT_ERROR
        } else if strings::has_prefix(rest, b"ts-ignore") {
            CommentDirectiveKind::IGNORE
        } else {
            return;
        };
        self.state.comment_directives.push(CommentDirective {
            loc: new_text_range(start as _, end as _),
            kind,
        });
    }

    pub fn re_scan_less_than_token(&mut self) -> Kind {
        if self.state.token == Kind::LessThanLessThanToken {
            self.state.pos = self.state.token_start + 1;
            self.state.token = Kind::LessThanToken;
        }
        self.state.token
    }

    pub fn re_scan_greater_than_token(&mut self) -> Kind {
        if self.state.token == Kind::GreaterThanToken {
            self.re_scan_greater_than_token_inner();
        }
        self.state.token
    }

    fn re_scan_greater_than_token_inner(&mut self) {
        self.state.pos = self.state.token_start + 1;
        if self.char() == r('>') {
            if self.char_at(1) == r('>') {
                if self.char_at(2) == r('=') {
                    self.state.pos += 3;
                    self.state.token = Kind::GreaterThanGreaterThanGreaterThanEqualsToken;
                } else {
                    self.state.pos += 2;
                    self.state.token = Kind::GreaterThanGreaterThanGreaterThanToken;
                }
            } else if self.char_at(1) == r('=') {
                self.state.pos += 2;
                self.state.token = Kind::GreaterThanGreaterThanEqualsToken;
            } else {
                self.state.pos += 1;
                self.state.token = Kind::GreaterThanGreaterThanToken;
            }
        } else if self.char() == r('=') {
            self.state.pos += 1;
            self.state.token = Kind::GreaterThanEqualsToken;
        }
    }

    pub fn re_scan_template_token(&mut self, is_tagged_template: bool) -> Kind {
        self.state.pos = self.state.token_start;
        self.state.token = self.scan_template_and_set_token_value(!is_tagged_template);
        self.state.token
    }

    // Err is upstream's panic with its message: the token is left as it was.
    pub fn re_scan_asterisk_equals_token(&mut self) -> Result<Kind, &'static str> {
        if self.state.token != Kind::AsteriskEqualsToken {
            return Err("'ReScanAsteriskEqualsToken' should only be called on a '*='");
        }
        self.state.pos = self.state.token_start + 1;
        self.state.token = Kind::EqualsToken;
        Ok(self.state.token)
    }

    // The flags and the pattern of the literal are checked by regexp.go, which is not ported: the literal is scanned the same with and without `report_errors`, and no regular expression diagnostic is reported.
    pub fn re_scan_slash_token(&mut self, _report_errors: bool) -> Kind {
        if self.state.token == Kind::SlashToken || self.state.token == Kind::SlashEqualsToken {
            let text = self.text;
            // Quickly get to the end of regex such that we know the flags
            let start_of_reg_exp_body = self.state.token_start + 1;
            let mut p = start_of_reg_exp_body;
            let mut in_escape = false;
            // Although nested character classes are allowed in Unicode Sets mode, an unescaped slash is nevertheless invalid even in a character class in any Unicode mode, and parsing nested character classes would misinterpret regexes like `/[[]/` as unterminated: nested character classes are not handled in the first pass.
            let mut in_character_class = false;
            loop {
                // If we reach the end of a file, or hit a newline, then this is an unterminated regex. Report error and return what we have so far.
                if p >= self.end {
                    self.state.token_flags |= TokenFlags::UNTERMINATED;
                    break;
                }
                let ch = at(text, p);
                if is_line_break(ch) {
                    self.state.token_flags |= TokenFlags::UNTERMINATED;
                    break;
                } else if in_escape {
                    // Parsing an escape character; reset the flag and just advance to the next char.
                    in_escape = false;
                } else if ch == r('/') && !in_character_class {
                    // A slash within a character class is permissible, but in general it signals the end of the regexp literal.
                    break;
                } else if ch == r('[') {
                    in_character_class = true;
                } else if ch == r('\\') {
                    in_escape = true;
                } else if ch == r(']') {
                    in_character_class = false;
                }
                p += 1;
            }

            let end_of_reg_exp_body = p;
            if self.state.token_flags.intersects(TokenFlags::UNTERMINATED) {
                // Search for the nearest unbalanced bracket for better recovery. Since the expression is invalid anyways, we take nested square brackets into consideration for the best guess.
                p = start_of_reg_exp_body;
                in_escape = false;
                let mut character_class_depth = 0;
                let mut in_decimal_quantifier = false;
                let mut group_depth = 0;
                while p < end_of_reg_exp_body {
                    let ch = at(text, p);
                    if in_escape {
                        in_escape = false;
                    } else if ch == r('\\') {
                        in_escape = true;
                    } else if ch == r('[') {
                        character_class_depth += 1;
                    } else if ch == r(']') && character_class_depth != 0 {
                        character_class_depth -= 1;
                    } else if character_class_depth == 0 {
                        if ch == r('{') {
                            in_decimal_quantifier = true;
                        } else if ch == r('}') && in_decimal_quantifier {
                            in_decimal_quantifier = false;
                        } else if !in_decimal_quantifier {
                            if ch == r('(') {
                                group_depth += 1;
                            } else if ch == r(')') && group_depth != 0 {
                                group_depth -= 1;
                            } else if ch == r(')') || ch == r(']') || ch == r('}') {
                                // We encountered an unbalanced bracket outside a character class. Treat this position as the end of regex.
                                break;
                            }
                        }
                    }
                    p += 1;
                }
                // Whitespaces and semicolons at the end are not likely to be part of the regex
                while p > start_of_reg_exp_body {
                    let (ch, size) = decode_last_rune(slice(text, 0, p));
                    if is_white_space_like(ch) || ch == r(';') {
                        p -= size;
                    } else {
                        break;
                    }
                }
                self.error_at(
                    diagnostics::UNTERMINATED_REGULAR_EXPRESSION_LITERAL,
                    self.state.token_start,
                    p - self.state.token_start,
                    &[],
                );
            } else {
                // Consume the slash character
                p += 1;
                while p < self.end {
                    let (ch, size) = decode_rune(slice_from(text, p));
                    if ch == RUNE_ERROR || !is_identifier_part(ch as u32) {
                        break;
                    }
                    p += size;
                }
            }

            self.state.pos = p;
            self.state.token_value = Cow::Borrowed(slice(text, self.state.token_start, p));
            self.state.token = Kind::RegularExpressionLiteral;
        }
        self.state.token
    }

    pub fn re_scan_jsx_token(&mut self, allow_multiline_jsx_text: bool) -> Kind {
        self.state.pos = self.state.full_start_pos;
        self.state.token_start = self.state.full_start_pos;
        self.state.token = self.scan_jsx_token_ex(allow_multiline_jsx_text);
        self.state.token
    }

    pub fn re_scan_hash_token(&mut self) -> Kind {
        if self.state.token == Kind::PrivateIdentifier {
            self.state.pos = self.state.token_start + 1;
            self.state.token = Kind::HashToken;
        }
        self.state.token
    }

    // Err is upstream's panic with its message: the token is left as it was.
    pub fn re_scan_question_token(&mut self) -> Result<Kind, &'static str> {
        if self.state.token != Kind::QuestionQuestionToken {
            return Err("'reScanQuestionToken' should only be called on a '??'");
        }
        self.state.pos = self.state.token_start + 1;
        self.state.token = Kind::QuestionToken;
        Ok(self.state.token)
    }

    pub fn scan_jsx_token(&mut self) -> Kind {
        self.scan_jsx_token_ex(true)
    }

    pub fn scan_jsx_token_ex(&mut self, allow_multiline_jsx_text: bool) -> Kind {
        self.state.full_start_pos = self.state.pos;
        self.state.token_start = self.state.pos;
        let ch = self.char();
        if ch < 0 {
            self.state.token = Kind::EndOfFile;
        } else if ch == r('<') {
            if self.char_at(1) == r('/') {
                self.state.pos += 2;
                self.state.token = Kind::LessThanSlashToken;
            } else {
                self.state.pos += 1;
                self.state.token = Kind::LessThanToken;
            }
        } else if ch == r('{') {
            self.state.pos += 1;
            self.state.token = Kind::OpenBraceToken;
        } else {
            // First non-whitespace character on this line: 0 says that we want leading whitespace on the first line.
            let mut first_non_whitespace = 0;
            loop {
                let (ch, size) = self.char_and_size();
                if size == 0 || ch == r('{') {
                    break;
                }
                if ch == r('<') {
                    if is_conflict_marker_trivia(self.text, self.state.pos) {
                        self.scan_conflict_marker();
                        self.state.token = Kind::ConflictMarkerTrivia;
                        return self.state.token;
                    }
                    break;
                }
                if ch == r('>') {
                    self.error_at(
                        diagnostics::UNEXPECTED_TOKEN_DID_YOU_MEAN_OR_GT,
                        self.state.pos,
                        1,
                        &[],
                    );
                } else if ch == r('}') {
                    self.error_at(
                        diagnostics::UNEXPECTED_TOKEN_DID_YOU_MEAN_OR_RBRACE,
                        self.state.pos,
                        1,
                        &[],
                    );
                }
                // FirstNonWhitespace is 0, then we only see whitespaces so far. If we see a linebreak, we want to ignore that whitespaces: `<div>----\n</div>` becomes `<div></div>`, `<div>----</div>` stays.
                if is_line_break(ch) && first_non_whitespace == 0 {
                    first_non_whitespace = -1;
                } else if !allow_multiline_jsx_text && is_line_break(ch) && first_non_whitespace > 0
                {
                    // Stop JsxText on each line during formatting. This allows the formatter to indent each line correctly.
                    break;
                } else if !is_white_space_like(ch) {
                    first_non_whitespace = self.state.pos;
                }
                self.state.pos += size;
            }
            self.state.token_value =
                Cow::Borrowed(slice(self.text, self.state.full_start_pos, self.state.pos));
            self.state.token = Kind::JsxText;
            if first_non_whitespace == -1 {
                self.state.token = Kind::JsxTextAllWhiteSpaces;
            }
        }
        self.state.token
    }

    // Scans a JSX identifier; these differ from normal identifiers in that they allow dashes
    pub fn scan_jsx_identifier(&mut self) -> Kind {
        if token_is_identifier_or_keyword(self.state.token) {
            // An identifier or keyword has already been parsed - check for a `-` or a single instance of `:` and then append it and everything after it to the token. This mutates the visible token without advancing to a new token: a caller should only read the pos or token value after calling it.
            loop {
                let ch = self.char();
                if ch < 0 {
                    break;
                }
                if ch == r('-') {
                    self.state.token_value.to_mut().push(b'-');
                    self.state.pos += 1;
                    continue;
                }
                let old_pos = self.state.pos;
                // reuse `scanIdentifierParts` so unicode escapes are handled
                let parts = self.scan_identifier_parts();
                self.state.token_value.to_mut().extend_from_slice(&parts);
                if self.state.pos == old_pos {
                    break;
                }
            }
            self.state.token = get_identifier_token(&self.state.token_value);
        }
        self.state.token
    }

    pub fn scan_jsx_attribute_value(&mut self) -> Kind {
        self.state.full_start_pos = self.state.pos;
        // Skip whitespace between '=' and the value so tokenStart lands on the opening quote, not on trivia.
        loop {
            let (ch, size) = self.char_and_size();
            if !(size > 0 && is_white_space_like(ch)) {
                break;
            }
            self.state.pos += size;
        }
        self.state.token_start = self.state.pos;
        let ch = self.char();
        if ch == r('"') || ch == r('\'') {
            self.state.token_value = self.scan_string(true);
            self.state.token = Kind::StringLiteral;
            return self.state.token;
        }
        // If this scans anything other than `{`, it's a parse error.
        self.scan()
    }

    pub fn re_scan_jsx_attribute_value(&mut self) -> Kind {
        self.state.pos = self.state.full_start_pos;
        self.state.token_start = self.state.full_start_pos;
        self.scan_jsx_attribute_value()
    }

    // In addition to the usual JSDoc ast.Kinds, can also return ast.KindJSDocCommentTextToken
    pub fn scan_jsdoc_comment_text_token(&mut self, in_backticks: bool) -> Kind {
        self.state.full_start_pos = self.state.pos;
        self.state.token_flags = TokenFlags::NONE;
        if self.state.pos >= len(self.text) {
            self.state.token = Kind::EndOfFile;
            return self.state.token;
        }
        self.state.token_start = self.state.pos;
        loop {
            let (ch, size) = self.char_and_size();
            if !(self.state.pos < len(self.text) && !is_line_break(ch) && ch != r('`')) {
                break;
            }
            if !in_backticks {
                if ch == r('{') {
                    break;
                } else if ch == r('@') && self.state.pos >= 0 {
                    // @ doesn't start a new tag inside ``, and elsewhere, only after whitespace and before identifier
                    let (previous, _) = decode_last_rune(slice(self.text, 0, self.state.pos));
                    if is_white_space_single_line(previous) {
                        let (next, _) = decode_rune(slice_from(self.text, self.state.pos + size));
                        if is_identifier_start(next as u32) {
                            break;
                        }
                    }
                }
            }
            self.state.pos += size;
        }
        if self.state.pos == self.state.token_start {
            return self.scan_jsdoc_token();
        }
        self.state.token_value =
            Cow::Borrowed(slice(self.text, self.state.token_start, self.state.pos));
        self.state.token = Kind::JSDocCommentTextToken;
        self.state.token
    }

    // Peek at the character at the current scanner position (expected to be right after '@') and return true if a JSDoc tag can follow. Identifier starts indicate a tag name. Whitespace, newlines, and EOF are also accepted to support incomplete tags for code completion.
    pub fn can_follow_jsdoc_at(&self) -> bool {
        if self.state.pos >= len(self.text) {
            return true;
        }
        let (ch, _) = decode_rune(slice_from(self.text, self.state.pos));
        is_identifier_start(ch as u32) || is_white_space_single_line(ch) || is_line_break(ch)
    }

    pub fn scan_jsdoc_token(&mut self) -> Kind {
        self.state.full_start_pos = self.state.pos;
        self.state.token_flags = TokenFlags::NONE;
        if self.state.pos >= len(self.text) {
            self.state.token = Kind::EndOfFile;
            return self.state.token;
        }

        self.state.token_start = self.state.pos;
        let (ch, mut size) = self.char_and_size();
        self.state.pos += size;
        match ascii(ch) {
            '\t' | '\x0B' | '\x0C' | ' ' => {
                loop {
                    let (ch2, size2) = self.char_and_size();
                    if !(size2 > 0 && is_white_space_single_line(ch2)) {
                        break;
                    }
                    self.state.pos += size2;
                }
                self.state.token = Kind::WhitespaceTrivia;
                return self.state.token;
            }
            '@' => {
                self.state.token = Kind::AtToken;
                return self.state.token;
            }
            '\r' | '\n' => {
                if ch == r('\r') && self.char() == r('\n') {
                    self.state.pos += 1;
                }
                self.state.token_flags |= TokenFlags::PRECEDING_LINE_BREAK;
                self.state.token = Kind::NewLineTrivia;
                return self.state.token;
            }
            '*' => {
                self.state.token = Kind::AsteriskToken;
                return self.state.token;
            }
            '{' => {
                self.state.token = Kind::OpenBraceToken;
                return self.state.token;
            }
            '}' => {
                self.state.token = Kind::CloseBraceToken;
                return self.state.token;
            }
            '[' => {
                self.state.token = Kind::OpenBracketToken;
                return self.state.token;
            }
            ']' => {
                self.state.token = Kind::CloseBracketToken;
                return self.state.token;
            }
            '(' => {
                self.state.token = Kind::OpenParenToken;
                return self.state.token;
            }
            ')' => {
                self.state.token = Kind::CloseParenToken;
                return self.state.token;
            }
            '<' => {
                self.state.token = Kind::LessThanToken;
                return self.state.token;
            }
            '>' => {
                self.state.token = Kind::GreaterThanToken;
                return self.state.token;
            }
            '=' => {
                self.state.token = Kind::EqualsToken;
                return self.state.token;
            }
            ',' => {
                self.state.token = Kind::CommaToken;
                return self.state.token;
            }
            '.' => {
                self.state.token = Kind::DotToken;
                return self.state.token;
            }
            '`' => {
                self.state.token = Kind::BacktickToken;
                return self.state.token;
            }
            '#' => {
                self.state.token = Kind::HashToken;
                return self.state.token;
            }
            '\\' => {
                self.state.pos -= 1;
                let cp = self.peek_unicode_escape();
                if cp >= 0 && is_identifier_start(cp as u32) {
                    let mut value = rune_to_string(self.scan_unicode_escape(true));
                    value.extend_from_slice(&self.scan_identifier_parts());
                    self.state.token = get_identifier_token(&value);
                    self.state.token_value = Cow::Owned(value);
                } else {
                    self.state.pos += 1;
                    self.state.token = Kind::Unknown;
                }
                return self.state.token;
            }
            _ => {}
        }

        if is_identifier_start(ch as u32) {
            let mut current = ch;
            loop {
                if self.state.pos >= len(self.text) {
                    break;
                }
                (current, size) = self.char_and_size();
                if !is_identifier_part(current as u32) && current != r('-') {
                    break;
                }
                self.state.pos += size;
            }
            self.state.token_value =
                Cow::Borrowed(slice(self.text, self.state.token_start, self.state.pos));
            if current == r('\\') {
                let parts = self.scan_identifier_parts();
                self.state.token_value.to_mut().extend_from_slice(&parts);
            }
            self.state.token = get_identifier_token(&self.state.token_value);
            self.state.token
        } else {
            self.state.token = Kind::Unknown;
            self.state.token
        }
    }

    fn scan_identifier(&mut self, prefix_length: i32) -> bool {
        let start = self.state.pos;
        self.state.pos += prefix_length;
        let mut ch = self.char();
        // Fast path for simple ASCII identifiers
        if is_ascii_letter(ch) || ch == r('_') || ch == r('$') {
            self.state.pos += 1;
            self.scan_ascii_while(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'$');
            ch = self.char();
            if ch < RUNE_SELF && ch != r('\\') {
                self.state.token_value = Cow::Borrowed(slice(self.text, start, self.state.pos));
                return true;
            }
            self.state.pos = start + prefix_length;
        }
        let (mut ch, mut size) = self.char_and_size();
        if is_identifier_start(ch as u32) {
            loop {
                self.state.pos += size;
                (ch, size) = self.char_and_size();
                if !is_identifier_part(ch as u32) {
                    break;
                }
            }
            self.state.token_value = Cow::Borrowed(slice(self.text, start, self.state.pos));
            if ch == r('\\') {
                let parts = self.scan_identifier_parts();
                self.state.token_value.to_mut().extend_from_slice(&parts);
            }
            return true;
        }
        false
    }

    pub(crate) fn scan_identifier_parts(&mut self) -> Vec<u8> {
        let mut sb = Vec::new();
        let mut start = self.state.pos;
        loop {
            let (ch, size) = self.char_and_size();
            if is_identifier_part(ch as u32) {
                self.state.pos += size;
                continue;
            }
            if ch == r('\\') {
                let escaped = self.peek_unicode_escape();
                if escaped >= 0 && is_identifier_part(escaped as u32) {
                    sb.extend_from_slice(slice(self.text, start, self.state.pos));
                    let escape = self.scan_unicode_escape(true);
                    append_rune(&mut sb, escape);
                    start = self.state.pos;
                    continue;
                }
            }
            break;
        }
        sb.extend_from_slice(slice(self.text, start, self.state.pos));
        sb
    }

    fn scan_string(&mut self, jsx_attribute_string: bool) -> Cow<'a, [u8]> {
        let text = self.text;
        let quote = self.char();
        if quote == r('\'') {
            self.state.token_flags |= TokenFlags::SINGLE_QUOTE;
        }
        self.state.pos += 1;
        // Fast path for simple strings without escape sequences.
        let rest = slice_from(text, self.state.pos);
        let str_len = match u8::try_from(quote) {
            Ok(quote) => strings::index_of_char_usize(rest, quote),
            Err(_) => None,
        };
        if str_len == Some(0) {
            self.state.pos += 1;
            return Cow::Borrowed(b"");
        }
        if let Some(str_len) = str_len {
            let str = rest.get(..str_len).unwrap_or(&[]);
            if jsx_attribute_string || strings::index_of_any(str, b"\\\r\n").is_none() {
                self.state.pos += str_len as i32 + 1;
                return Cow::Borrowed(str);
            }
        }
        let mut sb = Vec::new();
        let mut start = self.state.pos;
        loop {
            let ch = self.char();
            if ch < 0 {
                sb.extend_from_slice(slice(text, start, self.state.pos));
                self.state.token_flags |= TokenFlags::UNTERMINATED;
                self.error(diagnostics::UNTERMINATED_STRING_LITERAL);
                break;
            }
            if ch == quote {
                sb.extend_from_slice(slice(text, start, self.state.pos));
                self.state.pos += 1;
                break;
            }
            if ch == r('\\') && !jsx_attribute_string {
                sb.extend_from_slice(slice(text, start, self.state.pos));
                let escape = self.scan_escape_sequence(
                    EscapeSequenceScanningFlags::STRING
                        | EscapeSequenceScanningFlags::REPORT_ERRORS,
                );
                sb.extend_from_slice(&escape);
                start = self.state.pos;
                continue;
            }
            if (ch == r('\n') || ch == r('\r')) && !jsx_attribute_string {
                sb.extend_from_slice(slice(text, start, self.state.pos));
                self.state.token_flags |= TokenFlags::UNTERMINATED;
                self.error(diagnostics::UNTERMINATED_STRING_LITERAL);
                break;
            }
            self.state.pos += 1;
        }
        Cow::Owned(sb)
    }

    fn scan_template_and_set_token_value(
        &mut self,
        should_emit_invalid_escape_error: bool,
    ) -> Kind {
        let text = self.text;
        let started_with_backtick = self.char() == r('`');
        self.state.pos += 1;
        let mut start = self.state.pos;
        // Upstream collects the parts in a list and joins them at the end.
        let mut parts: Vec<u8> = Vec::new();
        let token;
        loop {
            self.scan_ascii_while(|b| b != b'`' && b != b'$' && b != b'\\' && b != b'\r');
            let ch = self.char();
            if ch < 0 || ch == r('`') {
                parts.extend_from_slice(slice(text, start, self.state.pos));
                if ch == r('`') {
                    self.state.pos += 1;
                } else {
                    self.state.token_flags |= TokenFlags::UNTERMINATED;
                    self.error(diagnostics::UNTERMINATED_TEMPLATE_LITERAL);
                }
                token = if started_with_backtick {
                    Kind::NoSubstitutionTemplateLiteral
                } else {
                    Kind::TemplateTail
                };
                break;
            }
            if ch == r('$') && self.char_at(1) == r('{') {
                parts.extend_from_slice(slice(text, start, self.state.pos));
                self.state.pos += 2;
                token = if started_with_backtick {
                    Kind::TemplateHead
                } else {
                    Kind::TemplateMiddle
                };
                break;
            }
            if ch == r('\\') {
                parts.extend_from_slice(slice(text, start, self.state.pos));
                let flags = if should_emit_invalid_escape_error {
                    EscapeSequenceScanningFlags::STRING | EscapeSequenceScanningFlags::REPORT_ERRORS
                } else {
                    EscapeSequenceScanningFlags::STRING
                };
                let escape = self.scan_escape_sequence(flags);
                parts.extend_from_slice(&escape);
                start = self.state.pos;
                continue;
            }
            // Speculated ECMAScript 6 Spec 11.8.6.1: <CR><LF> and <CR> LineTerminatorSequences are normalized to <LF> for Template Values
            if ch == r('\r') {
                parts.extend_from_slice(slice(text, start, self.state.pos));
                self.state.pos += 1;
                if self.char() == r('\n') {
                    self.state.pos += 1;
                }
                parts.push(b'\n');
                start = self.state.pos;
                continue;
            }
            self.state.pos += 1;
        }
        self.state.token_value = Cow::Owned(parts);
        token
    }

    pub(crate) fn scan_escape_sequence(&mut self, flags: EscapeSequenceScanningFlags) -> Vec<u8> {
        let text = self.text;
        let start = self.state.pos;
        self.state.pos += 1;
        let mut ch = self.char();
        if ch < 0 {
            self.error(diagnostics::UNEXPECTED_END_OF_TEXT);
            return Vec::new();
        }
        self.state.pos += 1;
        match ascii(ch) {
            '0'..='7' => {
                // Although '0' preceding any digit is treated as LegacyOctalEscapeSequence, '\08' should separately be interpreted as '\0' + '8'.
                if ch == r('0') && !is_digit(self.char()) {
                    return b"\x00".to_vec();
                }
                // '\01', '\011', '\1', '\17', '\177'
                if ch <= r('3') && is_octal_digit(self.char()) {
                    self.state.pos += 1;
                }
                // '\17', '\177', '\4', '\47' but not '\477'
                if is_octal_digit(self.char()) {
                    self.state.pos += 1;
                }
                // '\47'
                self.state.token_flags |= TokenFlags::CONTAINS_INVALID_ESCAPE;
                if flags.intersects(EscapeSequenceScanningFlags::REPORT_INVALID_ESCAPE_ERRORS) {
                    let code = parse_int(slice(text, start + 1, self.state.pos), 8, 32);
                    let escape = format_hex_escape(code);
                    if flags.intersects(EscapeSequenceScanningFlags::REGULAR_EXPRESSION)
                        && !flags.intersects(EscapeSequenceScanningFlags::ATOM_ESCAPE)
                        && ch != r('0')
                    {
                        self.error_at(
                            diagnostics::OCTAL_ESCAPE_SEQUENCES_AND_BACKREFERENCES_ARE_NOT_ALLOWED_IN_A_CHARACTER_CLASS_IF_THIS_WAS_INTENDED_AS_AN_ESCAPE_SEQUENCE_USE_THE_SYNTAX_0_INSTEAD,
                            start,
                            self.state.pos - start,
                            &[Arg::Str(&escape)],
                        );
                    } else {
                        self.error_at(
                            diagnostics::OCTAL_ESCAPE_SEQUENCES_ARE_NOT_ALLOWED_USE_THE_SYNTAX_0,
                            start,
                            self.state.pos - start,
                            &[Arg::Str(&escape)],
                        );
                    }
                    return rune_to_string(code as Rune);
                }
                slice(text, start, self.state.pos).to_vec()
            }
            '8' | '9' => {
                // the invalid '\8' and '\9'
                self.state.token_flags |= TokenFlags::CONTAINS_INVALID_ESCAPE;
                if flags.intersects(EscapeSequenceScanningFlags::REPORT_INVALID_ESCAPE_ERRORS) {
                    if flags.intersects(EscapeSequenceScanningFlags::REGULAR_EXPRESSION)
                        && !flags.intersects(EscapeSequenceScanningFlags::ATOM_ESCAPE)
                    {
                        self.error_at(
                            diagnostics::DECIMAL_ESCAPE_SEQUENCES_AND_BACKREFERENCES_ARE_NOT_ALLOWED_IN_A_CHARACTER_CLASS,
                            start,
                            self.state.pos - start,
                            &[],
                        );
                    } else {
                        self.error_at(
                            diagnostics::ESCAPE_SEQUENCE_0_IS_NOT_ALLOWED,
                            start,
                            self.state.pos - start,
                            &[Arg::Str(slice(text, start, self.state.pos))],
                        );
                    }
                    return rune_to_string(ch);
                }
                slice(text, start, self.state.pos).to_vec()
            }
            'b' => b"\x08".to_vec(),
            't' => b"\t".to_vec(),
            'n' => b"\n".to_vec(),
            'v' => b"\x0B".to_vec(),
            'f' => b"\x0C".to_vec(),
            'r' => b"\r".to_vec(),
            '\'' => b"'".to_vec(),
            '"' => b"\"".to_vec(),
            'u' => {
                // '\uDDDD' and '\u{DDDDDD}'
                let extended = self.char() == r('{');
                self.state.pos -= 2;
                let report =
                    flags.intersects(EscapeSequenceScanningFlags::REPORT_INVALID_ESCAPE_ERRORS);
                let code_point = self.scan_unicode_escape(report);
                if extended {
                    if !flags.intersects(EscapeSequenceScanningFlags::ALLOW_EXTENDED_UNICODE_ESCAPE)
                    {
                        self.state.token_flags |= TokenFlags::CONTAINS_INVALID_ESCAPE;
                        if report {
                            self.error_at(
                                diagnostics::UNICODE_ESCAPE_SEQUENCES_ARE_ONLY_AVAILABLE_WHEN_THE_UNICODE_U_FLAG_OR_THE_UNICODE_SETS_V_FLAG_IS_SET,
                                start,
                                self.state.pos - start,
                                &[],
                            );
                        }
                    }
                    if code_point < 0 {
                        return slice(text, start, self.state.pos).to_vec();
                    }
                    // In string literals, a high surrogate \u{...} followed by a low surrogate escape forms a single code point, exactly as adjacent UTF-16 code units would in a JavaScript string.
                    if !flags.intersects(EscapeSequenceScanningFlags::REGULAR_EXPRESSION)
                        && stringutil::is_high_surrogate(code_point as u32)
                    {
                        let (combined, ok) = self.scan_low_surrogate_escape(code_point);
                        if ok {
                            return rune_to_string(combined);
                        }
                    }
                    return stringutil::encode_js_string_rune(code_point as u32);
                }
                if code_point < 0 {
                    return slice(text, start, self.state.pos).to_vec();
                } else if stringutil::is_high_surrogate(code_point as u32) {
                    if !flags.intersects(EscapeSequenceScanningFlags::REGULAR_EXPRESSION) {
                        // Combine \uHigh followed by any low surrogate escape (\uLow or \u{Low}) into a single code point in string literals, matching how adjacent UTF-16 code units pair in a JavaScript string.
                        let (combined, ok) = self.scan_low_surrogate_escape(code_point);
                        if ok {
                            return rune_to_string(combined);
                        }
                    } else if flags.intersects(EscapeSequenceScanningFlags::ANY_UNICODE_MODE)
                        && self.char() == r('\\')
                        && self.char_at(1) == r('u')
                        && self.char_at(2) != r('{')
                    {
                        // In regex AnyUnicodeMode, combine \uHigh\uLow so scanClassRanges can compare the pair numerically. In non-unicode regex mode they are separate atoms, and extended \u{...} escapes never combine.
                        let saved_pos = self.state.pos;
                        let next_code_point = self.scan_unicode_escape(report);
                        if next_code_point >= 0
                            && stringutil::is_low_surrogate(next_code_point as u32)
                        {
                            return rune_to_string(stringutil::surrogate_pair_to_code_point(
                                code_point as u32,
                                next_code_point as u32,
                            ) as Rune);
                        }
                        self.state.pos = saved_pos;
                    }
                }
                // Lone surrogate: encode as CESU-8 so it survives losslessly. In a non-unicode regex this also lets scanClassRanges compare it numerically.
                stringutil::encode_js_string_rune(code_point as u32)
            }
            'x' => {
                // '\xDD'
                while self.state.pos < start + 4 {
                    if !is_hex_digit(self.char()) {
                        self.state.token_flags |= TokenFlags::CONTAINS_INVALID_ESCAPE;
                        if flags
                            .intersects(EscapeSequenceScanningFlags::REPORT_INVALID_ESCAPE_ERRORS)
                        {
                            self.error(diagnostics::HEXADECIMAL_DIGIT_EXPECTED);
                        }
                        return slice(text, start, self.state.pos).to_vec();
                    }
                    self.state.pos += 1;
                }
                self.state.token_flags |= TokenFlags::HEX_ESCAPE;
                let escaped_value = parse_int(slice(text, start + 2, self.state.pos), 16, 32);
                rune_to_string(escaped_value as Rune)
            }
            '\r' | '\n' => {
                // when encountering a LineContinuation (i.e. a backslash and a line terminator sequence), the line terminator is interpreted to be "the empty code unit sequence".
                if ch == r('\r') && self.char() == r('\n') {
                    self.state.pos += 1;
                }
                Vec::new()
            }
            _ => {
                // ch was read as a single byte; for multi-byte UTF-8 characters, we need to decode the full rune and advance past all its bytes.
                if ch >= RUNE_SELF {
                    // back up past the single-byte advance
                    self.state.pos -= 1;
                    let size;
                    (ch, size) = decode_rune(slice_from(text, self.state.pos));
                    self.state.pos += size;
                }
                // LineContinuation: a backslash followed by a line terminator is "the empty code unit sequence".
                if ch == 0x2028 || ch == 0x2029 {
                    return Vec::new();
                }
                if flags.intersects(EscapeSequenceScanningFlags::ANY_UNICODE_MODE)
                    || (flags.intersects(EscapeSequenceScanningFlags::REGULAR_EXPRESSION)
                        && !flags.intersects(EscapeSequenceScanningFlags::ANNEX_B)
                        && is_identifier_part(ch as u32))
                {
                    self.error_at(
                        diagnostics::THIS_CHARACTER_CANNOT_BE_ESCAPED_IN_A_REGULAR_EXPRESSION,
                        start,
                        self.state.pos - start,
                        &[],
                    );
                }
                rune_to_string(ch)
            }
        }
    }

    // Known to be at \u
    pub(crate) fn scan_unicode_escape(&mut self, should_emit_invalid_escape_error: bool) -> Rune {
        self.state.pos += 2;
        let start = self.state.pos;
        let extended = self.char() == r('{');
        let hex_digits = if extended {
            self.state.pos += 1;
            self.scan_hex_digits(1, true, false)
        } else {
            self.state.token_flags |= TokenFlags::UNICODE_ESCAPE;
            self.scan_hex_digits(4, false, false)
        };
        if hex_digits.is_empty() {
            self.state.token_flags |= TokenFlags::CONTAINS_INVALID_ESCAPE;
            if should_emit_invalid_escape_error {
                self.error(diagnostics::HEXADECIMAL_DIGIT_EXPECTED);
            }
            return -1;
        }
        let hex_value = parse_int(&hex_digits, 16, 32);
        if extended {
            let mut is_invalid_extended_escape = false;
            if hex_value > 0x10FFFF {
                if should_emit_invalid_escape_error {
                    self.error_at(
                        diagnostics::AN_EXTENDED_UNICODE_ESCAPE_VALUE_MUST_BE_BETWEEN_0X0_AND_0X10FFFF_INCLUSIVE,
                        start + 1,
                        self.state.pos - start - 1,
                        &[],
                    );
                }
                is_invalid_extended_escape = true;
            }
            if self.state.pos >= self.end {
                if should_emit_invalid_escape_error {
                    self.error(diagnostics::UNEXPECTED_END_OF_TEXT);
                }
                is_invalid_extended_escape = true;
            } else if self.char() == r('}') {
                self.state.pos += 1;
            } else {
                if should_emit_invalid_escape_error {
                    self.error(diagnostics::UNTERMINATED_UNICODE_ESCAPE_SEQUENCE);
                }
                is_invalid_extended_escape = true;
            }
            if is_invalid_extended_escape {
                self.state.token_flags |= TokenFlags::CONTAINS_INVALID_ESCAPE;
                return -1;
            }
            self.state.token_flags |= TokenFlags::EXTENDED_UNICODE_ESCAPE;
        }
        hex_value as Rune
    }

    // scanLowSurrogateEscape attempts to consume a low-surrogate Unicode escape (either '\uLow' or '\u{Low}') immediately following an already-scanned high surrogate and combine them into a single supplementary code point. On success it returns the combined code point and true; otherwise it restores the scanner position and returns false.
    fn scan_low_surrogate_escape(&mut self, high: Rune) -> (Rune, bool) {
        if self.char() != r('\\') || self.char_at(1) != r('u') {
            return (0, false);
        }
        let saved_pos = self.state.pos;
        let saved_token_flags = self.state.token_flags;
        // Speculatively scan the escape with diagnostics suppressed: if it isn't a low surrogate we rewind below, and the caller re-scans the same escape and reports any error then, so reporting here would duplicate diagnostics.
        let low = self.scan_unicode_escape(false);
        if low >= 0 && stringutil::is_low_surrogate(low as u32) {
            return (
                stringutil::surrogate_pair_to_code_point(high as u32, low as u32) as Rune,
                true,
            );
        }
        self.state.pos = saved_pos;
        self.state.token_flags = saved_token_flags;
        (0, false)
    }

    // Current character is known to be a backslash. Check for Unicode escape of the form '\uXXXX' or '\u{XXXXXX}' and return code point value if valid Unicode escape is found. Otherwise return -1.
    fn peek_unicode_escape(&mut self) -> Rune {
        if self.char_at(1) == r('u') {
            let save_pos = self.state.pos;
            let save_token_flags = self.state.token_flags;
            let code_point = self.scan_unicode_escape(false);
            self.state.pos = save_pos;
            self.state.token_flags = save_token_flags;
            return code_point;
        }
        -1
    }

    fn scan_number(&mut self) -> Kind {
        let text = self.text;
        let mut start = self.state.pos;
        let fixed_part: Cow<'a, [u8]>;
        if self.char() == r('0') {
            self.state.pos += 1;
            if self.char() == r('_') {
                self.state.token_flags |=
                    TokenFlags::CONTAINS_SEPARATOR | TokenFlags::CONTAINS_INVALID_SEPARATOR;
                self.error_at(
                    diagnostics::NUMERIC_SEPARATORS_ARE_NOT_ALLOWED_HERE,
                    self.state.pos,
                    1,
                    &[],
                );
                self.state.pos = start;
                fixed_part = self.scan_number_fragment();
            } else {
                let (digits, is_octal) = self.scan_digits();
                if digits.is_empty() {
                    fixed_part = Cow::Borrowed(b"0");
                } else if !is_octal {
                    self.state.token_flags |= TokenFlags::CONTAINS_LEADING_ZERO;
                    fixed_part = Cow::Borrowed(digits);
                } else {
                    let val = parse_int(digits, 8, 64);
                    self.state.token_value = Cow::Owned(format_int(val, 10));
                    self.state.token_flags |= TokenFlags::OCTAL;
                    let with_minus = self.state.token == Kind::MinusToken;
                    let mut literal: Vec<u8> = if with_minus {
                        b"-0o".to_vec()
                    } else {
                        b"0o".to_vec()
                    };
                    literal.extend_from_slice(&format_int(val, 8));
                    if with_minus {
                        start -= 1;
                    }
                    self.error_at(
                        diagnostics::OCTAL_LITERALS_ARE_NOT_ALLOWED_USE_THE_SYNTAX_0,
                        start,
                        self.state.pos - start,
                        &[Arg::Str(&literal)],
                    );
                    return Kind::NumericLiteral;
                }
            }
        } else {
            fixed_part = self.scan_number_fragment();
        }
        let fixed_part_end = self.state.pos;
        let mut fractional_part: Cow<'a, [u8]> = Cow::Borrowed(b"");
        let mut exponent_preamble: &[u8] = b"";
        let mut exponent_part: Cow<'a, [u8]> = Cow::Borrowed(b"");
        if self.char() == r('.') {
            self.state.pos += 1;
            fractional_part = self.scan_number_fragment();
        }
        let mut end = self.state.pos;
        if self.char() == r('E') || self.char() == r('e') {
            self.state.pos += 1;
            self.state.token_flags |= TokenFlags::SCIENTIFIC;
            if self.char() == r('+') || self.char() == r('-') {
                self.state.pos += 1;
            }
            let start_numeric_part = self.state.pos;
            exponent_part = self.scan_number_fragment();
            if exponent_part.is_empty() {
                self.error(diagnostics::DIGIT_EXPECTED);
            } else {
                exponent_preamble = slice(text, end, start_numeric_part);
                end = self.state.pos;
            }
        }
        if self
            .state
            .token_flags
            .intersects(TokenFlags::CONTAINS_SEPARATOR)
        {
            let mut value = fixed_part.into_owned();
            if !fractional_part.is_empty() {
                value.push(b'.');
                value.extend_from_slice(&fractional_part);
            }
            if !exponent_part.is_empty() {
                value.extend_from_slice(exponent_preamble);
                value.extend_from_slice(&exponent_part);
            }
            self.state.token_value = Cow::Owned(value);
        } else {
            self.state.token_value = Cow::Borrowed(slice(text, start, end));
        }
        if self
            .state
            .token_flags
            .intersects(TokenFlags::CONTAINS_LEADING_ZERO)
        {
            self.error_at(
                diagnostics::DECIMALS_WITH_LEADING_ZEROS_ARE_NOT_ALLOWED,
                start,
                self.state.pos - start,
                &[],
            );
            self.state.token_value =
                Cow::Owned(jsnum::from_string(&self.state.token_value).string());
            return Kind::NumericLiteral;
        }
        let result = if fixed_part_end == self.state.pos {
            self.scan_big_int_suffix()
        } else {
            self.state.token_value =
                Cow::Owned(jsnum::from_string(&self.state.token_value).string());
            Kind::NumericLiteral
        };
        let (ch, _) = self.char_and_size();
        if is_identifier_start(ch as u32) {
            let id_start = self.state.pos;
            let id = self.scan_identifier_parts();
            if result != Kind::BigIntLiteral && id.len() == 1 && at(text, id_start) == r('n') {
                if self.state.token_flags.intersects(TokenFlags::SCIENTIFIC) {
                    self.error_at(
                        diagnostics::A_BIGINT_LITERAL_CANNOT_USE_EXPONENTIAL_NOTATION,
                        start,
                        self.state.pos - start,
                        &[],
                    );
                    return result;
                }
                if fixed_part_end < id_start {
                    self.error_at(
                        diagnostics::A_BIGINT_LITERAL_MUST_BE_AN_INTEGER,
                        start,
                        self.state.pos - start,
                        &[],
                    );
                    return result;
                }
            }
            self.error_at(
                diagnostics::AN_IDENTIFIER_OR_KEYWORD_CANNOT_IMMEDIATELY_FOLLOW_A_NUMERIC_LITERAL,
                id_start,
                self.state.pos - id_start,
                &[],
            );
            self.state.pos = id_start;
        }
        result
    }

    fn scan_number_fragment(&mut self) -> Cow<'a, [u8]> {
        let text = self.text;
        let mut start = self.state.pos;
        let mut allow_separator = false;
        let mut is_previous_token_separator = false;
        let mut result: Vec<u8> = Vec::new();
        loop {
            let before = self.state.pos;
            self.scan_ascii_while(|b| b.is_ascii_digit());
            if self.state.pos > before {
                allow_separator = true;
                is_previous_token_separator = false;
            }
            let ch = self.char();
            if ch == r('_') {
                self.state.token_flags |= TokenFlags::CONTAINS_SEPARATOR;
                if allow_separator {
                    allow_separator = false;
                    is_previous_token_separator = true;
                    result.extend_from_slice(slice(text, start, self.state.pos));
                } else {
                    self.state.token_flags |= TokenFlags::CONTAINS_INVALID_SEPARATOR;
                    if is_previous_token_separator {
                        self.error_at(
                            diagnostics::MULTIPLE_CONSECUTIVE_NUMERIC_SEPARATORS_ARE_NOT_PERMITTED,
                            self.state.pos,
                            1,
                            &[],
                        );
                    } else {
                        self.error_at(
                            diagnostics::NUMERIC_SEPARATORS_ARE_NOT_ALLOWED_HERE,
                            self.state.pos,
                            1,
                            &[],
                        );
                    }
                }
                self.state.pos += 1;
                start = self.state.pos;
                continue;
            }
            break;
        }
        if is_previous_token_separator {
            self.state.token_flags |= TokenFlags::CONTAINS_INVALID_SEPARATOR;
            self.error_at(
                diagnostics::NUMERIC_SEPARATORS_ARE_NOT_ALLOWED_HERE,
                self.state.pos - 1,
                1,
                &[],
            );
        }
        if result.is_empty() {
            return Cow::Borrowed(slice(text, start, self.state.pos));
        }
        result.extend_from_slice(slice(text, start, self.state.pos));
        Cow::Owned(result)
    }

    fn scan_digits(&mut self) -> (&'a [u8], bool) {
        let start = self.state.pos;
        let mut is_octal = true;
        while is_digit(self.char()) {
            if !is_octal_digit(self.char()) {
                is_octal = false;
            }
            self.state.pos += 1;
        }
        (slice(self.text, start, self.state.pos), is_octal)
    }

    pub(crate) fn scan_hex_digits(
        &mut self,
        min_count: i32,
        scan_as_many_as_possible: bool,
        can_have_separators: bool,
    ) -> Cow<'a, [u8]> {
        let mut digit_count = 0;
        let start = self.state.pos;
        let mut allow_separator = false;
        let mut is_previous_token_separator = false;
        while digit_count < min_count || scan_as_many_as_possible {
            let ch = self.char();
            if is_hex_digit(ch) {
                allow_separator = can_have_separators;
                is_previous_token_separator = false;
                digit_count += 1;
            } else if can_have_separators && ch == r('_') {
                self.state.token_flags |= TokenFlags::CONTAINS_SEPARATOR;
                if allow_separator {
                    allow_separator = false;
                    is_previous_token_separator = true;
                } else if is_previous_token_separator {
                    self.error_at(
                        diagnostics::MULTIPLE_CONSECUTIVE_NUMERIC_SEPARATORS_ARE_NOT_PERMITTED,
                        self.state.pos,
                        1,
                        &[],
                    );
                } else {
                    self.error_at(
                        diagnostics::NUMERIC_SEPARATORS_ARE_NOT_ALLOWED_HERE,
                        self.state.pos,
                        1,
                        &[],
                    );
                }
            } else {
                break;
            }
            self.state.pos += 1;
        }
        if is_previous_token_separator {
            self.error_at(
                diagnostics::NUMERIC_SEPARATORS_ARE_NOT_ALLOWED_HERE,
                self.state.pos - 1,
                1,
                &[],
            );
        }
        if digit_count < min_count {
            return Cow::Borrowed(b"");
        }
        let digits = slice(self.text, start, self.state.pos);
        let has_separator = self
            .state
            .token_flags
            .intersects(TokenFlags::CONTAINS_SEPARATOR)
            && strings::contains_char(digits, b'_');
        // standardize hex literals to lowercase
        if !has_separator && !digits.iter().any(u8::is_ascii_uppercase) {
            return Cow::Borrowed(digits);
        }
        let mut normalized = Vec::with_capacity(digits.len());
        for &b in digits {
            if b != b'_' || !has_separator {
                normalized.push(b.to_ascii_lowercase());
            }
        }
        Cow::Owned(normalized)
    }

    fn scan_binary_or_octal_digits(&mut self, base: i32) -> Vec<u8> {
        let mut sb = Vec::new();
        let mut allow_separator = false;
        let mut is_previous_token_separator = false;
        loop {
            let ch = self.char();
            if is_digit(ch) && ch - r('0') < base {
                sb.push(ch as u8);
                allow_separator = true;
                is_previous_token_separator = false;
            } else if ch == r('_') {
                self.state.token_flags |= TokenFlags::CONTAINS_SEPARATOR;
                if allow_separator {
                    allow_separator = false;
                    is_previous_token_separator = true;
                } else if is_previous_token_separator {
                    self.error_at(
                        diagnostics::MULTIPLE_CONSECUTIVE_NUMERIC_SEPARATORS_ARE_NOT_PERMITTED,
                        self.state.pos,
                        1,
                        &[],
                    );
                } else {
                    self.error_at(
                        diagnostics::NUMERIC_SEPARATORS_ARE_NOT_ALLOWED_HERE,
                        self.state.pos,
                        1,
                        &[],
                    );
                }
            } else {
                break;
            }
            self.state.pos += 1;
        }
        if is_previous_token_separator {
            self.error_at(
                diagnostics::NUMERIC_SEPARATORS_ARE_NOT_ALLOWED_HERE,
                self.state.pos - 1,
                1,
                &[],
            );
        }
        sb
    }

    fn scan_big_int_suffix(&mut self) -> Kind {
        if self.char() == r('n') {
            self.state.token_value.to_mut().push(b'n');
            if self
                .state
                .token_flags
                .intersects(TokenFlags::BINARY_OR_OCTAL_SPECIFIER)
            {
                // Err is upstream's panic for digits that are no number: the digits were scanned as digits of the base, so the text stays as scanned.
                if let Ok(mut value) = jsnum::parse_pseudo_big_int(&self.state.token_value) {
                    value.push(b'n');
                    self.state.token_value = Cow::Owned(value);
                }
            }
            self.state.pos += 1;
            return Kind::BigIntLiteral;
        }
        let token_value = jsnum::from_string(&self.state.token_value).string();
        if token_value != *self.state.token_value {
            self.state.token_value = Cow::Owned(token_value);
        }
        Kind::NumericLiteral
    }

    fn scan_invalid_character(&mut self) {
        let (_, size) = self.char_and_size();
        self.error_at(diagnostics::INVALID_CHARACTER, self.state.pos, size, &[]);
        self.state.pos += size;
        self.state.token = Kind::Unknown;
    }
}

pub fn get_identifier_token(str: &[u8]) -> Kind {
    if str.len() >= 2 && str.len() <= 12 && str.first().is_some_and(u8::is_ascii_lowercase) {
        let keyword = text_to_keyword(str);
        if keyword != Kind::Unknown {
            return keyword;
        }
    }
    Kind::Identifier
}

pub fn is_valid_identifier(s: &[u8]) -> bool {
    if s.is_empty() {
        return false;
    }
    for (i, ch) in utf8::range(s) {
        if (i == 0 && !is_identifier_start(ch)) || (i != 0 && !is_identifier_part(ch)) {
            return false;
        }
    }
    true
}

// Section 6.1.4
fn is_word_character(ch: u32) -> bool {
    stringutil::is_ascii_letter(ch) || stringutil::is_digit(ch) || ch == '_' as u32
}

pub fn is_identifier_start(ch: u32) -> bool {
    stringutil::is_ascii_letter(ch)
        || ch == '_' as u32
        || ch == '$' as u32
        || (ch >= utf8::RUNE_SELF && stringutil::is_unicode_identifier_start(ch))
}

pub fn is_identifier_part(ch: u32) -> bool {
    is_identifier_part_ex(ch, LanguageVariant::STANDARD)
}

pub fn is_identifier_part_ex(ch: u32, language_variant: LanguageVariant) -> bool {
    // "-" and ":" are valid in JSX Identifiers
    is_word_character(ch)
        || ch == '$' as u32
        || (ch >= utf8::RUNE_SELF && stringutil::is_unicode_identifier_part(ch))
        || (language_variant == LanguageVariant::JSX && (ch == '-' as u32 || ch == ':' as u32))
}

pub fn token_to_string(token: Kind) -> &'static [u8] {
    token_to_text(token)
}

pub fn string_to_token(s: &[u8]) -> Kind {
    text_to_token(s)
}

// Upstream ranges over a map, so its order is not defined: here it is the order of the table.
pub fn get_viable_keyword_suggestions() -> Vec<&'static [u8]> {
    let mut result = Vec::with_capacity(KEYWORD_TEXTS.len());
    for text in KEYWORD_TEXTS {
        if text.len() > 2 {
            result.push(text);
        }
    }
    result
}

pub fn could_start_trivia(text: &[u8], pos: i32) -> bool {
    // Keep in sync with skipTrivia
    let ch = at(text, pos);
    match ascii(ch) {
        // Characters that could start normal trivia, then characters that could start conflict marker trivia
        '\r' | '\n' | '\t' | '\x0B' | '\x0C' | ' ' | '/' | '<' | '|' | '=' | '>' => true,
        // Only if its the beginning can we have #! trivia
        '#' => pos == 0,
        _ => ch > MAX_ASCII_CHARACTER,
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Default, Debug)]
pub struct SkipTriviaOptions {
    pub stop_after_line_break: bool,
    pub stop_at_comments: bool,
    pub in_jsdoc: bool,
}

pub fn skip_trivia(text: &[u8], pos: i32) -> i32 {
    skip_trivia_ex(text, pos, None)
}

pub fn skip_trivia_ex(text: &[u8], pos: i32, options: Option<&SkipTriviaOptions>) -> i32 {
    if ast::position_is_synthesized(pos) {
        return pos;
    }
    let options = options.copied().unwrap_or_default();

    let mut pos = pos;
    let text_len = len(text);
    let mut can_consume_star = false;
    // Keep in sync with couldStartTrivia
    loop {
        if pos >= text_len {
            return pos;
        }
        let (ch, size) = decode_rune(slice_from(text, pos));
        match ascii(ch) {
            '\r' | '\n' => {
                if ch == r('\r') && pos + 1 < text_len && at(text, pos + 1) == r('\n') {
                    pos += 1;
                }
                pos += 1;
                if options.stop_after_line_break {
                    return pos;
                }
                can_consume_star = options.in_jsdoc;
                continue;
            }
            '\t' | '\x0B' | '\x0C' | ' ' => {
                pos += 1;
                continue;
            }
            '/' => {
                if !options.stop_at_comments && pos + 1 < text_len {
                    if at(text, pos + 1) == r('/') {
                        pos += 2;
                        while pos < text_len {
                            let (ch, size) = decode_rune(slice_from(text, pos));
                            if is_line_break(ch) {
                                break;
                            }
                            pos += size;
                        }
                        can_consume_star = false;
                        continue;
                    }
                    if at(text, pos + 1) == r('*') {
                        pos += 2;
                        while pos < text_len {
                            if at(text, pos) == r('*')
                                && pos + 1 < text_len
                                && at(text, pos + 1) == r('/')
                            {
                                pos += 2;
                                break;
                            }
                            let (_, size) = decode_rune(slice_from(text, pos));
                            pos += size;
                        }
                        can_consume_star = false;
                        continue;
                    }
                }
            }
            '<' | '|' | '=' | '>' => {
                if is_conflict_marker_trivia(text, pos) {
                    pos = scan_conflict_marker_trivia(text, pos, None);
                    can_consume_star = false;
                    continue;
                }
            }
            '#' => {
                if pos == 0 && is_shebang_trivia(text, pos) {
                    pos = scan_shebang_trivia(text, pos);
                    can_consume_star = false;
                    continue;
                }
            }
            '*' => {
                if can_consume_star {
                    pos += 1;
                    can_consume_star = false;
                    continue;
                }
            }
            _ => {
                if ch > MAX_ASCII_CHARACTER && is_white_space_like(ch) {
                    pos += size;
                    continue;
                }
            }
        }
        return pos;
    }
}

// All conflict markers consist of the same character repeated seven times. If it is a <<<<<<< or >>>>>>> marker then it is also followed by a space.
const MERGE_CONFLICT_MARKER_LENGTH: i32 = 7;
const MAX_ASCII_CHARACTER: Rune = 127;

fn is_conflict_marker_trivia(text: &[u8], pos: i32) -> bool {
    // Upstream panics for a negative position: every caller passes a position inside the text.
    if pos < 0 {
        return false;
    }

    // Fast reject: a conflict marker is the same byte repeated seven times. If the second byte differs (the overwhelmingly common case for `<`, `>`, `=`, `|` tokens), it cannot be a marker, so skip the line-start check entirely.
    if pos + 1 >= len(text) || at(text, pos + 1) != at(text, pos) {
        return false;
    }

    // Conflict markers must be at the start of a line.
    let mut at_line_start = pos == 0 || is_line_break(at(text, pos - 1));
    if !at_line_start && pos >= 2 {
        let (prev, _) = decode_last_rune(slice(text, 0, pos - 2));
        at_line_start = is_line_break(prev);
    }
    if at_line_start {
        let ch = at(text, pos);

        if pos + MERGE_CONFLICT_MARKER_LENGTH < len(text) {
            for i in 0..MERGE_CONFLICT_MARKER_LENGTH {
                if at(text, pos + i) != ch {
                    return false;
                }
            }

            return ch == r('=') || at(text, pos + MERGE_CONFLICT_MARKER_LENGTH) == r(' ');
        }
    }

    false
}

fn scan_conflict_marker_trivia(
    text: &[u8],
    pos: i32,
    report_error: Option<&mut dyn FnMut(MessageId, i32, i32, &[Arg<'_>])>,
) -> i32 {
    if let Some(report_error) = report_error {
        report_error(
            diagnostics::MERGE_CONFLICT_MARKER_ENCOUNTERED,
            pos,
            MERGE_CONFLICT_MARKER_LENGTH,
            &[],
        );
    }
    let mut pos = pos;
    let (mut ch, mut size) = decode_rune(slice_from(text, pos));
    let length = len(text);

    if ch == r('<') || ch == r('>') {
        while pos < length && !is_line_break(ch) {
            pos += size;
            (ch, size) = decode_rune(slice_from(text, pos));
        }
    } else {
        // Upstream asserts that ch is '|' or '=': the callers test for a conflict marker first, which starts with one of the four characters.
        if ch != r('|') && ch != r('=') {
            return pos;
        }
        // Consume everything from the start of a ||||||| or ======= marker to the start of the next ======= or >>>>>>> marker.
        while pos < length {
            let current_char = at(text, pos);
            if (current_char == r('=') || current_char == r('>'))
                && current_char != ch
                && is_conflict_marker_trivia(text, pos)
            {
                break;
            }

            pos += 1;
        }
    }

    pos
}

fn is_shebang_trivia(text: &[u8], pos: i32) -> bool {
    if text.len() < 2 {
        return false;
    }
    // Upstream panics when the check is not made at the start of the file: every caller passes 0.
    if pos != 0 {
        return false;
    }
    strings::has_prefix(text, b"#!")
}

fn scan_shebang_trivia(text: &[u8], pos: i32) -> i32 {
    let mut pos = pos + 2;
    while pos < len(text) {
        let (ch, size) = decode_rune(slice_from(text, pos));
        if is_line_break(ch) {
            break;
        }
        pos += size;
    }
    pos
}

pub fn get_shebang(text: &[u8]) -> &[u8] {
    if !is_shebang_trivia(text, 0) {
        return b"";
    }

    let end = scan_shebang_trivia(text, 0);
    slice(text, 0, end)
}

pub fn get_scanner_for_source_file<'a>(a: Ast<'a>, source_file: NodeId, pos: i32) -> Scanner<'a> {
    let file = a.as_source_file(source_file);
    let mut s = new_scanner();
    s.text = file.text();
    s.state.pos = pos;
    s.end = len(s.text);
    s.language_variant = file.language_variant;
    s.scan();
    s
}

pub fn scan_token_at_position(a: Ast<'_>, source_file: NodeId, pos: i32) -> Kind {
    let s = get_scanner_for_source_file(a, source_file, pos);
    s.state.token
}

pub fn get_range_of_token_at_position(a: Ast<'_>, source_file: NodeId, pos: i32) -> TextRange {
    let s = get_scanner_for_source_file(a, source_file, pos);
    new_text_range(s.state.token_start as _, s.state.pos as _)
}

pub fn get_token_pos_of_node(
    a: Ast<'_>,
    node: NodeId,
    source_file: NodeId,
    include_jsdoc: bool,
) -> i32 {
    // With nodes that have no width (i.e. 'Missing' nodes), we actually *don't* want to skip trivia because this will launch us forward to the next token.
    if ast::node_is_missing(a, node) {
        return a.pos(node);
    }
    let text = a.as_source_file(source_file).text();
    if ast::is_jsdoc_node(a, node) || a.kind(node) == Kind::JsxText {
        // JsxText cannot actually contain comments, even though the scanner will think it sees comments
        return skip_trivia_ex(
            text,
            a.pos(node),
            Some(&SkipTriviaOptions {
                stop_at_comments: true,
                ..SkipTriviaOptions::default()
            }),
        );
    }
    if include_jsdoc {
        let jsdoc = a.jsdoc(node);
        if jsdoc.len() > 0 {
            return get_token_pos_of_node(a, jsdoc.at(0), source_file, false);
        }
    }
    skip_trivia_ex(
        text,
        a.pos(node),
        Some(&SkipTriviaOptions {
            in_jsdoc: a.flags(node).intersects(NodeFlags::JSDOC),
            ..SkipTriviaOptions::default()
        }),
    )
}

fn get_error_range_for_arrow_function(a: Ast<'_>, source_file: NodeId, node: NodeId) -> TextRange {
    let file = a.as_source_file(source_file);
    let pos = skip_trivia(file.text(), a.pos(node));
    let body = a.body(node);
    if !body.is_nil() && a.kind(body) == Kind::Block {
        let start_line = get_ecma_line_of_position(&file, a.pos(body));
        let end_line = get_ecma_line_of_position(&file, a.end(body));
        if start_line < end_line {
            // The arrow function spans multiple lines, make the error span be the first line, inclusive.
            return new_text_range(
                pos as _,
                (get_ecma_end_line_position(a, source_file, start_line) + 1) as _,
            );
        }
    }
    new_text_range(pos as _, a.end(node) as _)
}

fn find_originating_jsdoc_satisfies_tag(a: Ast<'_>, node: NodeId) -> NodeId {
    let target_type = a.as_satisfies_expression(node).type_node;
    if !a.flags(target_type).intersects(NodeFlags::REPARSED) {
        return NodeId::NIL;
    }
    let mut current = a.parent(node);
    while !current.is_nil() {
        if !a.flags(current).intersects(NodeFlags::HAS_JSDOC) {
            current = a.parent(current);
            continue;
        }
        let mut first_satisfies_tag = NodeId::NIL;
        for &jsdoc in a.eager_jsdoc(current).as_slice() {
            let tags = a.as_jsdoc(jsdoc).tags;
            if !tags.is_nil() {
                for &tag in a.nodes(tags).as_slice() {
                    if !ast::is_jsdoc_satisfies_tag(a, tag) {
                        continue;
                    }
                    if first_satisfies_tag.is_nil() {
                        first_satisfies_tag = tag;
                    }
                    let type_expr = a.as_jsdoc_satisfies_tag(tag).type_expression;
                    if !type_expr.is_nil() {
                        let t = a.type_node(type_expr);
                        if !t.is_nil() && a.loc(t) == a.loc(target_type) {
                            return tag;
                        }
                    }
                }
            }
        }
        return first_satisfies_tag;
    }
    NodeId::NIL
}

pub fn get_error_range_for_node(a: Ast<'_>, source_file: NodeId, node: NodeId) -> TextRange {
    let text = a.as_source_file(source_file).text();
    let mut error_node = node;
    match a.kind(node) {
        Kind::SourceFile => {
            let pos = skip_trivia(text, 0);
            if pos == len(text) {
                return new_text_range(0, 0);
            }
            return get_range_of_token_at_position(a, source_file, pos);
        }
        // This list is a work in progress. Add missing node kinds to improve their error spans
        Kind::FunctionDeclaration
        | Kind::MethodDeclaration
        | Kind::VariableDeclaration
        | Kind::BindingElement
        | Kind::ClassDeclaration
        | Kind::InterfaceDeclaration
        | Kind::ModuleDeclaration
        | Kind::EnumDeclaration
        | Kind::EnumMember
        | Kind::FunctionExpression
        | Kind::GetAccessor
        | Kind::SetAccessor
        | Kind::TypeAliasDeclaration
        | Kind::JSTypeAliasDeclaration
        | Kind::PropertyDeclaration
        | Kind::PropertySignature
        | Kind::NamespaceImport => {
            // Upstream's case of a function or method declaration keeps a reparsed node and falls through for any other.
            let reparsed_function = matches!(
                a.kind(node),
                Kind::FunctionDeclaration | Kind::MethodDeclaration
            ) && a.flags(node).intersects(NodeFlags::REPARSED);
            if !reparsed_function {
                error_node = ast::get_name_of_declaration(a, node);
            }
        }
        Kind::ClassExpression => {
            error_node = a.name(node);
        }
        Kind::ArrowFunction => {
            return get_error_range_for_arrow_function(a, source_file, node);
        }
        Kind::CaseClause | Kind::DefaultClause => {
            let start = skip_trivia(text, a.pos(node));
            let mut end = a.end(node);
            let statements = a.statements(node);
            if statements.len() != 0 {
                end = a.pos(statements.at(0));
            }
            return new_text_range(start as _, end as _);
        }
        Kind::ReturnStatement | Kind::YieldExpression => {
            let pos = skip_trivia(text, a.pos(node));
            return get_range_of_token_at_position(a, source_file, pos);
        }
        Kind::SatisfiesExpression => {
            let jsdoc_satisfies_tag = find_originating_jsdoc_satisfies_tag(a, node);
            if !jsdoc_satisfies_tag.is_nil() {
                let pos = skip_trivia(text, a.pos(a.tag_name(jsdoc_satisfies_tag)));
                return get_range_of_token_at_position(a, source_file, pos);
            }
            let pos = skip_trivia(text, a.end(a.as_satisfies_expression(node).expression));
            return get_range_of_token_at_position(a, source_file, pos);
        }
        Kind::Constructor => {
            if !a.flags(node).intersects(NodeFlags::REPARSED) {
                let mut scanner = get_scanner_for_source_file(a, source_file, a.pos(node));
                let start = scanner.token_start();
                while scanner.token() != Kind::ConstructorKeyword
                    && scanner.token() != Kind::StringLiteral
                    && scanner.token() != Kind::EndOfFile
                {
                    scanner.scan();
                }
                return new_text_range(start as _, scanner.token_end() as _);
            }
        }
        _ => {}
    }
    if error_node.is_nil() {
        // If we don't have a better node, then just set the error on the first token of construct.
        return get_range_of_token_at_position(a, source_file, a.pos(node));
    }
    let mut pos = a.pos(error_node);
    if !ast::node_is_missing(a, error_node) && !ast::is_jsx_text(a, error_node) {
        pos = skip_trivia(text, pos);
    }
    new_text_range(pos as _, a.end(error_node) as _)
}

pub fn compute_line_of_position(line_starts: &[TextPos], pos: i32) -> isize {
    let mut low: isize = 0;
    let mut high: isize = line_starts.len() as isize - 1;
    while low <= high {
        let middle = low + ((high - low) >> 1);
        let value = line_start_at(line_starts, middle);
        if value < pos {
            low = middle + 1;
        } else if value > pos {
            high = middle - 1;
        } else {
            return middle;
        }
    }
    low - 1
}

// `int(lineStarts[line])`: 0 for a line outside the map, where Go panics.
fn line_start_at(line_starts: &[TextPos], line: isize) -> i32 {
    match usize::try_from(line)
        .ok()
        .and_then(|line| line_starts.get(line))
    {
        Some(start) => start.0,
        None => 0,
    }
}

pub fn get_ecma_line_starts(source_file: &dyn SourceFileLike) -> &[TextPos] {
    source_file.ecma_line_map()
}

pub fn get_ecma_line_of_position(source_file: &dyn SourceFileLike, pos: i32) -> isize {
    let line_map = get_ecma_line_starts(source_file);
    compute_line_of_position(line_map, pos)
}

// GetECMALineAndUTF16CharacterOfPosition returns the 0-based line number and the UTF-16 code unit offset from the start of that line for the given byte position. Uses ECMAScript line separators (LF, CR, CRLF, LS, PS).
pub fn get_ecma_line_and_utf16_character_of_position(
    source_file: &dyn SourceFileLike,
    pos: i32,
) -> (isize, UTF16Offset) {
    let line_map = get_ecma_line_starts(source_file);
    let line = compute_line_of_position(line_map, pos);
    let character = utf16_len(slice(
        source_file.text(),
        line_start_at(line_map, line),
        pos,
    ));
    (line, character)
}

// GetECMALineAndByteOffsetOfPosition returns the 0-based line number and the raw UTF-8 byte offset from the start of that line for the given byte position. Unlike GetECMALineAndUTF16CharacterOfPosition, the offset is in bytes, not UTF-16 code units.
pub fn get_ecma_line_and_byte_offset_of_position(
    source_file: &dyn SourceFileLike,
    pos: i32,
) -> (isize, i32) {
    let line_map = get_ecma_line_starts(source_file);
    let line = compute_line_of_position(line_map, pos);
    let byte_offset = pos - line_start_at(line_map, line);
    (line, byte_offset)
}

pub fn get_ecma_end_line_position(a: Ast<'_>, source_file: NodeId, line: isize) -> i32 {
    let file = a.as_source_file(source_file);
    let text = file.text();
    let mut pos = line_start_at(get_ecma_line_starts(&file), line);
    loop {
        let (ch, size) = decode_rune(slice_from(text, pos));
        if size == 0 || is_line_break(ch) {
            return pos - 1;
        }
        pos += size;
    }
}

// GetECMAPositionOfLineAndUTF16Character converts a 0-based line number and UTF-16 code unit character offset back to an absolute byte position in the source text. Uses ECMAScript line separators. Err is upstream's panic with its message.
pub fn get_ecma_position_of_line_and_utf16_character(
    source_file: &dyn SourceFileLike,
    line: isize,
    character: UTF16Offset,
) -> Result<i32, &'static str> {
    let line_starts = get_ecma_line_starts(source_file);
    compute_position_of_line_and_utf16_character(
        line_starts,
        line,
        character,
        source_file.text(),
        false,
    )
}

// GetECMAPositionOfLineAndByteOffset converts a 0-based line number and byte offset from line start back to an absolute byte position in the source text. Uses ECMAScript line separators. Err is upstream's panic with its message.
pub fn get_ecma_position_of_line_and_byte_offset(
    source_file: &dyn SourceFileLike,
    line: isize,
    byte_offset: i32,
) -> Result<i32, &'static str> {
    compute_position_of_line_and_byte_offset(get_ecma_line_starts(source_file), line, byte_offset)
}

// ComputePositionOfLineAndByteOffset computes a byte position from a line and raw byte offset from the line start. This is a simple addition with validation. Err is upstream's panic with its message.
pub fn compute_position_of_line_and_byte_offset(
    line_starts: &[TextPos],
    line: isize,
    byte_offset: i32,
) -> Result<i32, &'static str> {
    if line < 0 || line >= line_starts.len() as isize {
        return Err("Bad line number.");
    }
    Ok(line_start_at(line_starts, line) + byte_offset)
}

// ComputePositionOfLineAndUTF16Character converts a line and UTF-16 character offset back to a byte position. The character parameter is measured in UTF-16 code units. It scans from the line start to correctly handle multi-byte characters. When allowEdits is true, out-of-range values are clamped instead of panicking. Err is upstream's panic with its message.
pub fn compute_position_of_line_and_utf16_character(
    line_starts: &[TextPos],
    line: isize,
    character: UTF16Offset,
    text: &[u8],
    allow_edits: bool,
) -> Result<i32, &'static str> {
    let mut line = line;
    let line_count = line_starts.len() as isize;
    if line < 0 || line >= line_count {
        if allow_edits {
            // Clamp line to nearest allowable value
            if line < 0 {
                line = 0;
            } else if line >= line_count {
                line = line_count - 1;
            }
        } else {
            return Err("Bad line number.");
        }
    }

    let line_start = line_start_at(line_starts, line);

    if character.0 > 0 {
        // UTF-16 character offset: scan from line start counting UTF-16 code units.
        let mut line_end = len(text);
        if line + 1 < line_count {
            line_end = line_start_at(line_starts, line + 1);
        }
        let mut utf16_count = UTF16Offset(0);
        let mut pos = line_start;
        while pos < line_end {
            if utf16_count.0 >= character.0 {
                break;
            }
            let (ch, size) = decode_rune(slice_from(text, pos));
            utf16_count.0 += utf16::rune_len(ch as u32);
            // A line map that ends after the text would make no progress here.
            pos += size.max(1);
        }
        if !allow_edits {
            if pos == line_end && utf16_count.0 < character.0 {
                return Err("Bad UTF-16 character offset.");
            }
            if pos > len(text) {
                return Err("pos <= len(text)");
            }
            return Ok(pos);
        }
        if pos > len(text) {
            return Ok(len(text));
        }
        return Ok(pos);
    }

    // Character is 0: line start position.
    let res = line_start;

    if allow_edits {
        if res > len(text) {
            return Ok(len(text));
        }
        return Ok(res);
    }
    // Allow single character overflow for trailing newline
    if res > len(text) {
        return Err("res <= len(text)");
    }
    Ok(res)
}

// The factory of upstream's signature only makes the comment ranges, and the sequence is not lazy here: the comment ranges are returned as a list.
pub fn get_leading_comment_ranges(text: &[u8], pos: i32) -> Vec<CommentRange> {
    iterate_comment_ranges(text, pos, false)
}

pub fn get_trailing_comment_ranges(text: &[u8], pos: i32) -> Vec<CommentRange> {
    iterate_comment_ranges(text, pos, true)
}

// Returns each comment range following the provided position. Single-line comment ranges include the leading double-slash characters but not the ending line break. Multi-line comment ranges include the leading slash-asterisk and trailing asterisk-slash characters.
fn iterate_comment_ranges(text: &[u8], pos: i32, trailing: bool) -> Vec<CommentRange> {
    let mut ranges = Vec::new();
    let mut pos = pos;
    let mut pending_pos = 0;
    let mut pending_end = 0;
    let mut pending_kind = Kind::Unknown;
    let mut pending_has_trailing_new_line = false;
    let mut has_pending_comment_range = false;
    let mut collecting = trailing;
    if pos == 0 {
        collecting = true;
        if is_shebang_trivia(text, pos) {
            pos = scan_shebang_trivia(text, pos);
        }
    }
    while pos >= 0 && pos < len(text) {
        let (ch, size) = decode_rune(slice_from(text, pos));
        match ascii(ch) {
            '\r' | '\n' => {
                if ch == r('\r') && pos + 1 < len(text) && at(text, pos + 1) == r('\n') {
                    pos += 1;
                }
                pos += 1;
                if trailing {
                    break;
                }

                collecting = true;
                if has_pending_comment_range {
                    pending_has_trailing_new_line = true;
                }

                continue;
            }
            '\t' | '\x0B' | '\x0C' | ' ' => {
                pos += 1;
                continue;
            }
            '/' => {
                let next_char = if pos + 1 < len(text) {
                    at(text, pos + 1)
                } else {
                    0
                };
                let mut has_trailing_new_line = false;
                if next_char == r('/') || next_char == r('*') {
                    let kind = if next_char == r('/') {
                        Kind::SingleLineCommentTrivia
                    } else {
                        Kind::MultiLineCommentTrivia
                    };

                    let start_pos = pos;
                    pos += 2;
                    if next_char == r('/') {
                        while pos < len(text) {
                            let (c, s) = decode_rune(slice_from(text, pos));
                            if is_line_break(c) {
                                has_trailing_new_line = true;
                                break;
                            }
                            pos += s;
                        }
                    } else {
                        match strings::index_of(slice_from(text, pos), b"*/") {
                            Some(i) => pos += i as i32 + 2,
                            None => pos = len(text),
                        }
                    }

                    if collecting {
                        if has_pending_comment_range {
                            ranges.push(ast::new_comment_range(
                                pending_kind,
                                pending_pos,
                                pending_end,
                                pending_has_trailing_new_line,
                            ));
                        }

                        pending_pos = start_pos;
                        pending_end = pos;
                        pending_kind = kind;
                        pending_has_trailing_new_line = has_trailing_new_line;
                        has_pending_comment_range = true;
                    }

                    continue;
                }
                break;
            }
            _ => {
                if ch > MAX_ASCII_CHARACTER && is_white_space_like(ch) {
                    if has_pending_comment_range && is_line_break(ch) {
                        pending_has_trailing_new_line = true;
                    }
                    pos += size;
                    continue;
                }
                break;
            }
        }
    }

    if has_pending_comment_range {
        ranges.push(ast::new_comment_range(
            pending_kind,
            pending_pos,
            pending_end,
            pending_has_trailing_new_line,
        ));
    }
    ranges
}
// The keys of textToKeyword, in the order of its source.
const KEYWORD_TEXTS: [&[u8]; 85] = [
    b"abstract",
    b"accessor",
    b"any",
    b"as",
    b"asserts",
    b"assert",
    b"bigint",
    b"boolean",
    b"break",
    b"case",
    b"catch",
    b"class",
    b"continue",
    b"const",
    b"constructor",
    b"debugger",
    b"declare",
    b"default",
    b"defer",
    b"delete",
    b"do",
    b"else",
    b"enum",
    b"export",
    b"extends",
    b"false",
    b"finally",
    b"for",
    b"from",
    b"function",
    b"get",
    b"if",
    b"immediate",
    b"implements",
    b"import",
    b"in",
    b"infer",
    b"instanceof",
    b"interface",
    b"intrinsic",
    b"is",
    b"keyof",
    b"let",
    b"module",
    b"namespace",
    b"never",
    b"new",
    b"null",
    b"number",
    b"object",
    b"package",
    b"private",
    b"protected",
    b"public",
    b"override",
    b"out",
    b"readonly",
    b"require",
    b"global",
    b"return",
    b"satisfies",
    b"set",
    b"static",
    b"string",
    b"super",
    b"switch",
    b"symbol",
    b"this",
    b"throw",
    b"true",
    b"try",
    b"type",
    b"typeof",
    b"undefined",
    b"unique",
    b"unknown",
    b"using",
    b"var",
    b"void",
    b"while",
    b"with",
    b"yield",
    b"async",
    b"await",
    b"of",
];
