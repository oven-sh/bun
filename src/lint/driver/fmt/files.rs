//! Finds the files to format: `expandPatterns` of Prettier's command line, and what it ignores.
//! With a configuration file of oxfmt: its `ScopedWalker`.

use super::cli::Options;
use super::config::{Configs, Flavor, Scope, glob_of_oxc};
use crate::gitignore::{self, Chain};
use crate::run::{Fatal, Pool};
use crate::{fs, paths};
use bun_collections::index_sort;
use bun_core::strings;
use bun_lint::linter::Glob;
use bun_lint::linter::config::FastGlob;
use bun_sema::util::FxHashSet;
use bun_threading::Guarded;
use std::sync::Arc;

/// A file to format.
pub(crate) struct Target {
    pub(crate) path: Vec<u8>,
    /// In bytes, when it was found.
    pub(crate) size: u64,
    pub(crate) scope: Arc<Scope>,
    /// It is in a directory that is an argument: nothing is said if there is no parser for it.
    pub(crate) ignores_unknown: bool,
    /// It is an argument itself, so nothing has been asked yet about the directories that it is in.
    pub(crate) is_named: bool,
}

/// What the arguments stand for, in the order in which Prettier comes to it.
pub(crate) enum Expanded {
    File(Target),
    /// For the user. The exit code is 2.
    Error(Vec<u8>),
}

/// What kind of file a name stands for.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum Language {
    /// The formatter has it: see [`Kind`].
    Supported,
    /// Prettier formats it. This formatter does not.
    Other,
    /// Prettier has no parser for it either.
    Unknown,
}

/// `EXCLUDE_FILENAMES` of oxfmt: what a tool has written, and is never formatted.
fn is_left_alone_by_oxfmt(path: &[u8]) -> bool {
    matches!(
        paths::basename(path),
        b"package-lock.json"
            | b"pnpm-lock.yaml"
            | b"yarn.lock"
            | b"MODULE.bazel.lock"
            | b"bun.lock"
            | b"deno.lock"
            | b"composer.lock"
            | b"Package.resolved"
            | b"Pipfile.lock"
            | b"flake.lock"
            | b"mcmod.info"
            | b"Cargo.lock"
            | b"Gopkg.lock"
            | b"pdm.lock"
            | b"poetry.lock"
            | b"uv.lock"
    )
}

/// A language that the formatter has.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum Kind {
    /// JavaScript or TypeScript.
    Script,
    Json(bun_format::json::Parser),
    Css(bun_format::css::Parser),
    Yaml,
    Markdown,
    Mdx,
    GraphQl,
    Handlebars,
    /// Only for oxfmt.
    Toml,
    /// HTML, Vue, Angular templates, Lightning Web Components, MJML.
    Html(bun_format::html::Parser),
}

impl Kind {
    /// What Prettier's parser of that name reads. `None`: Prettier has none, so it is that of a plugin, or a mistake.
    pub(crate) fn of_parser(parser: &[u8]) -> Option<Kind> {
        let json = || bun_format::json::Parser::from_name(parser).map(Kind::Json);
        let css = || bun_format::css::Parser::from_name(parser).map(Kind::Css);
        let html = || bun_format::html::Parser::from_name(parser).map(Kind::Html);
        let other = || match parser {
            b"yaml" => Some(Kind::Yaml),
            b"markdown" | b"remark" => Some(Kind::Markdown),
            b"mdx" => Some(Kind::Mdx),
            b"graphql" => Some(Kind::GraphQl),
            b"glimmer" => Some(Kind::Handlebars),
            b"babel" | b"babel-flow" | b"babel-ts" | b"flow" | b"typescript" | b"acorn"
            | b"espree" | b"meriyah" | b"oxc" | b"oxc-ts" => Some(Kind::Script),
            _ => None,
        };
        json().or_else(css).or_else(html).or_else(other)
    }

    /// Of the file at `path`, as `options` have it.
    pub(crate) fn with_options(path: &[u8], options: &bun_format::FormatOptions) -> Option<Kind> {
        // No configuration file of oxfmt has `parser`. Its tests do.
        if !options.flavor.is_oxfmt() || options.parser.is_some() {
            return Kind::of(path, options.parser.as_deref());
        }
        match classify_for_oxfmt(path) {
            Some(ForOxfmt::Kind(kind)) => Some(kind),
            _ => None,
        }
    }

