// SCRATCH STAND-IN, not delivered: the five functions of scanner/scanner.rs that the JavaScript step calls, with their signatures.
use crate::ast::Kind;
use crate::stringutil;
use crate::stringutil::util::utf8;

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
    is_word_character(ch)
        || ch == '$' as u32
        || (ch >= utf8::RUNE_SELF && stringutil::is_unicode_identifier_part(ch))
}
pub fn token_to_string(token: Kind) -> &'static [u8] {
    match token {
        Kind::ModuleKeyword => b"module",
        Kind::NamespaceKeyword => b"namespace",
        Kind::GlobalKeyword => b"global",
        Kind::PublicKeyword => b"public",
        Kind::PrivateKeyword => b"private",
        Kind::ProtectedKeyword => b"protected",
        Kind::ReadonlyKeyword => b"readonly",
        Kind::AbstractKeyword => b"abstract",
        Kind::DeclareKeyword => b"declare",
        Kind::OverrideKeyword => b"override",
        Kind::ConstKeyword => b"const",
        Kind::InKeyword => b"in",
        Kind::OutKeyword => b"out",
        _ => b"?",
    }
}
// The prototype's skipTrivia (probe/jscheck.mjs): white space, line breaks, comments and a shebang.
pub fn skip_trivia(b: &[u8], pos: i32) -> i32 {
    if pos < 0 {
        return pos;
    }
    let mut pos = pos as usize;
    let at = |i: usize| b.get(i).copied().unwrap_or(0);
    loop {
        if pos >= b.len() {
            return pos as i32;
        }
        let ch = at(pos);
        if matches!(ch, 0x0d | 0x0a | 0x09 | 0x0b | 0x0c | 0x20) {
            pos += 1;
            continue;
        }
        if ch == 0x2f {
            if at(pos + 1) == 0x2f {
                pos += 2;
                while pos < b.len()
                    && at(pos) != 0x0a
                    && at(pos) != 0x0d
                    && !(at(pos) == 0xe2 && at(pos + 1) == 0x80 && (at(pos + 2) == 0xa8 || at(pos + 2) == 0xa9))
                {
                    pos += 1;
                }
                continue;
            }
            if at(pos + 1) == 0x2a {
                pos += 2;
                while pos < b.len() && !(at(pos) == 0x2a && at(pos + 1) == 0x2f) {
                    pos += 1;
                }
                pos = (pos + 2).min(b.len());
                continue;
            }
            return pos as i32;
        }
        if ch == 0xc2 && (at(pos + 1) == 0xa0 || at(pos + 1) == 0x85) {
            pos += 2;
            continue;
        }
        if ch == 0xe2 && at(pos + 1) == 0x80 && ((0x80..=0x8b).contains(&at(pos + 2)) || matches!(at(pos + 2), 0xa8 | 0xa9 | 0xaf)) {
            pos += 3;
            continue;
        }
        if (ch == 0xe1 && at(pos + 1) == 0x9a && at(pos + 2) == 0x80)
            || (ch == 0xe2 && at(pos + 1) == 0x81 && at(pos + 2) == 0x9f)
            || (ch == 0xe3 && at(pos + 1) == 0x80 && at(pos + 2) == 0x80)
            || (ch == 0xef && at(pos + 1) == 0xbb && at(pos + 2) == 0xbf)
        {
            pos += 3;
            continue;
        }
        if pos == 0 && ch == 0x23 && at(1) == 0x21 {
            while pos < b.len() && at(pos) != 0x0a && at(pos) != 0x0d {
                pos += 1;
            }
            continue;
        }
        return pos as i32;
    }
}
