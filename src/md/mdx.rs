//! MDX → JSX compiler for the `.mdx` loader.
//!
//! Compilation runs in three passes over the source:
//!
//! 1. YAML frontmatter is split off (`---` fenced) and re-emitted as
//!    `export const frontmatter = {...}`.
//! 2. Top-level `import`/`export` statements are lifted out so they become
//!    module-level statements rather than Markdown paragraphs.
//! 3. `{...}` expressions are replaced with `\x01MDXE<nonce>:<index>\x01` placeholders so
//!    the Markdown parser treats them as opaque text; [`jsx_renderer`] restores
//!    them while rendering.
//!
//! The result is a JSX module exporting a default `MDXContent` component.

use std::borrow::Cow;

use bun_core::strings;

use crate::jsx_renderer::{ExpressionSlot, JsxRenderer};
use crate::parser::ParserError;
use crate::root as md;

#[derive(Debug, thiserror::Error)]
pub enum MdxError {
    #[error("out of memory")]
    OutOfMemory,
    #[error("internal error: MDX expression placeholder survived rendering")]
    UnresolvedPlaceholder,
    #[error("failed to parse YAML frontmatter")]
    YamlParse,
    #[error("{0}")]
    Parser(ParserError),
    #[error("failed to parse MDX JavaScript: {0}")]
    JavaScript(#[from] bun_js_parser::Error),
    #[error("incomplete MDX JavaScript module")]
    IncompleteJavaScript,
    #[error("MDX documents can only have one default layout")]
    DuplicateLayout,
}

bun_core::oom_from_alloc!(MdxError);

/// Lets the `try_reserve`-based growth throughout this module use `?`.
impl From<std::collections::TryReserveError> for MdxError {
    fn from(_: std::collections::TryReserveError) -> Self {
        MdxError::OutOfMemory
    }
}

impl From<ParserError> for MdxError {
    fn from(err: ParserError) -> Self {
        match err {
            ParserError::OutOfMemory => MdxError::OutOfMemory,
            other => MdxError::Parser(other),
        }
    }
}

pub struct MdxOptions<'a> {
    pub jsx_import_source: &'a [u8],
    pub md_options: md::Options,
}

impl Default for MdxOptions<'_> {
    fn default() -> Self {
        Self {
            jsx_import_source: b"react",
            md_options: md::Options {
                tables: true,
                strikethrough: true,
                tasklists: true,
                no_indented_code_blocks: true,
                ..md::Options::default()
            },
        }
    }
}

pub struct FrontmatterResult<'a> {
    pub yaml_content: &'a [u8],
    pub content_start: u32,
}

#[derive(Copy, Clone, Eq, PartialEq)]
pub enum StmtKind {
    Import,
    Export,
}

pub struct TopLevelStatement {
    pub text: Vec<u8>,
    pub kind: StmtKind,
    pub layout: bool,
    pub layout_alias: Option<Vec<u8>>,
}

// ========================================
// Frontmatter
// ========================================

/// Splits a leading `---` fenced YAML block off the front of `source`.
pub fn extract_frontmatter(source: &[u8]) -> Option<FrontmatterResult<'_>> {
    let first_nl = source.iter().position(|&c| c == b'\n')?;
    if source[..first_nl].trim_ascii_end() != b"---" {
        return None;
    }

    let body_start = first_nl + 1;
    let mut line_start = body_start;
    for line in source[body_start..].split_inclusive(|&c| c == b'\n') {
        if line.trim_ascii_end() == b"---" {
            return Some(FrontmatterResult {
                yaml_content: &source[body_start..line_start],
                content_start: (line_start + line.len()) as u32,
            });
        }
        line_start += line.len();
    }

    None
}

// ========================================
// Top-level import/export extraction
// ========================================

