mod sites;

use bun_options_types::aot_options::ReportDetail;

use super::ReportInput;
use super::json::JsonWriter;
use super::levels::compute_totals;
use super::positions::{PathStyle, Positions};
use super::runtime_use::record_at;
use super::summary::{write_access_counts, write_level_counts};
use crate::builtins::table;
use crate::diagnostics::SourcePosition;
use crate::engine::{AccessRecord, PassTimeRecord, builtin_of};
use crate::ir::generated::{KnowledgeLevel, PassId, SCHEMA_HASH};
use crate::statistics::{LimitId, Stage, StatisticId, Statistics};

const CLOSURE_OUTCOMES: [(&str, StatisticId); 5] = [
    ("heap", StatisticId::ClosuresFull),
    ("slim", StatisticId::ClosuresSlim),
    ("deferred", StatisticId::ClosuresDeferred),
    ("frame", StatisticId::ClosuresInFrames),
    ("removed", StatisticId::ClosuresNeverCreated),
];

const ENVIRONMENT_OUTCOMES: [(&str, StatisticId); 2] = [
    ("heap", StatisticId::EnvironmentsOnHeap),
    ("frame", StatisticId::EnvironmentsInFrames),
];

const PROGRAM_SIZES: [(&str, StatisticId); 4] = [
    ("sourceLines", StatisticId::SourceLines),
    ("codeBytes", StatisticId::CodeBytesEmitted),
    ("dataBytes", StatisticId::TableBytesEmitted),
    ("functions", StatisticId::ImageFunctionsEmitted),
];

pub fn write(input: &ReportInput<'_>, detail: ReportDetail, build_id: Option<&[u8]>) -> Vec<u8> {
    let mut positions = Positions::new(input, PathStyle::Posix);

    let mut json = JsonWriter::object();
    json.string("schemaHash", format!("{SCHEMA_HASH:016x}").as_bytes());
    json.optional_string("buildId", build_id);
    write_summary(&mut json, input);
    write_statistics(&mut json, input.statistics);
    let limit_value_of = |limit| input.engine.limit_value(limit);
    write_limit_list(&mut json, &limit_value_of, input.statistics);
    write_pass_list(&mut json, input.engine.pass_times(), input.statistics);
    write_stages(&mut json, input.statistics);
    write_retained_features(&mut json, input);
    write_unseen_code(&mut json, input, &mut positions);
    if detail >= ReportDetail::Functions {
        sites::write_functions(&mut json, input, &mut positions);
    } else {
        json.null("functions");
    }
    if detail >= ReportDetail::Sites {
        let functions = sites::index_functions(input.engine.functions());
        sites::write_access_sites(&mut json, input, &mut positions, &functions);
        sites::write_type_test_sites(&mut json, input, &mut positions, &functions);
    } else {
        json.null("accessSites");
        json.null("typeTestSites");
    }

    let mut document = json.finish();
    document.push(b'\n');
    document
}

fn write_counts(json: &mut JsonWriter, statistics: &Statistics, members: &[(&str, StatisticId)]) {
    for &(key, id) in members {
        json.number(key, statistics.get(id));
    }
}

/// A site below proven whose loss names no operation but the site itself: nothing says where the loss began.
fn count_sites_without_origin(records: &[AccessRecord]) -> u64 {
    let names_itself = |record: &&AccessRecord| {
        record.level != KnowledgeLevel::Proven && record.witness.location == record.location
    };
    records.iter().filter(names_itself).count() as u64
}

fn write_summary(json: &mut JsonWriter, input: &ReportInput<'_>) {
    let totals = compute_totals(input);
    json.begin_object("summary");
    write_access_counts(json, "accesses", &totals.program);
    write_access_counts(json, "dependencyAccesses", &totals.dependencies);
    write_level_counts(json, "calls", &totals.program.calls);
    json.begin_object("closures");
    write_counts(json, input.statistics, &CLOSURE_OUTCOMES);
    json.end_object();
    json.begin_object("environments");
    write_counts(json, input.statistics, &ENVIRONMENT_OUTCOMES);
    json.end_object();
    json.number("typeTests", totals.combined().type_tests);
    let without_origin = count_sites_without_origin(input.engine.accesses());
    json.number("sitesWithoutOrigin", without_origin);
    write_counts(json, input.statistics, &PROGRAM_SIZES);
    json.end_object();
}

