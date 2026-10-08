//! `bun-lint format value <file>..`: what Bun's parsers read in a file of JSON, JSON5, TOML or YAML, as
//! JSON. A line for each file.

use super::Args;
use crate::host::{self, output_line};
use bun_lint::json::{self, Notation};

pub(super) fn run(args: &Args) {
    for path in &args.positional {
        let text = host::read(path).expect("the file");
        let extension = std::path::Path::new(path).extension();
        let notation = match extension.and_then(|it| it.to_str()) {
            Some("json5") => Some(Notation::Json5),
            Some("toml") => Some(Notation::Toml),
            Some("yaml" | "yml") => Some(Notation::Yaml),
            _ => None,
        };
        let value = match notation {
            Some(notation) => json::parse_as(notation, &text),
            None => json::parse(&text).ok_or_else(|| b"Syntax error".to_vec()),
        };
        match value {
            Ok(value) => {
                let mut out = Vec::new();
                bun_lint::linter::write_json(&mut out, &value);
                output_line!("{}", crate::text(&out));
            }
            Err(why) => output_line!("ERROR {}", crate::text(&why)),
        }
    }
}
