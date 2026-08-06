//! MDX → JSX compiler for the `.mdx` loader.
//!
//! Compilation runs in three passes over the source:
//!
//! 1. YAML frontmatter is split off (`---` fenced) and re-emitted as
//!    `export const frontmatter = {...}`.
//! 2. Top-level `import`/`export` statements are lifted out so they become
//!    module-level statements rather than Markdown paragraphs.
//! 3. `{...}` expressions are replaced with `\x01MDXE<n>\x01` placeholders so
//!    the Markdown parser treats them as opaque text; [`jsx_renderer`] restores
//!    them while rendering.
//!
//! The result is a JSX module exporting a default `MDXContent` component.

use bun_core::strings;

use crate::jsx_renderer::{ExpressionSlot, JsxRenderer};
use crate::parser::ParserError;
use crate::root as md;

#[derive(Debug, thiserror::Error, strum::IntoStaticStr)]
pub enum MdxError {
    #[error("out of memory")]
    OutOfMemory,
    #[error("unclosed MDX expression: missing '}}'")]
    UnclosedExpression,
    #[error("internal error: MDX expression placeholder survived rendering")]
    UnresolvedPlaceholder,
    #[error("failed to parse YAML frontmatter")]
    YamlParse,
    #[error("{0}")]
    Parser(ParserError),
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
}

// ========================================
// Frontmatter
// ========================================

/// Splits a leading `---` fenced YAML block off the front of `source`.
pub fn extract_frontmatter(source: &[u8]) -> Option<FrontmatterResult<'_>> {
    if !strings::has_prefix_comptime(source, b"---") {
        return None;
    }

    let first_nl = strings::index_of_char(&source[3..], b'\n')? as usize;
    let body_start = 3 + first_nl + 1;

    let mut i = body_start;
    while i < source.len() {
        if source[i] == b'\n' || i == body_start {
            let line_start = if source[i] == b'\n' { i + 1 } else { i };
            if line_start + 3 <= source.len() && &source[line_start..line_start + 3] == b"---" {
                let after_dashes = line_start + 3;
                if after_dashes >= source.len() || source[after_dashes] == b'\n' {
                    return Some(FrontmatterResult {
                        yaml_content: &source[body_start..line_start],
                        content_start: core::cmp::min(after_dashes + 1, source.len()) as u32,
                    });
                }
            }
        }
        i += 1;
    }

    None
}

// ========================================
// Top-level import/export extraction
// ========================================

#[derive(Default)]
struct StatementParseState {
    brace_depth: usize,
    paren_depth: usize,
    bracket_depth: usize,
    string_quote: Option<u8>,
    string_escaped: bool,
}

fn update_statement_parse_state(state: &mut StatementParseState, line: &[u8]) {
    for &c in line {
        if let Some(quote) = state.string_quote {
            if state.string_escaped {
                state.string_escaped = false;
                continue;
            }
            if c == b'\\' {
                state.string_escaped = true;
                continue;
            }
            if c == quote {
                state.string_quote = None;
            }
            continue;
        }

        match c {
            b'\'' | b'"' | b'`' => state.string_quote = Some(c),
            b'{' => state.brace_depth += 1,
            b'}' => state.brace_depth = state.brace_depth.saturating_sub(1),
            b'(' => state.paren_depth += 1,
            b')' => state.paren_depth = state.paren_depth.saturating_sub(1),
            b'[' => state.bracket_depth += 1,
            b']' => state.bracket_depth = state.bracket_depth.saturating_sub(1),
            _ => {}
        }
    }
}

/// Drops a trailing `//` comment, ignoring `//` inside string literals.
fn trim_trailing_line_comment(line: &[u8]) -> &[u8] {
    let mut quote: Option<u8> = None;
    let mut escaped = false;
    let mut i = 0usize;
    while i < line.len() {
        let c = line[i];
        if let Some(q) = quote {
            if escaped {
                escaped = false;
                i += 1;
                continue;
            }
            if c == b'\\' {
                escaped = true;
                i += 1;
                continue;
            }
            if c == q {
                quote = None;
            }
            i += 1;
            continue;
        }

        if c == b'\'' || c == b'"' || c == b'`' {
            quote = Some(c);
            i += 1;
            continue;
        }

        if c == b'/' && i + 1 < line.len() && line[i + 1] == b'/' {
            return &line[0..i];
        }
        i += 1;
    }

    line
}