fn write_statistics(json: &mut JsonWriter, statistics: &Statistics) {
    json.begin_object("statistics");
    for id in StatisticId::ALL {
        if id != StatisticId::None {
            json.number(id.name(), statistics.get(id));
        }
    }
    json.end_object();
}

fn write_limit_list(
    json: &mut JsonWriter,
    value_of: &dyn Fn(LimitId) -> u64,
    statistics: &Statistics,
) {
    let listed = LimitId::ALL
        .into_iter()
        .filter(|&limit| limit != LimitId::None);
    json.objects("limits", listed, |json, limit| {
        json.string("name", limit.name().as_bytes());
        json.number("value", value_of(limit));
        json.number("hits", statistics.get(limit.hits()));
    });
}

fn write_pass_list(json: &mut JsonWriter, records: &[PassTimeRecord], statistics: &Statistics) {
    let mut times = [(0u64, 0u64); PassId::COUNT];
    for record in records {
        let (runs, nanoseconds) = &mut times[record.pass as usize];
        *runs = runs.saturating_add(record.runs);
        *nanoseconds = nanoseconds.saturating_add(record.cpu_nanoseconds);
    }

    let passes = PassId::ALL.into_iter().filter(|&pass| pass != PassId::None);
    json.objects("passes", passes, |json, pass| {
        let (runs, nanoseconds) = times[pass as usize];
        json.string("name", pass.name().as_bytes());
        json.number("runs", runs);
        json.number("changes", statistics.get(pass.changes()));
        json.number("nanoseconds", nanoseconds);
    });
}

fn write_stages(json: &mut JsonWriter, statistics: &Statistics) {
    let stages = Stage::ALL
        .into_iter()
        .filter(|stage| !matches!(stage, Stage::Any | Stage::RunTime));
    json.objects("stages", stages, |json, stage| {
        json.string("name", stage.name().as_bytes());
        json.number("nanoseconds", statistics.get(stage.time()));
    });
}

fn write_retained_features(json: &mut JsonWriter, input: &ReportInput<'_>) {
    let decision = input.decision.filter(|_| input.options.trim.is_enabled());
    let Some(decision) = decision else {
        json.null("retainedFeatures");
        return;
    };
    let names = decision
        .retained
        .iter()
        .map(|retained| retained.feature.name().as_bytes());
    json.strings("retainedFeatures", names);
}

fn write_unseen_code(
    json: &mut JsonWriter,
    input: &ReportInput<'_>,
    positions: &mut Positions<'_>,
) {
    let records = input.engine.unseen_code();
    json.objects("unseenCode", &input.used_features.causes, |json, unseen| {
        let record = record_at(records, unseen.witness);
        let builtin = record.and_then(|record| builtin_of(record.builtin));
        let location =
            record.and_then(|record| positions.resolve_location(record.witness.location));
        json.string("cause", format!("{:?}", unseen.cause).as_bytes());
        let builtin = builtin.map(table::text_of);
        json.optional_string("builtin", builtin.as_deref().map(str::as_bytes));
        write_position(json, "location", location.as_ref());
    });
}

pub(super) fn write_position(json: &mut JsonWriter, key: &str, position: Option<&SourcePosition>) {
    let Some(position) = position else {
        json.null(key);
        return;
    };
    json.begin_object(key);
    write_position_members(json, Some(position), "column");
    json.end_object();
}

pub(super) fn write_position_members(
    json: &mut JsonWriter,
    position: Option<&SourcePosition>,
    column_key: &str,
) {
    let (file, line, column) = match position {
        Some(position) => (&position.path[..], position.line, position.column),
        None => (&[][..], 0, 0),
    };
    json.string("file", file);
    json.number("line", u64::from(line));
    json.number(column_key, u64::from(column));
}

