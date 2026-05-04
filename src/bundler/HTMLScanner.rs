use core::marker::PhantomData;

use bun_collections::{BabyList, BoundedArray};
use bun_logger as logger;
use bun_logger::{Loc, Log, Range, Source};
use bun_lolhtml_sys as lol;
use bun_options_types::{ImportKind, ImportRecord};
use bun_paths as path;
use bun_fs as fs;
use bun_sys as sys;
use bun_core::Error;

bun_output::declare_scope!(HTMLScanner, hidden);

// TODO(port): lifetime — `log`/`source` are borrowed for the scanner's lifetime
// (LIFETIMES.tsv had no row for this file; classified locally as BORROW_PARAM).
pub struct HTMLScanner<'a> {
    // allocator field dropped — global mimalloc (see PORTING.md §Allocators).
    pub import_records: BabyList<ImportRecord>, // Zig: ImportRecord.List
    pub log: &'a mut Log,
    pub source: &'a Source,
}

impl<'a> HTMLScanner<'a> {
    pub fn init(log: &'a mut Log, source: &'a Source) -> HTMLScanner<'a> {
        HTMLScanner {
            import_records: BabyList::default(),
            log,
            source,
        }
    }
}

impl<'a> HTMLScanner<'a> {
    fn create_import_record(&mut self, input_path: &[u8], kind: ImportKind) -> Result<(), Error> {
        // In HTML, sometimes people do /src/index.js
        // In that case, we don't want to use the absolute filesystem path, we want to use the path relative to the project root
        let path_to_use: &[u8] = if input_path.len() > 1 && input_path[0] == b'/' {
            path::join_abs_string(
                fs::FileSystem::instance().top_level_dir(),
                &[&input_path[1..]],
                path::Platform::Auto,
            )
        }
        // Check if imports to (e.g) "App.tsx" are actually relative imoprts w/o the "./"
        else if input_path.len() > 2 && input_path[0] != b'.' && input_path[1] != b'/' {
            'blk: {
                let Some(index_of_dot) = input_path.iter().rposition(|&b| b == b'.') else {
                    break 'blk input_path;
                };
                let ext = &input_path[index_of_dot..];
                if ext.len() > 4 {
                    break 'blk input_path;
                }
                // /foo/bar/index.html -> /foo/bar
                let Some(dirname) = path::dirname(self.source.path.text(), path::Platform::Auto)
                else {
                    break 'blk input_path;
                };
                let resolved =
                    path::join_abs_string(dirname, &[input_path], path::Platform::Auto);
                if sys::exists(resolved) {
                    resolved
                } else {
                    input_path
                }
            }
        } else {
            input_path
        };

        let record = ImportRecord {
            path: fs::Path::init(bun_str::ZStr::from_bytes(path_to_use)),
            kind,
            range: Range::NONE,
            ..Default::default()
        };

        self.import_records.push(record)?;
        // TODO(port): narrow error set
        Ok(())
    }

    pub fn on_write_html(&mut self, bytes: &[u8]) {
        let _ = bytes; // bytes are not written in scan phase
    }

    pub fn on_html_parse_error(&mut self, message: &[u8]) {
        // bun.handleOom → Rust Vec/Box allocations abort on OOM; just call.
        self.log.add_error(Some(self.source), Loc::EMPTY, message);
    }

    pub fn on_tag(
        &mut self,
        _element: &mut lol::Element,
        path: &[u8],
        url_attribute: &[u8],
        kind: ImportKind,
    ) {
        let _ = url_attribute;
        let _ = self.create_import_record(path, kind);
    }

    pub fn scan(&mut self, input: &[u8]) -> Result<(), Error> {
        Processor::run(self, input)
    }
}

// Zig: const processor = HTMLProcessor(HTMLScanner, false);
// TODO(port): HTMLScanner<'a> carries a lifetime; Phase B may need
// `for<'a> HTMLProcessor<HTMLScanner<'a>, false>` or to drop the alias.
type Processor<'a> = HTMLProcessor<HTMLScanner<'a>, false>;

// ───────────────────────────────────────────────────────────────────────────
// HTMLProcessor — generic over visitor `T` and `VISIT_DOCUMENT_TAGS`
// ───────────────────────────────────────────────────────────────────────────

/// Trait capturing the duck-typed methods Zig's `HTMLProcessor` calls on `T`.
/// Zig used `anytype`-style structural calls; Rust needs an explicit bound.
pub trait HTMLProcessorHandler {
    fn on_tag(
        &mut self,
        element: &mut lol::Element,
        path: &[u8],
        url_attribute: &[u8],
        kind: ImportKind,
    );
    fn on_write_html(&mut self, bytes: &[u8]);
    fn on_html_parse_error(&mut self, message: &[u8]);

    // Only required when VISIT_DOCUMENT_TAGS == true.
    // TODO(port): split into a separate trait if const-generic specialization
    // is unwieldy; Zig only references these inside `if (visit_document_tags)`.
    fn on_body_tag(&mut self, _element: &mut lol::Element) -> bool {
        unreachable!()
    }
    fn on_head_tag(&mut self, _element: &mut lol::Element) -> bool {
        unreachable!()
    }
    fn on_html_tag(&mut self, _element: &mut lol::Element) -> bool {
        unreachable!()
    }
}

