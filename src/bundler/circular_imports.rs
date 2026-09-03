//! Circular dependency detection for `bun build --check` and `Bun.build({ check: true })`.
//!
//! The walk reads the graph that the scan phase produced, before
//! `find_reachable_files` runs. A check turns off the two scan-time rewrites
//! that remove an edge from that graph: barrel deferral
//! (`is_barrel_optimization_enabled`) and CommonJS redirects
//! (`unwrap_commonjs_to_esm`). So each cycle names the files and the import
//! statements that the user wrote.

use std::io::Write;

use bstr::BStr;
use bun_ast::{Data, ImportKind, ImportRecord, ImportRecordFlags, Log, Source, import_record};

use crate::bundle_v2::BundleV2;
use crate::mal_prelude::*;

#[derive(Copy, Clone, PartialEq, Eq)]
enum Visit {
    New,
    /// The file is on the current path, at this depth.
    Active(u32),
    Done,
}

struct Frame {
    source_index: u32,
    /// The next import record of this file to examine.
    next_record: u32,
    /// The import record that leads to the next frame on the path.
    record: u32,
}

/// The file that `record` runs when its importer runs. `import()` and
/// `import defer` do not run the target at that point, so a cycle through
/// them cannot read a binding before it is initialized. An unused record (a
/// TypeScript import that is only used as a type) does not exist at runtime.
fn followed_target(record: &ImportRecord, sources: &[Source]) -> Option<u32> {
    if !matches!(record.kind, ImportKind::Stmt | ImportKind::Require) {
        return None;
    }
    if record
        .flags
        .intersects(ImportRecordFlags::IS_UNUSED | ImportRecordFlags::PHASE_DEFER)
    {
        return None;
    }
    let target = record.source_index;
    if !target.is_valid() || target.is_runtime() {
        return None;
    }
    let source = sources.get(target.get() as usize)?;
    if source.path.is_node_module() {
        return None;
    }
    Some(target.get())
}

/// Walks the graph depth-first from each entry point and logs one error for
/// each import that leads back to a file on the current path. Each file is
/// expanded once, so the number of errors is at most the number of imports,
/// and the order follows the entry points and the import order in each file.
/// Returns the number of errors.
pub(crate) fn report_circular_imports(this: &BundleV2<'_>) -> usize {
    let sources = this.graph.input_files.items_source();
    let all_records = this.graph.ast.items_import_records();
    let log = this.transpiler.log_mut();

    let mut visits = vec![Visit::New; sources.len()];
    let mut path: Vec<Frame> = Vec::new();
    let mut cycles = 0;

    for entry_point in this.graph.entry_points.iter() {
        let entry = entry_point.get();
        let Some(source) = sources.get(entry as usize) else {
            continue;
        };
        if visits[entry as usize] != Visit::New || source.path.is_node_module() {
            continue;
        }
        visits[entry as usize] = Visit::Active(0);
        path.push(Frame {
            source_index: entry,
            next_record: 0,
            record: 0,
        });

        while let Some(last) = path.len().checked_sub(1) {
            let source_index = path[last].source_index;
            let records = records_of(all_records, source_index);
            let mut child = None;
            while let Some(record) = records.get(path[last].next_record as usize) {
                let record_index = path[last].next_record;
                path[last].next_record += 1;
                let Some(target) = followed_target(record, sources) else {
                    continue;
                };
                match visits[target as usize] {
                    Visit::New => {
                        path[last].record = record_index;
                        child = Some(target);
                        break;
                    }
                    Visit::Active(depth) => {
                        path[last].record = record_index;
                        log_cycle(log, sources, all_records, &path[depth as usize..]);
                        cycles += 1;
                    }
                    Visit::Done => {}
                }
            }

            match child {
                Some(target) => {
                    visits[target as usize] =
                        Visit::Active(u32::try_from(path.len()).expect("int cast"));
                    path.push(Frame {
                        source_index: target,
                        next_record: 0,
                        record: 0,
                    });
                }
                None => {
                    visits[source_index as usize] = Visit::Done;
                    path.pop();
                }
            }
        }
    }

    cycles
}

fn records_of<'r>(
    all_records: &'r [import_record::List<'_>],
    source_index: u32,
) -> &'r [ImportRecord] {
    all_records
        .get(source_index as usize)
        .map_or(&[], |records| records.as_slice())
}

/// `cycle[i].record` imports `cycle[i + 1]`, and the record of the last frame
/// imports `cycle[0]`. The error points at the first import. Each later import
/// is a note.
fn log_cycle(
    log: &mut Log,
    sources: &[Source],
    all_records: &[import_record::List<'_>],
    cycle: &[Frame],
) {
    let pretty = |frame: &Frame| BStr::new(sources[frame.source_index as usize].path.pretty);
    let range =
        |frame: &Frame| records_of(all_records, frame.source_index)[frame.record as usize].range;

    let mut chain: Vec<u8> = Vec::new();
    for frame in cycle {
        write!(chain, "{} -> ", pretty(frame)).expect("infallible: in-memory write");
    }
    write!(chain, "{}", pretty(&cycle[0])).expect("infallible: in-memory write");

    let notes: Box<[Data]> = cycle
        .iter()
        .enumerate()
        .skip(1)
        .map(|(i, frame)| {
            let imported = &cycle[(i + 1) % cycle.len()];
            bun_ast::range_data(
                Some(&sources[frame.source_index as usize]),
                range(frame),
                bun_ast::alloc_print(format_args!(
                    "{} imports {} here:",
                    pretty(frame),
                    pretty(imported)
                )),
            )
            .clone_line_text(log.clone_line_text)
        })
        .collect();

    log.add_range_error_fmt_with_notes(
        Some(&sources[cycle[0].source_index as usize]),
        range(&cycle[0]),
        notes,
        format_args!("Circular dependency: {}", BStr::new(&chain)),
    );
}
