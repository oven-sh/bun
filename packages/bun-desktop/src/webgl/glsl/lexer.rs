//! From characters to preprocessing tokens.

use std::collections::HashMap;
use std::sync::LazyLock;

use super::{Error, Result};

/// A spelling.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub struct Name(pub u32);

macro_rules! known {
    ($($name:ident $text:literal)*) => {
        #[derive(Clone, Copy, PartialEq, Eq, Debug)]
        pub enum Known { $($name,)* Other }
        const KNOWN: &[(Known, &str)] = &[$((Known::$name, $text)),*];
    };
}

known! {
    Nothing "" ShiftLeftAssign "<<=" ShiftRightAssign ">>=" Increment "++" Decrement "--" ShiftLeft "<<" ShiftRight ">>" LessEqual "<=" GreaterEqual ">="
    Equal "==" NotEqual "!=" And "&&" Or "||" Xor "^^" AddAssign "+=" SubtractAssign "-=" MultiplyAssign "*=" DivideAssign "/=" ModuloAssign "%="
    AndAssign "&=" OrAssign "|=" XorAssign "^=" LeftParen "(" RightParen ")" LeftBracket "[" RightBracket "]" LeftBrace "{" RightBrace "}" Dot "."
    Comma "," Colon ":" Semicolon ";" Question "?" Assign "=" Not "!" Minus "-" Tilde "~" Plus "+" Star "*" Slash "/" Percent "%" Less "<" Greater ">"
    Bar "|" Caret "^" Ampersand "&" Hash "#"
    Define "define" Undef "undef" Ifdef "ifdef" Ifndef "ifndef" Elif "elif" Endif "endif" Error "error" Pragma "pragma" Extension "extension"
    Version "version" Line "line" Defined "defined" LineMacro "__LINE__" FileMacro "__FILE__" Es "es" All "all"
    Require "require" Enable "enable" Warn "warn" Disable "disable" Stdgl "STDGL" Main "main" Length "length" Location "location" Index "index"
    Shared "shared" Packed "packed" Std140 "std140" RowMajor "row_major" ColumnMajor "column_major" DepthAny "depth_any" DepthGreater "depth_greater"
    DepthLess "depth_less"
    Const "const" Uniform "uniform" Attribute "attribute" Varying "varying" Layout "layout" Centroid "centroid" Flat "flat" Smooth "smooth"
    Noperspective "noperspective" Sample "sample" In "in" Out "out" Inout "inout" Invariant "invariant" Lowp "lowp" Mediump "mediump" Highp "highp"
    Precision "precision" Break "break" Continue "continue" Do "do" For "for" While "while" Switch "switch" Case "case" Default "default" If "if"
    Else "else" Discard "discard" Return "return" True "true" False "false" Struct "struct"
}

impl From<Known> for Name {
    fn from(known: Known) -> Name {
        Name(known as u32)
    }
}

impl Known {
    pub fn text(self) -> &'static str {
        KNOWN.get(self as usize).map_or("", |it| it.1)
    }
}

pub struct Names<'a> {
    numbers: HashMap<&'a str, Name>,
    texts: Vec<&'a str>,
    /// Of the numbers that the preprocessor has come up with.
    made: Vec<(Name, String)>,
}