    /// Of the file at `path`. `parser`: Prettier's option of that name, which decides if it is set.
    fn of(path: &[u8], parser: Option<&[u8]>) -> Option<Kind> {
        if let Some(parser) = parser {
            return Kind::of_parser(parser);
        }
        let name = paths::basename(path);
        let extension =
            strings::last_index_of_char(name, b'.').map_or(&b""[..], |dot| &name[dot + 1..]);
        if matches!(
            extension,
            b"js" | b"mjs" | b"cjs" | b"jsx" | b"ts" | b"mts" | b"cts" | b"tsx"
        ) || name.ends_with(b".js.flow")
            || extension == b"wxs"
            || is_javascript_by_another_name(name, extension)
        {
            return Some(Kind::Script);
        }
        // None of them looks at the directories.
        let json = || bun_format::json::parser_for_path(name).map(Kind::Json);
        let css = || bun_format::css::parser_for_path(name).map(Kind::Css);
        let yaml = || bun_format::yaml::is_yaml_path(name).then_some(Kind::Yaml);
        let markdown = || bun_format::markdown::is_markdown_path(name).then_some(Kind::Markdown);
        let mdx = || bun_format::markdown::is_mdx_path(name).then_some(Kind::Mdx);
        let graphql = || bun_format::graphql::is_graphql_path(name).then_some(Kind::GraphQl);
        let handlebars =
            || bun_format::handlebars::is_handlebars_path(name).then_some(Kind::Handlebars);
        let html = || bun_format::html::parser_for_path(name).map(Kind::Html);
        json()
            .or_else(css)
            .or_else(yaml)
            .or_else(markdown)
            .or_else(mdx)
            .or_else(graphql)
            .or_else(handlebars)
            .or_else(html)
    }
}

/// What else is JavaScript for Prettier and for oxfmt, which have it from GitHub's linguist.
fn is_javascript_by_another_name(name: &[u8], extension: &[u8]) -> bool {
    matches!(
        extension,
        b"_js"
            | b"bones"
            | b"es"
            | b"es6"
            | b"gs"
            | b"jake"
            | b"javascript"
            | b"jsb"
            | b"jscad"
            | b"jsfl"
            | b"jslib"
            | b"jsm"
            | b"jspre"
            | b"jss"
            | b"njs"
            | b"pac"
            | b"sjs"
            | b"ssjs"
            | b"xsjs"
            | b"xsjslib"
    ) || matches!(name, b"Jakefile" | b"start.frag" | b"end.frag")
        || name.ends_with(b".start.frag")
        || name.ends_with(b".end.frag")
}

/// What a name stands for to oxfmt.
#[derive(Copy, Clone)]
enum ForOxfmt {
    Kind(Kind),
    /// Only with `svelte` in the configuration.
    Svelte,
}

