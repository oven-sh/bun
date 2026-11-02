//! Runs configuration files that are programs (`eslint.config.js`, `oxlint.config.ts`). The current executable runs the
//! file in a separate process, which prints the file's exports as JSON.

use crate::paths;
use crate::run::{Environment, Fatal, Script, Source};
use bun_core::strings;
use bun_lint::linter::write_json;
use bun_lint::options::Json;

/// Printed right before the JSON, because the file itself can print too.
const MARKER: &[u8] = b"\x1e--bun-lint-configuration--\x1e";

/// One of the files that scripts are assembled from. Several scripts start with the same files.
#[derive(Copy, Clone)]
pub enum Part {
    /// Every script starts with this.
    Start,
    Describe,
    StandIns,
    Eslint,
    Eslintrc,
    Prettier,
    Tailwind,
    EslintPatch,
}

impl Part {
    /// Release builds embed the files compressed, in one frame, and inflate it the first time a script is run.
    pub fn text(self) -> &'static [u8] {
        if matches!(self, Part::EslintPatch) {
            return bun_lint::js_plugin::eslint_patch();
        }
        // In the order of `Part`. `emitCompressedEmbeds` in scripts/build/codegen.ts lists the same files in the same
        // order.
        let all = bun_zstd::embed_compressed!(
            "lint/config-scripts.js",
            concat!(
                include_str!("evaluate-start.js"),
                "\0",
                include_str!("evaluate-describe.js"),
                "\0",
                include_str!("evaluate-stand-ins.js"),
                "\0",
                include_str!("evaluate-eslint.js"),
                "\0",
                include_str!("evaluate-eslintrc.js"),
                "\0",
                include_str!("fmt/evaluate-prettier.js"),
                "\0",
                include_str!("fmt/tailwind.js"),
            )
            .as_bytes()
        );
        strings::split(all, b"\0")
            .nth(self as usize)
            .unwrap_or_default()
    }
}

/// For `eslint.config.*` and `oxlint.config.ts`.
pub(crate) const ESLINT: Source = &[
    Part::Start,
    Part::Describe,
    Part::StandIns,
    Part::EslintPatch,
    Part::Eslint,
];
/// For the files and packages that ESLint 8's configuration files refer to.
pub(crate) const ESLINTRC: Source = &[Part::Start, Part::Describe, Part::Eslintrc];
/// For Prettier's configuration files.
pub(crate) const PRETTIER: Source = &[Part::Start, Part::Prettier];
/// For `fmt/tailwind.rs`.
pub(crate) const TAILWIND: Source = &[Part::Start, Part::Tailwind];

/// Runs the script `source` on the configuration file at `path` and returns its result.
pub(crate) fn evaluate(
    environment: &Environment,
    source: Source,
    path: &[u8],
) -> Result<Json, Fatal> {
    evaluate_with(environment, source, path, b"")
}

/// Same, for a script that takes an `argument`. Pass an empty one to a script that doesn't.
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

/// Runs the script `source` with the argument `input` and returns its result. The script treats `directory` as the
/// directory of the file it's about. `Err` has the reason it failed.
pub(crate) fn evaluate_input(
    environment: &Environment,
    source: Source,
    directory: &[u8],
    input: &[u8],
) -> Result<Json, Vec<u8>> {
    // The file doesn't exist. Only its directory matters.
    run(environment, source, &paths::join(directory, b"-"), input)
}

/// Returns the config that the script `source` passes to `finish`. `Err` has the reason it failed.
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
        // As with the original tools, `process.cwd()` is where the command runs, not where the file is.
        cwd: &environment.cwd,
    };
    let printed = (environment.run_script)(&script).map_err(|why| match why.trim_ascii_end() {
        // It exited without printing anything, as with `process.exit(1)`.
        b"" => SILENT.to_vec(),
        why => why.to_vec(),
    })?;
    let Some(entries) = finish_payload(&printed) else {
        return Err(SILENT.to_vec());
    };
    let config = entries.into_iter().find(|it| it.0 == b"config");
    Ok(config.map_or(Json::Null, |mut it| {
        restore_nan(&mut it.1);
        it.1
    }))
}

/// Finds the object that the script's `finish` wrote. `printed` is everything the script printed.
fn finish_payload(printed: &[u8]) -> Option<Vec<(Vec<u8>, Json)>> {
    let at = strings::last_index_of(printed, MARKER)?;
    bun_lint::json::parse(&printed[at + MARKER.len()..])?.into_object()
}

/// Paths of the modules a script loaded. It only reports them under `--doctor`. `printed` is everything it printed.
pub(crate) fn modules_in(printed: &[u8]) -> Vec<Vec<u8>> {
    let entries = finish_payload(printed).unwrap_or_default();
    let modules = entries.iter().find(|it| it.0 == b"modules");
    let modules = modules.and_then(|it| it.1.as_array()).unwrap_or_default();
    (modules.iter().filter_map(Json::as_str))
        .map(<[u8]>::to_vec)
        .collect()
}

/// Restores `NaN`, which JSON can't represent. See `serialize` in evaluate-describe.js.
fn restore_nan(json: &mut Json) {
    match json {
        Json::Array(items) => items.iter_mut().for_each(restore_nan),
        Json::Object(entries) => match &entries[..] {
            [(key, Json::String(kind))] if key == b"$unserializable" && kind == b"number" => {
                *json = Json::Number(f64::NAN);
            }
            _ => (entries.iter_mut()).for_each(|it| restore_nan(&mut it.1)),
        },
        _ => {}
    }
}
