use core::marker::PhantomData;
use core::ptr::NonNull;

use crate::bun_fs as fs;
use bun_ast::{ImportKind, ImportRecord, ImportRecordFlags, ImportRecordTag, Index as AstIndex};
use bun_ast::{Loc, Log, Range, Source};
use bun_collections::{BoundedArray, VecExt};
use bun_core::Error;
use bun_lolhtml_sys::lol_html as lol;
use bun_paths::fs::Path as FsPath;
use bun_paths::{platform, resolve_path};
use bun_sys as sys;

bun_core::declare_scope!(HTMLScanner, hidden);

// TODO(port): lifetime — `log`/`source` are borrowed for the scanner's lifetime
// (LIFETIMES.tsv had no row for this file; classified locally as BORROW_PARAM).
pub struct HTMLScanner<'a> {
    // arena field dropped — global mimalloc (see PORTING.md §Allocators).
    pub import_records: Vec<ImportRecord>, // Zig: ImportRecord.List
    pub log: &'a mut Log,
    pub source: &'a Source,
}

impl<'a> HTMLScanner<'a> {
    pub fn init(log: &'a mut Log, source: &'a Source) -> HTMLScanner<'a> {
        HTMLScanner {
            import_records: Vec::new(),
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
            resolve_path::join_abs_string::<platform::Auto>(
                fs::FileSystem::instance().top_level_dir,
                &[&input_path[1..]],
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
                let dirname = resolve_path::dirname::<platform::Auto>(self.source.path.text());
                if dirname.is_empty() {
                    break 'blk input_path;
                }
                let resolved =
                    resolve_path::join_abs_string_z::<platform::Auto>(dirname, &[input_path]);
                if sys::exists_z(resolved) {
                    resolved.as_bytes()
                } else {
                    input_path
                }
            }
        } else {
            input_path
        };

        // Zig: `try this.arena.dupeZ(u8, path_to_use)` — leak into 'static for Path<'static>.
        let owned: &'static [u8] = path_to_use.to_vec().leak();
        let record = ImportRecord {
            path: FsPath::init(owned),
            kind,
            range: Range::NONE,
            tag: ImportRecordTag::default(),
            loader: None,
            source_index: AstIndex::default(),
            module_id: 0,
            original_path: b"",
            flags: ImportRecordFlags::default(),
        };

