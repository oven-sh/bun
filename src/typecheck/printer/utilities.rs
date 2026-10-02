// printer/utilities.go: literal text, string escaping and line arithmetic of the emit printer.
use crate::ast::{
    Ast, Kind, ModifierListId, NodeId, NodeListId, TokenFlags, is_unterminated_literal,
    node_is_synthesized, position_is_synthesized,
};
use crate::core::TextRange;
use crate::nodebuilder::types::define_flags;
use crate::printer::emitcontext::EmitContext;
use crate::printer::textwriter::RUNE_ERROR;
use crate::scanner::{
    SkipTriviaOptions, compute_line_of_position, get_ecma_line_starts,
    get_source_text_of_node_from_source_file, skip_trivia_ex,
};
use crate::stringutil::decode_js_string_rune;

define_flags!(GetLiteralTextFlags: u32 {
    NONE = 0,
    NEVER_ASCII_ESCAPE = 1 << 0,
    JSX_ATTRIBUTE_ESCAPE = 1 << 1,
    TERMINATE_UNTERMINATED_LITERALS = 1 << 2,
    ALLOW_NUMERIC_SEPARATOR = 1 << 3,
});

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct QuoteChar(pub u32);

impl QuoteChar {
    pub const SINGLE_QUOTE: Self = Self(b'\'' as u32);
    pub const DOUBLE_QUOTE: Self = Self(b'"' as u32);
    pub const BACKTICK: Self = Self(b'`' as u32);
}

// escapedCharsMap
fn escaped_char(ch: u32) -> Option<&'static [u8]> {
    Some(match ch {
        0x09 => b"\\t",
        0x0B => b"\\v",
        0x0C => b"\\f",
        0x08 => b"\\b",
        0x0D => b"\\r",
        0x0A => b"\\n",
        0x5C => b"\\\\",
        0x22 => b"\\\"",
        0x27 => b"\\'",
        0x60 => b"\\`",
        // when quoteChar == '`'
        0x24 => b"\\$",
        // lineSeparator
        0x2028 => b"\\u2028",
        // paragraphSeparator
        0x2029 => b"\\u2029",
        // nextLine
        0x85 => b"\\u0085",
        _ => return None,
    })
}

fn encode_utf16_escape_sequence(b: &mut Vec<u8>, char_code: u32) {
    let hex_char_code = format!("{char_code:X}");
    b.extend_from_slice(b"\\u");
    for _ in hex_char_code.len()..4 {
        b.push(b'0');
    }
    b.extend_from_slice(hex_char_code.as_bytes());
}

