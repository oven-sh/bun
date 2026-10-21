//! The content mappers that TypeScript's compiler tests name in a `package.json`, ported from
//! `internal/testutil/contentmappertest`. They run in this process. No test starts a program.

use bun_core::strings;
use bun_sema::content_mapper::{Call, CallError, Mapper, Transport};
use bun_sema::json::Json;
use bun_threading::Guarded;

/// `contentmappertest.NewSpawner`
#[derive(Default)]
pub(crate) struct TestMappers {
    /// `Handler.compilerOptions`: the options of each open project of `compiler-test-mapper`, by handle.
    compiler_options: Guarded<Vec<(Vec<u8>, Json)>>,
}

fn object(members: Vec<(&str, Json)>) -> Json {
    let members = members.into_iter();
    Json::Object(members.map(|(name, value)| (name.into(), value)).collect())
}

fn string(text: &[u8]) -> Json {
    Json::String(text.to_vec())
}

fn numbers(tuple: &[i64]) -> Json {
    Json::Array(tuple.iter().map(|&it| Json::Number(it as f64)).collect())
}

fn failed(detail: &str) -> CallError {
    CallError::Failed {
        detail: format!("ipc: remote error [-32603]: {detail}").into_bytes(),
    }
}

/// `spanmap.Segment`, as the tuple that `Marshal` writes.
#[derive(Copy, Clone)]
struct Segment {
    virtual_start: usize,
    virtual_length: usize,
    original_start: usize,
    original_length: usize,
    /// 0: verbatim. 1: atom. 2: alias.
    kind: i64,
}

fn mappings(segments: &[Segment]) -> Json {
    let tuples = segments.iter().map(|it| {
        numbers(&[
            it.virtual_start as i64,
            it.virtual_length as i64,
            it.original_start as i64,
            it.original_length as i64,
            it.kind,
        ])
    });
    Json::Array(tuples.collect())
}

/// `identityMappedOutput`
fn identity_mapped_output(content: &[u8]) -> Json {
    let whole = Segment {
        virtual_start: 0,
        virtual_length: content.len(),
        original_start: 0,
        original_length: content.len(),
        kind: 0,
    };
    object(vec![
        ("text", string(content)),
        ("extension", string(b".ts")),
        ("mappings", mappings(&[whole])),
    ])
}

/// A `TransformResult` with one supplemental output.
fn with_supplemental(text: &[u8], supplemental: Json) -> Json {
    object(vec![
        ("text", string(text)),
        ("extension", string(b".ts")),
        ("supplemental", Json::Array(vec![supplemental])),
    ])
}

impl Transport for TestMappers {
    fn call(&self, call: &Call) -> Result<Option<Json>, CallError> {
        let command = call.mapper.exec.first().map_or(&b""[..], |it| &it[..]);
        let source: &[u8] = match command {
            b"compiler-test-mapper" => b"box",
            b"lisp-mapper" => b"lisp",
            b"failing-mapper"
            | b"supplemental-mapper"
            | b"supplemental-diagnostics-mapper"
            | b"supplemental-globals-mapper"
            | b"supplemental-module-mapper" => b"mapper",
            _ => {
                let command = bstr::BStr::new(command);
                let detail = format!("contentmappertest: unknown mapper command [{command}]");
                return Err(CallError::NotStarted {
                    detail: detail.into_bytes(),
                });
            }
        };
        let text_of = |name: &[u8]| call.params.get(name).and_then(Json::as_str);
        let handle = text_of(b"projectHandle").unwrap_or_default();
        let result = match call.method {
            "initialize" => object(vec![
                ("positionEncoding", string(b"utf-8")),
                ("diagnosticSource", string(source)),
            ]),
            "openProject" => {
                let options = call.params.get(b"compilerOptions").cloned();
                let opened = (handle.to_vec(), options.unwrap_or(Json::Null));
                self.compiler_options.lock().push(opened);
                object(Vec::new())
            }
            "closeProject" => {
                self.compiler_options.lock().retain(|it| it.0 != handle);
                Json::Null
            }
            _ => {
                let content = text_of(b"content").unwrap_or_default();
                let file_name = text_of(b"fileName").unwrap_or_default();
                self.transform(command, handle, file_name, content)?
            }
        };
        Ok(Some(result))
    }

    fn stop(&self, _: &Mapper) {}
    fn close(&self) {}
}

