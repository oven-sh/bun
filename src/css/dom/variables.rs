//! Where the `var()` functions of a value are. C++ puts the values in.

use bun_alloc::Arena;

use super::{StringRange, VariableReference};
use crate::css_parser::{BasicParseErrorKind, CssResult, Parser, ParserInput, Token};

/// The outermost ones, in order. None if one of them is malformed.
pub(crate) fn find_variable_references(value: &[u8]) -> Option<Vec<VariableReference>> {
    let arena = Arena::new();
    let mut input = ParserInput::new(value, &arena);
    let mut parser = Parser::new(&mut input, None, Default::default(), None);
    let mut references = Vec::new();
    find_in_block(&mut parser, value, &mut references).ok()?;
    Some(references)
}

fn range(start: usize, end: usize) -> StringRange {
    StringRange {
        offset: u32::try_from(start).expect("int cast"),
        length: u32::try_from(end - start).expect("int cast"),
    }
}

/// Without the white space around it.
fn trimmed_range(value: &[u8], start: usize, end: usize) -> StringRange {
    let text = &value[start..end];
    let leading = text.len() - text.trim_ascii_start().len();
    let length = text.trim_ascii().len();
    range(start + leading, start + leading + length)
}

fn find_in_block(
    input: &mut Parser,
    value: &[u8],
    references: &mut Vec<VariableReference>,
) -> CssResult<()> {
    loop {
        input.skip_whitespace();
        let start = input.position();
        let token = match input.next() {
            Ok(token) => *token,
            Err(_) => return Ok(()),
        };
        match token {
            Token::Function(name) if name.eq_ignore_ascii_case(b"var") => {
                let mut reference = VariableReference::default();
                input.parse_nested_block(|input| {
                    input.skip_whitespace();
                    let name_start = input.position();
                    if !input.expect_ident()?.starts_with(b"--") {
                        return Err(input.new_error(BasicParseErrorKind::qualified_rule_invalid));
                    }
                    reference.name = range(name_start, input.position());
                    if input.try_parse(|input| input.expect_comma()).is_ok() {
                        let fallback_start = input.position();
                        while input.next().is_ok() {}
                        reference.has_fallback = true;
                        reference.fallback = trimmed_range(value, fallback_start, input.position());
                    }
                    Ok(())
                })?;
                reference.whole = range(start, input.position());
                references.push(reference);
            }
            Token::Function(_) | Token::OpenParen | Token::OpenSquare | Token::OpenCurly => {
                input.parse_nested_block(|input| find_in_block(input, value, references))?;
            }
            _ => {}
        }
    }
}
