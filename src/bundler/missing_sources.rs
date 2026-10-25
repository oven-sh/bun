//! Dev server: fails the files that import a source whose file was not there to read.

use bun_ast::{ImportRecord, import_record};
use bun_collections::{ArrayHashMap, StringHashMap};

use crate::bun_fs as Fs;
use crate::bundle_v2::BundleV2;
use crate::bundle_v2::dispatch::DevServerHandle;
use crate::mal_prelude::*;
use crate::options::Target;
use crate::options_impl::TargetExt as _;
use crate::{Index, IndexInt};

pub(crate) struct MissingSource {
    index: IndexInt,
    /// The target of the parse task. The row of a failed task in `graph.ast` keeps the default target.
    target: Target,
}

/// The client graph and the server graphs each keep their own module of a file.
fn side(target: Target) -> u8 {
    if target == Target::Browser { 1 } else { 2 }
}

/// A later resolve of the path of `source_index` starts a new parse task.
#[cold]
#[inline(never)]
pub(crate) fn note(this: &mut BundleV2, source_index: IndexInt, target: Target) {
    let path = this.graph.input_files.items_source()[source_index as usize]
        .path
        .text;
    for map in this.graph.build_graphs.values_mut() {
        // A map can give another source of the path: the copy of another graph, or a later task.
        if map.get(path) == Some(source_index) {
            map.remove(path);
        }
    }
    this.missing_sources.push(MissingSource {
        index: source_index,
        target,
    });
}

/// The noted sources by index, and the sides that did not find each path.
struct Noted {
    by_index: ArrayHashMap<IndexInt, ()>,
    by_path: StringHashMap<u8>,
}

impl Noted {
    fn is_bound(&self, this: &BundleV2, importer_target: Target, record: &ImportRecord) -> bool {
        // A record that is not used was never resolved.
        if record.flags.contains(import_record::Flags::IS_UNUSED) {
            return false;
        }
        if record.source_index.is_valid() {
            return self.by_index.contains(&record.source_index.get());
        }
        let path = &record.path;
        // `resolve_import_records` gives a record that it binds to a module the id of that module in `pretty`.
        // An external import can hold the path of the file, and its `pretty` is still its `text`.
        if path.pretty == path.text {
            return false;
        }
        self.by_path
            .get(path.text)
            .is_some_and(|sides| sides & side(importer_target) != 0)
            // A module that has a source again is that source.
            && this.graph.source_of_module(importer_target, path).is_none()
    }
}

/// Runs when the scan of a dev server build is done and a source was noted.
#[cold]
#[inline(never)]
pub(crate) fn report(this: &mut BundleV2, dev: DevServerHandle) {
    let mut noted = Noted {
        by_index: ArrayHashMap::new(),
        by_path: StringHashMap::new(),
    };
    for missing in &this.missing_sources {
        let path = this.graph.input_files.items_source()[missing.index as usize]
            .path
            .text;
        bun_core::handle_oom(noted.by_index.put(missing.index, ()));
        *bun_core::handle_oom(noted.by_path.get_or_put(path)).value_ptr |= side(missing.target);
    }

    let mut bound: Vec<u32> = Vec::new();
    for importer in 1..this.graph.ast.len() {
        // A file that failed keeps an empty row.
        if this.graph.ast.items_parts()[importer].len() == 0 {
            continue;
        }
        let target = this.graph.ast.items_target()[importer];
        let records = this.graph.ast.items_import_records()[importer].as_slice();
        bound.clear();
        for (i, record) in records.iter().enumerate() {
            if noted.is_bound(this, target, record) {
                bound.push(i as u32);
            }
        }
        if !bound.is_empty() {
            report_importer(this, dev, importer, &bound);
        }
    }
}

fn report_importer(this: &mut BundleV2, dev: DevServerHandle, importer: usize, bound: &[u32]) {
    let target = this.graph.ast.items_target()[importer];
    let loader = this.graph.input_files.items_loader()[importer];
    // `source_of_module` reads the graph, so the records are out of it while this loop changes them.
    let heap = this.graph.heap;
    let mut records = core::mem::replace(
        &mut this.graph.ast.items_import_records_mut()[importer],
        bun_alloc::ArenaVec::new_in(heap),
    );
    let source = &this.graph.input_files.items_source()[importer];

    let mut failed = false;
    for &record_index in bound {
        let record = &mut records.as_mut_slice()[record_index as usize];
        let missing_file = if record.source_index.is_valid() {
            let path =
                this.graph.input_files.items_source()[record.source_index.get() as usize].path;
            // Another file resolved the path after the task failed, and the file was back.
            if let Some(newer) = this.graph.source_of_module(target, &path) {
                record.source_index = Index::init(newer);
                continue;
            }
            path.text
        } else {
            record.path.text
        };
        // As a record that did not resolve: `resolve_import_records` kept its specifier.
        record.path = Fs::Path::init(record.original_path);
        record.path.is_disabled = true;
        record.source_index = Index::INVALID;
        record.flags.insert(import_record::Flags::WAS_UNRESOLVED);
        // The specifier can resolve again while the file is missing: a plugin gave the path, or the
        // resolver still has the old directory listing. So the watch is for the file.
        bun_core::handle_oom(dev.track_resolution_failure(
            source.path.text,
            missing_file,
            target.bake_graph(),
            loader,
        ));
        if record
            .flags
            .contains(import_record::Flags::HANDLES_IMPORT_ERRORS)
        {
            continue;
        }
        failed = true;
        // SAFETY: the dev server owns the log of this file, and nothing else holds it during this call.
        let log =
            unsafe { &mut *dev.log_for_resolution_failures(source.path.text, target.bake_graph()) };
        log_missing_file(log, source, record, missing_file);
    }

    if failed {
        // As a file whose first resolve failed: the dev server leaves a file without parts out of the bundle.
        // SAFETY: truncating to len 0 never exposes uninitialized elements.
        unsafe { this.graph.ast.items_parts_mut()[importer].set_len(0) };
        if let Some(css) = this.graph.ast.items_css_mut()[importer].take() {
            // SAFETY: live arena pointer that only this row owns; dropped exactly once.
            unsafe { core::ptr::drop_in_place(css.as_ptr()) };
            this.graph.css_file_count -= 1;
        }
    }
    this.graph.ast.items_import_records_mut()[importer] = records;
}

/// The two texts of `resolve_import_records` for a specifier that does not resolve, and the file as a note.
fn log_missing_file(
    log: &mut bun_ast::Log,
    source: &bun_ast::Source,
    record: &ImportRecord,
    missing_file: &[u8],
) {
    let specifier = record.path.text;
    log.add_resolve_error_with_text_dupe(
        Some(source),
        record.range,
        format_args!(
            "Could not resolve: \"{}\"{}",
            bstr::BStr::new(specifier),
            if bun_resolver::is_package_path(specifier) {
                ". Maybe you need to \"bun install\"?"
            } else {
                ""
            },
        ),
        specifier,
        record.kind,
    );
    if let Some(msg) = log.msgs.last_mut() {
        msg.notes = Box::new([bun_ast::Data {
            text: bun_ast::alloc_print(format_args!(
                "File not found {}",
                bun_core::fmt::quote(missing_file)
            )),
            location: None,
        }]);
    }
}