/// oxfmt's `classify_file_kind`. Unlike Prettier it tells upper case from lower case.
fn classify_for_oxfmt(path: &[u8]) -> Option<ForOxfmt> {
    use bun_format::{css, html, json};
    let name = paths::basename(path);
    // `Path::extension`: a name that starts with its only dot has none.
    let extension = match strings::last_index_of_char(name, b'.') {
        None | Some(0) => &b""[..],
        Some(dot) => &name[dot + 1..],
    };
    let is_script = matches!(
        extension,
        b"js" | b"mjs" | b"cjs" | b"jsx" | b"ts" | b"mts" | b"cts" | b"tsx"
    );
    if !is_script && is_left_alone_by_oxfmt(path) {
        return None;
    }
    if is_script || is_javascript_by_another_name(name, extension) {
        return Some(ForOxfmt::Kind(Kind::Script));
    }
    if extension == b"toml"
        || matches!(name, b"Pipfile" | b"Cargo.toml.orig")
        || name.ends_with(b".toml.example")
    {
        return Some(ForOxfmt::Kind(Kind::Toml));
    }
    let by_name = match name {
        b"package.json" | b"composer.json" => Some(Kind::Json(json::Parser::JsonStringify)),
        b".all-contributorsrc"
        | b".arcconfig"
        | b".auto-changelog"
        | b".c8rc"
        | b".htmlhintrc"
        | b".imgbotconfig"
        | b".nycrc"
        | b".tern-config"
        | b".tern-project"
        | b".watchmanconfig"
        | b".babelrc"
        | b".jscsrc"
        | b".jshintrc"
        | b".jslintrc"
        | b".swcrc" => Some(Kind::Json(json::Parser::Json)),
        b".prettierrc" | b".stylelintrc" | b".lintstagedrc" | b".clang-format" | b".clang-tidy"
        | b".clangd" | b".gemrc" | b"CITATION.cff" | b"glide.lock" | b"pixi.lock" => {
            Some(Kind::Yaml)
        }
        b"contents.lr" | b"README" => Some(Kind::Markdown),
        _ => None,
    };
    let by_ending = || {
        [
            (&b".json.example"[..], Kind::Json(json::Parser::Json)),
            (b".tfstate.backup", Kind::Json(json::Parser::Json)),
            (b".component.html", Kind::Html(html::Parser::Angular)),
        ]
        .into_iter()
        .find(|it| name.ends_with(it.0))
        .map(|it| it.1)
    };
    let by_extension = || {
        Some(match extension {
            b"importmap" => Kind::Json(json::Parser::JsonStringify),
            b"json" | b"4DForm" | b"4DProject" | b"avsc" | b"geojson" | b"gltf" | b"har"
            | b"ice" | b"JSON-tmLanguage" | b"mcmeta" | b"sarif" | b"tact" | b"tfstate"
            | b"topojson" | b"webapp" | b"webmanifest" | b"yy" | b"yyp" => {
                Kind::Json(json::Parser::Json)
            }
            b"jsonc"
            | b"code-snippets"
            | b"code-workspace"
            | b"sublime-build"
            | b"sublime-color-scheme"
            | b"sublime-commands"
            | b"sublime-completions"
            | b"sublime-keymap"
            | b"sublime-macro"
            | b"sublime-menu"
            | b"sublime-mousemap"
            | b"sublime-project"
            | b"sublime-settings"
            | b"sublime-theme"
            | b"sublime-workspace"
            | b"sublime_metrics"
            | b"sublime_session" => Kind::Json(json::Parser::Jsonc),
            b"json5" => Kind::Json(json::Parser::Json5),
            b"graphql" | b"gql" | b"graphqls" => Kind::GraphQl,
            b"css" | b"wxss" | b"pcss" | b"postcss" => Kind::Css(css::Parser::Css),
            b"scss" => Kind::Css(css::Parser::Scss),
            b"less" => Kind::Css(css::Parser::Less),
            b"yml" | b"mir" | b"reek" | b"rviz" | b"sublime-syntax" | b"syntax" | b"yaml"
            | b"yaml-tmlanguage" => Kind::Yaml,
            b"md" | b"livemd" | b"markdown" | b"mdown" | b"mdwn" | b"mkd" | b"mkdn" | b"mkdown"
            | b"ronn" | b"scd" | b"workbook" => Kind::Markdown,
            b"html" | b"hta" | b"htm" | b"inc" | b"xht" | b"xhtml" => {
                Kind::Html(html::Parser::Html)
            }
            b"vue" => Kind::Html(html::Parser::Vue),
            b"mjml" => Kind::Html(html::Parser::Mjml),
            b"handlebars" | b"hbs" => Kind::Handlebars,
            _ => return None,
        })
    };
    match extension {
        b"svelte" => Some(ForOxfmt::Svelte),
        // It hands MDX to the Prettier that comes with it.
        b"mdx" => Some(ForOxfmt::Kind(Kind::Mdx)),
        _ => by_name
            .or_else(by_ending)
            .or_else(by_extension)
            .map(ForOxfmt::Kind),
    }
}

