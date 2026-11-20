//! A bridge to the project's own Prettier, for files in a language that only a Prettier plugin can format.
//!
//! `bun fmt` doesn't support Astro or PHP. If the Prettier config lists the plugin for such a language, and both Prettier and
//! the plugin are installed, the whole file goes to `prettier.format`. That runs in the same VMs that run `bun lint`'s
//! plugins. The result is checked or written like the built-in formatter's output. It's exact, but slow.

use super::cli::{Options, Precedence};
use super::config::is_prettier_option;
use crate::run::Environment;
use crate::{fs, git, paths};
use bun_lint::js_plugin::{Host, Unformatted};
use bun_lint::linter::write_json;
use bun_lint::options::Json;

const BOM: &[u8] = b"\xEF\xBB\xBF";

/// True if the package `name` resolves from `directory`.
pub(crate) fn is_installed(directory: &[u8], name: &[u8]) -> bool {
    paths::ancestors(directory).any(|it| {
        let package = paths::join(&paths::join(it, b"node_modules"), name);
        fs::is_file(&paths::join(&package, b"package.json"))
    })
}

pub(crate) struct Prettier<'e> {
    host: Host<'e>,
    cwd: Vec<u8>,
    /// The settings shared by all files, in the shape that `formatWithPrettier` in `worker/prettier.js` reads.
    run: Vec<(Vec<u8>, Json)>,
    /// The options of Prettier's that the command line and `[fmt]` set. Each file's `flags` start with them.
    flags: Vec<(Vec<u8>, Json)>,
    written_files: fs::WrittenFiles,
}

/// What `bunfig.toml` and the command line say for one file that is handed over.
pub(crate) struct ForFile<'a> {
    /// [`Configs::bunfig_overrides_for`](super::config::Configs::bunfig_overrides_for)
    pub(crate) overrides: &'a [(&'a [u8], &'a [u8])],
    /// [`Configs::passthrough_for`](super::config::Configs::passthrough_for)
    pub(crate) passthrough: &'a super::config::Passthrough<'a>,
    /// The plugins that `--plugin` and `bunfig.toml` list for the file. A path among them is absolute.
    pub(crate) plugins: &'a [Vec<u8>],
}

