//! `rangeStart` and `rangeEnd`: only the statements that a range of the text touches are formatted.
//!
//! This is Prettier's `formatRange` (`src/main/core.js`) and `calculateRange`
//! (`src/main/range.js`). The range is widened to whole statements, their text is parsed and
//! formatted as a file of its own, indented like the line that it starts on, and put back.

use crate::cursor::format_with;
use crate::ir::element::{Align, FormatElement, Tag};
use crate::ir::prelude::{Format, Formatter, hard_line_break};
use crate::js::ast_nodes::{AstNodes, ExpressionStatement, Program, node_as_ast_nodes, type_parameters_of};
use crate::js::comments::{self, Comment, Comments};
use crate::js::print::program::ends_before_semicolon;
use crate::js::source_text::SourceText;
use crate::options::{Flavor, LineEnding};
use crate::{FormatError, FormatOptions, Scratch};
use bun_lint::ast::{File, FnBody, FnKind, Node, Stmt, StmtKind};
use bun_lint::span::Span;
use smallvec::SmallVec;

const BOM: &[u8] = b"\xEF\xBB\xBF";

/// Appends to `out` the text of `file` with what `options.range_start` and `options.range_end`
/// select formatted. That is all of it if neither is set.
///
/// `parse` is called at most once, with a part of the text. It has to parse that like `file` has
/// been parsed, as a file with the same name, and call its second argument with the result.
pub fn format<'a>(
    file: &'a File<'a>,
    options: &FormatOptions,
    scratch: &mut Scratch,
    out: &mut Vec<u8>,
    parse: impl FnOnce(&[u8], &mut dyn for<'b> FnMut(&'b File<'b>)),
) -> Result<(), FormatError> {
    format_with_cursor(file, options, scratch, out, parse).map(|_| ())
}

/// The same. Returns where the cursor, which is at `options.cursor_offset` in the text of `file`,
/// is in what is appended, in UTF-16 code units like the option. `None` if there is none.
pub fn format_with_cursor<'a>(
    file: &'a File<'a>,
    options: &FormatOptions,
    scratch: &mut Scratch,
    out: &mut Vec<u8>,
    parse: impl FnOnce(&[u8], &mut dyn for<'b> FnMut(&'b File<'b>)),
) -> Result<Option<u32>, FormatError> {
    let text = file.text();
    let is_import_or_export = |statement: Stmt<'a>| {
        statement.is_exported() || matches!(statement.kind(), StmtKind::Import(_) | StmtKind::ExportNamed(_) | StmtKind::ExportDefault(_))
    };
    if options.is_mdx_es_syntax && !file.body().iter().all(is_import_or_export) {
        return Err(FormatError::SyntaxError);
    }
    let first = if text.starts_with(BOM) { BOM.len() } else { 0 };
    let Offsets { start, end, cursor } = Offsets::new(text, first, options);
    if start >= end && text.len() > first {
        out.extend_from_slice(text);
        return Ok(options.cursor_offset);
    }
    if start <= first && end >= text.len() {
        return crate::cursor::format_with_cursor(file, options, scratch, out);
    }
    if file.has_parse_errors() {
        return Err(FormatError::SyntaxError);
    }

    let range = calculate_range(file, options.flavor, start as u32, end as u32).unwrap_or_else(|| Span::empty(first as u32));
    let (start, end) = (range.start as usize, range.end as usize);
    let (Some(before), Some(slice), Some(after)) = (text.get(..start), text.get(start..end), text.get(end..)) else {
        return Err(FormatError::InvalidDocument);
    };

    let mut formatted = Vec::new();
    // Where the cursor is in `formatted`, if it is in the range.
    let mut cursor_in_formatted = None;
    if !trim_start(slice).is_empty() {
        let alignment = alignment_size(before.get(first..).unwrap_or_default(), options.indent_width.value());
        let cursor_in_slice = cursor.filter(|&cursor| start < cursor && cursor <= end).map(|cursor| cursor - start);
        let slice_options = FormatOptions {
            range_start: None,
            range_end: None,
            cursor_offset: cursor_in_slice.map(|cursor| utf16_len(slice.get(..cursor).unwrap_or(slice)) as u32),
            line_ending: LineEnding::Lf,
            ..options.clone()
        };
        let mut result = Err(FormatError::SyntaxError);
        parse(slice, &mut |slice_file| {
            result = format_with(slice_file, &slice_options, scratch, &mut formatted, alignment > 0, |file, f| {
                write_aligned(file, alignment, f);
            });
        });
        cursor_in_formatted = result?.and_then(|cursor| offset_of_utf16_index(&formatted, cursor));
        formatted.truncate(trim_end(&formatted).len());
    }

    // Everything is put together with `\n`, which is replaced at the end.
    let mut whole = Vec::with_capacity(text.len() + formatted.len());
    let mut cursor_in_whole = None;
    write_with_line_ending(before, b"\n", &mut whole);
    if let Some(cursor) = cursor.filter(|&cursor| cursor <= start) {
        cursor_in_whole = Some(whole.len() - normalized_len(before.get(cursor..).unwrap_or_default()));
    }
    if let Some(cursor) = cursor_in_formatted {
        cursor_in_whole = Some(whole.len() + cursor);
    }
    whole.extend_from_slice(&formatted);
    if let Some(cursor) = cursor.filter(|&cursor| cursor > end) {
        cursor_in_whole = Some(whole.len() + normalized_len(text.get(end..cursor).unwrap_or_default()));
    }
    write_with_line_ending(after, b"\n", &mut whole);

    let line_ending = options.line_ending.resolve(&text[first..]).as_bytes();
    let out_start = out.len();
    let cursor_in_whole = cursor_in_whole.map(|cursor| cursor.min(whole.len()));
    let (up_to_cursor, rest) = whole.split_at(cursor_in_whole.unwrap_or(0));
    write_with_line_ending(up_to_cursor, line_ending, out);
    let cursor_in_out = cursor_in_whole.map(|_| utf16_len(&out[out_start..]) as u32);
    write_with_line_ending(rest, line_ending, out);
    Ok(cursor_in_out)
}

