//! Lints the text of a document the way `bun lint --stdin --stdin-filename <path>` does in the workspace folder. What is
//! read of the configuration is kept from one text to the next.

use crate::cli::Options;
use crate::configs::{Flavor, Loader};
use crate::inferred::Inferred;
use crate::lint::Context;
use crate::results::FileResult;
use crate::run::{Environment, Fatal, Pool, Run, Timing, lint_again};
use crate::{Linter, discover, paths};
use bun_lint::js_plugin::Host;
use bun_threading::Guarded;

/// How a text is linted.
#[derive(Copy, Clone, Default)]
pub(crate) struct How {
    /// The rules that need types run, if the configuration asks for them.
    pub(crate) with_types: bool,
    /// As `--fix-dry-run`: [`FileResult::written`] is the text with all fixes.
    pub(crate) fixes: bool,
}

/// How much a line for the user matters.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum Weight {
    Warning,
    Note,
}

/// The configurations of a workspace folder, as they were when they were first asked for.
pub(crate) struct Session<'s> {
    options: &'s Options,
    environment: &'s Environment<'s>,
    linter: &'s Linter,
    pool: &'s Pool,
    js_plugins: &'s Host<'s>,
    loader: &'s Loader<'s>,
}

/// Calls `then` with a session for `environment.cwd`.
pub(crate) fn with_session<R>(
    options: &Options,
    environment: &Environment,
    then: impl FnOnce(&Session) -> R,
) -> R {
    let registry = crate::rules::registry();
    let linter = Linter::new(registry.answering_for(options.native_plugin_rules.clone()));
    bun_sema_driver::use_a_pool_of_their_own("Bun Lint");
    let pool = Pool::new(options.threads);
    let cwd = paths::to_native(environment.cwd.clone());
    let js_plugins = Host::with_engine(environment.js_engine, &cwd);
    let loader = Loader::new(&linter, options, environment, &js_plugins);
    then(&Session {
        options,
        environment,
        linter: &linter,
        pool: &pool,
        js_plugins: &js_plugins,
        loader: &loader,
    })
}

impl Session<'_> {
    /// Why nothing can be linted in the folder.
    pub(crate) fn refusal(&self) -> Option<Vec<u8>> {
        if let Some((of_eslint, of_oxlint)) = self.loader.undecided() {
            let (of_eslint, of_oxlint) = (paths::basename(of_eslint), paths::basename(of_oxlint));
            return Some(
                [
                    b"Found both ",
                    of_eslint,
                    b" and ",
                    of_oxlint,
                    b"\n  Choose one with flavor = \"eslint\" or flavor = \"oxlint\" under [lint] in bunfig.toml",
                ]
                .concat(),
            );
        }
        let _ = self.loader.for_directory(&self.environment.cwd);
        self.loader.refused().map(<[u8]>::to_vec)
    }

    /// What there is to tell the user since this was last asked.
    pub(crate) fn notes(&self) -> Vec<(Weight, Vec<u8>)> {
        let take = |lines: &Guarded<Vec<Vec<u8>>>| std::mem::take(&mut *lines.lock());
        let warnings = take(&self.loader.warnings).into_iter();
        let warnings = warnings.chain(take(&self.loader.unsupported));
        let notes = take(&self.loader.advice).into_iter();
        (warnings.map(|it| (Weight::Warning, it)))
            .chain(notes.map(|it| (Weight::Note, it)))
            .collect()
    }

    /// Whether `result`, which is about the file at `path`, lacks what the rules that need types have to say.
    pub(crate) fn wants_types(&self, path: &[u8], result: &FileResult) -> bool {
        let (Some(linted), Ok(loaded)) = (
            result.linted.as_ref().filter(|_| !result.had_types),
            self.loader.for_directory(paths::dirname(path)),
        ) else {
            return false;
        };
        self.loader.wants_types(&loaded, &linted.config)
            && linted.config.has_enabled(|it| it.requires_types)
    }

    /// `None`: the file at `path` is not one to lint.
    pub(crate) fn lint(
        &self,
        path: &[u8],
        text: Vec<u8>,
        how: How,
    ) -> Result<Option<FileResult>, Fatal> {
        let (environment, loader, pool) = (self.environment, self.loader, self.pool);
        let options = &Options {
            stdin: true,
            stdin_filename: Some(paths::to_native(path.to_vec())),
            fix_dry_run: how.fixes,
            warn_ignored: false,
            ..self.options.clone()
        };
        let of_cwd = loader.for_directory(&environment.cwd).ok();
        // What the other files export is read anew: they change too.
        let store = bun_lint_graph::Store::new(&environment.cwd);
        let modules = bun_lint_graph::Graph::new(&store);
        modules.list_files_by(Box::new(|patterns: &[&[u8]], extensions: &[&[u8]]| {
            let of_the_run = (self.linter, environment, self.js_plugins);
            discover::list_as_eslint_8(of_the_run, pool, patterns, extensions)
        }));
        // Every name that is ever typed would stay in one that is kept.
        let names = [bun_sema::session::Session::new()];
        let atoms = bun_sema::atom::InternerPerThread::new_in(&names);
        let memory = bun_sema::session::Session::new();
        let (skipped_in_comments, out_of_stack) =
            (Guarded::new(Vec::new()), Guarded::new(Vec::new()));
        let (broken_fixes, handed_back) = (Guarded::new(Vec::new()), Guarded::new(Vec::new()));
        let (unread, invalid_tsconfigs) =
            (Guarded::new(Vec::new()), Guarded::new(Default::default()));
        let formatter = crate::fmt::ForRules::new(environment, options.of_bun_format.as_deref());
        let by_options = options.infer_globals.is_none() && options.infers_globals_by_options;
        let inferred = (options.infer_globals == Some(true) || by_options)
            .then(|| Inferred::new(environment, pool.threads(), by_options));
        let timing = Timing::default();
        let context = Context {
            skipped_in_comments: &skipped_in_comments,
            out_of_stack: &out_of_stack,
            broken_fixes: &broken_fixes,
            handed_back: &handed_back,
            unread: &unread,
            invalid_tsconfigs: &invalid_tsconfigs,
            memory: &memory,
            atoms: &atoms,
            linter: self.linter,
            options,
            cwd: &environment.cwd,
            of_oxlint: (of_cwd.as_deref()).filter(|it| it.flavor == Flavor::Oxlint),
            checks_types: false,
            keeps_text: false,
            reads_fixes: true,
            reads_texts_of_fixes: true,
            reads_help: false,
            help_on_demand: false,
            reads_suppressions: false,
            js_plugins: self.js_plugins,
            modules: &modules,
            formatter: &formatter,
            inferred: inferred.as_ref(),
            timing: &timing,
        };
        let run = Run::new(options, environment);
        let mut results = run
            .lint_text(loader, &context, text, how.with_types)?
            .results;
        lint_again(&context, pool, &mut results)?;
        match results.iter_mut().find_map(|it| it.thrown.take()) {
            Some(thrown) => Err(Fatal(thrown)),
            None => Ok(results.pop()),
        }
    }
}