fn parse_module(
    source: &[u8],
    layout_name: &[u8],
    names: &mut std::collections::HashSet<Vec<u8>>,
) -> Result<Vec<TopLevelStatement>, MdxError> {
    use bun_ast::{StmtOrExpr, stmt::Data};
    let arena = bun_alloc::Arena::new();
    let mut ast_allocator = bun_ast::ASTMemoryAllocator::borrowing(&arena);
    let _ast_scope = ast_allocator.enter();
    let mut log = bun_ast::Log::init();
    let js_source = bun_ast::Source::init_path_string(b"document.mdx", source);
    bun_js_parser::parse::parse_entry::with_fragment_parser(
        &js_source,
        &mut log,
        &arena,
        |parser| {
            let statements = match parser.module_statements() {
                Ok(statements) => statements,
                Err(err)
                    if parser.is_at_end()
                        && matches!(
                            err,
                            bun_js_parser::Error::SyntaxError
                                | bun_js_parser::Error::Lexer(
                                    bun_js_parser::lexer::Error::SyntaxError
                                        | bun_js_parser::lexer::Error::UnexpectedSyntax
                                )
                        ) =>
                {
                    return Err(MdxError::IncompleteJavaScript);
                }
                Err(err) => return Err(err.into()),
            };
            collect_names(parser, names)?;
            let mut output = Vec::new();
            for &(start, statement, end) in &statements {
                let mut text = Vec::new();
                let mut layout = false;
                let mut layout_alias = None;
                if let Data::SExportDefault(default) = &statement.data {
                    layout = true;
                    let value_start = parser.default_value_start(start)?;
                    let name = match default.value {
                        StmtOrExpr::Expr(_) => None,
                        StmtOrExpr::Stmt(value) => match value.data {
                            Data::SFunction(function) => function.func.name,
                            Data::SClass(class) => class.class.class_name,
                            _ => None,
                        },
                    };
                    if let Some(name) = name {
                        push_all(&mut text, &source[value_start..end])?;
                        push_all(&mut text, b"\nconst ")?;
                        push_all(&mut text, layout_name)?;
                        push_all(&mut text, b" = ")?;
                        let range = js_source.range_of_identifier(name.loc);
                        push_all(
                            &mut text,
                            &source[range.loc.start as usize
                                ..range.loc.start as usize + range.len as usize],
                        )?;
                        push_all(&mut text, b";\n")?;
                    } else {
                        push_all(&mut text, b"const ")?;
                        push_all(&mut text, layout_name)?;
                        push_all(&mut text, b" = ")?;
                        push_all(&mut text, &source[value_start..end])?;
                        push_all(&mut text, b";\n")?;
                    }
                } else if let Data::SExportStar(star) = &statement.data
                    && star
                        .alias
                        .as_ref()
                        .is_some_and(|alias| alias.original_name.slice() == b"default")
                {
                    layout = true;
                    push_all(&mut text, b"import * as ")?;
                    push_all(&mut text, layout_name)?;
                    push_all(&mut text, b" from ")?;
                    let range = parser.import_range(star.import_record_index);
                    push_all(&mut text, &source[range.loc.start as usize..end])?;
                } else if let Some((items, import)) = match statement.data {
                    Data::SExportClause(clause) => Some((clause.items, None)),
                    Data::SExportFrom(clause) => {
                        Some((clause.items, Some(clause.import_record_index)))
                    }
                    _ => None,
                }
                .filter(|(items, _)| items.iter().any(|item| item.alias.slice() == b"default"))
                {
                    let mut exports = Vec::new();
                    for item in items.iter() {
                        let mut import_name = Vec::new();
                        let name = if import.is_some() {
                            push_all(&mut import_name, b"\"")?;
                            append_json_string_escaped(
                                &mut import_name,
                                item.original_name.slice(),
                            )?;
                            push_all(&mut import_name, b"\"")?;
                            import_name.as_slice()
                        } else {
                            let range = js_source.range_of_identifier(item.name.loc);
                            &source[range.loc.start as usize
                                ..range.loc.start as usize + range.len as usize]
                        };
                        if item.alias.slice() == b"default" {
                            if layout {
                                return Err(MdxError::DuplicateLayout);
                            }
                            layout = true;
                            if let Some(import) = import {
                                push_all(&mut text, b"import { ")?;
                                push_all(&mut text, name)?;
                                push_all(&mut text, b" as ")?;
                                push_all(&mut text, layout_name)?;
                                push_all(&mut text, b" } from ")?;
                                let range = parser.import_range(import);
                                push_all(&mut text, &source[range.loc.start as usize..end])?;
                            } else {
                                let mut alias = Vec::new();
                                push_all(&mut alias, name)?;
                                layout_alias = Some(alias);
                            }
                        } else {
                            if !exports.is_empty() {
                                push_all(&mut exports, b", ")?;
                            }
                            push_all(&mut exports, name)?;
                            push_all(&mut exports, b" as \"")?;
                            append_json_string_escaped(&mut exports, item.alias.slice())?;
                            push_all(&mut exports, b"\"")?;
                        }
                    }
                    if !exports.is_empty() {
                        push_all(&mut text, b"\nexport { ")?;
                        push_all(&mut text, &exports)?;
                        push_all(&mut text, b" }")?;
                        if let Some(import) = import {
                            push_all(&mut text, b" from ")?;
                            let range = parser.import_range(import);
                            push_all(&mut text, &source[range.loc.start as usize..end])?;
                        } else {
                            push_all(&mut text, b";\n")?;
                        }
                    }
                } else {
                    push_all(&mut text, &source[start..end])?;
                }
                output.try_reserve(1)?;
                output.push(TopLevelStatement {
                    text,
                    kind: if matches!(statement.data, Data::SImport(_)) {
                        StmtKind::Import
                    } else {
                        StmtKind::Export
                    },
                    layout,
                    layout_alias,
                });
            }
            Ok(output)
        },
    )
}