/// How long `text` is after each `\r\n` in it has become `\n`.
pub(crate) fn normalized_len(text: &[u8]) -> usize {
    text.len() - bun_core::strings::count(text, b"\r\n")
}

/// How many UTF-16 code units `text` is.
fn utf16_len(text: &[u8]) -> usize {
    text.iter().map(|&byte| usize::from(byte & 0xC0 != 0x80) + usize::from(byte >= 0xF0)).sum()
}

/// `rangeStart`, `rangeEnd` and `cursorOffset`, which count UTF-16 code units, as offsets in the text.
pub(crate) struct Offsets {
    pub(crate) start: usize,
    pub(crate) end: usize,
    pub(crate) cursor: Option<usize>,
}

impl Offsets {
    /// Prettier's `normalizeInputAndOptions`. `first`: where `text` starts after its byte order mark.
    pub(crate) fn new(text: &[u8], first: usize, options: &FormatOptions) -> Offsets {
        // After `\r\n` has become `\n`, an offset between the two is behind it.
        let after_line_break = |at: usize| match text.get(at.wrapping_sub(1)..=at) {
            Some(b"\r\n") => at + 1,
            _ => at,
        };
        // An offset before the byte order mark or behind the end is as good as none.
        let offset_of = |index: Option<u32>| {
            offset_of_utf16_index(text, index?).map(after_line_break).filter(|&offset| offset >= first)
        };
        Offsets {
            start: offset_of(options.range_start).unwrap_or(first),
            end: offset_of(options.range_end).unwrap_or(text.len()),
            cursor: offset_of(options.cursor_offset),
        }
    }
}

/// `None` if `text` is shorter.
fn offset_of_utf16_index(text: &[u8], index: u32) -> Option<usize> {
    let index = index as usize;
    // Up to the first character that is not ASCII, bytes are code units.
    let ascii = bun_core::strings::first_non_ascii(text).map_or(text.len(), |at| at as usize);
    if index <= ascii {
        return Some(index);
    }
    let mut units = ascii;
    for (offset, &byte) in text.iter().enumerate().skip(ascii) {
        if units >= index {
            return Some(offset);
        }
        units += match byte {
            // Not the first byte of a character.
            0x80..=0xBF => 0,
            0xF0..=0xFF => 2,
            _ => 1,
        };
    }
    (units >= index).then_some(text.len())
}

/// `\s` of a regular expression at the start of `text`: its length.
pub(crate) fn white_space_len(text: &[u8]) -> usize {
    match *text {
        [b'\t' | b'\n' | 0x0B | 0x0C | b'\r' | b' ', ..] => 1,
        [0xC2, 0xA0, ..] => 2,
        [0xE1, 0x9A, 0x80, ..]
        | [0xE2, 0x80, 0x80..=0x8A | 0xA8 | 0xA9 | 0xAF, ..]
        | [0xE2, 0x81, 0x9F, ..]
        | [0xE3, 0x80, 0x80, ..]
        | [0xEF, 0xBB, 0xBF, ..] => 3,
        _ => 0,
    }
}

