//! Lints a file for which the configuration has a `processor`: ESLint's `_verifyWithFlatConfigArrayAndProcessor`.
//!
//! The processor takes blocks out of the file. Each has a path of its own, `a.md/0_example.js`, hence a configuration of its own, and
//! is linted like a file at that path.

use crate::configs::{Flavor, Loaded};
use crate::lint::Context;
use crate::paths;
use crate::results::FileResult;
use bun_lint::js_plugin::{self, Block, Processor, Refusal, Route, read_messages, write_messages};
use bun_lint::linter::{FileConfig, LintResult, ResolvedConfig, RuleId};
use std::sync::Arc;

/// A processor that finds a file for a processor in a file, and so on, is given up at this depth.
const MAX_DEPTH: u8 = 8;

/// Text to lint.
#[derive(Copy, Clone)]
struct Text<'t> {
    /// ESLint's `filename`.
    path: &'t [u8],
    /// How much of `path` is the path of the file on the disk.
    physical_path_len: usize,
    text: &'t [u8],
    /// ESLint's `disableFixes`.
    without_fixes: bool,
    /// How many processors it has come through.
    depth: u8,
}

fn thrown(message: Vec<u8>) -> LintResult {
    LintResult {
        thrown: Some(message),
        ..LintResult::default()
    }
}

/// What is said about the file at `path`, which only ESLint can lint, if there is no ESLint.
fn not_installed(path: &[u8], config: &ResolvedConfig) -> Vec<u8> {
    let (what, name): (&[u8], _) = match config.is_javascript() {
        true => (b"the parser", &config.parser_name),
        false => (b"the language", &config.language_name),
    };
    [
        b"Cannot lint ",
        path,
        b": ",
        what,
        b" \"",
        name.as_deref().unwrap_or_default(),
        b"\" runs in ESLint, and the package \"eslint\" is not installed. Run `bun add -d eslint`.",
    ]
    .concat()
}

/// What ESLint says about a `processor` that is not there.
fn no_such_processor(config: &ResolvedConfig) -> Vec<u8> {
    let written = config.processor.as_deref().unwrap_or_default();
    let (plugin, name) = match bun_core::strings::last_index_of_char(written, b'/') {
        Some(at) => (&written[..at], &written[at + 1..]),
        None => (&b""[..], written),
    };
    [
        b"Key \"processor\": Could not find \"",
        name,
        b"\" in plugin \"",
        plugin,
        b"\".",
    ]
    .concat()
}

impl Context<'_, '_> {
    /// The rule that a message about a file with `config` names.
    fn find_rule(&self, config: &ResolvedConfig, id: &[u8]) -> RuleId {
        if let Some(entry) = config.find_rule(self.linter.registry(), id) {
            return RuleId::Known(entry.meta);
        }
        match config.find_js_rule(id) {
            Some(Some(rule)) => RuleId::Js(Arc::clone(rule)),
            _ => RuleId::Unknown(id.into()),
        }
    }

    /// Lints `text` as the file at `path`, which is in `file`.
    fn verify_natively(
        &self,
        loaded: &Loaded,
        file: Text,
        path: &[u8],
        text: &[u8],
        config: &ResolvedConfig,
    ) -> LintResult {
        if !config.is_javascript() {
            return thrown(
                [
                    b"The processor of ",
                    file.path,
                    b" returns text in the language \"",
                    config.language_name.as_deref().unwrap_or_default(),
                    b"\". Only JavaScript and TypeScript can be linted.",
                ]
                .concat(),
            );
        }
        let (len, without_fixes) = (file.physical_path_len, file.without_fixes);
        // What only the parser of the configuration can read is for ESLint's own `Linter`, which has that parser.
        self.verify_block_if_read(path, len, text, config, without_fixes)
            .unwrap_or_else(|| match loaded.for_eslint {
                Some(_) => {
                    let it = Text { path, text, ..file };
                    self.verify_with_eslint(loaded, it, config).0
                }
                None => {
                    self.unread.lock().push(path.to_vec());
                    LintResult::default()
                }
            })
    }

    /// A block that a processor has found in `file`, which has `config`.
    fn verify_block(
        &self,
        loaded: &Loaded,
        file: Text,
        config: &ResolvedConfig,
        block: &Block,
    ) -> LintResult {
        let (path, text) = match block {
            Block::Unnamed(text) => {
                return self.verify_as_it_is(loaded, Text { text, ..file }, config);
            }
            Block::Named { path, text } => (paths::from_native(path), text),
        };
        // ESLint's `filterCodeBlock`. ESLint 8 asks `isTargetPath`: whether it lints a file of that name in a directory.
        let registry = self.linter.registry();
        let found = match loaded.flavor {
            Flavor::EslintRc => loaded.config.get_unless_ignored(registry, &path),
            _ => loaded.config.get(registry, &path),
        };
        let FileConfig::Matched(own) = found else {
            return LintResult::default();
        };
        if text == file.text && paths::extname(&path) == paths::extname(file.path) {
            let path = &path;
            return self.verify_as_it_is(loaded, Text { path, text, ..file }, config);
        }
        let block = Text {
            path: &path,
            text,
            depth: file.depth + 1,
            ..file
        };
        self.verify_routed(loaded, block, &own)
    }

