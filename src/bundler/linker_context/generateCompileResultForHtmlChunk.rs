use core::ffi::c_void;
use core::mem::offset_of;
use std::io::Write as _;

use bstr::BStr;

use bun_bundler::linker_context::{LinkerContext, PendingPartRange};
use bun_bundler::{Chunk, CompileResult, HTMLScanner, Index};
use bun_bundler::{DeferredBatchTask as _DeferredBatchTask, ParseTask as _ParseTask};
use bun_bundler::options::Loader;
use bun_bundler::thread_pool as bundler_thread_pool;
use bun_collections::BoundedArray;
use bun_logger::Log;
use bun_lolhtml as lol;
use bun_options_types::{ImportKind, ImportRecord};
use bun_str::strings;
use bun_threading::ThreadPool as ThreadPoolLib;

// TODO(port): `debug` = LinkerContext.debug (Output.scoped). Re-export the scope macro from linker_context.
macro_rules! debug {
    ($fmt:literal $(, $arg:expr)* $(,)?) => {
        bun_output::scoped_log!(LinkerContext, $fmt $(, $arg)*)
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
pub fn generate_compile_result_for_html_chunk(task: *mut ThreadPoolLib::Task) {
    // SAFETY: task points to PendingPartRange.task
    let part_range: &PendingPartRange = unsafe {
        &*((task as *mut u8)
            .sub(offset_of!(PendingPartRange, task))
            .cast::<PendingPartRange>())
    };
    let ctx = part_range.ctx;
    // SAFETY: ctx.c points to BundleV2.linker
    let bv2 = unsafe {
        &mut *((ctx.c as *mut LinkerContext as *mut u8)
            .sub(offset_of!(bun_bundler::BundleV2, linker))
            .cast::<bun_bundler::BundleV2>())
    };
    let worker = bundler_thread_pool::Worker::get(bv2);
    // TODO(port): worker.unget() on scope exit — assume Worker::get returns RAII guard; if not, add scopeguard.

    ctx.chunk.compile_results_for_chunk[part_range.i] =
        generate_compile_result_for_html_chunk_impl(&worker, ctx.c, ctx.chunk, ctx.chunks);
}

#[derive(Default)]
struct EndTagIndices {
    head: Option<u32>,
    body: Option<u32>,
    html: Option<u32>,
}

struct HTMLLoader<'a> {
    linker: &'a LinkerContext,
    source_index: Index::Int,
    import_records: &'a [ImportRecord],
    log: &'a mut Log,
    current_import_record_index: u32,
    chunk: &'a Chunk,
    chunks: &'a [Chunk],
    minify_whitespace: bool,
    compile_to_standalone_html: bool,
    output: Vec<u8>,
    end_tag_indices: EndTagIndices,
    added_head_tags: bool,
    added_body_script: bool,
}

impl<'a> HTMLLoader<'a> {
    pub fn on_write_html(&mut self, bytes: &[u8]) {
        self.output.extend_from_slice(bytes);
    }

    pub fn on_html_parse_error(&mut self, err: &[u8]) {
        bun_core::Output::panic(format_args!(
            "Parsing HTML during replacement phase errored, which should never happen since the first pass succeeded: {}",
            BStr::new(err)
        ));
    }

    pub fn on_tag(
        &mut self,
        element: &mut lol::Element,
        _name: &[u8],
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
        let unique_key_for_additional_files: &[u8] = if import_record.source_index.is_valid() {
            &self
                .linker
                .parse_graph
                .input_files
                .items_unique_key_for_additional_file()[import_record.source_index.get()]
        } else {
            b""
        };
        let loader: Loader = if import_record.source_index.is_valid() {
            self.linker.parse_graph.input_files.items_loader()[import_record.source_index.get()]
        } else {
            Loader::File
        };

        if import_record.flags.is_external_without_side_effects() {
            debug!("Leaving external import: {}", BStr::new(&import_record.path.text));
            return;
        }

        if self.linker.dev_server.is_some() {
            if !unique_key_for_additional_files.is_empty() {
                element
                    .set_attribute(url_attribute, unique_key_for_additional_files)
                    .unwrap_or_else(|_| panic!("unexpected error from Element.setAttribute"));
            } else if import_record.path.is_disabled || loader.is_javascript_like() || loader.is_css() {
                element.remove();
            } else {
                element
                    .set_attribute(url_attribute, &import_record.path.pretty)
                    .unwrap_or_else(|_| panic!("unexpected error from Element.setAttribute"));
            }
            return;
        }

        if import_record.source_index.is_invalid() {
            debug!(
                "Leaving import with invalid source index: {}",
                BStr::new(&import_record.path.text)
            );
            return;
        }

        if loader.is_javascript_like() || loader.is_css() {
            // Remove the original non-external tags
            element.remove();
            return;
        }

        if self.compile_to_standalone_html && import_record.source_index.is_valid() {
            // In standalone HTML mode, inline assets as data: URIs
            let url_for_css =
                &self.linker.parse_graph.ast.items_url_for_css()[import_record.source_index.get()];
            if !url_for_css.is_empty() {
                element
                    .set_attribute(url_attribute, url_for_css)
                    .unwrap_or_else(|_| panic!("unexpected error from Element.setAttribute"));
                return;
            }
        }

        if !unique_key_for_additional_files.is_empty() {
            // Replace the external href/src with the unique key so that we later will rewrite it to the final URL or pathname
            element
                .set_attribute(url_attribute, unique_key_for_additional_files)
                .unwrap_or_else(|_| panic!("unexpected error from Element.setAttribute"));
            return;
        }
    }

    pub fn on_head_tag(&mut self, element: &mut lol::Element) -> bool {
        if element
            .on_end_tag(Self::end_head_tag_handler, self as *mut Self as *mut c_void)
            .is_err()
        {
            return true;
        }
        false
    }

    pub fn on_html_tag(&mut self, element: &mut lol::Element) -> bool {
        if element
            .on_end_tag(Self::end_html_tag_handler, self as *mut Self as *mut c_void)
            .is_err()
        {
            return true;
        }
        false
    }

    pub fn on_body_tag(&mut self, element: &mut lol::Element) -> bool {
        if element
            .on_end_tag(Self::end_body_tag_handler, self as *mut Self as *mut c_void)
            .is_err()
        {
            return true;
        }
        false
    }

    /// This is called for head, body, and html; whichever ends up coming first.
    fn add_head_tags(&mut self, end_tag: &mut lol::EndTag) -> Result<(), bun_core::Error> {
        if self.added_head_tags {
            return Ok(());
        }
        self.added_head_tags = true;

        // PERF(port): was stack-fallback (std.heap.stackFallback(256))
        let slices = self.get_head_tags();
        for slice in slices.as_slice() {
            end_tag.before(slice, true)?;
        }
        Ok(())
    }

    /// Insert inline script before </body> so DOM elements are available.
    fn add_body_tags(&mut self, end_tag: &mut lol::EndTag) -> Result<(), bun_core::Error> {
        if self.added_body_script {
            return Ok(());
        }
        self.added_body_script = true;

        // PERF(port): was stack-fallback (std.heap.stackFallback(256))
        if let Some(js_chunk) = self.chunk.get_js_chunk_for_html(self.chunks) {
            let mut script = Vec::new();
            write!(
                &mut script,
                "<script type=\"module\">{}</script>",
                BStr::new(&js_chunk.unique_key)
            )
            .unwrap();
            end_tag.before(&script, true)?;
        }
        Ok(())
    }

    fn get_head_tags(&self) -> BoundedArray<Vec<u8>, 2> {
        // PERF(port): was stack-fallback allocator; now heap Vec<u8>
        let mut array: BoundedArray<Vec<u8>, 2> = BoundedArray::default();
        if self.compile_to_standalone_html {
            // In standalone HTML mode, only put CSS in <head>; JS goes before </body>
            if let Some(css_chunk) = self.chunk.get_css_chunk_for_html(self.chunks) {
                let mut style_tag = Vec::new();
                write!(
                    &mut style_tag,
                    "<style>{}</style>",
                    BStr::new(&css_chunk.unique_key)
                )
                .unwrap();
                // PERF(port): was assume_capacity
                array.push(style_tag);
            }
        } else {
            // Put CSS before JS to reduce chances of flash of unstyled content
            if let Some(css_chunk) = self.chunk.get_css_chunk_for_html(self.chunks) {
                let mut link_tag = Vec::new();
                write!(
                    &mut link_tag,
                    "<link rel=\"stylesheet\" crossorigin href=\"{}\">",
                    BStr::new(&css_chunk.unique_key)
                )
                .unwrap();
                // PERF(port): was assume_capacity
                array.push(link_tag);
            }
            if let Some(js_chunk) = self.chunk.get_js_chunk_for_html(self.chunks) {
                // type="module" scripts do not block rendering, so it is okay to put them in head
                let mut script = Vec::new();
                write!(
                    &mut script,
                    "<script type=\"module\" crossorigin src=\"{}\"></script>",
                    BStr::new(&js_chunk.unique_key)
                )
                .unwrap();
                // PERF(port): was assume_capacity
                array.push(script);
            }
        }
        array
    }

    extern "C" fn end_head_tag_handler(
        end: *mut lol::EndTag,
        opaque_this: *mut c_void,
    ) -> lol::Directive {
        // SAFETY: opaque_this was set to &mut HTMLLoader in on_head_tag; end is non-null from lol-html callback.
        let this: &mut Self = unsafe { &mut *(opaque_this as *mut Self) };
        let end = unsafe { &mut *end };
        if this.linker.dev_server.is_none() {
            if this.add_head_tags(end).is_err() {
                return lol::Directive::Stop;
            }
        } else {
            this.end_tag_indices.head = Some(u32::try_from(this.output.len()).unwrap());
        }
        lol::Directive::Continue
    }

    extern "C" fn end_body_tag_handler(
        end: *mut lol::EndTag,
        opaque_this: *mut c_void,
    ) -> lol::Directive {
        // SAFETY: opaque_this was set to &mut HTMLLoader in on_body_tag; end is non-null from lol-html callback.
        let this: &mut Self = unsafe { &mut *(opaque_this as *mut Self) };
        let end = unsafe { &mut *end };
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
            this.end_tag_indices.body = Some(u32::try_from(this.output.len()).unwrap());
        }
        lol::Directive::Continue
    }

    extern "C" fn end_html_tag_handler(
        end: *mut lol::EndTag,
        opaque_this: *mut c_void,
    ) -> lol::Directive {
        // SAFETY: opaque_this was set to &mut HTMLLoader in on_html_tag; end is non-null from lol-html callback.
        let this: &mut Self = unsafe { &mut *(opaque_this as *mut Self) };
        let end = unsafe { &mut *end };
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
            this.end_tag_indices.html = Some(u32::try_from(this.output.len()).unwrap());
        }
        lol::Directive::Continue
    }
}

