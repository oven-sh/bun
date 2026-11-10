use super::numbering::{Numbering, TableIds};
use super::unit::LinkUnit;
use crate::builtins::table;
use crate::ir::generated::{FieldFlags, Layout, LayoutFlags, LayoutKind, PropertyKeyKind};
use crate::ir::{Id, InParallel, PropertyKeyId, PropertyKeyTable, StringTable, for_each_mut};
use std::sync::atomic::{AtomicBool, Ordering};

pub(super) struct UseInput<'a> {
    pub units: &'a [LinkUnit],
    pub numbering: &'a Numbering,
    pub property_keys: &'a PropertyKeyTable,
    pub strings: &'a StringTable,
    pub in_parallel: InParallel<'a>,
}

const UNITS_IN_A_TASK: usize = 64;
const LAYOUTS_IN_A_TASK: usize = 1024;

impl UseInput<'_> {
    pub(super) fn for_each_unit(&self, visit: &(dyn Fn(&LinkUnit, &TableIds) + Sync)) {
        let units: Vec<&[LinkUnit]> = self.units.chunks(UNITS_IN_A_TASK).collect();
        let tables = &self.numbering.tables;
        (self.in_parallel)(units.len(), &|task| {
            for unit in units[task] {
                visit(unit, &tables[unit.tables as usize]);
            }
        });
    }

    pub(super) fn for_each_layout(
        &self,
        layouts: &mut [Layout],
        marks: &[AtomicBool],
        visit: &(dyn Fn(&mut Layout, bool) + Sync),
    ) {
        debug_assert_eq!(layouts.len(), marks.len());
        let layouts = layouts.chunks_mut(LAYOUTS_IN_A_TASK);
        let mut tasks: Vec<_> = layouts.zip(marks.chunks(LAYOUTS_IN_A_TASK)).collect();
        for_each_mut(&mut tasks, self.in_parallel, &|(layouts, marks)| {
            for (layout, mark) in layouts.iter_mut().zip(marks.iter()) {
                visit(layout, mark.load(Ordering::Relaxed));
            }
        });
    }
}

pub(super) fn unmarked(count: usize) -> Vec<AtomicBool> {
    (0..count).map(|_| AtomicBool::new(false)).collect()
}

pub(super) fn set_mark(mark: &AtomicBool) {
    if !mark.load(Ordering::Relaxed) {
        mark.store(true, Ordering::Relaxed);
    }
}

pub(super) fn is_plain_record(layout: &Layout) -> bool {
    layout.kind == LayoutKind::Record && layout.constructor.is_none()
}

fn find_allocated_layouts(input: &UseInput<'_>) -> Vec<AtomicBool> {
    let is_allocated = unmarked(input.numbering.counts.layouts);
    input.for_each_unit(&|unit, ids| {
        for layout in &unit.allocated_layouts {
            if let Some(id) = ids.layouts[layout.index()] {
                set_mark(&is_allocated[id.index()]);
            }
        }
    });
    is_allocated
}

fn find_written_keys(layouts: &[Layout], input: &UseInput<'_>) -> Vec<AtomicBool> {
    let is_written = unmarked(input.property_keys.len());
    input.for_each_unit(&|unit, ids| {
        for &key in &unit.written_keys {
            if let Some(id) = ids.property_keys[key.index()] {
                set_mark(&is_written[id.index()]);
            }
        }
    });
    let tasks: Vec<&[Layout]> = layouts.chunks(LAYOUTS_IN_A_TASK).collect();
    (input.in_parallel)(tasks.len(), &|task| {
        for layout in tasks[task].iter().filter(|layout| !is_plain_record(layout)) {
            let keys = layout.fields.iter().map(|field| field.key);
            for key in keys
                .flatten()
                .chain(layout.static_fields.iter().map(|field| field.key))
            {
                set_mark(&is_written[key.index()]);
            }
        }
    });
    is_written
}

fn find_keys_read_and_laid_by_no_descriptor(input: &UseInput<'_>) -> Vec<AtomicBool> {
    let is_read = unmarked(input.property_keys.len());
    let is_laid = unmarked(input.property_keys.len());
    input.for_each_unit(&|unit, ids| {
        for (keys, marks) in [
            (&unit.read_keys, &is_read),
            (&unit.keys_laid_by_descriptors, &is_laid),
        ] {
            for &key in keys {
                if let Some(id) = ids.property_keys[key.index()] {
                    set_mark(&marks[id.index()]);
                }
            }
        }
    });
    for (read, laid) in is_read.iter().zip(&is_laid) {
        if laid.load(Ordering::Relaxed) {
            read.store(false, Ordering::Relaxed);
        }
    }
    is_read
}

