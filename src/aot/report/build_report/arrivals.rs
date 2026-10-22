use super::sites::FunctionIndex;
use super::{write_position, write_position_members};
use crate::diagnostics::SourcePosition;
use crate::engine::{
    ArrivalLayoutFieldRecord, ArrivalLayoutRecord, ArrivalSiteRecord, Position, position_of,
};
use crate::ir::generated::{ArrivalFieldFlags, ArrivalLayoutFlags, ArrivalStamp};
use crate::ir::ids::ModuleId;
use crate::link::ProgramNames;
use crate::report::ReportInput;
use crate::report::format::{code_of, lower_camel_case};
use crate::report::json::JsonWriter;
use crate::report::positions::{Positions, resolve_ascending};
use crate::report::wording::level_label;

pub(super) fn write_arrival_sites(
    json: &mut JsonWriter,
    input: &ReportInput<'_>,
    positions: &mut Positions<'_>,
    functions: &FunctionIndex,
) {
    let sites = input.engine.arrival_sites();
    let site_layouts = input.engine.arrival_site_layouts();
    write_site_list(json, input, positions, functions, sites, site_layouts);
}

pub(super) fn write_layouts_of_arrival_sites(
    json: &mut JsonWriter,
    input: &ReportInput<'_>,
    positions: &mut Positions<'_>,
) {
    let layouts = input.engine.arrival_layouts();
    let fields = input.engine.arrival_layout_fields();
    write_layout_list(json, input, positions, layouts, fields);
}

// The counts of a run name a site by its number, so every numbered site is listed, those in Bun's own modules too.
fn write_site_list(
    json: &mut JsonWriter,
    input: &ReportInput<'_>,
    positions: &mut Positions<'_>,
    functions: &FunctionIndex,
    sites: &[ArrivalSiteRecord],
    site_layouts: &[u32],
) {
    let wanted: Vec<Option<Position>> = sites
        .iter()
        .map(|site| position_of(site.location))
        .collect();
    let resolved = resolve_ascending(&wanted, |position| positions.resolve(position));
    json.begin_array("arrivalSites");
    for (site, position) in sites.iter().zip(resolved) {
        let position = position.unwrap_or_else(|| unlocated_position(input.names, positions, site));
        let expected = range_of(
            site_layouts,
            site.first_expected_layout,
            site.expected_layout_count,
        );
        json.begin_element();
        json.number("number", u64::from(site.number));
        write_position_members(json, &position);
        json.number("offset", u64::from(site.location.position));
        json.optional_number("function", functions.get(site.function_id()));
        json.string("operation", input.engine.text(site.operation));
        json.string("kind", &lower_camel_case(site.kind.name()));
        json.string("level", level_label(site.level).as_bytes());
        json.string("cause", &code_of(site.cause.name()));
        json.numbers("expected", expected.iter().map(|&layout| u64::from(layout)));
        json.string("stamp", stamp_name(site.stamp).as_bytes());
        json.end_object();
    }
    json.end_array();
}

fn write_layout_list(
    json: &mut JsonWriter,
    input: &ReportInput<'_>,
    positions: &mut Positions<'_>,
    layouts: &[ArrivalLayoutRecord],
    fields: &[ArrivalLayoutFieldRecord],
) {
    let engine = input.engine;
    let wanted: Vec<Option<Position>> = layouts
        .iter()
        .map(|layout| input.names.layout_position(layout.layout_id()))
        .collect();
    let resolved = resolve_ascending(&wanted, |position| positions.resolve(position));
    json.begin_array("layouts");
    for (layout, position) in layouts.iter().zip(&resolved) {
        let fields = range_of(fields, layout.first_field, layout.field_count);
        let optional = fields
            .iter()
            .filter(|field| field.flags.contains(ArrivalFieldFlags::IS_OPTIONAL));
        let kind = String::from_utf8_lossy(engine.text(layout.kind));
        let base = layout.base_id().map(|base| u64::from(base.to_word()));
        json.begin_element();
        json.number("id", u64::from(layout.layout));
        json.string("name", engine.text(layout.name));
        json.string("kind", &lower_camel_case(&kind));
        json.optional_number("base", base);
        json.boolean("isDerived", layout.flags.contains(ArrivalLayoutFlags::IS_DERIVED));
        write_position(json, "position", position.as_ref());
        json.strings("fields", fields.iter().map(|field| engine.text(field.name)));
        json.strings("optional", optional.map(|field| engine.text(field.name)));
        json.end_object();
    }
    json.end_array();
}

fn stamp_name(stamp: ArrivalStamp) -> &'static str {
    match stamp {
        ArrivalStamp::None => "none",
        ArrivalStamp::Open => "open",
        ArrivalStamp::Complete => "complete",
    }
}

