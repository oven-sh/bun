use bstr::{BString, ByteSlice};
use bun_base64::vlq::decode;

use super::*;
use crate::engine::testing::ResultRecords;
use crate::engine::{SourceLocation, TextRange};
use crate::ir::ids::ABSENT_WORD;
use crate::report::ModuleSource;
use crate::report::testing::{
    DEPENDENCY, LINE_1_COLUMN_5, LINE_2_COLUMN_14, PROGRAM, RUNTIME, ReportFixture,
};

fn unlocated(function: u32, site: u32) -> Site {
    Site {
        function,
        site,
        original: None,
        name: None,
    }
}

fn located(function: u32, site: u32, [source, line, column]: [u32; 3]) -> Site {
    Site {
        original: Some(Original {
            source,
            line,
            column,
        }),
        ..unlocated(function, site)
    }
}

fn named_site(function: u32, site: u32, original: [u32; 3], name: u32) -> Site {
    Site {
        name: Some(name),
        ..located(function, site, original)
    }
}

fn mappings(sites: &[Site]) -> BString {
    let mut out = Vec::new();
    write_mappings(sites, &mut out);
    BString::from(out)
}

fn decode_fields(segment: &[u8]) -> Vec<i32> {
    let mut fields = Vec::new();
    let mut start = 0;
    while start < segment.len() {
        let field = decode(segment, start);
        assert!(field.start > start, "a field ends inside its segment");
        fields.push(field.value);
        start = field.start;
    }
    fields
}

// Per segment: the function, then as many of site, source, line, column and name as it has fields.
fn decode_sites(mappings: &[u8]) -> Vec<(usize, Vec<i32>)> {
    let mut original = [0; 4];
    let mut sites = Vec::new();
    for (function, line) in bun_core::strings::split(mappings, b";").enumerate() {
        let mut site = 0;
        let segments = bun_core::strings::split(line, b",");
        for segment in segments.filter(|segment| !segment.is_empty()) {
            let deltas = decode_fields(segment);
            site += deltas[0];
            let mut fields = vec![site];
            for (total, delta) in original.iter_mut().zip(&deltas[1..]) {
                *total += delta;
                fields.push(*total);
            }
            sites.push((function, fields));
        }
    }
    sites
}

fn record(function: u32, site: u32, module: u32, position: u32) -> ObfuscatedSiteRecord {
    ObfuscatedSiteRecord {
        function,
        site,
        location: SourceLocation { module, position },
        name: TextRange {
            offset: 0,
            length: 0,
        },
    }
}

fn named(record: ObfuscatedSiteRecord, offset: u32, length: u32) -> ObfuscatedSiteRecord {
    ObfuscatedSiteRecord {
        name: TextRange { offset, length },
        ..record
    }
}

fn map_of(records: &[ObfuscatedSiteRecord], text: &[u8]) -> BString {
    let fixture = ReportFixture::new(ResultRecords {
        text,
        obfuscated_sites: records,
        ..ResultRecords::default()
    });
    let executable = Executable {
        file_name: b"app",
        debug_id: None,
    };
    let map = fixture.with_input(|input| write(input.engine, input.names, input.texts, executable));
    BString::from(map)
}

fn texts() -> SourceTexts {
    SourceTexts::new(vec![
        Some(ModuleSource::new(b"/p/a.ts", b"first;\nsecond;\n")),
        None,
    ])
}

#[test]
fn empty_map_has_no_mappings() {
    assert_eq!(mappings(&[]), "");
}

#[test]
fn functions_without_sites_are_empty_lines() {
    assert_eq!(mappings(&[located(2, 0, [0, 0, 0])]), ";;AAAA");
    let sites = [located(0, 0, [0, 0, 0]), located(3, 0, [0, 0, 0])];
    assert_eq!(mappings(&sites), "AAAA;;;AAAA");
}

#[test]
fn columns_restart_on_each_line() {
    let sites = [
        located(0, 3, [0, 0, 0]),
        located(0, 5, [0, 0, 0]),
        located(1, 3, [0, 0, 0]),
    ];
    assert_eq!(mappings(&sites), "GAAA,EAAA;GAAA");
}

#[test]
fn source_positions_continue_over_lines() {
    let sites = [located(0, 0, [1, 10, 4]), located(1, 0, [1, 12, 2])];
    assert_eq!(mappings(&sites), "ACUI;AAEF");
}

#[test]
fn segment_without_position_has_one_field() {
    let sites = [
        unlocated(0, 2),
        located(0, 3, [1, 0, 0]),
        unlocated(0, 4),
        located(0, 5, [1, 0, 0]),
    ];
    assert_eq!(mappings(&sites), "E,CCAA,C,CAAA");
}