/// Prettier's `getLanguageByInterpreter`: the parser for a file whose name says nothing and has no `.`, by its first
/// line: `#!/usr/bin/env node`.
pub(crate) fn parser_by_interpreter(path: &[u8]) -> Option<&'static [u8]> {
    if strings::contains_char(paths::basename(path), b'.') || Kind::of(path, None).is_some() {
        return None;
    }
    let mut start = [0; 256];
    let start = fs::read_start(path, &mut start);
    let line = strings::split(start, b"\n").next()?;
    let in_bin = (line.strip_prefix(b"#!/usr/local/bin/"))
        .or_else(|| line.strip_prefix(b"#!/usr/bin/"))
        .or_else(|| line.strip_prefix(b"#!/bin/"))?;
    let word = |text: &'_ [u8]| -> usize {
        text.iter()
            .take_while(|it| !it.is_ascii_whitespace())
            .count()
    };
    let after_env = (in_bin.strip_prefix(b"env"))
        .filter(|rest| !line.starts_with(b"#!/usr/local/") && word(rest) == 0)
        .map(<[u8]>::trim_ascii_start)
        .filter(|rest| !rest.is_empty());
    let rest = after_env.unwrap_or(in_bin);
    match &rest[..word(rest)] {
        b"bun" | b"chakra" | b"d8" | b"deno" | b"gjs" | b"js" | b"node" | b"nodejs" | b"qjs"
        | b"rhino" | b"v8" | b"v8-shell" | b"zx" => Some(b"babel"),
        b"ts-node" | b"tsx" => Some(b"typescript"),
        _ => None,
    }
}

pub(crate) fn language_of(path: &[u8]) -> Language {
    if Kind::of(path, None).is_some() {
        return Language::Supported;
    }
    match paths::basename(path) {
        b".prettierrc" | b".lintstagedrc" | b".stylelintrc" | b".clang-format" => Language::Other,
        _ => Language::Unknown,
    }
}

/// The same for oxfmt, which also has TOML and, if `formats_svelte`, Svelte.
pub(crate) fn language_for_oxfmt(path: &[u8], formats_svelte: bool) -> Language {
    match classify_for_oxfmt(path) {
        Some(ForOxfmt::Kind(_)) => Language::Supported,
        Some(ForOxfmt::Svelte) if formats_svelte => Language::Other,
        Some(ForOxfmt::Svelte) | None => Language::Unknown,
    }
}

/// What each byte weighs in `a.localeCompare(b)`, for what is ASCII: punctuation, then digits, then
/// letters, whether capital or not. Above zero.
const WEIGHTS: [u16; 256] = {
    const ORDER: &[u8] = b"\t\n\r _-,;:!?.'\"()[]{}@*/\\&#%`^+<=>|~$0123456789";
    let mut weights = [0; 256];
    let mut byte = 0;
    while byte < 256 {
        weights[byte] = match byte as u8 {
            letter @ (b'a'..=b'z' | b'A'..=b'Z') => 100 + letter.to_ascii_lowercase() as u16,
            _ => 300 + byte as u16,
        };
        byte += 1;
    }
    let mut at = 0;
    while at < ORDER.len() {
        weights[ORDER[at] as usize] = 1 + at as u16;
        at += 1;
    }
    weights
};

/// What sorts as bytes the way the paths sort with `a.localeCompare(b)`: the weights, and then, for
/// `a` before `A` if nothing else differs, the bytes the other way around.
fn collation_key(path: &[u8]) -> Vec<u8> {
    let mut key = Vec::with_capacity(path.len() * 3 + 2);
    key.extend(
        path.iter()
            .flat_map(|byte| WEIGHTS[usize::from(*byte)].to_be_bytes()),
    );
    key.extend_from_slice(&[0, 0]);
    key.extend(path.iter().map(|byte| !byte));
    key
}

/// Which files are left out.
pub(crate) struct Ignored {
    /// `.git`, `node_modules`, ..
    directories: Vec<&'static [u8]>,
    /// The arguments that start with `!`, from the working directory.
    negative: Vec<Glob>,
    /// `.gitignore`, `.prettierignore`: a file is ignored if one of them says so.
    files: Vec<Chain>,
    cwd: Vec<u8>,
}

