use crate::mal_prelude::*;
use bun_alloc::Arena;
use bun_ast::{ImportRecord, ImportRecordFlags, Part};
use bun_collections::VecExt;

use crate::options::Loader;
use crate::{Index, LinkerContext};
use bun_collections::DynamicBitSet as BitSet;

// Explicit-stack DFS (was per-edge recursive). `Enter` pushes
// successors in discovery order then reverses the tail so `Leave`
// fires in the same depth-first postorder the recursion produced.
#[derive(Copy, Clone)]
enum Frame {
    Enter(Index),
    Leave(Index),
}

/// JavaScript modules are traversed in depth-first postorder. This is the
/// order that JavaScript modules were evaluated in before the top-level await
/// feature was introduced.
///
/// ```text
///   A
///  / \
/// B   C
///  \ /
///   D
/// ```
///
/// If A imports B and then C, B imports D, and C imports D, then the JavaScript
/// traversal order is D B C A.
///
/// This function may deviate from ESM import order for dynamic imports (both
/// "require()" and "import()"). This is because the import order is impossible
/// to determine since the imports happen at run-time instead of compile-time.
/// In this case we just pick an arbitrary but consistent order.
///
/// A JavaScript module runs once, so a stylesheet that JavaScript imports is
/// listed once, where the walk first reaches it. An HTML file is different: a
/// browser applies every `<link rel="stylesheet">`, so the list has one entry
/// per applied link (see `push_html_records`) and can name a file more than
/// once. `find_imported_files_in_css_order` then keeps the rules of a file at
/// its last entry and its `@layer` names at its first.
pub(crate) fn find_imported_css_files_in_js_order(
    this: &LinkerContext,
    _temp: &Arena,
    entry_point: Index,
) -> Vec<Index> {
    let mut visited = BitSet::init_empty(this.graph.files.len()).expect("oom");
    let mut order: Vec<Index> = Vec::new();

    let all_import_records = this.graph.ast.items_import_records();
    let all_loaders = this.parse_graph().input_files.items_loader();
    let all_parts = this.graph.ast.items_parts();

    let mut stack: Vec<Frame> = vec![Frame::Enter(entry_point)];

    while let Some(frame) = stack.pop() {
        let source_index = match frame {
            Frame::Leave(source_index) => {
                order.push(source_index);
                continue;
            }
            Frame::Enter(source_index) => source_index,
        };

        if visited.is_set(source_index.get() as usize) {
            continue;
        }
        visited.set(source_index.get() as usize);

        let records: &[ImportRecord] = all_import_records[source_index.get() as usize].as_slice();
        let p = &all_parts[source_index.get() as usize];

        let mark = stack.len();
        // Iterate over each part in the file in order
        for part in p.as_slice() {
            // Traverse any files imported by this part. Note that CommonJS calls
            // to "require()" count as imports too, sort of as if the part has an
            // ESM "import" statement in it. This may seem weird because ESM imports
            // are a compile-time concept while CommonJS imports are a run-time
            // concept. But we don't want to manipulate <style> tags at run-time so
            // this is the only way to do it.
            for &import_record_index in part.import_record_indices.slice() {
                let record = &records[import_record_index as usize];
                if record.source_index.is_valid()
                    && !visited.is_set(record.source_index.get() as usize)
                {
                    stack.push(Frame::Enter(record.source_index));
                }
            }
        }
        let loader = all_loaders[source_index.get() as usize];
        if loader == Loader::Html {
            // An HTML file is rare, so the loop above does not test for one.
            // Replace the frames it pushed.
            stack.truncate(mark);
            push_html_records(this, source_index, entry_point, &mut stack, &mut visited);
            continue;
        }
        // Only CSS files contribute to `order`; skip the `Leave` for
        // everything else. The entry point was always visited with
        // `is_css = false` in the recursive form.
        if loader.is_css() && source_index != entry_point {
            stack.push(Frame::Leave(source_index));
        }
        stack[mark..].reverse();
    }

    order
}

/// Pushes the frames for the records of an HTML file, in document order.
///
/// A record with `HTML_STYLESHEET` is a `<link rel="stylesheet">` that the
/// document applies. It is an entry of the list at the position of its link,
/// even when an earlier link, a preload or a script already reached the same
/// file. Marking the file visited here, before any frame of this file is
/// popped, keeps the other records of the page from listing it a second time.
#[cold]
#[inline(never)]
fn push_html_records(
    this: &LinkerContext,
    html: Index,
    entry_point: Index,
    stack: &mut Vec<Frame>,
    visited: &mut BitSet,
) {
    let records: &[ImportRecord] =
        this.graph.ast.items_import_records()[html.get() as usize].as_slice();
    let parts: &[Part] = this.graph.ast.items_parts()[html.get() as usize].as_slice();
    let all_loaders = this.parse_graph().input_files.items_loader();

    let mark = stack.len();
    for part in parts {
        for &import_record_index in part.import_record_indices.slice() {
            let record = &records[import_record_index as usize];
            if !record.source_index.is_valid() {
                continue;
            }
            let target = record.source_index.get() as usize;
            if record.flags.contains(ImportRecordFlags::HTML_STYLESHEET)
                && all_loaders[target].is_css()
            {
                // A CSS entry point never runs this walk.
                debug_assert!(record.source_index != entry_point);
                visited.set(target);
                stack.push(Frame::Leave(record.source_index));
            } else if !visited.is_set(target) {
                stack.push(Frame::Enter(record.source_index));
            }
        }
    }
    stack[mark..].reverse();
}