#[test]
fn name_without_position_is_dropped() {
    let site = Site {
        name: Some(4),
        ..unlocated(0, 2)
    };
    assert_eq!(mappings(&[site, named_site(0, 2, [0, 0, 0], 1)]), "E,AAAAC");
}

#[test]
fn segment_with_name_has_five_fields() {
    let sites = [
        named_site(0, 0, [0, 0, 0], 2),
        located(0, 1, [0, 0, 0]),
        named_site(0, 2, [0, 0, 0], 1),
    ];
    assert_eq!(mappings(&sites), "AAAAE,CAAA,CAAAD");
}

#[test]
fn oversized_value_saturates() {
    let sites = [unlocated(0, u32::MAX), unlocated(0, u32::MAX)];
    assert_eq!(mappings(&sites), "+/////D,A");
}

#[test]
fn mappings_decode_to_sites() {
    let sites = [
        unlocated(0, 2),
        located(0, 1000, [0, 70_000, 300]),
        named_site(3, 1, [2, 12, 4], 5),
        named_site(3, 40, [1, 12, 90], 0),
        located(4, 0, [1, 0, 0]),
    ];
    assert_eq!(
        decode_sites(&mappings(&sites)),
        [
            (0, vec![2]),
            (0, vec![1000, 0, 70_000, 300]),
            (3, vec![1, 2, 12, 4, 5]),
            (3, vec![40, 1, 12, 90, 0]),
            (4, vec![0, 1, 0, 0]),
        ]
    );
}

#[test]
fn names_and_sources_are_listed_in_order_of_first_use() {
    let mut names: ArrayHashMap<&[u8], ()> = ArrayHashMap::default();
    let indexes =
        [&b"render"[..], b"main", b"render", b"add", b"main"].map(|name| intern(&mut names, name));
    assert_eq!(indexes, [0, 1, 0, 2, 1]);
    assert_eq!(names.keys(), [&b"render"[..], b"main", b"add"]);

    let module = |word| Source::Module(ModuleId::from_word(word));
    let mut sources: ArrayHashMap<Source, ()> = ArrayHashMap::default();
    let indexes = [module(5), Source::Native, module(5)].map(|source| intern(&mut sources, source));
    assert_eq!(indexes, [0, 1, 0]);
    assert_eq!(sources.keys(), [module(5), Source::Native]);
}

#[test]
fn records_sort_by_function_and_site() {
    let records = [
        record(2, 0, 0, 10),
        record(0, 7, 0, 20),
        record(1, 9, 0, 30),
        record(0, 3, 0, 40),
    ];
    let keys: Vec<(u32, u32)> = sort_records(&records).iter().map(site_key).collect();
    assert_eq!(keys, [(0, 3), (0, 7), (1, 9), (2, 0)]);
}

#[test]
fn first_record_of_site_stays() {
    let records = [
        record(1, 0, 0, 10),
        record(0, 0, 0, 20),
        record(1, 0, 0, 30),
        record(0, 0, 0, 40),
    ];
    assert_eq!(sort_records(&records), [records[1], records[0]]);
}

#[test]
fn located_lines_and_columns_start_at_zero() {
    let records = [record(0, 0, 0, 9), record(0, 1, 0, 0), record(0, 2, 0, 7)];
    let found: Vec<Option<(ModuleId, u32, u32)>> = locate_records(&records, &texts())
        .into_iter()
        .map(|located| located.map(|found| (found.module, found.line, found.column)))
        .collect();
    let module = ModuleId::from_word(0);
    assert_eq!(
        found,
        [
            Some((module, 1, 2)),
            Some((module, 0, 0)),
            Some((module, 1, 0))
        ]
    );
}

#[test]
fn record_without_text_is_not_located() {
    let records = [
        record(0, 0, 1, 0),
        record(0, 1, 9, 0),
        record(0, 2, ABSENT_WORD, 0),
    ];
    let found = locate_records(&records, &texts());
    assert_eq!(found.len(), records.len());
    assert!(found.iter().all(Option::is_none));
}

#[test]
fn map_without_sites_has_empty_lists() {
    assert_eq!(
        map_of(&[], b""),
        concat!(
            r#"{"version":3,"file":"app","sources":[],"sourcesContent":[],"names":[],"mappings":"","#,
            r#""x_facebook_sources":[]}"#,
        )
    );
}

#[test]
fn map_lists_sources_names_and_mappings() {
    let records = [
        record(2, 1, DEPENDENCY, 0),
        named(record(0, 5, PROGRAM, LINE_2_COLUMN_14), 0, 6),
        named(record(0, 0, PROGRAM, LINE_1_COLUMN_5), 0, 6),
        record(0, 3, RUNTIME, 0),
    ];
    assert_eq!(
        map_of(&records, b"double"),
        concat!(
            r#"{"version":3,"file":"app","sources":["src/a.ts","node_modules/b/b.js"],"#,
            r#""sourcesContent":["let first = 1;\nlet second = first.size;\nexport {};\n","module.exports = {};\n"],"#,
            r#""names":["double"],"mappings":"AAAIA,G,EACSA;;CCDb","#,
            r#""x_facebook_sources":[[{"names":["double"],"mappings":"IAA"}],[{"names":["?"],"mappings":"AAA"}]]}"#,
        )
    );
}

