//! Runs `bun fmt` for the `bun lint` rules that compare a file with its formatted text. See [`bun_lint::formats`].
//!
//! `prettier/prettier` replaces the `eslint-plugin-prettier` 5 rule, which calls the project's Prettier
//! (`eslint-plugin-prettier.js`, `worker.mjs`). Anything that could make our output differ from that Prettier's returns
//! a [`Reason`] instead of text.

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
use bun_lint::formats::{Formats, Formatted, FormatterKind, Reason, Request};
use bun_lint::options::Json;
use bun_sema::atom::{Intern, Interner};
use bun_sema::session::Session;
use bun_threading::Guarded;
use std::sync::Arc;

/// One rule's options, plus the state that's read once and shared by every file checked with them.
struct Set<'e> {
    formatter_kind: FormatterKind,
    options: Option<Json>,
    uses_configuration: bool,
    file_info_options: Option<Json>,
    /// `Err` means no file can be formatted with these options.
    read: Result<Read<'e>, Reason>,
}

struct Read<'e> {
    configs: Configs<'e>,
    ignored: Ignored,
    with_node_modules: bool,
    /// `allowUnsupported` from `[fmt]`. Only `bun/format` uses it.
    allows_unsupported: bool,
}

/// Returns the names in `plugins`. `Err` if an entry isn't a string or is a plugin that could change how files print.
fn plugin_names(json: Option<&Json>) -> Result<Vec<Vec<u8>>, Reason> {
    let plugins = json.and_then(|it| it.get(b"plugins"));
    let names = plugins.and_then(Json::as_array).unwrap_or_default().iter();
    names
        .map(|it| match it.as_str() {
            Some(name) if !config::is_missing_plugin(name) => Ok(name.to_vec()),
            _ => Err(Reason::Plugin),
        })
        .collect()
}

/// Builds the `bun fmt` command line equivalent to the rule's options. `defaults` supplies `bun fmt`'s own flags, which
/// Prettier doesn't have.
fn command_line(request: &Request, defaults: Option<&Options>) -> Result<Options, Reason> {
    let defaults = defaults.filter(|_| request.formatter_kind == FormatterKind::BunFormat);
    let mut options = defaults.cloned().unwrap_or_default();
    let file_info = |key: &[u8]| request.file_info_options.and_then(|it| it.get(key));
    // `resolveConfig(file, { editorconfig: true })`, or no config at all.
    if !request.uses_configuration {
        options.ignore_configuration();
    }
    if let Some(with_node_modules) = file_info(b"withNodeModules") {
        options.with_node_modules = with_node_modules.as_bool() == Some(true);
    }
    options.ignore_path = match file_info(b"ignorePath") {
        Some(Json::String(path)) => Some(vec![path.clone()]),
        Some(Json::Array(all)) => Some(
            (all.iter())
                .map(|it| it.as_str().map(<[u8]>::to_vec).ok_or(Reason::Option))
                .collect::<Result<_, _>>()?,
        ),
        Some(_) => return Err(Reason::Option),
        // The plugin passes `.prettierignore`, so `.gitignore` isn't read.
        None if request.formatter_kind == FormatterKind::InstalledPrettier => {
            Some(vec![b".prettierignore".to_vec()])
        }
        None => options.ignore_path.take(),
    };
    if request.formatter_kind == FormatterKind::InstalledPrettier {
        options.is_like_oxfmt = Some(false);
    }
    if let Some(rule_options) = request.options {
        let rule_flags = config::as_flags(rule_options).ok_or(Reason::Option)?;
        (options.format).retain(|default| !rule_flags.iter().any(|it| it.0 == default.0));
        options.format.extend(rule_flags);
    }
    options.plugins = plugin_names(request.options)?;
    options
        .plugins
        .extend(plugin_names(request.file_info_options)?);
    Ok(options)
}

