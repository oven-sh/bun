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

/// The URLs the resolver marks external from their text alone.
pub(crate) fn is_external_url(url: &[u8]) -> bool {
    ["//", "http://", "https://", "data:"]
        .iter()
        .any(|prefix| url.starts_with(prefix.as_bytes()))
}

/// The `?query#fragment` of a local URL: `?v=2#icon` for `./sprite.svg?v=2#icon`, nothing for `https://x/y?z` or `#icon`.
pub(crate) fn url_suffix(url: &[u8]) -> &[u8] {
    match strings::index_of_any(url, b"?#") {
        Some(i) if i > 0 && !is_external_url(url) => &url[i..],
        _ => b"",
    }
}

/// Whether `url` goes to the resolver: not `#icon` or `?page=2`, nor an optional `mailto:`-like URL or `{{ template }}`.
fn is_followed(url: &[u8], optional: bool) -> bool {
    let has_scheme = || {
        url.iter()
            .position(|&c| !(c.is_ascii_alphanumeric() || matches!(c, b'+' | b'-' | b'.')))
            .is_some_and(|len| len >= 2 && url[len] == b':' && url[0].is_ascii_alphabetic())
    };
    !url.is_empty()
        && !matches!(url[0], b'#' | b'?')
        && !(optional
            && !is_external_url(url)
            && (has_scheme() || strings::index_of_any(url, b"{}<>").is_some()))
}

const HTML_WHITESPACE: &[u8] = b" \t\n\r\x0c";

/// Length of a `srcset` descriptor: up to the next comma outside `( )`.
fn descriptor_len(s: &[u8]) -> usize {
    let mut i = 0;
    while let Some(j) = strings::index_of_any(&s[i..], b",(") {
        if s[i + j] == b',' {
            return i + j;
        }
        match strings::index_of_char_usize(&s[i + j..], b')') {
            Some(k) => i += j + k + 1,
            None => break,
        }
    }
    s.len()
}

/// Byte ranges of the URLs in a `srcset`, per <https://html.spec.whatwg.org/multipage/images.html#parsing-a-srcset-attribute>.
struct SrcsetUrls<'a> {
    value: &'a [u8],
    pos: usize,
}

impl Iterator for SrcsetUrls<'_> {
    type Item = core::ops::Range<usize>;

    fn next(&mut self) -> Option<Self::Item> {
        let rest = strings::trim_left(&self.value[self.pos..], b" \t\n\r\x0c,");
        if rest.is_empty() {
            return None;
        }
        let start = self.value.len() - rest.len();
        let url_end = strings::index_of_any(rest, HTML_WHITESPACE).unwrap_or(rest.len());
        let url_len = strings::trim_right(&rest[..url_end], b",").len();
        // A URL that ends in a comma has no descriptor.
        let end = if url_len < url_end {
            url_end
        } else {
            url_end + descriptor_len(&rest[url_end..])
        };
        self.pos = start + end;
        Some(start..start + url_len)
    }
}

