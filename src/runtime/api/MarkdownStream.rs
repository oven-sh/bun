//! `Bun.markdown.{html,ansi,render,react,tokens}Stream()`.

use core::cell::Cell;
use core::sync::atomic::{AtomicUsize, Ordering};

use bun_core::strings;
use bun_jsc::bindgen::{JsHeap, JsPayload as _, JsScope, JsWrapper, StringOrJsBytes};
use bun_jsc::{ErrorCode, JSGlobalObject, JSValue, JsResult, MarkedArgumentBuffer, bun_string_jsc};
use bun_md::parser::ParserError;
use bun_md::root as md;
use bun_md::stream::{Part, Pass, Stream};

use super::{
    Callbacks, Components, JsCallbackRenderer, ParseRenderer, ansi_theme, parser_err_to_js,
    react_version, token_options, tokens_to_js,
};
use crate::generated_bindgen::markdown_object::{
    AnsiTheme, Autolinks, ComponentOverrides, Headings, MarkdownOptions, ReactOptions,
    RenderCallbacks, js_MarkdownStream,
};

pub(crate) struct MarkdownStream {
    status: Cell<Status>,
    returns_arrays: bool,
    /// `write` or `end` has been called by something else than the transform.
    is_called_directly: Cell<bool>,
    size: AtomicUsize,
}

enum Status {
    Open(Box<Document>),
    /// A member has the document, and can run JavaScript.
    Rendering,
    Closed,
}

struct Document {
    stream: Stream,
    format: Format,
    /// The end of the last string, whose other half can be the start of the next.
    lead_surrogate: Option<u16>,
}

enum Format {
    Html,
    Ansi(md::ansi::AnsiStream<'static>),
    Callbacks,
    React { version: u8 },
    Tokens,
}

pub(crate) fn html<'a>(
    cx: &mut JsScope<'a>,
    options: Option<&MarkdownOptions>,
) -> JsResult<JSValue> {
    let options = parser_options!(options);
    Ok(create(cx.global(), options, Format::Html, None))
}

pub(crate) fn ansi<'a>(cx: &mut JsScope<'a>, theme: &AnsiTheme) -> JsResult<JSValue> {
    let format = Format::Ansi(md::ansi::AnsiStream::new(ansi_theme(theme)));
    Ok(create(cx.global(), md::Options::TERMINAL, format, None))
}

pub(crate) fn render<'a>(
    cx: &mut JsScope<'a>,
    callbacks: Option<&RenderCallbacks<'a>>,
    options: Option<&MarkdownOptions>,
) -> JsResult<JSValue> {
    let global = cx.global();
    let callbacks = Callbacks::new(callbacks).to_array(global)?;
    let options = parser_options!(options);
    Ok(create(global, options, Format::Callbacks, Some(callbacks)))
}

pub(crate) fn react<'a>(
    cx: &mut JsScope<'a>,
    components: Option<&ComponentOverrides<'a>>,
    options: Option<&ReactOptions>,
) -> JsResult<JSValue> {
    let global = cx.global();
    let components = Components::new(components).to_array(global)?;
    let version = react_version(options);
    let options = parser_options!(options);
    Ok(create(
        global,
        options,
        Format::React { version },
        Some(components),
    ))
}

pub(crate) fn tokens<'a>(
    cx: &mut JsScope<'a>,
    options: Option<&MarkdownOptions>,
) -> JsResult<JSValue> {
    let options = token_options(options);
    Ok(create(cx.global(), options, Format::Tokens, None))
}

fn create(
    global: &JSGlobalObject,
    options: md::Options,
    format: Format,
    overrides: Option<JSValue>,
) -> JSValue {
    let this_value = MarkdownStream {
        returns_arrays: matches!(format, Format::React { .. } | Format::Tokens),
        status: Cell::new(Status::Open(Box::new(Document {
            stream: Stream::new(options),
            format,
            lead_surrogate: None,
        }))),
        is_called_directly: Cell::new(false),
        size: AtomicUsize::new(size_of::<Document>()),
    }
    .into_js_wrapper(global)
    .to_js();
    if let Some(overrides) = overrides {
        js_MarkdownStream::overrides_set_cached(this_value, global, overrides);
    }
    this_value
}

impl MarkdownStream {
    pub(crate) fn estimated_size(&self) -> usize {
        self.size.load(Ordering::Relaxed)
    }