fn is_table_start(previous_line: &[u8], line: &[u8]) -> bool {
    if !previous_line.contains(&b'|') || !line.contains(&b'-') {
        return false;
    }
    let underline = crate::line_analysis::parse_table_underline(line, &mut []);
    underline.is_underline
        && underline.col_count == crate::line_analysis::count_table_columns(previous_line)
}

/// ESM blocks can appear between Markdown blocks anywhere in the document.
fn extract_top_level_statements<'a>(
    source: &'a [u8],
    layout_name: &[u8],
    names: &mut std::collections::HashSet<Vec<u8>>,
    tables: bool,
) -> Result<(Vec<TopLevelStatement>, Cow<'a, [u8]>), MdxError> {
    if !strings::contains(source, b"import") && !strings::contains(source, b"export") {
        return Ok((Vec::new(), Cow::Borrowed(source)));
    }
    let mut statements = Vec::new();
    let mut remaining = Vec::new();
    let mut copied_until = 0;
    let mut cursor = 0;
    let mut in_paragraph = false;
    let mut in_table = false;
    let mut previous_line: &[u8] = b"";
    let mut fence: Option<(u8, usize)> = None;
    while cursor < source.len() {
        let line_end = source[cursor..]
            .iter()
            .position(|&b| b == b'\n')
            .map_or(source.len(), |n| cursor + n + 1);
        let line = &source[cursor..line_end];
        let trimmed = line.trim_ascii();
        let was_fenced = fence.is_some();
        if let Some(&delimiter @ (b'`' | b'~')) = trimmed.first() {
            let length = trimmed.iter().take_while(|&&b| b == delimiter).count();
            if length >= 3 {
                if let Some((open, min)) = fence {
                    if delimiter == open && length >= min && trimmed[length..].is_empty() {
                        fence = None;
                    }
                } else {
                    fence = Some((delimiter, length));
                }
            }
        }
        let is_module = !in_paragraph
            && fence.is_none()
            && [b"import".as_slice(), b"export".as_slice()]
                .iter()
                .any(|keyword| {
                    line.starts_with(keyword)
                        && line.get(keyword.len()).is_some_and(|c| {
                            c.is_ascii_whitespace() || matches!(c, b'{' | b'*' | b'\'' | b'"')
                        })
                });
        if is_module {
            let mut end = line_end;
            loop {
                while end < source.len() {
                    let next = source[end..]
                        .iter()
                        .position(|&b| b == b'\n')
                        .map_or(source.len(), |n| end + n + 1);
                    if source[end..next].trim_ascii().is_empty() {
                        break;
                    }
                    end = next;
                }
                match parse_module(&source[cursor..end], layout_name, names) {
                    Ok(mut parsed) => {
                        statements.try_reserve(parsed.len())?;
                        statements.append(&mut parsed);
                        push_all(&mut remaining, &source[copied_until..cursor])?;
                        push_all(&mut remaining, b"\n")?;
                        copied_until = end;
                        cursor = end;
                        in_paragraph = false;
                        break;
                    }
                    Err(MdxError::IncompleteJavaScript) if end < source.len() => {
                        end += 1;
                    }
                    Err(err) => return Err(err),
                }
            }
            continue;
        }
        let heading = trimmed.iter().take_while(|&&c| c == b'#').count();
        let is_heading =
            (1..=6).contains(&heading) && trimmed.get(heading).is_none_or(u8::is_ascii_whitespace);
        let is_setext = in_paragraph
            && trimmed.first().is_some_and(|&c| matches!(c, b'-' | b'='))
            && trimmed.iter().all(|&c| c == trimmed[0]);
        let is_thematic = trimmed
            .first()
            .is_some_and(|&c| matches!(c, b'-' | b'*' | b'_'))
            && trimmed.iter().filter(|&&c| c == trimmed[0]).count() >= 3
            && trimmed
                .iter()
                .all(|&c| c == trimmed[0] || c == b' ' || c == b'\t');
        in_table = tables
            && !was_fenced
            && fence.is_none()
            && trimmed.contains(&b'|')
            && (in_table || is_table_start(previous_line, trimmed));
        previous_line = trimmed;
        let is_empty_list = !in_paragraph
            && !trimmed.is_empty()
            && trimmed
                .split(|&c| c == b' ' || c == b'\t')
                .filter(|part| !part.is_empty())
                .all(|part| matches!(part, b"-" | b"*" | b"+"));
        let is_jsx = trimmed.starts_with(b"<") && trimmed.ends_with(b">");
        in_paragraph = !trimmed.is_empty()
            && !was_fenced
            && fence.is_none()
            && !is_heading
            && !is_setext
            && !is_thematic
            && !in_table
            && !is_empty_list
            && !is_jsx;
        cursor = line_end;
    }
    let remaining = if copied_until == 0 {
        Cow::Borrowed(source)
    } else {
        push_all(&mut remaining, &source[copied_until..])?;
        Cow::Owned(remaining)
    };
    Ok((statements, remaining))
}

