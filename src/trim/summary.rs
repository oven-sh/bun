use core::cmp::Ordering;

use bun_exe_format::cut_model::{Uncut, UncutReason};
use bun_exe_format::image::ExecutableFormat;
use bun_removable_features::{FeatureSet, TrimFeature};

use crate::model::{LibraryStatus, TrimSummary};

pub fn write_log_lines(summary: &TrimSummary, lines: &mut Vec<Vec<u8>>) {
    if summary.removed.is_empty() && summary.removed_bytes() == 0 {
        return;
    }
    lines.push(removed_line(summary));
    if let Some(uncut) = summary.uncut {
        lines.push(uncut_line(uncut));
    }
    let (removed, included): (Vec<&LibraryStatus>, Vec<&LibraryStatus>) = summary
        .libraries
        .iter()
        .partition(|library| library.is_removed);
    if !removed.is_empty() {
        let prefix: &[u8] = match summary.format {
            Some(ExecutableFormat::Pe) => {
                b"compile.trim: native libraries whose code was removed: "
            }
            Some(ExecutableFormat::Elf | ExecutableFormat::MachO) | None => {
                b"compile.trim: native libraries removed: "
            }
        };
        lines.push(library_line(prefix, removed));
    }
    if !included.is_empty() {
        lines.push(library_line(
            b"compile.trim: native libraries included: ",
            included,
        ));
    }
}

/// The lines of `write_log_lines` that a build that does not log prints too.
pub fn write_warning_lines(summary: &TrimSummary, lines: &mut Vec<Vec<u8>>) {
    match summary.uncut {
        Some(
            uncut @ Uncut {
                reason: UncutReason::NoCuts(_),
                ..
            },
        ) => lines.push(uncut_line(uncut)),
        Some(Uncut {
            reason: UncutReason::BudgetSpent,
            ..
        })
        | None => {}
    }
}

pub(crate) fn covering_names(removed: &FeatureSet) -> Vec<TrimFeature> {
    let candidates: Vec<(TrimFeature, FeatureSet)> = TrimFeature::ALL
        .iter()
        .map(|&name| (name, name.features()))
        .filter(|(_, features)| !features.is_empty() && features.is_subset_of(removed))
        .collect();
    let is_covered = |index: usize, features: &FeatureSet| {
        candidates
            .iter()
            .enumerate()
            .any(|(other_index, (_, other))| {
                features.is_subset_of(other) && (features != other || other_index < index)
            })
    };
    candidates
        .iter()
        .enumerate()
        .filter(|(index, (_, features))| !is_covered(*index, features))
        .map(|(_, (name, _))| *name)
        .collect()
}

pub(crate) fn write_megabytes(out: &mut Vec<u8>, bytes: u64) {
    let tenths = bytes.saturating_add(50_000) / 100_000;
    out.extend_from_slice(format!("{}.{}", tenths / 10, tenths % 10).as_bytes());
}

fn removed_line(summary: &TrimSummary) -> Vec<u8> {
    let mut line = b"compile.trim: removed ".to_vec();
    write_megabytes(&mut line, summary.removed_bytes());
    line.extend_from_slice(b" MB of the runtime, ");
    write_megabytes(&mut line, summary.file_bytes_saved);
    line.extend_from_slice(b" MB of it from the file");
    for (index, name) in covering_names(&summary.removed).iter().enumerate() {
        let separator: &[u8] = if index == 0 { b": " } else { b", " };
        line.extend_from_slice(separator);
        line.extend_from_slice(name.name().as_bytes());
    }
    line
}

fn uncut_line(uncut: Uncut) -> Vec<u8> {
    let (prefix, before_reason, after_reason): (&[u8], &[u8], &[u8]) = match uncut.reason {
        UncutReason::NoCuts(_) => (
            b"compile.trim: warning: ",
            b" MB could not leave the file (",
            b") and was overwritten in place",
        ),
        UncutReason::BudgetSpent => (
            b"compile.trim: ",
            b" MB stayed in the file as filler (",
            b")",
        ),
    };
    let mut line = prefix.to_vec();
    write_megabytes(&mut line, uncut.bytes);
    line.extend_from_slice(before_reason);
    line.extend_from_slice(uncut.reason.name().as_bytes());
    line.extend_from_slice(after_reason);
    line
}