impl<'a> HTMLProcessorHandler for HTMLScanner<'a> {
    fn on_tag(
        &mut self,
        element: &mut lol::Element,
        path: &[u8],
        url_attribute: &[u8],
        kind: ImportKind,
    ) {
        HTMLScanner::on_tag(self, element, path, url_attribute, kind)
    }
    fn on_write_html(&mut self, bytes: &[u8]) {
        HTMLScanner::on_write_html(self, bytes)
    }
    fn on_html_parse_error(&mut self, message: &[u8]) {
        HTMLScanner::on_html_parse_error(self, message)
    }
}

pub struct HTMLProcessor<T, const VISIT_DOCUMENT_TAGS: bool>(PhantomData<T>);

#[derive(Clone, Copy)]
pub struct TagHandler {
    /// CSS selector to match elements
    pub selector: &'static [u8],
    /// Whether this tag can have text content that needs to be processed
    pub has_content: bool,
    /// The attribute to extract the URL from
    pub url_attribute: &'static [u8],
    /// The kind of import to create
    pub kind: ImportKind,

    pub is_head_or_html: bool,
}

impl TagHandler {
    const fn new(
        selector: &'static [u8],
        has_content: bool,
        url_attribute: &'static [u8],
        kind: ImportKind,
    ) -> Self {
        Self {
            selector,
            has_content,
            url_attribute,
            kind,
            is_head_or_html: false,
        }
    }
}

pub const TAG_HANDLERS: [TagHandler; 16] = [
    // Module scripts with src
    TagHandler::new(b"script[src]", false, b"src", ImportKind::Stmt),
    // CSS Stylesheets
    TagHandler::new(b"link[rel='stylesheet'][href]", false, b"href", ImportKind::At),
    // CSS Assets
    TagHandler::new(b"link[as='style'][href]", false, b"href", ImportKind::At),
    // Font files
    TagHandler::new(
        b"link[as='font'][href], link[type^='font/'][href]",
        false,
        b"href",
        ImportKind::Url,
    ),
    // Image assets
    TagHandler::new(b"link[as='image'][href]", false, b"href", ImportKind::Url),
    // Audio/Video assets
    TagHandler::new(
        b"link[as='video'][href], link[as='audio'][href]",
        false,
        b"href",
        ImportKind::Url,
    ),
    // Web Workers
    TagHandler::new(b"link[as='worker'][href]", false, b"href", ImportKind::Stmt),
    // Manifest files
    TagHandler::new(b"link[rel='manifest'][href]", false, b"href", ImportKind::Url),
    // Icons
    TagHandler::new(
        b"link[rel='icon'][href], link[rel='apple-touch-icon'][href]",
        false,
        b"href",
        ImportKind::Url,
    ),
    // Images with src
    TagHandler::new(b"img[src]", false, b"src", ImportKind::Url),
    // Images with srcset
    TagHandler::new(b"img[srcset]", false, b"srcset", ImportKind::Url),
    // Videos with src
    TagHandler::new(b"video[src]", false, b"src", ImportKind::Url),
    // Videos with poster
    TagHandler::new(b"video[poster]", false, b"poster", ImportKind::Url),
    // Audio with src
    TagHandler::new(b"audio[src]", false, b"src", ImportKind::Url),
    // Source elements with src
    TagHandler::new(b"source[src]", false, b"src", ImportKind::Url),
    // Source elements with srcset
    TagHandler::new(b"source[srcset]", false, b"srcset", ImportKind::Url),
    //     // Iframes
    //     TagHandler::new(b"iframe[src]", false, b"src", ImportKind::Url),
];

