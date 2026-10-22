//! Lints a file whose config has a `processor`: ESLint's `_verifyWithFlatConfigArrayAndProcessor`.
//!
//! The processor extracts blocks from the file. Each block has its own path, like `a.md/0_example.js`, so it has its
//! own config, and it's linted like a file at that path.

use crate::configs::{Flavor, Loaded};
use crate::lint::{Context, Fixes};
use crate::paths;
use crate::results::FileResult;
use bun_lint::js_plugin::{
    self, Block, EslintFailure, Processor, Route, read_messages, write_messages,
};
use bun_lint::linter::{FileConfig, LintResult, ResolvedConfig, RuleId};
use std::sync::Arc;

#[derive(Copy, Clone)]
struct Text<'t> {
    /// ESLint's `filename`.
    path: &'t [u8],
    /// How many leading bytes of `path` are the path of the file on disk.
    physical_path_len: usize,
    text: &'t [u8],
    fixes: Fixes,
}

fn thrown(message: Vec<u8>) -> LintResult {
    LintResult {
        thrown: Some(message),
        ..LintResult::default()
    }
}

/// The result for a text that only the `eslint` package can lint, when it isn't installed. The caller adds the text to
/// [`Context::needs_eslint`]: [`Context::verify_processed_text`] for a file, [`Context::verify_block`] for a part of
/// one.
fn needs_eslint() -> LintResult {
    LintResult {
        needs_another_linter: true,
        ..LintResult::default()
    }
}

