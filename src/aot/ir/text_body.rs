#[cfg(test)]
mod tests;

use smallvec::SmallVec;

use super::body::Body;
use super::generated::{
    BlockFrequency, BlockHead, BlockRole, Opcode, ParameterHead, TargetHead, TerminatorHead,
    TerminatorKind, ValueHead, parse_terminator_fields, parse_value_fields,
};
use super::ids::{ABSENT_WORD, BlockId, Id, ValueId};
use super::text::{Parsed, Parser};
use super::text_lexer::TokenKind;

type HeadWords = SmallVec<[u32; 8]>;

#[derive(PartialEq, Eq)]
enum Line {
    Value,
    Terminator,
}

#[derive(Default)]
struct BlockAttributes {
    role: Option<BlockRole>,
    subject: Option<ValueId>,
    frequency: Option<BlockFrequency>,
    has_handler: bool,
}

pub(super) fn parse_body(parser: &mut Parser<'_>) -> Parsed<Body> {
    if !parser.accept(TokenKind::LeftBrace) {
        return Ok(Body::default());
    }
    expect_end_of_line(parser)?;
    if parser.at(TokenKind::RightBrace) {
        return parser.fail("a block");
    }
    let mut body = Body::default();
    while !parser.accept(TokenKind::RightBrace) {
        parse_block(parser, &mut body)?;
    }
    Ok(body)
}

fn parse_block(parser: &mut Parser<'_>, body: &mut Body) -> Parsed<()> {
    parse_next_id::<BlockId>(parser, body.block_count, "the next block id")?;
    body.block_count += 1;
    let head_start = reserve_head(&mut body.code, BlockHead::WORDS);
    let parameter_count = parse_parameters(parser, body)?;
    let attributes = parse_block_attributes(parser, &mut body.code)?;
    parser.expect(TokenKind::Colon, ":")?;
    expect_end_of_line(parser)?;
    let mut value_count = 0;
    while parse_line(parser, body)? == Line::Value {
        value_count += 1;
    }
    let head = BlockHead {
        parameter_count,
        value_count,
        role: attributes.role.unwrap_or_default(),
        subject: attributes.subject,
        frequency: attributes.frequency.unwrap_or_default(),
        has_handler: attributes.has_handler,
    };
    write_head(&mut body.code, head_start, |words| head.append_to(words));
    Ok(())
}

fn parse_parameters(parser: &mut Parser<'_>, body: &mut Body) -> Parsed<u32> {
    parser.expect(TokenKind::LeftParenthesis, "(")?;
    let mut parameter_count = 0;
    if !parser.at(TokenKind::RightParenthesis) {
        parameter_count = parse_separated(parser, |parser| parse_parameter(parser, body))?;
    }
    parser.expect(TokenKind::RightParenthesis, ", or )")?;
    Ok(parameter_count)
}

fn parse_parameter(parser: &mut Parser<'_>, body: &mut Body) -> Parsed<()> {
    parse_definition(parser, body)?;
    let ty = if parser.accept(TokenKind::Colon) {
        Some(parser.parse_type()?)
    } else {
        None
    };
    ParameterHead { ty }.append_to(&mut body.code);
    Ok(())
}

fn parse_definition(parser: &mut Parser<'_>, body: &mut Body) -> Parsed<()> {
    parse_next_id::<ValueId>(parser, body.value_count, "the next value id")?;
    body.value_count += 1;
    Ok(())
}

fn parse_next_id<I: Id>(parser: &mut Parser<'_>, next: u32, expected: &'static str) -> Parsed<()> {
    let out_of_order = parser.fail(expected);
    let id = parser.parse_id::<I>(expected)?;
    if id.to_word() == next {
        Ok(())
    } else {
        out_of_order
    }
}

fn parse_block_attributes(
    parser: &mut Parser<'_>,
    words: &mut Vec<u32>,
) -> Parsed<BlockAttributes> {
    let mut attributes = BlockAttributes::default();
    while let Some(name) = parser.next_field_name()? {
        let is_repeated = match name {
            "role" => {
                let role = parser.parse_enum(BlockRole::from_name, "a block role")?;
                attributes.role.replace(role).is_some()
            }
            "subject" => {
                let subject = parser.parse_id::<ValueId>("a value id")?;
                attributes.subject.replace(subject).is_some()
            }
            "frequency" => {
                let frequency =
                    parser.parse_enum(BlockFrequency::from_name, "a block frequency")?;
                attributes.frequency.replace(frequency).is_some()
            }
            "handler" => {
                parse_target(parser, words)?;
                core::mem::replace(&mut attributes.has_handler, true)
            }
            _ => return parser.fail("role, subject, frequency or handler"),
        };
        if is_repeated {
            return parser.fail("each block attribute at most once");
        }
    }
    Ok(attributes)
}

