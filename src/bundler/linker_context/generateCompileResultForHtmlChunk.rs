use crate::mal_prelude::*;
use core::ffi::c_void;
use core::mem::offset_of;
use std::io::Write as _;

use bstr::BStr;

use bun_collections::VecExt;
use bun_collections::BoundedArray;
use bun_logger::Log;
use bun_lolhtml_sys::lol_html as lol;
use bun_options_types::{ImportKind, ImportRecord, ImportRecordFlags};
use bun_string::strings;
use bun_threading::thread_pool::Task as ThreadPoolLibTask;

use crate::linker_context_mod::{GenerateChunkCtx, LinkerContext, LinkerCtx, PendingPartRange};
use crate::options::Loader;
use crate::thread_pool::Worker;
use crate::HTMLScanner::{HTMLProcessor, HTMLProcessorHandler};
use crate::{BundleV2, Chunk, CompileResult, IndexInt};

// `debug` = LinkerContext.debug (Output.scoped(.LinkerCtx, .visible)).
macro_rules! debug {
    ($fmt:literal $(, $arg:expr)* $(,)?) => {
        bun_core::scoped_log!(LinkerCtx, $fmt $(, $arg)*)
    };
}

/// Rrewrite the HTML with the following transforms:
/// 1. Remove all <script> and <link> tags which were not marked as
///    external. This is defined by the source_index on the ImportRecord,
///    when it's not Index.invalid then we update it accordingly. This will
///    need to be a reference to the chunk or asset.
/// 2. For all other non-external URLs, update the "src" or "href"
///    attribute to point to the asset's unique key. Later, when joining
///    chunks, we will rewrite these to their final URL or pathname,
///    including the public_path.
/// 3. If a JavaScript chunk exists, add a <script type="module" crossorigin> tag that contains
///    the JavaScript for the entry point which uses the "src" attribute
///    to point to the JavaScript chunk's unique key.
/// 4. If a CSS chunk exists, add a <link rel="stylesheet" href="..." crossorigin> tag that contains
///    the CSS for the entry point which uses the "href" attribute to point to the
///    CSS chunk's unique key.
/// 5. For each imported module or chunk within the JavaScript code, add
///    a <link rel="modulepreload" href="..." crossorigin> tag that
///    points to the module or chunk's unique key so that we tell the
///    browser to preload the user's code.
// CONCURRENCY: thread-pool callback — runs on worker threads, one task per
// HTML `PendingPartRange` (exactly one per HTML chunk). Writes:
// `chunk.compile_results_for_chunk[0]` (per-chunk disjoint). Reads
// `c.parse_graph.input_files` / `c.graph` / `ctx.chunks` shared. Never forms
// `&mut LinkerContext` — `c_ptr` stays raw; the HTML rewriter takes
// `&LinkerContext`. See `generate_compile_result_for_js_chunk` for the
// `PendingPartRange: Send` justification.
pub fn generate_compile_result_for_html_chunk(task: *mut ThreadPoolLibTask) {
    // SAFETY: `task` is the `task` field of a `PendingPartRange` scheduled by
    // `generate_chunks_in_parallel`; recover the parent via offset_of. We keep
    // `part_range` as a raw pointer (never `&PendingPartRange`) so that reading
    // the `ctx` field — and the `&mut` pointers stored inside it — does not go
    // through a shared reborrow that would strip write provenance.
    let part_range: *const PendingPartRange = unsafe {
        task.cast::<u8>()
            .sub(offset_of!(PendingPartRange, task))
            .cast::<PendingPartRange>()
    };
    let i = unsafe { (*part_range).i } as usize;
    // SAFETY: read the stored ctx reference's bits as a raw pointer. `&T` and
    // `*const T` share layout; this avoids ever materializing `&GenerateChunkCtx`
    // (which would shared-reborrow its `&mut` fields under Stacked Borrows).
    let ctx: *const GenerateChunkCtx = unsafe {
        *core::ptr::addr_of!((*part_range).ctx).cast::<*const GenerateChunkCtx>()
    };
    // SAFETY: `GenerateChunkCtx.c` is the embedded `LinkerContext` inside
    // `BundleV2`. The link step never mutates `LinkerContext` from this task,
    // so a `*const` (and the derived `&BundleV2` for `Worker::get`) suffices —
    // no const→mut cast needed.
    let c: *const LinkerContext = unsafe {
        *core::ptr::addr_of!((*ctx).c).cast::<*const LinkerContext>()
    };
    let bv2: &BundleV2 = unsafe {
        &*c.cast::<u8>()
            .sub(offset_of!(BundleV2, linker))
            .cast::<BundleV2>()
    };
    let worker = Worker::get(bv2);
    let _unget = scopeguard::guard(&mut *worker, |w| w.unget());

    // SAFETY: `GenerateChunkCtx.{chunk,chunks}` were constructed from `&mut`
    // borrows in `generate_chunks_in_parallel`. We read their pointer bits
    // directly (`&mut T` and `*mut T` share layout) so the mutable provenance
    // they were created with is preserved — never round-tripping through
    // `*const`. Zig's `*T` aliases freely; this is the raw-pointer equivalent.
    let chunk: *mut Chunk = unsafe {
        *core::ptr::addr_of!((*ctx).chunk).cast::<*mut Chunk>()
    };
    let chunks: *mut [Chunk] = unsafe {
        *core::ptr::addr_of!((*ctx).chunks).cast::<*mut [Chunk]>()
    };
    // SAFETY: `chunk` is this task's exclusively-owned HTML chunk for the
    // duration of the compile step; the result slot was pre-allocated.
    let result = unsafe { generate_compile_result_for_html_chunk_impl(&*c, chunk, chunks) };
    unsafe {
        (*chunk).compile_results_for_chunk[i] = result;
    }
}

