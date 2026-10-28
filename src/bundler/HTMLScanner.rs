use core::marker::PhantomData;
use std::borrow::Cow;

use crate::Error;
use bun_alloc::AstAlloc;
use bun_ast::{ImportKind, ImportRecord, ImportRecordFlags, ImportRecordTag, Index as AstIndex};
use bun_ast::{Loc, Log, Range, Source};
use bun_paths::fs::Path as FsPath;
use bun_paths::{platform, resolve_path};
use bun_sys as sys;

/// The single `lol_html::OutputSink` type every Bun `HtmlRewriter` is built
/// with (here and in `HTMLRewriter`), so lol_html's rewriter/tokenizer
/// machinery is instantiated once rather than once per sink closure type.
pub enum OutputSink<'a> {
    /// `HTMLRewriter`'s response pipe: every chunk is appended to its staging
    /// buffer (statically dispatched — this is the throughput-sensitive user).
    /// The pipe owns the rewriter that owns this sink, so the back-reference
    /// invariant holds structurally.
    Buffer(bun_ptr::BackRef<bun_ptr::JsCell<Vec<u8>>>),
    /// The bundler's HTML scanner.
    Callback(Box<dyn FnMut(&[u8]) + 'a>),
}

impl lol_html::OutputSink for OutputSink<'_> {
    #[inline]
    fn handle_chunk(&mut self, chunk: &[u8]) {
        match self {
            // lol-html signals end-of-document with one zero-length chunk.
            OutputSink::Buffer(buffer) => {
                if !chunk.is_empty() {
                    buffer.with_mut(|buffer| buffer.extend_from_slice(chunk));
                }
            }
            OutputSink::Callback(callback) => Self::call(callback, chunk),
        }
    }
}

impl OutputSink<'_> {
    // Out of line so the per-chunk sink call lol_html inlines everywhere stays small.
    #[cold]
    #[inline(never)]
    fn call(callback: &mut (dyn FnMut(&[u8]) + '_), chunk: &[u8]) {
        callback(chunk)
    }
}
use lol_html::html_content::Element;

bun_core::declare_scope!(HTMLScanner, hidden);

pub(crate) struct HTMLScanner<'a> {
    // arena field dropped — global mimalloc (see PORTING.md §Allocators).
    pub import_records: Vec<ImportRecord<'static>>,
    pub log: &'a mut Log,
    pub source: &'a Source<'a>,
}

impl<'a> HTMLScanner<'a> {
    pub(crate) fn init(log: &'a mut Log, source: &'a Source<'a>) -> HTMLScanner<'a> {
        HTMLScanner {
            import_records: Vec::new(),
            log,
            source,
        }
    }
}

impl<'a> HTMLScanner<'a> {
    fn create_import_record(&mut self, input_path: &[u8], kind: ImportKind) -> Result<(), Error> {
        // A root-relative URL (`/src/index.js`) is stored as written, see `RootRelativeUrl`.
        // Check if imports to (e.g) "App.tsx" are actually relative imoprts w/o the "./"
        let path_to_use: &[u8] = if input_path.len() > 2
            && input_path[0] != b'.'
            && input_path[0] != b'/'
            && input_path[1] != b'/'
        {
            'blk: {
                let Some(index_of_dot) = bun_core::strings::last_index_of_char(input_path, b'.')
                else {
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

        let leak = |bytes: &[u8]| -> &'static [u8] {
            Box::leak(AstAlloc::vec_from_slice(bytes).into_boxed_slice())
        };
        let owned = leak(path_to_use);
        let original_path = if core::ptr::eq(path_to_use, input_path) {
            owned
        } else {
            leak(input_path)
        };
        let record = ImportRecord {
            path: FsPath::init(owned),
            kind,
            range: Range::NONE,
            tag: ImportRecordTag::default(),
            loader: None,
            source_index: AstIndex::default(),
            original_path,
            flags: ImportRecordFlags::default(),
        };

        self.import_records.push(record);
        Ok(())
    }

    fn on_write_html(&mut self, bytes: &[u8]) {
        let _ = bytes; // bytes are not written in scan phase
    }

    fn on_html_parse_error(&mut self, message: &[u8]) {
        // Vec/Box allocations abort on OOM; just call. `IntoText for
        // Vec<u8>` → `Cow::Owned`, so the Log owns and drops the copy.
        let _ = self
            .log
            .add_error(Some(self.source), Loc::EMPTY, message.to_vec());
    }

    fn on_tag(
        &mut self,
        _element: &mut Element<'_, '_>,
        path: &[u8],
        url_attribute: &[u8],
        kind: ImportKind,
    ) {
        let _ = url_attribute;
        let _ = self.create_import_record(path, kind);
    }

    pub(crate) fn scan(&mut self, input: &[u8]) -> Result<(), Error> {
        Processor::run(self, input)
    }
}

/// The import records of the HTML file `source`: one per `<script src>`, `<link href>` and other tag the bundler follows.
pub fn scan_import_records(
    log: &mut Log,
    source: &Source,
) -> Result<Vec<ImportRecord<'static>>, Error> {
    let mut scanner = HTMLScanner::init(log, source);
    scanner.scan(&source.contents)?;
    Ok(scanner.import_records)
}

/// One leading `/`. `//host/path` is protocol-relative and stays a URL.
pub fn is_root_relative_url(url: &[u8]) -> bool {
    url.len() > 1 && url[0] == b'/' && url[1] != b'/'
}

/// `<root>/favicon.png` for `/favicon.png`, in a thread-local buffer until the next join.
pub fn rebase_root_relative_url<'r>(root: &'r [u8], url: &[u8]) -> &'r [u8] {
    debug_assert!(is_root_relative_url(url));
    resolve_path::join_abs_string::<platform::Auto>(root, &[&url[1..]])
}

