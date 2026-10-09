//! The scripts in `.vue`, `.svelte` and `.astro` files, with a configuration of oxlint.
//!
//! They are found as oxlint finds them, by searching the text: nothing is parsed but the scripts. Each is a program of its own,
//! which knows nothing of the other scripts of the file or of the template.

use crate::lint::{Context, RuleFilter};
use bun_core::strings;
use bun_lint::ast::{ExprKind, File, PropKind, StmtKind, VueScript};
use bun_lint::context::Severity;
use bun_lint::fix::Fix;
use bun_lint::linter::config::oxlint_runs_on;
use bun_lint::linter::{LintMessage, LintResult, ResolvedConfig, RuleId};
use bun_lint::rule::Plugin;
use bun_sema::resolve::ScriptKind;

/// What kind of file has scripts in it.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum Framework {
    Vue,
    Svelte,
    Astro,
}

impl Framework {
    /// By the name of the file.
    pub(crate) fn of(path: &[u8]) -> Option<Framework> {
        let name = crate::paths::basename(path);
        match &name[strings::last_index_of_char(name, b'.')?..] {
            b".vue" => Some(Framework::Vue),
            b".svelte" => Some(Framework::Svelte),
            b".astro" => Some(Framework::Astro),
            _ => None,
        }
    }
}

/// A script: where it is in the text of the file, and in what language.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
struct Script {
    start: usize,
    end: usize,
    kind: ScriptKind,
    /// `<script setup>` of Vue.
    is_setup: bool,
}

const SCRIPT_START: &[u8] = b"<script";
const SCRIPT_END: &[u8] = b"</script>";

fn is_space(byte: u8) -> bool {
    byte.is_ascii_whitespace() || byte == 0x0B
}

/// `SourceType::from_extension`
fn kind_of(lang: &[u8]) -> Option<ScriptKind> {
    match lang {
        b"js" | b"mjs" | b"cjs" => Some(ScriptKind::Js),
        b"jsx" => Some(ScriptKind::Jsx),
        b"ts" | b"mts" | b"cts" => Some(ScriptKind::Ts),
        b"tsx" => Some(ScriptKind::Tsx),
        _ => None,
    }
}

/// `find_script_closing_angle`: how far from `from` the `>` is that ends the tag. There can be others before it, in a string, between
/// braces or after a `<`.
fn closing_angle(text: &[u8], from: usize) -> Option<usize> {
    let (mut angles, mut braces) = (0u32, 0u32);
    let mut quote = None;
    for (offset, &byte) in text.get(from..)?.iter().enumerate() {
        match byte {
            b'"' | b'\'' => match quote {
                Some(open) if open == byte => quote = None,
                Some(_) => {}
                None if braces == 0 => quote = Some(byte),
                None => {}
            },
            _ if quote.is_some() => {}
            b'{' => braces += 1,
            b'}' if braces > 0 => braces -= 1,
            b'<' if braces == 0 => angles += 1,
            b'>' if braces == 0 && angles == 0 => return Some(offset),
            b'>' if braces == 0 => angles -= 1,
            _ => {}
        }
    }
    None
}

/// `find_script_start`: the end of the next `<script` after `from` that is not in a comment.
fn script_start(text: &[u8], from: usize) -> Option<usize> {
    let mut at = from;
    loop {
        at += strings::index_of(text.get(at..)?, SCRIPT_START)? + SCRIPT_START.len();
        match strings::last_index_of(&text[..at], b"<!--") {
            Some(comment) if !strings::contains(&text[comment + 4..at], b"-->") => {}
            _ => return Some(at),
        }
    }
}

/// `find_attribute`: the value of the attribute `target` of a tag, of which `content` is what follows the name. `Some(None)`: it
/// has none.
fn attribute<'t>(content: &'t [u8], target: &[u8]) -> Option<Option<&'t [u8]>> {
    let mut rest = content.trim_ascii();
    loop {
        let skipped = rest.iter().take_while(|&&it| is_space(it) || it == b'/');
        rest = &rest[skipped.count()..];
        if rest.is_empty() || rest[0] == b'>' {
            return None;
        }
        let is_end_of_name = |it: &u8| is_space(*it) || matches!(it, b'=' | b'>' | b'/');
        let name_end = rest.iter().position(is_end_of_name).unwrap_or(rest.len());
        if name_end == 0 {
            return None;
        }
        let name = &rest[..name_end];
        rest = rest[name_end..].trim_ascii_start();
        let mut value = None;
        if let [b'=', after @ ..] = rest {
            rest = after.trim_ascii_start();
            match rest {
                [quote @ (b'"' | b'\''), after @ ..] => {
                    let end = strings::index_of_char_usize(after, *quote)?;
                    value = Some(&after[..end]);
                    rest = &after[end + 1..];
                }
                [] => return None,
                _ => {
                    let is_end = |it: &u8| is_space(*it) || matches!(it, b'>' | b'/');
                    let end = rest.iter().position(is_end).unwrap_or(rest.len());
                    value = Some(&rest[..end]);
                    rest = &rest[end..];
                }
            }
        }
        if name.eq_ignore_ascii_case(target) {
            return Some(value);
        }
    }
}