// Based heavily on the abstract 'Quote'/'QuoteJSONString' operation from ECMA-262 (24.3.2.2), but augmented for a few select characters (e.g. lineSeparator, paragraphSeparator, nextLine). This doesn't wrap the input in double quotes.
fn escape_string_worker(
    s: &[u8],
    quote_char: QuoteChar,
    flags: GetLiteralTextFlags,
    b: &mut Vec<u8>,
) {
    let mut pos: usize = 0;
    let mut i: usize = 0;
    while i < s.len() {
        let (mut ch, mut size) = decode_js_string_rune(s.get(i..).unwrap_or(&[]));
        if size == 0 {
            break;
        }
        let next = s.get(i + 1).copied();
        let mut escape = false;
        if (0xD800..=0xDFFF).contains(&ch) {
            escape = true;
        } else if ch == RUNE_ERROR && size == 1 {
            // A stray byte that is not valid UTF-8 is escaped as the Unicode replacement character so the output is always well-formed.
            escape = true;
        }

        // This consists of the first 19 unprintable ASCII characters, canonical escapes, lineSeparator, paragraphSeparator, and nextLine: it does not include the 'delete' character, as JSON.stringify does not handle it either.
        if ch == u32::from(b'\\') {
            if !flags.intersects(GetLiteralTextFlags::JSX_ATTRIBUTE_ESCAPE) {
                escape = true;
            }
        } else if ch == u32::from(b'$') {
            if quote_char == QuoteChar::BACKTICK && next == Some(b'{') {
                escape = true;
            }
        } else if ch == quote_char.0 || ch == 0x2028 || ch == 0x2029 || ch == 0x85 || ch == 0x0D {
            escape = true;
        } else if ch == 0x0A {
            if quote_char != QuoteChar::BACKTICK {
                // Template strings preserve simple LF newlines, still encode CRLF (or CR).
                escape = true;
            }
        } else if ch <= 0x1F
            || !flags.intersects(GetLiteralTextFlags::NEVER_ASCII_ESCAPE) && ch > 0x7F
        {
            escape = true;
        }

        if escape {
            if pos < i {
                // Write string up to this point
                b.extend_from_slice(s.get(pos..i).unwrap_or(&[]));
            }

            if flags.intersects(GetLiteralTextFlags::JSX_ATTRIBUTE_ESCAPE) {
                if ch == 0 {
                    b.extend_from_slice(b"&#0;");
                } else if ch == u32::from(b'"') {
                    b.extend_from_slice(b"&quot;");
                } else if ch == u32::from(b'\'') {
                    b.extend_from_slice(b"&apos;");
                } else {
                    encode_jsx_character_entity(b, ch);
                }
            } else if ch == 0x0D && quote_char == QuoteChar::BACKTICK && next == Some(b'\n') {
                // Template strings preserve simple LF newlines, but still must escape CRLF: left alone, the cases for `\r` and `\n` would escape CRLF as two independent characters.
                size += 1;
                b.extend_from_slice(b"\\r\\n");
            } else if ch > 0xFFFF {
                // encode as surrogate pair
                ch -= 0x10000;
                encode_utf16_escape_sequence(b, ((ch & 0b1111_1111_1100_0000_0000) >> 10) + 0xD800);
                encode_utf16_escape_sequence(b, (ch & 0b0000_0000_0011_1111_1111) + 0xDC00);
            } else if (0xD800..=0xDFFF).contains(&ch) {
                encode_utf16_escape_sequence(b, ch);
            } else if ch == 0 {
                if next.is_some_and(|digit| digit.is_ascii_digit()) {
                    // If the null character is followed by digits, print as a hex escape to prevent the result from parsing as an octal (which is forbidden in strict mode)
                    b.extend_from_slice(b"\\x00");
                } else {
                    // Otherwise, keep printing a literal \0 for the null character
                    b.extend_from_slice(b"\\0");
                }
            } else if let Some(escaped) = escaped_char(ch) {
                b.extend_from_slice(escaped);
            } else {
                encode_utf16_escape_sequence(b, ch);
            }
            pos = i + size;
        }

        i += size;
    }
    if pos < i {
        b.extend_from_slice(s.get(pos..).unwrap_or(&[]));
    }
}

fn encode_jsx_character_entity(b: &mut Vec<u8>, char_code: u32) {
    let hex_char_code = format!("{char_code:X}");
    b.extend_from_slice(b"&#x");
    b.extend_from_slice(hex_char_code.as_bytes());
    b.push(b';');
}

pub fn escape_string(s: &[u8], quote_char: QuoteChar) -> Vec<u8> {
    let mut b: Vec<u8> = Vec::with_capacity(s.len() + 2);
    escape_string_worker(
        s,
        quote_char,
        GetLiteralTextFlags::NEVER_ASCII_ESCAPE,
        &mut b,
    );
    b
}

pub(crate) fn escape_non_ascii_string(s: &[u8], quote_char: QuoteChar) -> Vec<u8> {
    let mut b: Vec<u8> = Vec::with_capacity(s.len() + 2);
    escape_string_worker(s, quote_char, GetLiteralTextFlags::NONE, &mut b);
    b
}

pub(crate) fn escape_jsx_attribute_string(s: &[u8], quote_char: QuoteChar) -> Vec<u8> {
    let mut b: Vec<u8> = Vec::with_capacity(s.len() + 2);
    escape_string_worker(
        s,
        quote_char,
        GetLiteralTextFlags::JSX_ATTRIBUTE_ESCAPE | GetLiteralTextFlags::NEVER_ASCII_ESCAPE,
        &mut b,
    );
    b
}

fn can_use_original_text(a: Ast<'_>, node: NodeId, flags: GetLiteralTextFlags) -> bool {
    // A synthetic node has no original text, nor does a node without a parent: the containing SourceFile could not be found. An unterminated literal is not used either when the caller asked for proper termination.
    if node_is_synthesized(a, node)
        || a.parent(node).is_nil()
        || flags.intersects(GetLiteralTextFlags::TERMINATE_UNTERMINATED_LITERALS)
            && is_unterminated_literal(a, node)
    {
        return false;
    }

    if a.kind(node) == Kind::NumericLiteral {
        let token_flags = a.as_numeric_literal(node).token_flags;
        // For a numeric literal, we cannot use the original text if the original text was an invalid literal
        if token_flags.intersects(TokenFlags::IS_INVALID) {
            return false;
        }
        // We also cannot use the original text if the literal contains numeric separators, but numeric separators are not permitted
        if token_flags.intersects(TokenFlags::CONTAINS_SEPARATOR) {
            return flags.intersects(GetLiteralTextFlags::ALLOW_NUMERIC_SEPARATOR);
        }
    }

    // Finally, we do not use the original text of a BigInt literal
    a.kind(node) != Kind::BigIntLiteral
}

