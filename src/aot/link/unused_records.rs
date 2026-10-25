use super::state::{Numbering, UnitIds};
use super::unit::LinkUnit;
use crate::builtins::table;
use crate::ir::generated::{
    FieldFlags, Layout, LayoutFlags, LayoutKind, PropertyKey, PropertyKeyKind,
};
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
    pub(super) fn for_each_unit(&self, visit: &(dyn Fn(&LinkUnit, &UnitIds) + Sync)) {
        let units: Vec<_> = self.units.chunks(UNITS_IN_A_TASK).collect();
        let ids: Vec<_> = self.numbering.units.chunks(UNITS_IN_A_TASK).collect();
        (self.in_parallel)(units.len(), &|task| {
            for (unit, ids) in units[task].iter().zip(ids[task]) {
                visit(unit, ids);
            }
        });
    }

    pub(super) fn for_each_layout(
        &self,
        layouts: &mut [Layout],
        marks: &[AtomicBool],
        visit: &(dyn Fn(&mut Layout, bool) + Sync),
    ) {
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

// Most marks are set many times, and a store takes the line from every other thread.
pub(super) fn set_mark(mark: &AtomicBool) {
    if !mark.load(Ordering::Relaxed) {
        mark.store(true, Ordering::Relaxed);
    }
}

// Every other layout comes with the code that makes its objects and fills them.
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

// An object literal names its layout and the places of its fields. The key may be in the program for another unit's sake.
pub(super) fn find_program_key(
    input: &UseInput<'_>,
    unit: &LinkUnit,
    ids: &UnitIds,
    key: PropertyKeyId,
) -> Option<PropertyKeyId> {
    if let Some(id) = ids.property_keys[key.index()] {
        return Some(id);
    }
    let local = unit.property_keys.get(key);
    if local.kind != PropertyKeyKind::Text {
        return None;
    }
    let text = input.strings.find(unit.strings.get(local.text?))?;
    input.property_keys.find(&PropertyKey::from_text(text))
}

fn find_written_keys(layouts: &[Layout], input: &UseInput<'_>) -> Vec<AtomicBool> {
    let is_written = unmarked(input.property_keys.len());
    input.for_each_unit(&|unit, ids| {
        for &key in &unit.written_keys {
            if let Some(id) = find_program_key(input, unit, ids, key) {
                set_mark(&is_written[id.index()]);
            }
        }
    });
    let tasks: Vec<&[Layout]> = layouts.chunks(LAYOUTS_IN_A_TASK).collect();
    (input.in_parallel)(tasks.len(), &|task| {
        for layout in tasks[task].iter().filter(|layout| !is_plain_record(layout)) {
            let keys = layout.fields.iter().map(|field| field.key);
            for key in keys
                .chain(layout.static_fields.iter().map(|field| field.key))
                .flatten()
            {
                set_mark(&is_written[key.index()]);
            }
        }
    });
    is_written
}

// An error has a message that no compiled code stored: a type that requires one describes what native code makes.
fn is_stored_by_native_code(input: &UseInput<'_>, key: PropertyKeyId) -> bool {
    let key = input.property_keys.get(key);
    let text = key.text.filter(|_| key.kind == PropertyKeyKind::Text);
    let name = text.and_then(|text| input.strings.builtin_name(text));
    name.is_some_and(table::is_stored_by_native_code)
}

/// Says of a plain record that nothing in the program makes an object with it: it only describes objects.
/// Answers whether the program writes a property under `asked_name`.
pub(super) fn mark_unused_records(
    layouts: &mut [Layout],
    input: &UseInput<'_>,
    asked_name: &[u8],
) -> bool {
    let is_allocated = find_allocated_layouts(input);
    let is_written = find_written_keys(layouts, input);
    let asked_text = input.strings.find(asked_name);
    let asked_key =
        asked_text.and_then(|text| input.property_keys.find(&PropertyKey::from_text(text)));
    let is_asked_name_written =
        asked_key.is_some_and(|key| is_written[key.index()].load(Ordering::Relaxed));
    input.for_each_layout(layouts, &is_allocated, &|layout, is_allocated| {
        if !is_plain_record(layout) {
            return;
        }
        if !is_allocated {
            layout.flags |= LayoutFlags::IS_NEVER_ALLOCATED;
        }
        for field in &mut layout.fields {
            let Some(key) = field.key else { continue };
            let is_required = field.flags.contains(FieldFlags::IS_REQUIRED);
            if is_written[key.index()].load(Ordering::Relaxed)
                || (is_required && is_stored_by_native_code(input, key))
            {
                continue;
            }
            field.flags = field.flags.without(FieldFlags::IS_REQUIRED);
            field.flags |= FieldFlags::IS_NEVER_WRITTEN;
        }
    });
    is_asked_name_written
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ir::Program;
    use crate::ir::generated::Field;
    use crate::link::testing::link_sources_without_bun_modules;

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
        let has_name = |layout: &&Layout| {
            layout
                .name
                .is_some_and(|id| program.strings.get(id) == name.as_bytes())
        };
        program.layouts.iter().find(has_name).expect(name)
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

    // The only names that the program stores are `name` and `level`.
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

    // An object made with the layout has no place for it, and whoever looks for the name finds nothing at once.
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
}