/// Lookup order of a root-relative HTML URL: `root_dir` when set, the HTML file's directory, `cwd`.
pub struct RootRelativeBases<'a> {
    dirs: [&'a [u8]; 3],
    len: usize,
}

impl<'a> RootRelativeBases<'a> {
    pub fn init(importer: &'a [u8], root_dir: &'a [u8], cwd: &'a [u8]) -> Self {
        let mut bases = Self {
            dirs: [b""; 3],
            len: 0,
        };
        if !root_dir.is_empty() {
            bases.push(root_dir);
        }
        let dir = resolve_path::dirname::<platform::Auto>(importer);
        // On Windows the dirname of `C:\index.html` is `C:`, not a base.
        let dir = if cfg!(windows) && dir.len() == 2 && importer.len() > 2 {
            &importer[..3]
        } else {
            dir
        };
        bases.push(dir);
        bases.push(cwd);
        bases
    }

    fn push(&mut self, dir: &'a [u8]) {
        let same = |other: &&[u8]| strip_trailing_sep(other) == strip_trailing_sep(dir);
        if dir.is_empty() || self.as_slice().iter().any(same) {
            return;
        }
        self.dirs[self.len] = dir;
        self.len += 1;
    }

    pub fn as_slice(&self) -> &[&'a [u8]] {
        &self.dirs[..self.len]
    }
}

/// A root-relative HTML URL and the file it names under each of its `RootRelativeBases`.
pub struct RootRelativeUrl<'r> {
    url: &'r [u8],
    candidates: [&'r [u8]; 3],
    len: usize,
    /// The index of the candidate `next_retry` hands out.
    retry: usize,
}

impl<'r> RootRelativeUrl<'r> {
    /// `None` unless the URL of `record`, an import of the HTML file `importer`, is root-relative.
    pub fn of_record(
        record: &ImportRecord<'r>,
        importer: &[u8],
        root_dir: &[u8],
        arena: &'r bun_alloc::Arena,
    ) -> Option<Self> {
        let url = record.original_path;
        if !is_root_relative_url(url) {
            return None;
        }
        let bases = RootRelativeBases::init(importer, root_dir, bun_core::top_level_dir());
        let mut this = Self {
            url,
            candidates: [b""; 3],
            len: bases.as_slice().len(),
            retry: 1,
        };
        for (candidate, base) in this.candidates.iter_mut().zip(bases.as_slice()) {
            *candidate = arena.alloc_slice_copy(rebase_root_relative_url(base, url));
        }
        Some(this)
    }

    pub fn candidates(&self) -> &[&'r [u8]] {
        &self.candidates[..self.len]
    }

    pub fn first(&self) -> &'r [u8] {
        self.candidates[0]
    }

    /// The next candidate after the previous one was not found.
    pub fn next_retry(&mut self) -> Option<&'r [u8]> {
        let next = *self.candidates().get(self.retry)?;
        self.retry += 1;
        Some(next)
    }

    /// The first candidate again, after the directory caches were re-read.
    pub fn restart(&mut self) -> &'r [u8] {
        self.retry = 1;
        self.first()
    }

    /// Evicts the cached directory of every candidate. True when any was cached.
    pub fn bust_dir_caches(&self, resolver: &mut bun_resolver::Resolver, importer: &[u8]) -> bool {
        let mut busted = false;
        for candidate in self.candidates() {
            busted |= resolver.bust_dir_cache_from_specifier(importer, candidate);
        }
        busted
    }

    /// The user marked the URL as written, or one of its candidates, external.
    pub fn is_user_external(&self, resolver: &bun_resolver::Resolver) -> bool {
        resolver.is_user_external(self.url)
            || self
                .candidates()
                .iter()
                .any(|candidate| resolver.is_user_external(candidate))
    }
}