/// `VuePartialLoader::extract_lang_attribute`, which looks for the letters.
fn lang_of_vue(content: &[u8]) -> &[u8] {
    let content = content.trim_ascii();
    let Some(at) = strings::index_of(content, b"lang") else {
        return b"mjs";
    };
    let [b'=', rest @ ..] = content[at + 4..].trim_ascii_start() else {
        return b"mjs";
    };
    match rest.trim_ascii_start() {
        [quote @ (b'"' | b'\''), rest @ ..] => match strings::index_of_char_usize(rest, *quote) {
            Some(end) => &rest[..end],
            None => b"mjs",
        },
        [] => b"mjs",
        rest => {
            let is_end = |it: &u8| is_space(*it) || *it == b'>';
            &rest[..rest.iter().position(is_end).unwrap_or(rest.len())]
        }
    }
}

/// From `start`, which is after the tag, to the next `</script>`. Returns the script, and where the search goes on.
fn until_end(text: &[u8], start: usize, kind: ScriptKind) -> Option<(Script, usize)> {
    let end = start + strings::index_of(&text[start..], SCRIPT_END)?;
    let script = Script {
        start,
        end,
        kind,
        is_setup: false,
    };
    Some((script, end + SCRIPT_END.len()))
}

/// `VuePartialLoader::parse_script`
fn script_of_vue(text: &[u8], mut at: usize) -> Option<(Script, usize)> {
    loop {
        at = script_start(text, at)?;
        // Not `<script-`.
        if matches!(text.get(at), Some(b' ' | b'>')) {
            break;
        }
    }
    let tag = closing_angle(text, at)?;
    let kind = kind_of(lang_of_vue(&text[at..at + tag]))?;
    let (mut script, after) = until_end(text, at + tag + 1, kind)?;
    // Wherever it is in the tag.
    script.is_setup = strings::contains(&text[at..at + tag], b"setup");
    Some((script, after))
}

/// `SveltePartialLoader::parse_script`
fn script_of_svelte(text: &[u8], mut at: usize) -> Option<(Script, usize)> {
    loop {
        at = script_start(text, at)?;
        if text.get(at).is_some_and(|&it| is_space(it) || it == b'>') {
            break;
        }
    }
    let tag = closing_angle(text, at)?;
    let lang = attribute(&text[at..at + tag], b"lang").flatten();
    let kind = lang.and_then(kind_of).unwrap_or(ScriptKind::Js);
    until_end(text, at + tag + 1, kind)
}

/// `AstroPartialLoader::is_fence`: `---` at `at` is alone on its line.
fn is_fence(text: &[u8], at: usize) -> bool {
    let line_start = strings::last_index_of_char(&text[..at], b'\n').map_or(0, |it| it + 1);
    let after = &text[at + 3..];
    let line_end = strings::index_of_char_usize(after, b'\n').unwrap_or(after.len());
    text[line_start..at].iter().all(|&it| is_space(it))
        && after[..line_end].iter().all(|&it| is_space(it))
}

/// `AstroPartialLoader::parse_frontmatter`
fn frontmatter(text: &[u8]) -> Option<Script> {
    let mut from = 0;
    let mut next_fence = || loop {
        let at = from + strings::index_of(&text[from..], b"---")?;
        from = at + 3;
        if is_fence(text, at) {
            return Some(at);
        }
    };
    let start = next_fence()?;
    if !text[..start].iter().all(|&it| is_space(it)) {
        return None;
    }
    Some(Script {
        start: start + 3,
        end: next_fence()?,
        kind: ScriptKind::Ts,
        is_setup: false,
    })
}

