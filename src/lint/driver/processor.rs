//! Lints a file whose config has a `processor`: ESLint's `_verifyWithFlatConfigArrayAndProcessor`.
//!
//! The processor extracts blocks from the file. Each block has its own path, like `a.md/0_example.js`, so it has its
//! own config, and it's linted like a file at that path.

use crate::configs::{Flavor, Loaded};
use crate::lint::{Context, Fixes};
use crate::paths;
use crate::results::FileResult;
use crate::svelte::{NeedsServices, Residual};
use bun_lint::js_plugin::{
    self, Block, EslintFailure, Processor, Route, read_messages, write_messages,
};
use bun_lint::linter::{Again, FileConfig, LintMessage, LintResult, ResolvedConfig, RuleId};
use std::sync::Arc;

#[derive(Copy, Clone)]
struct Text<'t> {
    /// ESLint's `filename`.
    path: &'t [u8],
    /// How many leading bytes of `path` are the path of the file on disk.
    physical_path_len: usize,
    text: &'t [u8],
    fixes: Fixes,
    /// Only these rules run. See [`js_plugin::Text::only`].
    only: Option<&'t Residual>,
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
        self.verify_block_if_read(path, len, text, config, (fixes, None))
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
            only: it.only.map(Residual::names),
            without_types: it.only.is_some_and(|it| !it.is_typed),
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
            Err(EslintFailure::Thrown(message, thrown_while)) => (
                LintResult {
                    thrown: Some(message),
                    thrown_while,
                    ..LintResult::default()
                },
                None,
            ),
        }
    }

    /// Lints `text` as the component at `path`, the way ESLint does with svelte-eslint-parser: the native rules on the
    /// program it's lowered to, and `residual` in ESLint's own `Linter`, merged before the file's comments are applied.
    /// eslint-plugin-svelte's processor runs natively ([`crate::svelte::processes_here`]); a component with any other
    /// `processor` isn't linted here ([`crate::svelte::route`]). If the component isn't read here the way Svelte reads
    /// it, ESLint lints it with all its rules, through the configured processor. For `again`, see
    /// [`LintOptions::again`]. If a hosted rule [needs services](crate::svelte::NeedsServices) on the component, ESLint
    /// lints it again with all of them.
    ///
    /// [`LintOptions::again`]: bun_lint::linter::LintOptions::again
    pub(crate) fn verify_component_with(
        &self,
        loaded: &Loaded,
        path: &[u8],
        text: &[u8],
        config: &Arc<ResolvedConfig>,
        residual: Option<&Residual>,
        again: Option<Again<'_>>,
    ) -> LintResult {
        // `only` holds the rules that run. `None` means all of them.
        let lint_with = |fixes: Fixes, only: Option<&Residual>, text: &[u8]| {
            let it = Text {
                path,
                physical_path_len: path.len(),
                text,
                fixes,
                only,
            };
            self.verify_with_eslint(loaded, it, config).0
        };
        let processor = (config.processor_location.as_deref())
            .filter(|_| crate::svelte::processes_here(config));
        let hand_off = |text: &[u8]| match processor {
            Some(processor) => {
                self.verify_in_processor(processor, path, text, config, &|fixes, text| {
                    lint_with(fixes, None, text)
                })
            }
            None => lint_with(Fixes::IfRead, None, text),
        };
        let hand_off =
            (loaded.for_eslint.as_ref()).map(|_| &hand_off as &dyn Fn(&[u8]) -> LintResult);
        // A hosted rule that needs services asks before ESLint has run anything on `text`, which is then linted again,
        // with all of them in ESLint.
        let verify = |residual: Option<&Residual>| {
            let lint = |text: &[u8]| lint_with(Fixes::IfRead, residual, text);
            let residual = residual.map(|it| (it, &lint as &dyn Fn(&[u8]) -> LintResult));
            self.verify_component(path, text, config, again, residual, hand_off)
        };
        let mut result = match crate::svelte::is_reproduced(text) {
            true => verify(residual).unwrap_or_else(|NeedsServices| {
                let residual = Residual::with_hosted(residual, config);
                // With a residual no rule runs in the host, so none asks for services there.
                verify(Some(&residual)).unwrap_or_default()
            }),
            // A fix can turn it into a component that isn't read the same way here, which ESLint then lints, like it
            // lints the file.
            false => match hand_off {
                Some(hand_off) => hand_off(text),
                None => needs_eslint(),
            },
        };
        // ESLint and a processor produce fixes even if nothing reads them, so they're dropped here when unwanted.
        if !self.lint_options().wants_fixes {
            for message in result.messages.iter_mut().chain(&mut result.suppressed) {
                message.fix = None;
                message.suggestions = Vec::new();
            }
        }
        result
    }

    /// Passes the component `text` at `path` to `processor` in JavaScript, and lints the blocks it finds with `verify`,
    /// which is told whether fixes are applied.
    fn verify_in_processor(
        &self,
        processor: &Processor,
        path: &[u8],
        text: &[u8],
        config: &ResolvedConfig,
        verify: &(dyn Fn(Fixes, &[u8]) -> LintResult + Sync),
    ) -> LintResult {
        let shown = paths::to_native(path.to_vec());
        let mut lint = |supports_autofix: bool, blocks: Vec<Block>| {
            let fixes = match supports_autofix {
                true => Fixes::ForProcessor,
                false => Fixes::Disabled,
            };
            let mut lists = vec![b'['];
            for (i, block) in blocks.iter().enumerate() {
                if i > 0 {
                    lists.push(b',');
                }
                // The processor returns the component itself.
                let (Block::Unnamed(text) | Block::Named { text, .. }) = block;
                let result = verify(fixes, text);
                if let Some(thrown) = result.thrown {
                    return Err(thrown);
                }
                write_messages(&mut lists, &result.messages, &result.suppressed, text);
            }
            lists.push(b']');
            Ok(lists)
        };
        match self.js_plugins.process(processor, &shown, text, &mut lint) {
            Ok(messages) => {
                let (messages, suppressed) =
                    read_messages(&messages, text, &|id| self.find_rule(config, id));
                LintResult {
                    messages,
                    suppressed,
                    ..LintResult::default()
                }
            }
            Err(message) => thrown(message),
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

    /// `text` of the `.svelte.js` or `.svelte.ts` file at `path`: see [`Context::lint_script`]. ESLint lints all of it
    /// if the native program may be misread.
    pub(crate) fn verify_script_with(
        &self,
        loaded: &Loaded,
        path: &[u8],
        text: &[u8],
        config: &ResolvedConfig,
        residual: &Residual,
    ) -> LintResult {
        let it = Text {
            path,
            physical_path_len: path.len(),
            text,
            fixes: Fixes::IfRead,
            only: Some(residual),
        };
        let linted = self.verify_with_eslint(loaded, it, config).0;
        // ESLint reports nothing else for a file its parser rejects.
        if linted.thrown.is_some() || linted.messages.iter().any(|it| it.is_fatal) {
            return linted;
        }
        // Comments about the rules that only ESLint runs are applied by the native rules.
        let reported: Vec<LintMessage> = (linted.messages.iter().chain(&linted.suppressed))
            .filter(|it| it.rule_id.is_some())
            .cloned()
            .collect();
        let how = (Fixes::IfRead, Some(&reported[..]));
        (self.verify_block_if_read(path, path.len(), text, config, how)).unwrap_or_else(|| {
            let it = Text { only: None, ..it };
            self.verify_with_eslint(loaded, it, config).0
        })
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
                only: None,
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
