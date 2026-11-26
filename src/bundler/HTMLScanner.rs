use core::marker::PhantomData;
use std::borrow::Cow;

use crate::Error;
use crate::bun_fs as fs;
use bun_alloc::AstAlloc;
use bun_ast::{ImportKind, ImportRecord, ImportRecordFlags, ImportRecordTag, Index as AstIndex};
use bun_ast::{Loc, Log, Range, Source};
use bun_core::strings;
use bun_paths::Path;
use bun_paths::fs::Path as FsPath;
use bun_sys as sys;

/// The single `lol_html::OutputSink` type every Bun `HtmlRewriter` is built
/// with (here and in `HTMLRewriter`), so lol_html's rewriter/tokenizer
/// machinery is instantiated once rather than once per sink closure type.
pub enum OutputSink<'a> {
    /// `HTMLRewriter`'s response pipe: every chunk is appended to its staging
    /// buffer (statically dispatched — this is the throughput-sensitive user).
    /// The pipe owns the rewriter that owns this sink, so the back-reference
    /// invariant holds structurally.
    Buffer(bun_ptr::BackRef<OutputBuffer>),
    /// The bundler's HTML scanner.
    Callback(Box<dyn FnMut(&[u8]) + 'a>),
}

#[derive(Default)]
pub struct OutputBuffer {
    pub bytes: bun_ptr::JsCell<Vec<u8>>,
    /// There was no memory for a chunk. What was held and what follows is dropped.
    pub is_incomplete: core::cell::Cell<bool>,
}

impl OutputBuffer {
    #[inline]
    fn append(&self, chunk: &[u8]) {
        self.bytes.with_mut(|bytes| {
            if chunk.len() <= bytes.capacity() - bytes.len() || self.grow(bytes, chunk.len()) {
                bytes.extend_from_slice(chunk);
            }
        });
    }

    #[cold]
    #[inline(never)]
    fn grow(&self, bytes: &mut Vec<u8>, additional: usize) -> bool {
        if self.is_incomplete.get() || bytes.try_reserve(additional).is_err() {
            *bytes = Vec::new();
            self.is_incomplete.set(true);
        }
        !self.is_incomplete.get()
    }
}

