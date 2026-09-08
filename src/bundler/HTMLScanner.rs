use core::marker::PhantomData;
use std::borrow::Cow;

use crate::Error;
use crate::bun_fs as fs;
use bun_alloc::AstAlloc;
use bun_ast::{ImportKind, ImportRecord, ImportRecordFlags, ImportRecordTag, Index as AstIndex};
use bun_ast::{Loc, Log, Range, Source};
use bun_core::strings;
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

/// True for `//host/...` and `scheme:...` (two or more scheme characters, so
/// not a Windows drive letter). Neither names a local file; the resolver marks
/// them external (or inlines a `data:` module) from the text as written.
pub(crate) fn is_external_url(url: &[u8]) -> bool {
    url.starts_with(b"//")
        || url
            .iter()
            .position(|&c| !(c.is_ascii_alphanumeric() || matches!(c, b'+' | b'-' | b'.')))
            .is_some_and(|len| len >= 2 && url[len] == b':' && url[0].is_ascii_alphabetic())
}

/// Splits `./sprite.svg?v=2#icon` into `./sprite.svg` and `?v=2#icon`.
pub(crate) fn split_url_suffix(url: &[u8]) -> (&[u8], &[u8]) {
    url.split_at(strings::index_of_any(url, b"?#").unwrap_or(url.len()))
}

const HTML_WHITESPACE: &[u8] = b" \t\n\r\x0c";

/// Yields each `srcset` image candidate as `(url, descriptor)`:
/// `"./a.png, ./b.png 2x"` gives `("./a.png", "")`, `("./b.png", "2x")`.
/// <https://html.spec.whatwg.org/multipage/images.html#parsing-a-srcset-attribute>
struct SrcsetCandidates<'a>(&'a [u8]);

impl<'a> Iterator for SrcsetCandidates<'a> {
    type Item = (&'a [u8], &'a [u8]);

    fn next(&mut self) -> Option<Self::Item> {
        let rest = strings::trim_left(self.0, b" \t\n\r\x0c,");
        if rest.is_empty() {
            return None;
        }
        // The URL runs to the first whitespace; a comma right before that
        // whitespace (or the end) ends the candidate with no descriptor.
        let url_end = strings::index_of_any(rest, HTML_WHITESPACE).unwrap_or(rest.len());
        let url = strings::trim_right(&rest[..url_end], b",");
        let desc_end = if url.len() < url_end {
            url_end
        } else {
            url_end
                + strings::index_of_char_usize(&rest[url_end..], b',')
                    .unwrap_or(rest.len() - url_end)
        };
        self.0 = &rest[desc_end..];
        Some((
            url,
            strings::trim(&rest[url_end..desc_end], HTML_WHITESPACE),
        ))
    }
}

