//! Lints the text of a document the way `bun lint --stdin --stdin-filename <path>` does in the workspace folder. What is
//! read of the configuration is kept from one text to the next.

use crate::cli::Options;
use crate::configs::{Flavor, Loader};
use crate::inferred::Inferred;
use crate::lint::Context;
use crate::results::FileResult;
use crate::run::{Environment, Fatal, Pool, Run, Timing};
use crate::{Linter, discover, paths};
use bun_lint::js_plugin::Host;
use bun_lint::linter::Registry;
use bun_threading::Guarded;

/// How a text is linted.
#[derive(Copy, Clone, Default)]
pub(crate) struct How {
    /// The rules that need types run, if the configuration asks for them.
    pub(crate) with_types: bool,
    /// As `--fix-dry-run`: [`FileResult::fixed_text`] or [`FileResult::text`] is the text with all fixes.
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
    let registry = Registry::new(&[
        bun_lint_eslint::RULES,
        bun_lint_typescript::RULES,
        bun_lint_plugins::RULES,
        bun_lint_unicorn::RULES,
        bun_lint_react::RULES,
        bun_lint_jest::RULES,
        bun_lint_json::RULES,
        bun_lint_markdown::RULES,
    ])
    .with_languages(crate::rules::LANGUAGES);
    let linter = Linter::new(registry.with_native_plugins(options.native_plugin_rules.clone()));
    bun_sema_driver::use_dedicated_pool("Bun Lint");
    let pool = Pool::new(options.threads);
    let cwd = paths::to_native(environment.cwd.clone());
    let js_plugins = Host::with_engine(environment.js_engine, &cwd);
    let loader = Loader::new(&linter, options, environment, &js_plugins);
    if let Some((eslint_path, oxlint_path)) = loader.ignored_eslint_config() {
        loader.advise(
            [
                b"Using ",
                &oxlint_path[..],
                b". ",
                &eslint_path[..],
                b" is ignored. Use --config to pick it.",
            ]
            .concat(),
        );
    }
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
        let (linter, js_plugins) = (self.linter, self.js_plugins);
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
            let of_the_run = (linter, environment, js_plugins);
            discover::list_as_eslint_8(of_the_run, pool, patterns, extensions)
        }));
        // Every name that is ever typed would stay in one that is kept.
        let names = [bun_sema::session::Session::new()];
        let atoms = bun_sema::atom::InternerPerThread::new_in(&names);
        let memory = bun_sema::session::Session::new();
        let (skipped_in_comments, out_of_stack) =
            (Guarded::new(Vec::new()), Guarded::new(Vec::new()));
        let (without_include, needs_eslint) = (Guarded::new(Vec::new()), Guarded::new(Vec::new()));
        let (broken_fixes, handed_back) = (Guarded::new(Vec::new()), Guarded::new(Vec::new()));
        let (unread, invalid_tsconfigs) =
            (Guarded::new(Vec::new()), Guarded::new(Default::default()));
        let formatter =
            crate::fmt::ForRules::new(environment, options.bun_format_defaults.as_deref());
        let by_options = options.infer_globals.is_none() && options.infers_globals_by_options;
        let inferred = (options.infer_globals == Some(true) || by_options)
            .then(|| Inferred::new(environment, pool.threads(), by_options));
        let timing = Timing::default();
        let context = Context {
            skipped_in_comments: &skipped_in_comments,
            out_of_stack: &out_of_stack,
            without_include: &without_include,
            broken_fixes: &broken_fixes,
            handed_back: &handed_back,
            unread: &unread,
            needs_eslint: &needs_eslint,
            invalid_tsconfigs: &invalid_tsconfigs,
            memory: &memory,
            atoms: &atoms,
            linter,
            options,
            cwd: &environment.cwd,
            only: None,
            oxlint_config: (of_cwd.as_deref()).filter(|it| it.flavor == Flavor::Oxlint),
            checks_types: false,
            keeps_text: false,
            reads_fixes: true,
            reads_fix_texts: true,
            reads_help: false,
            help_on_demand: false,
            reads_suppressions: false,
            js_plugins,
            modules: &modules,
            formatter: &formatter,
            inferred: inferred.as_ref(),
            timing: &timing,
        };
        let run = Run::new(options, environment);
        let mut results = run
            .lint_text(loader, &context, text, how.with_types)?
            .results;
        // Rules that look at several files now revisit the text, as `Run::execute` does with the files.
        let again = modules.complete(&|count, work| pool.for_each(count, 1, work));
        for result in &mut results {
            if again.contains(&paths::from_native(&result.path)) {
                context.lint_again(result)?;
            }
        }
        match results.iter_mut().find_map(|it| it.thrown.take()) {
            Some(thrown) => Err(Fatal(thrown)),
            None => Ok(results.pop()),
        }
    }
}
