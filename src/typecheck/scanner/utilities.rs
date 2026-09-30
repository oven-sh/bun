// internal/scanner/utilities.go: the source text of a node, the text of a declaration name, identifier texts.
use crate::ast::{self, Ast, Kind, NodeFlags, NodeId, NodeListId, TokenFlags};
use crate::core::{LanguageVariant, compute_ecma_line_starts};
use crate::scanner::scanner::{
    is_identifier_part_ex, is_identifier_start, skip_trivia, text_to_keyword,
};
use crate::stringutil;
use crate::stringutil::util::utf8;
use bun_core::strings;

pub(crate) fn token_is_identifier_or_keyword(token: Kind) -> bool {
    token >= Kind::Identifier
}

pub fn identifier_to_keyword_kind(a: Ast<'_>, node: NodeId) -> Kind {
    text_to_keyword(a.as_identifier(node).text)
}

pub fn get_source_text_of_node_from_source_file(
    a: Ast<'_>,
    source_file: NodeId,
    node: NodeId,
    include_trivia: bool,
) -> Vec<u8> {
    get_text_of_node_from_source_text(
        a,
        a.as_source_file(source_file).text(),
        node,
        include_trivia,
    )
}

fn is_jsdoc_type_expression_or_child(a: Ast<'_>, node: NodeId) -> bool {
    if ast::is_jsdoc_type_expression(a, node) {
        return true;
    }
    if !a
        .flags(node)
        .intersects(NodeFlags::JSDOC | NodeFlags::REPARSED)
    {
        return false;
    }
    let mut current = node;
    while !current.is_nil() {
        if ast::is_type_node(a, current) {
            return true;
        }
        current = a.parent(current);
    }
    false
}

// strings.TrimLeftFunc
fn trim_left_func(s: &[u8], f: impl Fn(u32) -> bool) -> &[u8] {
    let mut s = s;
    while !s.is_empty() {
        let (ch, size) = utf8::decode_rune_in_string(s);
        if !f(ch) {
            break;
        }
        s = s.get(size.max(1)..).unwrap_or(&[]);
    }
    s
}

// strings.TrimRightFunc
fn trim_right_func(s: &[u8], f: impl Fn(u32) -> bool) -> &[u8] {
    let mut s = s;
    while !s.is_empty() {
        let (ch, size) = utf8::decode_last_rune_in_string(s);
        if !f(ch) {
            break;
        }
        s = s.get(..s.len() - size.clamp(1, s.len())).unwrap_or(&[]);
    }
    s
}

// unicode.IsSpace
fn unicode_is_space(ch: u32) -> bool {
    matches!(
        ch,
        0x09..=0x0D
            | 0x20
            | 0x85
            | 0xA0
            | 0x1680
            | 0x2000..=0x200A
            | 0x2028
            | 0x2029
            | 0x202F
            | 0x205F
            | 0x3000
    )
}

fn normalize_jsdoc_type_source_text(text: &[u8]) -> Vec<u8> {
    let line_starts = compute_ecma_line_starts(text);
    if line_starts.len() == 1 {
        return strip_leading_jsdoc_comment(text).to_vec();
    }

    let mut result = Vec::with_capacity(text.len());
    // core.NewLineKindLF.GetNewLineCharacter()
    let new_line: &[u8] = b"\n";
    for (i, line_start) in line_starts.iter().enumerate() {
        if i > 0 {
            result.extend_from_slice(new_line);
        }
        let line_end = match line_starts.get(i + 1) {
            Some(next) => usize::try_from(next.0).unwrap_or(text.len()),
            None => text.len(),
        };
        let line_start = usize::try_from(line_start.0).unwrap_or(0);
        let line = trim_right_func(
            text.get(line_start..line_end).unwrap_or(&[]),
            stringutil::is_line_break,
        );
        result.extend_from_slice(strip_leading_jsdoc_comment(line));
    }
    result
}