impl<'a> HTMLScanner<'a> {
    fn create_import_record(&mut self, url: &[u8], kind: ImportKind) -> Result<(), Error> {
        let external = is_external_url(url);
        // The browser requests the file without `?query#fragment`; the
        // rewrite pass appends it back from the attribute text.
        let input_path = if external {
            url
        } else {
            split_url_suffix(url).0
        };
        // In HTML, sometimes people do /src/index.js
        // In that case, we don't want to use the absolute filesystem path, we want to use the path relative to the project root
        let path_to_use: &[u8] = if external {
            url
        } else if input_path.len() > 1 && input_path[0] == b'/' {
            resolve_path::join_abs_string::<platform::Auto>(
                fs::FileSystem::instance().top_level_dir,
                &[&input_path[1..]],
            )
        }
        // Check if imports to (e.g) "App.tsx" are actually relative imoprts w/o the "./"
        else if input_path.len() > 2 && input_path[0] != b'.' && input_path[1] != b'/' {
            'blk: {
                let Some(index_of_dot) = strings::last_index_of_char(input_path, b'.') else {
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

    pub(crate) fn scan(&mut self, input: &[u8]) -> Result<(), Error> {
        Processor::run(self, input)
    }
}

type Processor<'a> = HTMLProcessor<HTMLScanner<'a>, false>;

// ───────────────────────────────────────────────────────────────────────────
// HTMLProcessor — generic over visitor `T` and `VISIT_DOCUMENT_TAGS`
// ───────────────────────────────────────────────────────────────────────────

/// What `HTMLProcessor` does with a URL after `on_url` returns.
pub(crate) enum UrlAction {
    Keep,
    Replace(Vec<u8>),
    RemoveElement,
}

/// Trait capturing the methods `HTMLProcessor` calls on `T`.
pub(crate) trait HTMLProcessorHandler {
    /// Called once per URL in a matched attribute, in document order: once
    /// for `src`/`href`, once per image candidate for `srcset`. The scan pass
    /// creates one import record per call and the rewrite pass consumes one,
    /// so both passes must see the same calls.
    fn on_url(&mut self, url: &[u8], kind: ImportKind) -> UrlAction;
    fn on_write_html(&mut self, bytes: &[u8]);
    fn on_html_parse_error(&mut self, message: &[u8]);

    /// `<link rel="preload|modulepreload|prefetch" href>`, before `on_url`
    /// sees its `href`.
    fn on_resource_hint(&mut self, _element: &mut Element<'_, '_>) {}

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
    fn on_url(&mut self, url: &[u8], kind: ImportKind) -> UrlAction {
        let _ = self.create_import_record(url, kind);
        UrlAction::Keep
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

/// Keep `docs/bundler/html-static.mdx` and `docs/bundler/standalone-html.mdx`
/// in sync with this list.
const TAG_HANDLERS: &[TagHandler] = &[
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
    TagHandler::new("link[imagesrcset]", "imagesrcset", ImportKind::Url),
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
    // Icons and splash screens: "icon", "shortcut icon", "apple-touch-icon(-precomposed)", ...
    TagHandler::new(
        "link[rel~='icon'][href], link[rel^='apple-touch-'][href], link[rel='mask-icon'][href]",
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
    // Text tracks, plugins, image buttons
    TagHandler::new("track[src], embed[src], input[src]", "src", ImportKind::Url),
    TagHandler::new("object[data]", "data", ImportKind::Url),
    // SVG
    TagHandler::new("image[href], use[href]", "href", ImportKind::Url),
    TagHandler::new(
        "image[xlink\\:href], use[xlink\\:href]",
        "xlink:href",
        ImportKind::Url,
    ),
    // Social and tile images (the Open Graph and <meta name> values Vite also rewrites)
    TagHandler::new(
        "meta[property='og:image' i][content], meta[property='og:image:url' i][content], \
         meta[property='og:image:secure_url' i][content], meta[property='og:audio' i][content], \
         meta[property='og:audio:secure_url' i][content], meta[property='og:video' i][content], \
         meta[property='og:video:secure_url' i][content], meta[name='twitter:image' i][content], \
         meta[name^='msapplication-' i][name$='logo' i][content], \
         meta[name='msapplication-tileimage' i][content], meta[name='msapplication-config' i][content]",
        "content",
        ImportKind::Url,
    ),
    //     // Iframes
    //     TagHandler::new("iframe[src]", "src", ImportKind::Url),
];

/// `<link>` hints whose local target is inlined or absent in the output.
const RESOURCE_HINT_SELECTOR: &str =
    "link[rel~='preload'][href], link[rel~='modulepreload'][href], link[rel~='prefetch'][href]";

const SELECTOR_CAP: usize = TAG_HANDLERS.len() + 4;

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

/// lol-html escapes only `"` when it serializes the value, so entities in
/// `value` pass through as written.
fn set_attribute(element: &mut Element<'_, '_>, name: &str, value: &[u8]) {
    let ok = match core::str::from_utf8(value) {
        Ok(value) => element.set_attribute(name, value).is_ok(),
        Err(_) => false,
    };
    if !ok {
        panic!("unexpected error from Element.setAttribute");
    }
}

/// Runs `on_url` for each image candidate in a `srcset` and rebuilds the list.
fn rewrite_srcset<T: HTMLProcessorHandler>(
    this: &mut T,
    value: &[u8],
    kind: ImportKind,
) -> UrlAction {
    let mut out = Vec::with_capacity(value.len());
    let (mut changed, mut remove) = (false, false);
    // Every candidate goes through `on_url`, even after one asks for removal,
    // so the rewrite pass consumes as many import records as the scan made.
    for (url, descriptor) in SrcsetCandidates(value) {
        if !out.is_empty() {
            out.extend_from_slice(b", ");
        }
        match this.on_url(url, kind) {
            UrlAction::Keep => out.extend_from_slice(url),
            UrlAction::Replace(new_url) => {
                changed = true;
                out.extend_from_slice(&new_url);
            }
            UrlAction::RemoveElement => remove = true,
        }
        if !descriptor.is_empty() {
            out.push(b' ');
            out.extend_from_slice(descriptor);
        }
    }
    if remove {
        UrlAction::RemoveElement
    } else if changed {
        UrlAction::Replace(out)
    } else {
        UrlAction::Keep
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

        // Registered first: lol-html runs handlers in registration order, and
        // this one must read `href` before a `TAG_HANDLERS` entry rewrites it.
        element_content_handlers.push(element_entry(
            RESOURCE_HINT_SELECTOR,
            Box::new(
                move |element: &mut Element<'_, '_>| -> lol_html::HandlerResult {
                    // SAFETY: `this_ptr` was derived from `run`'s `&mut T`,
                    // which is not reborrowed while the rewriter — the only
                    // holder of these closures — is alive.
                    unsafe { (*this_ptr).on_resource_hint(element) };
                    Ok(())
                },
            ),
        )?);

        for &tag_info in TAG_HANDLERS {
            let on_element: lol_html::ElementHandler<'_> = Box::new(
                move |element: &mut Element<'_, '_>| -> lol_html::HandlerResult {
                    let value = element
                        .get_attribute(tag_info.url_attribute)
                        .unwrap_or_default();
                    bun_core::scoped_log!(HTMLScanner, "{} {}", tag_info.selector, value);
                    let action = if tag_info.url_attribute.ends_with("srcset") {
                        // SAFETY: see `on_resource_hint` above.
                        rewrite_srcset(unsafe { &mut *this_ptr }, value.as_bytes(), tag_info.kind)
                    } else {
                        match strings::trim(value.as_bytes(), HTML_WHITESPACE) {
                            b"" => UrlAction::Keep,
                            // SAFETY: see `on_resource_hint` above.
                            url => unsafe { (*this_ptr).on_url(url, tag_info.kind) },
                        }
                    };
                    match action {
                        UrlAction::Keep => {}
                        UrlAction::Replace(new_value) => {
                            set_attribute(element, tag_info.url_attribute, &new_value)
                        }
                        UrlAction::RemoveElement => element.remove(),
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
                        // SAFETY: see `on_resource_hint` above.
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
                // SAFETY: see `on_resource_hint` above.
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