fn range_of<T>(list: &[T], first: u32, count: u32) -> &[T] {
    let first = first as usize;
    list.get(first..first + count as usize).unwrap_or(&[])
}

fn module_of(names: &ProgramNames, site: &ArrivalSiteRecord) -> Option<ModuleId> {
    match position_of(site.location) {
        Some(position) => Some(position.module),
        None => names.function_module(site.function_id()?),
    }
}

// The build keeps no text of Bun's own modules: the path and the member "offset" tell their sites apart.
fn unlocated_position(
    names: &ProgramNames,
    positions: &Positions<'_>,
    site: &ArrivalSiteRecord,
) -> SourcePosition {
    let module = module_of(names, site);
    SourcePosition {
        path: module.map_or_else(Vec::new, |module| {
            positions.shown_path(names.module_path(module))
        }),
        line: 0,
        column: 0,
    }
}

#[cfg(test)]
mod tests {
    use bstr::{BString, ByteSlice};

    use super::super::sites::index_functions;
    use super::*;
    use crate::engine::testing::ResultRecords;
    use crate::engine::{FunctionReportRecord, SourceLocation, TextRange};
    use crate::ir::generated::{AccessKind, KnowledgeLevel, UnprovenCause};
    use crate::ir::ids::ABSENT_WORD;
    use crate::report::positions::PathStyle;
    use crate::report::testing::{
        LINE_2_COLUMN_14, NO_LOCATION, PROGRAM, PROGRAM_FUNCTION, RUNTIME, RUNTIME_FUNCTION,
        ReportFixture, location,
    };

    const TEXT: &[u8] = b"PropGetInstanceRecordItemxy";
    const PROP_GET: TextRange = range(0, 7);
    const INSTANCE: TextRange = range(7, 8);
    const RECORD: TextRange = range(15, 6);
    const ITEM: TextRange = range(21, 4);
    const X: TextRange = range(25, 1);
    const Y: TextRange = range(26, 1);
    const NO_TEXT: TextRange = range(0, 0);

    const fn range(offset: u32, length: u32) -> TextRange {
        TextRange { offset, length }
    }

    fn site(number: u32, location: SourceLocation, function: u32) -> ArrivalSiteRecord {
        ArrivalSiteRecord {
            number,
            location,
            function,
            operation: PROP_GET,
            kind: AccessKind::Read,
            level: KnowledgeLevel::Unknown,
            cause: UnprovenCause::UnknownObject,
            first_expected_layout: 0,
            expected_layout_count: 0,
            stamp: ArrivalStamp::None,
        }
    }

    fn function_with_source(source: u32) -> FunctionReportRecord {
        FunctionReportRecord {
            source,
            role: NO_TEXT,
            code_bytes: 0,
            accesses: [0; 3],
            calls: [0; 3],
            first_operation: 0,
            operation_count: 0,
            access_costs: [0; 4],
        }
    }

    fn written(
        write: impl FnOnce(&mut JsonWriter, &ReportInput<'_>, &mut Positions<'_>),
    ) -> BString {
        let fixture = ReportFixture::new(ResultRecords {
            text: TEXT,
            ..ResultRecords::default()
        });
        fixture.with_input(|input| {
            let mut positions = Positions::new(input, PathStyle::Posix);
            let mut json = JsonWriter::object();
            write(&mut json, input, &mut positions);
            BString::from(json.finish())
        })
    }

    fn written_sites(sites: &[ArrivalSiteRecord], site_layouts: &[u32]) -> BString {
        let functions = [RUNTIME_FUNCTION, PROGRAM_FUNCTION].map(function_with_source);
        let functions = index_functions(&functions);
        written(|json, input, positions| {
            write_site_list(json, input, positions, &functions, sites, site_layouts);
        })
    }

    fn written_layouts(
        layouts: &[ArrivalLayoutRecord],
        fields: &[ArrivalLayoutFieldRecord],
    ) -> BString {
        written(|json, input, positions| write_layout_list(json, input, positions, layouts, fields))
    }

    #[test]
    fn guarded_site_lists_its_expected_layouts() {
        let guarded = ArrivalSiteRecord {
            level: KnowledgeLevel::Expected,
            first_expected_layout: 1,
            expected_layout_count: 2,
            stamp: ArrivalStamp::Open,
            ..site(7, location(PROGRAM, LINE_2_COLUMN_14), PROGRAM_FUNCTION)
        };
        let expected = concat!(
            r#"{"arrivalSites":[{"number":7,"file":"src/a.ts","line":2,"column":14,"offset":28,"#,
            r#""function":1,"operation":"PropGet","kind":"read","level":"guarded","#,
            r#""cause":"unknown-object","expected":[9,4],"stamp":"open"}]}"#,
        );
        assert_eq!(written_sites(&[guarded], &[2, 9, 4, 6]), expected);
    }