// ========================================
// Expression extraction
// ========================================

/// Replaces every top-level `{...}` expression with a `\x01MDXE<nonce>:<index>\x01`
/// placeholder, returning the rewritten text and the captured expressions.
///
/// Fenced and inline code spans are passed through untouched. Inside an
/// expression Bun's JavaScript parser determines the closing brace.
fn replace_expressions<'a>(
    source: &'a [u8],
    names: &mut std::collections::HashSet<Vec<u8>>,
    tables: bool,
) -> Result<(Cow<'a, [u8]>, Vec<ExpressionSlot>), MdxError> {
    if !source.contains(&b'{') {
        return Ok((Cow::Borrowed(source), Vec::new()));
    }
    let marker = b"\x01MDXE";
    let nonce = {
        let mut used = std::collections::HashSet::new();
        let mut cursor = 0;
        while let Some(offset) = strings::index_of(&source[cursor..], marker) {
            cursor += offset + marker.len();
            let start = cursor;
            let mut value = Some(0usize);
            while let Some(c @ b'0'..=b'9') = source.get(cursor) {
                value = value.and_then(|n| n.checked_mul(10)?.checked_add((c - b'0') as usize));
                cursor += 1;
            }
            if cursor > start
                && source.get(cursor) == Some(&b':')
                && let Some(value) = value.filter(|&n| n <= source.len())
            {
                used.try_reserve(1)?;
                used.insert(value);
            }
        }
        let mut nonce = 0;
        while used.contains(&nonce) {
            nonce += 1;
        }
        nonce
    };
    let mut prefix = Vec::new();
    push_all(&mut prefix, marker)?;
    let mut nonce_buf = [0u8; 20];
    push_all(&mut prefix, format_usize(&mut nonce_buf, nonce))?;
    push_all(&mut prefix, b":")?;
    let mut slots: Vec<ExpressionSlot> = Vec::new();
    let mut output: Vec<u8> = Vec::new();

    let arena = bun_alloc::Arena::new();
    let mut ast_allocator = bun_ast::ASTMemoryAllocator::borrowing(&arena);
    let _ast_scope = ast_allocator.enter();
    let mut log = bun_ast::Log::init();
    let js_source = bun_ast::Source::init_path_string(b"document.mdx", source);
    bun_js_parser::parse::parse_entry::with_fragment_parser(
        &js_source,
        &mut log,
        &arena,
        |parser| {
            let mut i = 0;
            let mut copied_until = 0;
            let mut brackets: Vec<(bool, bool)> = Vec::new();
            let mut last_bang = None;
            let mut previous_line: &[u8] = b"";
            let mut in_table = false;
            let mut fence: Option<(u8, usize)> = None;
            let mut line_start = 0;
            while let Some(offset) = strings::index_of_any(&source[i..], b"\n`~\\{[]!") {
                i += offset;
                let c = source[i];
                if c == b'\n' {
                    let line = source[line_start..i].trim_ascii();
                    if line.is_empty() {
                        brackets.clear();
                        in_table = false;
                    } else if tables && fence.is_none() {
                        if in_table {
                            in_table = line.contains(&b'|');
                        } else if previous_line.contains(&b'|') && line.contains(&b'-') {
                            in_table = is_table_start(previous_line, line);
                        }
                    }
                    previous_line = line;
                    line_start = i + 1;
                }
                if c == b'`' || c == b'~' {
                    let run = source[i..].iter().take_while(|&&b| b == c).count();
                    let block_start = i >= line_start
                        && i - line_start <= 3
                        && source[line_start..i].iter().all(|&b| b == b' ');
                    if run >= 3 && block_start {
                        if let Some((delimiter, length)) = fence {
                            if c == delimiter
                                && run >= length
                                && source[i + run..]
                                    .split(|&b| b == b'\n')
                                    .next()
                                    .unwrap()
                                    .trim_ascii()
                                    .is_empty()
                            {
                                fence = None;
                            }
                        } else {
                            fence = Some((c, run));
                        }
                    } else if fence.is_none() && c == b'`' {
                        let mut end = i + run;
                        while end < source.len() {
                            if in_table && matches!(source[end], b'|' | b'\n') {
                                break;
                            }
                            if in_table
                                && source[end] == b'\\'
                                && source.get(end + 1) == Some(&b'|')
                            {
                                end += 2;
                                continue;
                            }
                            if source[end] == b'\n'
                                && source[end + 1..]
                                    .split(|&c| c == b'\n')
                                    .next()
                                    .unwrap()
                                    .trim_ascii()
                                    .is_empty()
                            {
                                break;
                            }
                            if source[end] == b'`' {
                                let closing =
                                    source[end..].iter().take_while(|&&b| b == b'`').count();
                                if closing == run {
                                    end += closing;
                                    if let Some(nl) =
                                        source[i..end].iter().rposition(|&b| b == b'\n')
                                    {
                                        line_start = i + nl + 1;
                                    }
                                    i = end;
                                    break;
                                }
                                end += closing;
                            } else {
                                end += 1;
                            }
                        }
                        if i == end {
                            continue;
                        }
                    }
                    i += run;
                    continue;
                }
                if fence.is_none() {
                    if c == b'\\' && source.get(i + 1).is_some_and(u8::is_ascii_punctuation) {
                        i += 2;
                        continue;
                    }
                    if c == b'!' {
                        last_bang = Some(i);
                    } else if c == b'[' {
                        brackets.try_reserve(1)?;
                        brackets.push((last_bang.is_some_and(|pos| pos + 1 == i), false));
                    } else if c == b']'
                        && let Some((image, has_link)) = brackets.pop()
                    {
                        if (image || !has_link)
                            && let Ok(Some(link)) = crate::links::parse_inline_link(source, i + 1)
                        {
                            if !image && let Some(parent) = brackets.last_mut() {
                                parent.1 = true;
                            }
                            if let Some(nl) = source[i..link.end].iter().rposition(|&b| b == b'\n')
                            {
                                line_start = i + nl + 1;
                            }
                            i = link.end;
                            continue;
                        }
                        if has_link && let Some(parent) = brackets.last_mut() {
                            parent.1 = true;
                        }
                    }
                    if c == b'{' {
                        let end = parser.expression_end(i)?;
                        let mut placeholder = Vec::new();
                        push_all(&mut placeholder, &prefix)?;
                        let mut num_buf = [0u8; 20];
                        push_all(&mut placeholder, format_usize(&mut num_buf, slots.len()))?;
                        push_all(&mut placeholder, &[1])?;
                        let mut original = Vec::new();
                        push_all(&mut original, &source[i + 1..end - 1])?;
                        push_all(&mut output, &source[copied_until..i])?;
                        push_all(&mut output, &placeholder)?;
                        copied_until = end;
                        slots.try_reserve(1)?;
                        slots.push(ExpressionSlot {
                            original: original.into_boxed_slice(),
                            placeholder: placeholder.into_boxed_slice(),
                        });
                        if let Some(nl) = source[i..end].iter().rposition(|&b| b == b'\n') {
                            line_start = i + nl + 1;
                        }
                        i = end;
                        continue;
                    }
                }
                i += 1;
            }
            collect_names(parser, names)?;
            let output = if slots.is_empty() {
                Cow::Borrowed(source)
            } else {
                push_all(&mut output, &source[copied_until..])?;
                Cow::Owned(output)
            };
            Ok((output, slots))
        },
    )
}

