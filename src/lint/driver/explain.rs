//! `--rules` and `--explain`, which list and document the rules.
//!
//! The text comes from `docs/lint/rules/<plugin>/<rule>.mdx`. `src/codegen/generate-lint-docs.ts` packs it into one
//! file that is embedded in the executable, compressed. Only these two flags read it.

use crate::format::oxlint::plugin as scope_in_oxlint;
use crate::print_config::{object, text, write_indented};
use crate::run::Environment;
use crate::{configs, native};
use bstr::BStr;
use bun_core::fmt::TerminalHyperlink;
use bun_core::strings;
use bun_lint::context::Severity;
use bun_lint::linter::{FileConfig, Registry, schema_and_defaults};
use bun_lint::options::Json;
use bun_lint::rule::{Fixable, Kind, Meta, Plugin};
use bun_md::ansi_renderer::{Theme, detect_light_background, render_to_ansi};
use bun_sema::util::FxHashMap;
use std::io::Write;
use std::sync::Arc;

macro_rules! pretty {
    ($($arg:tt)*) => {
        let _ = bun_core::write_pretty!($($arg)*);
    };
}

/// Every page: a NUL, its [name](Meta::page), a newline, then its Markdown. That's the description on one line, an empty
/// line, then the rest.
fn pages() -> &'static [u8] {
    bun_zstd::embed_compressed!(codegen "lint-rule-pages.txt")
}

/// Descriptions by page name.
fn descriptions() -> FxHashMap<&'static [u8], &'static [u8]> {
    strings::split(pages(), b"\0")
        .filter_map(|page| {
            let mut lines = strings::split(page, b"\n");
            Some((lines.next()?, lines.next()?))
        })
        .collect()
}

/// The rule's docs page in Markdown.
fn page_of(meta: &Meta) -> Option<&'static [u8]> {
    let pages = pages();
    let head = [b"\0", &meta.page()[..], b"\n"].concat();
    let page = &pages[strings::index_of(pages, &head)? + head.len()..];
    Some(&page[..strings::index_of_char_usize(page, 0).unwrap_or(page.len())])
}

