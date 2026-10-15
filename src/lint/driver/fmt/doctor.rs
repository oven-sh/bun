//! `bun fmt --doctor`. See [`crate::doctor`].

use super::config::{self, Configs, Flavor};
use super::files::{Expanded, Target};
use crate::doctor::{
    How, Kinds, Modules, Need, Packages, is_for_formatting, sorted, texts, write_count, write_notes,
};
use crate::paths;
use crate::print_config::{object, text, write_indented};
use crate::run::{Fatal, Pool};
use bstr::BStr;
use bun_lint::options::Json;
use bun_threading::Guarded;
use std::io::Write;

macro_rules! pretty {
    ($($arg:tt)*) => {
        let _ = bun_core::write_pretty!($($arg)*);
    };
}

/// How a run sorts the files it found, before it formats any of them.
pub(super) struct Sorted<'s> {
    /// Every file, whichever group it ends up in.
    pub(super) found: &'s [Expanded],
    pub(super) formatted: &'s [(usize, &'s Target)],
    /// Sent to the project's own Prettier.
    pub(super) handed_over: &'s [(usize, &'s Target)],
    /// Files in a language `bun fmt` doesn't support that can't go to Prettier either, as (extension, count) pairs.
    pub(super) others: &'s [(&'s [u8], usize)],
    /// Number of files skipped because their config uses plugins that `bun fmt` doesn't include.
    pub(super) left_for_plugins: usize,
    /// Packages to install so that more files can be sent to Prettier.
    pub(super) not_installed: &'s [&'s [u8]],
}

/// The plugins that the config lists for the files in this run.
#[derive(Default)]
struct Plugins {
    built_in: Vec<Vec<u8>>,
    /// Plugins that add a language. Files in that language go to the project's own Prettier.
    for_languages: Vec<Vec<u8>>,
    not_supported: Vec<Vec<u8>>,
}

impl Plugins {
    #[optimize(size)]
    fn add(&mut self, name: &[u8], is_built_in: bool) {
        let list = if is_built_in {
            &mut self.built_in
        } else if config::is_missing_plugin(name) {
            &mut self.not_supported
        } else {
            &mut self.for_languages
        };
        if !list.iter().any(|it| it == name) {
            list.push(name.to_vec());
        }
    }
}

