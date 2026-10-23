use super::state::{Numbering, UnitIds};
use super::unit::LinkUnit;
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

    // `visit` gets a layout and its mark.
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
    input.property_keys.find(&PropertyKey {
        kind: PropertyKeyKind::Text,
        text: Some(text),
        ..PropertyKey::default()
    })
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

/// Says of a plain record that nothing in the program makes an object with it: it only describes objects.
pub(super) fn mark_unused_records(layouts: &mut [Layout], input: &UseInput<'_>) {
    let is_allocated = find_allocated_layouts(input);
    let is_written = find_written_keys(layouts, input);
    input.for_each_layout(layouts, &is_allocated, &|layout, is_allocated| {
        if !is_plain_record(layout) {
            return;
        }
        if !is_allocated {
            layout.flags |= LayoutFlags::IS_NEVER_ALLOCATED;
        }
        for field in &mut layout.fields {
            if field
                .key
                .is_some_and(|key| !is_written[key.index()].load(Ordering::Relaxed))
            {
                field.flags = field.flags.without(FieldFlags::IS_REQUIRED);
                field.flags |= FieldFlags::IS_NEVER_WRITTEN;
            }
        }
    });
}