    pub(crate) fn write<'a>(
        &self,
        this_value: JsWrapper<'a, Self>,
        cx: &mut JsScope<'a>,
        chunk: StringOrJsBytes<'a>,
    ) -> JsResult<JSValue> {
        self.advance(this_value, cx, Some(chunk), Part::Finished)
    }

    pub(crate) fn preview<'a>(
        &self,
        this_value: JsWrapper<'a, Self>,
        cx: &mut JsScope<'a>,
    ) -> JsResult<JSValue> {
        self.advance(this_value, cx, None, Part::Preview)
    }

    pub(crate) fn end<'a>(
        &self,
        this_value: JsWrapper<'a, Self>,
        cx: &mut JsScope<'a>,
        chunk: Option<StringOrJsBytes<'a>>,
    ) -> JsResult<JSValue> {
        self.advance(this_value, cx, chunk, Part::Rest)
    }

    pub(crate) fn get_readable<'a>(
        &self,
        this_value: JsWrapper<'a, Self>,
        cx: &mut JsScope<'a>,
    ) -> JsResult<JSValue> {
        js_MarkdownStream::readable_side(
            this_value.to_js(),
            cx.global(),
            self.is_called_directly.get(),
        )
    }

    pub(crate) fn get_writable<'a>(
        &self,
        this_value: JsWrapper<'a, Self>,
        cx: &mut JsScope<'a>,
    ) -> JsResult<JSValue> {
        js_MarkdownStream::writable_side(
            this_value.to_js(),
            cx.global(),
            self.is_called_directly.get(),
        )
    }

    /// The transform is done, cancelled or has failed.
    pub(crate) fn release(&self) -> bool {
        self.size.store(0, Ordering::Relaxed);
        !matches!(self.status.replace(Status::Closed), Status::Rendering)
    }

    fn close(&self, this_value: JsWrapper<'_, Self>, global: &JSGlobalObject) {
        self.status.set(Status::Closed);
        self.size.store(0, Ordering::Relaxed);
        js_MarkdownStream::overrides_set_cached(this_value.to_js(), global, JSValue::ZERO);
        js_MarkdownStream::kept_set_cached(this_value.to_js(), global, JSValue::ZERO);
    }

    fn advance<'a>(
        &self,
        this_value: JsWrapper<'a, Self>,
        cx: &mut JsScope<'a>,
        chunk: Option<StringOrJsBytes<'a>>,
        part: Part,
    ) -> JsResult<JSValue> {
        let mut document = match self.status.replace(Status::Rendering) {
            Status::Open(document) => document,
            unusable => {
                let message = match unusable {
                    Status::Rendering => "A markdown stream cannot be used by its own callbacks",
                    _ => "The markdown stream has ended",
                };
                let is_closed = matches!(unusable, Status::Closed);
                self.status.set(unusable);
                if is_closed && part == Part::Preview {
                    return self.nothing(cx.global());
                }
                let message = format_args!("{message}");
                return Err(cx.global().err(ErrorCode::INVALID_STATE, message).throw());
            }
        };

        if part != Part::Preview && !self.is_called_directly.get() {
            match js_MarkdownStream::detach_unless_piping(this_value.to_js(), cx.global()) {
                Ok(detached) => self.is_called_directly.set(detached == JSValue::TRUE),
                Err(err) => {
                    self.status.set(Status::Open(document));
                    return Err(err);
                }
            }
        }

        let pushed = document.push(&cx.heap, chunk, part);
        let global = cx.global();
        let result = match pushed {
            Ok(()) => document.render(global, this_value.to_js(), part),
            Err((err, len)) => Err(parser_err_to_js(global, err, len)),
        };

        // What was rendered before an error is lost, so there is a hole in whatever would follow.
        let has_failed = part == Part::Finished && result.is_err();
        let was_released = matches!(self.status.replace(Status::Closed), Status::Closed);
        if part == Part::Rest || has_failed || was_released {
            self.close(this_value, global);
        } else {
            if result.is_err() {
                document.stream.forget_kept();
            }
            if !document.stream.has_kept() {
                js_MarkdownStream::kept_set_cached(this_value.to_js(), global, JSValue::ZERO);
            }
            document.stream.release_rendered_text();
            let size = size_of::<Document>() + document.stream.memory_cost();
            self.status.set(Status::Open(document));
            let before = self.size.load(Ordering::Relaxed);
            self.size.store(size, Ordering::Relaxed);
            if size > before && result.is_ok() {
                cx.heap
                    .report_extra_memory(this_value.as_value(), size - before);
            }
        }

        match result? {
            Some(rendered) => Ok(rendered),
            None => self.nothing(cx.global()),
        }
    }

    fn nothing(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        match self.returns_arrays {
            true => JSValue::create_empty_array(global, 0),
            false => Ok(JSValue::js_empty_string(global)),
        }
    }
}