impl Ignored {
    pub(crate) fn new(options: &Options, cwd: &[u8], flavor: Flavor) -> Result<Ignored, Fatal> {
        let mut directories: Vec<&[u8]> = vec![b".git", b".sl", b".svn", b".hg", b".jj"];
        if !options.with_node_modules {
            directories.push(b"node_modules");
        }
        // oxfmt reads every `.gitignore` on its way, as Git does.
        let default: &[Vec<u8>] = match flavor {
            Flavor::Prettier => &[b".gitignore".to_vec(), b".prettierignore".to_vec()],
            Flavor::Oxfmt => &[b".prettierignore".to_vec()],
        };
        let mut files = Vec::new();
        for file in options.ignore_path.as_deref().unwrap_or(default) {
            let file = paths::resolve(cwd, &paths::from_native(file));
            if flavor == Flavor::Oxfmt && options.ignore_path.is_some() && !fs::is_file(&file) {
                return Err(Fatal([&file[..], b": File not found"].concat()));
            }
            match fs::read(&file) {
                Ok(text) => files.extend(
                    gitignore::with_text(
                        None,
                        paths::dirname(&file),
                        &text,
                        flavor == Flavor::Oxfmt,
                    )
                    .map(Some),
                ),
                Err(error) if error.get_errno() == bun_sys::E::ENOENT => {}
                Err(error) => {
                    return Err(Fatal(
                        [
                            b"Unable to read '",
                            &paths::relative(cwd, &file)[..],
                            b"': ",
                            &fs::describe(&error),
                        ]
                        .concat(),
                    ));
                }
            }
        }
        Ok(Ignored {
            directories,
            negative: Vec::new(),
            files,
            cwd: cwd.to_vec(),
        })
    }

    /// `DirectoryIgnorer.shouldIgnore`
    fn is_in_ignored_directory(&self, path: &[u8]) -> bool {
        strings::split(&paths::relative(&self.cwd, path), b"/")
            .any(|name| self.directories.contains(&name))
    }

    fn is_negated(&self, path: &[u8]) -> bool {
        !self.negative.is_empty() && {
            let relative = paths::relative(&self.cwd, path);
            self.negative.iter().any(|it| it.matches(&relative))
        }
    }

    /// For what is come to by way of its directories, none of which is ignored.
    fn ignores_entry(&self, path: &[u8], name: &[u8], is_directory: bool) -> bool {
        (is_directory && self.directories.contains(&name))
            || self.is_negated(path)
            || self
                .files
                .iter()
                .any(|chain| gitignore::is_ignored_in_search(chain, path, is_directory))
    }

    /// Whether an ignore file has the directory at `path`, or one that it is in: then it has all that is in it.
    fn ignores_directory(&self, path: &[u8]) -> bool {
        self.files
            .iter()
            .any(|chain| gitignore::is_directory_ignored_anywhere(chain, path))
    }

    /// Prettier's `isIgnored`, for any file.
    pub(crate) fn ignores_file(&self, path: &[u8], config: &Chain) -> bool {
        self.files
            .iter()
            .chain([config])
            .any(|chain| gitignore::is_file_ignored_anywhere(chain, path))
    }
}

struct Directory {
    path: Vec<u8>,
    /// Of the directory that it is in or, for the one that is searched, its own.
    above: Arc<Scope>,
    is_first: bool,
    /// The `.gitignore` files above it or, for the one that is searched, in it too.
    git: Chain,
    /// `ignorePatterns` of the configuration above it have it. It is looked at all the same: a
    /// configuration file in it starts over.
    is_ignored_by_configuration: bool,
}

