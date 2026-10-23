//! Prints the results.

mod excerpt;
mod github;
mod info;
mod json;
pub(crate) mod oxlint;
mod oxlint_fixes;
mod oxlint_gitlab_sarif;
mod oxlint_json_agent;
mod stylish;
pub(crate) mod summary;
mod unix;
mod xml;

use crate::paths;
use crate::results::{Counts, FileResult};
use crate::run::Pool;
use bun_core::fmt::{TerminalHyperlink, escape_control_chars_multiline};
use bun_core::strings;
use bun_lint::linter::{LintMessage, RuleId};
use std::borrow::Cow;

/// `--format`
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum Format {
    Stylish,
    Json,
    JsonWithMetadata,
    Unix,
    /// Shows the code around each problem, like `bun check`'s errors in a terminal.
    Pretty,
    /// The same in tags, for a language model.
    Agent,
    /// GitHub Actions workflow commands.
    Github,
    /// oxlint's `default`: `pretty`, followed by everything else oxlint prints.
    OxlintDefault,
    /// oxlint's format of the same name, byte for byte except in a terminal: [`link`], [`escaped`].
    OxlintStylish,
    OxlintJson,
    OxlintUnix,
    OxlintAgent,
    OxlintGithub,
    /// These four are the same with every config.
    Checkstyle,
    Junit,
    Gitlab,
    Sarif,
}

impl Format {
    pub(crate) const NAMES: &'static str = "stylish, pretty, json, json-with-metadata, unix, github, agent, checkstyle, junit, gitlab, sarif";

    /// The error for the unknown format `name`.
    pub(crate) fn unknown_format_error(name: &[u8]) -> Vec<u8> {
        [
            b"Unknown format \"",
            name,
            b"\"\n  Available formats: ",
            Format::NAMES.as_bytes(),
        ]
        .concat()
    }

    /// With `is_oxlint`, the config is oxlint's, so the names mean oxlint's formats.
    pub(crate) fn by_name(name: &[u8], is_oxlint: bool) -> Option<Format> {
        Some(match name {
            b"json-with-metadata" => Format::JsonWithMetadata,
            b"default" | b"pretty" if is_oxlint => Format::OxlintDefault,
            b"stylish" if is_oxlint => Format::OxlintStylish,
            b"json" if is_oxlint => Format::OxlintJson,
            b"unix" if is_oxlint => Format::OxlintUnix,
            b"agent" if is_oxlint => Format::OxlintAgent,
            b"github" if is_oxlint => Format::OxlintGithub,
            b"default" | b"pretty" => Format::Pretty,
            b"stylish" => Format::Stylish,
            b"json" => Format::Json,
            b"unix" => Format::Unix,
            b"agent" => Format::Agent,
            b"github" => Format::Github,
            b"checkstyle" => Format::Checkstyle,
            b"junit" => Format::Junit,
            b"gitlab" => Format::Gitlab,
            b"sarif" => Format::Sarif,
            _ => return None,
        })
    }

    /// True if the output is oxlint's entire standard output, including the final newline if there is one.
    pub(crate) fn is_oxlint_output(self) -> bool {
        matches!(
            self,
            Format::OxlintDefault
                | Format::OxlintStylish
                | Format::OxlintJson
                | Format::OxlintUnix
                | Format::OxlintAgent
                | Format::OxlintGithub
                | Format::Checkstyle
                | Format::Junit
                | Format::Gitlab
                | Format::Sarif
        )
    }

    /// True for `stylish` in a terminal: control characters print as text there ([`escaped`]).
    pub(crate) fn escapes(self, to_terminal: bool) -> bool {
        to_terminal && matches!(self, Format::Stylish | Format::OxlintStylish)
    }

    /// True if it's meant for people and isn't parsed by tools.
    pub(crate) fn is_human_readable(self) -> bool {
        matches!(
            self,
            Format::Pretty | Format::Stylish | Format::OxlintDefault | Format::OxlintStylish
        )
    }

    /// True if it reads [`FileResult::text`]. oxlint's formats print byte offsets, which the messages don't have.
    pub(crate) fn reads_text(self) -> bool {
        self.is_oxlint_output()
            || matches!(
                self,
                Format::Json | Format::JsonWithMetadata | Format::Pretty | Format::Agent
            )
    }