impl<'e> Set<'e> {
    fn new(
        request: &Request,
        environment: &'e Environment<'e>,
        defaults: Option<&Options>,
    ) -> Set<'e> {
        let read = command_line(request, defaults).and_then(|options| {
            let configs = Configs::owning(options.clone(), environment);
            // Prettier doesn't read oxfmt's config files.
            let is_oxfmt_config = request.formatter_kind == FormatterKind::InstalledPrettier
                && configs.flavor == Flavor::Oxfmt;
            if is_oxfmt_config || configs.check().is_err() {
                return Err(Reason::Configuration);
            }
            Ok(Read {
                ignored: Ignored::new(
                    &options,
                    &environment.cwd,
                    configs.flavor,
                    configs.is_native(),
                )
                .map_err(|_| Reason::Configuration)?,
                configs,
                with_node_modules: options.with_node_modules,
                allows_unsupported: request.formatter_kind == FormatterKind::BunFormat
                    && options.allow_unsupported,
            })
        });
        Set {
            formatter_kind: request.formatter_kind,
            options: request.options.cloned(),
            uses_configuration: request.uses_configuration,
            file_info_options: request.file_info_options.cloned(),
            read,
        }
    }

    fn is_for(&self, request: &Request) -> bool {
        self.formatter_kind == request.formatter_kind
            && self.uses_configuration == request.uses_configuration
            && self.options.as_ref() == request.options
            && self.file_info_options.as_ref() == request.file_info_options
    }
}

/// Returns the directory and version of the `eslint-plugin-prettier` package that contains the file `module`.
fn plugin_containing(module: &[u8]) -> Option<(Vec<u8>, [u64; 3])> {
    paths::ancestors(paths::dirname(module)).find_map(|directory| {
        let package = fs::read(&paths::join(directory, b"package.json")).ok()?;
        let package = bun_lint::json::parse(&package)?;
        let is_the_plugin = package.get(b"name")?.as_str()? == b"eslint-plugin-prettier";
        let version = tailwind::version_in(&package).filter(|_| is_the_plugin)?;
        Some((directory.to_vec(), version))
    })
}

/// Same, for the package that resolves from `cwd`.
fn plugin_resolved_from(cwd: &[u8]) -> Option<(Vec<u8>, [u64; 3])> {
    let plugin = paths::ancestors(cwd)
        .map(|it| paths::join(it, b"node_modules/eslint-plugin-prettier"))
        .find(|it| fs::is_file(&paths::join(it, b"package.json")))?;
    let version = tailwind::version_of_package(b"eslint-plugin-prettier", cwd)?;
    // Resolve a package manager's symlink, because the plugin's dependencies sit next to the real directory.
    Some((fs::real_path(&plugin).unwrap_or(plugin), version))
}

/// Checks that `eslint-plugin-prettier` and the `prettier` it loads are versions that `bun fmt` matches. `module` is
/// [`Request::package_module`]. Without it, the plugin is resolved from `cwd`.
fn check_packages(cwd: &[u8], module: Option<&[u8]>) -> Result<(), Reason> {
    let found = module.map_or_else(|| plugin_resolved_from(cwd), plugin_containing);
    let (plugin, [5, _, _]) = found.ok_or(Reason::PluginNotFound)? else {
        return Err(Reason::PluginVersion);
    };
    match tailwind::version_of_package(b"prettier", &plugin) {
        Some([3, 9, _]) => Ok(()),
        _ => Err(Reason::Version),
    }
}

/// Implements [`Formats`] for one `bun lint` run.
pub struct ForRules<'e> {
    environment: &'e Environment<'e>,
    /// The `[fmt]` section of bunfig.toml.
    defaults: Option<&'e Options>,
    /// A run has one or two.
    sets: Guarded<Vec<Arc<Set<'e>>>>,
    scratches: Guarded<Vec<Scratches>>,
    /// Cached [`check_packages`] results, keyed by [`Request::package_module`]. Nearly every run has just one.
    packages: Guarded<Vec<(Option<Vec<u8>>, Result<(), Reason>)>>,
}