fn parse_line(parser: &mut Parser<'_>, body: &mut Body) -> Parsed<Line> {
    let has_definition = is_at_definition(parser);
    if has_definition {
        parse_definition(parser, body)?;
        parser.expect(TokenKind::Equal, "=")?;
    }
    let name = parser.word_text();
    if let Some(opcode) = name.and_then(Opcode::from_name) {
        match (opcode.has_result(), has_definition) {
            (true, true) => {}
            (false, false) => body.value_count += 1,
            (true, false) => return parser.fail("a value id before an operation with a result"),
            (false, true) => return parser.fail("an operation with a result"),
        }
        parser.advance();
        parse_value(parser, opcode, &mut body.code)?;
        return Ok(Line::Value);
    }
    let Some(kind) = name.and_then(TerminatorKind::from_name) else {
        return parser.fail("an operation or a terminator");
    };
    if has_definition {
        return parser.fail("an operation with a result");
    }
    parser.advance();
    parse_terminator(parser, kind, &mut body.code)?;
    Ok(Line::Terminator)
}

fn is_at_definition(parser: &mut Parser<'_>) -> bool {
    if !parser.at(TokenKind::Word) {
        return false;
    }
    let state = parser.lexer.state();
    let next = parser.lexer.next();
    parser.lexer.restore(state);
    next.kind == TokenKind::Equal
}

fn parse_value(parser: &mut Parser<'_>, opcode: Opcode, words: &mut Vec<u32>) -> Parsed<()> {
    let head_start = reserve_head(words, ValueHead::WORDS);
    parse_value_fields(opcode, parser, words)?;
    let head = ValueHead {
        opcode: opcode.to_wire(),
        position: parse_position(parser)?,
    };
    write_head(words, head_start, |buffer| head.append_to(buffer));
    expect_end_of_line(parser)
}

fn parse_terminator(
    parser: &mut Parser<'_>,
    kind: TerminatorKind,
    words: &mut Vec<u32>,
) -> Parsed<()> {
    let head_start = reserve_head(words, TerminatorHead::WORDS);
    parse_terminator_fields(kind, parser, words)?;
    let mut target_names = SmallVec::<[&str; 4]>::new();
    if parser.accept(TokenKind::Arrow) {
        parse_separated(parser, |parser| {
            target_names.push(parser.parse_word("the name of a target")?);
            parse_target(parser, words)
        })?;
    }
    let target_count = target_names.len();
    let mut names = target_names.iter().enumerate();
    if !names.all(|(index, &name)| kind.target_name(index, target_count) == Some(name)) {
        return parser.fail("the name of the target");
    }
    let head = TerminatorHead {
        kind: kind.to_wire(),
        position: parse_position(parser)?,
        target_count: target_count as u32,
    };
    write_head(words, head_start, |buffer| head.append_to(buffer));
    expect_end_of_line(parser)
}

fn parse_target(parser: &mut Parser<'_>, words: &mut Vec<u32>) -> Parsed<()> {
    let mut head = TargetHead {
        block: parser.parse_id::<BlockId>("a block id")?,
        argument_count: 0,
        proof_count: 0,
    };
    let head_start = reserve_head(words, TargetHead::WORDS);
    parser.expect(TokenKind::LeftParenthesis, "(")?;
    if !parser.at(TokenKind::Bar) && !parser.at(TokenKind::RightParenthesis) {
        head.argument_count = parse_separated(parser, |parser| {
            words.push(parser.parse_id::<ValueId>("a value id")?.to_word());
            Ok(())
        })?;
    }
    if parser.accept(TokenKind::Bar) {
        head.proof_count = parse_separated(parser, |parser| {
            words.push(parser.parse_u32()?);
            Ok(())
        })?;
    }
    parser.expect(TokenKind::RightParenthesis, ")")?;
    write_head(words, head_start, |buffer| head.append_to(buffer));
    Ok(())
}

fn parse_position(parser: &mut Parser<'_>) -> Parsed<Option<u32>> {
    if !parser.accept(TokenKind::At) {
        return Ok(None);
    }
    let out_of_range = parser.fail("a position below 4294967295");
    match parser.parse_u32()? {
        ABSENT_WORD => out_of_range,
        position => Ok(Some(position)),
    }
}

fn parse_separated<'t>(
    parser: &mut Parser<'t>,
    mut parse_item: impl FnMut(&mut Parser<'t>) -> Parsed<()>,
) -> Parsed<u32> {
    let mut count = 0;
    loop {
        parse_item(parser)?;
        count += 1;
        if !parser.accept(TokenKind::Comma) {
            return Ok(count);
        }
    }
}

fn reserve_head(words: &mut Vec<u32>, length: usize) -> usize {
    let start = words.len();
    words.resize(start + length, 0);
    start
}

fn write_head(words: &mut [u32], start: usize, append_head: impl FnOnce(&mut HeadWords)) {
    let mut head = HeadWords::new();
    append_head(&mut head);
    words[start..start + head.len()].copy_from_slice(&head);
}

fn expect_end_of_line(parser: &mut Parser<'_>) -> Parsed<()> {
    parser.expect(TokenKind::EndOfLine, "end of line")
}
