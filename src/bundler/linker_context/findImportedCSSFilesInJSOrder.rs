use crate::mal_prelude::*;
use bun_alloc::Arena;
use bun_ast::{ImportRecord, ImportRecordFlags};
use bun_collections::VecExt;

use crate::HTMLScanner::{InvalidLinkMedia, conditions_of_link_media, media_of_link};
use crate::bun_css::ImportConditions;
use crate::{Index, LinkerContext};
use bun_collections::DynamicBitSet as BitSet;

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
pub(crate) fn find_imported_css_files_in_js_order(
    this: &LinkerContext,
    _temp: &Arena,
    entry_point: Index,
) -> Vec<Index> {
    if !(this.parse_graph().input_files.items_loader().iter()).any(|loader| loader.is_css()) {
        return Vec::new();
    }
    let mut visited = BitSet::init_empty(this.graph.files.len()).expect("oom");
    let mut order: Vec<Index> = Vec::new();
    visit_in_js_order(this, entry_point, entry_point, &mut visited, &mut order);
    order
}

/// `find_imported_css_files_in_js_order` from `start`: adds to `order` the CSS files that are not `visited` yet.
fn visit_in_js_order(
    this: &LinkerContext,
    entry_point: Index,
    start: Index,
    visited: &mut BitSet,
    order: &mut Vec<Index>,
) {
    let all_import_records = this.graph.ast.items_import_records();
    let all_loaders = this.parse_graph().input_files.items_loader();
    let all_parts = this.graph.ast.items_parts();

    // Explicit-stack DFS (was per-edge recursive). `Enter` pushes
    // successors in discovery order then reverses the tail so `Leave`
    // fires in the same depth-first postorder the recursion produced.
    #[derive(Copy, Clone)]
    enum Frame {
        Enter(Index),
        Leave(Index),
    }
    let mut stack: Vec<Frame> = vec![Frame::Enter(start)];

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
        // Only CSS files contribute to `order`; skip the `Leave` for
        // everything else. The entry point was always visited with
        // `is_css = false` in the recursive form.
        if source_index != entry_point && all_loaders[source_index.get() as usize].is_css() {
            stack.push(Frame::Leave(source_index));
        }
        stack[mark..].reverse();
    }
}

/// `find_imported_css_files_in_js_order` for an HTML page, and the `media` conditions of each file that a link loads under them.
pub(crate) fn find_css_files_of_html_page<'a>(
    this: &LinkerContext<'a>,
    temp: &Arena,
    page: Index,
) -> (Vec<Index>, Vec<Option<&'a ImportConditions>>) {
    let records: &[ImportRecord] =
        this.graph.ast.items_import_records()[page.get() as usize].as_slice();
    let loaders = this.parse_graph().input_files.items_loader();
    let is_bundled_media_link = |record: &ImportRecord| {
        record.flags.contains(ImportRecordFlags::HTML_LINK_MEDIA)
            && record.source_index.is_valid()
            && loaders[record.source_index.get() as usize].is_css()
    };
    let media_of_links: Vec<Option<&'a ImportConditions>> =
        if records.iter().any(is_bundled_media_link) {
            (records.iter())
                .map(|record| {
                    (is_bundled_media_link(record))
                        .then(|| link_media_conditions(this, page, record))
                        .flatten()
                })
                .collect()
        } else {
            Vec::new()
        };
    // A link whose `media` gives no conditions loads its stylesheet as a link with no `media` does.
    if media_of_links.iter().all(Option::is_none) {
        return (
            find_imported_css_files_in_js_order(this, temp, page),
            Vec::new(),
        );
    }

    let mut files: Vec<Index> = Vec::new();
    let mut conditions: Vec<Option<&'a ImportConditions>> = Vec::new();
    let mut visited = BitSet::init_empty(this.graph.files.len()).expect("oom");
    visited.set(page.get() as usize);
    for (record, media) in records.iter().zip(&media_of_links) {
        if media.is_some() {
            // Not `visited`: a script or another link that loads the file applies it for every medium.
            files.push(record.source_index);
        } else {
            let preloads_a_media_link = record.flags.contains(ImportRecordFlags::HTML_LINK_PRELOAD)
                && (records.iter().zip(&media_of_links)).any(|(link, media)| {
                    media.is_some() && link.source_index == record.source_index
                });
            if record.source_index.is_valid() && !preloads_a_media_link {
                visit_in_js_order(this, page, record.source_index, &mut visited, &mut files);
            }
        }
        conditions.resize(files.len(), *media);
    }
    (files, conditions)
}

/// The conditions that the `media` of `link`, an `HTML_LINK_MEDIA` record of the HTML file `page`, puts on its stylesheet.
fn link_media_conditions<'a>(
    this: &LinkerContext<'a>,
    page: Index,
    link: &ImportRecord,
) -> Option<&'a ImportConditions> {
    let source = &this.parse_graph().input_files.items_source()[page.get() as usize];
    let tag = link.range.loc.start as usize..(link.range.loc.start + link.range.len) as usize;
    let media = media_of_link(source.contents.get(tag)?)?;
    let arena = this.graph.arena();
    match conditions_of_link_media(&media, arena) {
        Ok(conditions) => conditions.map(|conditions| &*arena.alloc(conditions)),
        Err(InvalidLinkMedia) => {
            this.log_disjoint().add_range_warning_fmt(
                Some(source),
                link.range,
                format_args!(
                    "Bun cannot parse the media query list \"{media}\" of this <link>. Its stylesheet applies for every medium."
                ),
            );
            None
        }
    }
}
