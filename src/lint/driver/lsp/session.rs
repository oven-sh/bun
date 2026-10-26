//! Lints the text of a document the way `bun lint --stdin --stdin-filename <path>` does in the workspace folder. What is
//! read of the configuration is kept from one text to the next.

use crate::cli::Options;
use crate::configs::{Flavor, Loader};
use crate::inferred::Inferred;
use crate::lint::Context;
use crate::results::FileResult;
use crate::run::{
    Environment, Fatal, Linted, NotBuiltIn, Pool, Run, Sinks, Timing, checks_types, store_for,
};
use crate::{Linter, discover, paths};
use bun_lint::js_plugin::Host;
use bun_lint::linter::{LintMessage, apply_fixes};
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
    /// What the last lint left to tell, until [`Session::notes`] takes it.
    sinks: &'s Sinks,
    /// `bun fmt` for the rules that compare a file with its formatted text. What it reads of the Prettier
    /// configuration is kept from one lint to the next.
    formatter: &'s crate::fmt::ForRules<'s>,
    /// With `--infer-globals`, the globals of the programs of the texts linted so far. A program's libraries and types
    /// are loaded once per session, not once per lint.
    inferred: Option<&'s Inferred<'s>>,
}

/// Calls `then` with a session for `environment.cwd`. `js_plugins` is the host of `environment.js_engine`, which
/// outlives the session: the realms keep what it has told them.
pub(crate) fn with_session<R>(
    options: &Options,
    environment: &Environment,
    js_plugins: &Host,
    then: impl FnOnce(&Session) -> R,
) -> R {
    // The thread of a root is a plain one: the stack bounds of the recursion guard are set here.
    bun_core::Output::Source::configure_thread();
    let registry = crate::rules::registry();
    let linter = Linter::new(registry.with_native_plugins(options.native_plugin_rules.clone()));
    bun_sema_driver::use_dedicated_pool("Bun Lint");
    let pool = Pool::new(options.threads);
    let loader = Loader::new(&linter, options, environment, js_plugins);
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
    let sinks = Sinks::default();
    let formatter = crate::fmt::ForRules::new(environment, options.bun_format_defaults.as_deref());
    let by_options = options.infer_globals.is_none() && options.infers_globals_by_options;
    let inferred = (options.infer_globals == Some(true) || by_options)
        .then(|| Inferred::new(environment, pool.threads(), by_options));
    then(&Session {
        options,
        environment,
        linter: &linter,
        pool: &pool,
        js_plugins,
        loader: &loader,
        sinks: &sinks,
        formatter: &formatter,
        inferred: inferred.as_ref(),
    })
}