/// Heuristic end-of-statement test: a statement ends when nothing is left open
/// and the last meaningful character can legally terminate it.
fn is_statement_complete(kind: StmtKind, line: &[u8], state: &StatementParseState) -> bool {
    if state.string_quote.is_some()
        || state.brace_depth != 0
        || state.paren_depth != 0
        || state.bracket_depth != 0
    {
        return false;
    }

    let trimmed = trim_trailing_line_comment(line).trim_ascii();
    if trimmed.is_empty() {
        return false;
    }

    let last = trimmed[trimmed.len() - 1];
    if last == b';' {
        return true;
    }

    if kind == StmtKind::Import {
        if strings::index_of(trimmed, b" from ").is_some() {
            return true;
        }
        if let Some(close_idx) = strings::last_index_of_char(trimmed, b'}') {
            let after_close = trimmed[close_idx + 1..].trim_ascii();
            if strings::has_prefix_comptime(after_close, b"from") {
                return true;
            }
        }
        return strings::has_prefix_comptime(trimmed, b"import \"")
            || strings::has_prefix_comptime(trimmed, b"import '");
    }

    if last == b'}' || last == b')' || last == b']' {
        return true;
    }

    !matches!(
        last,
        b',' | b'=' | b':' | b'+' | b'-' | b'*' | b'/' | b'%' | b'&' | b'|' | b'^' | b'?' | b'('
            | b'[' | b'{' | b'\\' | b'.'
    )
}

/// Lifts leading top-level `import`/`export` statements out of `source`,
/// returning them alongside the remaining Markdown.
pub fn extract_top_level_statements(
    source: &[u8],
) -> Result<(Vec<TopLevelStatement>, Vec<u8>), MdxError> {
    let mut stmts: Vec<TopLevelStatement> = Vec::new();
    let mut remaining: Vec<u8> = Vec::new();
    let mut stmt_buffer: Vec<u8> = Vec::new();

    let mut lines = source.split(|&c| c == b'\n');
    let mut seen_content = false;
    let mut in_code_fence = false;

    while let Some(line) = lines.next() {
        let trimmed = line.trim_ascii();

        if strings::has_prefix_comptime(trimmed, b"```") {
            in_code_fence = !in_code_fence;
        }

        let maybe_stmt = !in_code_fence
            && !seen_content
            && !trimmed.is_empty()
            && (strings::has_prefix_comptime(trimmed, b"import ")
                || strings::has_prefix_comptime(trimmed, b"import{")
                || (strings::has_prefix_comptime(trimmed, b"export ")
                    && !strings::has_prefix_comptime(trimmed, b"export default")));

        if maybe_stmt {
            let kind = if strings::has_prefix_comptime(trimmed, b"import") {
                StmtKind::Import
            } else {
                StmtKind::Export
            };
            let mut stmt_state = StatementParseState::default();
            stmt_buffer.clear();

            let mut stmt_line = line;
            loop {
                if !stmt_buffer.is_empty() {
                    stmt_buffer.try_reserve(1)?;
                    stmt_buffer.push(b'\n');
                }
                stmt_buffer.try_reserve(stmt_line.len())?;
                stmt_buffer.extend_from_slice(stmt_line);
                update_statement_parse_state(&mut stmt_state, stmt_line);

                if is_statement_complete(kind, stmt_line, &stmt_state) {
                    break;
                }

                match lines.next() {
                    Some(next) => stmt_line = next,
                    None => break,
                }
            }

            let mut text = Vec::new();
            text.try_reserve(stmt_buffer.len())?;
            text.extend_from_slice(&stmt_buffer);
            stmts.try_reserve(1)?;
            stmts.push(TopLevelStatement { text, kind });
            continue;
        }

        if !trimmed.is_empty() {
            seen_content = true;
        }
        remaining.try_reserve(line.len() + 1)?;
        remaining.extend_from_slice(line);
        remaining.push(b'\n');
    }

    Ok((stmts, remaining))
}

// ========================================
// Expression extraction
// ========================================

