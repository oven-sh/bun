//! `bun format` for the rules of `bun lint` that hold a file against its formatted text: see [`bun_lint::formats`].
//!
//! `prettier/prettier` stands in for the rule of `eslint-plugin-prettier` 5, which asks the Prettier of the project
//! (`eslint-plugin-prettier.js`, `worker.mjs`). Whatever could make the text another one than that Prettier's is a
//! [`Reason`], never a text.

use super::cli::Options;
use super::config::{self, Configs, Flavor};
use super::files::{Ignored, Kind, Language};
use super::{Failure, Scratches, format, language_of, tailwind};
use crate::run::Environment;
use crate::{fs, paths};
use bun_core::strings;
use bun_format::FormatOptions;
use bun_format::html::Parser;
use bun_format::tailwind::Tailwind;
use bun_lint::formats::{Formats, Formatted, Like, Reason, Request};
use bun_lint::options::Json;
use bun_sema::atom::{Intern, Interner};
use bun_sema::session::Session;
use bun_threading::Guarded;
use std::sync::Arc;

/// The options of a rule, and what is read once for all files that are held against them.
struct Set<'e> {
    like: Like,
    options: Option<Json>,
    uses_configuration: bool,
    file_info_options: Option<Json>,
    /// `Err`: nothing is formatted with them.
    read: Result<Read<'e>, Reason>,
}

struct Read<'e> {
    configs: Configs<'e>,
    ignored: Ignored,
    with_node_modules: bool,
}

/// The names in `plugins`. `Err`: one of them is no name, or that of a plugin that may print the files in another way.
fn plugins_of(json: Option<&Json>) -> Result<Vec<Vec<u8>>, Reason> {
    let plugins = json.and_then(|it| it.get(b"plugins"));
    let names = plugins.and_then(Json::as_array).unwrap_or_default().iter();
    names
        .map(|it| match it.as_str() {
            Some(name) if !config::is_missing_plugin(name) => Ok(name.to_vec()),
            _ => Err(Reason::Plugin),
        })
        .collect()
}

/// The command line of `bun format` that says what the options of the rule say.
fn command_line(request: &Request) -> Result<Options, Reason> {
    let mut options = Options::default();
    let file_info = |key: &[u8]| request.file_info_options.and_then(|it| it.get(key));
    // `resolveConfig(file, { editorconfig: true })`, or nothing.
    if !request.uses_configuration {
        options.ignore_configuration();
    }
    options.with_node_modules = file_info(b"withNodeModules").and_then(Json::as_bool) == Some(true);
    options.ignore_path = match file_info(b"ignorePath") {
        Some(Json::String(path)) => Some(vec![path.clone()]),
        Some(Json::Array(all)) => Some(
            (all.iter())
                .map(|it| it.as_str().map(<[u8]>::to_vec).ok_or(Reason::Option))
                .collect::<Result<_, _>>()?,
        ),
        Some(_) => return Err(Reason::Option),
        // The plugin passes `.prettierignore`, so `.gitignore` does not count.
        None if request.like == Like::InstalledPrettier => Some(vec![b".prettierignore".to_vec()]),
        None => None,
    };
    if request.like == Like::InstalledPrettier {
        options.is_like_oxfmt = Some(false);
    }
    if let Some(of_rule) = request.options {
        options.format = config::as_flags(of_rule).ok_or(Reason::Option)?;
    }
    options.plugins = plugins_of(request.options)?;
    options
        .plugins
        .extend(plugins_of(request.file_info_options)?);
    Ok(options)
}

impl<'e> Set<'e> {
    fn new(request: &Request, environment: &'e Environment<'e>) -> Set<'e> {
        let read = command_line(request).and_then(|options| {
            let configs = Configs::owning(options.clone(), environment);
            // Prettier does not know the configuration files of oxfmt.
            let is_for_another =
                request.like == Like::InstalledPrettier && configs.flavor == Flavor::Oxfmt;
            if is_for_another || configs.check().is_err() {
                return Err(Reason::Configuration);
            }
            Ok(Read {
                ignored: Ignored::new(&options, &environment.cwd, configs.flavor)
                    .map_err(|_| Reason::Configuration)?,
                configs,
                with_node_modules: options.with_node_modules,
            })
        });
        Set {
            like: request.like,
            options: request.options.cloned(),
            uses_configuration: request.uses_configuration,
            file_info_options: request.file_info_options.cloned(),
            read,
        }
    }

    fn is_for(&self, request: &Request) -> bool {
        self.like == request.like
            && self.uses_configuration == request.uses_configuration
            && self.options.as_ref() == request.options
            && self.file_info_options.as_ref() == request.file_info_options
    }
}

/// Whether `eslint-plugin-prettier`, as it is found from `cwd`, and the `prettier` that it loads are of the versions
/// that are followed here.
fn check_packages(cwd: &[u8]) -> Result<(), Reason> {
    let plugin = paths::ancestors(cwd)
        .map(|it| paths::join(it, b"node_modules/eslint-plugin-prettier"))
        .find(|it| fs::is_file(&paths::join(it, b"package.json")))
        .ok_or(Reason::VersionOfPlugin)?;
    if !matches!(
        tailwind::version_of_package(b"eslint-plugin-prettier", cwd),
        Some([5, _, _])
    ) {
        return Err(Reason::VersionOfPlugin);
    }
    // Where a package manager has linked it from, its dependencies are beside it.
    let plugin = fs::real_path(&plugin).unwrap_or(plugin);
    match tailwind::version_of_package(b"prettier", &plugin) {
        Some([3, 9, _]) => Ok(()),
        _ => Err(Reason::Version),
    }
}

