//! Prints the results.

mod excerpt;
mod json;
pub(crate) mod oxlint;
mod stylish;
mod unix;

use crate::results::FileResult;
use crate::run::Pool;

/// `--format`
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum Format {
    Stylish,
    Json,
    JsonWithMetadata,
    Unix,
    /// With the code around each problem, as `bun check` prints errors in a terminal.
    Pretty,
    /// The same in tags, for a language model.
    Agent,
    /// Workflow commands of GitHub Actions.
    Github,
    /// What oxlint calls `json`.
    OxlintJson,
    Checkstyle,
    Junit,
    Gitlab,
    Sarif,
}

impl Format {
    pub(crate) const NAMES: &'static str =
        "stylish, pretty, json, json-with-metadata, unix, github, agent, checkstyle, junit, gitlab, sarif";

    /// `is_oxlint`: the configuration is oxlint's, so the names are too.
    pub(crate) fn by_name(name: &[u8], is_oxlint: bool) -> Option<Format> {
        Some(match name {
            b"stylish" => Format::Stylish,
            b"json" if is_oxlint => Format::OxlintJson,
            b"json" => Format::Json,
            b"default" => Format::Pretty,
            b"checkstyle" => Format::Checkstyle,
            b"junit" => Format::Junit,
            b"gitlab" => Format::Gitlab,
            b"sarif" => Format::Sarif,
            b"json-with-metadata" => Format::JsonWithMetadata,
            b"unix" => Format::Unix,
            b"pretty" => Format::Pretty,
            b"agent" => Format::Agent,
            b"github" => Format::Github,
            _ => return None,
        })
    }

    /// Whether it reads [`FileResult::text`].
    pub(crate) fn reads_text(self) -> bool {
        matches!(self, Format::Json | Format::JsonWithMetadata | Format::Pretty | Format::Agent | Format::OxlintJson)
    }

    /// Whether it prints [`LintMessage::suppressions`](bun_lint::linter::LintMessage::suppressions).
    pub(crate) fn reads_suppressions(self) -> bool {
        matches!(self, Format::Json | Format::JsonWithMetadata)
    }

    /// Whether it prints fixes or suggestions, or counts what can be fixed.
    pub(crate) fn reads_fixes(self) -> bool {
        matches!(self, Format::Stylish | Format::Json | Format::JsonWithMetadata | Format::Pretty | Format::Agent)
    }
}

/// ESLint's `ResultsMeta`, and what else a format wants to know.
pub(crate) struct Meta<'m> {
    pub(crate) cwd: &'m [u8],
    pub(crate) color: bool,
    /// `--color`, `--no-color`
    pub(crate) color_option: Option<bool>,
    /// `maxWarnings` and `foundWarnings`, if there are too many.
    pub(crate) max_warnings_exceeded: Option<(i64, usize)>,
    /// `--all`: identical problems are not grouped.
    pub(crate) shows_all: bool,
    /// Also print the `github` format: the run is one of GitHub Actions.
    pub(crate) github_annotations: bool,
    pub(crate) run: oxlint::Run,
    pub(crate) pool: &'m Pool,
    /// Of Bun.
    pub(crate) version: &'m [u8],
}

/// What ESLint's formatter of that name returns for `results`, which are sorted by path.
pub(crate) fn format(format: Format, results: &[FileResult], meta: &Meta) -> Vec<u8> {
    let mut out = Vec::new();
    match format {
        Format::Stylish => stylish::write(&mut out, results, meta.color),
        Format::Json => json::write_results(&mut out, results, meta),
        Format::JsonWithMetadata => json::write_with_metadata(&mut out, results, meta),
        Format::Unix => unix::write(&mut out, results),
        Format::Pretty => excerpt::write_pretty(&mut out, results, meta),
        Format::Agent => excerpt::write_agent(&mut out, results, meta),
        Format::Github => excerpt::write_github(&mut out, results, meta),
        Format::OxlintJson => oxlint::write_json(&mut out, results, meta),
        Format::Checkstyle => oxlint::write_checkstyle(&mut out, results, meta),
        Format::Junit => oxlint::write_junit(&mut out, results, meta),
        Format::Gitlab => oxlint::write_gitlab(&mut out, results, meta),
        Format::Sarif => oxlint::write_sarif(&mut out, results, meta),
    }
    let is_for_people = matches!(format, Format::Stylish | Format::Pretty | Format::Unix);
    if meta.github_annotations && is_for_people && results.iter().any(|it| !it.messages.is_empty()) {
        out.push(b'\n');
        excerpt::write_github(&mut out, results, meta);
    }
    out
}