// ========================================
// Compile
// ========================================

pub fn compile(src: &[u8], options: &MdxOptions<'_>) -> Result<Vec<u8>, MdxError> {
    if src.len() > crate::parser::MAX_INPUT_LEN {
        return Err(ParserError::InputTooLarge.into());
    }
    let source = src.trim_ascii();
    let frontmatter = extract_frontmatter(source);
    let content_start = frontmatter
        .as_ref()
        .map_or(0usize, |f| f.content_start as usize);

    let mut names = std::collections::HashSet::new();
    let (mut stmts, remaining) = extract_top_level_statements(
        &source[content_start..],
        b"_MdxLayout",
        &mut names,
        options.md_options.tables,
    )?;
    let (preprocessed, slots) =
        replace_expressions(&remaining, &mut names, options.md_options.tables)?;
    let layout_name = unique_name(source, &names, b"_MdxLayout")?;
    if layout_name != b"_MdxLayout" {
        (stmts, _) = extract_top_level_statements(
            &source[content_start..],
            &layout_name,
            &mut names,
            options.md_options.tables,
        )?;
    }
    let components_name = unique_name(source, &names, b"_components")?;
    let content_name = unique_name(source, &names, b"_content")?;
    let function_name = unique_name(source, &names, b"MDXContent")?;
    let mut renderer = JsxRenderer::init(&preprocessed, &slots, &components_name);
    md::render_with_renderer(&preprocessed, options.md_options, renderer.renderer())?;
    if renderer.is_oom() {
        return Err(MdxError::OutOfMemory);
    }
    if let Some(slot) = slots.first() {
        let prefix = &slot.placeholder[..slot.placeholder.len() - 2];
        if strings::contains(renderer.output(), prefix) {
            return Err(MdxError::UnresolvedPlaceholder);
        }
    }

    let mut out: Vec<u8> = Vec::new();

    if !options.jsx_import_source.is_empty() && !strings::eql(options.jsx_import_source, b"react") {
        push_all(&mut out, b"/** @jsxImportSource ")?;
        push_all(&mut out, options.jsx_import_source)?;
        push_all(&mut out, b" */\n")?;
    }

    for stmt in stmts.iter().filter(|s| s.kind == StmtKind::Import) {
        push_all(&mut out, &stmt.text)?;
        push_all(&mut out, b"\n")?;
    }
    push_all(&mut out, b"\n")?;

    for stmt in stmts.iter().filter(|s| s.kind == StmtKind::Export) {
        push_all(&mut out, &stmt.text)?;
        push_all(&mut out, b"\n")?;
    }

    if let Some(f) = frontmatter.as_ref() {
        push_all(&mut out, b"export const frontmatter = ")?;
        emit_frontmatter_as_json(&mut out, f.yaml_content)?;
        push_all(&mut out, b";\n")?;
    }

    push_all(&mut out, b"\nexport default function ")?;
    push_all(&mut out, &function_name)?;
    push_all(&mut out, b"(props = {}) {\n")?;
    push_all(&mut out, b"  const ")?;
    push_all(&mut out, &components_name)?;
    push_all(&mut out, b" = Object.assign({")?;
    for (idx, name) in renderer.component_names.iter().enumerate() {
        if idx > 0 {
            push_all(&mut out, b", ")?;
        }
        push_all(&mut out, b"\"")?;
        push_all(&mut out, name)?;
        push_all(&mut out, b"\": \"")?;
        push_all(&mut out, name)?;
        push_all(&mut out, b"\"")?;
    }
    push_all(&mut out, b"}, props.components);\n")?;
    let layouts = stmts.iter().filter(|s| s.layout).count();
    if layouts > 1 {
        return Err(MdxError::DuplicateLayout);
    }
    let layout_alias = stmts.iter().find_map(|s| s.layout_alias.as_deref());
    if layouts == 0 || layout_alias.is_some() {
        push_all(&mut out, b"  const ")?;
        push_all(&mut out, &layout_name)?;
        push_all(&mut out, b" = ")?;
        push_all(
            &mut out,
            layout_alias.unwrap_or(b"props.components?.wrapper"),
        )?;
        push_all(&mut out, b";\n")?;
    }
    push_all(&mut out, b"  const ")?;
    push_all(&mut out, &content_name)?;
    push_all(&mut out, b" = <>")?;
    push_all(&mut out, renderer.output())?;
    push_all(&mut out, b"</>;\n  return ")?;
    push_all(&mut out, &layout_name)?;
    push_all(&mut out, b" ? <")?;
    push_all(&mut out, &layout_name)?;
    push_all(&mut out, b" {...props}>{")?;
    push_all(&mut out, &content_name)?;
    push_all(&mut out, b"}</")?;
    push_all(&mut out, &layout_name)?;
    push_all(&mut out, b"> : ")?;
    push_all(&mut out, &content_name)?;
    push_all(&mut out, b";\n}\n")?;

    Ok(out)
}