pub(crate) fn get_literal_text(
    a: Ast<'_>,
    node: NodeId,
    source_file: NodeId,
    flags: GetLiteralTextFlags,
) -> Vec<u8> {
    // If we don't need to downlevel and we can reach the original source text using the node's parent reference, then simply get the text as it was originally written.
    if !source_file.is_nil() && can_use_original_text(a, node, flags) {
        return get_source_text_of_node_from_source_file(a, source_file, node, false);
    }

    // If we can't reach the original source text, use the canonical form if it's a number, or a (possibly escaped) quoted form of the original text if it's string-like.
    let kind = a.kind(node);
    match kind {
        Kind::StringLiteral => {
            let quote_char = if a
                .as_string_literal(node)
                .token_flags
                .intersects(TokenFlags::SINGLE_QUOTE)
            {
                QuoteChar::SINGLE_QUOTE
            } else {
                QuoteChar::DOUBLE_QUOTE
            };
            let text = a.text(node);
            let mut b: Vec<u8> = Vec::with_capacity(text.len() + 2);
            // Write leading quote character
            b.push(quote_char.0 as u8);
            // Write text
            escape_string_worker(text, quote_char, flags, &mut b);
            // Write trailing quote character
            b.push(quote_char.0 as u8);
            b
        }
        Kind::NoSubstitutionTemplateLiteral
        | Kind::TemplateHead
        | Kind::TemplateMiddle
        | Kind::TemplateTail => {
            // If a NoSubstitutionTemplateLiteral appears to have a substitution in it, the original text had to include a backslash: `not \${a} substitution`.
            let text = a.text(node);
            let raw_text = a
                .template_literal_like_data(node)
                .unwrap_or_default()
                .raw_text;
            let raw = !raw_text.is_empty() || text.is_empty();
            let text_len = if raw { raw_text.len() } else { text.len() };
            let mut b: Vec<u8> = Vec::with_capacity(3 + text_len);
            // Write leading quote character
            match kind {
                Kind::NoSubstitutionTemplateLiteral | Kind::TemplateHead => b.push(b'`'),
                _ => b.push(b'}'),
            }
            // Write text
            if raw {
                // If rawText is set, it is expected to be valid.
                b.extend_from_slice(raw_text);
            } else {
                escape_string_worker(text, QuoteChar::BACKTICK, flags, &mut b);
            }
            // Write trailing quote character
            match kind {
                Kind::NoSubstitutionTemplateLiteral | Kind::TemplateTail => b.push(b'`'),
                _ => b.extend_from_slice(b"${"),
            }
            b
        }
        Kind::NumericLiteral | Kind::BigIntLiteral => a.text(node).to_vec(),
        Kind::RegularExpressionLiteral => {
            let text = a.text(node);
            if flags.intersects(GetLiteralTextFlags::TERMINATE_UNTERMINATED_LITERALS)
                && is_unterminated_literal(a, node)
            {
                let mut b: Vec<u8> = Vec::with_capacity(2 + text.len());
                b.extend_from_slice(text);
                if text.last() == Some(&b'\\') {
                    b.extend_from_slice(b" /");
                } else {
                    b.extend_from_slice(b"/");
                }
                return b;
            }
            text.to_vec()
        }
        _ => a.unhandled("Unsupported LiteralLikeNode", node),
    }
}

pub fn range_is_on_single_line(a: Ast<'_>, r: TextRange, source_file: NodeId) -> bool {
    range_start_is_on_same_line_as_range_end(a, r, r, source_file)
}

pub fn range_start_positions_are_on_same_line(
    a: Ast<'_>,
    range1: TextRange,
    range2: TextRange,
    source_file: NodeId,
) -> bool {
    positions_are_on_same_line(
        a,
        get_start_position_of_range(a, range1, source_file, false),
        get_start_position_of_range(a, range2, source_file, false),
        source_file,
    )
}