/// [`Formats`], for a run of `bun lint`.
pub struct ForRules<'e> {
    environment: &'e Environment<'e>,
    /// There are one or two in a run.
    sets: Guarded<Vec<Arc<Set<'e>>>>,
    scratches: Guarded<Vec<Scratches>>,
    /// See [`check_packages`]. `None`: nobody has asked yet.
    packages: Guarded<Option<Result<(), Reason>>>,
}

impl<'e> ForRules<'e> {
    pub fn new(environment: &'e Environment<'e>) -> ForRules<'e> {
        ForRules {
            environment,
            sets: Guarded::new(Vec::new()),
            scratches: Guarded::new(Vec::new()),
            packages: Guarded::new(None),
        }
    }

    fn set_for(&self, request: &Request) -> Arc<Set<'e>> {
        let mut sets = self.sets.lock();
        if let Some(set) = sets.iter().find(|it| it.is_for(request)) {
            return set.clone();
        }
        let set = Arc::new(Set::new(request, self.environment));
        sets.push(set.clone());
        set
    }

    fn format(&self, request: &Request) -> Result<Formatted, Reason> {
        let is_prettier = request.like == Like::InstalledPrettier;
        if is_prettier {
            let cwd = &self.environment.cwd;
            (*self
                .packages
                .lock()
                .get_or_insert_with(|| check_packages(cwd)))?;
        }
        let set = self.set_for(request);
        let Read {
            configs,
            ignored,
            with_node_modules,
        } = set.read.as_ref().map_err(|it| *it)?;
        let path = request.path_on_disk;
        // `getFileInfo(file).ignored`
        let relative = paths::relative(&self.environment.cwd, path);
        let is_in_node_modules =
            !with_node_modules && strings::split(&relative, b"/").any(|it| it == b"node_modules");
        if is_in_node_modules || ignored.ignores_file(path, &None) {
            return Ok(Formatted::Skipped);
        }
        // A block that a processor has found. The plugin leaves those of a file alone that Prettier formats whole.
        if request.path != path {
            return match Kind::with_options(path, &FormatOptions::default()) {
                Some(
                    Kind::Script
                    | Kind::Markdown
                    | Kind::Mdx
                    | Kind::Html(Parser::Html | Parser::Vue | Parser::Angular),
                ) => Ok(Formatted::Skipped),
                _ => Err(Reason::Language),
            };
        }
        let unreadable = |_| Reason::Configuration;
        let scope = configs
            .for_directory(paths::dirname(path))
            .map_err(unreadable)?;
        if ignored.ignores_file(path, configs.ignores_of(&scope)) {
            return Ok(Formatted::Skipped);
        }
        if is_prettier && configs.is_oxfmt_for(&scope) {
            return Err(Reason::Configuration);
        }
        if !configs.missing_plugins(&scope, path).is_empty() {
            return Err(Reason::Plugin);
        }
        match language_of(configs, &scope, path) {
            Language::Supported => {}
            // `parser: inferredParser ?? 'babel'`
            Language::Unknown if is_prettier => {}
            Language::Unknown | Language::Other => return Err(Reason::Language),
        }
        let mut resolved = configs.options_for(&scope, path).map_err(unreadable)?;
        if !configs.unsupported_options.lock().is_empty() {
            return Err(Reason::Option);
        }
        if Kind::with_options(path, &resolved.options).is_none() {
            let _ = resolved.options.set(b"parser", b"babel");
        }
        let kind = Kind::with_options(path, &resolved.options);
        tailwind::only_where_sorted(&mut resolved.options, kind);
        let mut scratch = self.scratches.lock().pop().unwrap_or_default();
        let verifies = true;
        let names = Session::new();
        let names = (&Interner::new_in(&names) as &dyn Intern, &names);
        let mut formatted = format(path, request.text, &resolved, names, &mut scratch, verifies);
        // Tailwind is asked in a process of its own, which takes about a second. `bun format` asks once, about all
        // files. Here it would be once for each file that has a class that no file before it has.
        if (resolved.options.tailwind.as_deref()).is_some_and(Tailwind::has_missed) {
            formatted = Err(Failure::Bug("the order of the classes is not known"));
        }
        self.scratches.lock().push(scratch);
        match formatted {
            Ok((text, _)) if text == request.text => Ok(Formatted::Same),
            Ok((text, _)) => Ok(Formatted::Text(text)),
            Err(Failure::Syntax(_)) => Err(Reason::SyntaxError),
            Err(Failure::Bug(_) | Failure::Loss(_) | Failure::Unread(_)) => Err(Reason::Refused),
        }
    }
}

impl Formats for ForRules<'_> {
    fn formatted(&self, request: &Request) -> Formatted {
        self.format(request).unwrap_or_else(Formatted::NotNative)
    }
}