        self.import_records.push(record);
        Ok(())
    }

    pub fn on_write_html(&mut self, bytes: &[u8]) {
        let _ = bytes; // bytes are not written in scan phase
    }

    pub fn on_html_parse_error(&mut self, message: &[u8]) {
        // bun.handleOom → Rust Vec/Box allocations abort on OOM; just call.
        // Zig `Log.addError` dupes via `log.msgs.allocator`; here `IntoText for
        // Vec<u8>` → `Cow::Owned`, so the Log owns and drops the copy.
        let _ = self
            .log
            .add_error(Some(self.source), Loc::EMPTY, message.to_vec());
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
    TagHandler::new(
        b"link[rel='stylesheet'][href]",
        false,
        b"href",
        ImportKind::At,
    ),
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
    TagHandler::new(
        b"link[rel='manifest'][href]",
        false,
        b"href",
        ImportKind::Url,
    ),
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

const SELECTOR_CAP: usize = TAG_HANDLERS.len() + 3;

// ── lol-html DirectiveCallback / OutputSink adapters ──────────────────────
// `lol_html::DirectiveCallback<Container>` allows one impl per (UserData,
// Container) pair, but Zig registered 16 distinct comptime fn-values against
// the same `*T`. We instead allocate one user-data record *per selector*
// holding `(*mut T, tag_index)`; the trait body is `generateHandlerForTag`'s
// body with `tag_info` looked up at runtime via the index.

struct TagUserData<T> {
    this: *mut T,
    tag_index: usize,
}

impl<T: HTMLProcessorHandler> lol::DirectiveCallback<lol::Element> for TagUserData<T> {
    fn call(&mut self, element: &mut lol::Element) -> bool {
        let tag_info = &TAG_HANDLERS[self.tag_index];
        // Handle URL attribute if present
        if !tag_info.url_attribute.is_empty() {
            let has = element
                .has_attribute(tag_info.url_attribute)
                .unwrap_or(false);
            if has {
                let value = element.get_attribute(tag_info.url_attribute);
                // Zig: defer value.deinit()
                let _value_guard = scopeguard::guard(value, |v| v.deinit());
                if value.len > 0 {
                    bun_core::scoped_log!(
                        HTMLScanner,
                        "{} {}",
                        bstr::BStr::new(tag_info.selector),
                        bstr::BStr::new(value.slice())
                    );
                    // SAFETY: `self.this` was set from `&mut T` in `run` and is
                    // valid for the lifetime of the rewriter.
                    unsafe {
                        (*self.this).on_tag(
                            element,
                            value.slice(),
                            tag_info.url_attribute,
                            tag_info.kind,
                        );
                    }
                }
            }
        }
        false
    }
}

// Unused comment/text handlers — registered as `None`, but the generic
// `add_element_content_handlers<EL, CM, TX>` still needs concrete types.
impl<T> lol::DirectiveCallback<lol::Comment> for TagUserData<T> {
    fn call(&mut self, _: &mut lol::Comment) -> bool {
        false
    }
}
impl<T> lol::DirectiveCallback<lol::TextChunk> for TagUserData<T> {
    fn call(&mut self, _: &mut lol::TextChunk) -> bool {
        false
    }
}

struct DocTagUserData<T> {
    this: *mut T,
    /// 0 = body, 1 = head, 2 = html
    which: u8,
}

impl<T: HTMLProcessorHandler> lol::DirectiveCallback<lol::Element> for DocTagUserData<T> {
    fn call(&mut self, element: &mut lol::Element) -> bool {
        // SAFETY: `self.this` was set from `&mut T` in `run` and is valid for
        // the lifetime of the rewriter.
        unsafe {
            match self.which {
                0 => (*self.this).on_body_tag(element),
                1 => (*self.this).on_head_tag(element),
                _ => (*self.this).on_html_tag(element),
            }
        }
    }
}
impl<T> lol::DirectiveCallback<lol::Comment> for DocTagUserData<T> {
    fn call(&mut self, _: &mut lol::Comment) -> bool {
        false
    }
}
impl<T> lol::DirectiveCallback<lol::TextChunk> for DocTagUserData<T> {
    fn call(&mut self, _: &mut lol::TextChunk) -> bool {
        false
    }
}

struct Sink<T>(*mut T);

impl<T: HTMLProcessorHandler> lol::OutputSink for Sink<T> {
    fn write(&mut self, bytes: &[u8]) {
        // SAFETY: `self.0` was set from `&mut T` in `run` and is valid for the
        // lifetime of the rewriter.
        unsafe { (*self.0).on_write_html(bytes) }
    }
    fn done(&mut self) {}
}

#[inline]
fn lol_err(_: lol::Error) -> Error {
    bun_core::err!(Fail)
}

impl<T: HTMLProcessorHandler, const VISIT_DOCUMENT_TAGS: bool>
    HTMLProcessor<T, VISIT_DOCUMENT_TAGS>
{
    pub fn run(this: &mut T, input: &[u8]) -> Result<(), Error> {
        let this_ptr: *mut T = this;

        let builder = lol::HTMLRewriterBuilder::init();
        // Zig: defer builder.deinit()
        let _builder_guard = scopeguard::guard(builder, |b| {
            // SAFETY: `b` came from `HTMLRewriterBuilder::init()` and has not
            // been freed.
            unsafe { lol::HTMLRewriterBuilder::destroy(b) }
        });

        let mut selectors: BoundedArray<*mut lol::HTMLSelector, SELECTOR_CAP> =
            BoundedArray::default();
        // Zig: defer for (selectors.slice()) |s| s.deinit()
        let mut selectors_guard = scopeguard::guard(
            &mut selectors,
            |selectors: &mut BoundedArray<*mut lol::HTMLSelector, SELECTOR_CAP>| {
                for selector in selectors.slice() {
                    // SAFETY: each selector was returned by HTMLSelector::parse
                    // and has not been freed yet.
                    unsafe { lol::HTMLSelector::destroy(*selector) };
                }
            },
        );
        let selectors = &mut **selectors_guard;

        // Per-selector user-data records — must outlive the rewriter.
        let mut tag_user_datas: [TagUserData<T>; TAG_HANDLERS.len()] =
            core::array::from_fn(|i| TagUserData {
                this: this_ptr,
                tag_index: i,
            });
        let mut doc_user_datas: [DocTagUserData<T>; 3] = core::array::from_fn(|i| DocTagUserData {
            this: this_ptr,
            which: i as u8,
        });

        // Add handlers for each tag type
        for i in 0..TAG_HANDLERS.len() {
            let tag_info = &TAG_HANDLERS[i];
            let selector = lol::HTMLSelector::parse(tag_info.selector).map_err(lol_err)?;
            selectors.append_assume_capacity(selector);
            // SAFETY: `builder` / `selector` are live FFI handles owned by the
            // guards above.
            unsafe { &mut *builder }
                .add_element_content_handlers(
                    // SAFETY: `selector` was just returned by `parse`.
                    unsafe { &mut *selector },
                    Some(NonNull::from(&mut tag_user_datas[i])),
                    None::<NonNull<TagUserData<T>>>,
                    None::<NonNull<TagUserData<T>>>,
                )
                .map_err(lol_err)?;
        }

        if VISIT_DOCUMENT_TAGS {
            // Zig: inline for (.{ "body", "head", "html" }, &.{ T.onBodyTag, ... })
            for (i, tag) in [b"body" as &[u8], b"head", b"html"].into_iter().enumerate() {
                let head_selector = lol::HTMLSelector::parse(tag).map_err(lol_err)?;
                selectors.append_assume_capacity(head_selector);
                // SAFETY: see above.
                unsafe { &mut *builder }
                    .add_element_content_handlers(
                        // SAFETY: `head_selector` was just returned by `parse`.
                        unsafe { &mut *head_selector },
                        Some(NonNull::from(&mut doc_user_datas[i])),
                        None::<NonNull<DocTagUserData<T>>>,
                        None::<NonNull<DocTagUserData<T>>>,
                    )
                    .map_err(lol_err)?;
            }
        }

        let memory_settings = lol::MemorySettings {
            preallocated_parsing_buffer_size: (input.len() / 4).max(1024),
            max_allowed_memory_usage: 1024 * 1024 * 10,
        };

        let mut sink = Sink::<T>(this_ptr);

        // PORT NOTE: Zig `errdefer { ... this.onHTMLParseError(last_error) }`
        // reshaped — fallible tail wrapped in an inner block so the side effect
        // runs on error without a scopeguard double-borrowing `this`.
        let res: Result<(), Error> = (|| {
            // SAFETY: `builder` is a live FFI handle.
            let rewriter = unsafe { &mut *builder }
                .build(lol::Encoding::UTF8, memory_settings, false, &raw mut sink)
                .map_err(lol_err)?;
            // Zig: defer rewriter.deinit()
            let _rewriter_guard = scopeguard::guard(rewriter, |r| {
                // SAFETY: `r` came from `build` and has not been freed.
                unsafe { lol::HTMLRewriter::destroy(r) }
            });
            // SAFETY: `rewriter` is a live FFI handle owned by `_rewriter_guard`.
            unsafe { lol::HTMLRewriter::write(rewriter, input) }.map_err(lol_err)?;
            // SAFETY: same as above.
            unsafe { lol::HTMLRewriter::end(rewriter) }.map_err(lol_err)?;
            Ok(())
        })();

        if res.is_err() {
            let last_error = lol::HTMLString::last_error();
            // Zig: defer last_error.deinit()
            let _last_error_guard = scopeguard::guard(last_error, |e| e.deinit());
            if last_error.len > 0 {
                // The rewriter (sole user of `this_ptr`-derived aliases) was
                // destroyed when the inner closure returned; reasserting the
                // original `&mut T` borrow here is sound and avoids the raw
                // deref entirely.
                this.on_html_parse_error(last_error.slice());
            }
        }
        res
    }
}

// ported from: src/bundler/HTMLScanner.zig