#[derive(Default)]
struct EndTagIndices {
    head: Option<u32>,
    body: Option<u32>,
    html: Option<u32>,
}

struct HTMLLoader<'a> {
    linker: &'a LinkerContext<'a>,
    #[allow(dead_code)]
    source_index: IndexInt,
    import_records: &'a [ImportRecord],
    #[allow(dead_code)]
    log: *mut Log,
    current_import_record_index: u32,
    chunk: *const Chunk,
    chunks: *mut [Chunk],
    #[allow(dead_code)]
    minify_whitespace: bool,
    compile_to_standalone_html: bool,
    output: Vec<u8>,
    end_tag_indices: EndTagIndices,
    added_head_tags: bool,
    added_body_script: bool,
}

impl<'a> HTMLProcessorHandler for HTMLLoader<'a> {
    fn on_write_html(&mut self, bytes: &[u8]) {
        self.output.extend_from_slice(bytes);
    }

    fn on_html_parse_error(&mut self, err: &[u8]) {
        bun_core::Output::panic(format_args!(
            "Parsing HTML during replacement phase errored, which should never happen since the first pass succeeded: {}",
            BStr::new(err)
        ));
    }

    fn on_tag(
        &mut self,
        element: &mut lol::Element,
        _path: &[u8],
        url_attribute: &[u8],
        _kind: ImportKind,
    ) {
        if self.current_import_record_index as usize >= self.import_records.len() {
            bun_core::Output::panic(format_args!(
                "Assertion failure in HTMLLoader.onTag: current_import_record_index ({}) >= import_records.len ({})",
                self.current_import_record_index,
                self.import_records.len()
            ));
        }

        let import_record: &ImportRecord =
            &self.import_records[self.current_import_record_index as usize];
        self.current_import_record_index += 1;

        let parse_graph = self.linker.parse_graph();
        let unique_key_for_additional_files: &[u8] = if import_record.source_index.is_valid() {
            &parse_graph.input_files.items_unique_key_for_additional_file()
                [import_record.source_index.get() as usize]
        } else {
            b""
        };
        let loader: Loader = if import_record.source_index.is_valid() {
            parse_graph.input_files.items_loader()[import_record.source_index.get() as usize]
        } else {
            Loader::File
        };

        if import_record
            .flags
            .contains(ImportRecordFlags::IS_EXTERNAL_WITHOUT_SIDE_EFFECTS)
        {
            debug!("Leaving external import: {}", BStr::new(import_record.path.text));
            return;
        }

        let element: *mut lol::Element = element;

        if self.linker.dev_server.is_some() {
            if !unique_key_for_additional_files.is_empty() {
                // SAFETY: element is a valid *mut Element passed from lol-html callback.
                unsafe {
                    lol::Element::set_attribute(element, url_attribute, unique_key_for_additional_files)
                }
                .unwrap_or_else(|_| panic!("unexpected error from Element.setAttribute"));
            } else if import_record.path.is_disabled || loader.is_javascript_like() || loader.is_css() {
                // SAFETY: element is a valid *mut Element passed from lol-html callback.
                unsafe { lol::Element::remove(element) };
            } else {
                // SAFETY: element is a valid *mut Element passed from lol-html callback.
                unsafe {
                    lol::Element::set_attribute(element, url_attribute, import_record.path.pretty)
                }
                .unwrap_or_else(|_| panic!("unexpected error from Element.setAttribute"));
            }
            return;
        }

        if import_record.source_index.is_invalid() {
            debug!(
                "Leaving import with invalid source index: {}",
                BStr::new(import_record.path.text)
            );
            return;
        }

        if loader.is_javascript_like() || loader.is_css() {
            // Remove the original non-external tags
            // SAFETY: element is a valid *mut Element passed from lol-html callback.
            unsafe { lol::Element::remove(element) };
            return;
        }

        if self.compile_to_standalone_html && import_record.source_index.is_valid() {
            // In standalone HTML mode, inline assets as data: URIs
            let url_for_css =
                parse_graph.ast.items_url_for_css()[import_record.source_index.get() as usize];
            if !url_for_css.is_empty() {
                // SAFETY: element is a valid *mut Element passed from lol-html callback.
                unsafe { lol::Element::set_attribute(element, url_attribute, url_for_css) }
                    .unwrap_or_else(|_| panic!("unexpected error from Element.setAttribute"));
                return;
            }
        }

        if !unique_key_for_additional_files.is_empty() {
            // Replace the external href/src with the unique key so that we later will rewrite it to the final URL or pathname
            // SAFETY: element is a valid *mut Element passed from lol-html callback.
            unsafe {
                lol::Element::set_attribute(element, url_attribute, unique_key_for_additional_files)
            }
            .unwrap_or_else(|_| panic!("unexpected error from Element.setAttribute"));
            return;
        }
    }