fn strip_trailing_sep(dir: &[u8]) -> &[u8] {
    match dir {
        [rest @ .., last] if !rest.is_empty() && bun_paths::is_sep_native(*last) => rest,
        _ => dir,
    }
}

type Processor<'a> = HTMLProcessor<HTMLScanner<'a>, false>;

// ───────────────────────────────────────────────────────────────────────────
// HTMLProcessor — generic over visitor `T` and `VISIT_DOCUMENT_TAGS`
// ───────────────────────────────────────────────────────────────────────────

/// Trait capturing the methods `HTMLProcessor` calls on `T`.
pub(crate) trait HTMLProcessorHandler {
    fn on_tag(
        &mut self,
        element: &mut Element<'_, '_>,
        path: &[u8],
        url_attribute: &[u8],
        kind: ImportKind,
    );
    fn on_write_html(&mut self, bytes: &[u8]);
    fn on_html_parse_error(&mut self, message: &[u8]);

    // Only required when VISIT_DOCUMENT_TAGS == true; `run` only calls
    // these when visiting document tags, so the defaults are never
    // reached for handlers that don't visit document tags.
    fn on_body_tag(&mut self, _element: &mut Element<'_, '_>) -> bool {
        unreachable!()
    }
    fn on_head_tag(&mut self, _element: &mut Element<'_, '_>) -> bool {
        unreachable!()
    }
    fn on_html_tag(&mut self, _element: &mut Element<'_, '_>) -> bool {
        unreachable!()
    }
}