/// The files in `base` that `matches` says yes to, given the path from the working directory.
fn search(
    configs: &Configs,
    pool: &Pool,
    ignored: &Ignored,
    base: &[u8],
    matches: &(dyn Fn(&[u8]) -> bool + Sync),
    enters: &(dyn Fn(&[u8]) -> bool + Sync),
    reads_gitignore: bool,
) -> Result<Vec<Target>, Fatal> {
    let (mut found, mut failure) = (Guarded::new(Vec::new()), Guarded::new(None::<Fatal>));
    let git = match reads_gitignore {
        true => gitignore::above_and_in(base, &[b".gitignore"]),
        false => None,
    };
    // A `.gitignore` above has it, or a directory that it is in.
    if gitignore::is_directory_ignored_anywhere(&git, base) {
        return Ok(Vec::new());
    }
    let above = configs.for_directory(base)?;
    let mut level = vec![Directory {
        path: base.to_vec(),
        is_first: true,
        git,
        is_ignored_by_configuration: gitignore::is_directory_ignored_anywhere(
            configs.ignores_of(&above),
            base,
        ),
        above,
    }];
    while !level.is_empty() && failure.lock().is_none() {
        let mut next = Guarded::new(Vec::new());
        pool.for_each(level.len(), 1, &|index| {
            let directory = &level[index];
            let Some(mut listing) = fs::list(&directory.path) else {
                return;
            };
            let entries = std::mem::take(&mut listing.entries);
            let scope = match directory.is_first {
                true => Ok(Arc::clone(&directory.above)),
                false => configs.for_listed_directory(
                    &directory.path,
                    entries.iter().map(|it| &it.name[..]),
                    &directory.above,
                ),
            };
            let scope = match scope {
                Ok(scope) => scope,
                Err(error) => {
                    failure.lock().get_or_insert(error);
                    return;
                }
            };
            let of_config = configs.ignores_of(&scope);
            let starts_over = !directory.is_first
                && !std::ptr::eq(configs.ignores_of(&directory.above), of_config);
            let is_ignored_by_configuration = directory.is_ignored_by_configuration && !starts_over;
            let mut git = directory.git.clone();
            if reads_gitignore
                && !directory.is_first
                && entries.iter().any(|it| it.name == b".gitignore")
            {
                git = gitignore::with_file(
                    git,
                    &directory.path,
                    &paths::join(&directory.path, b".gitignore"),
                    true,
                );
            }
            let (mut files, mut directories) = (Vec::new(), Vec::new());
            // Links are not followed, and not formatted.
            for entry in entries.iter().filter(|it| !it.is_link) {
                let path = paths::join(&directory.path, &entry.name);
                if ignored.ignores_entry(&path, &entry.name, entry.is_directory)
                    || gitignore::is_ignored(&git, &path, entry.is_directory)
                {
                    continue;
                }
                let is_ignored_by_configuration = is_ignored_by_configuration
                    || gitignore::is_ignored(of_config, &path, entry.is_directory);
                let relative = paths::relative(&ignored.cwd, &path);
                if entry.is_directory {
                    if enters(&relative) {
                        directories.push(Directory {
                            path,
                            above: Arc::clone(&scope),
                            is_first: false,
                            git: git.clone(),
                            is_ignored_by_configuration,
                        });
                    }
                } else if !is_ignored_by_configuration && matches(&relative) {
                    files.push(Target {
                        path,
                        size: listing.size_of(&entry.name),
                        scope: Arc::clone(&scope),
                        ignores_unknown: false,
                        is_named: false,
                    });
                }
            }
            if !files.is_empty() {
                found.lock().append(&mut files);
            }
            if !directories.is_empty() {
                next.lock().append(&mut directories);
            }
        });
        level = std::mem::take(next.get_mut());
    }
    match failure.get_mut().take() {
        Some(error) => Err(error),
        None => Ok(std::mem::take(found.get_mut())),
    }
}

/// To `micromatch`, `(a|b)` is what `@(a|b)` is. `pattern` with the latter for the former.
fn with_marked_groups(pattern: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(pattern.len() + 2);
    for (at, &byte) in pattern.iter().enumerate() {
        let is_marked = |before: &u8| matches!(before, b'@' | b'?' | b'!' | b'+' | b'*' | b'\\');
        if byte == b'('
            && !out.last().is_some_and(is_marked)
            && strings::contains_char(&pattern[at..], b')')
        {
            out.push(b'@');
        }
        out.push(byte);
    }
    out
}

enum Entry {
    File(Vec<u8>, u64),
    Directory(Vec<u8>),
    Pattern,
}