impl<'e> Prettier<'e> {
    /// `files` and `size` are the number of files that will be handed over and their total size. `threads` is `--threads`.
    pub(crate) fn new(
        environment: &'e Environment,
        options: &Options,
        (files, size): (usize, u64),
        threads: usize,
    ) -> Prettier<'e> {
        let host = Host::with_engine(environment.js_engine, &environment.cwd);
        host.expect(files, size, threads);
        let flags: Vec<(Vec<u8>, Json)> = (options.format.iter())
            .filter(|it| is_prettier_option(it.0))
            .map(|it| (it.0.to_vec(), flag_value(&it.1)))
            .collect();
        let precedence: &[u8] = match options.config_precedence {
            Precedence::CliOverride => b"cli-override",
            Precedence::FileOverride => b"file-override",
            Precedence::PreferFile => b"prefer-file",
        };
        let reads_stdin = options.stdin_filepath.is_some() || options.formats_unnamed_stdin();
        let looks_at_stdin = reads_stdin && (options.check || options.list_different);
        let run = vec![
            (b"looksAtStdin".to_vec(), Json::Bool(looks_at_stdin)),
            (b"usesConfig".to_vec(), Json::Bool(options.config_lookup)),
            (b"editorconfig".to_vec(), Json::Bool(options.editorconfig)),
            (b"precedence".to_vec(), Json::String(precedence.to_vec())),
        ];
        Prettier {
            host,
            cwd: environment.cwd.clone(),
            run,
            flags,
            written_files: fs::WrittenFiles::default(),
        }
    }

    /// [`Host::for_each`]
    pub(crate) fn for_each(
        &self,
        count: usize,
        is_heavy: &dyn Fn(usize) -> bool,
        work: &(dyn Fn(usize) + Sync),
    ) {
        self.host.for_each(count, is_heavy, work);
    }

    /// Formats the file at `path`, and with `writes` writes it if it changes. Returns whether it changed.
    pub(crate) fn format_file(
        &self,
        (path, display_name): (&[u8], &[u8]),
        (config, file): (Option<&[u8]>, &ForFile),
        writes: bool,
        only: Option<&git::Files>,
    ) -> Result<bool, Left> {
        let fail = |what: &[u8], why: &[u8]| {
            Left::Failed([what, b" file \"", display_name, b"\":\n", why].concat())
        };
        let text = git::read(only, path)
            .map_err(|error| fail(b"Unable to read", &fs::describe(&error)))?;
        let formatted =
            (self.format(Some(path), config, file, &text)).map_err(|why| match why {
                Unformatted::NoParser => Left::NoParser,
                why => Left::Failed([display_name, b": ", &describe(why)].concat()),
            })?;
        if formatted == text {
            return Ok(false);
        }
        if writes {
            fs::write_atomically(&self.written_files, &self.cwd, path, &formatted)
                .map_err(|why| fail(b"Unable to write", &why))?;
        }
        Ok(true)
    }

    /// Returns Prettier's output for `text`, the contents of the file at `path`. `path` is `None` if it has no file
    /// name. `config` is its config file.
    pub(crate) fn format(
        &self,
        path: Option<&[u8]>,
        config: Option<&[u8]>,
        file: &ForFile,
        text: &[u8],
    ) -> Result<Vec<u8>, Unformatted> {
        let mut how = self.run.clone();
        // The worker keeps the last value of a name that is set twice, so an override wins over `[fmt]` and the flags.
        let mut flags = self.flags.clone();
        flags.extend((file.overrides.iter()).map(|it| (it.0.to_vec(), flag_value(it.1))));
        let of_plugins = &file.passthrough;
        let of_plugins = of_plugins.earlier.iter().chain(&of_plugins.current);
        flags.extend(of_plugins.map(|it| (it.0.to_vec(), passthrough_value(it.1))));
        how.push((b"flags".to_vec(), Json::Object(flags)));
        let plugins = strings(file.plugins.iter().map(|it| &it[..]));
        how.push((b"plugins".to_vec(), plugins));
        let names = strings(file.passthrough.current.iter().map(|it| it.0));
        how.push((b"passThrough".to_vec(), names));
        let or_null = |it: Option<&[u8]>| it.map_or(Json::Null, |it| Json::String(it.to_vec()));
        how.push((b"path".to_vec(), or_null(path)));
        how.push((b"config".to_vec(), or_null(config)));
        let mut json = Vec::new();
        write_json(&mut json, &Json::Object(how));
        // Prettier keeps a byte order mark, but decoding the text for JavaScript may strip it first. So it's re-added
        // here.
        let (mark, text) = match text.strip_prefix(BOM) {
            Some(text) => (BOM, text),
            None => (&b""[..], text),
        };
        let formatted = self.host.format_with_prettier(&json, text)?;
        Ok([mark, &formatted].concat())
    }
}

/// A flag's value as JSON. A string's has no quotes, so it isn't valid JSON.
fn flag_value(text: &[u8]) -> Json {
    match bun_lint::json::parse(text) {
        Some(value @ (Json::Bool(_) | Json::Number(_))) => value,
        _ => Json::String(text.to_vec()),
    }
}

fn strings<'a>(all: impl Iterator<Item = &'a [u8]>) -> Json {
    Json::Array(all.map(|it| Json::String(it.to_vec())).collect())
}

/// The value of a pass-through key. It's stored as JSON text, so a string keeps its quotes.
fn passthrough_value(text: &[u8]) -> Json {
    bun_lint::json::parse(text).unwrap_or_else(|| Json::String(text.to_vec()))
}

/// Why [`Prettier::format_file`] left a file as it was.
pub(crate) enum Left {
    /// [`Unformatted::NoParser`]. The file is in a language that nothing here supports.
    NoParser,
    /// The message to print.
    Failed(Vec<u8>),
}

/// The message to print after the file name.
pub(crate) fn describe(why: Unformatted) -> Vec<u8> {
    match why {
        Unformatted::NotInstalled => b"prettier is not installed".to_vec(),
        Unformatted::NoParser => b"no listed plugin has a parser for it".to_vec(),
        Unformatted::Message(why) | Unformatted::Thrown(why) => why,
    }
}