impl Document {
    /// An error comes with the length that the text would have had.
    fn push<'a>(
        &mut self,
        heap: &JsHeap<'a>,
        chunk: Option<StringOrJsBytes<'a>>,
        part: Part,
    ) -> Result<(), (ParserError, usize)> {
        match chunk {
            Some(StringOrJsBytes::String(string)) if string.is_utf16() => {
                self.push_utf16(string.utf16())?
            }
            Some(StringOrJsBytes::String(string)) => self.push_utf8(&string.to_utf8())?,
            Some(StringOrJsBytes::Bytes(bytes)) => self.push_utf8(bytes.get(heap))?,
            None => {}
        }
        match part {
            Part::Rest => self.give_up_on_surrogate(),
            _ => Ok(()),
        }
    }

    fn push_utf8(&mut self, bytes: &[u8]) -> Result<(), (ParserError, usize)> {
        if bytes.is_empty() {
            return Ok(());
        }
        self.give_up_on_surrogate()?;
        self.stream
            .push(bytes)
            .map_err(|err| (err, self.stream.text_len() + bytes.len()))
    }

    fn push_utf16(&mut self, mut units: &[u16]) -> Result<(), (ParserError, usize)> {
        if let (Some(lead), [trail, rest @ ..]) = (self.lead_surrogate, units)
            && strings::u16_is_trail(*trail)
        {
            self.lead_surrogate = None;
            self.transcode(&[lead, *trail])?;
            units = rest;
        }
        match units {
            [whole @ .., lead] if strings::u16_is_lead(*lead) => {
                self.transcode(whole)?;
                self.give_up_on_surrogate()?;
                self.lead_surrogate = Some(*lead);
                Ok(())
            }
            _ => self.transcode(units),
        }
    }

    fn transcode(&mut self, units: &[u16]) -> Result<(), (ParserError, usize)> {
        let utf8 = strings::to_utf8_list_with_type(Vec::new(), units)
            .map_err(|_| (ParserError::OutOfMemory, 0))?;
        self.push_utf8(&utf8)
    }

    fn give_up_on_surrogate(&mut self) -> Result<(), (ParserError, usize)> {
        match self.lead_surrogate.take() {
            Some(_) => self.push_utf8("\u{FFFD}".as_bytes()),
            None => Ok(()),
        }
    }

    fn render(
        &mut self,
        global: &JSGlobalObject,
        this_value: JSValue,
        part: Part,
    ) -> JsResult<Option<JSValue>> {
        let Some(pass) = self.stream.pass(part) else {
            return Ok(None);
        };
        self.format.render(global, this_value, pass).map(Some)
    }
}

impl Format {
    fn render(
        &mut self,
        global: &JSGlobalObject,
        this_value: JSValue,
        pass: Pass<'_>,
    ) -> JsResult<JSValue> {
        let text = pass.text();
        let throw = |err| parser_err_to_js(global, err, text.len());
        let overrides = || {
            js_MarkdownStream::overrides_get_cached(this_value).expect("set until the stream ends")
        };
        let uses_slots = pass.uses_slots();
        let kept = || match js_MarkdownStream::kept_get_cached(this_value) {
            Some(kept) => Ok(kept),
            None if !uses_slots => Ok(JSValue::ZERO),
            None => JSValue::create_empty_array(global, 0)
                .inspect(|&kept| js_MarkdownStream::kept_set_cached(this_value, global, kept)),
        };
        // The pass lends the renderer its own `HeadingIdTracker`.
        let heading_ids = false;
        match self {
            Format::Html => {
                let html = pass.render_to_html().map_err(throw)?;
                bun_string_jsc::create_utf8_for_js(global, &html)
            }
            Format::Ansi(ansi) => {
                let output = ansi.render(pass).map_err(throw)?;
                bun_string_jsc::create_utf8_for_js(global, &output)
            }
            Format::Callbacks => {
                let mut renderer = JsCallbackRenderer::init(global, text, heading_ids)?;
                renderer.callbacks = Callbacks::from_array(global, overrides())?;
                pass.render(&mut renderer).map_err(throw)?;
                bun_string_jsc::create_utf8_for_js(global, &renderer.into_result())
            }
            Format::React { version } => MarkedArgumentBuffer::new(|marked_args| {
                let mut renderer =
                    ParseRenderer::init(global, text, marked_args, heading_ids, Some(*version))
                        .map_err(|_| global.throw_out_of_memory())?;
                renderer.components = Components::from_array(global, overrides())?;
                renderer.kept = Some(kept()?);
                pass.render(&mut renderer).map_err(throw)?;
                Ok(renderer.get_result())
            }),
            Format::Tokens => {
                let tokens = pass.render_to_tokens().map_err(throw)?;
                // SAFETY: `text` is that of the pass.
                unsafe { tokens_to_js(global, &tokens, text.as_ptr(), kept()?) }
            }
        }
    }
}
