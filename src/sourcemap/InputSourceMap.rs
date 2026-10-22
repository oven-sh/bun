//! The source map an input file's `sourceMappingURL` names; output maps are composed through it.

use std::borrow::Cow;

use bun_ast::e::{JsonValue, ObjectJSON};
use bun_ast::expr::Data as ExprData;
use bun_core::{MutableString, UnwrapOrOom};

use crate::mapping::{self, Mapping};
use crate::{LineColumnOffset, Ordinal};

pub struct InputSourceMap {
    mappings: mapping::List,
    /// `sources` with `sourceRoot` applied and relative entries resolved against the map's directory.
    pub sources: Box<[InputSource]>,
    /// `sourcesContent` per source as JSON: `"..."` or `null`.
    pub quoted_sources_content: Box<[Box<[u8]>]>,
}

pub struct InputSource {
    pub path: Box<[u8]>,
    /// `path` is an absolute file-system path, as opposed to a URL or opaque name kept as written.
    pub is_file: bool,
}

/// Why an input source map was rejected, as UTF-8 text.
pub struct ParseError(pub Cow<'static, [u8]>);

impl ParseError {
    const fn msg(text: &'static str) -> ParseError {
        ParseError(Cow::Borrowed(text.as_bytes()))
    }
}

impl InputSourceMap {
    /// `map_dir`: base for relative `sources`; `read_file`: fills a missing `sourcesContent`; `Ok(None)`: maps nothing.
    pub fn parse(
        json: &[u8],
        map_dir: Option<&[u8]>,
        read_file: &mut dyn FnMut(&[u8]) -> Option<Vec<u8>>,
    ) -> Result<Option<InputSourceMap>, ParseError> {
        let json_source = bun_ast::Source::init_path_string("input.js.map", json);
        let mut log = bun_ast::Log::init();
        let parsed = match bun_parsers::json::ParsedJson::parse_json(&json_source, &mut log) {
            Ok(parsed) => parsed,
            Err(_) => {
                return Err(
                    match log.msgs.iter().find(|msg| msg.kind == bun_ast::Kind::Err) {
                        Some(msg) => {
                            ParseError(Cow::Owned([b"invalid JSON: ", &*msg.data.text].concat()))
                        }
                        None => ParseError::msg("invalid JSON"),
                    },
                );
            }
        };
        let ExprData::EObjectJSON(root) = parsed.root.data else {
            return Err(ParseError::msg("expected a JSON object"));
        };
        let root: &ObjectJSON = root.get();

        struct Section<'a> {
            line_offset: i32,
            column_offset: i32,
            map: &'a ObjectJSON,
        }
        let mut sections: Vec<Section<'_>> = Vec::new();
        match root.get(b"sections") {
            None => sections.push(Section {
                line_offset: 0,
                column_offset: 0,
                map: root,
            }),
            Some(JsonValue::Array(items)) => {
                for item in items.get().items() {
                    let Some(section) = item.as_object() else {
                        continue;
                    };
                    let Some(map) = section.get(b"map") else {
                        continue;
                    };
                    let Some(map) = map.as_object() else {
                        return Err(ParseError::msg(
                            "expected \"map\" in \"sections\" to be an object",
                        ));
                    };
                    let (mut line_offset, mut column_offset) = (0, 0);
                    if let Some(offset) = section.get(b"offset") {
                        let Some(offset) = offset.as_object() else {
                            return Err(ParseError::msg(
                                "expected \"offset\" in \"sections\" to be an object",
                            ));
                        };
                        if let Some(JsonValue::Number(line)) = offset.get(b"line") {
                            line_offset = line.value() as i32;
                        }
                        if let Some(JsonValue::Number(column)) = offset.get(b"column") {
                            column_offset = column.value() as i32;
                        }
                    }
                    if line_offset < 0 || column_offset < 0 {
                        return Err(ParseError::msg("negative \"offset\" in \"sections\""));
                    }
                    sections.push(Section {
                        line_offset,
                        column_offset,
                        map,
                    });
                }
            }
            Some(_) => {
                return Err(ParseError::msg("expected \"sections\" to be an array"));
            }
        }

        let mut mappings = mapping::List::default();
        let mut sources: Vec<InputSource> = Vec::new();
        let mut sources_content: Vec<Option<&[u8]>> = Vec::new();
        let mut needs_sort = false;

        for section in &sections {
            match section.map.get(b"version") {
                Some(JsonValue::Number(n)) if n.value() == 3.0 => {}
                // A missing or unknown version skips the section silently, as in esbuild.
                _ => continue,
            }
            let vlq: &[u8] = match section.map.get(b"mappings") {
                Some(JsonValue::String(s)) => s.slice(),
                Some(_) => {
                    return Err(ParseError::msg("expected \"mappings\" to be a string"));
                }
                None => continue,
            };
            let section_sources: &[JsonValue] = match section.map.get(b"sources") {
                Some(JsonValue::Array(items)) => items.get().items(),
                Some(_) => {
                    return Err(ParseError::msg("expected \"sources\" to be an array"));
                }
                None => continue,
            };
            if vlq.is_empty() || section_sources.is_empty() {
                continue;
            }
            let source_root: &[u8] = match section.map.get(b"sourceRoot") {
                Some(JsonValue::String(s)) => s.slice(),
                _ => b"",
            };
            let section_sources_content: &[JsonValue] = match section.map.get(b"sourcesContent") {
                Some(JsonValue::Array(items)) => items.get().items(),
                _ => &[],
            };

            let Ok(section_sources_len) = i32::try_from(section_sources.len()) else {
                return Err(ParseError::msg("too many \"sources\""));
            };
            let Ok(source_offset) = i32::try_from(sources.len()) else {
                return Err(ParseError::msg("too many \"sources\""));
            };
            let parsed = match mapping::parse(
                vlq,
                None,
                section_sources_len,
                mapping::ParseOptions {
                    allow_names: false,
                    sort: true,
                },
            ) {
                Ok(parsed) => parsed,
                Err(fail) if matches!(fail.err, crate::Error::Alloc(_)) => {
                    bun_core::out_of_memory()
                }
                Err(fail) => {
                    return Err(ParseError(Cow::Owned(
                        format!(
                            "bad \"mappings\" data at character {}: {}",
                            fail.loc.start.max(0),
                            fail.err.message()
                        )
                        .into_bytes(),
                    )));
                }
            };

            if sections.len() == 1 && (section.line_offset, section.column_offset) == (0, 0) {
                let mut parsed = parsed;
                mappings = core::mem::take(&mut parsed.mappings);
            } else {
                // Sections can overlap or come out of offset order. `find` needs one sorted list.
                needs_sort = true;
                let section_mappings = &parsed.mappings;
                let generated = section_mappings.generated();
                let original = section_mappings.original();
                let source_index = section_mappings.source_index();
                for i in 0..generated.len() {
                    let on_first_line = generated[i].lines.zero_based() == 0;
                    mappings
                        .append(&Mapping {
                            generated: LineColumnOffset {
                                lines: Ordinal::from_zero_based(
                                    generated[i]
                                        .lines
                                        .zero_based()
                                        .saturating_add(section.line_offset),
                                ),
                                columns: Ordinal::from_zero_based(
                                    generated[i].columns.zero_based().saturating_add(
                                        if on_first_line {
                                            section.column_offset
                                        } else {
                                            0
                                        },
                                    ),
                                ),
                            },
                            original: original[i],
                            source_index: source_index[i] + source_offset,
                            name_index: -1,
                        })
                        .unwrap_or_oom();
                }
            }

            for name in section_sources {
                sources.push(resolve_source(
                    name.as_str().unwrap_or(b""),
                    source_root,
                    map_dir,
                ));
            }
            for i in 0..section_sources.len() {
                sources_content.push(section_sources_content.get(i).and_then(JsonValue::as_str));
            }
        }

        if sources.is_empty() || mappings.generated().is_empty() {
            return Ok(None);
        }
        if needs_sort {
            mappings.sort();
        }

        let mut quoted_sources_content: Vec<Box<[u8]>> = Vec::with_capacity(sources.len());
        for (source, content) in sources.iter().zip(&sources_content) {
            let from_disk;
            let content: Option<&[u8]> = match content {
                Some(content) => Some(content),
                None if source.is_file => {
                    from_disk = read_file(&source.path);
                    from_disk.as_deref()
                }
                None => None,
            };
            quoted_sources_content.push(match content {
                Some(content) => {
                    let mut quoted = MutableString::init(content.len() + 2).unwrap_or_oom();
                    bun_core::quote_for_json(content, &mut quoted, false).unwrap_or_oom();
                    quoted.list.into_boxed_slice()
                }
                None => Box::from(&b"null"[..]),
            });
        }

        Ok(Some(InputSourceMap {
            mappings,
            sources: sources.into_boxed_slice(),
            quoted_sources_content: quoted_sources_content.into_boxed_slice(),
        }))
    }

    /// The mapping covering zero-based `line`:`column` (UTF-16 columns) of the generated file.
    #[inline]
    pub fn find(&self, line: i32, column: i32) -> Option<Mapping> {
        self.mappings.find(
            Ordinal::from_zero_based(line),
            Ordinal::from_zero_based(column),
        )
    }
}

