//! What the rules say about themselves: `--rules` and `--explain`.
//!
//! The words are those of `docs/lint/rules/<plugin>/<rule>.mdx`. `src/codegen/generate-lint-docs.ts` puts them into two
//! files, which are in the executable compressed. Only the two flags read them.

use crate::format::oxlint::plugin as scope_in_oxlint;
use crate::print_config::{object, text, write_indented};
use crate::run::Environment;
use crate::{configs, native};
use bstr::BStr;
use bun_core::strings;
use bun_lint::context::Severity;
use bun_lint::linter::{FileConfig, Registry};
use bun_lint::options::Json;
use bun_lint::rule::{Fixable, Kind, Meta, Plugin};
use bun_md::ansi_renderer::{Theme, detect_light_background, render_to_ansi};
use bun_sema::util::FxHashMap;
use std::io::Write;

macro_rules! pretty {
    ($($arg:tt)*) => {
        let _ = bun_core::write_pretty!($($arg)*);
    };
}

/// A line for each page: [its name](Meta::page), a tab, and its description.
fn descriptions() -> FxHashMap<&'static [u8], &'static [u8]> {
    let lines = bun_zstd::embed_compressed!(codegen "lint-rule-descriptions.txt");
    let lines = strings::split(lines, b"\n");
    lines
        .filter_map(|line| {
            let tab = strings::index_of_char_usize(line, b'\t')?;
            Some((&line[..tab], &line[tab + 1..]))
        })
        .collect()
}

/// The page about the rule, in Markdown: its description, an empty line, and the rest.
fn page_of(meta: &Meta) -> Option<&'static [u8]> {
    // Before each page: a NUL, its name, and a newline.
    let pages = bun_zstd::embed_compressed!(codegen "lint-rule-pages.txt");
    let head = [b"\0", &meta.page()[..], b"\n"].concat();
    let page = &pages[strings::index_of(pages, &head)? + head.len()..];
    Some(&page[..strings::index_of_char_usize(page, 0).unwrap_or(page.len())])
}

/// How severe the rules are that are on where nobody has configured anything.
struct Defaults(FxHashMap<(Plugin, &'static str), Severity>);

impl Defaults {
    fn new(registry: &Registry) -> Defaults {
        let mut severities = FxHashMap::default();
        let config = configs::defaults(registry);
        for path in [&b"/a.js"[..], b"/a.jsx", b"/a.ts", b"/a.tsx"] {
            let Some(FileConfig::Matched(of_file)) =
                config.as_ref().map(|it| it.get(registry, path))
            else {
                continue;
            };
            for rule in of_file
                .configured()
                .filter(|it| it.severity != Severity::Off)
            {
                let meta = rule.entry.meta;
                let severity = severities
                    .entry((meta.plugin, meta.name))
                    .or_insert(rule.severity);
                *severity = (*severity).max(rule.severity);
            }
        }
        Defaults(severities)
    }

    fn get(&self, meta: &Meta) -> Option<Severity> {
        self.0.get(&(meta.plugin, meta.name)).copied()
    }
}

/// The rules, each with what oxlint calls its plugin: one for each page, sorted.
fn listed(registry: &Registry) -> Vec<(&'static [u8], &'static Meta)> {
    let mut all: Vec<_> = registry
        .all()
        .iter()
        .map(|it| (scope_in_oxlint(it.meta.plugin.prefix().as_bytes()), it.meta))
        .collect();
    // A rule of the React Compiler is there as `react-hooks/..` too: the one of oxlint's own plugin is listed.
    bun_lint::utils::sort::sort_by_key(&mut all, |it| {
        (it.0, it.1.name, it.1.plugin.prefix().as_bytes() != it.0)
    });
    all.dedup_by_key(|it| (it.0, it.1.name));
    all
}

/// The rule that runs for `meta` where neither ESLint nor oxlint has a configuration.
fn in_native_mode(registry: &Registry, meta: &'static Meta, id: &[u8]) -> &'static Meta {
    registry.find_by_any_name(id).map_or(meta, |it| it.meta)
}

/// `--rules -f json`: the keys of oxlint, with what oxlint says but for `docs_url`, and then Bun's.
pub(crate) fn write_rules_as_json(out: &mut Vec<u8>, registry: &Registry) {
    let (descriptions, defaults) = (descriptions(), Defaults::new(registry));
    let rules = listed(registry).into_iter().map(|(scope, meta)| {
        let category = bun_lint::linter::oxlint_category(meta.plugin, meta.name);
        let fix: &[u8] = match (meta.fixable != Fixable::No, meta.has_suggestions) {
            (true, true) => b"fixable_safe_fix_or_suggestion",
            (true, false) => b"fixable_fix",
            (false, true) => b"fixable_suggestion",
            (false, false) => b"none",
        };
        let names = registry.names_of(meta);
        let native = in_native_mode(registry, meta, &names.id);
        let modes = [
            (names.modes.native, &b"native"[..]),
            (names.modes.eslint, b"eslint"),
            (names.modes.oxlint, b"oxlint"),
        ];
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
        ])
    });
    write_indented(out, &Json::Array(rules.collect()), 0);
    out.push(b'\n');
}

/// `--rules` into a pipe or a file: a rule a line, as oxlint calls it.
pub(crate) fn write_rules(out: &mut Vec<u8>, registry: &Registry) {
    for (scope, meta) in listed(registry) {
        out.extend_from_slice(scope);
        let _ = writeln!(out, "/{}", meta.name);
    }
}

/// `--rules` in a terminal: the rules of each plugin, each with how severe it is by default and its description.
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
            // A terminal has no backticks.
            let description = strings::replace_owned(description, b"`", b"");
            if description.is_empty() {
                out.extend_from_slice(&id);
            } else {
                let _ = write!(out, "{:<width$}", BStr::new(&id));
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

/// What the code knows about the rule, in a line of Markdown.
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

/// The rule that `name` is a name of, with or without its plugin. `Err`: there is no such rule, or more than one, and what to say.
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
    .ok_or_else(|| native::unknown_rule(registry, name, None))
}

/// `--explain <rule>`: the page about the rule that `name` is a name of. `Err`: what to say instead.
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
    // What is no hyperlink is printed with its address after it, which this is.
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