/// `AstroPartialLoader::is_javascript_script`
fn is_javascript(tag: &[u8]) -> bool {
    let Some(Some(value)) = attribute(tag, b"type") else {
        return true;
    };
    let value = value.trim_ascii();
    let kind =
        value[..strings::index_of_char_usize(value, b';').unwrap_or(value.len())].trim_ascii();
    kind.is_empty()
        || [
            &b"module"[..],
            b"text/javascript",
            b"application/javascript",
            b"text/ecmascript",
            b"application/ecmascript",
        ]
        .iter()
        .any(|it| kind.eq_ignore_ascii_case(it))
}

/// `AstroPartialLoader::parse`
fn scripts_of_astro(text: &[u8]) -> Vec<Script> {
    let mut scripts: Vec<Script> = frontmatter(text).into_iter().collect();
    let mut at = scripts.first().map_or(0, |it| it.end + 3);
    while let Some(tag_start) = script_start(text, at)
        && let Some(tag) = closing_angle(text, tag_start)
    {
        let start = tag_start + tag + 1;
        let script = match text[start - 2] {
            // The tag closes itself.
            b'/' => {
                at = start;
                Script {
                    start,
                    end: start,
                    kind: ScriptKind::Ts,
                    is_setup: false,
                }
            }
            _ => match until_end(text, start, ScriptKind::Ts) {
                Some((script, after)) => {
                    at = after;
                    script
                }
                None => break,
            },
        };
        if is_javascript(&text[tag_start..tag_start + tag]) {
            scripts.push(script);
        }
    }
    scripts
}

fn scripts_of(framework: Framework, text: &[u8]) -> Vec<Script> {
    let next = match framework {
        Framework::Vue => script_of_vue,
        Framework::Svelte => script_of_svelte,
        Framework::Astro => return scripts_of_astro(text),
    };
    // A file has two at most.
    let Some((first, after)) = next(text, 0) else {
        return Vec::new();
    };
    match next(text, after) {
        Some((second, _)) => vec![first, second],
        None => vec![first],
    }
}

/// `should_run` of the rules of oxlint 1.80 that go by these names of files: what the template uses or assigns to cannot be told,
/// and `$:` is Svelte's. Each rule was tried.
fn runs(framework: Framework, is_typescript: bool, rule: &RuleId) -> bool {
    let RuleId::Known(meta) = rule else {
        return true;
    };
    let is_off = match (meta.plugin, meta.name) {
        (Plugin::Eslint | Plugin::TypeScript, "no-unused-vars")
        | (Plugin::TypeScript, "consistent-type-imports") => true,
        (Plugin::Eslint, "no-unused-labels") => framework == Framework::Svelte,
        (Plugin::Eslint, "prefer-const") | (Plugin::ReactHooks, "rules-of-hooks") => {
            framework != Framework::Astro
        }
        _ => false,
    };
    !is_off && oxlint_runs_on(meta, is_typescript)
}

/// Where a script starts.
#[derive(Copy, Clone)]
struct Origin {
    /// In bytes.
    offset: u32,
    /// How many lines are before its first.
    lines: u32,
    /// How many UTF-16 code units are before it on its first line.
    columns: u32,
}

impl Origin {
    fn of(text: &[u8], offset: usize) -> Origin {
        let before = &text[..offset];
        let (mut lines, mut line_start, mut at) = (0, 0, 0);
        // ESLint's line breaks.
        while let Some(found) = strings::index_of_any(&before[at..], b"\r\n\xE2") {
            at += found;
            at += match &before[at..] {
                [b'\r', b'\n', ..] => 2,
                [b'\r' | b'\n', ..] => 1,
                [0xE2, 0x80, 0xA8 | 0xA9, ..] => 3,
                _ => {
                    at += 1;
                    continue;
                }
            };
            (lines, line_start) = (lines + 1, at);
        }
        Origin {
            offset: offset as u32,
            lines,
            columns: bun_lint::source::utf16_len(&before[line_start..]),
        }
    }

    fn position(self, (line, column): (u32, u32)) -> (u32, u32) {
        let columns = if line == 1 { self.columns } else { 0 };
        (line + self.lines, column + columns)
    }

    fn fix(self, fix: &mut Fix) {
        fix.span.start += self.offset;
        fix.span.end += self.offset;
    }

    /// Makes a message about the script one about the file.
    fn message(self, message: &mut LintMessage) {
        if message.line > 0 {
            (message.line, message.column) = self.position((message.line, message.column));
        }
        message.end = message.end.map(|it| self.position(it));
        message.comments_apply_at = message
            .comments_apply_at
            .map(|(start, end)| (self.position(start), self.position(end)));
        for (start, end, _) in message.details.iter_mut().flat_map(|it| &mut it.labels) {
            (*start, *end) = (self.position(*start), self.position(*end));
        }
        message.fix.iter_mut().for_each(|it| self.fix(it));
        for suggestion in &mut message.suggestions {
            self.fix(&mut suggestion.fix);
        }
    }
}

