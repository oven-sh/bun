//! A configuration file that is a program (`eslint.config.js`, `oxlint.config.ts`) is run by the
//! running executable, in a process of its own, which prints what the file exports as JSON.

use crate::paths;
use crate::run::{Environment, Fatal, Script, Source};
use bun_core::strings;
use bun_lint::linter::write_json;
use bun_lint::options::Json;

/// What precedes the JSON. The file itself can print, too.
const MARKER: &[u8] = b"\x1e--bun-lint-configuration--\x1e";

/// What every script begins with.
pub(crate) const START: &str = include_str!("evaluate-start.js");
const DESCRIBE: &str = include_str!("evaluate-describe.js");
const STAND_INS: &str = include_str!("evaluate-stand-ins.js");

/// For `eslint.config.*` and `oxlint.config.ts`.
pub(crate) const ESLINT: Source = &[
    START,
    DESCRIBE,
    STAND_INS,
    bun_lint::js_plugin::ESLINT_PATCH,
    include_str!("evaluate-eslint.js"),
];
/// For what the configuration files of ESLint 8 name.
pub(crate) const ESLINTRC: Source = &[START, DESCRIBE, include_str!("evaluate-eslintrc.js")];
/// For the configuration files of Prettier.
pub(crate) const PRETTIER: Source = &[START, include_str!("fmt/evaluate-prettier.js")];

/// What the script `source` makes of the configuration file at `path`.
pub(crate) fn evaluate(
    environment: &Environment,
    source: Source,
    path: &[u8],
) -> Result<Json, Fatal> {
    evaluate_with(environment, source, path, b"")
}

/// The same for a script that takes an `argument`. Empty for a script that takes none.
pub(crate) fn evaluate_with(
    environment: &Environment,
    source: Source,
    path: &[u8],
    argument: &[u8],
) -> Result<Json, Fatal> {
    run(environment, source, path, argument).map_err(|why| {
        Fatal(
            [
                b"Cannot load the configuration file ",
                path,
                b":\n",
                &why[..],
            ]
            .concat(),
        )
    })
}

/// What the script `source` makes of `input`, its argument. `directory`: what it takes for that of the file that it is about.
/// `Err`: why it failed.
pub(crate) fn evaluate_input(
    environment: &Environment,
    source: Source,
    directory: &[u8],
    input: &[u8],
) -> Result<Json, Vec<u8>> {
    // There is no such file.
    run(environment, source, &paths::join(directory, b"-"), input)
}

/// What the script `source` hands to `finish`. `Err`: why it failed.
fn run(
    environment: &Environment,
    source: Source,
    path: &[u8],
    argument: &[u8],
) -> Result<Json, Vec<u8>> {
    const SILENT: &[u8] = b"It exited before it exported a config.";
    let text = |it: &[u8]| Json::String(it.to_vec());
    let command_line = environment.command_line.iter().map(|it| text(it));
    // See evaluate-start.js.
    let given = Json::Object(vec![
        (b"path".to_vec(), text(path)),
        (b"marker".to_vec(), text(MARKER)),
        (b"argument".to_vec(), text(argument)),
        (b"commandLine".to_vec(), Json::Array(command_line.collect())),
    ]);
    let mut head = b"const given = ".to_vec();
    write_json(&mut head, &given);
    head.extend_from_slice(b";\n");
    let script = Script {
        head: &head,
        source,
        // As for the tools: `process.cwd()` is where the command runs, not where the file is.
        cwd: &environment.cwd,
        path,
    };
    let printed = (environment.run_script)(&script).map_err(|why| match why.trim_ascii_end() {
        // It has left without a word: `process.exit(1)`.
        b"" => SILENT.to_vec(),
        why => why.to_vec(),
    })?;
    let Some(entries) = handed_to_finish(&printed) else {
        return Err(SILENT.to_vec());
    };
    let config = entries.into_iter().find(|it| it.0 == b"config");
    Ok(config.map_or(Json::Null, |mut it| {
        read_what_is_no_number(&mut it.1);
        it.1
    }))
}

/// What `finish` has written, in all that a script has `printed`.
fn handed_to_finish(printed: &[u8]) -> Option<Vec<(Vec<u8>, Json)>> {
    let at = strings::last_index_of(printed, MARKER)?;
    match bun_lint::json::parse(&printed[at + MARKER.len()..])? {
        Json::Object(entries) => Some(entries),
        _ => None,
    }
}

/// The files of the modules that a script has loaded, which it says under `--doctor`. `printed`: all that it has printed.
pub(crate) fn modules_in(printed: &[u8]) -> Vec<Vec<u8>> {
    let entries = handed_to_finish(printed).unwrap_or_default();
    let modules = entries.iter().find(|it| it.0 == b"modules");
    let modules = modules.and_then(|it| it.1.as_array()).unwrap_or_default();
    (modules.iter().filter_map(Json::as_str))
        .map(<[u8]>::to_vec)
        .collect()
}

/// `NaN`, which JSON has no word for: `serialize` in evaluate-describe.js.
fn read_what_is_no_number(json: &mut Json) {
    match json {
        Json::Array(items) => items.iter_mut().for_each(read_what_is_no_number),
        Json::Object(entries) => match &entries[..] {
            [(key, Json::String(kind))] if key == b"$unserializable" && kind == b"number" => {
                *json = Json::Number(f64::NAN);
            }
            _ => (entries.iter_mut()).for_each(|it| read_what_is_no_number(&mut it.1)),
        },
        _ => {}
    }
}
