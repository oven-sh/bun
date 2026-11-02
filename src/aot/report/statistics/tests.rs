use bstr::BString;

use super::*;
use crate::engine::testing::ResultRecords;
use crate::report::testing::ReportFixture;

fn entries(value_of: impl Fn(StatisticId) -> u64) -> Vec<ReportEntry> {
    let mut entries = Vec::new();
    collect_lines(value_of, &mut entries);
    entries
}

fn lines(value_of: impl Fn(StatisticId) -> u64) -> Vec<BString> {
    let entries = entries(value_of).into_iter();
    entries.map(|entry| BString::from(entry.text)).collect()
}

#[test]
fn number_has_no_digit_grouping() {
    assert_eq!(
        BString::from(statistic_line(StatisticId::SourceLines, 1_234_567)),
        "SourceLines 1234567"
    );
    assert_eq!(
        BString::from(statistic_line(StatisticId::TypesInterned, u64::MAX)),
        "TypesInterned 18446744073709551615"
    );
}

#[test]
fn zero_is_printed() {
    let lines = lines(|_| 0);
    assert!(lines.contains(&BString::from("DirectCalls 0")));
    assert_eq!(lines.len(), StatisticId::COUNT - 1);
}

#[test]
fn none_has_no_line() {
    assert!(lines(|_| 1).iter().all(|line| !line.starts_with(b"None ")));
}

#[test]
fn lines_follow_schema_order() {
    let lines = lines(|id| id as u64 * 3 + 1);
    let ids = StatisticId::ALL
        .into_iter()
        .filter(|&id| id != StatisticId::None);
    for (line, id) in lines.iter().zip(ids) {
        assert_eq!(
            *line,
            format!("{} {}", id.name(), id as u64 * 3 + 1),
            "{id:?}"
        );
    }
}

#[test]
fn name_resolves_to_statistic() {
    for line in lines(|_| 0) {
        let name = bun_core::strings::split(&line, b" ")
            .next()
            .expect("a line has a name");
        let name = core::str::from_utf8(name).expect("statistic names are ASCII");
        let id = StatisticId::from_name(name).expect("a declared statistic");
        assert_eq!(id.name(), name);
    }
}

#[test]
fn entries_are_statistics_without_position() {
    for entry in entries(|_| 0) {
        assert_eq!(entry.kind, ExplainSet::STATISTICS);
        assert_eq!(entry.position, None);
        assert!(entry.notes.is_empty());
        assert!(!bun_core::strings::contains_char(&entry.text, b'\n'));
    }
}

#[test]
fn report_reads_statistics_of_build() {
    let mut fixture = ReportFixture::new(ResultRecords::default());
    fixture.statistics.count(StatisticId::SourceLines, 7);
    let mut entries = Vec::new();
    fixture.with_input(|input| collect(input, &mut entries));
    assert_eq!(entries.len(), StatisticId::COUNT - 1);
    let line = ReportEntry::line(ExplainSet::STATISTICS, b"SourceLines 7".to_vec());
    assert!(entries.contains(&line));
}