impl<T: HTMLProcessorHandler, const VISIT_DOCUMENT_TAGS: bool>
    HTMLProcessor<T, VISIT_DOCUMENT_TAGS>
{
    /// Zig: `fn generateHandlerForTag(comptime tag_info: TagHandler) fn(*T, *lol.Element) bool`
    ///
    /// Rust cannot capture a `TagHandler` value into a bare `fn` pointer, so we
    /// monomorphize on the index into `TAG_HANDLERS` instead.
    fn generate_handler_for_tag<const I: usize>() -> fn(&mut T, &mut lol::Element) -> bool {
        fn handle<T: HTMLProcessorHandler, const I: usize>(
            this: &mut T,
            element: &mut lol::Element,
        ) -> bool {
            let tag_info = &TAG_HANDLERS[I];
            // Handle URL attribute if present
            if !tag_info.url_attribute.is_empty() {
                if element.has_attribute(tag_info.url_attribute).unwrap_or(false) {
                    let value = element.get_attribute(tag_info.url_attribute);
                    // `value` drops at end of scope (Zig: defer value.deinit()).
                    if value.len() > 0 {
                        bun_output::scoped_log!(
                            HTMLScanner,
                            "{} {}",
                            bstr::BStr::new(tag_info.selector),
                            bstr::BStr::new(value.slice())
                        );
                        this.on_tag(element, value.slice(), tag_info.url_attribute, tag_info.kind);
                    }
                }
            }
            false
        }
        handle::<T, I>
    }

    pub fn run(this: &mut T, input: &[u8]) -> Result<(), Error> {
        let mut builder = lol::HTMLRewriter::Builder::init();
        // builder drops at end of scope (Zig: defer builder.deinit()).

        const CAP: usize = TAG_HANDLERS.len() + if VISIT_DOCUMENT_TAGS { 3 } else { 0 };
        let mut selectors: BoundedArray<*mut lol::HTMLSelector, CAP> = BoundedArray::default();
        // PORT NOTE: Zig's `defer for (selectors.slice()) |s| s.deinit()` — guard
        // stays armed on all paths; access via DerefMut so cleanup still runs.
        let mut selectors_guard = scopeguard::guard(&mut selectors, |selectors| {
            for selector in selectors.slice() {
                // SAFETY: each selector was returned by HTMLSelector::parse and
                // has not been freed yet.
                unsafe { lol::HTMLSelector::deinit(*selector) };
            }
        });
        let selectors = &mut **selectors_guard;
        // TODO(port): Phase B should make `HTMLSelector` an RAII type so the
        // BoundedArray drops them itself and this guard goes away.

        // Add handlers for each tag type
        // TODO(port): Zig `inline for (tag_handlers)` monomorphizes
        // `generateHandlerForTag(tag_info)` per element. Rust needs a
        // compile-time unroll (e.g. `seq_macro::seq!`) to instantiate
        // `generate_handler_for_tag::<I>()` for I in 0..TAG_HANDLERS.len().
        // Phase A writes the loop body once with a placeholder index.
        // PERF(port): was comptime monomorphization — profile in Phase B.
        macro_rules! register_tag_handlers {
            ($($i:literal),*) => {$(
                {
                    let tag_info = &TAG_HANDLERS[$i];
                    let selector = lol::HTMLSelector::parse(tag_info.selector)?;
                    selectors.push(selector);
                    // PERF(port): was assume_capacity
                    builder.add_element_content_handlers(
                        selector,
                        Self::generate_handler_for_tag::<$i>(),
                        this,
                        None::<fn(&mut (), &mut lol::Comment) -> bool>,
                        core::ptr::null_mut(),
                        None::<fn(&mut (), &mut lol::TextChunk) -> bool>,
                        core::ptr::null_mut(),
                    )?;
                }
            )*};
        }
        register_tag_handlers!(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15);

        if VISIT_DOCUMENT_TAGS {
            // Zig: inline for (.{ "body", "head", "html" }, &.{ T.onBodyTag, ... })
            // Unrolled (3 items, heterogeneous fn refs).
            for (tag, cb) in [
                (b"body" as &[u8], T::on_body_tag as fn(&mut T, &mut lol::Element) -> bool),
                (b"head", T::on_head_tag),
                (b"html", T::on_html_tag),
            ] {
                let head_selector = lol::HTMLSelector::parse(tag)?;
                selectors.push(head_selector);
                // PERF(port): was assume_capacity
                builder.add_element_content_handlers(
                    head_selector,
                    cb,
                    this,
                    None::<fn(&mut (), &mut lol::Comment) -> bool>,
                    core::ptr::null_mut(),
                    None::<fn(&mut (), &mut lol::TextChunk) -> bool>,
                    core::ptr::null_mut(),
                )?;
            }
        }

        let memory_settings = lol::MemorySettings {
            preallocated_parsing_buffer_size: (input.len() / 4).max(1024),
            max_allowed_memory_usage: 1024 * 1024 * 10,
        };

        fn done<T>(_: &mut T) {}

        // PORT NOTE: Zig `errdefer { ... this.onHTMLParseError(last_error) }`
        // reshaped — fallible tail wrapped in an inner block so the side effect
        // runs on error without a scopeguard double-borrowing `this`.
        let res: Result<(), Error> = (|| {
            let mut rewriter = builder.build(
                lol::Encoding::UTF8,
                memory_settings,
                false,
                this,
                T::on_write_html,
                done::<T>,
            )?;
            // rewriter drops at end of scope (Zig: defer rewriter.deinit()).
            rewriter.write(input)?;
            rewriter.end()?;
            Ok(())
        })();

        if res.is_err() {
            let last_error = lol::HTMLString::last_error();
            // last_error drops at end of scope (Zig: defer last_error.deinit()).
            if last_error.len() > 0 {
                this.on_html_parse_error(last_error.slice());
            }
        }
        res
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bundler/HTMLScanner.zig (308 lines)
//   confidence: medium
//   todos:      6
//   notes:      comptime fn-generation (`generateHandlerForTag` + `inline for`) mapped to const-generic index + macro unroll; errdefer reshaped into inner Result block; LIFETIMES.tsv had no rows so log/source classified BORROW_PARAM locally
// ──────────────────────────────────────────────────────────────────────────