/// Severity and options that the default config has for each rule it mentions. It sets options for some rules that are off,
/// which apply once the user turns the rule on.
struct Defaults(FxHashMap<(Plugin, &'static str), (Severity, Arc<[Json]>)>);

impl Defaults {
    #[optimize(size)]
    fn new(registry: &Registry) -> Defaults {
        let mut on = FxHashMap::default();
        let config = configs::defaults(registry);
        for path in [&b"/a.js"[..], b"/a.jsx", b"/a.ts", b"/a.tsx"] {
            let Some(FileConfig::Matched(of_file)) =
                config.as_ref().map(|it| it.get(registry, path))
            else {
                continue;
            };
            for rule in of_file.configured() {
                let meta = rule.entry.meta;
                let (severity, _) = on
                    .entry((meta.plugin, meta.name))
                    .or_insert_with(|| (rule.severity, Arc::clone(&rule.options)));
                *severity = (*severity).max(rule.severity);
            }
        }
        Defaults(on)
    }

    /// `None` if the rule is off by default.
    fn get(&self, meta: &Meta) -> Option<Severity> {
        let (severity, _) = self.0.get(&(meta.plugin, meta.name))?;
        Some(*severity).filter(|it| *it != Severity::Off)
    }

    fn options(&self, meta: &Meta) -> &[Json] {
        self.0
            .get(&(meta.plugin, meta.name))
            .map_or(&[], |it| &it.1)
    }
}

/// All rules, sorted, each with oxlint's name for its plugin. One entry per docs page.
fn listed(registry: &Registry) -> Vec<(&'static [u8], &'static Meta)> {
    let mut all: Vec<_> = registry
        .all()
        .iter()
        .map(|it| (scope_in_oxlint(it.meta.plugin.prefix().as_bytes()), it.meta))
        .collect();
    // React Compiler rules are also registered as `react-hooks/..`. Keep the one under oxlint's own plugin name.
    bun_lint::utils::sort::sort_by_key(&mut all, |it| {
        (it.0, it.1.name, it.1.plugin.prefix().as_bytes() != it.0)
    });
    all.dedup_by_key(|it| (it.0, it.1.name));
    all
}

/// The rule that runs in place of `meta` in a project with no ESLint or oxlint config.
fn in_native_mode(registry: &Registry, meta: &'static Meta, id: &[u8]) -> &'static Meta {
    registry.find_by_any_name(id).map_or(meta, |it| it.meta)
}

/// `--rules -f json`. oxlint's keys come first, with oxlint's values except for `docs_url`. Bun's own keys follow.
#[optimize(size)]
pub(crate) fn write_rules_as_json(out: &mut Vec<u8>, registry: &Registry) {
    let (descriptions, defaults) = (descriptions(), Defaults::new(registry));
    let rules = listed(registry).into_iter().map(|(scope, meta)| {
        let category = bun_lint::linter::oxlint_category(meta.plugin, meta.name);
        let names = registry.names_of(meta);
        let native = in_native_mode(registry, meta, &names.id);
        let fixes = native.fixable != Fixable::No && !native.never_fixes;
        let fix: &[u8] = match (fixes, native.has_suggestions && !native.never_suggests) {
            (true, true) => b"fixable_safe_fix_or_suggestion",
            (true, false) => b"fixable_fix",
            (false, true) => b"fixable_suggestion",
            (false, false) => b"none",
        };
        let modes = [
            (names.modes.native, &b"native"[..]),
            (names.modes.eslint, b"eslint"),
            (names.modes.oxlint, b"oxlint"),
        ];
        let (schema, default_options) = schema_and_defaults(native, defaults.options(native))
            .map_or((Json::Null, Json::Null), |it| (it.0, Json::Array(it.1)));
        object(vec![
            (b"scope", text(scope)),
            (b"value", text(meta.name.as_bytes())),
            (
                b"category",
                category.map_or(Json::Null, |it| text(it.as_bytes())),
            ),
            (b"type_aware", Json::Bool(meta.requires_types)),
            (b"fix", text(fix)),
            (
                b"default",
                Json::Bool(
                    category == Some("correctness")
                        && matches!(scope, b"eslint" | b"typescript" | b"oxc" | b"unicorn"),
                ),
            ),
            (b"docs_url", text(&meta.docs_url())),
            (b"id", text(&names.id)),
            (
                b"aliases",
                Json::Array(names.aliases.iter().map(|it| text(it)).collect()),
            ),
            (
                b"description",
                text(
                    descriptions
                        .get(&meta.page()[..])
                        .copied()
                        .unwrap_or_default(),
                ),
            ),
            (
                b"kind",
                match native.kind {
                    Kind::Problem => text(b"problem"),
                    Kind::Suggestion => text(b"suggestion"),
                    Kind::Layout => text(b"layout"),
                    Kind::None => Json::Null,
                },
            ),
            (b"deprecated", Json::Bool(native.is_deprecated)),
            (
                b"on_by_default",
                match defaults.get(native) {
                    Some(Severity::Error) => text(b"error"),
                    Some(Severity::Warn) => text(b"warn"),
                    Some(Severity::Off) | None => Json::Bool(false),
                },
            ),
            (
                b"modes",
                Json::Array(
                    modes
                        .iter()
                        .filter(|it| it.0)
                        .map(|it| text(it.1))
                        .collect(),
                ),
            ),
            (b"schema", schema),
            (b"default_options", default_options),
        ])
    });
    write_indented(out, &Json::Array(rules.collect()), 0);
    out.push(b'\n');
}

/// `--rules` when stdout is a pipe or a file: one rule per line, under oxlint's name for it.
pub(crate) fn write_rules(out: &mut Vec<u8>, registry: &Registry) {
    for (scope, meta) in listed(registry) {
        out.extend_from_slice(scope);
        let _ = writeln!(out, "/{}", meta.name);
    }
}

/// `--rules` in a terminal: rules grouped by plugin, each with its default severity and description.
#[optimize(size)]
pub(crate) fn write_rules_by_plugin(out: &mut Vec<u8>, registry: &Registry, colors: bool) {
    let (descriptions, defaults) = (descriptions(), Defaults::new(registry));
    let all = listed(registry);
    for of_plugin in all.chunk_by(|a, b| a.0 == b.0) {
        let rows: Vec<_> = (of_plugin.iter())
            .map(|(_, meta)| (registry.names_of(meta).id, *meta))
            .collect();
        let directory = of_plugin[0].1.plugin.directory_of_docs();
        let noun = if rows.len() == 1 { "rule" } else { "rules" };
        pretty!(
            out,
            colors,
            "<b>{}<r> <d>({} {})<r>\n",
            directory,
            rows.len(),
            noun
        );
        let width = rows.iter().map(|it| it.0.len()).max().unwrap_or(0);
        for (id, meta) in rows {
            match defaults.get(in_native_mode(registry, meta, &id)) {
                Some(Severity::Error) => {
                    pretty!(out, colors, "  <red>error<r>  ");
                }
                Some(Severity::Warn) => {
                    pretty!(out, colors, "  <yellow>warn<r>   ");
                }
                Some(Severity::Off) | None => out.extend_from_slice(b"         "),
            }
            let description = descriptions
                .get(&meta.page()[..])
                .copied()
                .unwrap_or_default();
            // Backticks are Markdown. They'd only be noise in a terminal.
            let description = strings::replace_owned(description, b"`", b"");
            let url = meta.docs_url();
            let _ = write!(out, "{}", TerminalHyperlink::new(&url, &id, colors));
            if !description.is_empty() {
                let padding = width - id.len();
                let _ = write!(out, "{:padding$}", "");
                pretty!(out, colors, "  <d>{}<r>", BStr::new(&description));
            }
            out.push(b'\n');
        }
        out.push(b'\n');
    }
    let _ = writeln!(
        out,
        "{} rules. The ones marked error or warn are on by default.\nRun bun lint --explain <rule> to read about a rule.",
        all.len()
    );
}

/// One line of Markdown with the facts that come from the code, not the docs page.
fn facts(
    meta: &Meta,
    aliases: &[Vec<u8>],
    namesakes: &[Vec<u8>],
    default: Option<Severity>,
) -> Vec<u8> {
    let mut facts: Vec<&str> = vec![match default {
        Some(Severity::Error) => "On by default as an error",
        Some(Severity::Warn) => "On by default as a warning",
        Some(Severity::Off) | None => "Off by default",
    }];
    if meta.fixable != Fixable::No {
        facts.push("fixable");
    }
    if meta.requires_types {
        facts.push("needs types");
    }
    if meta.is_deprecated {
        facts.push("deprecated");
    }
    let mut line = format!("*{}.*", facts.join(", ")).into_bytes();
    for (before, names) in [(&b" Also called "[..], aliases), (b" See also ", namesakes)] {
        if !names.is_empty() {
            let names: Vec<Vec<u8>> = (names.iter())
                .map(|it| [b"`", &it[..], b"`"].concat())
                .collect();
            line.extend_from_slice(before);
            line.extend_from_slice(&names.join(&b", "[..]));
            line.push(b'.');
        }
    }
    line
}

/// Looks up a rule by any of its names, with or without the plugin prefix. `Err` has the message to print if no rule
/// matches, or more than one.
fn find(registry: &Registry, name: &[u8]) -> Result<&'static Meta, Vec<u8>> {
    if let Some(entry) = registry.find_by_any_name(name) {
        return Ok(entry.meta);
    }
    let all = listed(registry).into_iter();
    let ids: Vec<Vec<u8>> = (all.filter(|it| it.1.name.as_bytes() == name))
        .map(|it| registry.names_of(it.1).id)
        .collect();
    match &ids[..] {
        [id] => registry.find_by_any_name(id).map(|it| it.meta),
        [] => None,
        ids => {
            let count = ids.len().to_string();
            return Err([
                count.as_bytes(),
                b" rules are called \"",
                name,
                b"\"\n  Choose one: ",
                &ids.join(&b", "[..]),
            ]
            .concat());
        }
    }
    .ok_or_else(|| native::unknown_rule(registry, name, native::NamedBy::Explain))
}

/// `--explain <rule>`. Returns the rendered docs page for `name`, or the error message to print.
#[optimize(size)]
pub(crate) fn explain(
    registry: &Registry,
    name: &[u8],
    environment: &Environment,
    colors: Option<bool>,
) -> Result<Vec<u8>, Vec<u8>> {
    let meta = find(registry, name)?;
    let names = registry.names_of(meta);
    let namesakes: Vec<Vec<u8>> = (listed(registry).into_iter())
        .filter(|it| it.1.name == meta.name && it.1.page() != meta.page())
        .map(|it| registry.names_of(it.1).id)
        .collect();
    let default = Defaults::new(registry).get(meta);
    let facts = facts(meta, &names.aliases, &namesakes, default);
    let page = page_of(meta).unwrap_or(b"\n\nThis version of Bun has no page about this rule.");
    let after_description = strings::index_of(page, b"\n\n").unwrap_or(page.len());
    let (description, rest) = page.split_at(after_description);
    let colors = colors.unwrap_or(environment.stdout.colors);
    let hyperlinks = colors && environment.stdout.is_tty;
    // Without hyperlinks the renderer prints links as "text (url)". Here the text is the URL, so it would show twice.
    let (before_url, after_url): (&[u8], &[u8]) =
        if hyperlinks { (b"<", b">") } else { (b"", b"") };
    let markdown = [
        b"# ",
        &names.id[..],
        b"\n\n",
        description,
        b"\n\n",
        &facts,
        rest,
        b"\n\n",
        before_url,
        &meta.docs_url(),
        after_url,
        b"\n",
    ]
    .concat();
    let theme = Theme {
        light: detect_light_background(),
        columns: (environment.columns)(),
        colors,
        hyperlinks,
        kitty_graphics: false,
        remote_image_paths: None,
        image_base_dir: None,
    };
    let rendered = render_to_ansi(&markdown, bun_md::root::Options::default(), theme);
    Ok(match rendered {
        Ok(Some(rendered)) => rendered.into_vec(),
        Ok(None) | Err(_) => markdown,
    })
}