// ========================================
// Frontmatter → JSON
// ========================================

/// Serializes YAML frontmatter as a JavaScript literal, preserving own
/// `__proto__` properties with computed keys.
fn emit_frontmatter_as_json(out: &mut Vec<u8>, yaml_content: &[u8]) -> Result<(), MdxError> {
    let mut log = bun_ast::Log::init();
    let arena = bun_alloc::Arena::new();
    let mut ast_allocator = bun_ast::ASTMemoryAllocator::borrowing(&arena);
    let _ast_scope = ast_allocator.enter();
    let source = bun_ast::Source::init_path_string(b"frontmatter.yaml", yaml_content);

    let expr = match bun_parsers::yaml::YAML::parse(
        &source,
        &mut log,
        &arena,
        bun_parsers::yaml::CyclicAliases::Reject,
    ) {
        Ok(expr) => expr,
        Err(bun_parsers::yaml::YamlParseError::OutOfMemory) => return Err(MdxError::OutOfMemory),
        Err(bun_parsers::yaml::YamlParseError::StackOverflow) => {
            return Err(ParserError::StackOverflow.into());
        }
        Err(bun_parsers::yaml::YamlParseError::SyntaxError) => return Err(MdxError::YamlParse),
    };

    emit_expr_as_json(out, &expr, &arena, &bun_core::StackCheck::init())
}