pub(crate) fn range_end_positions_are_on_same_line(
    a: Ast<'_>,
    range1: TextRange,
    range2: TextRange,
    source_file: NodeId,
) -> bool {
    positions_are_on_same_line(a, range1.end(), range2.end(), source_file)
}

pub(crate) fn range_start_is_on_same_line_as_range_end(
    a: Ast<'_>,
    range1: TextRange,
    range2: TextRange,
    source_file: NodeId,
) -> bool {
    positions_are_on_same_line(
        a,
        get_start_position_of_range(a, range1, source_file, false),
        range2.end(),
        source_file,
    )
}

pub(crate) fn range_end_is_on_same_line_as_range_start(
    a: Ast<'_>,
    range1: TextRange,
    range2: TextRange,
    source_file: NodeId,
) -> bool {
    positions_are_on_same_line(
        a,
        range1.end(),
        get_start_position_of_range(a, range2, source_file, false),
        source_file,
    )
}

pub(crate) fn get_start_position_of_range(
    a: Ast<'_>,
    r: TextRange,
    source_file: NodeId,
    include_comments: bool,
) -> i32 {
    if position_is_synthesized(r.pos()) {
        return -1;
    }
    skip_trivia_ex(
        a.as_source_file(source_file).text(),
        r.pos(),
        Some(&SkipTriviaOptions {
            stop_at_comments: include_comments,
            ..SkipTriviaOptions::default()
        }),
    )
}

pub fn positions_are_on_same_line(a: Ast<'_>, pos1: i32, pos2: i32, source_file: NodeId) -> bool {
    get_lines_between_positions(a, source_file, pos1, pos2) == 0
}

pub fn get_lines_between_positions(a: Ast<'_>, source_file: NodeId, pos1: i32, pos2: i32) -> isize {
    if pos1 == pos2 {
        return 0;
    }
    let file = a.as_source_file(source_file);
    let line_starts = get_ecma_line_starts(&file);
    let lower = if pos1 < pos2 { pos1 } else { pos2 };
    let is_negative = lower == pos2;
    let upper = if is_negative { pos1 } else { pos2 };
    let lower_line = compute_line_of_position(line_starts, lower);
    let rest = usize::try_from(lower_line)
        .ok()
        .and_then(|line| line_starts.get(line..))
        .unwrap_or(&[]);
    let upper_line = lower_line + compute_line_of_position(rest, upper);
    if is_negative {
        lower_line - upper_line
    } else {
        upper_line - lower_line
    }
}

pub(crate) fn original_nodes_have_same_parent(
    a: Ast<'_>,
    emit_context: &EmitContext,
    node_a: NodeId,
    node_b: NodeId,
) -> bool {
    let node_a = emit_context.most_original(node_a);
    if !a.parent(node_a).is_nil() {
        // For performance, do not call `MostOriginal` for `nodeB` if `nodeA` doesn't even have a parent node.
        let node_b = emit_context.most_original(node_b);
        return a.parent(node_a) == a.parent(node_b);
    }
    false
}

// The values that upstream passes as `interface{ End() int }`.
#[derive(Clone, Copy)]
pub(crate) enum EndOf {
    Node(NodeId),
    NodeList(NodeListId),
    ModifierList(ModifierListId),
    Range(TextRange),
}

pub(crate) fn try_get_end(a: Ast<'_>, node: EndOf) -> Option<i32> {
    match node {
        EndOf::Node(v) => {
            if !v.is_nil() {
                return Some(a.end(v));
            }
        }
        EndOf::NodeList(v) => {
            if !v.is_nil() {
                return Some(a.list_loc(v).end());
            }
        }
        EndOf::ModifierList(v) => {
            if !v.is_nil() {
                return Some(a.modifier_list_loc(v).end());
            }
        }
        EndOf::Range(v) => return Some(v.end()),
    }
    None
}

pub(crate) fn greatest_end(a: Ast<'_>, end: i32, nodes: &[EndOf]) -> i32 {
    let mut end = end;
    for node in nodes.iter().rev() {
        if let Some(node_end) = try_get_end(a, *node) {
            if end < node_end {
                end = node_end;
            }
        }
    }
    end
}

pub(crate) fn skip_synthesized_parentheses(a: Ast<'_>, node: NodeId) -> NodeId {
    let mut node = node;
    while a.kind(node) == Kind::ParenthesizedExpression && node_is_synthesized(a, node) {
        node = a.expression(node);
    }
    node
}