/// Replaces every top-level `{...}` expression with a `\x01MDXE<n>\x01`
/// placeholder, returning the rewritten text and the captured expressions.
///
/// Fenced and inline code spans are passed through untouched. Inside an
/// expression the scanner tracks strings, template literals (including nested
/// `${}`), and comments so braces in those contexts don't end it early.
pub fn replace_expressions(source: &[u8]) -> Result<(Vec<u8>, Vec<ExpressionSlot>), MdxError> {
    let mut slots: Vec<ExpressionSlot> = Vec::new();
    let mut output: Vec<u8> = Vec::new();

    let mut i = 0usize;
    let mut depth = 0usize;
    let mut expr_start: Option<usize> = None;
    let mut in_code_fence = false;
    let mut in_inline_code = false;
    let mut expr_quote: Option<u8> = None;
    let mut expr_escaped = false;
    let mut expr_in_line_comment = false;
    let mut expr_in_block_comment = false;
    let mut template_expr_depths: Vec<usize> = Vec::new();

    while i < source.len() {
        let c = source[i];

        // `break 'step` plays the role of Zig's `continue`: it skips the rest
        // of the body but still runs the `i += 1` below.
        'step: {
            if c == b'`' && i + 2 < source.len() && source[i + 1] == b'`' && source[i + 2] == b'`' {
                in_code_fence = !in_code_fence;
                output.try_reserve(3)?;
                output.extend_from_slice(&source[i..i + 3]);
                i += 2;
                break 'step;
            }
            if in_code_fence {
                output.try_reserve(1)?;
                output.push(c);
                break 'step;
            }

            if expr_start.is_some() {
                if expr_in_line_comment {
                    if c == b'\n' {
                        expr_in_line_comment = false;
                    }
                    break 'step;
                }

                if expr_in_block_comment {
                    if c == b'*' && i + 1 < source.len() && source[i + 1] == b'/' {
                        expr_in_block_comment = false;
                        i += 1;
                    }
                    break 'step;
                }

                if let Some(quote) = expr_quote {
                    if expr_escaped {
                        expr_escaped = false;
                        break 'step;
                    }
                    if c == b'\\' {
                        expr_escaped = true;
                        break 'step;
                    }
                    if c == quote {
                        expr_quote = None;
                    }
                    break 'step;
                }

                if !template_expr_depths.is_empty() {
                    let top_idx = template_expr_depths.len() - 1;
                    let top_depth = template_expr_depths[top_idx];

                    if expr_escaped {
                        expr_escaped = false;
                        break 'step;
                    }

                    if c == b'\\' {
                        expr_escaped = true;
                        break 'step;
                    }

                    // Depth 0 = in the literal's text; >0 = inside `${...}`.
                    if top_depth == 0 {
                        if c == b'`' {
                            template_expr_depths.pop();
                            break 'step;
                        }
                        if c == b'$' && i + 1 < source.len() && source[i + 1] == b'{' {
                            template_expr_depths[top_idx] = 1;
                            i += 1;
                        }
                        break 'step;
                    }

                    if c == b'/' && i + 1 < source.len() && source[i + 1] == b'/' {
                        expr_in_line_comment = true;
                        i += 1;
                        break 'step;
                    }

                    if c == b'/' && i + 1 < source.len() && source[i + 1] == b'*' {
                        expr_in_block_comment = true;
                        i += 1;
                        break 'step;
                    }

                    if c == b'\'' || c == b'"' {
                        expr_quote = Some(c);
                        expr_escaped = false;
                        break 'step;
                    }

                    if c == b'`' {
                        template_expr_depths.try_reserve(1)?;
                        template_expr_depths.push(0);
                        expr_escaped = false;
                        break 'step;
                    }

                    if c == b'{' {
                        template_expr_depths[top_idx] += 1;
                        break 'step;
                    }

                    if c == b'}' {
                        template_expr_depths[top_idx] -= 1;
                        break 'step;
                    }

                    break 'step;
                }

                if c == b'/' && i + 1 < source.len() && source[i + 1] == b'/' {
                    expr_in_line_comment = true;
                    i += 1;
                    break 'step;
                }

                if c == b'/' && i + 1 < source.len() && source[i + 1] == b'*' {
                    expr_in_block_comment = true;
                    i += 1;
                    break 'step;
                }

                if c == b'\'' || c == b'"' {
                    expr_quote = Some(c);
                    expr_escaped = false;
                    break 'step;
                }

                if c == b'`' {
                    template_expr_depths.try_reserve(1)?;
                    template_expr_depths.push(0);
                    expr_escaped = false;
                    break 'step;
                }

                if c == b'{' {
                    depth += 1;
                }
                if c == b'}' {
                    depth -= 1;
                    if depth == 0 {
                        let start = expr_start.take().unwrap();
                        let expr_text = &source[start + 1..i];

                        let mut placeholder = Vec::new();
                        placeholder.try_reserve(16)?;
                        placeholder.push(1);
                        placeholder.extend_from_slice(b"MDXE");
                        let mut num_buf = [0u8; 20];
                        placeholder.extend_from_slice(format_usize(&mut num_buf, slots.len()));
                        placeholder.push(1);

                        let mut original = Vec::new();
                        original.try_reserve(expr_text.len())?;
                        original.extend_from_slice(expr_text);

                        output.try_reserve(placeholder.len())?;
                        output.extend_from_slice(&placeholder);

                        slots.try_reserve(1)?;
                        slots.push(ExpressionSlot {
                            original: original.into_boxed_slice(),
                            placeholder: placeholder.into_boxed_slice(),
                        });

                        expr_quote = None;
                        expr_escaped = false;
                        expr_in_line_comment = false;
                        expr_in_block_comment = false;
                        template_expr_depths.clear();
                    }
                }
                break 'step;
            }

            if c == b'`' {
                in_inline_code = !in_inline_code;
                output.try_reserve(1)?;
                output.push(c);
                break 'step;
            }
            if in_inline_code {
                output.try_reserve(1)?;
                output.push(c);
                break 'step;
            }

            if c == b'{' {
                expr_start = Some(i);
                depth = 1;
                expr_quote = None;
                expr_escaped = false;
                expr_in_line_comment = false;
                expr_in_block_comment = false;
                template_expr_depths.clear();
                break 'step;
            }

            output.try_reserve(1)?;
            output.push(c);
        }

        i += 1;
    }

    if expr_start.is_some() {
        return Err(MdxError::UnclosedExpression);
    }

    Ok((output, slots))
}

