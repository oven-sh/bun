//! A bridge: files in a language that only a plugin of Prettier reads are handed to the project's own Prettier.
//!
//! `bun format` has no Astro, no PHP, and of Svelte what one version of the plugin prints. Where the configuration of Prettier names the plugin for such a language, and
//! both are installed, the file goes whole to `prettier.format`, in the engines that run the plugins of `bun lint`. What comes
//! back is checked or written like what the formatter prints. It is as exact as it is slow.

use super::cli::{Options, Precedence};
use crate::run::Environment;
use crate::{fs, paths};
use bun_lint::js_plugin::{Host, Refusal};
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
}

impl<'e> Prettier<'e> {
    /// `files`, `size`: how many files are going to be handed over, and how large they are together.
    pub(crate) fn new(
        environment: &'e Environment,
        options: &Options,
        (files, size): (usize, u64),
    ) -> Prettier<'e> {
        let host = Host::with_engine(environment.js_engine, &environment.cwd);
        host.expect(files, size, host.most_realms());
        // A string is written without its quotes.
        let value = |text: &[u8]| match bun_lint::json::parse(text) {
            Some(value @ (Json::Bool(_) | Json::Number(_))) => value,
            _ => Json::String(text.to_vec()),
        };
        let mut flags: Vec<(Vec<u8>, Json)> = (options.format.iter())
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
        let run = vec![
            (b"usesConfig".to_vec(), Json::Bool(options.config_lookup)),
            (b"editorconfig".to_vec(), Json::Bool(options.editorconfig)),
            (b"flags".to_vec(), Json::Object(flags)),
            (b"precedence".to_vec(), Json::String(precedence.to_vec())),
        ];
        Prettier {
            host,
            cwd: environment.cwd.clone(),
            run,
        }
    }

    /// Formats the file at `path`, which is `size` bytes long. `shown`: its name for the user. `writes`: it is written if it
    /// changes. Returns whether it changes. `Err`: for the user.
    pub(crate) fn format_file(
        &self,
        (path, size, shown): (&[u8], u64, &[u8]),
        config: Option<&[u8]>,
        writes: bool,
    ) -> Result<bool, Vec<u8>> {
        let fail = |what: &[u8], why: &[u8]| [what, b" file \"", shown, b"\":\n", why].concat();
        let text = fs::read_sized(path, size)
            .map_err(|error| fail(b"Unable to read", &fs::describe(&error)))?;
        let formatted =
            (self.format(path, config, &text)).map_err(|why| [shown, b": ", &why].concat())?;
        if formatted == text {
            return Ok(false);
        }
        if writes {
            fs::write_atomically(&self.cwd, path, &formatted)
                .map_err(|why| fail(b"Unable to write", &why))?;
        }
        Ok(true)
    }

    /// What Prettier makes of `text`, which is the file at `path`. `config`: its configuration file. `Err`: for the user, behind
    /// the name of the file.
    pub(crate) fn format(
        &self,
        path: &[u8],
        config: Option<&[u8]>,
        text: &[u8],
    ) -> Result<Vec<u8>, Vec<u8>> {
        let mut how = self.run.clone();
        how.push((b"path".to_vec(), Json::String(path.to_vec())));
        let config = config.map_or(Json::Null, |it| Json::String(it.to_vec()));
        how.push((b"config".to_vec(), config));
        let mut json = Vec::new();
        write_json(&mut json, &Json::Object(how));
        // Prettier puts the byte order mark back. What decodes the text may not show it one.
        let (mark, text) = match text.strip_prefix(BOM) {
            Some(text) => (BOM, text),
            None => (&b""[..], text),
        };
        match self.host.format_with_prettier(&json, text) {
            Ok(formatted) => Ok([mark, &formatted].concat()),
            Err(Refusal::NotInstalled) => Err(b"The package prettier is not installed.".to_vec()),
            Err(Refusal::Thrown(why)) => Err(why),
        }
    }
}
