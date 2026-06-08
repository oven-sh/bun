//! Shared decimal number-literal digit scanner.
//!
//! The json and toml lexers each carried an identical ~80-line scan of a
//! decimal literal's digits — underscore-separator rules, optional fraction,
//! optional exponent, and the invalid-legacy-octal underscore check (see the
//! matching regions in `js_parser/lexer.zig` and `parsers/toml/lexer.zig`).
//! This generic helper collapses both; it monomorphizes per lexer type, so
//! codegen matches the previous inline copies.

use bun_ast::LexerLog;
use bun_core::strings::CodePoint;

/// Cursor surface `scan_decimal_digits` needs from a lexer.
pub(crate) trait DecimalLexer<'s>: LexerLog<'s> {
    fn code_point(&self) -> CodePoint;
    fn end(&self) -> usize;
    fn end_mut(&mut self) -> &mut usize;
    fn step(&mut self);
}

pub(crate) struct DecimalScan {
    pub underscore_count: usize,
    pub last_underscore_end: usize,
    pub has_dot_or_exponent: bool,
}

/// Scans the digits of a decimal (non-radix-prefixed) number literal:
/// initial digits, then an optional fraction and exponent. The caller has
/// already consumed `first` (the literal's first code point); on return the
/// cursor sits on the first code point past the literal and the caller
/// parses `lexer.raw()` into a value.
#[inline]
pub(crate) fn scan_decimal_digits<'s, L: DecimalLexer<'s>>(
    lexer: &mut L,
    first: CodePoint,
) -> Result<DecimalScan, L::Err> {
    let mut underscore_count: usize = 0;
    let mut last_underscore_end: usize = 0;
    let mut has_dot_or_exponent = first == '.' as CodePoint;

    let is_invalid_legacy_octal_literal = first == '0' as CodePoint
        && (lexer.code_point() == '8' as CodePoint || lexer.code_point() == '9' as CodePoint);

    // Initial digits;
    loop {
        if lexer.code_point() < '0' as CodePoint || lexer.code_point() > '9' as CodePoint {
            if lexer.code_point() != '_' as CodePoint {
                break;
            }
            // Cannot have multiple underscores in a row;
            if last_underscore_end > 0 && lexer.end() == last_underscore_end + 1 {
                lexer.syntax_error()?;
            }
            // The specification forbids underscores in this case;
            if is_invalid_legacy_octal_literal {
                lexer.syntax_error()?;
            }
            last_underscore_end = lexer.end();
            underscore_count += 1;
        }
        lexer.step();
    }

    // Fractional digits;
    if first != '.' as CodePoint && lexer.code_point() == '.' as CodePoint {
        // An underscore must not come last;
        if last_underscore_end > 0 && lexer.end() == last_underscore_end + 1 {
            *lexer.end_mut() -= 1;
            lexer.syntax_error()?;
        }
        has_dot_or_exponent = true;
        lexer.step();
        if lexer.code_point() == '_' as CodePoint {
            lexer.syntax_error()?;
        }
        loop {
            if lexer.code_point() < '0' as CodePoint || lexer.code_point() > '9' as CodePoint {
                if lexer.code_point() != '_' as CodePoint {
                    break;
                }
                // Cannot have multiple underscores in a row;
                if last_underscore_end > 0 && lexer.end() == last_underscore_end + 1 {
                    lexer.syntax_error()?;
                }
                last_underscore_end = lexer.end();
                underscore_count += 1;
            }
            lexer.step();
        }
    }

    // Exponent;
    if lexer.code_point() == 'e' as CodePoint || lexer.code_point() == 'E' as CodePoint {
        // An underscore must not come last;
        if last_underscore_end > 0 && lexer.end() == last_underscore_end + 1 {
            *lexer.end_mut() -= 1;
            lexer.syntax_error()?;
        }
        has_dot_or_exponent = true;
        lexer.step();
        if lexer.code_point() == '+' as CodePoint || lexer.code_point() == '-' as CodePoint {
            lexer.step();
        }
        if lexer.code_point() < '0' as CodePoint || lexer.code_point() > '9' as CodePoint {
            lexer.syntax_error()?;
        }
        loop {
            if lexer.code_point() < '0' as CodePoint || lexer.code_point() > '9' as CodePoint {
                if lexer.code_point() != '_' as CodePoint {
                    break;
                }
                // Cannot have multiple underscores in a row;
                if last_underscore_end > 0 && lexer.end() == last_underscore_end + 1 {
                    lexer.syntax_error()?;
                }
                last_underscore_end = lexer.end();
                underscore_count += 1;
            }
            lexer.step();
        }
    }

    Ok(DecimalScan {
        underscore_count,
        last_underscore_end,
        has_dot_or_exponent,
    })
}