impl Session<'_> {
    /// Why nothing can be linted in the folder: what `bun lint` there refuses before it lints.
    pub(crate) fn refusal(&self) -> Option<Vec<u8>> {
        let of_cwd = self.loader.for_directory(&self.environment.cwd).ok();
        if let Some(refused) = self.loader.refused() {
            return Some(refused.to_vec());
        }
        if let Some(Err(Fatal(why))) = of_cwd.as_ref().map(|it| self.loader.check_wildcards(it)) {
            return Some(why);
        }
        let refused = checks_types(self.options, of_cwd.as_deref()).err();
        refused.map(<[u8]>::to_vec)
    }

    /// Whether the type errors of every file are reported, as `bun lint --type-check` does.
    fn checks_types(&self) -> bool {
        let of_cwd = self.loader.for_directory(&self.environment.cwd).ok();
        checks_types(self.options, of_cwd.as_deref()).unwrap_or(false)
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
            && (linted.config.has_enabled(|it| it.triggers_type_check()) || self.checks_types())
    }

    /// `text` with the fixes of `messages`, its problems, applied once: the first pass of `bun lint --fix`. `None`:
    /// none applies.
    pub(crate) fn fix_once(&self, text: &[u8], messages: &[LintMessage]) -> Option<Vec<u8>> {
        let of_cwd = self.loader.for_directory(&self.environment.cwd).ok();
        let is_oxlint = of_cwd.is_some_and(|it| it.flavor == Flavor::Oxlint);
        let should_fix = |it: &LintMessage| crate::lint::should_fix(self.options, is_oxlint, it);
        let fixed = apply_fixes(text, messages.to_vec(), &should_fix);
        fixed.is_fixed.then_some(fixed.output)
    }

    /// Lints the text of the file at `path`. `files == 0`: it is not one to lint, and `results` is empty. What the
    /// lint leaves to tell the user is in [`Session::notes`] after this.
    pub(crate) fn lint(&self, path: &[u8], text: Vec<u8>, how: How) -> Result<Linted, Fatal> {
        let (environment, loader, pool) = (self.environment, self.loader, self.pool);
        let (linter, js_plugins, sinks) = (self.linter, self.js_plugins, self.sinks);
        let options = &Options {
            stdin: true,
            stdin_filename: Some(paths::to_native(path.to_vec())),
            fix: false,
            fix_dry_run: how.fixes,
            warn_ignored: false,
            ..self.options.clone()
        };
        let of_cwd = loader.for_directory(&environment.cwd).ok();
        let is_native = of_cwd
            .as_ref()
            .is_some_and(|it| it.flavor == Flavor::BuiltIn);
        // What the other files export is read anew: they change too.
        let store = store_for(&environment.cwd, is_native, options);
        let modules = bun_lint_graph::Graph::new(&store);
        modules.list_files_by(Box::new(|patterns: &[&[u8]], extensions: &[&[u8]]| {
            let of_the_run = (linter, environment, js_plugins);
            discover::list_as_eslint_8(of_the_run, pool, patterns, extensions)
        }));
        // Every name that is ever typed would stay in one that is kept.
        let names = [bun_sema::session::Session::new()];
        let atoms = bun_sema::atom::InternerPerThread::new_in(&names);
        let memory = bun_sema::session::Session::new();
        let timing = Timing::default();
        let context = Context {
            skipped_in_comments: &sinks.skipped_in_comments,
            out_of_stack: &sinks.out_of_stack,
            without_include: &sinks.without_include,
            broken_fixes: &sinks.broken_fixes,
            handed_back: &sinks.handed_back,
            unread: &sinks.unread,
            needs_eslint: &sinks.needs_eslint,
            invalid_tsconfigs: &sinks.invalid_tsconfigs,
            memory: &memory,
            atoms: &atoms,
            linter,
            options,
            cwd: &environment.cwd,
            only: None,
            oxlint_config: (of_cwd.as_deref()).filter(|it| it.flavor == Flavor::Oxlint),
            checks_types: self.checks_types(),
            keeps_text: false,
            reads_fixes: true,
            reads_fix_texts: true,
            reads_help: false,
            help_on_demand: false,
            reads_suppressions: false,
            js_plugins,
            modules: &modules,
            formatter: self.formatter,
            inferred: self.inferred,
            timing: &timing,
        };
        let run = Run::new(options, environment);
        let linted = (|| -> Result<Linted, Fatal> {
            let editor_text = text.clone();
            let mut linted = run.lint_text(loader, &context, text, how.with_types)?;
            // Rules that look at several files now revisit the text, as `Run::execute` does with the files. It is the
            // editor's text, not the file's: a result without one would be read from the file.
            let again = modules.complete(&|count, work| pool.for_each(count, 1, work));
            for result in &mut linted.results {
                if again.contains(&paths::from_native(&result.path)) {
                    result.text.get_or_insert_with(|| editor_text.clone());
                    context.lint_again(result)?;
                }
            }
            match linted.results.iter_mut().find_map(|it| it.thrown.take()) {
                Some(thrown) => Err(Fatal(thrown)),
                None => Ok(linted),
            }
        })();
        // Told the way the one-shot tells them, through the loader, which `notes` reads.
        sinks.report(
            loader,
            options,
            &environment.cwd,
            of_cwd.as_ref().map(|it| it.flavor),
            &mut NotBuiltIn::default(),
            &mut |text| loader.warn(&[text]),
        );
        linted
    }
}