    fn on_head_tag(&mut self, element: &mut lol::Element) -> bool {
        // SAFETY: element is a valid *mut Element passed from lol-html callback.
        unsafe {
            lol::Element::on_end_tag(
                element,
                Self::end_head_tag_handler,
                std::ptr::from_mut::<Self>(self).cast::<c_void>(),
            )
        }
        .is_err()
    }

    fn on_html_tag(&mut self, element: &mut lol::Element) -> bool {
        // SAFETY: element is a valid *mut Element passed from lol-html callback.
        unsafe {
            lol::Element::on_end_tag(
                element,
                Self::end_html_tag_handler,
                std::ptr::from_mut::<Self>(self).cast::<c_void>(),
            )
        }
        .is_err()
    }

    fn on_body_tag(&mut self, element: &mut lol::Element) -> bool {
        // SAFETY: element is a valid *mut Element passed from lol-html callback.
        unsafe {
            lol::Element::on_end_tag(
                element,
                Self::end_body_tag_handler,
                std::ptr::from_mut::<Self>(self).cast::<c_void>(),
            )
        }
        .is_err()
    }
}

impl<'a> HTMLLoader<'a> {
    /// This is called for head, body, and html; whichever ends up coming first.
    fn add_head_tags(&mut self, end_tag: *mut lol::EndTag) -> Result<(), lol::Error> {
        if self.added_head_tags {
            return Ok(());
        }
        self.added_head_tags = true;

        // PERF(port): was stack-fallback (std.heap.stackFallback(256))
        let slices = self.get_head_tags();
        for slice in slices.as_slice() {
            // SAFETY: end_tag is a valid *mut EndTag passed from lol-html callback.
            unsafe { lol::EndTag::before(end_tag, slice, true) }?;
        }
        Ok(())
    }

    /// Insert inline script before </body> so DOM elements are available.
    fn add_body_tags(&mut self, end_tag: *mut lol::EndTag) -> Result<(), lol::Error> {
        if self.added_body_script {
            return Ok(());
        }
        self.added_body_script = true;

        // PERF(port): was stack-fallback (std.heap.stackFallback(256))
        // SAFETY: chunk/chunks raw pointers valid for the duration of the link step.
        if let Some(js_chunk) = unsafe { (*self.chunk).get_js_chunk_for_html(&mut *self.chunks) } {
            let mut script = Vec::new();
            write!(
                &mut script,
                "<script type=\"module\">{}</script>",
                BStr::new(js_chunk.unique_key)
            )
            .unwrap();
            // SAFETY: end_tag is a valid *mut EndTag passed from lol-html callback.
            unsafe { lol::EndTag::before(end_tag, &script, true) }?;
        }
        Ok(())
    }