impl<'a> HTMLScanner<'a> {
    fn create_import_record(
        &mut self,
        url: &[u8],
        kind: ImportKind,
        optional: bool,
    ) -> Result<(), Error> {
        // The resolver retries without `?query#fragment` for assets and stylesheets only; a bundled script has no use for its `?v=3`.
        let input_path = match strings::index_of_char_usize(url, b'?') {
            Some(query) if kind == ImportKind::Stmt && !is_external_url(url) => &url[..query],
            _ => url,
        };
        // In HTML, sometimes people do /src/index.js
        // In that case, we don't want to use the absolute filesystem path, we want to use the path relative to the project root
        let path_to_use: &[u8] = if is_external_url(url) {
            // `//cdn.example.com/x.png` is a host, not a project-root path.
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
            // Not found: `resolve_import_records` warns and leaves the URL as written.
            flags: if optional {
                ImportRecordFlags::HANDLES_IMPORT_ERRORS
            } else {
                ImportRecordFlags::default()
            },
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
pub(crate) enum UrlAction<'a> {
    Keep,
    Replace(Cow<'a, [u8]>),
    RemoveElement,
}

/// Trait capturing the methods `HTMLProcessor` calls on `T`.
pub(crate) trait HTMLProcessorHandler {
    /// Once per URL (per `srcset` candidate), in document order: one import record made or consumed per call.
    fn on_url(&mut self, url: &[u8], kind: ImportKind, optional: bool) -> UrlAction<'_>;
    /// Standalone HTML has every local file inline: a `<link rel="preload">` of one is dropped, and `<use>`, which cannot load a `data:` URL, keeps its URL.
    fn is_standalone_html(&self) -> bool {
        false
    }
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
    fn on_url(&mut self, url: &[u8], kind: ImportKind, optional: bool) -> UrlAction<'_> {
        let _ = self.create_import_record(url, kind, optional);
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

/// What the URL in a matched attribute is.
#[derive(Clone, Copy)]
enum UrlAttr {
    Script,
    /// A file that has to exist: not found is a build error.
    Asset,
    /// A file that may live elsewhere (`og:image`, `<object data>`): not found stays as written, with a warning.
    OptionalAsset,
    /// `OptionalAsset` that browsers do not load from a `data:` URL.
    SvgUse,
    /// Decided by `rel`, `as` and `type`.
    LinkHref,
    /// Decided by `property` and `name`.
    MetaContent,
}

/// One selector per element name: lol-html runs every compound selector on every start tag, so `rel`, `as` and `property` are checked in `UrlAttr::kind`.
const URL_ELEMENTS: &[(&str, &[(&str, UrlAttr)])] = &[
    // Keep docs/bundler/{loaders,html-static,standalone-html}.mdx and docs/runtime/file-types.mdx in step.
    ("script[src]", &[("src", UrlAttr::Script)]),
    (
        "link",
        &[
            ("href", UrlAttr::LinkHref),
            ("imagesrcset", UrlAttr::OptionalAsset),
        ],
    ),
    ("meta[content]", &[("content", UrlAttr::MetaContent)]),
    (
        "img",
        &[("src", UrlAttr::Asset), ("srcset", UrlAttr::Asset)],
    ),
    (
        "video",
        &[("src", UrlAttr::Asset), ("poster", UrlAttr::Asset)],
    ),
    ("audio[src]", &[("src", UrlAttr::Asset)]),
    (
        "source",
        &[("src", UrlAttr::Asset), ("srcset", UrlAttr::Asset)],
    ),
    ("track[src]", &[("src", UrlAttr::OptionalAsset)]),
    ("embed[src]", &[("src", UrlAttr::OptionalAsset)]),
    ("input[src]", &[("src", UrlAttr::OptionalAsset)]),
    ("object[data]", &[("data", UrlAttr::OptionalAsset)]),
    (
        "image",
        &[
            ("href", UrlAttr::OptionalAsset),
            ("xlink:href", UrlAttr::OptionalAsset),
        ],
    ),
    (
        "use",
        &[("href", UrlAttr::SvgUse), ("xlink:href", UrlAttr::SvgUse)],
    ),
];

/// The attributes of one start tag that decide what its URLs are.
#[derive(Default)]
struct UrlContext {
    rel: Option<String>,
    as_: Option<String>,
    type_: Option<String>,
    property: Option<String>,
    name: Option<String>,
}

fn is(value: &Option<String>, expected: &str) -> bool {
    value
        .as_deref()
        .is_some_and(|value| value.eq_ignore_ascii_case(expected))
}

impl UrlContext {
    fn rel_has(&self, token: &str) -> bool {
        self.rel.as_deref().is_some_and(|rel| {
            rel.split_ascii_whitespace()
                .any(|t| t.eq_ignore_ascii_case(token))
        })
    }

    /// `<link rel="preload|modulepreload">`: a hint to fetch early, not a use of the file.
    fn is_preload(&self) -> bool {
        self.rel_has("preload") || self.rel_has("modulepreload")
    }

    /// A preload of a script. No import record is made for it.
    fn is_script_preload(&self) -> bool {
        self.rel_has("modulepreload") || (self.rel_has("preload") && is(&self.as_, "script"))
    }
}

impl UrlAttr {
    /// The import kind, and whether the file is optional. `None`: not a URL this build follows.
    fn kind(self, c: &UrlContext) -> Option<(ImportKind, bool)> {
        const REQUIRED: bool = false;
        const OPTIONAL: bool = true;
        Some(match self {
            UrlAttr::Script => (ImportKind::Stmt, REQUIRED),
            UrlAttr::Asset => (ImportKind::Url, REQUIRED),
            UrlAttr::OptionalAsset | UrlAttr::SvgUse => (ImportKind::Url, OPTIONAL),
            UrlAttr::LinkHref => {
                let font = c.type_.as_deref().is_some_and(|t| {
                    t.get(..5)
                        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("font/"))
                });
                if is(&c.rel, "stylesheet") || is(&c.as_, "style") {
                    (ImportKind::At, REQUIRED)
                } else if is(&c.as_, "worker") {
                    (ImportKind::Stmt, REQUIRED)
                } else if font
                    || ["font", "image", "video", "audio"]
                        .iter()
                        .any(|as_| is(&c.as_, as_))
                    || ["manifest", "icon", "apple-touch-icon"]
                        .iter()
                        .any(|rel| is(&c.rel, rel))
                {
                    (ImportKind::Url, REQUIRED)
                } else if c.rel_has("icon")
                    || c.rel_has("mask-icon")
                    || c.rel_has("apple-touch-icon-precomposed")
                    || c.rel_has("apple-touch-startup-image")
                {
                    // The other icon rels, e.g. "shortcut icon".
                    (ImportKind::Url, OPTIONAL)
                } else {
                    return None;
                }
            }
            UrlAttr::MetaContent => {
                // The list Vite rewrites, less `msapplication-config`: its documented value `none` is not a URL.
                let image = [
                    "og:image",
                    "og:image:url",
                    "og:image:secure_url",
                    "og:audio",
                    "og:audio:secure_url",
                    "og:video",
                    "og:video:secure_url",
                ]
                .iter()
                .any(|property| is(&c.property, property))
                    || [
                        "twitter:image",
                        "msapplication-tileimage",
                        "msapplication-square70x70logo",
                        "msapplication-square150x150logo",
                        "msapplication-wide310x150logo",
                        "msapplication-square310x310logo",
                    ]
                    .iter()
                    .any(|name| is(&c.name, name));
                if !image {
                    return None;
                }
                (ImportKind::Url, OPTIONAL)
            }
        })
    }
}

const SELECTOR_CAP: usize = URL_ELEMENTS.len() + 3;

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

/// lol-html escapes only `"` on output, so entities in `value` pass through as written.
fn set_attribute(element: &mut Element<'_, '_>, name: &str, value: &[u8]) {
    let ok = match core::str::from_utf8(value) {
        Ok(value) => element.set_attribute(name, value).is_ok(),
        Err(_) => false,
    };
    if !ok {
        panic!("unexpected error from Element.setAttribute");
    }
}

/// Runs `on_url` for every URL in a `srcset` and splices the replacements into the value as written.
fn rewrite_srcset<T: HTMLProcessorHandler>(
    this: &mut T,
    value: &[u8],
    (kind, optional): (ImportKind, bool),
) -> UrlAction<'static> {
    let mut out = Vec::new();
    let mut copied = 0;
    let mut remove = false;
    // No early exit: every candidate reaches `on_url` so both passes stay in step.
    for url in (SrcsetUrls { value, pos: 0 }) {
        if !is_followed(&value[url.clone()], optional) {
            continue;
        }
        match this.on_url(&value[url.clone()], kind, optional) {
            UrlAction::Keep => {}
            UrlAction::Replace(new_url) => {
                out.extend_from_slice(&value[copied..url.start]);
                out.extend_from_slice(&new_url);
                copied = url.end;
            }
            UrlAction::RemoveElement => remove = true,
        }
    }
    if remove {
        UrlAction::RemoveElement
    } else if copied == 0 {
        UrlAction::Keep
    } else {
        out.extend_from_slice(&value[copied..]);
        UrlAction::Replace(Cow::Owned(out))
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

        for &(selector, attrs) in URL_ELEMENTS {
            let on_element: lol_html::ElementHandler<'_> = Box::new(
                move |element: &mut Element<'_, '_>| -> lol_html::HandlerResult {
                    // One pass, and a URL is read only once it is wanted: lol-html allocates a String per name or value it returns.
                    let mut found: [Option<usize>; 2] = [None, None];
                    let mut context = UrlContext::default();
                    let wants_context =
                        matches!(attrs[0].1, UrlAttr::LinkHref | UrlAttr::MetaContent);
                    for (index, attribute) in element.attributes().iter().enumerate() {
                        let name = attribute.name();
                        // The first of a repeated attribute wins, as in a browser.
                        if let Some(i) = attrs.iter().position(|(attr, _)| *attr == name) {
                            found[i].get_or_insert(index);
                        } else if wants_context {
                            let slot = match name.as_str() {
                                "rel" => &mut context.rel,
                                "as" => &mut context.as_,
                                "type" => &mut context.type_,
                                "property" => &mut context.property,
                                "name" => &mut context.name,
                                _ => continue,
                            };
                            slot.get_or_insert_with(|| attribute.value());
                        }
                    }

                    // SAFETY: `this_ptr` was derived from `run`'s `&mut T`,
                    // which is not reborrowed while the rewriter — the only
                    // holder of these closures — is alive.
                    let standalone = unsafe { (*this_ptr).is_standalone_html() };
                    // Standalone HTML has the page's scripts inline, so a preload of a local one points at nothing.
                    let mut remove = standalone
                        && context.is_script_preload()
                        && found[0].is_some_and(|href| {
                            let href = element.attributes()[href].value();
                            let href = strings::trim(href.as_bytes(), HTML_WHITESPACE);
                            is_followed(href, true) && !is_external_url(href)
                        });
                    for (&(attr, url_attr), index) in attrs.iter().zip(found) {
                        let (Some(index), Some(kind)) = (index, url_attr.kind(&context)) else {
                            continue;
                        };
                        let value = element.attributes()[index].value();
                        bun_core::scoped_log!(HTMLScanner, "{} {}={}", selector, attr, value);
                        let action = if attr.ends_with("srcset") {
                            // SAFETY: as for `is_standalone_html` above.
                            rewrite_srcset(unsafe { &mut *this_ptr }, value.as_bytes(), kind)
                        } else {
                            match strings::trim(value.as_bytes(), HTML_WHITESPACE) {
                                url if !is_followed(url, kind.1) => UrlAction::Keep,
                                // SAFETY: as for `is_standalone_html` above.
                                url => unsafe { (*this_ptr).on_url(url, kind.0, kind.1) },
                            }
                        };
                        match action {
                            UrlAction::Keep => {}
                            // The file is inline now, so a preload of it points at nothing.
                            UrlAction::Replace(_) if standalone && context.is_preload() => {
                                remove = true
                            }
                            UrlAction::Replace(_)
                                if standalone && matches!(url_attr, UrlAttr::SvgUse) => {}
                            UrlAction::Replace(new_value) => {
                                set_attribute(element, attr, &new_value)
                            }
                            UrlAction::RemoveElement => remove = true,
                        }
                    }
                    if remove {
                        element.remove();
                    }
                    Ok(())
                },
            );
            element_content_handlers.push(element_entry(selector, on_element)?);
        }

        if VISIT_DOCUMENT_TAGS {
            for (which, tag) in ["body", "head", "html"].into_iter().enumerate() {
                let on_element: lol_html::ElementHandler<'_> = Box::new(
                    move |element: &mut Element<'_, '_>| -> lol_html::HandlerResult {
                        // SAFETY: see the URL element handler above.
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
                // SAFETY: see the URL element handler above.
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
