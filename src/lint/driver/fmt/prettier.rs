//! A bridge to the project's own Prettier, for files in a language that only a Prettier plugin can format.
//!
//! `bun fmt` doesn't support Astro or PHP, and of Svelte it prints what one version of the plugin prints. If the Prettier
//! config lists the plugin for such a language, and both Prettier and the plugin are installed, the whole file goes to
//! `prettier.format`. That runs in the same VMs that run `bun lint`'s plugins. The result is checked or written like the
//! built-in formatter's output. It's exact, but slow.

use super::cli::{Options, Precedence};
use super::config::is_option_of_prettier;
use crate::run::Environment;
use crate::{fs, paths};
use bun_lint::js_plugin::{Host, Unformatted};
use bun_lint::linter::write_json;
use bun_lint::options::Json;

const BOM: &[u8] = b"\xEF\xBB\xBF";

/// Whether the package `name` is found from `directory`.
pub(crate) fn is_installed(directory: &[u8], name: &[u8]) -> bool {
    paths::ancestors(directory).any(|it| {
        let package = paths::join(&paths::join(it, b"node_modules"), name);
        fs::is_file(&paths::join(&package, b"package.json"))
    })
}

pub(crate) struct Prettier<'e> {
    host: Host<'e>,
    cwd: Vec<u8>,
    /// What is the same for all files, as `formatWithPrettier` in `worker/prettier.js` reads it.
    run: Vec<(Vec<u8>, Json)>,
    once: fs::Written,
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
        // A string is written without its quotes.
        let value = |text: &[u8]| match bun_lint::json::parse(text) {
            Some(value @ (Json::Bool(_) | Json::Number(_))) => value,
            _ => Json::String(text.to_vec()),
        };
        let mut flags: Vec<(Vec<u8>, Json)> = (options.format.iter())
            .filter(|it| is_option_of_prettier(it.0))
            .map(|it| (it.0.to_vec(), value(&it.1)))
            .collect();
        if !options.plugins.is_empty() {
            let plugins = options.plugins.iter().cloned().map(Json::String);
            flags.push((b"plugins".to_vec(), Json::Array(plugins.collect())));
        }
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
            (b"flags".to_vec(), Json::Object(flags)),
            (b"precedence".to_vec(), Json::String(precedence.to_vec())),
        ];
        Prettier {
            host,
            cwd: environment.cwd.clone(),
            run,
            once: fs::Written::default(),
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

    /// Formats the file at `path`. `shown`: its name for the user. `writes`: it is written if it changes. Returns whether it
    /// changes. `Err`: for the user.
    pub(crate) fn format_file(
        &self,
        (path, shown): (&[u8], &[u8]),
        config: Option<&[u8]>,
        writes: bool,
    ) -> Result<bool, Vec<u8>> {
        let fail = |what: &[u8], why: &[u8]| [what, b" file \"", shown, b"\":\n", why].concat();
        let text =
            fs::read(path).map_err(|error| fail(b"Unable to read", &fs::describe(&error)))?;
        let formatted = (self.format(Some(path), config, &text))
            .map_err(|why| [shown, b": ", &describe(why)].concat())?;
        if formatted == text {
            return Ok(false);
        }
        if writes {
            fs::write_atomically(&self.once, &self.cwd, path, &formatted)
                .map_err(|why| fail(b"Unable to write", &why))?;
        }
        Ok(true)
    }

    /// What Prettier makes of `text`, which is the file at `path`. `None`: it has no file name. `config`: its configuration
    /// file.
    pub(crate) fn format(
        &self,
        path: Option<&[u8]>,
        config: Option<&[u8]>,
        text: &[u8],
    ) -> Result<Vec<u8>, Unformatted> {
        let mut how = self.run.clone();
        let or_null = |it: Option<&[u8]>| it.map_or(Json::Null, |it| Json::String(it.to_vec()));
        how.push((b"path".to_vec(), or_null(path)));
        how.push((b"config".to_vec(), or_null(config)));
        let mut json = Vec::new();
        write_json(&mut json, &Json::Object(how));
        // Prettier puts the byte order mark back. What decodes the text may not show it one.
        let (mark, text) = match text.strip_prefix(BOM) {
            Some(text) => (BOM, text),
            None => (&b""[..], text),
        };
        let formatted = self.host.format_with_prettier(&json, text)?;
        Ok([mark, &formatted].concat())
    }
}

/// For the user, behind the name of the file.
pub(crate) fn describe(why: Unformatted) -> Vec<u8> {
    match why {
        Unformatted::NotInstalled => b"prettier is not installed".to_vec(),
        Unformatted::Message(why) | Unformatted::Thrown(why) => why,
    }
}