/// Prettier's `expandPatterns`. `patterns`: the arguments.
pub(crate) fn expand(
    configs: &Configs,
    pool: &Pool,
    ignored: &mut Ignored,
    patterns: &[Vec<u8>],
    error_on_unmatched_pattern: bool,
) -> Result<Vec<Expanded>, Fatal> {
    let cwd = ignored.cwd.clone();
    let mut expanded = Vec::new();
    // With the argument as it is written, which is how Prettier repeats it.
    let mut entries: Vec<(Entry, Vec<u8>, &[u8])> = Vec::new();
    for written in patterns {
        let pattern = paths::from_native(written);
        let path = paths::resolve(&cwd, &pattern);
        if ignored.is_in_ignored_directory(&path) {
            continue;
        }
        match fs::link_kind_and_size(&path) {
            Some((fs::LinkKind::Link, _)) => {
                if error_on_unmatched_pattern {
                    expanded.push(Expanded::Error(
                        [
                            b"Explicitly specified pattern \"",
                            &written[..],
                            b"\" is a symbolic link.",
                        ]
                        .concat(),
                    ));
                }
            }
            Some((fs::LinkKind::File, size)) => {
                entries.push((Entry::File(path, size), pattern, &written[..]))
            }
            Some((fs::LinkKind::Directory, _)) => {
                entries.push((Entry::Directory(path), pattern, &written[..]))
            }
            None => match pattern.strip_prefix(b"!") {
                Some(negative) => ignored
                    .negative
                    .push(Glob::new(negative.strip_prefix(b"./").unwrap_or(negative))),
                None => entries.push((Entry::Pattern, pattern, &written[..])),
            },
        }
    }
    let ignored = &*ignored;
    let mut seen: FxHashSet<Vec<u8>> = FxHashSet::default();
    let mut is_anything_ignored = false;
    for (entry, input, written) in entries {
        // What the paths that `fast-glob` returns start with, which they are sorted by.
        let mut written_base: (Vec<u8>, Vec<u8>) = (Vec::new(), cwd.clone());
        let (mut found, nothing): (Vec<Target>, &[u8]) = match entry {
            Entry::File(path, size) => {
                // The configuration of a file that is ignored is not even read.
                if ignored.ignores_file(&path, &None) {
                    is_anything_ignored = true;
                    continue;
                }
                let found = match ignored.is_negated(&path) {
                    true => Vec::new(),
                    false => vec![Target {
                        scope: configs.for_directory(paths::dirname(&path))?,
                        path,
                        size,
                        ignores_unknown: false,
                        is_named: true,
                    }],
                };
                (
                    found,
                    b"Explicitly specified file was ignored due to negative glob patterns",
                )
            }
            Entry::Directory(path) => {
                // Prettier finds the files and then leaves each of them out, so this is no error.
                if ignored.ignores_directory(&path) {
                    is_anything_ignored = true;
                    continue;
                }
                let mut found = search(configs, pool, ignored, &path, &|_| true, &|_| true, false)?;
                found.iter_mut().for_each(|it| it.ignores_unknown = true);
                written_base = (paths::relative(&cwd, &path), path);
                (found, b"No supported files were found in the directory")
            }
            Entry::Pattern => {
                // `removeLeadingDotSegment` of `fast-glob`
                let pattern = &with_marked_groups(input.strip_prefix(b"./").unwrap_or(&input));
                let glob = Glob::new(pattern);
                let parent = paths::glob_parent(pattern);
                let base = paths::resolve(&cwd, &parent);
                if parent != b"." {
                    written_base = (parent, base.clone());
                }
                // `fast-glob` matches a path as the pattern writes where it starts: what an absolute pattern finds is absolute.
                let is_absolute = paths::is_absolute(pattern);
                let absolute = |relative: &[u8]| {
                    let from_base = paths::relative(&base, &paths::resolve(&cwd, relative));
                    paths::join(&written_base.0, &from_base)
                };
                let found = match fs::kind(&base) {
                    Some(fs::Kind::Directory) if ignored.ignores_directory(&base) => {
                        is_anything_ignored = true;
                        continue;
                    }
                    Some(fs::Kind::Directory) => search(
                        configs,
                        pool,
                        ignored,
                        &base,
                        &|relative| match is_absolute {
                            true => glob.matches(&absolute(relative)),
                            false => glob.matches(relative),
                        },
                        &|relative| match is_absolute {
                            true => glob.matches_partially(&absolute(relative)),
                            false => glob.matches_partially(relative),
                        },
                        false,
                    )?,
                    _ => Vec::new(),
                };
                (found, b"No files matching the pattern were found")
            }
        };
        if found.is_empty() {
            if error_on_unmatched_pattern {
                expanded.push(Expanded::Error(
                    [nothing, b": \"", written, b"\"."].concat(),
                ));
            }
            continue;
        }
        let key = |target: &Target| match &written_base.0[..] {
            b"" => paths::relative(&written_base.1, &target.path),
            written => paths::join(written, &paths::relative(&written_base.1, &target.path)),
        };
        index_sort::sort_slice_by_cached_key(&mut found[..], |target| collation_key(&key(target)));
        for target in found {
            if seen.insert(target.path.clone()) {
                expanded.push(Expanded::File(target));
            }
        }
    }
    if expanded.is_empty() && !is_anything_ignored && error_on_unmatched_pattern {
        let patterns = patterns.join(&b' ');
        expanded.push(Expanded::Error(
            [b"No matching files. Patterns: ", &patterns[..]].concat(),
        ));
    }
    Ok(expanded)
}