impl TestMappers {
    fn transform(
        &self,
        command: &[u8],
        handle: &[u8],
        file_name: &[u8],
        content: &[u8],
    ) -> Result<Json, CallError> {
        match command {
            b"compiler-test-mapper" => {
                let projects = self.compiler_options.lock();
                let options = projects.iter().find(|it| it.0 == handle);
                Ok(transform_box(content, options.map(|it| &it.1)))
            }
            b"lisp-mapper" => {
                let segment = |at: [usize; 4], kind: i64| Segment {
                    virtual_start: at[0],
                    virtual_length: at[1] - at[0],
                    original_start: at[2],
                    original_length: at[3] - at[2],
                    kind,
                };
                Ok(object(vec![
                    ("text", string(br#"add(1, 2, "oops");"#)),
                    ("extension", string(b".ts")),
                    (
                        "mappings",
                        mappings(&[
                            segment([0, 3, 1, 2], 2),
                            segment([4, 5, 3, 4], 0),
                            segment([7, 8, 5, 6], 0),
                            segment([10, 16, 7, 13], 0),
                        ]),
                    ),
                ]))
            }
            b"supplemental-mapper" => Ok(with_supplemental(
                b"export {};",
                identity_mapped_output(content),
            )),
            b"supplemental-diagnostics-mapper" => {
                const PREFIX: &[u8] = b"missingSupplementalGlobal;\n";
                let mapped = Segment {
                    virtual_start: PREFIX.len(),
                    virtual_length: content.len(),
                    original_start: 0,
                    original_length: content.len(),
                    kind: 0,
                };
                let supplemental = object(vec![
                    ("text", string(&[PREFIX, content].concat())),
                    ("extension", string(b".ts")),
                    ("mappings", mappings(&[mapped])),
                ]);
                Ok(with_supplemental(b"export {};", supplemental))
            }
            b"supplemental-globals-mapper" => {
                let supplemental: &[u8] = match file_name {
                    name if name.ends_with(b"/a.vue") => {
                        b"/// <reference path=\"./extra.d.ts\" />\ninterface Shared extends Extra { value: string }"
                    }
                    name if name.ends_with(b"/b.vue") => b"declare const shared: Shared;",
                    _ => return Err(failed("unexpected supplemental global input")),
                };
                let supplemental = object(vec![
                    ("text", string(supplemental)),
                    ("extension", string(b".ts")),
                ]);
                Ok(with_supplemental(
                    b"export default shared.value;",
                    supplemental,
                ))
            }
            b"supplemental-module-mapper" => {
                let supplemental = object(vec![
                    (
                        "text",
                        string(br#"export const privateValue: number = "wrong";"#),
                    ),
                    ("extension", string(b".ts")),
                ]);
                Ok(with_supplemental(b"export default 1;", supplemental))
            }
            _ => Err(failed("content mapper failed to transform the file")),
        }
    }
}

/// `transform` of `transforming.go`: puts a line before `content`, and replaces each `#{name}` with the compiler option
/// `name`.
fn transform_box(content: &[u8], options: Option<&Json>) -> Json {
    let mut text = b"const __VERSION = \"1.0.0\";\n".to_vec();
    let mut segments: Vec<Segment> = Vec::new();
    let mut diagnostics = Vec::new();
    let mut write = |text: &mut Vec<u8>, written: &[u8], from: usize, to: usize, kind: i64| {
        segments.push(Segment {
            virtual_start: text.len(),
            virtual_length: written.len(),
            original_start: from,
            original_length: to - from,
            kind,
        });
        text.extend_from_slice(written);
    };
    let mut pos = 0;
    while pos < content.len() {
        let token_start = strings::index_of(&content[pos..], b"#{").map(|at| pos + at);
        let verbatim_end = token_start.unwrap_or(content.len());
        if verbatim_end > pos {
            let verbatim = &content[pos..verbatim_end];
            write(&mut text, verbatim, pos, verbatim_end, 0);
        }
        let Some(token_start) = token_start else {
            break;
        };
        let line_end = strings::index_of_char_usize(&content[token_start..], b'\n')
            .map_or(content.len(), |at| token_start + at);
        let Some(close) = strings::index_of_char_usize(&content[token_start..line_end], b'}')
        else {
            write(&mut text, b"undefined", token_start, line_end, 1);
            diagnostics.push(object(vec![
                ("messageText", string(b"Unclosed interpolation.")),
                ("start", Json::Number(token_start as f64)),
                ("length", Json::Number((line_end - token_start) as f64)),
                ("code", Json::Number(1000.0)),
            ]));
            pos = line_end;
            continue;
        };
        let token_end = token_start + close + 1;
        // `renderOption`
        let name = &content[token_start + 2..token_end - 1];
        let mut rendered = Vec::new();
        match options.and_then(|options| options.get(name)) {
            Some(value) => value.stringify(&mut rendered),
            None => rendered.extend_from_slice(b"undefined"),
        }
        write(&mut text, &rendered, token_start, token_end, 1);
        pos = token_end;
    }
    // `mappedExtension`
    let first_line = strings::index_of_char_usize(content, b'\n').map(|end| &content[..end]);
    let extension = first_line.and_then(|line| line.strip_prefix(b"// @box-extension:"));
    let mut result = vec![
        ("text", string(&text)),
        (
            "extension",
            string(extension.map_or(b".ts", <[u8]>::trim_ascii)),
        ),
        ("mappings", mappings(&segments)),
        ("diagnostics", Json::Array(diagnostics)),
    ];
    result.extend(diagnostic_directives(content, &segments).map(|it| ("diagnosticDirectives", it)));
    object(result)
}

/// `OriginalToVirtualSpans` for a range that isn't empty, in a map whose segments cover the whole original text once.
fn original_to_virtual_span(segments: &[Segment], start: usize, end: usize) -> Option<[usize; 2]> {
    let containing = |position: usize| {
        let mut segments = segments.iter();
        segments.find(|it| {
            (it.original_start..it.original_start + it.original_length).contains(&position)
        })
    };
    let (first, last) = (containing(start)?, containing(end - 1)?);
    let from = match first.kind {
        0 => first.virtual_start + (start - first.original_start),
        _ => first.virtual_start,
    };
    let to = match last.kind {
        0 => last.virtual_start + (end - last.original_start),
        _ => last.virtual_start + last.virtual_length,
    };
    Some([from, to])
}

/// `diagnosticDirectives` of `transforming.go`
fn diagnostic_directives(content: &[u8], segments: &[Segment]) -> Option<Json> {
    let wrap = |directives: Vec<Json>, unused: Vec<Json>| {
        object(vec![
            ("unusedExpectDirectiveDiagnostics", Json::Array(unused)),
            ("directives", Json::Array(directives)),
        ])
    };
    let unused_diagnostic = |code: f64, text: &[u8]| {
        object(vec![
            ("code", Json::Number(code)),
            ("messageText", string(text)),
        ])
    };
    let line_end_from = |from: usize| {
        strings::index_of_char_usize(&content[from..], b'\n').map_or(content.len(), |at| from + at)
    };
    if let Some(rest) = content.strip_prefix(b"// @box-invalid-directive:") {
        let name = &rest[..strings::index_of_char_usize(rest, b'\n').unwrap_or(rest.len())];
        let empty = || unused_diagnostic(0.0, b"");
        let beyond = content.len() as i64 + 1;
        let invalid = match name.trim_ascii() {
            b"invalid-range" => wrap(vec![numbers(&[0, 0, -1, 0, 0])], Vec::new()),
            b"original-range-out-of-bounds" => {
                wrap(vec![numbers(&[beyond, 0, 0, 0, 0])], Vec::new())
            }
            b"virtual-range-out-of-bounds" => {
                wrap(vec![numbers(&[0, 0, 1 << 20, 1 << 20, 0])], Vec::new())
            }
            b"invalid-policy" => wrap(vec![numbers(&[0, 0, 0, 0, 2])], Vec::new()),
            b"ignore-with-unused-diagnostic" => wrap(vec![numbers(&[0; 5])], vec![empty()]),
            b"expect-without-unused-diagnostic" => {
                wrap(vec![numbers(&[0, 0, 0, 0, 1])], Vec::new())
            }
            b"invalid-unused-diagnostic-index" => {
                wrap(vec![numbers(&[0, 0, 0, 0, 1, 1])], vec![empty()])
            }
            b"overlap" => wrap(
                vec![numbers(&[0, 0, 0, 2, 0]), numbers(&[0, 0, 1, 3, 0])],
                Vec::new(),
            ),
            _ => return None,
        };
        return Some(invalid);
    }
    let (mut directives, mut unused): (Vec<Vec<i64>>, Vec<Json>) = (Vec::new(), Vec::new());
    let mut line_start = 0;
    while line_start < content.len() {
        let line_end = line_end_from(line_start);
        let trimmed = content[line_start..line_end].trim_ascii();
        let expected = trimmed.strip_prefix(b"// @box-expect-error:");
        if let Some(text) = expected {
            unused.push(unused_diagnostic(2578.0, text.trim_ascii()));
        }
        if (expected.is_some() || trimmed == b"// @box-ignore") && line_end < content.len() {
            let affected = (line_end + 1, line_end_from(line_end + 1));
            if affected.1 > affected.0
                && let Some([from, to]) = original_to_virtual_span(segments, affected.0, affected.1)
            {
                let mut directive: Vec<i64> = [line_start, line_end - line_start, from, to]
                    .map(|it| it as i64)
                    .into();
                directive.push(i64::from(expected.is_some()));
                directive.extend(expected.map(|_| unused.len() as i64 - 1));
                directives.push(directive);
            }
        }
        line_start = line_end + 1;
    }
    if unused.len() == 1 {
        directives.iter_mut().for_each(|it| it.truncate(5));
    }
    if directives.is_empty() && unused.is_empty() {
        return None;
    }
    let directives = directives.iter().map(|it| numbers(it));
    Some(wrap(directives.collect(), unused))
}
