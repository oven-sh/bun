//! The HTML error page `Bun.serve({ development: true })` responds with when a
//! request handler throws. The page embeds the captured errors as JSON and is
//! rendered in the browser by `packages/bun-error`.

use std::io::Write as _;

use bun_ast::{Kind, Location, Log, Metadata, Msg};
use bun_core::fmt::{JSONFormatterUTF8Options, format_json_string_utf8, substitute_named};
use bun_core::strings;
use bun_jsc::exception_list::{JsException, StackTrace};

const HTML_TEMPLATE: &[u8] = include_bytes!("dev-error-page.html");

pub struct DevErrorPage<'a> {
    /// One-line summary, e.g. `GET /foo failed`.
    pub message: &'a [u8],
    pub cwd: &'a [u8],
    pub exceptions: &'a [JsException],
    /// Build/resolve errors logged while handling the request.
    pub log: Option<&'a Log>,
}

impl DevErrorPage<'_> {
    pub fn render(&self) -> Vec<u8> {
        let mut json = Vec::new();
        self.write_json(&mut json);
        substitute_named(
            HTML_TEMPLATE,
            &[
                (b"error_json", &escape_for_script_element(&json)),
                (
                    b"bun_error_css",
                    bun_zstd::embed_compressed!(codegen "bun-error/bun-error.css"),
                ),
                (
                    b"bun_error_js",
                    bun_zstd::embed_compressed!(codegen "bun-error/index.js"),
                ),
            ],
        )
    }

    /// Field names and enum values follow `packages/bun-error/schema.ts`.
    fn write_json(&self, w: &mut Vec<u8>) {
        w.extend_from_slice(b"{\"message\":");
        write_string(w, self.message);
        w.extend_from_slice(b",\"cwd\":");
        write_string(w, self.cwd);

        w.extend_from_slice(b",\"problems\":{\"exceptions\":[");
        for (i, exception) in self.exceptions.iter().enumerate() {
            if i > 0 {
                w.push(b',');
            }
            w.extend_from_slice(b"{\"name\":");
            write_string(w, &exception.name);
            w.extend_from_slice(b",\"message\":");
            write_string(w, &exception.message);
            write!(
                w,
                ",\"runtime_type\":{},\"code\":{}",
                exception.runtime_type.0, exception.code.0
            )
            .unwrap();
            if !exception.stack.frames.is_empty() {
                w.extend_from_slice(b",\"stack\":");
                write_stack_trace(w, &exception.stack);
            }
            w.push(b'}');
        }

        // `Log.errors` / `Log.warnings` don't count messages added via
        // `add_msg`, which is how build/resolve errors reach this log.
        let msgs: &[Msg] = match self.log {
            Some(log) => &log.msgs,
            None => &[],
        };
        let (mut errors, mut warnings) = (0u32, 0u32);
        for msg in msgs {
            errors += (msg.kind == Kind::Err) as u32;
            warnings += (msg.kind == Kind::Warn) as u32;
        }
        write!(
            w,
            "],\"build\":{{\"errors\":{errors},\"warnings\":{warnings},\"msgs\":["
        )
        .unwrap();
        for (i, msg) in msgs.iter().enumerate() {
            if i > 0 {
                w.push(b',');
            }
            write_message(w, msg);
        }
        w.extend_from_slice(b"]}}}");
    }
}

fn write_stack_trace(w: &mut Vec<u8>, stack: &StackTrace) {
    w.extend_from_slice(b"{\"frames\":[");
    for (i, frame) in stack.frames.iter().enumerate() {
        if i > 0 {
            w.push(b',');
        }
        w.extend_from_slice(b"{\"function_name\":");
        write_string(w, &frame.function_name);
        w.extend_from_slice(b",\"file\":");
        write_string(w, &frame.file);
        write!(
            w,
            ",\"scope\":{},\"position\":{{\"line\":{},\"column\":{}}}}}",
            frame.code_type.0,
            one_based_or_missing(frame.position.line),
            one_based_or_missing(frame.position.column),
        )
        .unwrap();
    }
    w.extend_from_slice(b"],\"source_lines\":[");
    for (i, source_line) in stack.source_lines.iter().enumerate() {
        if i > 0 {
            w.push(b',');
        }
        write!(w, "{{\"line\":{},\"text\":", source_line.line + 1).unwrap();
        write_string(w, &source_line.text);
        w.push(b'}');
    }
    w.extend_from_slice(b"]}");
}

/// bun-error treats `-1` as "no line/column" (e.g. frames without a source position).
fn one_based_or_missing(ordinal: bun_core::Ordinal) -> core::ffi::c_int {
    if ordinal.is_valid() {
        ordinal.one_based()
    } else {
        -1
    }
}

fn write_message(w: &mut Vec<u8>, msg: &Msg) {
    let level: u8 = match msg.kind {
        Kind::Err => 1,
        Kind::Warn => 2,
        Kind::Note => 3,
        Kind::Debug | Kind::Verbose => 5,
    };
    write!(w, "{{\"level\":{level},\"data\":").unwrap();
    write_message_data(w, &msg.data.text, msg.data.location.as_ref());
    w.extend_from_slice(b",\"notes\":[");
    for (i, note) in msg.notes.iter().enumerate() {
        if i > 0 {
            w.push(b',');
        }
        write_message_data(w, &note.text, note.location.as_ref());
    }
    // bun-error renders each message either as a resolve error (`on.resolve`
    // holds the specifier) or as a build error (`on.build` is set).
    w.extend_from_slice(b"],\"on\":{\"resolve\":");
    let specifier: &[u8] = match &msg.metadata {
        Metadata::Resolve(resolve) => resolve.specifier.slice(&msg.data.text),
        Metadata::Build => b"",
    };
    write_string(w, specifier);
    write!(w, ",\"build\":{}}}}}", specifier.is_empty()).unwrap();
}

fn write_message_data(w: &mut Vec<u8>, text: &[u8], location: Option<&Location>) {
    w.extend_from_slice(b"{\"text\":");
    write_string(w, text);
    if let Some(location) = location {
        w.extend_from_slice(b",\"location\":{\"file\":");
        write_string(w, &location.file);
        w.extend_from_slice(b",\"namespace\":");
        write_string(w, &location.namespace);
        w.extend_from_slice(b",\"line_text\":");
        write_string(w, location.line_text.as_deref().unwrap_or(b""));
        write!(
            w,
            ",\"line\":{},\"column\":{},\"offset\":{}}}",
            location.line, location.column, location.offset
        )
        .unwrap();
    }
    w.push(b'}');
}

fn write_string(w: &mut Vec<u8>, bytes: &[u8]) {
    write!(
        w,
        "{}",
        format_json_string_utf8(bytes, JSONFormatterUTF8Options::default())
    )
    .unwrap();
}

/// The JSON is embedded in a `<script>` element, so `</script` and `<!--`
/// must not appear in it. `<` can only occur inside JSON strings, where the
/// `\u003c` escape is equivalent.
fn escape_for_script_element(json: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(json.len());
    let mut remaining = json;
    while let Some(i) = strings::index_of_char_usize(remaining, b'<') {
        out.extend_from_slice(&remaining[..i]);
        out.extend_from_slice(b"\\u003c");
        remaining = &remaining[i + 1..];
    }
    out.extend_from_slice(remaining);
    out
}