impl<'e> ForRules<'e> {
    pub fn new(environment: &'e Environment<'e>, defaults: Option<&'e Options>) -> ForRules<'e> {
        ForRules {
            environment,
            defaults,
            sets: Guarded::new(Vec::new()),
            scratches: Guarded::new(Vec::new()),
            packages: Guarded::new(Vec::new()),
        }
    }

    fn set_for(&self, request: &Request) -> Arc<Set<'e>> {
        let mut sets = self.sets.lock();
        if let Some(set) = sets.iter().find(|it| it.is_for(request)) {
            return Arc::clone(set);
        }
        let set = Arc::new(Set::new(request, self.environment, self.defaults));
        sets.push(Arc::clone(&set));
        set
    }

    fn format(&self, request: &Request) -> Result<Formatted, Reason> {
        let is_prettier = request.formatter_kind == FormatterKind::InstalledPrettier;
        if is_prettier && request.follows_packages {
            let module = request.package_module;
            let mut packages = self.packages.lock();
            let known = packages
                .iter()
                .find(|it| it.0.as_deref() == module)
                .map(|it| it.1);
            known.unwrap_or_else(|| {
                let checked = check_packages(&self.environment.cwd, module);
                packages.push((module.map(<[u8]>::to_vec), checked));
                checked
            })?;
        }
        let set = self.set_for(request);
        let Read {
            configs,
            ignored,
            with_node_modules,
            allows_unsupported,
        } = set.read.as_ref().map_err(|it| *it)?;
        let path = request.path_on_disk;
        // `getFileInfo(file).ignored`
        let relative = paths::relative(&self.environment.cwd, path);
        let is_in_node_modules =
            !with_node_modules && strings::split(&relative, b"/").any(|it| it == b"node_modules");
        if is_in_node_modules || ignored.ignores_file(path, &None) {
            return Ok(Formatted::Skipped);
        }
        // A block extracted by a processor. The plugin skips blocks from files that Prettier formats as a whole.
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
        if ignored.ignores_file(path, configs.config_ignores(&scope)) {
            return Ok(Formatted::Skipped);
        }
        if is_prettier && configs.is_oxfmt_for(&scope) {
            return Err(Reason::Configuration);
        }
        if !allows_unsupported && !configs.missing_plugins(&scope, Some(path)).is_empty() {
            return Err(Reason::Plugin);
        }
        match language_of(configs, &scope, path) {
            Language::Supported => {}
            // `parser: inferredParser ?? 'babel'`
            Language::Unknown if is_prettier => {}
            Language::Unknown | Language::Other => return Err(Reason::Language),
        }
        let mut resolved = configs.options_for(&scope, path).map_err(unreadable)?;
        if !allows_unsupported && resolved.has_unsupported_option {
            return Err(Reason::Option);
        }
        if Kind::with_options(path, &resolved.options).is_none() {
            let _ = resolved.options.set(b"parser", b"babel");
        }
        let kind = Kind::with_options(path, &resolved.options);
        tailwind::only_where_sorted(&mut resolved.options, kind);
        // `bun fmt` does the same, and then doesn't sort the classes.
        if *allows_unsupported
            && (resolved.options.tailwind.as_deref()).is_some_and(|it| !it.orders.has_tailwind())
        {
            resolved.options.tailwind = None;
        }
        let mut scratch = self.scratches.lock().pop().unwrap_or_default();
        let names = Session::new();
        let names = (&Interner::new_in(&names) as &dyn Intern, &names);
        let formatted = format(path, request.text, &resolved, names, &mut scratch, false);
        self.scratches.lock().push(scratch);
        // Asking Tailwind means spawning a process, which takes about a second. `bun fmt` does that once for all files.
        // Here it would happen for every file with a class that no earlier file had.
        if (resolved.options.tailwind.as_deref()).is_some_and(Tailwind::has_missed) {
            return Err(Reason::Classes);
        }
        match formatted {
            Ok((text, _)) if text == request.text => Ok(Formatted::Same),
            Ok((text, _)) => Ok(Formatted::Text(text)),
            Err(Failure::Syntax(_)) => Err(Reason::SyntaxError),
            Err(Failure::Bug | Failure::Changed(_) | Failure::Unread(_)) => Err(Reason::Unverified),
        }
    }
}

impl Formats for ForRules<'_> {
    fn formatted(&self, request: &Request) -> Formatted {
        self.format(request).unwrap_or_else(Formatted::NotNative)
    }
}