pub(crate) fn trim_start(mut text: &[u8]) -> &[u8] {
    loop {
        match white_space_len(text) {
            0 => return text,
            len => text = &text[len..],
        }
    }
}

pub(crate) fn trim_end(mut text: &[u8]) -> &[u8] {
    'text: loop {
        for len in 1..=3.min(text.len()) {
            let at = text.len() - len;
            if white_space_len(&text[at..]) == len {
                text = &text[..at];
                continue 'text;
            }
        }
        return text;
    }
}

/// Prettier's `getAlignmentSize` of the white space that the last line of `before` starts with.
pub(crate) fn alignment_size(before: &[u8], tab_width: u8) -> usize {
    let last = |line_break| bun_core::strings::last_index_of_char(before, line_break).map_or(0, |at| at + 1);
    let line_start = last(b'\n').max(last(b'\r'));
    let (mut rest, mut size, tab_width) = (&before[line_start..], 0, usize::from(tab_width.max(1)));
    loop {
        match white_space_len(rest) {
            0 => return size,
            len => {
                size = if rest[0] == b'\t' { size + tab_width - size % tab_width } else { size + 1 };
                rest = &rest[len..];
            }
        }
    }
}

/// Appends `text` with each `\r\n`, `\r` and `\n` replaced by `line_ending`.
pub(crate) fn write_with_line_ending(mut text: &[u8], line_ending: &[u8], out: &mut Vec<u8>) {
    while let Some(at) = bun_core::strings::index_of_any(text, b"\r\n") {
        out.extend_from_slice(&text[..at]);
        out.extend_from_slice(line_ending);
        let len = if text[at..].starts_with(b"\r\n") { 2 } else { 1 };
        text = &text[at + len..];
    }
    out.extend_from_slice(text);
}

fn comments_of<'a>(file: &'a File<'a>, flavor: Flavor) -> &'a [Comment] {
    let comments = file.extension(|| {
        let mut comments = Vec::new();
        comments::collect(file, flavor, &mut comments);
        comments
    });
    comments.map_or(&[][..], |comments: &Vec<Comment>| comments)
}

/// Writes the document of `file` so that every line is indented by `alignment` columns more.
/// Prettier's `addAlignmentToDoc`.
fn write_aligned<'a>(file: &'a File<'a>, alignment: usize, f: &mut Formatter<'a>) {
    let tab_width = usize::from(f.options().indent_width.value().max(1));
    let (levels, spaces) = (alignment / tab_width, (alignment % tab_width) as u8);
    if spaces > 0 {
        f.write_element(FormatElement::Tag(Tag::StartAlign(Align(spaces))));
    }
    for _ in 0..levels {
        f.write_element(FormatElement::Tag(Tag::StartIndent));
    }
    // It makes the indentation count for the first line, and is trimmed from the result.
    if alignment > 0 {
        hard_line_break().fmt(f);
    }
    crate::js::format_file(file, f);
    for _ in 0..levels {
        f.write_element(FormatElement::Tag(Tag::EndIndent));
    }
    if spaces > 0 {
        f.write_element(FormatElement::Tag(Tag::EndAlign));
    }
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Edge {
    Start,
    End,
}

impl Edge {
    /// Whether a node at `span` is looked at for `offset`. A range does not start in a node that
    /// ends there, and does not end in one that starts there.
    fn is_in(self, offset: u32, span: Span) -> bool {
        match self {
            Edge::Start => span.start <= offset && offset < span.end,
            Edge::End => span.start < offset && offset <= span.end,
        }
    }
}

type Path<'a> = SmallVec<[AstNodes<'a>; 16]>;

/// Prettier's `locStart`: with the decorators before it.
fn loc_start(node: AstNodes<'_>) -> u32 {
    let class = match node {
        // Babel's `Program` starts where the text does, that of typescript-estree at the first token.
        AstNodes::Program(Program(file)) => {
            let first = if file.has_bom() { BOM.len() as u32 } else { 0 };
            return match (file.is_javascript(), file.body().first()) {
                (true, _) => first,
                (false, Some(statement)) => loc_start(node_as_ast_nodes(Node::Stmt(statement))),
                (false, None) => node.span().end,
            };
        }
        AstNodes::Class(class) => Some(class),
        AstNodes::ExportNamedDeclaration(statement) | AstNodes::ExportDefaultDeclaration(statement) => {
            match statement.kind() {
                StmtKind::Class(class) => Some(class),
                _ => None,
            }
        }
        _ => None,
    };
    let start = node.span().start;
    match class.and_then(|class| class.decorators().next()) {
        Some(decorator) => start.min(AstNodes::Decorator(decorator).span().start),
        None => start,
    }
}