/// oxfmt's `ScopedWalker`. `patterns`: the arguments.
pub(crate) fn expand_as_oxfmt(
    configs: &Configs,
    pool: &Pool,
    ignored: &mut Ignored,
    patterns: &[Vec<u8>],
    error_on_unmatched_pattern: bool,
) -> Result<Vec<Expanded>, Fatal> {
    let cwd = ignored.cwd.clone();
    let (mut targets, mut globs, mut excluded) = (Vec::new(), Vec::new(), Vec::new());
    for pattern in patterns {
        let pattern = paths::from_native(pattern);
        if let Some(rest) = pattern.strip_prefix(b"!") {
            excluded.push(rest.to_vec());
            continue;
        }
        let mut normalized = &pattern[..];
        if let Some(rest) = normalized.strip_prefix(b"./") {
            normalized = rest;
            while let Some(rest) = normalized.strip_prefix(b"/") {
                normalized = rest;
            }
        }
        let path = paths::resolve(&cwd, normalized);
        // What is there is not a pattern, whatever it looks like.
        match strings::index_of_any(normalized, b"*?[{").is_some() && !bun_sys::exists(&path) {
            true => match FastGlob::refusal(normalized) {
                Some(refusal) => return Err(Fatal(refusal)),
                None => globs.push(glob_of_oxc(normalized)),
            },
            false => targets.push(path),
        }
    }
    // In the format of `.gitignore`, unlike Prettier's.
    ignored
        .files
        .extend(gitignore::with_text(None, &cwd, &excluded.join(&b'\n'), true).map(Some));
    let ignored = &*ignored;
    if !globs.is_empty() || targets.is_empty() {
        targets.push(cwd);
    }
    index_sort::sort_slice(&mut targets[..]);
    targets.dedup();

    let mut found: Vec<Target> = Vec::new();
    for path in targets {
        let Some((kind, size)) = fs::kind_and_size(&path) else {
            continue;
        };
        let is_directory = kind == fs::Kind::Directory;
        let is_ignored = |chain: &Chain| match is_directory {
            true => gitignore::is_directory_ignored_anywhere(chain, &path),
            false => gitignore::is_file_ignored_anywhere(chain, &path),
        };
        if ignored.files.iter().any(is_ignored) {
            continue;
        }
        if is_directory {
            let matches =
                |relative: &[u8]| globs.is_empty() || globs.iter().any(|it| it.matches(relative));
            found.append(&mut search(
                configs,
                pool,
                ignored,
                &path,
                &matches,
                &|_| true,
                true,
            )?);
            continue;
        }
        let scope = configs.for_directory(paths::dirname(&path))?;
        if !is_ignored(configs.ignores_of(&scope)) {
            found.push(Target {
                path,
                size,
                scope,
                ignores_unknown: true,
                is_named: false,
            });
        }
    }
    // Nothing is said about a file that there is no parser for, and it does not count.
    found.retain(|it| {
        language_for_oxfmt(&it.path, configs.formats_svelte(&it.scope)) != Language::Unknown
    });
    index_sort::sort_slice_by(&mut found[..], |a, b| a.path.cmp(&b.path));
    found.dedup_by(|a, b| a.path == b.path);
    if found.is_empty() && error_on_unmatched_pattern {
        let error = b"Expected at least one target file. All matched files may have been excluded by ignore rules.";
        return Ok(vec![Expanded::Error(error.to_vec())]);
    }
    Ok(found.into_iter().map(Expanded::File).collect())
}