impl<'a> HTMLProcessorHandler for HTMLScanner<'a> {
    fn on_tag(
        &mut self,
        element: &mut Element<'_, '_>,
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

pub(crate) struct HTMLProcessor<T, const VISIT_DOCUMENT_TAGS: bool>(PhantomData<T>);

#[derive(Clone, Copy)]
struct TagHandler {
    /// CSS selector to match elements
    pub(crate) selector: &'static str,
    /// The attribute to extract the URL from
    pub(crate) url_attribute: &'static str,
    /// The kind of import to create
    pub(crate) kind: ImportKind,
}

impl TagHandler {
    const fn new(selector: &'static str, url_attribute: &'static str, kind: ImportKind) -> Self {
        Self {
            selector,
            url_attribute,
            kind,
        }
    }
}

const TAG_HANDLERS: [TagHandler; 16] = [
    // Module scripts with src
    TagHandler::new("script[src]", "src", ImportKind::Stmt),
    // CSS Stylesheets
    TagHandler::new("link[rel='stylesheet'][href]", "href", ImportKind::At),
    // CSS Assets
    TagHandler::new("link[as='style'][href]", "href", ImportKind::At),
    // Font files
    TagHandler::new(
        "link[as='font'][href], link[type^='font/'][href]",
        "href",
        ImportKind::Url,
    ),
    // Image assets
    TagHandler::new("link[as='image'][href]", "href", ImportKind::Url),
    // Audio/Video assets
    TagHandler::new(
        "link[as='video'][href], link[as='audio'][href]",
        "href",
        ImportKind::Url,
    ),
    // Web Workers
    TagHandler::new("link[as='worker'][href]", "href", ImportKind::Stmt),
    // Manifest files
    TagHandler::new("link[rel='manifest'][href]", "href", ImportKind::Url),
    // Icons
    TagHandler::new(
        "link[rel='icon'][href], link[rel='apple-touch-icon'][href]",
        "href",
        ImportKind::Url,
    ),
    // Images with src
    TagHandler::new("img[src]", "src", ImportKind::Url),
    // Images with srcset
    TagHandler::new("img[srcset]", "srcset", ImportKind::Url),
    // Videos with src
    TagHandler::new("video[src]", "src", ImportKind::Url),
    // Videos with poster
    TagHandler::new("video[poster]", "poster", ImportKind::Url),
    // Audio with src
    TagHandler::new("audio[src]", "src", ImportKind::Url),
    // Source elements with src
    TagHandler::new("source[src]", "src", ImportKind::Url),
    // Source elements with srcset
    TagHandler::new("source[srcset]", "srcset", ImportKind::Url),
    //     // Iframes
    //     TagHandler::new("iframe[src]", "src", ImportKind::Url),
];

const SELECTOR_CAP: usize = TAG_HANDLERS.len() + 3;

#[inline]
fn lol_err<E>(_: E) -> Error {
    crate::Error::Fail
}

/// `element_content_handlers` entry with only the element slot populated —
/// the only shape this processor registers (leaving the comment/text slots
/// empty lets lol-html skip lexing that content).
fn element_entry<'h>(
    selector: &str,
    element: lol_html::ElementHandler<'h>,
) -> Result<
    (
        Cow<'static, lol_html::Selector>,
        lol_html::ElementContentHandlers<'h>,
    ),
    Error,
> {
    Ok((
        Cow::Owned(selector.parse().map_err(lol_err)?),
        lol_html::ElementContentHandlers {
            element: Some(element),
            comments: None,
            text: None,
        },
    ))
}

impl<T: HTMLProcessorHandler, const VISIT_DOCUMENT_TAGS: bool>
    HTMLProcessor<T, VISIT_DOCUMENT_TAGS>
{
    pub(crate) fn run(this: &mut T, input: &[u8]) -> Result<(), Error> {
        // Every handler closure and the output sink capture this raw pointer
        // so one `&mut T` can service them all; `this` is not reborrowed
        // until the rewriter holding those closures is gone.
        let this_ptr: *mut T = this;

        let mut element_content_handlers = Vec::with_capacity(SELECTOR_CAP);

        for tag_info in TAG_HANDLERS {
            let on_element: lol_html::ElementHandler<'_> = Box::new(
                move |element: &mut Element<'_, '_>| -> lol_html::HandlerResult {
                    if !tag_info.url_attribute.is_empty()
                        && element.has_attribute(tag_info.url_attribute)
                    {
                        let value = element
                            .get_attribute(tag_info.url_attribute)
                            .unwrap_or_default();
                        if !value.is_empty() {
                            bun_core::scoped_log!(HTMLScanner, "{} {}", tag_info.selector, value);
                            // SAFETY: `this_ptr` was derived from `run`'s `&mut T`,
                            // which is not reborrowed while the rewriter — the only
                            // holder of these closures — is alive.
                            unsafe {
                                (*this_ptr).on_tag(
                                    element,
                                    value.as_bytes(),
                                    tag_info.url_attribute.as_bytes(),
                                    tag_info.kind,
                                );
                            }
                        }
                    }
                    Ok(())
                },
            );
            element_content_handlers.push(element_entry(tag_info.selector, on_element)?);
        }

        if VISIT_DOCUMENT_TAGS {
            for (which, tag) in ["body", "head", "html"].into_iter().enumerate() {
                let on_element: lol_html::ElementHandler<'_> = Box::new(
                    move |element: &mut Element<'_, '_>| -> lol_html::HandlerResult {
                        // SAFETY: see `on_tag` above.
                        let stop = unsafe {
                            match which {
                                0 => (*this_ptr).on_body_tag(element),
                                1 => (*this_ptr).on_head_tag(element),
                                _ => (*this_ptr).on_html_tag(element),
                            }
                        };
                        if stop {
                            // The exact text lol-html's C API attached to a
                            // LOL_HTML_STOP directive (c-api/rewriter_builder.rs).
                            Err("The rewriter has been stopped.".into())
                        } else {
                            Ok(())
                        }
                    },
                );
                element_content_handlers.push(element_entry(tag, on_element)?);
            }
        }

        let settings = lol_html::Settings {
            element_content_handlers,
            encoding: lol_html::AsciiCompatibleEncoding::utf_8(),
            // lol_html only buffers the unparsed tail of each write, so the default preallocation is enough.
            memory_settings: lol_html::MemorySettings {
                max_allowed_memory_usage: u32::MAX as usize,
                ..lol_html::MemorySettings::new()
            },
            strict: false,
            ..lol_html::Settings::new()
        };

        // lol-html signals end-of-document with one zero-length chunk; the
        // C-API sink routed that to a no-op `done()`, never to `on_write_html`.
        let output_sink = OutputSink::Callback(Box::new(move |chunk: &[u8]| {
            if !chunk.is_empty() {
                // SAFETY: see `on_tag` above.
                unsafe { (*this_ptr).on_write_html(chunk) }
            }
        }));

        // The rewriter — the sole holder of `this_ptr`-derived aliases — is
        // consumed (or dropped on a failed `write`) inside this closure, so
        // reasserting the original `&mut T` borrow afterward is sound.
        let res: Result<(), lol_html::errors::RewritingError> = (|| {
            let mut rewriter = lol_html::HtmlRewriter::new(settings, output_sink);
            rewriter.write(input)?;
            rewriter.end()
        })();

        if let Err(err) = &res {
            this.on_html_parse_error(err.to_string().as_bytes());
        }
        res.map_err(lol_err)
    }
}