fn full_span(node: AstNodes<'_>) -> Span {
    Span::new(loc_start(node), node.span().end)
}

/// Prettier's `locEnd`: a statement ends before its `;`.
fn loc_end<'a>(node: AstNodes<'a>, comments: &Comments<'a>) -> u32 {
    use AstNodes as N;
    let span = node.span();
    let ends_before_semicolon = match node {
        N::ExportNamedDeclaration(_) | N::ExportDefaultDeclaration(_) | N::ExportAllDeclaration(_) => true,
        N::ExpressionStatement(ExpressionStatement::Stmt(statement))
        | N::Directive(statement)
        | N::ImportDeclaration(statement)
        | N::ReturnStatement(statement)
        | N::ThrowStatement(statement)
        | N::DoWhileStatement(statement)
        | N::BreakStatement(statement)
        | N::ContinueStatement(statement)
        | N::DebuggerStatement(statement)
        | N::VariableDeclaration(statement)
        | N::IfStatement(statement)
        | N::ForStatement(statement)
        | N::ForInStatement(statement)
        | N::ForOfStatement(statement)
        | N::WhileStatement(statement)
        | N::WithStatement(statement)
        | N::LabeledStatement(statement) => ends_before_semicolon(statement),
        _ => false,
    };
    match ends_before_semicolon {
        true => comments.without_semicolon(span).end,
        false => span.end,
    }
}

/// Prettier's `isJsSourceElement`: the name of the node in ESTree is `Directive`,
/// `TSExportAssignment`, starts with `TSDeclare`, or ends with `Statement` or `Declaration`.
fn is_source_element(node: AstNodes<'_>) -> bool {
    use AstNodes as N;
    match node {
        N::Directive(_)
        | N::BlockStatement(_)
        | N::EmptyStatement(_)
        | N::DebuggerStatement(_)
        | N::VariableDeclaration(_)
        | N::ReturnStatement(_)
        | N::IfStatement(_)
        | N::ForStatement(_)
        | N::ForInStatement(_)
        | N::ForOfStatement(_)
        | N::WhileStatement(_)
        | N::DoWhileStatement(_)
        | N::WithStatement(_)
        | N::SwitchStatement(_)
        | N::TryStatement(_)
        | N::ThrowStatement(_)
        | N::BreakStatement(_)
        | N::ContinueStatement(_)
        | N::LabeledStatement(_)
        | N::ImportDeclaration(_)
        | N::ExportAllDeclaration(_)
        | N::ExportNamedDeclaration(_)
        | N::ExportDefaultDeclaration(_)
        | N::TSInterfaceDeclaration(_)
        | N::TSTypeAliasDeclaration(_)
        | N::TSEnumDeclaration(_)
        | N::TSModuleDeclaration(_)
        | N::TSGlobalDeclaration(_)
        | N::TSImportEqualsDeclaration(_)
        | N::TSExportAssignment(_)
        | N::TSNamespaceExportDeclaration(_)
        | N::TSCallSignatureDeclaration(_)
        | N::TSConstructSignatureDeclaration(_)
        | N::TSTypeParameterDeclaration(_)
        | N::ExpressionStatement(ExpressionStatement::Stmt(_)) => true,
        N::Function(func) => matches!(func.owner(), Node::Stmt(_)),
        N::Class(class) => matches!(class.owner(), Node::Stmt(_)),
        // The `BlockStatement` that is the body of a function.
        N::FunctionBody(func) => matches!(func.body(), FnBody::Block(_)) && func.kind() != FnKind::StaticBlock,
        _ => false,
    }
}

/// Whether ESTree has the node, and Prettier attaches comments to it.
fn is_in_estree(node: AstNodes<'_>) -> bool {
    use AstNodes as N;
    match node {
        N::Program(_)
        | N::FormalParameters(_)
        | N::ChainExpression(_)
        | N::ExpressionStatement(ExpressionStatement::ArrowBody(_)) => false,
        N::FunctionBody(func) => matches!(func.body(), FnBody::Block(_)),
        _ => true,
    }
}