#[optimize(size)]
pub(super) fn report(
    (configs, cwd): (&Configs, &[u8]),
    pool: &Pool,
    files: &Sorted,
    modules: &Modules,
    how: How,
) -> Result<Vec<u8>, Fatal> {
    let own = configs.for_directory(cwd)?;
    let shown = |file: &[u8]| paths::relative(cwd, file);
    let file = configs.path_of_config(&own).map(shown);
    let is_oxfmt = configs.is_oxfmt_for(&own);
    let is_svelte_off = configs.turns_svelte_off(&own, cwd);
    let found = files.found.iter().filter_map(|it| match it {
        Expanded::File(target) => Some(target),
        Expanded::Error(_) => None,
    });

    let (mut plugins, mut nested) = (Plugins::default(), Vec::new());
    for target in found {
        let (scope, path) = (&target.scope, &target.path);
        let named = configs.packages_of_plugins(scope, Some(path));
        let missing = configs.missing_plugins(scope, Some(path)).iter();
        // With `svelte = false` nobody does what the plugin for it does.
        let is_in_use = |it: &&[u8]| !(is_svelte_off && config::is_plugin_for_svelte(it));
        named
            .chain(missing.map(|it| &it[..]))
            .filter(is_in_use)
            .for_each(|it| plugins.add(it, configs.is_built_in(it)));
        nested.extend(configs.path_of_config(scope).map(shown));
    }
    let mut nested = sorted(nested);
    nested.retain(|it| Some(it) != file.as_ref());
    // Prettier loads every plugin listed in a file's config, so all of them have to stay installed.
    let for_files = files.handed_over.iter().flat_map(|(_, target)| {
        let named = configs.packages_of_plugins(&target.scope, Some(&target.path));
        std::iter::once(&b"prettier"[..]).chain(named)
    });
    // Packages that aren't installed yet are needed too. They're the reason some files can't go to Prettier.
    let prettier = files.not_installed.first().map(|_| &b"prettier"[..]);
    let for_files = for_files
        .chain(prettier)
        .chain(files.not_installed.iter().copied());
    let for_files = sorted(for_files.map(<[u8]>::to_vec).collect());
    let mut by_prettier = Kinds::default();
    (files.handed_over.iter()).for_each(|it| by_prettier.add(&it.1.path));
    let mut not_formatted = Kinds::default();
    (files.others.iter()).for_each(|it| not_formatted.add_ending(it.0, it.1));

    // Resolving each file's options is what fills in `unsupported_options`.
    let mut failure = Guarded::new(None);
    pool.for_each(files.formatted.len(), 16, &|at| {
        let target = files.formatted[at].1;
        if let Err(error) = configs.options_for(&target.scope, &target.path) {
            failure.lock().get_or_insert(error);
        }
    });
    if let Some(error) = failure.get_mut().take() {
        return Err(error);
    }
    let options = sorted(std::mem::take(&mut *configs.unsupported_options.lock()));
    let mut notes = std::mem::take(&mut *configs.warnings.lock());
    notes.extend(configs.note().map(<[u8]>::to_vec));
    if is_svelte_off {
        notes.push(b"Svelte files are not formatted (svelte = false)".to_vec());
    } else if configs.turns_svelte_off_for_some(&own, cwd) {
        notes.push(b"Some Svelte files are not formatted (svelte = false in an override)".to_vec());
    }

    let loaded = modules.packages();
    let is_not_supported = |name: &[u8]| plugins.not_supported.iter().any(|it| it == name);
    let packages = Packages::new(
        cwd,
        &|name| is_for_formatting(name) && !is_not_supported(name),
        &|name| {
            if for_files.iter().any(|it| it == name) {
                Some(Need::Files)
            } else if files.left_for_plugins > 0 && (name == b"prettier" || is_not_supported(name))
            {
                Some(Need::SkippedFiles)
            } else if let Some(file) = &file {
                let is_asked =
                    name == b"prettier-plugin-tailwindcss" && configs.classes.asks_plugin();
                (is_asked || loaded.iter().any(|it| it == name))
                    .then(|| Need::Configuration(file.clone()))
            } else {
                (is_oxfmt && matches!(name, b"oxfmt" | b"vite-plus")).then_some(Need::Defaults)
            }
        },
    );
    let not_installed: Vec<Vec<u8>> = files.not_installed.iter().map(|it| it.to_vec()).collect();
    let kind: &[u8] = match (&file, is_oxfmt) {
        (None, false) => b"none",
        (_, true) => b"oxfmt",
        (Some(_), false) => b"prettier",
    };

    let mut out = Vec::new();
    if how.as_json {
        let number = |count: usize| Json::Number(count as f64);
        let report = object(vec![
            (
                b"config",
                object(vec![
                    (b"path", file.as_ref().map_or(Json::Null, |it| text(it))),
                    (b"kind", text(kind)),
                    (b"nested", texts(&nested)),
                    (b"editorconfig", Json::Bool(own.has_editorconfig())),
                    (b"bunfig", configs.bunfig().map_or(Json::Null, text)),
                ]),
            ),
            (
                b"files",
                object(vec![
                    (b"formatted", number(files.formatted.len())),
                    (b"by_prettier", by_prettier.json()),
                    (b"not_formatted", not_formatted.json()),
                    (b"left_for_plugins", number(files.left_for_plugins)),
                ]),
            ),
            (
                b"plugins",
                object(vec![
                    (b"built_in", texts(&plugins.built_in)),
                    (b"by_prettier", texts(&plugins.for_languages)),
                    (b"not_supported", texts(&plugins.not_supported)),
                    (b"not_installed", texts(&not_installed)),
                ]),
            ),
            (b"options_not_supported", texts(&options)),
            (b"packages", packages.json()),
            (b"notes", texts(&notes)),
        ]);
        write_indented(&mut out, &report, 0);
        out.push(b'\n');
        return Ok(out);
    }

    let colors = how.colors;
    match (&file, configs.flavor) {
        (Some(file), _) => {
            let kind = if is_oxfmt {
                "oxfmt config"
            } else {
                "Prettier config"
            };
            pretty!(
                &mut out,
                colors,
                "Using <b>{}<r> <d>({})<r>\n",
                BStr::new(file),
                kind
            );
        }
        (None, Flavor::Prettier) if configs.bunfig().is_some() => {}
        (None, Flavor::Prettier) => out.extend_from_slice(
            b"No Prettier or oxfmt config found. Bun formats like Prettier by default.\n",
        ),
        (None, Flavor::Oxfmt) => {
            out.extend_from_slice(b"No config file found. Using oxfmt's defaults.\n");
        }
    }
    if let Some(bunfig) = configs.bunfig() {
        let what = match file.is_none() && !is_oxfmt {
            true => "[fmt], on top of Prettier's defaults",
            false => "[fmt]",
        };
        pretty!(
            &mut out,
            colors,
            "Using <b>{}<r> <d>({})<r>\n",
            BStr::new(bunfig),
            what
        );
    }
    if !nested.is_empty() {
        pretty!(
            &mut out,
            colors,
            "<d>Also {}<r>\n",
            BStr::new(&nested.join(&b", "[..]))
        );
    }
    if own.has_editorconfig() {
        pretty!(&mut out, colors, "<d>Also .editorconfig<r>\n");
    }
    out.push(b'\n');
    let noun = |count: usize, one: &'static str, many: &'static str| match count {
        1 => one,
        _ => many,
    };
    let formatted = files.formatted.len();
    let what = noun(
        formatted,
        "file is formatted natively",
        "files are formatted natively",
    );
    write_count(&mut out, colors, formatted, what);
    if by_prettier.count() > 0 {
        let what = noun(by_prettier.count(), "file goes", "files go");
        let what = format!("{what} to your installed Prettier: {}", by_prettier.shown());
        write_count(&mut out, colors, by_prettier.count(), &what);
    }
    if not_formatted.count() > 0 {
        let what = noun(not_formatted.count(), "file", "files");
        let what = format!("{what} cannot be formatted: {}", not_formatted.shown());
        write_count(&mut out, colors, not_formatted.count(), &what);
    }
    if files.left_for_plugins > 0 {
        let what = noun(files.left_for_plugins, "file is", "files are");
        let what = format!("{what} skipped because a plugin is not supported");
        write_count(&mut out, colors, files.left_for_plugins, &what);
        let hint = "Use --allow-unsupported to format them without it";
        pretty!(&mut out, colors, "        <d>{}<r>\n", hint);
    }
    let rows: [(&str, &[Vec<u8>]); 5] = [
        ("Built-in plugins:", &plugins.built_in),
        (
            "Plugins that use your installed Prettier:",
            &plugins.for_languages,
        ),
        ("Plugins that are not supported:", &plugins.not_supported),
        ("Not installed:", &not_installed),
        ("Options that are not supported:", &options),
    ];
    for (at, (label, names)) in rows.iter().filter(|it| !it.1.is_empty()).enumerate() {
        if at == 0 {
            out.push(b'\n');
        }
        pretty!(
            &mut out,
            colors,
            "{} {}\n",
            label,
            BStr::new(&names.join(&b", "[..]))
        );
    }
    packages.write(&mut out, colors);
    if file.is_none() && !is_oxfmt && configs.bunfig().is_none() {
        out.extend_from_slice(b"\nRun bun fmt --init to add a [fmt] section to bunfig.toml\n");
    }
    write_notes(&mut out, colors, &notes);
    Ok(out)
}
