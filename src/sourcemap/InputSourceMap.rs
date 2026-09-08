//! A source map that an input file points at through its `sourceMappingURL`
//! comment: the map a previous tool (tsc, esbuild, a Svelte compiler) emitted
//! for that file. The printer translates every output position through it, so
//! the emitted map names the files this map names instead of the input file.

use std::borrow::Cow;

use bun_ast::e::{JsonValue, ObjectJSON};
use bun_ast::expr::Data as ExprData;
use bun_core::MutableString;

use crate::mapping::{self, Mapping};
use crate::{LineColumnOffset, Ordinal};

pub struct InputSourceMap {
    mappings: mapping::List,
    /// The map's `sources`, with `sourceRoot` applied and relative entries
    /// resolved against the map's directory.
    pub sources: Box<[InputSource]>,
    /// The `sourcesContent` entry for each of `sources`, as JSON (`"..."` or
    /// `null`), joined with `",\n    "`: ready to splice into an output map.
    pub quoted_sources_content: Box<[u8]>,
}

pub struct InputSource {
    pub path: Box<[u8]>,
    /// `path` is an absolute file-system path. Otherwise it is a URL or an
    /// opaque name and is emitted as written.
    pub is_file: bool,
}

/// Why an input source map was rejected. The input file is still bundled; its
/// output map then points at the input file itself.
pub struct ParseError(pub Cow<'static, str>);

impl InputSourceMap {
    /// Parses source-map `json` (ECMA-426, including `sections` index maps).
    ///
    /// `map_dir` is the directory relative `sources` entries resolve against:
    /// the `.map` file's directory, or the input file's directory for a `data:`
    /// URL. `None` leaves them as written. `read_file` supplies the text of a
    /// file source whose `sourcesContent` entry is missing or `null`.
    ///
    /// `Ok(None)`: the map is well-formed but maps nothing.
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
                let reason = log
                    .msgs
                    .iter()
                    .find(|msg| msg.kind == bun_ast::Kind::Err)
                    .map(|msg| String::from_utf8_lossy(&msg.data.text).into_owned());
                return Err(ParseError(match reason {
                    Some(text) => Cow::Owned(format!("invalid JSON: {text}")),
                    None => Cow::Borrowed("invalid JSON"),
                }));
            }
        };
        let ExprData::EObjectJSON(root) = parsed.root.data else {
            return Err(ParseError(Cow::Borrowed("expected a JSON object")));
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
                        return Err(ParseError(Cow::Borrowed(
                            "expected \"map\" in \"sections\" to be an object",
                        )));
                    };
                    let (mut line_offset, mut column_offset) = (0, 0);
                    if let Some(offset) = section.get(b"offset") {
                        let Some(offset) = offset.as_object() else {
                            return Err(ParseError(Cow::Borrowed(
                                "expected \"offset\" in \"sections\" to be an object",
                            )));
                        };
                        if let Some(JsonValue::Number(line)) = offset.get(b"line") {
                            line_offset = line.value() as i32;
                        }
                        if let Some(JsonValue::Number(column)) = offset.get(b"column") {
                            column_offset = column.value() as i32;
                        }
                    }
                    if line_offset < 0 || column_offset < 0 {
                        return Err(ParseError(Cow::Borrowed(
                            "negative \"offset\" in \"sections\"",
                        )));
                    }
                    sections.push(Section {
                        line_offset,
                        column_offset,
                        map,
                    });
                }
            }
            Some(_) => {
                return Err(ParseError(Cow::Borrowed(
                    "expected \"sections\" to be an array",
                )));
            }
        }

        let mut mappings = mapping::List::default();
        let mut sources: Vec<InputSource> = Vec::new();
        let mut sources_content: Vec<Option<&[u8]>> = Vec::new();
        let mut needs_sort = false;
        let mut prev_offset = (0i32, 0i32);

        for section in &sections {
            match section.map.get(b"version") {
                Some(JsonValue::Number(n)) if n.value() == 3.0 => {}
                // Silently skip a section with a missing or unknown version,
                // like esbuild does.
                _ => continue,
            }
            let vlq: &[u8] = match section.map.get(b"mappings") {
                Some(JsonValue::String(s)) => s.slice(),
                Some(_) => {
                    return Err(ParseError(Cow::Borrowed(
                        "expected \"mappings\" to be a string",
                    )));
                }
                None => continue,
            };
            let section_sources: &[JsonValue] = match section.map.get(b"sources") {
                Some(JsonValue::Array(items)) => items.get().items(),
                Some(_) => {
                    return Err(ParseError(Cow::Borrowed(
                        "expected \"sources\" to be an array",
                    )));
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
                return Err(ParseError(Cow::Borrowed("too many \"sources\"")));
            };
            let Ok(source_offset) = i32::try_from(sources.len()) else {
                return Err(ParseError(Cow::Borrowed("too many \"sources\"")));
            };
            let parsed = match mapping::parse(
                vlq,
                None,
                section_sources_len,
                i32::MAX as usize,
                mapping::ParseOptions {
                    allow_names: false,
                    sort: true,
                },
            ) {
                Ok(parsed) => parsed,
                Err(fail) => {
                    return Err(ParseError(Cow::Owned(format!(
                        "bad \"mappings\" data at character {}: {}",
                        fail.loc.start.max(0),
                        fail.err.message()
                    ))));
                }
            };

            if (section.line_offset, section.column_offset) < prev_offset {
                needs_sort = true;
            }
            prev_offset = (section.line_offset, section.column_offset);

            if sections.len() == 1 && prev_offset == (0, 0) {
                let mut parsed = parsed;
                mappings = core::mem::take(&mut parsed.mappings);
            } else {
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
                        .map_err(|_| ParseError(Cow::Borrowed("out of memory")))?;
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

        let mut quoted = MutableString::init_empty();
        for (i, (source, content)) in sources.iter().zip(&sources_content).enumerate() {
            if i > 0 {
                quoted
                    .append(b",\n    ")
                    .map_err(|_| ParseError(Cow::Borrowed("out of memory")))?;
            }
            let from_disk;
            let content: Option<&[u8]> = match content {
                Some(content) => Some(content),
                None if source.is_file => {
                    from_disk = read_file(&source.path);
                    from_disk.as_deref()
                }
                None => None,
            };
            match content {
                Some(content) => bun_core::quote_for_json(content, &mut quoted, false)
                    .map_err(|_| ParseError(Cow::Borrowed("out of memory")))?,
                None => quoted
                    .append(b"null")
                    .map_err(|_| ParseError(Cow::Borrowed("out of memory")))?,
            }
        }

        Ok(Some(InputSourceMap {
            mappings,
            sources: sources.into_boxed_slice(),
            quoted_sources_content: quoted.list.into_boxed_slice(),
        }))
    }

    /// The mapping that covers `line`:`column` (zero-based, columns in UTF-16
    /// code units) of the file this map was emitted for, if any.
    #[inline]
    pub fn find(&self, line: i32, column: i32) -> Option<Mapping> {
        self.mappings.find(
            Ordinal::from_zero_based(line),
            Ordinal::from_zero_based(column),
        )
    }
}

/// Applies `sourceRoot` to one `sources` entry and resolves the result the way
/// ECMA-426 "Resolving Sources" does: a URL with a scheme other than `file:`
/// stays as written, a `file:` URL becomes a path, and anything else is a path
/// relative to `map_dir`.
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
            path: match map_dir {
                Some(map_dir) => join_path(map_dir, &path).unwrap_or(path),
                None => path,
            },
            is_file: true,
        };
    }
    if url_scheme(&name).is_some() || name.starts_with(b"//") {
        return verbatim(&name);
    }
    let Some(map_dir) = map_dir else {
        return verbatim(&name);
    };
    match join_path(map_dir, &percent_decode(&name)) {
        Some(path) => InputSource {
            path,
            is_file: true,
        },
        None => verbatim(&name),
    }
}