#[cfg(test)]
mod tests {
    use core::time::Duration;

    use bstr::{BString, ByteSlice};

    use super::*;

    fn object_with(write: impl FnOnce(&mut JsonWriter)) -> BString {
        let mut json = JsonWriter::object();
        write(&mut json);
        BString::from(json.finish())
    }

    fn count_of(document: &BString, text: &str) -> usize {
        document.find_iter(text).count()
    }

    #[test]
    fn present_position_has_three_members() {
        let position = SourcePosition {
            path: b"src/a.ts".to_vec(),
            line: 3,
            column: 5,
        };
        let object = object_with(|json| write_position(json, "witness", Some(&position)));
        assert_eq!(
            object,
            r#"{"witness":{"file":"src/a.ts","line":3,"column":5}}"#
        );
    }

    #[test]
    fn absent_position_is_null() {
        let object = object_with(|json| write_position(json, "witness", None));
        assert_eq!(object, r#"{"witness":null}"#);
    }

    #[test]
    fn limits_list_every_limit_once() {
        let reached = LimitId::MaxTypeNodes;
        let mut statistics = Statistics::default();
        statistics.gave_up(reached, None);
        let value_of = |limit: LimitId| limit as u64;
        let document = object_with(|json| write_limit_list(json, &value_of, &statistics));
        for limit in LimitId::ALL {
            let element = format!(
                r#"{{"name":"{}","value":{},"hits":{}}}"#,
                limit.name(),
                limit as u64,
                u64::from(limit == reached),
            );
            let expected = usize::from(limit != LimitId::None);
            assert_eq!(count_of(&document, &element), expected, "{limit:?}");
        }
        assert_eq!(count_of(&document, r#"{"name":"#), LimitId::COUNT - 1);
    }

    #[test]
    fn statistics_list_every_statistic_once() {
        let mut statistics = Statistics::default();
        statistics.count(StatisticId::SourceLines, 7);
        let document = object_with(|json| write_statistics(json, &statistics));
        for id in StatisticId::ALL {
            let key = format!(r#""{}":"#, id.name());
            let expected = usize::from(id != StatisticId::None);
            assert_eq!(count_of(&document, &key), expected, "{id:?}");
        }
        assert_eq!(count_of(&document, r#"":"#), StatisticId::COUNT);
        assert_eq!(count_of(&document, r#""SourceLines":7,"#), 1);
    }

    #[test]
    fn stages_leave_out_any_and_run_time() {
        let mut statistics = Statistics::default();
        statistics.add_time(Stage::Load, Duration::from_nanos(5));
        statistics.add_time(Stage::RunTime, Duration::from_nanos(9));
        let document = object_with(|json| write_stages(json, &statistics));
        for stage in Stage::ALL {
            let name = format!(r#"{{"name":"{}","#, stage.name());
            let expected = usize::from(!matches!(stage, Stage::Any | Stage::RunTime));
            assert_eq!(count_of(&document, &name), expected, "{stage:?}");
        }
        assert_eq!(count_of(&document, r#"{"name":"Load","nanoseconds":5}"#), 1);
    }

    #[test]
    fn passes_without_record_have_zero_runs() {
        let timed = PassId::AnalyzeFlow;
        let mut statistics = Statistics::default();
        statistics.count(timed.changes(), 3);
        let records = [PassTimeRecord {
            pass: timed,
            reserved: 0,
            runs: 2,
            wall_nanoseconds: 11,
            cpu_nanoseconds: 40,
        }];
        let document = object_with(|json| write_pass_list(json, &records, &statistics));
        for pass in PassId::ALL {
            let (runs, changes, nanoseconds) = if pass == timed { (2, 3, 40) } else { (0, 0, 0) };
            let element = format!(
                r#"{{"name":"{}","runs":{runs},"changes":{changes},"nanoseconds":{nanoseconds}}}"#,
                pass.name(),
            );
            let expected = usize::from(pass != PassId::None);
            assert_eq!(count_of(&document, &element), expected, "{pass:?}");
        }
    }
}