/// oxlint's `has_default_exports_property`: there is an `export default { name: .. }`.
fn has_default_exports_property<'a>(file: &'a File<'a>, name: &str) -> bool {
    file.body().iter().any(|stmt| match stmt.kind() {
        StmtKind::ExportDefault(e) if !e.is_parenthesized() => match e.kind() {
            ExprKind::Object(properties) => properties.iter().any(|it| {
                it.kind() != PropKind::Spread
                    && (it.key().and_then(|key| key.name())).is_some_and(|key| key.is(name))
            }),
            _ => false,
        },
        _ => false,
    })
}

/// Whether a rule is on that asks what the other script of a `.vue` file exports.
fn asks_for_exports(config: &ResolvedConfig) -> bool {
    config.rules.iter().any(|it| {
        it.severity != Severity::Off
            && it.entry.meta.plugin == Plugin::Vue
            && matches!(
                it.entry.meta.name,
                "valid-define-props" | "valid-define-emits"
            )
    })
}

/// What the script at `index` of a `.vue` file with the text `text` knows of the other.
fn vue_script(text: &[u8], scripts: &[Script], index: usize, config: &ResolvedConfig) -> VueScript {
    let is_setup = scripts.get(index).is_some_and(|it| it.is_setup);
    let Some(other) = scripts.get(1 - index.min(1)).filter(|_| scripts.len() == 2) else {
        return VueScript {
            is_setup,
            ..VueScript::default()
        };
    };
    let name: &[u8] = match other.kind {
        ScriptKind::Ts => b"a.ts",
        ScriptKind::Tsx => b"a.tsx",
        ScriptKind::Jsx => b"a.jsx",
        ScriptKind::Js => b"a.js",
    };
    let exports = asks_for_exports(config).then(|| {
        let code = &text[other.start..other.end];
        bun_lint_graph::with_file(name, code, &config.language, None, |file| {
            (
                has_default_exports_property(file, "props"),
                has_default_exports_property(file, "emits"),
            )
        })
    });
    let (other_exports_props, other_exports_emits) = exports.flatten().unwrap_or_default();
    VueScript {
        is_second: index > 0,
        is_setup,
        other_is_setup: other.is_setup,
        other_exports_props,
        other_exports_emits,
    }
}

impl Context<'_, '_> {
    /// Lints the scripts in `text`, which is the file at `path`.
    pub(crate) fn verify_scripts(
        &self,
        framework: Framework,
        path: &[u8],
        text: &[u8],
        config: &ResolvedConfig,
    ) -> LintResult {
        let outer = self.lint_options().rule_filter;
        self.verify_scripts_by(framework, path, text, config, outer)
    }

    /// The same. `outer`: which rules run, of those that run on such a script.
    pub(crate) fn verify_scripts_by(
        &self,
        framework: Framework,
        path: &[u8],
        text: &[u8],
        config: &ResolvedConfig,
        outer: Option<&RuleFilter>,
    ) -> LintResult {
        let mut all = LintResult::default();
        let scripts = scripts_of(framework, text);
        for (index, &script) in scripts.iter().enumerate() {
            let is_typescript = matches!(script.kind, ScriptKind::Ts | ScriptKind::Tsx);
            let filter = |rule: &RuleId, severity: Severity| {
                runs(framework, is_typescript, rule)
                    && outer.is_none_or(|outer| outer(rule, severity))
            };
            let code = &text[script.start..script.end];
            let vue = match framework {
                Framework::Vue => vue_script(text, &scripts, index, config),
                _ => VueScript {
                    is_second: index > 0,
                    ..VueScript::default()
                },
            };
            let mut result = self.verify_script(path, code, config, (script.kind, vue), &filter);
            if result.thrown.is_some() {
                return result;
            }
            let origin = Origin::of(text, script.start);
            for message in result.messages.iter_mut().chain(&mut result.suppressed) {
                origin.message(message);
            }
            all.messages.append(&mut result.messages);
            all.suppressed.append(&mut result.suppressed);
            all.skipped_rules.append(&mut result.skipped_rules);
            all.handed_back = all.handed_back.or(result.handed_back);
        }
        all
    }
}
