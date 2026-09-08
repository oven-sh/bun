use core::marker::PhantomData;
use std::borrow::Cow;

use crate::Error;
use crate::bun_fs as fs;
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
    pub import_records: Vec<ImportRecord>,
    pub log: &'a mut Log,
    pub source: &'a Source,
}

impl<'a> HTMLScanner<'a> {
    pub(crate) fn init(log: &'a mut Log, source: &'a Source) -> HTMLScanner<'a> {
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

        let owned: &'static [u8] =
            Box::leak(AstAlloc::vec_from_slice(path_to_use).into_boxed_slice());
        let record = ImportRecord {
            path: FsPath::init(owned),
            kind,
            range: Range::NONE,
            tag: ImportRecordTag::default(),
            loader: None,
            source_index: AstIndex::default(),
            original_path: b"",
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

    fn on_url(&mut self, path: &[u8], kind: ImportKind) -> UrlAction<'_> {
        let _ = self.create_import_record(path, kind);
        UrlAction::Keep
    }

    pub(crate) fn scan(&mut self, input: &[u8]) -> Result<(), Error> {
        Processor::run(self, input)
    }
}

type Processor<'a> = HTMLProcessor<HTMLScanner<'a>, false>;

// ───────────────────────────────────────────────────────────────────────────
// HTMLProcessor — generic over visitor `T` and `VISIT_DOCUMENT_TAGS`
// ───────────────────────────────────────────────────────────────────────────

/// What to do with one URL found in a tag; `HTMLProcessor::run` applies it.
pub(crate) enum UrlAction<'a> {
    /// Leave the URL as written.
    Keep,
    /// Substitute this value for the URL.
    Replace(&'a [u8]),
    /// Remove the element, or for a `srcset`-style list only this candidate.
    Remove,
}

/// One image candidate string of a `srcset` / `imagesrcset` attribute.
struct SrcsetCandidate<'a> {
    url: &'a [u8],
    /// The width/density descriptor text after the URL, trimmed; may be empty.
    descriptors: &'a [u8],
}

/// <https://html.spec.whatwg.org/multipage/images.html#parsing-a-srcset-attribute>
struct SrcsetCandidates<'a> {
    input: &'a [u8],
    pos: usize,
}

impl<'a> SrcsetCandidates<'a> {
    fn new(input: &'a [u8]) -> Self {
        Self { input, pos: 0 }
    }
}

impl<'a> Iterator for SrcsetCandidates<'a> {
    type Item = SrcsetCandidate<'a>;

    fn next(&mut self) -> Option<Self::Item> {
        let input = self.input;
        let mut pos = self.pos;

        while pos < input.len() && (input[pos].is_ascii_whitespace() || input[pos] == b',') {
            pos += 1;
        }
        if pos >= input.len() {
            self.pos = pos;
            return None;
        }

        let url_start = pos;
        while pos < input.len() && !input[pos].is_ascii_whitespace() {
            pos += 1;
        }
        let mut url_end = pos;

        // `input[url_start]` is not a comma, so this never empties the URL.
        if input[url_end - 1] == b',' {
            while input[url_end - 1] == b',' {
                url_end -= 1;
            }
            self.pos = pos;
            return Some(SrcsetCandidate {
                url: &input[url_start..url_end],
                descriptors: b"",
            });
        }

        while pos < input.len() && input[pos].is_ascii_whitespace() {
            pos += 1;
        }
        let descriptors_start = pos;
        let mut in_parens = false;
        while pos < input.len() {
            match input[pos] {
                b'(' if !in_parens => in_parens = true,
                b')' if in_parens => in_parens = false,
                b',' if !in_parens => break,
                _ => {}
            }
            pos += 1;
        }
        let mut descriptors_end = pos;
        while descriptors_end > descriptors_start
            && input[descriptors_end - 1].is_ascii_whitespace()
        {
            descriptors_end -= 1;
        }
        // Step past the comma that ended this candidate, if any.
        self.pos = (pos + 1).min(input.len());

        Some(SrcsetCandidate {
            url: &input[url_start..url_end],
            descriptors: &input[descriptors_start..descriptors_end],
        })
    }
}

/// Trait capturing the methods `HTMLProcessor` calls on `T`.
pub(crate) trait HTMLProcessorHandler {
    /// Once per URL (per candidate for `srcset`); `HTMLLoader` pairs the Nth call with the Nth record.
    fn on_url(&mut self, path: &[u8], kind: ImportKind) -> UrlAction<'_>;
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
    fn on_url(&mut self, path: &[u8], kind: ImportKind) -> UrlAction<'_> {
        HTMLScanner::on_url(self, path, kind)
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
    /// The attribute holds a `srcset`-style candidate list, not one URL.
    pub(crate) srcset: bool,
}