/// ECMA-426 "Resolving Sources": non-`file:` URLs stay as written, the rest become paths under `map_dir`.
fn resolve_source(name: &[u8], source_root: &[u8], map_dir: Option<&[u8]>) -> InputSource {
    let name: Cow<'_, [u8]> = if source_root.is_empty() || url_scheme(name).is_some() {
        Cow::Borrowed(name)
    } else {
        let mut joined = Vec::with_capacity(source_root.len() + 1 + name.len());
        joined.extend_from_slice(source_root);
        if !joined.ends_with(b"/") {
            joined.push(b'/');
        }
        joined.extend_from_slice(name);
        Cow::Owned(joined)
    };

    let verbatim = |name: &[u8]| InputSource {
        path: Box::from(name),
        is_file: false,
    };

    if let Some(path) = path_from_file_url(&name) {
        return InputSource {
            path,
            is_file: true,
        };
    }
    if url_scheme(&name).is_some() || name.starts_with(b"//") {
        return verbatim(&name);
    }
    let Some(map_dir) = map_dir else {
        return verbatim(&name);
    };
    match join_path(
        map_dir,
        &bun_url::PercentEncoding::decode_lenient_alloc(&name),
    ) {
        Some(path) => InputSource {
            path,
            is_file: true,
        },
        None => verbatim(&name),
    }
}