    fn get_head_tags(&self) -> BoundedArray<Vec<u8>, 2> {
        // PERF(port): was stack-fallback arena; now heap Vec<u8>
        let mut array: BoundedArray<Vec<u8>, 2> = BoundedArray::default();
        // SAFETY: chunk/chunks raw pointers valid for the duration of the link step.
        let chunk = unsafe { &*self.chunk };
        let chunks = unsafe { &mut *self.chunks };
        if self.compile_to_standalone_html {
            // In standalone HTML mode, only put CSS in <head>; JS goes before </body>
            if let Some(css_chunk) = chunk.get_css_chunk_for_html(chunks) {
                let mut style_tag = Vec::new();
                write!(
                    &mut style_tag,
                    "<style>{}</style>",
                    BStr::new(css_chunk.unique_key)
                )
                .unwrap();
                // PERF(port): was assume_capacity
                let _ = array.push(style_tag);
            }
        } else {
            // Put CSS before JS to reduce chances of flash of unstyled content
            if let Some(css_chunk) = chunk.get_css_chunk_for_html(chunks) {
                let mut link_tag = Vec::new();
                write!(
                    &mut link_tag,
                    "<link rel=\"stylesheet\" crossorigin href=\"{}\">",
                    BStr::new(css_chunk.unique_key)
                )
                .unwrap();
                // PERF(port): was assume_capacity
                let _ = array.push(link_tag);
            }
            if let Some(js_chunk) = chunk.get_js_chunk_for_html(chunks) {
                // type="module" scripts do not block rendering, so it is okay to put them in head
                let mut script = Vec::new();
                write!(
                    &mut script,
                    "<script type=\"module\" crossorigin src=\"{}\"></script>",
                    BStr::new(js_chunk.unique_key)
                )
                .unwrap();
                // PERF(port): was assume_capacity
                let _ = array.push(script);
            }
        }
        array
    }

    unsafe extern "C" fn end_head_tag_handler(
        end: *mut lol::EndTag,
        opaque_this: *mut c_void,
    ) -> lol::Directive {
        // SAFETY: opaque_this was set to &mut HTMLLoader in on_head_tag; end is non-null from lol-html callback.
        let this: &mut Self = unsafe { &mut *opaque_this.cast::<Self>() };
        if this.linker.dev_server.is_none() {
            if this.add_head_tags(end).is_err() {
                return lol::Directive::Stop;
            }
        } else {
            this.end_tag_indices.head = Some(u32::try_from(this.output.len()).expect("int cast"));
        }
        lol::Directive::Continue
    }

    unsafe extern "C" fn end_body_tag_handler(
        end: *mut lol::EndTag,
        opaque_this: *mut c_void,
    ) -> lol::Directive {
        // SAFETY: opaque_this was set to &mut HTMLLoader in on_body_tag; end is non-null from lol-html callback.
        let this: &mut Self = unsafe { &mut *opaque_this.cast::<Self>() };
        if this.linker.dev_server.is_none() {
            if this.compile_to_standalone_html {
                // In standalone mode, insert JS before </body> so DOM is available
                if this.add_body_tags(end).is_err() {
                    return lol::Directive::Stop;
                }
            } else {
                if this.add_head_tags(end).is_err() {
                    return lol::Directive::Stop;
                }
            }
        } else {
            this.end_tag_indices.body = Some(u32::try_from(this.output.len()).expect("int cast"));
        }
        lol::Directive::Continue
    }

    unsafe extern "C" fn end_html_tag_handler(
        end: *mut lol::EndTag,
        opaque_this: *mut c_void,
    ) -> lol::Directive {
        // SAFETY: opaque_this was set to &mut HTMLLoader in on_html_tag; end is non-null from lol-html callback.
        let this: &mut Self = unsafe { &mut *opaque_this.cast::<Self>() };
        if this.linker.dev_server.is_none() {
            if this.compile_to_standalone_html {
                // Fallback: if no </body> was found, insert both CSS and JS before </html>
                if this.add_head_tags(end).is_err() {
                    return lol::Directive::Stop;
                }
                if this.add_body_tags(end).is_err() {
                    return lol::Directive::Stop;
                }
            } else {
                if this.add_head_tags(end).is_err() {
                    return lol::Directive::Stop;
                }
            }
        } else {
            this.end_tag_indices.html = Some(u32::try_from(this.output.len()).expect("int cast"));
        }
        lol::Directive::Continue
    }
}