impl TagHandler {
    const fn new(selector: &'static str, url_attribute: &'static str, kind: ImportKind) -> Self {
        Self {
            selector,
            url_attribute,
            kind,
            srcset: false,
        }
    }

    const fn srcset(selector: &'static str, url_attribute: &'static str) -> Self {
        Self {
            selector,
            url_attribute,
            kind: ImportKind::Url,
            srcset: true,
        }
    }
}

const TAG_HANDLERS: [TagHandler; 17] = [
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
    // Responsive image preloads
    TagHandler::srcset("link[as='image'][imagesrcset]", "imagesrcset"),
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
    TagHandler::srcset("img[srcset]", "srcset"),
    // Videos with src
    TagHandler::new("video[src]", "src", ImportKind::Url),
    // Videos with poster
    TagHandler::new("video[poster]", "poster", ImportKind::Url),
    // Audio with src
    TagHandler::new("audio[src]", "src", ImportKind::Url),
    // Source elements with src
    TagHandler::new("source[src]", "src", ImportKind::Url),
    // Source elements with srcset
    TagHandler::srcset("source[srcset]", "srcset"),
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

/// `value` is bundler-generated, so a non-UTF-8 one is a bug like a bad `name`.
fn set_attribute(element: &mut Element<'_, '_>, name: &str, value: &[u8]) {
    let ok = match core::str::from_utf8(value) {
        Ok(value) => element.set_attribute(name, value).is_ok(),
        Err(_) => false,
    };
    if !ok {
        panic!("unexpected error from Element.setAttribute");
    }
}

fn rewrite_tag<T: HTMLProcessorHandler>(
    this: &mut T,
    element: &mut Element<'_, '_>,
    tag_info: TagHandler,
    value: &[u8],
) {
    if tag_info.srcset {
        rewrite_srcset(this, element, tag_info, value);
        return;
    }
    match this.on_url(value, tag_info.kind) {
        UrlAction::Keep => {}
        UrlAction::Replace(url) => set_attribute(element, tag_info.url_attribute, url),
        UrlAction::Remove => element.remove(),
    }
}

/// Rebuilds the list as `url[ descriptors], ...` when `on_url` changes any candidate.
fn rewrite_srcset<T: HTMLProcessorHandler>(
    this: &mut T,
    element: &mut Element<'_, '_>,
    tag_info: TagHandler,
    value: &[u8],
) {
    let mut rebuilt: Vec<u8> = Vec::new();
    let mut changed = false;
    for candidate in SrcsetCandidates::new(value) {
        let url = match this.on_url(candidate.url, tag_info.kind) {
            UrlAction::Keep => candidate.url,
            UrlAction::Replace(url) => {
                changed = true;
                url
            }
            UrlAction::Remove => {
                changed = true;
                continue;
            }
        };
        if !rebuilt.is_empty() {
            rebuilt.extend_from_slice(b", ");
        }
        rebuilt.extend_from_slice(url);
        if !candidate.descriptors.is_empty() {
            rebuilt.push(b' ');
            rebuilt.extend_from_slice(candidate.descriptors);
        }
    }
    if !changed {
        return;
    }
    if rebuilt.is_empty() {
        element.remove_attribute(tag_info.url_attribute);
    } else {
        set_attribute(element, tag_info.url_attribute, &rebuilt);
    }
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
                    let value = element
                        .get_attribute(tag_info.url_attribute)
                        .unwrap_or_default();
                    if !value.is_empty() {
                        bun_core::scoped_log!(HTMLScanner, "{} {}", tag_info.selector, value);
                        rewrite_tag(
                            // SAFETY: `this_ptr` was derived from `run`'s `&mut T`,
                            // which is not reborrowed while the rewriter — the only
                            // holder of these closures — is alive.
                            unsafe { &mut *this_ptr },
                            element,
                            tag_info,
                            value.as_bytes(),
                        );
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
                        // SAFETY: see the `TAG_HANDLERS` closure above.
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
            memory_settings: lol_html::MemorySettings {
                preallocated_parsing_buffer_size: (input.len() / 4).max(1024),
                max_allowed_memory_usage: 1024 * 1024 * 10,
            },
            strict: false,
            ..lol_html::Settings::new()
        };

        // lol-html signals end-of-document with one zero-length chunk; the
        // C-API sink routed that to a no-op `done()`, never to `on_write_html`.
        let output_sink = OutputSink::Callback(Box::new(move |chunk: &[u8]| {
            if !chunk.is_empty() {
                // SAFETY: see the `TAG_HANDLERS` closure above.
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