/// `path` resolved against the absolute directory `base` and normalized (an
/// absolute `path` is only normalized). `None` when the result does not fit a
/// path buffer.
fn join_path(base: &[u8], path: &[u8]) -> Option<Box<[u8]>> {
    use bun_paths::resolve_path::{join_abs_string_buf_checked, platform};
    let mut buf = bun_paths::path_buffer_pool::get();
    join_abs_string_buf_checked::<platform::Auto>(base, &mut buf[..], &[path]).map(Box::from)
}

/// The scheme of `url` (`file` for `file:///a.js`), if it has one. A single
/// ASCII letter before `:\` or `:/` is a Windows drive letter, not a scheme.
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

/// The file-system path a `file:` URL names, percent-decoded. `None` when
/// `url` is not a `file:` URL or names a remote host.
pub fn path_from_file_url(url: &[u8]) -> Option<Box<[u8]>> {
    let scheme = url_scheme(url)?;
    if !scheme.eq_ignore_ascii_case(b"file") {
        return None;
    }
    let mut rest = &url[scheme.len() + 1..];
    if let Some(after_slashes) = rest.strip_prefix(b"//") {
        let host_end = bun_core::strings::index_of_char_usize(after_slashes, b'/')
            .unwrap_or(after_slashes.len());
        let host = &after_slashes[..host_end];
        if !host.is_empty() && !host.eq_ignore_ascii_case(b"localhost") {
            return None;
        }
        rest = &after_slashes[host_end..];
    }
    let decoded = percent_decode(rest);
    // `file:///C:/dir/file.js` names `C:/dir/file.js` on Windows.
    if cfg!(windows)
        && decoded.len() >= 3
        && decoded[0] == b'/'
        && decoded[1].is_ascii_alphabetic()
        && decoded[2] == b':'
    {
        return Some(Box::from(&decoded[1..]));
    }
    Some(Box::from(&*decoded))
}

fn percent_decode(text: &[u8]) -> Cow<'_, [u8]> {
    if !bun_core::strings::contains_char(text, b'%') {
        return Cow::Borrowed(text);
    }
    let mut out = Vec::with_capacity(text.len());
    let mut i = 0;
    while i < text.len() {
        if text[i] == b'%' && i + 2 < text.len() {
            if let Some(byte) = bun_core::fmt::hex_pair_value(text[i + 1], text[i + 2]) {
                out.push(byte);
                i += 3;
                continue;
            }
        }
        out.push(text[i]);
        i += 1;
    }
    Cow::Owned(out)
}