fn is_stored_by_native_code(input: &UseInput<'_>, key: PropertyKeyId) -> bool {
    let key = input.property_keys.get(key);
    let text = key.text.filter(|_| key.kind == PropertyKeyKind::Text);
    let name = text.and_then(|text| input.strings.builtin_name(text));
    name.is_some_and(table::is_stored_by_native_code)
}

pub(super) fn mark_unused_records(layouts: &mut [Layout], input: &UseInput<'_>) {
    let is_allocated = find_allocated_layouts(input);
    let is_written = find_written_keys(layouts, input);
    let is_read = find_keys_read_and_laid_by_no_descriptor(input);
    input.for_each_layout(layouts, &is_allocated, &|layout, is_allocated| {
        if !is_plain_record(layout) {
            return;
        }
        if !is_allocated {
            layout.flags |= LayoutFlags::IS_NEVER_ALLOCATED;
        }
        for field in &mut layout.fields {
            let Some(key) = field.key else { continue };
            if input.property_keys.get(key).kind != PropertyKeyKind::Text {
                continue;
            }
            let is_required = field.flags.contains(FieldFlags::IS_REQUIRED);
            if is_written[key.index()].load(Ordering::Relaxed)
                || (is_required && is_stored_by_native_code(input, key))
            {
                continue;
            }
            field.flags = field.flags.without(FieldFlags::IS_REQUIRED);
            field.flags |= FieldFlags::IS_NEVER_WRITTEN;
            if is_required && is_read[key.index()].load(Ordering::Relaxed) {
                field.flags |= FieldFlags::IS_REQUIRED_AND_READ_THOUGH_NEVER_WRITTEN;
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ir::generated::{Field, PropertyKey};
    use crate::ir::{LayoutId, Program};
    use crate::link::numbering::ProgramCounts;
    use crate::link::testing::{
        forward, link_sources_without_bun_modules, units_in_tasks, with_test_files,
    };
    use crate::load::PerProject;

    const MAIN: &str = r#"
import { make } from "./maker";
interface View { _viewBrand: any; id: number }
interface Made { id: number; label: string }
interface Stored { late: number }
export function read(view: View, made: Made): number { return view.id + made.id + make(1).id; }
export function store(stored: Stored): void { stored.late = 1; }
"#;

    const MAKER: &str = r#"
export interface Made { id: number; label: string }
export function make(id: number): Made { return { id, label: "made" }; }
"#;

    fn find_layout<'a>(program: &'a Program, name: &str) -> &'a Layout {
        let declaration = format!("interface {name} ");
        let places = [MAIN, MAKER, FILLED_BY_NATIVE_CODE].map(|source| {
            let written = source.find(&declaration)?;
            Some((written + "interface ".len()) as u32)
        });
        let is_written_there =
            |layout: &&Layout| layout.module.is_some() && places.contains(&Some(layout.position));
        program.layouts.iter().find(is_written_there).expect(name)
    }

    fn flags_of_field(program: &Program, layout: &Layout, name: &str) -> FieldFlags {
        let has_name = |key: PropertyKeyId| {
            let text = program.property_keys.get(key).text;
            text.is_some_and(|id| program.strings.get(id) == name.as_bytes())
        };
        let field = layout
            .fields
            .iter()
            .find(|field| field.key.is_some_and(has_name));
        field.expect(name).flags
    }

    #[test]
    fn a_record_is_allocated_if_any_file_allocates_it() {
        let linked = link_sources_without_bun_modules(&[("main.ts", MAIN), ("maker.ts", MAKER)]);
        let program = &linked.expect("the program links").program;
        let never_allocated = LayoutFlags::IS_NEVER_ALLOCATED;
        assert!(!find_layout(program, "Made").flags.contains(never_allocated));
        assert!(find_layout(program, "View").flags.contains(never_allocated));
        assert!(
            find_layout(program, "Stored")
                .flags
                .contains(never_allocated)
        );
    }

    #[test]
    fn a_name_is_written_if_any_file_writes_it_into_any_object() {
        let linked = link_sources_without_bun_modules(&[("main.ts", MAIN), ("maker.ts", MAKER)]);
        let program = &linked.expect("the program links").program;
        let view = find_layout(program, "View");
        assert_eq!(
            flags_of_field(program, view, "_viewBrand"),
            FieldFlags::IS_NEVER_WRITTEN
        );
        assert_eq!(flags_of_field(program, view, "id"), FieldFlags::IS_REQUIRED);
        let stored = find_layout(program, "Stored");
        assert_eq!(
            flags_of_field(program, stored, "late"),
            FieldFlags::IS_REQUIRED
        );
        let made = find_layout(program, "Made");
        assert_eq!(
            flags_of_field(program, made, "label"),
            FieldFlags::IS_REQUIRED
        );
    }

    const STORED_UNDER_A_SYMBOL: &str = r#"
const kState = Symbol("state");
interface Holder { [kState]: number | undefined; never: number }
export function store(holder: Holder): void { holder[kState] = 1; }
export function read(holder: Holder): number { return (holder[kState] ?? 0) + holder.never; }
"#;

    #[test]
    fn nobody_says_of_a_key_under_a_symbol_that_it_is_never_written() {
        let linked = link_sources_without_bun_modules(&[("main.ts", STORED_UNDER_A_SYMBOL)]);
        let program = &linked.expect("the program links").program;
        let written = STORED_UNDER_A_SYMBOL.find("interface Holder ").unwrap() + "interface ".len();
        let is_holder =
            |layout: &&Layout| layout.module.is_some() && layout.position == written as u32;
        let holder = program.layouts.iter().find(is_holder).expect("Holder");
        let is_symbol =
            |key: PropertyKeyId| program.property_keys.get(key).kind != PropertyKeyKind::Text;
        let under_symbol = holder
            .fields
            .iter()
            .find(|field| field.key.is_some_and(is_symbol));
        assert_eq!(under_symbol.expect("kState").flags, FieldFlags::IS_REQUIRED);
        assert_eq!(
            flags_of_field(program, holder, "never"),
            FieldFlags::IS_NEVER_WRITTEN | FieldFlags::IS_REQUIRED_AND_READ_THOUGH_NEVER_WRITTEN
        );
    }

    const FILLED_BY_NATIVE_CODE: &str = r#"
/// <reference lib="dom" />
interface Warning extends Error { level: number }
interface Failures extends AggregateError { level: number }
interface Upload extends Blob { level: number }
interface Step { done: boolean; value: number }
interface Match { index: number; groups: object }
interface Traced { originalLine: number }
interface Branded { __brand: "level"; level: number }
export function read(warning: Warning, failures: Failures, upload: Upload, branded: Branded): number {
  return warning.level + failures.level + upload.level + branded.level;
}
export function readResults(step: Step, match: Match, traced: Traced): number {
  return step.value + match.index + traced.originalLine;
}
export function make(level: number) { return { name: "made", level }; }
"#;

    fn required_names(program: &Program, layout: &Layout) -> Vec<String> {
        let is_required = |field: &&Field| field.flags.contains(FieldFlags::IS_REQUIRED);
        let fields = layout.fields.iter().filter(is_required);
        let texts = fields.filter_map(|field| program.property_keys.get(field.key?).text);
        texts
            .map(|text| String::from_utf8_lossy(program.strings.get(text)).into_owned())
            .collect()
    }

    #[test]
    fn a_name_that_only_native_code_stores_stays_required() {
        let linked = link_sources_without_bun_modules(&[("main.ts", FILLED_BY_NATIVE_CODE)]);
        let program = &linked.expect("the program links").program;
        for (layout, names) in [
            ("Warning", &["name", "message", "level"][..]),
            ("Failures", &["errors", "name", "message", "level"]),
            ("Upload", &["size", "type", "level"]),
            ("Step", &["done", "value"]),
            ("Match", &["index", "groups"]),
            ("Traced", &["originalLine"]),
        ] {
            let layout = find_layout(program, layout);
            let required = required_names(program, layout);
            for &name in names {
                assert!(required.iter().any(|it| it == name), "{name}: {required:?}");
            }
        }
    }

    #[test]
    fn an_optional_field_that_only_native_code_stores_is_never_written() {
        let linked = link_sources_without_bun_modules(&[("main.ts", FILLED_BY_NATIVE_CODE)]);
        let program = &linked.expect("the program links").program;
        let warning = find_layout(program, "Warning");
        assert_eq!(
            flags_of_field(program, warning, "stack"),
            FieldFlags::IS_NEVER_WRITTEN
        );
    }

    #[test]
    fn a_brand_that_nothing_stores_is_not_required() {
        let linked = link_sources_without_bun_modules(&[("main.ts", FILLED_BY_NATIVE_CODE)]);
        let program = &linked.expect("the program links").program;
        let branded = find_layout(program, "Branded");
        assert_eq!(
            flags_of_field(program, branded, "__brand"),
            FieldFlags::IS_NEVER_WRITTEN
        );
        assert_eq!(required_names(program, branded), ["level"]);
    }

    const MADE_OUTSIDE: &str = r#"
interface Parsed { kind: string; left: number[]; _parsedBrand: any; extra?: number }
interface Gate { kind: string; limit: number }
interface Laid { kind: string; unread: number }
export function make(kind: string) { return { kind }; }
export function read(parsed: Parsed, gate: Gate): number {
  return parsed.left.length + (parsed.extra ?? 0) + gate.limit;
}
export function define(gate: Gate, laid: Laid): void {
  Object.defineProperty(gate, "limit", { value: 1 });
  Object.defineProperty(laid, "unread", { value: 2 });
}
"#;

    fn flags_in_made_outside(record: &str, name: &str) -> FieldFlags {
        let linked = link_sources_without_bun_modules(&[("main.ts", MADE_OUTSIDE)]);
        let program = &linked.expect("the program links").program;
        let declaration = format!("interface {record} ");
        let written = MADE_OUTSIDE.find(&declaration).unwrap() + "interface ".len();
        let is_written_there =
            |layout: &&Layout| layout.module.is_some() && layout.position == written as u32;
        let layout = program.layouts.iter().find(is_written_there).expect(record);
        flags_of_field(program, layout, name)
    }

    #[test]
    fn a_required_name_that_is_read_and_never_written_says_so() {
        assert_eq!(
            flags_in_made_outside("Parsed", "left"),
            FieldFlags::IS_NEVER_WRITTEN | FieldFlags::IS_REQUIRED_AND_READ_THOUGH_NEVER_WRITTEN
        );
        assert_eq!(
            flags_in_made_outside("Parsed", "_parsedBrand"),
            FieldFlags::IS_NEVER_WRITTEN
        );
        assert_eq!(
            flags_in_made_outside("Parsed", "extra"),
            FieldFlags::IS_NEVER_WRITTEN
        );
        assert_eq!(
            flags_in_made_outside("Parsed", "kind"),
            FieldFlags::IS_REQUIRED
        );
    }

    #[test]
    fn a_name_that_is_read_and_laid_by_a_descriptor_under_a_written_key_does_not_say_so() {
        assert_eq!(
            flags_in_made_outside("Gate", "limit"),
            FieldFlags::IS_NEVER_WRITTEN
        );
    }

    #[test]
    fn a_name_that_a_descriptor_lays_and_nobody_reads_does_not_say_so() {
        assert_eq!(
            flags_in_made_outside("Laid", "unread"),
            FieldFlags::IS_NEVER_WRITTEN
        );
    }

    fn record_with_keys(count: usize) -> Layout {
        let field_under = |key: usize| Field {
            key: Some(PropertyKeyId::new(key)),
            ..Field::default()
        };
        Layout {
            kind: LayoutKind::Record,
            fields: (0..count).map(field_under).collect(),
            ..Layout::default()
        }
    }

    #[test]
    fn each_unit_is_read_through_its_own_tables() {
        with_test_files(|projects, [main, first, _]| {
            let mut units = units_in_tasks(projects, &[&[main], &[first]], |_| {});
            for (tables, unit) in (0..).zip(&mut units) {
                unit.tables = tables;
                unit.allocated_layouts = vec![LayoutId::new(0)];
                unit.written_keys = vec![PropertyKeyId::new(0)];
            }
            let table_ids_mapping_0_to = |layout: usize, key: usize| TableIds {
                layouts: vec![Some(LayoutId::new(layout))],
                property_keys: vec![Some(PropertyKeyId::new(key))],
                ..TableIds::default()
            };
            let numbering = Numbering {
                functions: Vec::new(),
                layouts: Vec::new(),
                variables: Vec::new(),
                modules: Vec::new(),
                module_failures: PerProject::default(),
                counts: ProgramCounts {
                    layouts: 3,
                    ..ProgramCounts::default()
                },
                tables: vec![table_ids_mapping_0_to(2, 0), table_ids_mapping_0_to(0, 2)],
                layout_keys: Vec::new(),
            };
            let mut strings = StringTable::default();
            let mut property_keys = PropertyKeyTable::default();
            for name in [b"a", b"b", b"c"] {
                property_keys.intern(PropertyKey::from_text(strings.intern(name)));
            }
            let mut layouts = vec![record_with_keys(3); 3];
            let input = UseInput {
                units: &units,
                numbering: &numbering,
                property_keys: &property_keys,
                strings: &strings,
                in_parallel: &forward,
            };
            mark_unused_records(&mut layouts, &input);
            let (written, never_written) = (FieldFlags::default(), FieldFlags::IS_NEVER_WRITTEN);
            for (layout, is_allocated) in layouts.iter().zip([true, false, true]) {
                let is_never_allocated = layout.flags.contains(LayoutFlags::IS_NEVER_ALLOCATED);
                assert_eq!(is_never_allocated, !is_allocated);
                let flags = layout.fields.iter().map(|field| field.flags);
                assert!(flags.eq([written, never_written, written]));
            }
        });
    }
}