fn emit_expr_as_json(
    out: &mut Vec<u8>,
    expr: &bun_ast::Expr,
    arena: &bun_alloc::Arena,
    stack_check: &bun_core::StackCheck,
) -> Result<(), MdxError> {
    use bun_ast::expr::Data;

    if !stack_check.is_safe_to_recurse() {
        return Err(ParserError::StackOverflow.into());
    }

    match &expr.data {
        Data::EObject(obj) => {
            push_all(out, b"{")?;
            for (i, prop) in obj.get().properties.iter().enumerate() {
                if i > 0 {
                    push_all(out, b", ")?;
                }
                match prop.key.as_ref().and_then(|k| k.as_string(arena)) {
                    Some(key) => {
                        if key == b"__proto__" {
                            push_all(out, b"[\"__proto__\"]: ")?;
                        } else {
                            push_all(out, b"\"")?;
                            append_json_string_escaped(out, key)?;
                            push_all(out, b"\": ")?;
                        }
                    }
                    None => push_all(out, b"\"\":")?,
                }
                match prop.value.as_ref() {
                    Some(value) => emit_expr_as_json(out, value, arena, stack_check)?,
                    None => push_all(out, b"null")?,
                }
            }
            push_all(out, b"}")?;
        }
        Data::EArray(arr) => {
            push_all(out, b"[")?;
            for (i, item) in arr.get().items.iter().enumerate() {
                if i > 0 {
                    push_all(out, b", ")?;
                }
                emit_expr_as_json(out, item, arena, stack_check)?;
            }
            push_all(out, b"]")?;
        }
        Data::EString(_) => {
            let text = expr.as_string(arena).unwrap_or(b"");
            push_all(out, b"\"")?;
            append_json_string_escaped(out, text)?;
            push_all(out, b"\"")?;
        }
        Data::ENumber(num) => emit_number_as_json(out, num.value())?,
        Data::EBoolean(b) | Data::EBranchBoolean(b) => {
            push_all(out, if b.value { b"true" } else { b"false" })?
        }
        _ => push_all(out, b"null")?,
    }

    Ok(())
}

