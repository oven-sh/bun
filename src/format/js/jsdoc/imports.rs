//! `@import` tags: those for the same module become one, and they are sorted.

use super::line_buffer::LineBuffer;
use super::parser::Tag;
use super::text::{join, lines, split_whitespace, trim, trim_end_matches};
use bun_core::strings;
use std::cmp::Ordering;

struct ImportInfo {
    default_import: Option<Vec<u8>>,
    named_imports: Vec<Vec<u8>>,
    module_path: Vec<u8>,
}

/// `Default, {Named1, Named2} from "module"`
fn parse_import_tag(comment_text: &[u8]) -> Option<ImportInfo> {
    let text = join(lines(comment_text).map(trim), b" ");
    let text = trim(&text);
    let from_index = strings::last_index_of(text, b" from ")?;
    let specifier = trim(&text[..from_index]);
    let module_part = trim(&text[from_index + 6..]);
    let quote = *module_part.first().filter(|byte| matches!(byte, b'"' | b'\''))?;
    let module_path = module_part.strip_prefix(&[quote])?.strip_suffix(&[quote])?;
    if module_path.is_empty() {
        return None;
    }
    let collapse = |text: &[u8]| join(split_whitespace(text), b" ");
    let (default_import, named_imports) = match strings::index_of_char_usize(specifier, b'{') {
        Some(brace_start) => {
            let brace_end = strings::last_index_of_char(specifier, b'}')?;
            let default_part = trim(trim_end_matches(trim(&specifier[..brace_start]), |c| c == ','));
            let named_part = specifier.get(brace_start + 1..brace_end)?;
            let named = strings::split(named_part, b",").map(collapse).filter(|name| !name.is_empty()).collect();
            ((!default_part.is_empty()).then(|| default_part.to_vec()), named)
        }
        None => (Some(collapse(specifier)), Vec::new()),
    };
    Some(ImportInfo {
        default_import,
        named_imports,
        module_path: module_path.to_vec(),
    })
}

fn cmp_ascii_case_insensitive(a: &[u8], b: &[u8]) -> Ordering {
    let lower = |text: &[u8]| text.iter().map(u8::to_ascii_lowercase).collect::<Vec<u8>>();
    let common = a.len().min(b.len());
    lower(&a[..common]).cmp(&lower(&b[..common])).then(a.len().cmp(&b.len()))
}

/// What a specifier is sorted by: `B1` of `B as B1`.
fn import_specifier_sort_key(specifier: &[u8]) -> &[u8] {
    match strings::index_of(specifier, b" as ") {
        Some(index) => trim(&specifier[index + 4..]),
        None => trim(specifier),
    }
}

fn merge_and_sort_imports(imports: Vec<ImportInfo>) -> Vec<ImportInfo> {
    let mut groups: Vec<ImportInfo> = Vec::new();
    for import in imports {
        let Some(existing) = groups.iter_mut().find(|group| group.module_path == import.module_path) else {
            groups.push(import);
            continue;
        };
        if import.default_import.is_some() {
            existing.default_import = import.default_import;
        }
        for named in import.named_imports {
            let key = import_specifier_sort_key(&named);
            if !existing.named_imports.iter().any(|it| import_specifier_sort_key(it) == key) {
                existing.named_imports.push(named);
            }
        }
    }
    for import in &mut groups {
        import
            .named_imports
            .sort_by(|a, b| cmp_ascii_case_insensitive(import_specifier_sort_key(a), import_specifier_sort_key(b)));
    }
    // Packages come before relative paths.
    groups.sort_by(|a, b| {
        let is_relative = |import: &ImportInfo| import.module_path.starts_with(b".");
        is_relative(a).cmp(&is_relative(b)).then_with(|| cmp_ascii_case_insensitive(&a.module_path, &b.module_path))
    });
    groups
}

fn format_import_lines(import: &ImportInfo, content_lines: &mut LineBuffer) {
    if import.default_import.is_none() && import.named_imports.is_empty() {
        return;
    }
    let out = content_lines.begin_line();
    out.extend_from_slice(b"@import ");
    if let Some(default) = &import.default_import {
        out.extend_from_slice(default);
        if !import.named_imports.is_empty() {
            out.extend_from_slice(b", ");
        }
    }
    match &import.named_imports[..] {
        [] => {}
        [only] => {
            out.push(b'{');
            out.extend_from_slice(only);
            out.push(b'}');
        }
        named_imports => {
            out.push(b'{');
            for (index, named) in named_imports.iter().enumerate() {
                out.extend_from_slice(b"\n  ");
                out.extend_from_slice(named);
                if index + 1 < named_imports.len() {
                    out.push(b',');
                }
            }
            out.extend_from_slice(b"\n}");
        }
    }
    out.extend_from_slice(b" from \"");
    out.extend_from_slice(&import.module_path);
    out.push(b'"');
}

/// The lines for all `@import` tags of `tags` that can be parsed, and which of `tags` those are.
pub(super) fn process_import_tags(tags: &[(&Tag<'_>, &[u8])]) -> (LineBuffer, smallvec::SmallVec<[usize; 4]>) {
    let mut imports = Vec::new();
    let mut parsed_indices = smallvec::SmallVec::new();
    for (index, (tag, kind)) in tags.iter().enumerate() {
        if *kind == b"import"
            && let Some(info) = parse_import_tag(&tag.comment().parsed())
        {
            imports.push(info);
            parsed_indices.push(index);
        }
    }
    let mut lines = LineBuffer::new();
    for import in &merge_and_sort_imports(imports) {
        format_import_lines(import, &mut lines);
    }
    (lines, parsed_indices)
}