    /// ESLint's `_verifyWithFlatConfigArrayAndWithoutProcessors`.
    fn verify_as_it_is(&self, loaded: &Loaded, it: Text, config: &ResolvedConfig) -> LintResult {
        match config.route_as_it_is(it.path) {
            Route::Eslint if loaded.for_eslint.is_some() => {
                self.verify_with_eslint(loaded, it, config).0
            }
            _ => self.verify_natively(loaded, it, it.path, it.text, config),
        }
    }

    fn verify_with_processor(
        &self,
        loaded: &Loaded,
        it: Text,
        config: &ResolvedConfig,
        processor: &Processor,
    ) -> LintResult {
        let path = paths::to_native(it.path.to_vec());
        let mut lint = |supports_autofix: bool, blocks: Vec<Block>| {
            let file = Text {
                without_fixes: it.without_fixes || !supports_autofix,
                ..it
            };
            let mut lists = vec![b'['];
            for (i, block) in blocks.iter().enumerate() {
                if i > 0 {
                    lists.push(b',');
                }
                let result = self.verify_block(loaded, file, config, block);
                if let Some(thrown) = result.thrown {
                    return Err(thrown);
                }
                let (Block::Unnamed(text) | Block::Named { text, .. }) = block;
                write_messages(&mut lists, &result.messages, &result.suppressed, text);
            }
            lists.push(b']');
            Ok(lists)
        };
        match self
            .js_plugins
            .process(processor, &path, it.text, &mut lint)
        {
            Ok(messages) => {
                let (messages, suppressed) =
                    read_messages(&messages, it.text, &|id| self.find_rule(config, id));
                LintResult {
                    messages,
                    suppressed,
                    ..LintResult::default()
                }
            }
            Err(message) => thrown(message),
        }
    }

    /// By ESLint's own `Linter`. Also returns JSON: ESLint's `usedDeprecatedRules`.
    fn verify_with_eslint(
        &self,
        loaded: &Loaded,
        it: Text,
        config: &ResolvedConfig,
    ) -> (LintResult, Option<Vec<u8>>) {
        let Some(for_eslint) = &loaded.for_eslint else {
            return (LintResult::default(), None);
        };
        let path = paths::to_native(it.path.to_vec());
        let text = js_plugin::Text {
            path: &path,
            physical_path_len: it.physical_path_len,
            text: it.text,
            without_fixes: it.without_fixes,
        };
        let configuration = config.for_eslint.as_deref().unwrap_or(&for_eslint.whole);
        match (self.js_plugins).lint_with_eslint(configuration, &for_eslint.run, text, &|id| {
            self.find_rule(config, id)
        }) {
            Ok(linted) => (
                LintResult {
                    messages: linted.messages,
                    suppressed: linted.suppressed,
                    ..LintResult::default()
                },
                Some(linted.deprecated),
            ),
            Err(Refusal::NotInstalled) => (thrown(not_installed(it.path, config)), None),
            Err(Refusal::Thrown(message)) => (thrown(message), None),
        }
    }

    /// ESLint's `_verifyWithFlatConfigArray`.
    fn verify_routed(&self, loaded: &Loaded, it: Text, config: &ResolvedConfig) -> LintResult {
        let route = loaded.routes(config, it.path);
        if route == Route::Eslint {
            return self.verify_with_eslint(loaded, it, config).0;
        }
        if let Some(error) = &config.error {
            return thrown(error.clone());
        }
        match (route, &config.processor_location) {
            (Route::Native, _) => self.verify_natively(loaded, it, it.path, it.text, config),
            (Route::Processor, _) if it.depth >= MAX_DEPTH => LintResult::default(),
            (Route::Processor, Some(processor)) => {
                self.verify_with_processor(loaded, it, config, processor)
            }
            (Route::Processor, None) => thrown(no_such_processor(config)),
            // As a file of that kind.
            (Route::Unsupported | Route::Eslint, _) => LintResult::default(),
        }
    }

    /// [`Context::verify_text`] for a file with a processor. `loaded`: where `config` is from.
    pub(crate) fn verify_processed_text(
        &self,
        loaded: &Loaded,
        path: Vec<u8>,
        path_to_verify: &[u8],
        text: Vec<u8>,
        config: &Arc<ResolvedConfig>,
        on_circular_fixes: &dyn Fn(&[u8]),
    ) -> FileResult {
        let without_fixes = !self.lint_options().wants_fixes;
        let mut deprecated = None;
        let mut verify = |text: &[u8]| {
            let it = Text {
                path: path_to_verify,
                physical_path_len: path_to_verify.len(),
                text,
                without_fixes,
                depth: 0,
            };
            if loaded.routes(config, path_to_verify) != Route::Eslint {
                return self.verify_routed(loaded, it, config);
            }
            let (result, used) = self.verify_with_eslint(loaded, it, config);
            deprecated = used;
            result
        };
        let mut result = self.verify_text_by(
            path,
            path_to_verify,
            (text, false),
            config,
            on_circular_fixes,
            &mut verify,
        );
        result.deprecated = deprecated;
        result
    }
}