fn emit_number_as_json(out: &mut Vec<u8>, value: f64) -> Result<(), MdxError> {
    const MAX_SAFE_INTEGRAL: f64 = ((1i64 << 51) - 1) as f64;

    if value.is_nan() || value.is_infinite() {
        return push_all(out, b"null");
    }

    if value == value.trunc() && value.abs() < MAX_SAFE_INTEGRAL {
        let mut buf = [0u8; 20];
        return push_all(out, format_i64(&mut buf, value as i64));
    }

    let mut buf = [0u8; 124];
    let formatted = bun_core::fmt::FormatDouble::dtoa(&mut buf, value);
    push_all(out, formatted)
}

fn append_json_string_escaped(out: &mut Vec<u8>, bytes: &[u8]) -> Result<(), MdxError> {
    const HEX_DIGITS: &[u8; 16] = b"0123456789abcdef";
    for &c in bytes {
        match c {
            b'\\' => push_all(out, b"\\\\")?,
            b'"' => push_all(out, b"\\\"")?,
            b'\n' => push_all(out, b"\\n")?,
            b'\r' => push_all(out, b"\\r")?,
            b'\t' => push_all(out, b"\\t")?,
            0x08 => push_all(out, b"\\b")?,
            0x0C => push_all(out, b"\\f")?,
            0x00..=0x07 | 0x0B | 0x0E..=0x1F => {
                push_all(out, b"\\u00")?;
                out.try_reserve(2)?;
                out.push(HEX_DIGITS[(c >> 4) as usize]);
                out.push(HEX_DIGITS[(c & 0x0F) as usize]);
            }
            _ => {
                out.try_reserve(1)?;
                out.push(c);
            }
        }
    }
    Ok(())
}

// ========================================
// Small helpers
// ========================================

fn collect_names(
    parser: &bun_js_parser::parse::parse_entry::FragmentParser<'_, '_>,
    names: &mut std::collections::HashSet<Vec<u8>>,
) -> Result<(), MdxError> {
    for name in parser.names() {
        if !names.contains(name) {
            names.try_reserve(1)?;
            let mut owned = Vec::new();
            push_all(&mut owned, name)?;
            names.insert(owned);
        }
    }
    Ok(())
}

fn unique_name(
    source: &[u8],
    names: &std::collections::HashSet<Vec<u8>>,
    base: &[u8],
) -> Result<Vec<u8>, MdxError> {
    let mut name = Vec::new();
    push_all(&mut name, base)?;
    let mut index = 0;
    while strings::contains(source, &name) || names.contains(&name) {
        name.truncate(base.len());
        let mut buffer = [0u8; 20];
        push_all(&mut name, format_usize(&mut buffer, index))?;
        index += 1;
    }
    Ok(name)
}

fn push_all(out: &mut Vec<u8>, bytes: &[u8]) -> Result<(), MdxError> {
    out.try_reserve(bytes.len())?;
    out.extend_from_slice(bytes);
    Ok(())
}

fn format_usize(buf: &mut [u8; 20], value: usize) -> &[u8] {
    let mut i = buf.len();
    let mut v = value;
    loop {
        i -= 1;
        buf[i] = b'0' + (v % 10) as u8;
        v /= 10;
        if v == 0 {
            break;
        }
    }
    &buf[i..]
}

fn format_i64(buf: &mut [u8; 20], value: i64) -> &[u8] {
    let negative = value < 0;
    let mut i = buf.len();
    // Accumulate in u64 so i64::MIN's magnitude doesn't overflow.
    let mut v = value.unsigned_abs();
    loop {
        i -= 1;
        buf[i] = b'0' + (v % 10) as u8;
        v /= 10;
        if v == 0 {
            break;
        }
    }
    if negative {
        i -= 1;
        buf[i] = b'-';
    }
    &buf[i..]
}