    /// True if it prints [`LintMessage::suppressions`](bun_lint::linter::LintMessage::suppressions).
    pub(crate) fn reads_suppressions(self) -> bool {
        matches!(self, Format::Json | Format::JsonWithMetadata)
    }

    /// True if it prints [`LintMessage::help`](bun_lint::linter::LintMessage::help).
    pub(crate) fn reads_help(self) -> bool {
        matches!(
            self,
            Format::Pretty
                | Format::Agent
                | Format::OxlintDefault
                | Format::OxlintJson
                | Format::OxlintAgent
        )
    }

    /// True if, when there are many problems, it prints only some of them in full unless `--all` is passed.
    pub(crate) fn groups(self) -> bool {
        matches!(self, Format::Pretty | Format::Agent | Format::OxlintDefault)
    }

    /// True if it prints fixes or suggestions.
    pub(crate) fn reads_fix_texts(self) -> bool {
        matches!(self, Format::Json | Format::JsonWithMetadata)
    }

    /// True if it prints fixes or suggestions, or counts what can be fixed.
    pub(crate) fn reads_fixes(self) -> bool {
        matches!(
            self,
            Format::Stylish
                | Format::Pretty
                | Format::Json
                | Format::JsonWithMetadata
                | Format::Agent
        )
    }
}

/// [`Context::with_help`](crate::lint::Context::with_help)
pub(crate) type WithHelp<'m> =
    &'m (dyn Fn(&FileResult, Option<&[&RuleId]>) -> Vec<LintMessage> + Sync);

/// ESLint's `ResultsMeta`, plus whatever else a format needs.
pub(crate) struct Meta<'m> {
    /// Set if the messages don't have their help text yet.
    pub(crate) help: Option<WithHelp<'m>>,
    pub(crate) cwd: &'m [u8],
    pub(crate) color: bool,
    /// The report goes to a terminal: not to a pipe, and not to the file of `-o`.
    pub(crate) to_terminal: bool,
    /// [`Format::escapes`]
    pub(crate) escapes: bool,
    /// Width in columns of the terminal the report goes to. 0 if it doesn't go to a terminal.
    pub(crate) width: usize,
    /// `--color`, `--no-color`
    pub(crate) color_option: Option<bool>,
    /// `maxWarnings` and `foundWarnings`, if the limit is exceeded.
    pub(crate) max_warnings_exceeded: Option<(i64, usize)>,
    /// The totals, including what `--quiet` and `--silent` hide.
    pub(crate) found: Counts,
    /// How many files `--fix` wrote.
    pub(crate) fixed: usize,
    /// Set if this run wrote `oxlint-suppressions.json`. `Some(true)` if the file already existed.
    pub(crate) updated_suppressions: Option<bool>,
    /// `--all`: don't group identical problems.
    pub(crate) shows_all: bool,
    /// Also print the `github` format, because this runs in GitHub Actions.
    pub(crate) github_annotations: bool,
    pub(crate) run: oxlint::Run,
    /// The config is oxlint's, so the output names oxlint as the tool.
    pub(crate) is_oxlint: bool,
    /// No ESLint or oxlint config applies.
    pub(crate) is_native: bool,
    pub(crate) pool: &'m Pool,
    /// Bun's version.
    pub(crate) version: &'m [u8],
}

/// The line and column of `message` for a format that ESLint doesn't have. `is_oxlint` is [`Meta::is_oxlint`]. With it,
/// a report at line 0 has no location.
fn display_position(message: &LintMessage, is_oxlint: bool) -> (u32, u32) {
    match is_oxlint {
        true => (message.line, message.column),
        false => message.line_and_column(),
    }
}

/// Wraps `name`, which is a format's name for the rule behind `message`, in a hyperlink to the rule's docs page. `None` if
/// the report doesn't go to a terminal with colors, or the rule has no page.
fn link(name: &[u8], message: &LintMessage, meta: &Meta) -> Option<Vec<u8>> {
    let url = message
        .rule_id
        .as_ref()
        .filter(|_| meta.color && meta.to_terminal)?
        .docs_url()?;
    Some(format!("{}", TerminalHyperlink::new(&url, name, true)).into_bytes())
}