fn library_line(prefix: &[u8], mut libraries: Vec<&LibraryStatus>) -> Vec<u8> {
    libraries.sort_by(|left, right| compare_library_names(left, right));
    let mut line = prefix.to_vec();
    for (index, library) in libraries.iter().enumerate() {
        if index > 0 {
            line.extend_from_slice(b", ");
        }
        line.extend_from_slice(library.name.as_bytes());
        line.push(b' ');
        line.extend_from_slice(library.version.as_bytes());
    }
    line
}

fn compare_library_names(left: &LibraryStatus, right: &LibraryStatus) -> Ordering {
    let left_folded = left.name.bytes().map(|byte| byte.to_ascii_lowercase());
    let right_folded = right.name.bytes().map(|byte| byte.to_ascii_lowercase());
    left_folded
        .cmp(right_folded)
        .then_with(|| left.name.as_bytes().cmp(right.name.as_bytes()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use bun_exe_format::cut_model::NoCutReason;
    use bun_removable_features::Feature;

    fn library(name: &str, version: &str, is_removed: bool) -> LibraryStatus {
        LibraryStatus {
            name: Box::from(name),
            version: Box::from(version),
            is_removed,
        }
    }

    fn mixed_libraries() -> Vec<LibraryStatus> {
        vec![
            library("Brotli", "1.2.0", false),
            library("SQLite", "3.50", true),
            library("libwebp", "1.6.0", true),
            library("zlib-ng", "2.3.3", false),
        ]
    }

    fn summary(
        removed: FeatureSet,
        libraries: Vec<LibraryStatus>,
        format: Option<ExecutableFormat>,
    ) -> TrimSummary {
        TrimSummary {
            removed,
            cut_bytes: 98_300_000,
            filled_bytes: 6_650_000,
            file_bytes_saved: 98_300_000,
            uncut: None,
            libraries,
            format,
        }
    }

    fn log_lines_with_uncut(reason: UncutReason, bytes: u64) -> Vec<String> {
        let with_uncut = TrimSummary {
            uncut: Some(Uncut { reason, bytes }),
            ..summary(TrimFeature::Cli.features(), mixed_libraries(), None)
        };
        log_lines(&with_uncut)
    }

    fn log_lines(summary: &TrimSummary) -> Vec<String> {
        let mut lines = Vec::new();
        write_log_lines(summary, &mut lines);
        lines
            .into_iter()
            .map(|line| String::from_utf8(line).unwrap())
            .collect()
    }

    fn cli_and_html_rewriter() -> FeatureSet {
        let mut removed = TrimFeature::Cli.features();
        removed.union_with(&TrimFeature::HtmlRewriter.features());
        removed
    }

    fn megabytes(bytes: u64) -> String {
        let mut out = Vec::new();
        write_megabytes(&mut out, bytes);
        String::from_utf8(out).unwrap()
    }

    #[test]
    fn widest_names_cover_names_inside() {
        assert_eq!(
            covering_names(&cli_and_html_rewriter()),
            [TrimFeature::Cli, TrimFeature::HtmlRewriter]
        );
        assert_eq!(
            log_lines(&summary(cli_and_html_rewriter(), Vec::new(), None)),
            [
                "compile.trim: removed 105.0 MB of the runtime, 98.3 MB of it from the file: cli, html-rewriter"
            ]
        );
    }

    #[test]
    fn partially_removed_name_is_not_listed() {
        let mut removed = cli_and_html_rewriter();
        removed.remove(Feature::Lint);
        let names = covering_names(&removed);
        assert!(!names.contains(&TrimFeature::Cli));
        assert!(!names.contains(&TrimFeature::Lint));
        assert!(names.contains(&TrimFeature::Fmt));
        assert!(names.contains(&TrimFeature::Install));
        assert!(names.contains(&TrimFeature::HtmlRewriter));
    }

    #[test]
    fn feature_without_public_name_counts_in_megabytes_only() {
        let feature = Feature::ALL
            .iter()
            .copied()
            .find(|feature| feature.narrowest_trim_feature().is_none())
            .unwrap();
        let removed = FeatureSet::from_features(&[feature]);
        assert!(covering_names(&removed).is_empty());
        assert_eq!(
            log_lines(&summary(removed, Vec::new(), None)),
            ["compile.trim: removed 105.0 MB of the runtime, 98.3 MB of it from the file"]
        );
    }

    #[test]
    fn removed_bytes_without_features_are_logged() {
        assert_eq!(
            log_lines(&summary(FeatureSet::EMPTY, Vec::new(), None)),
            ["compile.trim: removed 105.0 MB of the runtime, 98.3 MB of it from the file"]
        );
    }

    #[test]
    fn no_cuts_logs_warning_after_removed_line() {
        let reason = UncutReason::NoCuts(NoCutReason::HeaderRoomExhausted);
        let lines = log_lines_with_uncut(reason, 41_200_000);
        assert_eq!(lines.len(), 4);
        assert_eq!(
            lines[1],
            "compile.trim: warning: 41.2 MB could not leave the file (HeaderRoomExhausted) and was overwritten in place"
        );
    }

    #[test]
    fn spent_budget_logs_filler_after_removed_line() {
        let lines = log_lines_with_uncut(UncutReason::BudgetSpent, 3_100_000);
        assert_eq!(lines.len(), 4);
        assert_eq!(
            lines[1],
            "compile.trim: 3.1 MB stayed in the file as filler (BudgetSpent)"
        );
    }

    #[test]
    fn every_name_has_one_covering_name_with_same_set() {
        for name in TrimFeature::ALL {
            let covering = covering_names(&name.features());
            assert_eq!(covering.len(), 1, "{}", name.name());
            assert_eq!(covering[0].features(), name.features(), "{}", name.name());
        }
    }

    #[test]
    fn megabytes_round_half_up() {
        assert_eq!(megabytes(0), "0.0");
        assert_eq!(megabytes(49_999), "0.0");
        assert_eq!(megabytes(50_000), "0.1");
        assert_eq!(megabytes(104_950_000), "105.0");
        let tenths = (u64::MAX / 2 + 50_000) / 100_000;
        assert_eq!(
            megabytes(u64::MAX / 2),
            format!("{}.{}", tenths / 10, tenths % 10)
        );
    }

    #[test]
    fn library_lists_sort_case_insensitive() {
        let lines = log_lines(&summary(
            TrimFeature::Cli.features(),
            mixed_libraries(),
            Some(ExecutableFormat::Elf),
        ));
        assert_eq!(lines.len(), 3);
        assert_eq!(
            lines[1],
            "compile.trim: native libraries removed: libwebp 1.6.0, SQLite 3.50"
        );
        assert_eq!(
            lines[2],
            "compile.trim: native libraries included: Brotli 1.2.0, zlib-ng 2.3.3"
        );
    }

    #[test]
    fn case_insensitive_ties_sort_by_bytes() {
        let libraries = vec![library("abc", "2", true), library("ABC", "1", true)];
        let lines = log_lines(&summary(TrimFeature::Cli.features(), libraries, None));
        assert_eq!(
            lines[1],
            "compile.trim: native libraries removed: ABC 1, abc 2"
        );
    }

    #[test]
    fn pe_target_changes_removed_libraries_line_only() {
        let lines_for = |format| {
            log_lines(&summary(
                TrimFeature::Cli.features(),
                mixed_libraries(),
                Some(format),
            ))
        };
        let pe = lines_for(ExecutableFormat::Pe);
        let elf = lines_for(ExecutableFormat::Elf);
        let mach_o = lines_for(ExecutableFormat::MachO);
        assert_eq!(
            pe[1],
            "compile.trim: native libraries whose code was removed: libwebp 1.6.0, SQLite 3.50"
        );
        assert_eq!(pe[0], elf[0]);
        assert_eq!(pe[2], elf[2]);
        assert_eq!(elf, mach_o);
    }

    #[test]
    fn empty_removed_logs_nothing() {
        let empty = TrimSummary {
            cut_bytes: 0,
            filled_bytes: 0,
            file_bytes_saved: 0,
            ..summary(FeatureSet::EMPTY, mixed_libraries(), None)
        };
        assert!(log_lines(&empty).is_empty());
    }

    #[test]
    fn absent_library_groups_omit_lines() {
        let none_removed = vec![library("zlib-ng", "2.3.3", false)];
        let lines = log_lines(&summary(TrimFeature::Cli.features(), none_removed, None));
        assert_eq!(lines.len(), 2);
        assert_eq!(
            lines[1],
            "compile.trim: native libraries included: zlib-ng 2.3.3"
        );
        let no_libraries = summary(TrimFeature::Cli.features(), Vec::new(), None);
        assert_eq!(log_lines(&no_libraries).len(), 1);
    }
}