impl<'a> Names<'a> {
    pub fn new() -> Names<'a> {
        static NUMBERS: LazyLock<HashMap<&str, Name>> =
            LazyLock::new(|| KNOWN.iter().map(|it| (it.1, it.0.into())).collect());
        Names {
            numbers: NUMBERS.clone(),
            texts: KNOWN.iter().map(|it| it.1).collect(),
            made: Vec::new(),
        }
    }

    pub fn intern(&mut self, text: &'a str) -> Name {
        *self.numbers.entry(text).or_insert_with(|| {
            self.texts.push(text);
            Name(self.texts.len() as u32 - 1)
        })
    }

    pub fn find(&self, text: &str) -> Option<Name> {
        self.numbers.get(text).copied()
    }

    pub fn number(&mut self, value: i32) -> Name {
        let name = Name(self.texts.len() as u32);
        self.texts.push("");
        self.made.push((name, value.to_string()));
        name
    }

    pub fn text(&self, name: Name) -> &str {
        match self.texts[name.0 as usize] {
            "" => self
                .made
                .binary_search_by_key(&name.0, |it| it.0.0)
                .map_or("", |at| &self.made[at].1),
            text => text,
        }
    }

    pub fn len(&self) -> usize {
        self.texts.len()
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Kind {
    Identifier,
    Number,
    Punctuator,
    /// Characters that the language does not have.
    Foreign,
    Newline,
    End,
}

#[derive(Clone, Copy, Debug)]
pub struct Token {
    pub name: Name,
    pub line: u32,
    pub kind: Kind,
    pub follows_space: bool,
    /// It was met in the expansion of the macro that it names.
    pub is_final: bool,
}

impl Token {
    pub fn known(self) -> Known {
        KNOWN
            .get(self.name.0 as usize)
            .map_or(Known::Other, |it| it.0)
    }

    pub fn is(self, known: Known) -> bool {
        self.name.0 == known as u32
    }
}

/// Joins the lines that end with a backslash. Also returns where.
pub fn splice(source: &str) -> (String, Vec<usize>) {
    let (mut text, mut joints, mut rest) =
        (String::with_capacity(source.len()), Vec::new(), source);
    while let Some((before, after)) = rest.split_once('\\') {
        text.push_str(before);
        rest = ["\r\n", "\n", "\r"]
            .iter()
            .find_map(|it| after.strip_prefix(it))
            .inspect(|_| joints.push(text.len()))
            .unwrap_or_else(|| {
                text.push('\\');
                after
            });
    }
    text.push_str(rest);
    (text, joints)
}

fn is_word(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_'
}

fn number_length(bytes: &[u8]) -> usize {
    let is_hexadecimal = matches!(bytes, [b'0', b'x' | b'X', ..]);
    let continues = |at: usize| match bytes[at] {
        b'+' | b'-' => {
            !is_hexadecimal
                && matches!(bytes[at - 1], b'e' | b'E')
                && bytes.get(at + 1).is_some_and(u8::is_ascii_digit)
        }
        byte => is_word(byte) || byte == b'.',
    };
    (1..bytes.len())
        .find(|it| !continues(*it))
        .unwrap_or(bytes.len())
}

/// The last one is `Kind::End`.
pub fn tokenize<'a>(
    text: &'a str,
    mut joints: &[usize],
    longest: usize,
    names: &mut Names<'a>,
) -> Result<Vec<Token>> {
    let (bytes, mut at, mut line, mut follows_space) = (text.as_bytes(), 0, 1, false);
    let mut tokens = Vec::with_capacity(bytes.len() / 4);
    loop {
        while let [joint, rest @ ..] = joints
            && *joint <= at
        {
            (line, joints) = (line + 1, rest);
        }
        let rest = &bytes[at..];
        let until =
            |stop: fn(u8) -> bool| rest.iter().position(|it| stop(*it)).unwrap_or(rest.len());
        let (kind, length) = match rest {
            [] => (Kind::End, 0),
            [b' ' | b'\t' | 0x0b | 0x0c, ..] => {
                (at, follows_space) = (at + 1, true);
                continue;
            }
            [b'/', b'/', ..] => {
                (at, follows_space) = (at + until(|it| matches!(it, b'\n' | b'\r')), true);
                continue;
            }
            [b'/', b'*', ..] => {
                let length = text[at + 2..]
                    .find("*/")
                    .ok_or_else(|| Error::new(line, "/*", "the comment does not end"))?;
                line += rest[1..length + 3]
                    .array_windows()
                    .filter(|it| matches!(it, [_, b'\r'] | [0..=12 | 14.., b'\n']))
                    .count() as u32;
                (at, follows_space) = (at + length + 4, true);
                continue;
            }
            [b'\r', b'\n', ..] => (Kind::Newline, 2),
            [b'\n' | b'\r', ..] => (Kind::Newline, 1),
            [b'0'..=b'9', ..] | [b'.', b'0'..=b'9', ..] => (Kind::Number, number_length(rest)),
            [first, ..] if is_word(*first) => (Kind::Identifier, until(|it| !is_word(it))),
            [first, ..] if !first.is_ascii() => (Kind::Foreign, until(|it| it.is_ascii())),
            [b'<', b'<', b'=', ..] | [b'>', b'>', b'=', ..] => (Kind::Punctuator, 3),
            [
                b'+' | b'-' | b'*' | b'/' | b'%' | b'&' | b'|' | b'^' | b'<' | b'>' | b'=' | b'!',
                b'=',
                ..,
            ] => (Kind::Punctuator, 2),
            [a @ (b'+' | b'-' | b'<' | b'>' | b'&' | b'|' | b'^'), b, ..] if a == b => {
                (Kind::Punctuator, 2)
            }
            [
                b'"' | b'$' | b'\'' | b'@' | b'\\' | b'`' | 0..0x20 | 0x7f,
                ..,
            ] => (Kind::Foreign, 1),
            _ => (Kind::Punctuator, 1),
        };
        let spelling = &text[at..at + length];
        if length > longest && kind != Kind::Foreign {
            return Err(Error::new(line, spelling, "it has too many characters"));
        }
        let name = if kind == Kind::Newline {
            Known::Nothing.into()
        } else {
            names.intern(spelling)
        };
        tokens.push(Token {
            name,
            line,
            kind,
            follows_space,
            is_final: false,
        });
        if kind == Kind::End {
            return Ok(tokens);
        }
        (at, line, follows_space) = (at + length, line + u32::from(kind == Kind::Newline), false);
    }
}

/// The bits, and whether it is unsigned. `None` if it is no integer, or too large.
pub fn integer(text: &str) -> Option<(u32, bool)> {
    let digits = text.strip_suffix(['u', 'U']);
    let (is_unsigned, digits) = (digits.is_some(), digits.unwrap_or(text));
    let (digits, radix) = match digits.as_bytes() {
        [b'0', b'x' | b'X', ..] => (&digits[2..], 16),
        [b'0', _, ..] => (&digits[1..], 8),
        _ => (digits, 10),
    };
    Some((
        u32::from_str_radix(digits, radix)
            .ok()
            .filter(|_| !digits.starts_with('+'))?,
        is_unsigned,
    ))
}

pub fn float(text: &str, takes_suffix: bool) -> Option<f32> {
    let digits = text
        .strip_suffix(['f', 'F'])
        .filter(|_| takes_suffix)
        .unwrap_or(text);
    let is_plain = digits
        .bytes()
        .all(|it| matches!(it, b'0'..=b'9' | b'.' | b'e' | b'E' | b'+' | b'-'));
    (is_plain && digits.contains(['.', 'e', 'E'])).then(|| digits.parse().ok())?
}