/// Same as [`link`], but falls back to plain `name`.
fn linked<'n>(name: &'n [u8], message: &LintMessage, meta: &Meta) -> Cow<'n, [u8]> {
    link(name, message, meta).map_or(Cow::Borrowed(name), Cow::Owned)
}

/// A part of a `stylish` report that a linted file or the config has a say in.
#[derive(Copy, Clone)]
enum Cell {
    /// A path or a rule name: one line.
    Name,
    /// Keeps its tabs and line breaks: a rule's message can have several lines.
    Message,
}

/// `text` as `stylish` prints it in `cell`: with control characters as text such as `\x1b`, if the report escapes.
#[inline]
fn escaped<'t>(cell: Cell, text: &'t [u8], meta: &Meta) -> Cow<'t, [u8]> {
    match meta.escapes {
        true => escape(cell, text),
        false => Cow::Borrowed(text),
    }
}

/// [`escaped`] for a report that escapes.
#[inline(never)]
fn escape(cell: Cell, text: &[u8]) -> Cow<'_, [u8]> {
    // The escapers stop where this does. Most text has no such byte.
    if strings::index_of_needs_escape_for_java_script_string(text, b'"').is_none() {
        return Cow::Borrowed(text);
    }
    Cow::Owned(match cell {
        Cell::Name => paths::escaped(text),
        Cell::Message => escape_control_chars_multiline(text)
            .to_string()
            .into_bytes(),
    })
}

/// Returns what ESLint's formatter of that name returns for `results`, which are sorted by path, or what oxlint prints.
/// In a terminal, `stylish` differs from both: [`link`], [`escaped`].
pub(crate) fn format(format: Format, results: &[FileResult], meta: &Meta) -> Vec<u8> {
    let mut out = Vec::new();
    match format {
        Format::Stylish => stylish::write(&mut out, results, meta),
        Format::Json => json::write_results(&mut out, results, meta),
        Format::JsonWithMetadata => json::write_with_metadata(&mut out, results, meta),
        Format::Unix => unix::write(&mut out, results),
        Format::Pretty => excerpt::write_pretty(&mut out, results, meta),
        Format::Agent => excerpt::write_agent(&mut out, results, meta),
        Format::Github => excerpt::write_github(&mut out, results, meta),
        Format::OxlintDefault => summary::write_default(&mut out, results, meta),
        Format::OxlintStylish => stylish::write_as_oxlint(&mut out, results, meta),
        Format::OxlintJson => oxlint_json_agent::write_json(&mut out, results, meta),
        Format::OxlintUnix => unix::write_as_oxlint(&mut out, results, meta),
        Format::OxlintAgent => oxlint_json_agent::write_agent(&mut out, results, meta),
        Format::OxlintGithub => github::write(&mut out, results, meta),
        Format::Checkstyle => xml::write_checkstyle(&mut out, results, meta),
        Format::Junit => xml::write_junit(&mut out, results, meta),
        Format::Gitlab => oxlint_gitlab_sarif::write_gitlab(&mut out, results, meta),
        Format::Sarif => oxlint_gitlab_sarif::write_sarif(&mut out, results, meta),
    }
    out
}

/// Returns the extra output for GitHub Actions: a workflow command for each problem, or nothing. `report_is_elsewhere`
/// means the report itself doesn't go to standard output, where these commands go.
pub(crate) fn annotations(
    format: Format,
    results: &[FileResult],
    meta: &Meta,
    report_is_elsewhere: bool,
) -> Vec<u8> {
    let mut out = Vec::new();
    // Never mixed into output that a program parses, and never printed twice.
    let is_allowed_here = match format {
        Format::Stylish | Format::Pretty => true,
        Format::Github => false,
        _ => report_is_elsewhere,
    };
    if meta.github_annotations
        && is_allowed_here
        && results.iter().any(|it| !it.messages.is_empty())
    {
        excerpt::write_github(&mut out, results, meta);
    }
    out
}
