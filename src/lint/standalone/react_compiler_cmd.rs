//! `bun-lint react-compiler <paths..> [--everything] [--oxlint] [--threads=n]`: what the React Compiler says of each file, a line of
//! JSON for each, to compare with what oxlint and ESLint report (`test/cli/lint/oracle/react-compiler`). Places are offsets in
//! bytes. With `--oxlint`: as oxlint words and places it, its message as the reason, its help as the description, its labels as
//! the details.

use crate::host::{self, output_line};
use bun_lint::language::{LanguageOptions, Parser};
use bun_lint::options::Json;
use bun_lint::span::Span;
use bun_lint_react_compiler::{Detail, Finding, Rendered, findings, render_all, want_everything};

fn text(it: &str) -> Json {
    Json::String(it.as_bytes().to_vec())
}

fn optional(it: Option<&String>) -> Json {
    it.map_or(Json::Null, |it| text(it))
}

fn object<const N: usize>(entries: [(&str, Json); N]) -> Json {
    Json::Object(
        (entries.into_iter())
            .map(|(key, value)| (key.as_bytes().to_vec(), value))
            .collect(),
    )
}

fn place(span: Option<Span>) -> [(&'static str, Json); 2] {
    let number =
        |it: fn(Span) -> u32| span.map_or(Json::Null, |span| Json::Number(f64::from(it(span))));
    [
        ("start", number(|it| it.start)),
        ("end", number(|it| it.end)),
    ]
}

fn finding(it: &Finding) -> Json {
    let details = (it.details.iter()).map(|detail| match detail {
        Detail::Error { span, message } => {
            let [start, end] = place(*span);
            object([
                ("kind", text("error")),
                start,
                end,
                ("message", optional(message.as_ref())),
            ])
        }
        Detail::Hint { message } => object([("kind", text("hint")), ("message", text(message))]),
    });
    let suggestions = (it.suggestions.iter()).map(|suggestion| {
        let [start, end] = place(Some(suggestion.range));
        object([
            ("op", text(&format!("{:?}", suggestion.op))),
            start,
            end,
            ("description", text(&suggestion.description)),
            ("text", optional(suggestion.text.as_ref())),
        ])
    });
    object([
        ("category", text(&format!("{:?}", it.category))),
        ("reason", text(&it.reason)),
        ("description", optional(it.description.as_ref())),
        ("details", Json::Array(details.collect())),
        ("suggestions", Json::Array(suggestions.collect())),
    ])
}

fn rendered((it, rendered): (&Finding, Rendered)) -> Json {
    let labels = (rendered.labels.into_iter()).map(|label| {
        let [start, end] = place(Some(label.span));
        let message = match label.text.is_empty() {
            true => Json::Null,
            false => text(&label.text),
        };
        object([("kind", text("error")), start, end, ("message", message)])
    });
    object([
        ("category", text(&format!("{:?}", it.category))),
        ("reason", text(&rendered.message)),
        ("description", text(&rendered.help)),
        ("note", text(&rendered.note)),
        ("details", Json::Array(labels.collect())),
    ])
}

pub(crate) fn run(args: &[String]) {
    let flag = |name: &str| args.iter().find_map(|a| a.strip_prefix(name));
    let threads: usize = flag("--threads=").and_then(|n| n.parse().ok()).unwrap_or(1);
    let wants_everything = args.iter().any(|a| a == "--everything");
    let as_oxlint = args.iter().any(|a| a == "--oxlint");
    let mut paths = Vec::new();
    for arg in args.iter().filter(|a| !a.starts_with("--")) {
        crate::collect(std::path::Path::new(arg), &mut paths);
    }
    // As oxlint reads a file: types and JSX wherever the name of the file allows them.
    let language = LanguageOptions {
        parser: Parser::TypeScript,
        jsx: true,
        ..LanguageOptions::default()
    };
    bun_sema_standalone::for_each_parallel(threads, paths.len(), |i| {
        let path = paths[i].to_string_lossy();
        let Ok(code) = host::read(&paths[i]) else {
            return;
        };
        let line = crate::with_file(&path, &code, &language, |file| {
            if wants_everything {
                want_everything(file);
            }
            let found = match file.has_parse_errors() {
                true => Json::Null,
                false if as_oxlint => {
                    Json::Array(render_all(file, findings(file)).map(rendered).collect())
                }
                false => Json::Array(findings(file).iter().map(finding).collect()),
            };
            let mut line = Vec::new();
            let value = object([("path", text(&path)), ("findings", found)]);
            bun_lint::linter::write_json(&mut line, &value);
            line
        });
        output_line!("{}", bstr::BStr::new(&line));
    });
}
