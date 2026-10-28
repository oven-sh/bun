use bstr::BString;
use bun_trim::{UnseenCode, UnseenCodeCause, WitnessIndex};

use super::*;
use crate::engine::UnseenCodeRecord;
use crate::engine::testing::ResultRecords;
use crate::ir::generated::UnseenCodeCause as EngineCause;
use crate::ir::ids::{ABSENT_WORD, Id};
use crate::report::testing::{
    self, LINE_2_COLUMN_14, NO_LOCATION, ReportFixture, location, witness,
};

type File<'f> = (&'f str, [u32; 3]);

const MAIN: &str = "/p/main.ts";
const DEPENDENCY: &str = "/p/node_modules/x/index.js";
const RUNTIME: &str = "node:fs";
const HINT_LINE: &str =
    "Untyped code works, but runs slower. Run with --explain to see what to fix.\n";

struct Modules {
    records: Vec<AccessCountRecord>,
    paths: Vec<Vec<u8>>,
    origins: Vec<ModuleOrigin>,
}

impl Modules {
    fn new(files: &[File<'_>]) -> Modules {
        let records = files.iter().enumerate();
        let records = records.map(|(module, &(_, accesses))| AccessCountRecord {
            module: module as u32,
            accesses,
            calls: [0; 3],
            type_tests: 0,
            access_costs: costs_of(accesses),
        });
        Modules {
            records: records.collect(),
            paths: files.iter().map(|&(path, _)| native(path)).collect(),
            origins: files
                .iter()
                .map(|&(path, _)| origin_of_file(path))
                .collect(),
        }
    }

    fn totals(&self) -> ProgramTotals {
        totals_of(&self.records, |module| self.origins[module.index()])
    }

    fn summary(&self, has_text_report: bool, words: &[&str]) -> BString {
        let words: Vec<Box<[u8]>> = words.iter().map(|word| word.as_bytes().into()).collect();
        written(|out| write_lines(&self.totals(), has_text_report, &words, out))
    }

    fn details(&self, statistics: &Statistics) -> Option<BString> {
        let text = details_text(
            &self.records,
            |module| &self.paths[module.index()][..],
            |module| self.origins[module.index()],
            statistics,
            limit_value_of,
            &PathPrinter::in_directory(native("/p")),
        );
        text.map(BString::from)
    }
}

fn costs_of([unknown, guarded, proven]: [u32; 3]) -> [u32; 4] {
    [unknown, guarded, 0, proven]
}

fn origin_of_file(path: &str) -> ModuleOrigin {
    match path {
        DEPENDENCY => ModuleOrigin::Dependency,
        RUNTIME => ModuleOrigin::Runtime,
        _ => ModuleOrigin::Program,
    }
}

fn limit_value_of(limit: LimitId) -> u64 {
    if limit == LimitId::MaxTypeNodes {
        1200
    } else {
        2
    }
}

fn native(path: &str) -> Vec<u8> {
    let to_native = |byte| if byte == b'/' { bun_paths::SEP } else { byte };
    path.bytes().map(to_native).collect()
}

fn written(write: impl FnOnce(&mut Vec<u8>)) -> BString {
    let mut out = Vec::new();
    write(&mut out);
    BString::from(out)
}

fn summary(files: &[File<'_>]) -> BString {
    Modules::new(files).summary(false, &[])
}

fn untyped_note(demoted_files: u64) -> BString {
    let mut statistics = Statistics::default();
    statistics.count(StatisticId::SourceFilesDemoted, demoted_files);
    written(|out| write_untyped_note(&statistics, out))
}

fn joined(lines: &[&str]) -> Option<BString> {
    Some(BString::from(lines.join("\n")))
}

fn counts(module: u32, accesses: [u32; 3]) -> AccessCountRecord {
    AccessCountRecord {
        module,
        accesses,
        calls: [0; 3],
        type_tests: 0,
        access_costs: costs_of(accesses),
    }
}

fn unseen(cause: UnseenCodeCause, witness: Option<u32>) -> UnseenCode {
    UnseenCode {
        cause,
        witness: witness.map(WitnessIndex),
    }
}

fn trim_causes(fixture: &ReportFixture<'_>) -> BString {
    fixture.with_input(|input| written(|out| write_trim_causes(input, out)))
}

#[test]
fn untyped_program_gets_hint() {
    let line = "75% of property accesses are one load: 6 free, 0 tested, 2 by name (8)\n";
    assert_eq!(summary(&[(MAIN, [2, 0, 6])]), format!("{HINT_LINE}{line}"));
}

#[test]
fn typed_program_gets_no_hint() {
    assert_eq!(
        summary(&[(MAIN, [0, 0, 1])]),
        "100% of property accesses are one load: 1 free, 0 tested, 0 by name (1)\n"
    );
}

#[test]
fn program_line_is_last() {
    let files = [(MAIN, [99, 0, 1204]), (DEPENDENCY, [6564, 0, 210])];
    let expected = [
        "Built with developer options: --aot-validate\n",
        HINT_LINE,
        "Dependencies: 3.1% of property accesses are one load: ",
        "210 free, 0 tested, 6,564 by name (6,774)\n",
        "92.4% of property accesses are one load: 1,204 free, 0 tested, 99 by name (1,303)\n",
    ];
    assert_eq!(
        Modules::new(&files).summary(false, &["validate"]),
        expected.concat()
    );
}

#[test]
fn dependencies_alone_get_no_hint() {
    let expected = [
        "Dependencies: 3.1% of property accesses are one load: ",
        "210 free, 0 tested, 6,564 by name (6,774)\n",
    ];
    assert_eq!(summary(&[(DEPENDENCY, [6564, 0, 210])]), expected.concat());
}

#[test]
fn runtime_modules_are_not_counted() {
    assert_eq!(summary(&[]), "");
    assert_eq!(summary(&[(RUNTIME, [1, 2, 3])]), "");
}

#[test]
fn hint_starts_below_threshold() {
    assert_eq!(
        summary(&[(MAIN, [1, 0, 19])]),
        "95% of property accesses are one load: 19 free, 0 tested, 1 by name (20)\n"
    );
    let line = "94.9% of property accesses are one load: 949 free, 0 tested, 51 by name (1,000)\n";
    assert_eq!(
        summary(&[(MAIN, [51, 0, 949])]),
        format!("{HINT_LINE}{line}")
    );
}

#[test]
fn text_report_replaces_hint() {
    assert_eq!(
        Modules::new(&[(MAIN, [2, 0, 0])]).summary(true, &[]),
        "0% of property accesses are one load: 0 free, 0 tested, 2 by name (2)\n"
    );
}

#[test]
fn access_behind_test_of_another_access_is_free() {
    let mut modules = Modules::new(&[(MAIN, [1, 6, 1])]);
    modules.records[0].access_costs = [1, 1, 2, 4];
    assert_eq!(
        modules.summary(true, &[]),
        "50% of property accesses are one load: 4 free, 3 tested, 1 by name (8)\n"
    );
}

#[test]
fn tested_access_is_not_free() {
    let line = "50% of property accesses are one load: 1 free, 1 tested, 0 by name (2)\n";
    assert_eq!(summary(&[(MAIN, [0, 1, 1])]), format!("{HINT_LINE}{line}"));
}

#[test]
fn calls_change_no_percentage() {
    let mut modules = Modules::new(&[(MAIN, [1, 0, 1])]);
    modules.records[0].calls = [7, 9, 0];
    assert_eq!(modules.totals().program.calls.total(), 16);
    assert_eq!(
        modules.summary(true, &[]),
        "50% of property accesses are one load: 1 free, 0 tested, 1 by name (2)\n"
    );
}

#[test]
fn developer_options_come_first() {
    let words = ["validate", "check=verify-each-pass"];
    let options = "Built with developer options: --aot-validate --aot-check=verify-each-pass\n";
    let line = "0% of property accesses are one load: 0 free, 0 tested, 1 by name (1)\n";
    assert_eq!(Modules::new(&[]).summary(false, &words), options);
    assert_eq!(
        Modules::new(&[(MAIN, [1, 0, 0])]).summary(false, &words),
        format!("{options}{HINT_LINE}{line}")
    );
}

#[test]
fn columns_line_matches_documented_form() {
    let accesses = CostCounts::from_words([38, 41, 20, 1204]);
    let line =
        "92.4% of property accesses are one load: 1,204 free, 61 tested, 38 by name (1,303)\n";
    assert_eq!(written(|out| write_columns_line(out, "", &accesses)), line);
    assert_eq!(
        written(|out| write_columns_line(out, "Dependencies: ", &accesses)),
        format!("Dependencies: {line}")
    );
}

#[test]
fn level_counts_have_three_members_in_order() {
    let mut json = JsonWriter::object();
    write_level_counts(&mut json, "accesses", &LevelCounts::from_words([1, 2, 3]));
    assert_eq!(
        BString::from(json.finish()),
        r#"{"accesses":{"unknown":1,"guarded":2,"proven":3}}"#
    );
}

#[test]
fn access_counts_have_columns_then_two_counts_of_their_own() {
    let totals = SiteTotals {
        accesses: LevelCounts::from_words([1, 9, 5]),
        access_costs: CostCounts::from_words([1, 2, 4, 8]),
        ..SiteTotals::default()
    };
    let mut json = JsonWriter::object();
    write_access_counts(&mut json, "accesses", &totals);
    assert_eq!(
        BString::from(json.finish()),
        concat!(
            r#"{"accesses":{"byName":1,"tested":6,"free":8,"#,
            r#""testedSlotOnly":4,"provenWithoutAnyTest":5}}"#,
        )
    );
}

#[test]
fn untyped_note_counts_files() {
    assert_eq!(untyped_note(0), "");
    assert_eq!(untyped_note(1), "1 file compiled without types");
    assert_eq!(untyped_note(2), "2 files compiled without types");
    assert_eq!(untyped_note(1204), "1,204 files compiled without types");
}

#[test]
fn details_list_most_untyped_files() {
    let modules = Modules::new(&[
        ("/p/g.ts", [1, 0, 0]),
        ("/p/f.ts", [1, 0, 0]),
        ("/p/e.ts", [1, 1, 3]),
        ("/p/d.ts", [0, 2, 0]),
        ("/p/c.ts", [3, 0, 1]),
        ("/p/b.ts", [0, 4, 0]),
        ("/p/a.ts", [1, 0, 0]),
        ("/p/typed.ts", [0, 0, 1000]),
        (DEPENDENCY, [9, 0, 0]),
        (RUNTIME, [5, 5, 5]),
    ]);
    let mut statistics = Statistics::default();
    statistics.count(StatisticId::DirectCalls, 1204);
    statistics.count(StatisticId::IndirectCalls, 3);
    let expected = [
        "All property accesses, including dependencies:",
        "  1,004  free: one load or store at a fixed offset",
        "      7  tested: a test of its own, then a load or store at a fixed offset",
        "     16  by name: looked up by name",
        "Calls: 1,204 direct, 3 indirect",
        "Files with the most untyped accesses:",
        "  b.ts  0% typed (0 of 4)",
        "  c.ts  25% typed (1 of 4)",
        "  d.ts  0% typed (0 of 2)",
        "  e.ts  60% typed (3 of 5)",
        "  a.ts  0% typed (0 of 1)",
        "  and 2 more",
    ];
    assert_eq!(modules.details(&statistics), joined(&expected));
}

#[test]
fn details_omit_empty_sections() {
    let modules = Modules::new(&[(MAIN, [0, 0, 2]), (DEPENDENCY, [0, 1, 0])]);
    let expected = [
        "All property accesses, including dependencies:",
        "  2  free: one load or store at a fixed offset",
        "  1  tested: a test of its own, then a load or store at a fixed offset",
        "  0  by name: looked up by name",
        "Calls: 0 direct, 0 indirect",
    ];
    assert_eq!(modules.details(&Statistics::default()), joined(&expected));
}

#[test]
fn five_untyped_files_are_all_listed() {
    let paths = ["/p/a.ts", "/p/b.ts", "/p/c.ts", "/p/d.ts", "/p/e.ts"];
    let modules = Modules::new(&paths.map(|path| (path, [1, 0, 0])));
    let details = modules
        .details(&Statistics::default())
        .expect("counted accesses");
    assert!(
        details.ends_with(b"\n  e.ts  0% typed (0 of 1)"),
        "{details}"
    );
}

#[test]
fn details_need_counted_access() {
    let mut statistics = Statistics::default();
    statistics.gave_up(LimitId::MaxValueFlowEdgesLogged, None);
    assert_eq!(Modules::new(&[]).details(&statistics), None);
    assert_eq!(
        Modules::new(&[(RUNTIME, [1, 2, 3])]).details(&statistics),
        None
    );
}

#[test]
fn details_end_with_reached_limits() {
    let mut statistics = Statistics::default();
    statistics.gave_up(LimitId::MaxValueFlowEdgesLogged, None);
    for _ in 0..3 {
        statistics.gave_up(LimitId::MaxTypeNodes, None);
    }
    let type_nodes = format!(
        "  MaxTypeNodes = 1,200, hit 3 times (limits {})",
        LimitId::MaxTypeNodes.purpose()
    );
    let flow_edges = format!(
        "  MaxValueFlowEdgesLogged = 2, hit 1 time (limits {})",
        LimitId::MaxValueFlowEdgesLogged.purpose()
    );
    let expected = [
        "All property accesses, including dependencies:",
        "  1  free: one load or store at a fixed offset",
        "  0  tested: a test of its own, then a load or store at a fixed offset",
        "  0  by name: looked up by name",
        "Calls: 0 direct, 0 indirect",
        "Compiler limits hit:",
        type_nodes.as_str(),
        flow_edges.as_str(),
    ];
    let modules = Modules::new(&[(MAIN, [0, 0, 1])]);
    assert_eq!(modules.details(&statistics), joined(&expected));
}

#[test]
fn trim_causes_have_sentence_and_position() {
    let at_location = |location| UnseenCodeRecord {
        cause: EngineCause::EvaluatesText,
        builtin: ABSENT_WORD,
        witness: witness(ABSENT_WORD, location),
    };
    let records = [
        at_location(location(testing::PROGRAM, LINE_2_COLUMN_14)),
        at_location(location(testing::RUNTIME, 0)),
        at_location(NO_LOCATION),
    ];
    let mut fixture = ReportFixture::new(ResultRecords {
        unseen_code: &records,
        ..ResultRecords::default()
    });
    fixture.options.trim.removes_unused = true;
    fixture.used_features.causes = vec![
        unseen(UnseenCodeCause::EvaluatesText, Some(0)),
        unseen(UnseenCodeCause::RunsUnseenCode, Some(1)),
        unseen(UnseenCodeCause::ImportsUncompiledCode, Some(2)),
        unseen(UnseenCodeCause::LoadsModuleByName, Some(3)),
        unseen(UnseenCodeCause::FlowGaveUp, None),
    ];
    let sentences = [
        "the program calls eval() or new Function() (src/a.ts:2:14)",
        "the program can run code that isn't in the executable",
        "the program imports a module that isn't in the executable",
        "the program calls import() or require() with a dynamic path",
        "the analysis hit a compiler limit",
    ];
    let lines = sentences
        .map(|sentence| format!("--trim kept APIs your code doesn't call because {sentence}\n"));
    assert_eq!(trim_causes(&fixture), lines.concat());
}

#[test]
fn trim_causes_need_removal_of_unused_features() {
    let mut fixture = ReportFixture::new(ResultRecords::default());
    fixture.used_features.causes = vec![unseen(UnseenCodeCause::EvaluatesText, None)];
    assert_eq!(trim_causes(&fixture), "");
    fixture.options.trim.logs = true;
    assert_eq!(trim_causes(&fixture), "");
    fixture.options.trim.removes_unused = true;
    assert!(!trim_causes(&fixture).is_empty());
}

#[test]
fn program_with_every_api_visible_has_no_trim_cause() {
    let mut fixture = ReportFixture::new(ResultRecords::default());
    fixture.options.trim.removes_unused = true;
    assert_eq!(trim_causes(&fixture), "");
}

#[test]
fn summary_starts_with_trim_causes() {
    let records = [
        counts(testing::PROGRAM, [2, 0, 6]),
        counts(testing::DEPENDENCY, [0, 0, 1]),
        counts(testing::RUNTIME, [9, 9, 9]),
    ];
    let mut fixture = ReportFixture::new(ResultRecords {
        access_counts: &records,
        ..ResultRecords::default()
    });
    fixture.options.trim.removes_unused = true;
    fixture.options.option_words = vec![Box::from(&b"validate"[..])];
    fixture.used_features.causes = vec![unseen(UnseenCodeCause::FlowGaveUp, None)];
    let summary = |fixture: &ReportFixture<'_>| {
        fixture.with_input(|input| written(|out| write_summary(input, out)))
    };
    let start = [
        "--trim kept APIs your code doesn't call because the analysis hit a compiler limit\n",
        "Built with developer options: --aot-validate\n",
    ];
    let levels = [
        "Dependencies: 100% of property accesses are one load: 1 free, 0 tested, 0 by name (1)\n",
        "75% of property accesses are one load: 6 free, 0 tested, 2 by name (8)\n",
    ];
    let (start, levels) = (start.concat(), levels.concat());
    assert_eq!(summary(&fixture), format!("{start}{HINT_LINE}{levels}"));
    fixture.options.explain = ExplainSet::TEXT;
    assert_eq!(summary(&fixture), format!("{start}{levels}"));
}

#[test]
fn details_entry_reads_names_and_limit_values() {
    let records = [counts(testing::PROGRAM, [1, 0, 1])];
    let mut fixture = ReportFixture::new(ResultRecords {
        access_counts: &records,
        limit_values: &[(LimitId::MaxTypeNodes, 1200)],
        ..ResultRecords::default()
    });
    fixture.statistics.gave_up(LimitId::MaxTypeNodes, None);
    fixture.statistics.count(StatisticId::DirectCalls, 3);
    let mut entries = Vec::new();
    fixture.with_input(|input| collect_details(input, &mut entries));
    let reached = format!(
        "  MaxTypeNodes = 1,200, hit 1 time (limits {})",
        LimitId::MaxTypeNodes.purpose()
    );
    let expected = [
        "All property accesses, including dependencies:",
        "  1  free: one load or store at a fixed offset",
        "  0  tested: a test of its own, then a load or store at a fixed offset",
        "  1  by name: looked up by name",
        "Calls: 3 direct, 0 indirect",
        "Files with the most untyped accesses:",
        "  src/a.ts  50% typed (1 of 2)",
        "Compiler limits hit:",
        reached.as_str(),
    ];
    let text = expected.join("\n").into_bytes();
    assert_eq!(entries, [ReportEntry::line(ExplainSet::TEXT, text)]);
}

#[test]
fn build_without_counted_access_has_no_details_entry() {
    let records = [counts(testing::RUNTIME, [1, 2, 3])];
    let fixture = ReportFixture::new(ResultRecords {
        access_counts: &records,
        ..ResultRecords::default()
    });
    let mut entries = Vec::new();
    fixture.with_input(|input| collect_details(input, &mut entries));
    assert!(entries.is_empty());
}
