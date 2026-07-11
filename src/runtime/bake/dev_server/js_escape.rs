//! Decodes JavaScript string escape sequences from UTF-8 text into UTF-8
//! bytes for the error-report endpoint. Ported from the old TOML lexer's
//! `decode_escape_sequences` (single-line mode), preserving its lenient
//! semantics exactly.

use bun_alloc::ArenaVec;
use bun_core::fmt::hex_digit_value_u32;
use bun_core::strings::{self, CodePoint};

pub(crate) fn decode_js_escape_sequences<'a>(
    text: &[u8],
    buf: &mut ArenaVec<'a, u8>,
) -> Result<(), crate::Error> {
    let syntax_error = || crate::Error::SyntaxError;
    let iterator = strings::CodepointIterator::init(text);
    let mut iter = strings::Cursor::default();
    while iterator.next(&mut iter) {
        match iter.c {
            c if c == '\r' as CodePoint => {
                // Convert CRLF and CR into LF.
                let next_i: usize = iter.i as usize + 1;
                if next_i < text.len() && text[next_i] == b'\n' {
                    iter.i += 1;
                }
                buf.push(b'\n');
                continue;
            }

            c if c == '\\' as CodePoint => {
                if !iterator.next(&mut iter) {
                    return Ok(());
                }

                let c2 = iter.c;
                match c2 {
                    c if c == 'b' as CodePoint => {
                        buf.push(8);
                        continue;
                    }
                    c if c == 'f' as CodePoint => {
                        buf.push(12);
                        continue;
                    }
                    c if c == 'n' as CodePoint => {
                        buf.push(10);
                        continue;
                    }
                    c if c == 'v' as CodePoint => {
                        buf.push(11);
                        continue;
                    }
                    c if c == 't' as CodePoint => {
                        buf.push(9);
                        continue;
                    }
                    c if c == 'r' as CodePoint => {
                        buf.push(13);
                        continue;
                    }

                    // Legacy octal literals.
                    c if ('0' as CodePoint..='7' as CodePoint).contains(&c) => {
                        let mut value: i64 = (c2 - '0' as CodePoint) as i64;
                        let mut restore = iter;

                        if !iterator.next(&mut iter) {
                            if value == 0 {
                                buf.push(0);
                                return Ok(());
                            }
                            return Err(syntax_error());
                        }

                        let c3: CodePoint = iter.c;
                        match c3 {
                            c if ('0' as CodePoint..='7' as CodePoint).contains(&c) => {
                                value = value * 8 + (c3 - '0' as CodePoint) as i64;
                                restore = iter;
                                if !iterator.next(&mut iter) {
                                    return Err(syntax_error());
                                }

                                let c4 = iter.c;
                                match c4 {
                                    c if ('0' as CodePoint..='7' as CodePoint).contains(&c) => {
                                        let temp = value * 8 + (c4 - '0' as CodePoint) as i64;
                                        if temp < 256 {
                                            value = temp;
                                        } else {
                                            iter = restore;
                                        }
                                    }
                                    // An 8 or 9 after octal digits is consumed
                                    // without contributing (original behavior).
                                    c if c == '8' as CodePoint || c == '9' as CodePoint => {}
                                    _ => {
                                        iter = restore;
                                    }
                                }
                            }
                            c if c == '8' as CodePoint || c == '9' as CodePoint => {}
                            _ => {
                                iter = restore;
                            }
                        }

                        iter.c = i32::try_from(value).expect("octal value is at most 255");
                    }
                    c if c == '8' as CodePoint || c == '9' as CodePoint => {
                        iter.c = c2;
                    }
                    // 2-digit hexadecimal.
                    c if c == 'x' as CodePoint => {
                        let mut value: CodePoint = 0;
                        for _ in 0..2 {
                            if !iterator.next(&mut iter) {
                                return Err(syntax_error());
                            }
                            match hex_digit_value_u32(iter.c as u32) {
                                Some(d) => value = (value * 16) | d as CodePoint,
                                None => return Err(syntax_error()),
                            }
                        }
                        iter.c = value;
                    }
                    c if c == 'u' as CodePoint => {
                        let mut value: i64 = 0;

                        if !iterator.next(&mut iter) {
                            return Err(syntax_error());
                        }
                        let mut c3 = iter.c;

                        if c3 == '{' as CodePoint {
                            // Variable-length `\u{...}`: validate every digit
                            // up to '}' even when out of range (original
                            // behavior); the clamp prevents i64 overflow.
                            let mut is_first = true;
                            let mut out_of_range = false;
                            loop {
                                if !iterator.next(&mut iter) {
                                    // Ran out of input before the closing `}`.
                                    return Err(syntax_error());
                                }
                                c3 = iter.c;
                                if c3 == '}' as CodePoint {
                                    if is_first {
                                        return Err(syntax_error());
                                    }
                                    break;
                                }
                                match hex_digit_value_u32(c3 as u32) {
                                    Some(d) => {
                                        if value <= 0x10FFFF {
                                            value = (value * 16) | d as i64;
                                        }
                                        if value > 0x10FFFF {
                                            out_of_range = true;
                                        }
                                    }
                                    None => return Err(syntax_error()),
                                }
                                is_first = false;
                            }
                            if out_of_range {
                                // Out of range: stop decoding, keeping what was
                                // decoded so far (original behavior).
                                return Ok(());
                            }
                        } else {
                            // Fixed-length `\uHHHH`.
                            let mut j: usize = 0;
                            while j < 4 {
                                match hex_digit_value_u32(c3 as u32) {
                                    Some(d) => value = (value * 16) | d as i64,
                                    None => return Err(syntax_error()),
                                }
                                if j < 3 {
                                    if !iterator.next(&mut iter) {
                                        return Err(syntax_error());
                                    }
                                    c3 = iter.c;
                                }
                                j += 1;
                            }
                        }

                        iter.c = value as CodePoint;
                    }
                    // Line continuations are not valid in this single-line mode.
                    c if c == '\r' as CodePoint
                        || c == '\n' as CodePoint
                        || c == 0x2028
                        || c == 0x2029 =>
                    {
                        return Err(syntax_error());
                    }
                    _ => {
                        iter.c = c2;
                    }
                }
            }
            _ => {}
        }

        match iter.c {
            -1 => return Err(syntax_error()),
            0..=127 => {
                buf.push(u8::try_from(iter.c).expect("checked range"));
            }
            _ => {
                let mut part: [u8; 4] = [0; 4];
                let len = strings::encode_wtf8_rune(&mut part, iter.c as u32);
                buf.extend_from_slice(&part[0..len]);
            }
        }
    }
    Ok(())
}