/// `path` resolved against `base` and normalized; `None` if it does not fit a path buffer.
fn join_path(base: &[u8], path: &[u8]) -> Option<Box<[u8]>> {
    use bun_paths::resolve_path::{join_abs_string_buf_checked, platform};
    let mut buf = bun_paths::path_buffer_pool::get();
    join_abs_string_buf_checked::<platform::Auto>(base, &mut buf[..], &[path]).map(Box::from)
}

/// The scheme of `url`, if any. One ASCII letter before `:/` or `:\` is a drive letter, not a scheme.
pub fn url_scheme(url: &[u8]) -> Option<&[u8]> {
    let (&first, rest) = url.split_first()?;
    if !first.is_ascii_alphabetic() {
        return None;
    }
    for (i, &c) in rest.iter().enumerate() {
        match c {
            b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'+' | b'-' | b'.' => {}
            b':' => {
                let scheme = &url[..i + 1];
                if scheme.len() == 1 && matches!(url.get(i + 2), Some(b'/' | b'\\')) {
                    return None;
                }
                return Some(scheme);
            }
            _ => return None,
        }
    }
    None
}

/// The absolute file-system path a `file:` URL names (query and fragment dropped); `None` for any other URL.
pub fn path_from_file_url(url: &[u8]) -> Option<Box<[u8]>> {
    let scheme = url_scheme(url)?;
    // `file:rel.map` (no `/` after the scheme) is not a file URL, as in esbuild.
    if !scheme.eq_ignore_ascii_case(b"file") || url.get(scheme.len() + 1) != Some(&b'/') {
        return None;
    }
    let path = bun_url::path_from_file_url(&bun_core::String::borrow_utf8(url));
    if path.is_dead() {
        return None;
    }
    let path = path.to_owned_slice();
    bun_paths::is_absolute(&path).then(|| path.into_boxed_slice())
}
