//! Lints a file for which the configuration has a `processor`: ESLint's `_verifyWithFlatConfigArrayAndProcessor`.
//!
//! The processor takes blocks out of the file. Each has a path of its own, `a.md/0_example.js`, hence a configuration of its own, and
//! is linted like a file at that path.

use crate::configs::Loaded;
use crate::lint::Context;
use crate::paths;
use crate::results::FileResult;
use bun_lint::js_plugin::{Block, Processor, Route, read_messages, write_messages};
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

/// `path.extname`
fn extname(path: &[u8]) -> &[u8] {
    let name = paths::basename(path);
    match bun_core::strings::last_index_of_char(name, b'.') {
        Some(at) if at > 0 => &name[at..],
        _ => b"",
    }
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
        file: Text,
        path: &[u8],
        text: &[u8],
        config: &ResolvedConfig,
    ) -> LintResult {
        self.verify_block_natively(
            path,
            file.physical_path_len,
            text,
            config,
            file.without_fixes,
        )
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
                return self.verify_natively(file, file.path, text, config);
            }
            Block::Named { path, text } => (paths::from_native(path), text),
        };
        // ESLint's `filterCodeBlock`.
        let FileConfig::Matched(own) = loaded.config.get(self.linter.registry(), &path) else {
            return LintResult::default();
        };
        if text == file.text && extname(&path) == extname(file.path) {
            return self.verify_natively(file, &path, text, config);
        }
        let block = Text {
            path: &path,
            text,
            depth: file.depth + 1,
            ..file
        };
        self.verify_routed(loaded, block, &own)
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

    /// ESLint's `_verifyWithFlatConfigArray`.
    fn verify_routed(&self, loaded: &Loaded, it: Text, config: &ResolvedConfig) -> LintResult {
        if let Some(error) = &config.error {
            return thrown(error.clone());
        }
        match (config.route(it.path), &config.processor_location) {
            (Route::Native, _) => self.verify_natively(it, it.path, it.text, config),
            (Route::Processor, _) if it.depth >= MAX_DEPTH => LintResult::default(),
            (Route::Processor, Some(processor)) => {
                self.verify_with_processor(loaded, it, config, processor)
            }
            (Route::Processor, None) => thrown(no_such_processor(config)),
            // As a file of that kind.
            (Route::Unsupported, _) => LintResult::default(),
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
        let mut verify = |text: &[u8]| {
            let it = Text {
                path: path_to_verify,
                physical_path_len: path_to_verify.len(),
                text,
                without_fixes,
                depth: 0,
            };
            self.verify_routed(loaded, it, config)
        };
        self.verify_text_by(
            path,
            path_to_verify,
            text,
            config,
            on_circular_fixes,
            &mut verify,
        )
    }
}