/// ESLint's error for a `processor` that doesn't exist.
fn no_such_processor(config: &ResolvedConfig) -> Vec<u8> {
    let processor_id = config.processor.as_deref().unwrap_or_default();
    let (plugin, name) = match bun_core::strings::last_index_of_char(processor_id, b'/') {
        Some(at) => (&processor_id[..at], &processor_id[at + 1..]),
        None => (&b""[..], processor_id),
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
    /// Resolves the rule ID in a message about a file with `config`.
    fn find_rule(&self, config: &ResolvedConfig, id: &[u8]) -> RuleId {
        if let Some(entry) = config.find_rule(self.linter.registry(), id) {
            return RuleId::Known(entry.meta);
        }
        match config.find_js_rule(id) {
            Some(Some(rule)) => RuleId::Js(Arc::clone(rule)),
            _ => RuleId::Unknown(id.into()),
        }
    }

    /// Lints `text` as the file at `path`, which is inside `file`.
    fn verify_natively(
        &self,
        loaded: &Loaded,
        file: Text,
        path: &[u8],
        text: &[u8],
        config: &ResolvedConfig,
    ) -> LintResult {
        if !config.is_javascript() {
            return needs_eslint();
        }
        let (len, fixes) = (file.physical_path_len, file.fixes);
        // Text that only the config's parser can parse goes to ESLint's own `Linter`, which has that parser.
        self.verify_block_if_read(path, len, text, config, fixes)
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

    /// Lints a block that a processor found in `file`, which has `config`.
    fn verify_block(
        &self,
        loaded: &Loaded,
        file: Text,
        config: &ResolvedConfig,
        block: &Block,
    ) -> LintResult {
        let (path, text) = match block {
            Block::Unnamed(text) => {
                return self.verify_without_processor(loaded, Text { text, ..file }, config);
            }
            Block::Named { path, text } => (paths::from_native(path), text),
        };
        // ESLint's `filterCodeBlock`. ESLint 8 calls `isTargetPath`, which checks whether it would lint a file with
        // that name in a directory.
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
            return self.verify_without_processor(loaded, Text { path, text, ..file }, config);
        }
        let block = Text {
            path: &path,
            text,
            ..file
        };
        let result = self.verify_routed(loaded, block, &own);
        // The file's other blocks are still linted, so the warning lists only this one.
        if result.needs_another_linter {
            self.needs_eslint.lock().push((path, loaded.flavor));
            return LintResult::default();
        }
        result
    }

    /// ESLint's `_verifyWithFlatConfigArrayAndWithoutProcessors`.
    fn verify_without_processor(
        &self,
        loaded: &Loaded,
        it: Text,
        config: &ResolvedConfig,
    ) -> LintResult {
        match config.route_without_processor(it.path) {
            Route::Eslint if loaded.for_eslint.is_some() => {
                self.verify_with_eslint(loaded, it, config).0
            }
            Route::Language => self.verify_in_config_language(loaded, it, config),
            _ => self.verify_natively(loaded, it, it.path, it.text, config),
        }
    }

    /// Lints with the built-in rules for the language of `config`, which isn't JavaScript.
    fn verify_in_config_language(
        &self,
        loaded: &Loaded,
        it: Text,
        config: &ResolvedConfig,
    ) -> LintResult {
        let len = Some(it.physical_path_len).filter(|len| *len < it.path.len());
        let linted = config.dialect.as_ref().map(|dialect| {
            self.verify_in_language(it.path, len, it.text, (config, dialect), it.fixes)
        });
        match (
            linted.filter(|it| !it.needs_another_linter),
            &loaded.for_eslint,
        ) {
            (Some(result), _) => result,
            (None, Some(_)) => self.verify_with_eslint(loaded, it, config).0,
            (None, None) => needs_eslint(),
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
        let mut needs_another_linter = false;
        let mut lint = |supports_autofix: bool, blocks: Vec<Block>| {
            let file = Text {
                fixes: match supports_autofix && it.fixes != Fixes::Disabled {
                    true => Fixes::ForProcessor,
                    false => Fixes::Disabled,
                },
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
                // An unread result only gets here if the block is the whole file.
                needs_another_linter |= result.needs_another_linter;
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
            Ok(_) if needs_another_linter => needs_eslint(),
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

    /// Lints with ESLint's own `Linter`. Also returns ESLint's `usedDeprecatedRules` as JSON.
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
            without_fixes: it.fixes == Fixes::Disabled,
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
            Err(EslintFailure::NotInstalled) => (needs_eslint(), None),
            Err(EslintFailure::Thrown(message)) => (thrown(message), None),
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
            (Route::Language, _) => self.verify_in_config_language(loaded, it, config),
            // A processor can find a file for a processor in a file, and so on forever. ESLint overflows its stack.
            (Route::Processor, _) if !bun_core::StackCheck::init().is_safe_to_recurse() => {
                LintResult::default()
            }
            (Route::Processor, Some(processor)) => {
                self.verify_with_processor(loaded, it, config, processor)
            }
            (Route::Processor, None) => thrown(no_such_processor(config)),
            (Route::Unsupported, _) if config.route_without_processor(it.path) == Route::Eslint => {
                needs_eslint()
            }
            // Same as for a file of that kind.
            (Route::Unsupported | Route::Eslint, _) => LintResult::default(),
        }
    }

    /// [`Context::verify_text`] for a file with a processor. `loaded` is where `config` came from. `None` if the file
    /// [needs `eslint`](Context::needs_eslint).
    pub(crate) fn verify_processed_text(
        &self,
        loaded: &Loaded,
        path: Vec<u8>,
        path_to_verify: &[u8],
        text: Vec<u8>,
        config: &Arc<ResolvedConfig>,
        on_circular_fixes: &dyn Fn(&[u8]),
    ) -> Option<FileResult> {
        let reads_fixes = self.lint_options().wants_fixes;
        let (mut deprecated, mut needs_another_linter) = (None, false);
        // ESLint reads files as UTF-8, so invalid bytes become U+FFFD.
        let is_read_here = loaded.routes(config, path_to_verify) == Route::Language;
        let text = match is_read_here && !bun_core::strings::is_valid_utf8(&text) {
            true => {
                let mut read = Vec::with_capacity(text.len());
                for chunk in text.utf8_chunks() {
                    read.extend_from_slice(chunk.valid().as_bytes());
                    if !chunk.invalid().is_empty() {
                        read.extend_from_slice("\u{FFFD}".as_bytes());
                    }
                }
                read
            }
            false => text,
        };
        let mut verify = |text: &[u8], _: bool| {
            let it = Text {
                path: path_to_verify,
                physical_path_len: path_to_verify.len(),
                text,
                fixes: Fixes::IfRead,
            };
            let mut result = match loaded.routes(config, path_to_verify) {
                Route::Eslint => {
                    let (result, used) = self.verify_with_eslint(loaded, it, config);
                    deprecated = used;
                    result
                }
                _ => self.verify_routed(loaded, it, config),
            };
            needs_another_linter |= result.needs_another_linter;
            // ESLint and processors always produce fixes, whether or not they're read.
            if !reads_fixes {
                for message in result.messages.iter_mut().chain(&mut result.suppressed) {
                    message.fix = None;
                    message.suggestions = Vec::new();
                }
            }
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
        if needs_another_linter {
            let file = (path_to_verify.to_vec(), loaded.flavor);
            self.needs_eslint.lock().push(file);
            return None;
        }
        result.deprecated = deprecated;
        Some(result)
    }
}