/// The declaration in `export` and the declaration `statement`.
fn exported_declaration(statement: Stmt<'_>) -> Option<AstNodes<'_>> {
    use AstNodes as N;
    if !statement.is_exported() {
        return None;
    }
    match statement.kind() {
        StmtKind::Var(_) => Some(N::VariableDeclaration(statement)),
        StmtKind::Interface(_) => Some(N::TSInterfaceDeclaration(statement)),
        StmtKind::TypeAlias(_) => Some(N::TSTypeAliasDeclaration(statement)),
        StmtKind::Enum(_) => Some(N::TSEnumDeclaration(statement)),
        StmtKind::Module(_) => Some(N::TSModuleDeclaration(statement)),
        StmtKind::ImportEquals(_) => Some(N::TSImportEqualsDeclaration(statement)),
        _ => None,
    }
}

/// Prettier's `findNodeAtOffset`: the innermost statement or declaration that `offset` is in, and
/// what that is in, from the inside out, without the file.
fn find_node_at_offset<'a>(file: &'a File<'a>, offset: u32, edge: Edge) -> Option<Path<'a>> {
    // Siblings do not overlap, so there is one way down.
    let mut innermost = Node::File(file);
    loop {
        let mut next = None;
        innermost.for_each_child(|child| {
            let (span, estree) = (child.span(), full_span(node_as_ast_nodes(child)));
            if next.is_none() && edge.is_in(offset, Span::new(span.start.min(estree.start), span.end.max(estree.end))) {
                next = Some(child);
            }
        });
        match next {
            Some(child) => innermost = child,
            None => break,
        }
    }

    // The nodes of ESTree that are not nodes of their own here.
    let inner = match innermost {
        Node::Func(func) => Some(AstNodes::FunctionBody(func)),
        Node::Stmt(statement) => exported_declaration(statement),
        _ => None,
    };
    let type_parameters = type_parameters_of(innermost)
        .filter(|list| !list.is_empty())
        .map(|_| AstNodes::TSTypeParameterDeclaration(innermost));
    let path = type_parameters.into_iter().chain(inner).chain(node_as_ast_nodes(innermost).ancestors());
    let mut path = path.filter(|&node| is_in_estree(node) && edge.is_in(offset, full_span(node)));
    let first = path.find(|&node| is_source_element(node))?;
    Some(std::iter::once(first).chain(path).collect())
}

/// Prettier's `findSiblingAncestors`: widens two nodes as long as each stays within the other's
/// side of the range.
fn find_sibling_ancestors<'a>(
    file: AstNodes<'a>,
    start_path: &[AstNodes<'a>],
    end_path: &[AstNodes<'a>],
    comments: &Comments<'a>,
) -> Option<(AstNodes<'a>, AstNodes<'a>)> {
    let (&(mut start_node), start_ancestors) = start_path.split_first()?;
    let (&(mut end_node), end_ancestors) = end_path.split_first()?;
    if start_node == end_node {
        return Some((start_node, end_node));
    }
    // Prettier's `dropRootParents` only leaves out the file if there is anything else.
    let root = [file];
    let start_ancestors = if start_ancestors.is_empty() { &root[..] } else { start_ancestors };
    let end_ancestors = if end_ancestors.is_empty() { &root[..] } else { end_ancestors };

    let start = loc_start(start_node);
    if let Some(&ancestor) = end_ancestors.iter().take_while(|&&it| loc_start(it) >= start).last() {
        end_node = ancestor;
    }
    let end = loc_end(end_node, comments);
    for &ancestor in start_ancestors.iter().take_while(|&&it| loc_end(it, comments) <= end) {
        start_node = ancestor;
        if start_node == end_node {
            break;
        }
    }
    Some((start_node, end_node))
}

/// Prettier's `calculateRange`: what to format so that everything from `start` to `end` is.
fn calculate_range<'a>(file: &'a File<'a>, flavor: Flavor, mut start: u32, mut end: u32) -> Option<Span> {
    let text = file.text();
    // The range is narrowed so that it starts and ends with something.
    let selected = text.get(start as usize..end as usize)?;
    let trimmed = trim_start(selected);
    let is_all_white_space = trimmed.is_empty();
    if !is_all_white_space {
        start += (selected.len() - trimmed.len()) as u32;
        end = start + trim_end(trimmed).len() as u32;
    }

    let start_path = find_node_at_offset(file, start, Edge::Start)?;
    let end_path = match is_all_white_space {
        true => start_path.clone(),
        false => find_node_at_offset(file, end, Edge::End)?,
    };
    let comments = Comments::new(SourceText::new(text), comments_of(file, flavor));
    let root = AstNodes::Program(Program(file));
    let (start_node, end_node) = find_sibling_ancestors(root, &start_path, &end_path, &comments)?;
    Some(Span::new(
        loc_start(start_node).min(loc_start(end_node)),
        start_node.span().end.max(end_node.span().end),
    ))
}