impl lol_html::OutputSink for OutputSink<'_> {
    #[inline]
    fn handle_chunk(&mut self, chunk: &[u8]) {
        match self {
            OutputSink::Buffer(buffer) => buffer.append(chunk),
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

/// The character reference at the start of `text` and its length. A number that names no character reads as U+FFFD.
fn char_ref(text: &[u8]) -> Option<(char, usize)> {
    const NAMED: [(&[u8], char); 5] = [
        (b"&amp;", '&'),
        (b"&lt;", '<'),
        (b"&gt;", '>'),
        (b"&quot;", '"'),
        (b"&apos;", '\''),
    ];
    if let Some((name, c)) = NAMED.iter().find(|(name, _)| text.starts_with(name)) {
        return Some((*c, name.len()));
    }
    let (radix, digits_at) = match text {
        [b'&', b'#', b'x' | b'X', ..] => (16, 3),
        [b'&', b'#', ..] => (10, 2),
        _ => return None,
    };
    let mut code_point = Some(0u32);
    let mut end = digits_at;
    while let Some(digit) = text.get(end).and_then(|&d| char::from(d).to_digit(radix)) {
        code_point = code_point.and_then(|value| value.checked_mul(radix)?.checked_add(digit));
        end += 1;
    }
    if end == digits_at || text.get(end) != Some(&b';') {
        return None;
    }
    let c = code_point
        .and_then(char::from_u32)
        .unwrap_or(char::REPLACEMENT_CHARACTER);
    Some((c, end + 1))
}

/// Where the `?query#fragment` of an attribute value starts. The `#` of a character reference such as `&#38;` does not start it.
fn url_suffix_index(value: &[u8]) -> usize {
    let mut at = 0;
    while let Some(next) = strings::index_of_any(&value[at..], b"?#&") {
        at += next;
        match char_ref(&value[at..]) {
            Some((_, len)) => at += len,
            None if value[at] == b'&' => at += 1,
            None => return at,
        }
    }
    value.len()
}

/// The file name that the path of a URL spells. `None` keeps the path as written: a malformed escape, bytes that are not UTF-8, a decoded scheme (`data%3Ax`), or a decoded byte that the output URL, which is the raw file name, cannot carry as itself.
fn decode_path(path: &[u8]) -> Option<Vec<u8>> {
    let mut decoded = Vec::with_capacity(path.len());
    let mut rest = path;
    while let Some(next) = strings::index_of_any(rest, b"&%") {
        decoded.extend_from_slice(&rest[..next]);
        rest = &rest[next..];
        let (c, len, is_usable) = match rest[0] {
            b'%' => {
                let byte = bun_core::fmt::hex_pair_value(*rest.get(1)?, *rest.get(2)?)?;
                (char::from(byte), 3, !byte.is_ascii_control())
            }
            _ => match char_ref(rest) {
                Some((c, len)) => (c, len, !c.is_control() && c != char::REPLACEMENT_CHARACTER),
                None => {
                    decoded.push(b'&');
                    rest = &rest[1..];
                    continue;
                }
            },
        };
        if !is_usable || matches!(c, '#' | '?' | '%' | '/' | '\\' | '"') {
            return None;
        }
        if rest[0] == b'%' {
            decoded.push(c as u8);
        } else {
            decoded.extend_from_slice(c.encode_utf8(&mut [0; 4]).as_bytes());
        }
        rest = &rest[len..];
    }
    if rest.len() == path.len() {
        return None;
    }
    decoded.extend_from_slice(rest);
    // The output name goes into the attribute as it is, so a name that still spells a character reference would be read as another name.
    let mut from = 0;
    while let Some(ampersand) = strings::index_of_char_usize(&decoded[from..], b'&') {
        from += ampersand + 1;
        let name = &decoded[from..];
        let len = name
            .iter()
            .take_while(|b| b.is_ascii_alphanumeric())
            .count();
        if name.first() == Some(&b'#') || (len > 0 && name.get(len) == Some(&b';')) {
            return None;
        }
    }
    let first_segment = strings::index_of_char_usize(&decoded, b'/').unwrap_or(decoded.len());
    (strings::is_valid_utf8(&decoded) && !strings::contains_char(&decoded[..first_segment], b':'))
        .then_some(decoded)
}

impl<'a> HTMLScanner<'a> {
    fn create_import_record(
        &mut self,
        written: &[u8],
        url_attribute: &[u8],
        kind: ImportKind,
    ) -> Result<(), Error> {
        // In the path of a URL `\` is a separator.
        let (url_path, rest) = written.split_at(url_suffix_index(written));
        let has_scheme =
            strings::index_of_any(url_path, b":/\\").is_some_and(|at| url_path[at] == b':');
        let is_url_path = !has_scheme && bun_paths::volume(written).is_empty();
        // A `srcset` is a list of URLs, and `//host/file` names no local file.
        let decoded = if is_url_path && url_attribute != b"srcset" && !written.starts_with(b"//") {
            decode_path(url_path)
        } else {
            None
        };
        let url_path = decoded.as_deref().unwrap_or(url_path);
        let with_slashes = match strings::replace_char(url_path, b'\\', b'/') {
            Cow::Owned(converted) if is_url_path => Cow::Owned([&converted, rest].concat()),
            _ if decoded.is_some() => Cow::Owned([url_path, rest].concat()),
            _ => Cow::Borrowed(written),
        };
        let input_path: &[u8] = &with_slashes;
        // In HTML, sometimes people do /src/index.js
        // In that case, we don't want to use the absolute filesystem path, we want to use the path relative to the project root
        let mut resolved;
        let path_to_use: &[u8] = if input_path.len() > 1 && input_path[0] == b'/' {
            resolved = Path::resolve(&[fs::FileSystem::get().top_level_dir(), &input_path[1..]]);
            resolved.copy_trailing_sep_from(input_path);
            &resolved
        }
        // Check if imports to (e.g) "App.tsx" are actually relative imoprts w/o the "./"
        else if written.len() > 2 && written[0] != b'.' && written[1] != b'/' {
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
                let dirname = bun_paths::dirname_or_root(self.source.path.text());
                if !bun_paths::is_absolute(dirname) {
                    break 'blk input_path;
                }
                resolved = Path::resolve(&[dirname, input_path]);
                resolved.copy_trailing_sep_from(input_path);
                if sys::exists_z(&resolved) {
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

    fn on_tag(
        &mut self,
        _element: &mut Element<'_, '_>,
        path: &[u8],
        url_attribute: &[u8],
        kind: ImportKind,
    ) {
        let _ = self.create_import_record(path, url_attribute, kind);
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
