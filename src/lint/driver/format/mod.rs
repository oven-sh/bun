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

use crate::results::{Counts, FileResult};
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
    Checkstyle,
    Junit,
    Gitlab,
    Sarif,
    /// What oxlint calls `default`: `pretty`, with all else that there is to say after it.
    OxlintDefault,
    /// What oxlint calls by the same name, byte for byte.
    OxlintStylish,
    OxlintJson,
    OxlintUnix,
    OxlintAgent,
    OxlintGithub,
    OxlintCheckstyle,
    OxlintJunit,
    OxlintGitlab,
    OxlintSarif,
}

impl Format {
    pub(crate) const NAMES: &'static str = "stylish, pretty, json, json-with-metadata, unix, github, agent, checkstyle, junit, gitlab, sarif";

    /// `is_oxlint`: the configuration is oxlint's, so the names are too.
    pub(crate) fn by_name(name: &[u8], is_oxlint: bool) -> Option<Format> {
        Some(match name {
            b"json-with-metadata" => Format::JsonWithMetadata,
            b"default" | b"pretty" if is_oxlint => Format::OxlintDefault,
            b"stylish" if is_oxlint => Format::OxlintStylish,
            b"json" if is_oxlint => Format::OxlintJson,
            b"unix" if is_oxlint => Format::OxlintUnix,
            b"agent" if is_oxlint => Format::OxlintAgent,
            b"github" if is_oxlint => Format::OxlintGithub,
            b"checkstyle" if is_oxlint => Format::OxlintCheckstyle,
            b"junit" if is_oxlint => Format::OxlintJunit,
            b"gitlab" if is_oxlint => Format::OxlintGitlab,
            b"sarif" if is_oxlint => Format::OxlintSarif,
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

    /// Whether what it returns is all of standard output as oxlint prints it, with the end of the last line if there is one.
    pub(crate) fn is_of_oxlint(self) -> bool {
        matches!(
            self,
            Format::OxlintDefault
                | Format::OxlintStylish
                | Format::OxlintJson
                | Format::OxlintUnix
                | Format::OxlintAgent
                | Format::OxlintGithub
                | Format::OxlintCheckstyle
                | Format::OxlintJunit
                | Format::OxlintGitlab
                | Format::OxlintSarif
        )
    }

    /// Whether it reads [`FileResult::text`]. Those of oxlint count bytes, which the messages do not.
    pub(crate) fn reads_text(self) -> bool {
        self.is_of_oxlint()
            || matches!(
                self,
                Format::Json | Format::JsonWithMetadata | Format::Pretty | Format::Agent
            )
    }

    /// Whether it prints [`LintMessage::suppressions`](bun_lint::linter::LintMessage::suppressions).
    pub(crate) fn reads_suppressions(self) -> bool {
        matches!(self, Format::Json | Format::JsonWithMetadata)
    }

    /// Whether it prints fixes or suggestions, or counts what can be fixed.
    pub(crate) fn reads_fixes(self) -> bool {
        matches!(
            self,
            Format::Stylish
                | Format::Json
                | Format::JsonWithMetadata
                | Format::Pretty
                | Format::Agent
                | Format::OxlintDefault
        )
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
    /// What there is, with what `--quiet` and `--silent` hide.
    pub(crate) found: Counts,
    /// How many files `--fix` has written.
    pub(crate) fixed: usize,
    /// This run has written `oxlint-suppressions.json`. `Some(true)`: there was one before.
    pub(crate) updated_suppressions: Option<bool>,
    /// `--all`: identical problems are not grouped.
    pub(crate) shows_all: bool,
    /// Also print the `github` format: the run is one of GitHub Actions.
    pub(crate) github_annotations: bool,
    pub(crate) run: oxlint::Run,
    pub(crate) pool: &'m Pool,
    /// Of Bun.
    pub(crate) version: &'m [u8],
}

/// What ESLint's formatter of that name returns for `results`, which are sorted by path, or what oxlint prints.
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
        Format::Checkstyle => xml::write_checkstyle(&mut out, results, meta, false),
        Format::Junit => xml::write_junit(&mut out, results, meta, false),
        Format::Gitlab => oxlint::write_gitlab(&mut out, results, meta),
        Format::Sarif => oxlint::write_sarif(&mut out, results, meta),
        Format::OxlintDefault => summary::write_default(&mut out, results, meta),
        Format::OxlintStylish => stylish::write_as_oxlint(&mut out, results, meta),
        Format::OxlintJson => oxlint_json_agent::write_json(&mut out, results, meta),
        Format::OxlintUnix => unix::write_as_oxlint(&mut out, results, meta),
        Format::OxlintAgent => oxlint_json_agent::write_agent(&mut out, results, meta),
        Format::OxlintGithub => github::write(&mut out, results, meta),
        Format::OxlintCheckstyle => xml::write_checkstyle(&mut out, results, meta, true),
        Format::OxlintJunit => xml::write_junit(&mut out, results, meta, true),
        Format::OxlintGitlab => oxlint_gitlab_sarif::write_gitlab(&mut out, results, meta),
        Format::OxlintSarif => oxlint_gitlab_sarif::write_sarif(&mut out, results, meta),
    }
    let is_for_people = matches!(format, Format::Stylish | Format::Pretty | Format::Unix);
    if meta.github_annotations && is_for_people && results.iter().any(|it| !it.messages.is_empty())
    {
        out.push(b'\n');
        excerpt::write_github(&mut out, results, meta);
    }
    out
}