#[test]
fn named_function_without_text_has_a_line_of_its_own() {
    let records = [
        named(record(0, 0, PROGRAM, LINE_1_COLUMN_5), 0, 6),
        named(record(0, 1, ABSENT_WORD, 0), 6, 3),
        named(record(0, 2, RUNTIME, 9), 9, 8),
        record(0, 3, ABSENT_WORD, 0),
    ];
    let map = map_of(&records, b"doublemapreadFile");
    assert!(
        map.contains_str(r#""sources":["src/a.ts","native","node:fs"],"#),
        "{map}"
    );
    assert!(map.contains_str(r#"export {};\n",null,null],"#), "{map}");
    assert!(
        map.contains_str(
            r#""names":["double","map","readFile"],"mappings":"AAAIA,CCCJC,CCCAC,C","#
        ),
        "{map}"
    );
    assert!(
        map.ends_with(
            concat!(
                r#"[{"names":["double"],"mappings":"IAA"}],[{"names":["map"],"mappings":"AAC"}],"#,
                r#"[{"names":["readFile"],"mappings":"AAE"}]]}"#,
            )
            .as_bytes()
        ),
        "{map}"
    );
}

#[test]
fn map_has_the_debug_id_in_both_spellings() {
    let fixture = ReportFixture::new(ResultRecords::default());
    let executable = Executable {
        file_name: b"app",
        debug_id: Some(b"5f0c2a9e-41d7-b386-0e9d-4c17a2f3b658"),
    };
    let map = fixture.with_input(|input| write(input.engine, input.names, input.texts, executable));
    assert!(
        BString::from(map).starts_with(
            concat!(
                r#"{"version":3,"file":"app","debugId":"5f0c2a9e-41d7-b386-0e9d-4c17a2f3b658","#,
                r#""debug_id":"5f0c2a9e-41d7-b386-0e9d-4c17a2f3b658","sources":"#,
            )
            .as_bytes()
        )
    );
}

fn start(line: u32, column: u32, name: Option<u32>) -> FunctionStart {
    FunctionStart { line, column, name }
}

fn function_mappings(starts: &[FunctionStart]) -> BString {
    let mut out = Vec::new();
    write_function_mappings(starts, &mut out, |name| name.unwrap_or(0));
    BString::from(out)
}

// As Metro's reader does it: lines count from one, and a `;` sets the column back to zero.
fn decode_function_mappings(mappings: &[u8]) -> Vec<[i32; 3]> {
    let (mut line, mut name) = (1, 0);
    let mut starts = Vec::new();
    for group in bun_core::strings::split(mappings, b";") {
        let mut column = 0;
        for segment in bun_core::strings::split(group, b",") {
            let deltas = decode_fields(segment);
            column += deltas[0];
            name += deltas[1];
            line += deltas[2];
            starts.push([line, column, name]);
        }
    }
    starts
}

#[test]
fn function_starts_keep_only_name_changes() {
    let mut starts = vec![
        start(4, 2, Some(1)),
        start(0, 0, None),
        start(2, 8, Some(0)),
        start(2, 4, Some(0)),
        start(3, 0, Some(0)),
        start(9, 0, None),
    ];
    keep_name_changes(&mut starts);
    assert_eq!(
        starts,
        [
            start(0, 0, None),
            start(2, 4, Some(0)),
            start(4, 2, Some(1)),
            start(9, 0, None),
        ]
    );
}

#[test]
fn name_wins_over_none_at_one_place() {
    let mut starts = vec![start(1, 3, None), start(1, 3, Some(2)), start(0, 0, None)];
    keep_name_changes(&mut starts);
    assert_eq!(starts, [start(0, 0, None), start(1, 3, Some(2))]);
}

#[test]
fn function_mappings_decode_to_starts() {
    let starts = [
        start(0, 4, Some(0)),
        start(0, 30, Some(2)),
        start(6, 2, Some(1)),
        start(6, 9, Some(0)),
        start(400, 0, Some(3)),
    ];
    assert_eq!(function_mappings(&starts), "IAA,0BEA;EDM,ODA;AG0Y");
    assert_eq!(
        decode_function_mappings(&function_mappings(&starts)),
        [[1, 4, 0], [1, 30, 2], [7, 2, 1], [7, 9, 0], [401, 0, 3]]
    );
}

#[test]
fn source_without_sites_has_no_function_mappings() {
    assert_eq!(function_mappings(&[]), "");
}