fn generate_compile_result_for_html_chunk_impl(
    worker: &bundler_thread_pool::Worker,
    c: &LinkerContext,
    chunk: &Chunk,
    chunks: &[Chunk],
) -> CompileResult {
    let parse_graph = &c.parse_graph;
    let input_files = parse_graph.input_files.slice();
    let sources = input_files.items_source();
    let import_records = c.graph.ast.items_import_records();

    // HTML bundles for dev server must be allocated to it, as it must outlive
    // the bundle task. See `DevServer.RouteBundle.HTML.bundled_html_text`
    // TODO(port): Zig used `dev.allocator()` vs `worker.allocator` to control output ownership.
    // In Rust with global mimalloc this distinction collapses; verify DevServer ownership in Phase B.
    let _ = worker;

    let mut html_loader = HTMLLoader {
        linker: c,
        source_index: chunk.entry_point.source_index,
        import_records: import_records[chunk.entry_point.source_index as usize].as_slice(),
        log: c.log,
        current_import_record_index: 0,
        minify_whitespace: c.options.minify_whitespace,
        compile_to_standalone_html: c.options.compile_to_standalone_html,
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

    HTMLScanner::HtmlProcessor::<HTMLLoader, true>::run(
        &mut html_loader,
        &sources[chunk.entry_point.source_index as usize].contents,
    )
    .unwrap_or_else(|_| panic!("unexpected error from HTMLProcessor.run"));

    // There are some cases where invalid HTML will make it so </head> is
    // never emitted, even if the literal text DOES appear. These cases are
    // along the lines of having a self-closing tag for a non-self closing
    // element. In this case, head_end_tag_index will be 0, and a simple
    // search through the page is done to find the "</head>"
    // See https://github.com/oven-sh/bun/issues/17554
    let script_injection_offset: u32 = if c.dev_server.is_some() {
        'brk: {
            if let Some(head) = html_loader.end_tag_indices.head {
                break 'brk head;
            }
            if let Some(head) = strings::index_of(&html_loader.output, b"</head>") {
                break 'brk u32::try_from(head).unwrap();
            }
            if let Some(body) = html_loader.end_tag_indices.body {
                break 'brk body;
            }
            if let Some(html) = html_loader.end_tag_indices.html {
                break 'brk html;
            }
            u32::try_from(html_loader.output.len()).unwrap() // inject at end of file.
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
                        if let Some(js_chunk) =
                            html_loader.chunk.get_js_chunk_for_html(html_loader.chunks)
                        {
                            let mut script = Vec::new();
                            write!(
                                &mut script,
                                "<script type=\"module\">{}</script>",
                                BStr::new(&js_chunk.unique_key)
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
        code: html_loader.output,
        source_index: chunk.entry_point.source_index,
        script_injection_offset,
    }
}

pub use bun_bundler::DeferredBatchTask;
pub use bun_bundler::ParseTask;
pub use bun_bundler::ThreadPool;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bundler/linker_context/generateCompileResultForHtmlChunk.zig (344 lines)
//   confidence: medium
//   todos:      5
//   notes:      MultiArrayList .items(.field) accessors guessed as items_<field>(); dev_server allocator ownership semantics need Phase B review; HTMLProcessor generic shape (<T, const bool>) and lol-html callback signatures need verification.
// ──────────────────────────────────────────────────────────────────────────