fn strip_leading_jsdoc_comment(line: &[u8]) -> &[u8] {
    let mut line = trim_left_func(line, stringutil::is_white_space_like);
    if let Some((&b'*', rest)) = line.split_first() {
        line = rest;
    }
    trim_left_func(line, stringutil::is_white_space_like)
}

pub fn get_text_of_node_from_source_text(
    a: Ast<'_>,
    source_text: &[u8],
    node: NodeId,
    include_trivia: bool,
) -> Vec<u8> {
    if ast::node_is_missing(a, node) {
        return Vec::new();
    }
    let mut pos = a.pos(node);
    if !include_trivia {
        pos = skip_trivia(source_text, pos);
    }
    let end = usize::try_from(a.end(node))
        .unwrap_or(0)
        .min(source_text.len());
    let start = usize::try_from(pos).unwrap_or(0).min(end);
    let mut text = source_text.get(start..end).unwrap_or(&[]).to_vec();
    if is_jsdoc_type_expression_or_child(a, node) {
        text = normalize_jsdoc_type_source_text(&text);
    }
    if a.flags(node)
        .intersects(NodeFlags::REPARSER_TRANSFORMED_LITERAL)
    {
        // This is similar to `getLiteralTextOfNode` in the printer, but without the context of an `emitContext` to provide overrides
        if ast::is_string_literal(a, node) {
            let quote = if a
                .as_string_literal(node)
                .token_flags
                .intersects(TokenFlags::SINGLE_QUOTE)
            {
                b'\''
            } else {
                b'"'
            };
            let mut quoted = Vec::with_capacity(text.len() + 2);
            quoted.push(quote);
            quoted.extend_from_slice(&text);
            quoted.push(quote);
            return quoted;
        } else if ast::is_identifier(a, node) {
            return a.text(node).to_vec();
        }
        // Only the above node kinds are currently transformed into one another by the reparser, requiring the textual remapping: upstream fails on any other kind.
        a.unhandled::<()>("Unexpected reparser-transformed node kind", node);
    }
    text
}

pub fn get_text_of_node(a: Ast<'_>, node: NodeId) -> Vec<u8> {
    get_source_text_of_node_from_source_file(a, ast::get_source_file_of_node(a, node), node, false)
}

pub fn get_text_of_jsdoc_comment(a: Ast<'_>, comment: NodeListId) -> Vec<u8> {
    if comment.is_nil() {
        return Vec::new();
    }
    let mut b = Vec::new();
    for &n in a.nodes(comment).as_slice() {
        match a.kind(n) {
            Kind::JSDocText => b.extend_from_slice(a.text(n)),
            Kind::JSDocLink | Kind::JSDocLinkCode | Kind::JSDocLinkPlain => {
                b.extend_from_slice(&get_text_of_node(a, n));
            }
            _ => {}
        }
    }
    let trimmed_len = trim_right_func(&b, unicode_is_space).len();
    b.truncate(trimmed_len);
    b
}

pub fn declaration_name_to_string(a: Ast<'_>, name: NodeId) -> Vec<u8> {
    if name.is_nil() || a.pos(name) == a.end(name) {
        return b"(Missing)".to_vec();
    }
    get_text_of_node(a, name)
}

pub fn is_identifier_text(name: &[u8], language_variant: LanguageVariant) -> bool {
    let (ch, size) = utf8::decode_rune_in_string(name);
    if !is_identifier_start(ch) {
        return false;
    }
    let mut i = size;
    while i < name.len() {
        let (ch, size) = utf8::decode_rune_in_string(name.get(i..).unwrap_or(&[]));
        if !is_identifier_part_ex(ch, language_variant) {
            return false;
        }
        i += size.max(1);
    }
    true
}

pub fn is_intrinsic_jsx_name(name: &[u8]) -> bool {
    match name.first() {
        Some(first) => first.is_ascii_lowercase() || strings::contains_char(name, b'-'),
        None => false,
    }
}