// ========================================
// Compile
// ========================================

pub fn compile(src: &[u8], options: &MdxOptions<'_>) -> Result<Vec<u8>, MdxError> {
    let source = src.trim_ascii();
    let frontmatter = extract_frontmatter(source);
    let content_start = frontmatter
        .as_ref()
        .map_or(0usize, |f| f.content_start as usize);

    let (stmts, remaining) = extract_top_level_statements(&source[content_start..])?;
    let (preprocessed, slots) = replace_expressions(&remaining)?;

    let mut renderer = JsxRenderer::init(&preprocessed, &slots);
    md::render_with_renderer(&preprocessed, options.md_options, renderer.renderer())?;
    if renderer.is_oom() {
        return Err(MdxError::OutOfMemory);
    }
    if strings::contains(renderer.output(), b"\x01MDXE") {
        return Err(MdxError::UnresolvedPlaceholder);
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

    push_all(&mut out, b"\nexport default function MDXContent(props) {\n")?;
    push_all(&mut out, b"  const _components = Object.assign({")?;
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
    push_all(&mut out, b"  return <>")?;
    push_all(&mut out, renderer.output())?;
    push_all(&mut out, b"</>;\n}\n")?;

    Ok(out)
}

// ========================================
// Frontmatter → JSON
// ========================================

/// Parses YAML frontmatter and serializes it as a JSON object literal.
/// Uses Bun's YAML parser, so the full YAML spec is supported including
/// nested objects, arrays, booleans, numbers, and multiline strings.
fn emit_frontmatter_as_json(out: &mut Vec<u8>, yaml_content: &[u8]) -> Result<(), MdxError> {
    bun_ast::Expr::data_store_create();

    let mut log = bun_ast::Log::init();
    let arena = bun_alloc::Arena::new();
    let source = bun_ast::Source::init_path_string(b"frontmatter.yaml", yaml_content);

    let expr = match bun_parsers::yaml::YAML::parse(&source, &mut log, &arena) {
        Ok(expr) => expr,
        Err(_) => return Err(MdxError::YamlParse),
    };

    emit_expr_as_json(out, &expr, &arena)
}

fn emit_expr_as_json(
    out: &mut Vec<u8>,
    expr: &bun_ast::Expr,
    arena: &bun_alloc::Arena,
) -> Result<(), MdxError> {
    use bun_ast::expr::Data;

    match &expr.data {
        Data::EObject(obj) => {
            push_all(out, b"{")?;
            for (i, prop) in obj.get().properties.iter().enumerate() {
                if i > 0 {
                    push_all(out, b", ")?;
                }
                match prop.key.as_ref().and_then(|k| k.as_string(arena)) {
                    Some(key) => {
                        push_all(out, b"\"")?;
                        append_json_string_escaped(out, key)?;
                        push_all(out, b"\": ")?;
                    }
                    None => push_all(out, b"\"\":")?,
                }
                match prop.value.as_ref() {
                    Some(value) => emit_expr_as_json(out, value, arena)?,
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
                emit_expr_as_json(out, item, arena)?;
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