    #[test]
    fn site_in_runtime_module_has_path_and_offset() {
        let expected = concat!(
            r#"{"arrivalSites":[{"number":0,"file":"node:fs","line":0,"column":0,"offset":9,"#,
            r#""function":0,"operation":"PropGet","kind":"read","level":"unknown","#,
            r#""cause":"unknown-object","expected":[],"stamp":"none"}]}"#,
        );
        let in_runtime = site(0, location(RUNTIME, 9), RUNTIME_FUNCTION);
        assert_eq!(written_sites(&[in_runtime], &[]), expected);
    }

    #[test]
    fn site_without_location_is_in_module_of_its_function() {
        let sites = [
            site(0, NO_LOCATION, PROGRAM_FUNCTION),
            site(1, NO_LOCATION, ABSENT_WORD),
        ];
        let document = written_sites(&sites, &[]);
        let of_function = r#"{"number":0,"file":"src/a.ts","line":0,"column":0,"offset":0,"function":1,"#;
        let of_nothing = r#"{"number":1,"file":"","line":0,"column":0,"offset":0,"function":null,"#;
        assert!(document.find(of_function).is_some(), "{document}");
        assert!(document.find(of_nothing).is_some(), "{document}");
    }

    #[test]
    fn sites_keep_the_order_of_their_numbers() {
        let sites = [
            site(0, location(PROGRAM, LINE_2_COLUMN_14), PROGRAM_FUNCTION),
            site(1, location(PROGRAM, 0), PROGRAM_FUNCTION),
            site(2, location(PROGRAM, LINE_2_COLUMN_14), PROGRAM_FUNCTION),
        ];
        let document = written_sites(&sites, &[]);
        let starts: Vec<usize> = [
            r#"{"number":0,"file":"src/a.ts","line":2,"column":14,"#,
            r#"{"number":1,"file":"src/a.ts","line":1,"column":1,"#,
            r#"{"number":2,"file":"src/a.ts","line":2,"column":14,"#,
        ]
        .iter()
        .filter_map(|start| document.find(start))
        .collect();
        assert_eq!(starts.len(), 3, "{document}");
        assert!(starts.is_sorted(), "{document}");
    }

    #[test]
    fn range_outside_its_list_is_empty() {
        assert_eq!(range_of(&[1, 2, 3], 1, 2), [2, 3]);
        assert_eq!(range_of(&[1, 2, 3], 3, 0), [0; 0]);
        assert_eq!(range_of(&[1, 2, 3], 2, 2), [0; 0]);
        assert_eq!(range_of(&[1, 2, 3], 4, 0), [0; 0]);
    }

    #[test]
    fn stamps_have_three_names() {
        let names = ArrivalStamp::ALL.map(stamp_name);
        assert_eq!(names, ["none", "open", "complete"]);
    }

    #[test]
    fn layout_lists_fields_in_order_and_the_optional_ones() {
        let fields = [
            ArrivalLayoutFieldRecord {
                name: Y,
                flags: ArrivalFieldFlags::IS_OPTIONAL,
            },
            ArrivalLayoutFieldRecord {
                name: Y,
                flags: ArrivalFieldFlags::IS_OPTIONAL,
            },
            ArrivalLayoutFieldRecord {
                name: X,
                flags: ArrivalFieldFlags::default(),
            },
        ];
        let layouts = [
            ArrivalLayoutRecord {
                layout: 0,
                base: ABSENT_WORD,
                kind: INSTANCE,
                name: ITEM,
                first_field: 1,
                field_count: 2,
                flags: ArrivalLayoutFlags::default(),
            },
            ArrivalLayoutRecord {
                layout: 40,
                base: 0,
                kind: RECORD,
                name: NO_TEXT,
                first_field: 0,
                field_count: 0,
                flags: ArrivalLayoutFlags::IS_DERIVED,
            },
        ];
        let expected = concat!(
            r#"{"layouts":[{"id":0,"name":"Item","kind":"instance","base":null,"isDerived":false,"#,
            r#""position":null,"fields":["y","x"],"optional":["y"]},"#,
            r#"{"id":40,"name":"","kind":"record","base":0,"isDerived":true,"#,
            r#""position":null,"fields":[],"optional":[]}]}"#,
        );
        assert_eq!(written_layouts(&layouts, &fields), expected);
    }

    #[test]
    fn build_that_counts_nothing_has_empty_lists() {
        assert_eq!(written_sites(&[], &[]), r#"{"arrivalSites":[]}"#);
        assert_eq!(written_layouts(&[], &[]), r#"{"layouts":[]}"#);
    }
}