/// SAFETY: `chunk` must point to a live `Chunk` that is an element of `*chunks`,
/// and both must remain valid for the duration of this call. `chunk` is only
/// read here; the caller retains the sole writer.
unsafe fn generate_compile_result_for_html_chunk_impl<'a>(
    c: &'a LinkerContext<'a>,
    chunk: *const Chunk,
    chunks: *mut [Chunk],
) -> CompileResult {
    let parse_graph = c.parse_graph();
    let sources = parse_graph.input_files.items_source();
    let import_records = c.graph.ast.items_import_records();
    // SAFETY: caller guarantees `chunk` is live; we only read `entry_point`.
    let source_index = unsafe { (*chunk).entry_point.source_index() };

    // HTML bundles for dev server must be allocated to it, as it must outlive
    // the bundle task. See `DevServer.RouteBundle.HTML.bundled_html_text`
    // TODO(port): Zig used `dev.arena()` vs `worker.arena` to control output ownership.
    // In Rust with global mimalloc this distinction collapses; verify DevServer ownership in Phase B.

    // SAFETY: `c.log` is `&mut Log` behind `&LinkerContext`; read its pointer
    // bits directly (`&mut T` and `*mut T` share layout) so we don't reborrow
    // through `&` and lose mutability. The HTMLLoader.log field is currently
    // dead_code, so no write actually occurs through this pointer today.
    let log: *mut Log = unsafe { *core::ptr::addr_of!(c.log).cast::<*mut Log>() };
    let minify_whitespace = c.options.minify_whitespace;
    let compile_to_standalone_html = c.options.compile_to_standalone_html;
    let has_dev_server = c.dev_server.is_some();
    let contents: &[u8] = &sources[source_index as usize].contents;
    let records = import_records[source_index as usize].slice();

    let mut html_loader = HTMLLoader {
        linker: c,
        source_index,
        import_records: records,
        log,
        current_import_record_index: 0,
        minify_whitespace,
        compile_to_standalone_html,
        chunk,
        chunks,
        output: Vec::new(),
        end_tag_indices: EndTagIndices {
            html: None,
            body: None,
            head: None,
        },
        added_head_tags: false,
        added_body_script: false,
    };

    HTMLProcessor::<HTMLLoader, true>::run(&mut html_loader, contents)
        .unwrap_or_else(|_| panic!("unexpected error from HTMLProcessor.run"));

    // There are some cases where invalid HTML will make it so </head> is
    // never emitted, even if the literal text DOES appear. These cases are
    // along the lines of having a self-closing tag for a non-self closing
    // element. In this case, head_end_tag_index will be 0, and a simple
    // search through the page is done to find the "</head>"
    // See https://github.com/oven-sh/bun/issues/17554
    let script_injection_offset: u32 = if has_dev_server {
        'brk: {
            if let Some(head) = html_loader.end_tag_indices.head {
                break 'brk head;
            }
            if let Some(head) = strings::index_of(&html_loader.output, b"</head>") {
                break 'brk u32::try_from(head).expect("int cast");
            }
            if let Some(body) = html_loader.end_tag_indices.body {
                break 'brk body;
            }
            if let Some(html) = html_loader.end_tag_indices.html {
                break 'brk html;
            }
            u32::try_from(html_loader.output.len()).expect("int cast") // inject at end of file.
        }
    } else {
        'brk: {
            if !html_loader.added_head_tags || !html_loader.added_body_script {
                // PERF(port): @branchHint(.cold) — this is if the document is missing all head, body, and html elements.
                // PERF(port): was stack-fallback (std.heap.stackFallback(256))
                if !html_loader.added_head_tags {
                    let slices = html_loader.get_head_tags();
                    for slice in slices.as_slice() {
                        html_loader.output.extend_from_slice(slice);
                    }
                    html_loader.added_head_tags = true;
                }
                if !html_loader.added_body_script {
                    if html_loader.compile_to_standalone_html {
                        // SAFETY: chunk/chunks raw pointers valid for the duration of the link step.
                        if let Some(js_chunk) = unsafe {
                            (*html_loader.chunk).get_js_chunk_for_html(&mut *html_loader.chunks)
                        } {
                            let mut script = Vec::new();
                            write!(
                                &mut script,
                                "<script type=\"module\">{}</script>",
                                BStr::new(js_chunk.unique_key)
                            )
                            .unwrap();
                            html_loader.output.extend_from_slice(&script);
                        }
                    }
                    html_loader.added_body_script = true;
                }
            }
            // value is ignored. fail loud if hit in debug
            // TODO(port): Zig returned `undefined` in debug to fail loud; Rust has no direct equivalent.
            break 'brk if cfg!(debug_assertions) { 0 } else { 0 };
        }
    };

    CompileResult::Html {
        // TODO(port): Zig returned `output.items` (slice into the ArrayList). Here we hand over the Vec.
        code: html_loader.output.into_boxed_slice(),
        source_index,
        script_injection_offset,
    }
}

pub use crate::{DeferredBatchTask, ParseTask, ThreadPool};

// ported from: src/bundler/linker_context/generateCompileResultForHtmlChunk.zig
