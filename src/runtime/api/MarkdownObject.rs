//! `Bun.markdown` — html/ansi/react/render host fns over `bun_md`.

use crate::generated_bindgen::markdown_object::{
    AnsiTheme, Autolinks, ComponentOverrides, Headings, MarkdownOptions, ReactOptions,
    RenderCallbacks,
};
use bun_core::StackCheck;
use bun_jsc::bindgen::{JsBytes, JsLocal, JsScope};
use bun_jsc::bun_string_jsc;
use bun_jsc::{
    JSGlobalObject, JSValue, JsResult, MarkedArgumentBuffer, PinnedArrayBuffer, RangeErrorOptions,
    StringJsc as _,
};
// Note: the `bun_md` crate's lib.rs is a
// thin mod-decl shim, so alias the `root` module (which re-exports BlockType,
// SpanType, TextType, SpanDetail, Renderer, helpers, types, ansi, …) as `md`.
use crate::node::StringOrBuffer;
use bun_md::parser::{MAX_INPUT_LEN, ParserError};
use bun_md::root as md;

#[inline]
fn js_array_push(arr: JSValue, global: &JSGlobalObject, item: JSValue) -> JsResult<()> {
    arr.push(global, item)
}

/// Map a host-fn `JsError` back into the parser's error enum so it can
/// bubble through `md::render_with_renderer` and be re-thrown at the top.
#[inline]
fn js_to_parser_err(e: bun_jsc::JsError) -> ParserError {
    match e {
        bun_jsc::JsError::Thrown | bun_jsc::JsError::Terminated => ParserError::JSError,
        bun_jsc::JsError::OutOfMemory => ParserError::OutOfMemory,
    }
}

/// Throw the JS exception for a `ParserError` returned by `bun_md`.
/// `input_len` is the byte length of the rendered input, reported back by the
/// `InputTooLarge` range error.
#[cold]
fn parser_err_to_js(
    global_this: &JSGlobalObject,
    err: ParserError,
    input_len: usize,
) -> bun_jsc::JsError {
    match err {
        // A renderer callback threw (or the VM is terminating); the exception
        // is already pending on the VM.
        ParserError::JSError => bun_jsc::JsError::Thrown,
        ParserError::OutOfMemory => global_this.throw_out_of_memory(),
        ParserError::StackOverflow => global_this.throw_stack_overflow(),
        ParserError::InputTooLarge => global_this.throw_range_error(
            input_len as i64,
            RangeErrorOptions {
                max: MAX_INPUT_LEN as i64,
                field_name: b"input.byteLength",
                ..Default::default()
            },
        ),
        // The document, not the input length, overflowed the parser's u32
        // block offsets, so an `input.byteLength` bound would be misleading.
        ParserError::TooManyBlocks => global_this
            .err(
                bun_jsc::ErrCode::OUT_OF_RANGE,
                format_args!(
                    "markdown input requires more block metadata than the parser can address (4 GiB)"
                ),
            )
            .throw(),
    }
}

/// `md::Options` of an `Option<&MarkdownOptions>` or an `Option<&ReactOptions>`, which have these members in common.
macro_rules! parser_options {
    ($given:expr) => {
        parser_options!(
            $given;
            tables,
            strikethrough,
            tasklists,
            hard_soft_breaks,
            wiki_links,
            underline,
            latex_math,
            collapse_whitespace,
            permissive_atx_headers,
            no_indented_code_blocks,
            no_html_blocks,
            no_html_spans,
            tag_filter
        )
    };
    ($given:expr; $($flag:ident),*) => {{
        let mut options = md::Options::default();
        if let Some(given) = $given {
            match &given.autolinks {
                Some(Autolinks::All(all)) => options.permissive_autolinks |= *all,
                Some(Autolinks::Each(each)) => {
                    if let Some(url) = each.url {
                        options.permissive_url_autolinks = url;
                    }
                    if let Some(www) = each.www {
                        options.permissive_www_autolinks = www;
                    }
                    if let Some(email) = each.email {
                        options.permissive_email_autolinks = email;
                    }
                }
                None => {}
            }
            match &given.headings {
                Some(Headings::All(all)) => {
                    options.heading_ids |= *all;
                    options.autolink_headings |= *all;
                }
                Some(Headings::Each(each)) => {
                    if let Some(ids) = each.ids {
                        options.heading_ids = ids;
                    }
                    if let Some(autolink) = each.autolink {
                        options.autolink_headings = autolink;
                    }
                }
                None => {}
            }
            $(
                if let Some(value) = given.$flag {
                    options.$flag = value;
                }
            )*
        }
        options
    }};
}

/// Pins a buffer input for the render, which can re-enter JS; `None` for a string. Replaces `input` with a copy if a
/// pin doesn't keep its bytes: JS can free them, or there is no `ArrayBuffer` to pin yet and `.buffer` makes an unpinned one.
fn pin(
    global: &JSGlobalObject,
    input: &mut StringOrBuffer<'static>,
) -> JsResult<Option<PinnedArrayBuffer>> {
    let StringOrBuffer::Buffer(buffer) = input else {
        return Ok(None);
    };
    let Some(pinned) = PinnedArrayBuffer::pin(global, buffer.buffer.value) else {
        return Err(global.throw_out_of_memory());
    };
    if pinned.is_detached() || (pinned.pinned && !pinned.can_be_freed_while_pinned()) {
        return Ok(Some(pinned));
    }
    let Some(copy) = pinned.try_copy_bytes() else {
        return Err(global.throw_out_of_memory());
    };
    *input = StringOrBuffer::owned(copy);
    Ok(None)
}

/// `bun:internal-for-testing`'s `setMaxMarkdownBlockBytesForTesting(limit)`:
/// shrink the parser's block-metadata cap so its `TooManyBlocks` error is
/// testable without 4 GiB of input. Returns the previous limit.
pub(crate) fn set_max_markdown_block_bytes_for_testing(limit: f64) -> usize {
    bun_md::parser::set_max_block_bytes_for_testing(limit as usize)
}

/// `Bun.markdown.ansi(text, theme?)` — render markdown to an ANSI-colored
/// terminal string. By default colors are enabled, hyperlinks are
/// disabled (the caller doesn't know if stdout is a TTY), and columns is 80.
pub(crate) fn ansi<'a>(
    cx: &mut JsScope<'a>,
    input: JsBytes<'a>,
    theme: &AnsiTheme,
) -> JsResult<Box<[u8]>> {
    let theme = md::AnsiTheme {
        colors: theme.colors.unwrap_or(true),
        hyperlinks: theme.hyperlinks.unwrap_or(false),
        kitty_graphics: theme.kitty_graphics.unwrap_or(false),
        light: theme.light.unwrap_or_else(md::detect_light_background),
        columns: theme.columns.map_or(80, |columns| columns as u16),
        remote_image_paths: None,
        image_base_dir: None,
    };

    let input = input.get(&cx.heap);
    let input_len = input.len();
    match md::render_to_ansi(input, md::Options::TERMINAL, theme) {
        Ok(Some(r)) => Ok(r),
        Ok(None) => {
            // The parser can only return null via JSError
            // from a renderer callback; the ANSI renderer has none, so this
            // path is unreachable but handle it safely.
            Err(cx.global().throw_out_of_memory())
        }
        Err(err) => Err(parser_err_to_js(cx.global(), err, input_len)),
    }
}

pub(crate) fn html<'a>(
    cx: &mut JsScope<'a>,
    input: JsBytes<'a>,
    options: Option<&MarkdownOptions>,
) -> JsResult<Box<[u8]>> {
    let input = input.get(&cx.heap);
    let input_len = input.len();
    md::render_to_html_with_options(input, parser_options!(options))
        .map_err(|err| parser_err_to_js(cx.global(), err, input_len))
}

/// `Bun.markdown.render(text, callbacks, options?)` — render markdown with custom callbacks.
///
/// Each callback receives the accumulated children as a string plus an optional
/// metadata object, and returns a string. The final result is the concatenation
/// of all callback outputs.
pub(crate) fn render<'a>(
    cx: &mut JsScope<'a>,
    input: JsLocal<'a>,
    callbacks: Option<&RenderCallbacks<'a>>,
    options: Option<&MarkdownOptions>,
) -> JsResult<Vec<u8>> {
    let global_this = cx.global();
    let input_value = input.to_js();

    if input_value.is_empty_or_undefined_or_null() {
        return Err(global_this
            .throw_invalid_arguments(format_args!("Expected a string or buffer to render")));
    }

    let Some(mut buffer) = StringOrBuffer::from_js_stable(global_this, input_value)? else {
        return Err(global_this
            .throw_invalid_arguments(format_args!("Expected a string or buffer to render")));
    };

    let pinned = pin(global_this, &mut buffer)?;
    let input: &[u8] = match &pinned {
        Some(p) => p.slice(),
        None => buffer.slice(),
    };

    let options = parser_options!(options);

    // Create JS callback renderer
    let mut js_renderer = match JsCallbackRenderer::init(global_this, input, options.heading_ids) {
        Ok(r) => r,
        Err(_) => return Err(global_this.throw_out_of_memory()),
    };

    if let Some(callbacks) = callbacks {
        js_renderer.extract_callbacks(callbacks);
    }

    // Run parser with the JS callback renderer
    if let Err(err) = md::render_with_renderer(input, options, js_renderer.renderer()) {
        return Err(parser_err_to_js(global_this, err, input.len()));
    }

    Ok(js_renderer.into_result())
}

/// `Bun.markdown.react(text, components?, options?)` — returns a React Fragment element
/// containing the parsed markdown as children.
// The closure scopes a MarkedArgumentBuffer around the impl so every JSValue it
// accumulates stays GC-visible for the duration of the call.
pub(crate) fn react<'a>(
    cx: &mut JsScope<'a>,
    input: JsLocal<'a>,
    components: Option<&ComponentOverrides<'a>>,
    options: Option<&ReactOptions>,
) -> JsResult<JSValue> {
    let global_this = cx.global();
    let react_version: u8 = match options.and_then(|options| options.react_version) {
        // react.element (React 18 and older)
        Some(version) if version as i32 <= 18 => 0,
        // react.transitional.element (React 19+)
        _ => 1,
    };
    MarkedArgumentBuffer::new(|marked_args| {
        let children = render_ast(
            global_this,
            input.to_js(),
            components,
            parser_options!(options),
            marked_args,
            Some(react_version),
        )?;
        let fragment = JSReactElement__createFragment(global_this, react_version, children);
        marked_args.append(fragment);
        Ok(fragment)
    })
}

unsafe extern "C" {
    safe fn JSReactElement__createFragment(
        global_object: &JSGlobalObject,
        react_version: u8,
        children: JSValue,
    ) -> JSValue;
}

fn render_ast(
    global_this: &JSGlobalObject,
    input_value: JSValue,
    components: Option<&ComponentOverrides<'_>>,
    options: md::Options,
    marked_args: &mut MarkedArgumentBuffer,
    react_version: Option<u8>,
) -> JsResult<JSValue> {
    if input_value.is_empty_or_undefined_or_null() {
        return Err(global_this
            .throw_invalid_arguments(format_args!("Expected a string or buffer to render")));
    }

    let Some(mut buffer) = StringOrBuffer::from_js_stable(global_this, input_value)? else {
        return Err(global_this
            .throw_invalid_arguments(format_args!("Expected a string or buffer to render")));
    };

    let pinned = pin(global_this, &mut buffer)?;
    let input: &[u8] = match &pinned {
        Some(p) => p.slice(),
        None => buffer.slice(),
    };

    let mut renderer = match ParseRenderer::init(
        global_this,
        input,
        marked_args,
        options.heading_ids,
        react_version,
    ) {
        Ok(r) => r,
        Err(_) => return Err(global_this.throw_out_of_memory()),
    };

    if let Some(components) = components {
        renderer.extract_components(components);
    }

    if let Err(err) = md::render_with_renderer(input, options, renderer.renderer()) {
        return Err(parser_err_to_js(global_this, err, input.len()));
    }

    Ok(renderer.get_result())
}

/// Renderer that builds an object AST from markdown.
///
/// In plain mode (`react_version == None`), each element becomes:
/// `{ type: "tagName", props: { ...metadata, children: [...] } }`
///
/// In React mode (`react_version != None`), each element becomes a valid React element
/// created via a cached JSC Structure with putDirectOffset:
/// `{ $$typeof: Symbol.for('react.element'), type: "tagName", key: null, ref: null, props: { ...metadata, children: [...] } }`
///
/// Uses HTML tag names (h1-h6, p, blockquote, a, em, strong, etc.).
/// Text content is plain JS strings in children arrays.
struct ParseRenderer<'a> {
    global_object: &'a JSGlobalObject,
    marked_args: &'a mut MarkedArgumentBuffer,
    // Note: JSValue in Vec is safe here — every entry.children is also appended to self.marked_args (GC root).
    stack: Vec<ParseStackEntry>,
    stack_check: StackCheck,
    src_text: &'a [u8],
    heading_tracker: md::helpers::HeadingIdTracker,
    components: Components,
    react_version: Option<u8>,
}

unsafe extern "C" {
    safe fn JSReactElement__create(
        global_object: &JSGlobalObject,
        react_version: u8,
        element_type: JSValue,
        props: JSValue,
    ) -> JSValue;
}

/// Component overrides keyed by HTML tag name.
/// When set, the value replaces the string tag name in the `type` field.
#[derive(Default)]
struct Components {
    h1: JSValue,
    h2: JSValue,
    h3: JSValue,
    h4: JSValue,
    h5: JSValue,
    h6: JSValue,
    p: JSValue,
    blockquote: JSValue,
    ul: JSValue,
    ol: JSValue,
    li: JSValue,
    pre: JSValue,
    hr: JSValue,
    html: JSValue,
    table: JSValue,
    thead: JSValue,
    tbody: JSValue,
    tr: JSValue,
    th: JSValue,
    td: JSValue,
    em: JSValue,
    strong: JSValue,
    a: JSValue,
    img: JSValue,
    code: JSValue,
    del: JSValue,
    math: JSValue,
    u: JSValue,
    br: JSValue,
}
// Note: `Default` for JSValue must be `JSValue::ZERO` (encoded 0).

struct ParseStackEntry {
    children: JSValue,
    data: u32,
    flags: u32,
    // Owned copies of the span detail: reference-style links hand us
    // slices into temporaries that drop before `leave_span` runs.
    href: Box<[u8]>,
    title: Box<[u8]>,
}

impl Default for ParseStackEntry {
    fn default() -> Self {
        Self {
            children: JSValue::ZERO,
            data: 0,
            flags: 0,
            href: Box::default(),
            title: Box::default(),
        }
    }
}

// Note: the `bun_md` `Renderer` is `&mut dyn RendererImpl`, so the trait
// already gives us `&mut self` — the `*_impl` bodies below are plain methods,
// no pointer round-trip needed.
impl<'a> md::types::RendererImpl for ParseRenderer<'a> {
    fn enter_block(
        &mut self,
        block_type: md::BlockType,
        data: u32,
        flags: u32,
    ) -> md::types::JsResult<()> {
        self.enter_block_impl(block_type, data, flags)
            .map_err(js_to_parser_err)
    }
    fn leave_block(&mut self, block_type: md::BlockType, data: u32) -> md::types::JsResult<()> {
        self.leave_block_impl(block_type, data)
            .map_err(js_to_parser_err)
    }
    fn enter_span(
        &mut self,
        span_type: md::SpanType,
        detail: md::SpanDetail<'_>,
    ) -> md::types::JsResult<()> {
        self.enter_span_impl(span_type, detail)
            .map_err(js_to_parser_err)
    }
    fn leave_span(&mut self, span_type: md::SpanType) -> md::types::JsResult<()> {
        self.leave_span_impl(span_type).map_err(js_to_parser_err)
    }
    fn text(&mut self, text_type: md::TextType, content: &[u8]) -> md::types::JsResult<()> {
        self.text_impl(text_type, content).map_err(js_to_parser_err)
    }
}

impl<'a> ParseRenderer<'a> {
    fn init(
        global_object: &'a JSGlobalObject,
        src_text: &'a [u8],
        marked_args: &'a mut MarkedArgumentBuffer,
        heading_ids: bool,
        react_version: Option<u8>,
    ) -> Result<ParseRenderer<'a>, bun_alloc::AllocError> {
        let mut self_ = ParseRenderer {
            global_object,
            marked_args,
            stack: Vec::new(),
            stack_check: StackCheck::init(),
            src_text,
            heading_tracker: md::helpers::HeadingIdTracker::init(heading_ids),
            components: Components::default(),
            react_version,
        };
        // Root entry — its children array becomes the return value
        let root_array =
            JSValue::create_empty_array(global_object, 0).map_err(|_| bun_alloc::AllocError)?;
        self_.marked_args.append(root_array);
        self_.stack.push(ParseStackEntry {
            children: root_array,
            ..Default::default()
        });
        Ok(self_)
    }

    // Note: deinit() dropped — Vec<ParseStackEntry> and HeadingIdTracker free via Drop.

    /// Any non-boolean value (function, class, string, etc.) keyed by an HTML tag name is stored
    /// and used as the `type` field instead of the default string tag name.
    fn extract_components(&mut self, components: &ComponentOverrides<'_>) {
        macro_rules! extract {
            ($($name:ident),* $(,)?) => {$(
                if let Some(val) = components.$name.map(JsLocal::to_js) {
                    if !val.is_boolean() {
                        self.components.$name = val;
                        self.marked_args.append(val);
                    }
                }
            )*};
        }
        extract!(
            h1, h2, h3, h4, h5, h6, p, blockquote, ul, ol, li, pre, hr, html, table, thead, tbody,
            tr, th, td, em, strong, a, img, code, del, math, u, br,
        );
    }

    fn get_block_component(&self, block_type: md::BlockType, data: u32) -> JSValue {
        match block_type {
            md::BlockType::H => match data {
                1 => self.components.h1,
                2 => self.components.h2,
                3 => self.components.h3,
                4 => self.components.h4,
                5 => self.components.h5,
                _ => self.components.h6,
            },
            md::BlockType::P => self.components.p,
            md::BlockType::Quote => self.components.blockquote,
            md::BlockType::Ul => self.components.ul,
            md::BlockType::Ol => self.components.ol,
            md::BlockType::Li => self.components.li,
            md::BlockType::Code => self.components.pre,
            md::BlockType::Hr => self.components.hr,
            md::BlockType::Html => self.components.html,
            md::BlockType::Table => self.components.table,
            md::BlockType::Thead => self.components.thead,
            md::BlockType::Tbody => self.components.tbody,
            md::BlockType::Tr => self.components.tr,
            md::BlockType::Th => self.components.th,
            md::BlockType::Td => self.components.td,
            md::BlockType::Doc => JSValue::ZERO,
        }
    }

    fn get_span_component(&self, span_type: md::SpanType) -> JSValue {
        match span_type {
            md::SpanType::Em => self.components.em,
            md::SpanType::Strong => self.components.strong,
            md::SpanType::A => self.components.a,
            md::SpanType::Img => self.components.img,
            md::SpanType::Code => self.components.code,
            md::SpanType::Del => self.components.del,
            md::SpanType::Latexmath | md::SpanType::LatexmathDisplay => self.components.math,
            md::SpanType::Wikilink => self.components.a,
            md::SpanType::U => self.components.u,
        }
    }

    fn renderer(&mut self) -> md::Renderer<'_> {
        md::Renderer { ptr: self }
    }

    fn get_result(&self) -> JSValue {
        if self.stack.is_empty() {
            return JSValue::UNDEFINED;
        }
        self.stack[0].children
    }

    /// Creates an element node. In React mode, uses the C++ fast path with
    /// a cached Structure and putDirectOffset. In plain mode, creates a
    /// simple `{ type, props }` object.
    fn create_element(&mut self, type_val: JSValue, props: JSValue) -> JSValue {
        if let Some(version) = self.react_version {
            let obj = JSReactElement__create(self.global_object, version, type_val, props);
            self.marked_args.append(obj);
            obj
        } else {
            let obj = JSValue::create_empty_object(self.global_object, 2);
            self.marked_args.append(obj);
            obj.put(self.global_object, b"type", type_val);
            obj.put(self.global_object, b"props", props);
            obj
        }
    }

    // ========================================
    // Block callbacks
    // ========================================

    fn enter_block_impl(
        &mut self,
        block_type: md::BlockType,
        data: u32,
        flags: u32,
    ) -> JsResult<()> {
        if !self.stack_check.is_safe_to_recurse() {
            return Err(self.global_object.throw_stack_overflow());
        }
        if block_type == md::BlockType::Doc {
            return Ok(());
        }

        if block_type == md::BlockType::H {
            self.heading_tracker.enter_heading();
        }

        let array = JSValue::create_empty_array(self.global_object, 0)?;
        self.marked_args.append(array);
        self.stack.push(ParseStackEntry {
            children: array,
            data,
            flags,
            ..Default::default()
        });
        Ok(())
    }

    fn leave_block_impl(&mut self, block_type: md::BlockType, _: u32) -> JsResult<()> {
        if !self.stack_check.is_safe_to_recurse() {
            return Err(self.global_object.throw_stack_overflow());
        }
        if block_type == md::BlockType::Doc {
            return Ok(());
        }

        if self.stack.len() <= 1 {
            return Ok(());
        }
        let entry = self.stack.pop().unwrap();
        let g = self.global_object;

        // Determine HTML tag index for cached string
        let tag_index = get_block_type_tag(block_type, entry.data);

        // For headings, compute slug before counting props
        // Note: own the slug bytes — leave_heading() borrows the tracker mutably,
        // and we need self again below for get_block_component().
        let slug: Option<Vec<u8>> = if block_type == md::BlockType::H {
            self.heading_tracker.leave_heading().map(|s| s.to_vec())
        } else {
            None
        };

        // Count props fields
        let mut props_count: usize = if block_type == md::BlockType::Hr {
            0
        } else {
            1
        }; // children
        match block_type {
            md::BlockType::H => {
                if slug.is_some() {
                    props_count += 1;
                }
            }
            md::BlockType::Ol => props_count += 1, // start
            md::BlockType::Li => {
                let task_mark = md::types::task_mark_from_data(entry.data);
                if task_mark != 0 {
                    props_count += 1;
                }
            }
            md::BlockType::Code => {
                if entry.flags & md::BLOCK_FENCED_CODE != 0 {
                    let lang = extract_language(self.src_text, entry.data);
                    if !lang.is_empty() {
                        props_count += 1;
                    }
                }
            }
            md::BlockType::Th | md::BlockType::Td => {
                let alignment = md::types::alignment_from_data(entry.data);
                if alignment != md::types::Align::Default {
                    props_count += 1;
                }
            }
            _ => {}
        }

        // Build React element — use component override as type if set
        let component = self.get_block_component(block_type, entry.data);
        let type_val: JSValue = if !component.is_empty() {
            component
        } else {
            get_cached_tag_string(g, tag_index)
        };

        let props = JSValue::create_empty_object(g, props_count);
        self.marked_args.append(props);

        // Set metadata props
        match block_type {
            md::BlockType::H => {
                if let Some(s) = slug {
                    props.put(g, b"id", bun_string_jsc::create_utf8_for_js(g, &s)?);
                }
            }
            md::BlockType::Ol => {
                props.put(g, b"start", JSValue::js_number(entry.data as f64));
            }
            md::BlockType::Li => {
                let task_mark = md::types::task_mark_from_data(entry.data);
                if task_mark != 0 {
                    props.put(
                        g,
                        b"checked",
                        JSValue::from(md::types::is_task_checked(task_mark)),
                    );
                }
            }
            md::BlockType::Code => {
                if entry.flags & md::BLOCK_FENCED_CODE != 0 {
                    let lang = extract_language(self.src_text, entry.data);
                    if !lang.is_empty() {
                        props.put(g, b"language", bun_string_jsc::create_utf8_for_js(g, lang)?);
                    }
                }
            }
            md::BlockType::Th | md::BlockType::Td => {
                let alignment = md::types::alignment_from_data(entry.data);
                if let Some(align_str) = md::types::alignment_name(alignment) {
                    props.put(g, b"align", bun_core::String::static_(align_str).to_js(g)?);
                }
            }
            _ => {}
        }

        // Set children (skip for void elements)
        if block_type != md::BlockType::Hr {
            props.put(g, b"children", entry.children);
        }

        let obj = self.create_element(type_val, props);

        // Push to parent's children array
        if let Some(parent) = self.stack.last() {
            js_array_push(parent.children, g, obj)?;
        }

        if block_type == md::BlockType::H {
            self.heading_tracker.clear_after_heading();
        }
        Ok(())
    }

    // ========================================
    // Span callbacks
    // ========================================

    fn enter_span_impl(&mut self, _: md::SpanType, detail: md::SpanDetail<'_>) -> JsResult<()> {
        if !self.stack_check.is_safe_to_recurse() {
            return Err(self.global_object.throw_stack_overflow());
        }

        let array = JSValue::create_empty_array(self.global_object, 0)?;
        self.marked_args.append(array);
        self.stack.push(ParseStackEntry {
            children: array,
            href: Box::from(detail.href),
            title: Box::from(detail.title),
            ..Default::default()
        });
        Ok(())
    }

    fn leave_span_impl(&mut self, span_type: md::SpanType) -> JsResult<()> {
        if !self.stack_check.is_safe_to_recurse() {
            return Err(self.global_object.throw_stack_overflow());
        }

        if self.stack.len() <= 1 {
            return Ok(());
        }
        let entry = self.stack.pop().unwrap();
        let g = self.global_object;

        let tag_index = get_span_type_tag(span_type);

        // Count props fields: always children (or alt for img) + metadata
        let mut props_count: usize = 1; // children (or alt for img)
        match span_type {
            md::SpanType::A => {
                props_count += 1; // href
                if !entry.title.is_empty() {
                    props_count += 1;
                }
            }
            md::SpanType::Img => {
                props_count += 1; // src
                if !entry.title.is_empty() {
                    props_count += 1;
                }
            }
            md::SpanType::Wikilink => props_count += 1, // target
            md::SpanType::LatexmathDisplay => props_count += 1, // display
            _ => {}
        }

        // Build React element: { $$typeof, type, key, ref, props }
        let component = self.get_span_component(span_type);
        let type_val: JSValue = if !component.is_empty() {
            component
        } else {
            get_cached_tag_string(g, tag_index)
        };

        let props = JSValue::create_empty_object(g, props_count);
        self.marked_args.append(props);

        // Set metadata props
        match span_type {
            md::SpanType::A => {
                props.put(
                    g,
                    b"href",
                    bun_string_jsc::create_utf8_for_js(g, &entry.href)?,
                );
                if !entry.title.is_empty() {
                    props.put(
                        g,
                        b"title",
                        bun_string_jsc::create_utf8_for_js(g, &entry.title)?,
                    );
                }
            }
            md::SpanType::Img => {
                props.put(
                    g,
                    b"src",
                    bun_string_jsc::create_utf8_for_js(g, &entry.href)?,
                );
                if !entry.title.is_empty() {
                    props.put(
                        g,
                        b"title",
                        bun_string_jsc::create_utf8_for_js(g, &entry.title)?,
                    );
                }
            }
            md::SpanType::Wikilink => {
                props.put(
                    g,
                    b"target",
                    bun_string_jsc::create_utf8_for_js(g, &entry.href)?,
                );
            }
            md::SpanType::LatexmathDisplay => {
                props.put(g, b"display", JSValue::TRUE);
            }
            _ => {}
        }

        if span_type == md::SpanType::Img {
            // img is a void element — convert children to alt prop
            let len: u32 = entry.children.get_length(g)? as u32;
            if len == 1 {
                let child = entry.children.get_index(g, 0)?;
                if child.is_string() {
                    props.put(g, b"alt", child);
                }
            } else if len > 1 {
                // Multiple children — concatenate string parts
                let mut alt_buf: Vec<u8> = Vec::new();
                for i in 0..len {
                    let child = entry.children.get_index(g, i as u32)?;
                    if child.is_string() {
                        let str = child.to_utf8(g)?;
                        let _ = alt_buf.extend_from_slice(str.slice());
                    }
                }
                if !alt_buf.is_empty() {
                    props.put(g, b"alt", bun_string_jsc::create_utf8_for_js(g, &alt_buf)?);
                }
            }
        } else {
            props.put(g, b"children", entry.children);
        }

        let obj = self.create_element(type_val, props);

        // Push to parent's children array
        if let Some(parent) = self.stack.last() {
            js_array_push(parent.children, g, obj)?;
        }
        Ok(())
    }

    // ========================================
    // Text callback
    // ========================================

    fn text_impl(&mut self, text_type: md::TextType, content: &[u8]) -> JsResult<()> {
        if !self.stack_check.is_safe_to_recurse() {
            return Err(self.global_object.throw_stack_overflow());
        }

        let g = self.global_object;

        // Track plain text for slug generation when inside a heading
        self.heading_tracker.track_text(text_type, content);

        if self.stack.is_empty() {
            return Ok(());
        }
        // Note: reshaped for borrowck — capture parent.children (Copy JSValue) instead of holding &mut into self.stack.
        let parent_children = self.stack.last().unwrap().children;

        match text_type {
            md::TextType::Br => {
                let br_component = self.components.br;
                let br_type: JSValue = if !br_component.is_empty() {
                    br_component
                } else {
                    get_cached_tag_string(g, TagIndex::Br)
                };
                let empty_props = JSValue::create_empty_object(g, 0);
                self.marked_args.append(empty_props);
                let obj = self.create_element(br_type, empty_props);
                js_array_push(parent_children, g, obj)?;
            }
            md::TextType::Softbr => {
                let str = bun_core::String::static_("\n").to_js(g)?;
                self.marked_args.append(str);
                js_array_push(parent_children, g, str)?;
            }
            md::TextType::NullChar => {
                let str = bun_string_jsc::create_utf8_for_js(g, b"\xEF\xBF\xBD")?;
                self.marked_args.append(str);
                js_array_push(parent_children, g, str)?;
            }
            md::TextType::Entity => {
                let mut buf = [0u8; 8];
                let decoded =
                    md::helpers::decode_entity_to_utf8(content, &mut buf).unwrap_or(content);
                let str = bun_string_jsc::create_utf8_for_js(g, decoded)?;
                self.marked_args.append(str);
                js_array_push(parent_children, g, str)?;
            }
            _ => {
                let str = bun_string_jsc::create_utf8_for_js(g, content)?;
                self.marked_args.append(str);
                js_array_push(parent_children, g, str)?;
            }
        }
        Ok(())
    }
}

/// Renderer that calls JavaScript callbacks for each markdown element.
/// Only an element with a callback buffers its children; the rest write to the enclosing buffer.
struct JsCallbackRenderer<'a> {
    global_object: &'a JSGlobalObject,
    // Note: #allocator field dropped — global mimalloc.
    src_text: &'a [u8],
    stack: Vec<CallbackStackEntry>,
    /// Indices into `stack` of the entries that collect output, innermost last.
    collecting: Vec<usize>,
    /// Number of ul/ol entries on `stack`.
    list_depth: u32,
    callbacks: Callbacks,
    heading_tracker: md::helpers::HeadingIdTracker,
    stack_check: StackCheck,
}

#[derive(Default)]
struct Callbacks {
    heading: JSValue,
    paragraph: JSValue,
    blockquote: JSValue,
    code: JSValue,
    list: JSValue,
    list_item: JSValue,
    hr: JSValue,
    table: JSValue,
    thead: JSValue,
    tbody: JSValue,
    tr: JSValue,
    th: JSValue,
    td: JSValue,
    html: JSValue,
    strong: JSValue,
    emphasis: JSValue,
    link: JSValue,
    image: JSValue,
    codespan: JSValue,
    strikethrough: JSValue,
    text: JSValue,
}
// Note: `Default` for JSValue must be `JSValue::ZERO`.

struct CallbackStackEntry {
    buffer: Vec<u8>,
    block_type: md::BlockType,
    data: u32,
    flags: u32,
    /// For ul/ol: number of li children seen so far (next li's index).
    /// For li: this item's 0-based index within its parent list.
    child_index: u32,
    // Owned copies of the span detail: reference-style links hand us
    // slices into temporaries that drop before `leave_span` runs.
    href: Box<[u8]>,
    title: Box<[u8]>,
}

impl Default for CallbackStackEntry {
    fn default() -> Self {
        Self {
            buffer: Vec::new(),
            block_type: md::BlockType::Doc,
            data: 0,
            flags: 0,
            child_index: 0,
            href: Box::default(),
            title: Box::default(),
        }
    }
}

impl<'a> md::types::RendererImpl for JsCallbackRenderer<'a> {
    fn enter_block(
        &mut self,
        block_type: md::BlockType,
        data: u32,
        flags: u32,
    ) -> md::types::JsResult<()> {
        self.enter_block_impl(block_type, data, flags)
            .map_err(js_to_parser_err)
    }
    fn leave_block(&mut self, block_type: md::BlockType, data: u32) -> md::types::JsResult<()> {
        self.leave_block_impl(block_type, data)
            .map_err(js_to_parser_err)
    }
    fn enter_span(
        &mut self,
        span_type: md::SpanType,
        detail: md::SpanDetail<'_>,
    ) -> md::types::JsResult<()> {
        self.enter_span_impl(span_type, detail)
            .map_err(js_to_parser_err)
    }
    fn leave_span(&mut self, span_type: md::SpanType) -> md::types::JsResult<()> {
        self.leave_span_impl(span_type).map_err(js_to_parser_err)
    }
    fn text(&mut self, text_type: md::TextType, content: &[u8]) -> md::types::JsResult<()> {
        self.text_impl(text_type, content).map_err(js_to_parser_err)
    }
}

impl<'a> JsCallbackRenderer<'a> {
    fn init(
        global_object: &'a JSGlobalObject,
        src_text: &'a [u8],
        heading_ids: bool,
    ) -> Result<JsCallbackRenderer<'a>, bun_alloc::AllocError> {
        let mut self_ = JsCallbackRenderer {
            global_object,
            src_text,
            stack: Vec::new(),
            collecting: Vec::new(),
            list_depth: 0,
            callbacks: Callbacks::default(),
            heading_tracker: md::helpers::HeadingIdTracker::init(heading_ids),
            stack_check: StackCheck::init(),
        };
        self_.push_entry(CallbackStackEntry::default(), true);
        Ok(self_)
    }

    fn extract_callbacks(&mut self, callbacks: &RenderCallbacks<'_>) {
        macro_rules! extract {
            ($($field:ident),* $(,)?) => {$(
                if let Some(callback) = callbacks.$field {
                    self.callbacks.$field = callback.to_js();
                }
            )*};
        }
        extract!(
            heading,
            paragraph,
            blockquote,
            code,
            list,
            list_item,
            hr,
            table,
            thead,
            tbody,
            tr,
            th,
            td,
            html,
            strong,
            emphasis,
            link,
            image,
            codespan,
            strikethrough,
            text,
        );
    }

    // Note: deinit() dropped — Vec<CallbackStackEntry> (with Vec<u8> buffers) and HeadingIdTracker free via Drop.

    fn renderer(&mut self) -> md::Renderer<'_> {
        md::Renderer { ptr: self }
    }

    // ========================================
    // Content stack operations
    // ========================================

    fn push_entry(&mut self, entry: CallbackStackEntry, collects: bool) {
        if collects {
            self.collecting.push(self.stack.len());
        }
        if matches!(entry.block_type, md::BlockType::Ul | md::BlockType::Ol) {
            self.list_depth += 1;
        }
        self.stack.push(entry);
    }

    /// Never pops the root.
    fn pop_entry(&mut self) -> Option<CallbackStackEntry> {
        if self.stack.len() <= 1 {
            return None;
        }
        let entry = self.stack.pop()?;
        if self.collecting.last() == Some(&self.stack.len()) {
            self.collecting.pop();
        }
        if matches!(entry.block_type, md::BlockType::Ul | md::BlockType::Ol) {
            self.list_depth -= 1;
        }
        Some(entry)
    }

    fn append_output(&mut self, data: &[u8]) -> Result<(), bun_alloc::AllocError> {
        if let Some(&i) = self.collecting.last() {
            self.stack[i].buffer.extend_from_slice(data);
        }
        Ok(())
    }

    fn pop_and_callback(&mut self, callback: JSValue, meta: Option<JSValue>) -> JsResult<()> {
        let Some(entry) = self.pop_entry() else {
            return Ok(());
        };
        if callback.is_empty() {
            // Empty unless the parser's enter/leave events were unbalanced (#39496).
            self.append_output(&entry.buffer)?;
            return Ok(());
        }

        if !self.stack_check.is_safe_to_recurse() {
            return Err(self.global_object.throw_stack_overflow());
        }

        // Convert children to JS string
        let children_js =
            bun_string_jsc::create_utf8_for_js(self.global_object, entry.buffer.as_slice())?;

        // Call the JS callback
        let result = if let Some(m) = meta {
            callback.call(self.global_object, JSValue::UNDEFINED, &[children_js, m])?
        } else {
            callback.call(self.global_object, JSValue::UNDEFINED, &[children_js])?
        };

        if result.is_undefined_or_null() {
            return Ok(()); // callback returned null/undefined → omit element
        }
        let slice = result.to_utf8(self.global_object)?;
        self.append_output(slice.slice())?;
        Ok(())
    }

    fn into_result(self) -> Vec<u8> {
        self.stack
            .into_iter()
            .next()
            .map(|root| root.buffer)
            .unwrap_or_default()
    }

    // ========================================
    // RendererImpl bodies
    // ========================================

    fn enter_block_impl(
        &mut self,
        block_type: md::BlockType,
        data: u32,
        flags: u32,
    ) -> JsResult<()> {
        if !self.stack_check.is_safe_to_recurse() {
            return Err(self.global_object.throw_stack_overflow());
        }
        if block_type == md::BlockType::Doc {
            return Ok(());
        }
        if block_type == md::BlockType::H {
            self.heading_tracker.enter_heading();
        }

        // For li: record its 0-based index within the parent list, then
        // increment the parent's counter so the next sibling gets index+1.
        let mut child_index: u32 = 0;
        if block_type == md::BlockType::Li && !self.stack.is_empty() {
            let parent = self.stack.last_mut().unwrap();
            child_index = parent.child_index;
            parent.child_index += 1;
        }

        let collects = !self.get_block_callback(block_type).is_empty();
        self.push_entry(
            CallbackStackEntry {
                block_type,
                data,
                flags,
                child_index,
                ..Default::default()
            },
            collects,
        );
        Ok(())
    }

    fn leave_block_impl(&mut self, block_type: md::BlockType, _: u32) -> JsResult<()> {
        if !self.stack_check.is_safe_to_recurse() {
            return Err(self.global_object.throw_stack_overflow());
        }
        if block_type == md::BlockType::Doc {
            return Ok(());
        }

        let callback = self.get_block_callback(block_type);
        let meta = if callback.is_empty() {
            if block_type == md::BlockType::H {
                let _ = self.heading_tracker.leave_heading();
            }
            None
        } else {
            let (data, flags) = self
                .stack
                .last()
                .map_or((0, 0), |top| (top.data, top.flags));
            self.create_block_meta(block_type, data, flags)?
        };
        self.pop_and_callback(callback, meta)?;

        if block_type == md::BlockType::H {
            self.heading_tracker.clear_after_heading();
        }
        Ok(())
    }

    fn enter_span_impl(
        &mut self,
        span_type: md::SpanType,
        detail: md::SpanDetail<'_>,
    ) -> JsResult<()> {
        if !self.stack_check.is_safe_to_recurse() {
            return Err(self.global_object.throw_stack_overflow());
        }
        let collects = !self.get_span_callback(span_type).is_empty();
        let entry = if collects {
            CallbackStackEntry {
                href: Box::from(detail.href),
                title: Box::from(detail.title),
                ..Default::default()
            }
        } else {
            CallbackStackEntry::default()
        };
        self.push_entry(entry, collects);
        Ok(())
    }

    fn leave_span_impl(&mut self, span_type: md::SpanType) -> JsResult<()> {
        if !self.stack_check.is_safe_to_recurse() {
            return Err(self.global_object.throw_stack_overflow());
        }

        let callback = self.get_span_callback(span_type);
        let meta = match self.stack.last() {
            Some(top) if !callback.is_empty() => {
                self.create_span_meta(span_type, &top.href, &top.title)?
            }
            _ => None,
        };
        self.pop_and_callback(callback, meta)?;
        Ok(())
    }

    fn text_impl(&mut self, text_type: md::TextType, content: &[u8]) -> JsResult<()> {
        if !self.stack_check.is_safe_to_recurse() {
            return Err(self.global_object.throw_stack_overflow());
        }

        // Track plain text for slug generation when inside a heading
        self.heading_tracker.track_text(text_type, content);

        match text_type {
            md::TextType::NullChar => self.append_output(b"\xEF\xBF\xBD")?,
            md::TextType::Br => self.append_output(b"\n")?,
            md::TextType::Softbr => self.append_output(b"\n")?,
            md::TextType::Entity => self.decode_and_append_entity(content)?,
            _ => {
                if !self.callbacks.text.is_empty() {
                    self.call_text_callback(content)?;
                } else {
                    self.append_output(content)?;
                }
            }
        }
        Ok(())
    }

    // ========================================
    // Text helpers
    // ========================================

    fn call_text_callback(&mut self, content: &[u8]) -> JsResult<()> {
        if !self.stack_check.is_safe_to_recurse() {
            return Err(self.global_object.throw_stack_overflow());
        }
        let text_js = bun_string_jsc::create_utf8_for_js(self.global_object, content)?;
        let result =
            self.callbacks
                .text
                .call(self.global_object, JSValue::UNDEFINED, &[text_js])?;
        if !result.is_undefined_or_null() {
            let slice = result.to_utf8(self.global_object)?;
            self.append_output(slice.slice())?;
        }
        Ok(())
    }

    fn decode_and_append_entity(&mut self, entity_text: &[u8]) -> JsResult<()> {
        let mut buf = [0u8; 8];
        let decoded =
            md::helpers::decode_entity_to_utf8(entity_text, &mut buf).unwrap_or(entity_text);
        // Note: reshaped for borrowck — copy the (≤8-byte) decoded slice out of `buf`
        // before calling &mut self method, to avoid overlapping borrows when the
        // borrow checker tracks `buf` as borrowed by `decoded`.
        self.append_text_or_raw(decoded)
    }

    /// Append text through the text callback if one is set, otherwise raw append.
    fn append_text_or_raw(&mut self, content: &[u8]) -> JsResult<()> {
        if !self.callbacks.text.is_empty() {
            self.call_text_callback(content)
        } else {
            self.append_output(content)?;
            Ok(())
        }
    }

    // ========================================
    // Callback lookup
    // ========================================

    fn get_block_callback(&self, block_type: md::BlockType) -> JSValue {
        match block_type {
            md::BlockType::H => self.callbacks.heading,
            md::BlockType::P => self.callbacks.paragraph,
            md::BlockType::Quote => self.callbacks.blockquote,
            md::BlockType::Code => self.callbacks.code,
            md::BlockType::Ul | md::BlockType::Ol => self.callbacks.list,
            md::BlockType::Li => self.callbacks.list_item,
            md::BlockType::Hr => self.callbacks.hr,
            md::BlockType::Table => self.callbacks.table,
            md::BlockType::Thead => self.callbacks.thead,
            md::BlockType::Tbody => self.callbacks.tbody,
            md::BlockType::Tr => self.callbacks.tr,
            md::BlockType::Th => self.callbacks.th,
            md::BlockType::Td => self.callbacks.td,
            md::BlockType::Html => self.callbacks.html,
            md::BlockType::Doc => JSValue::ZERO,
        }
    }

    fn get_span_callback(&self, span_type: md::SpanType) -> JSValue {
        match span_type {
            md::SpanType::Em => self.callbacks.emphasis,
            md::SpanType::Strong => self.callbacks.strong,
            md::SpanType::A => self.callbacks.link,
            md::SpanType::Img => self.callbacks.image,
            md::SpanType::Code => self.callbacks.codespan,
            md::SpanType::Del => self.callbacks.strikethrough,
            _ => JSValue::ZERO,
        }
    }

    // ========================================
    // Metadata object creation
    // ========================================

    /// Returns the parent ul/ol entry for the current li (top of stack).
    /// Returns None if the stack shape is unexpected.
    fn parent_list(&self) -> Option<&CallbackStackEntry> {
        let len = self.stack.len();
        if len < 2 {
            return None;
        }
        let parent = &self.stack[len - 2];
        if parent.block_type == md::BlockType::Ul || parent.block_type == md::BlockType::Ol {
            return Some(parent);
        }
        None
    }

    fn create_block_meta(
        &mut self,
        block_type: md::BlockType,
        data: u32,
        flags: u32,
    ) -> JsResult<Option<JSValue>> {
        let g = self.global_object;
        match block_type {
            md::BlockType::H => {
                let slug = self.heading_tracker.leave_heading();
                let field_count: usize = if slug.is_some() { 2 } else { 1 };
                let obj = JSValue::create_empty_object(g, field_count);
                obj.put(g, b"level", JSValue::js_number(data as f64));
                if let Some(s) = slug {
                    obj.put(g, b"id", bun_string_jsc::create_utf8_for_js(g, s)?);
                }
                Ok(Some(obj))
            }
            md::BlockType::Ol => {
                // SAFETY: FFI into JSC bindings.
                Ok(Some(BunMarkdownMeta__createList(
                    g,
                    true,
                    JSValue::js_number(data as f64),
                    self.list_depth.saturating_sub(1),
                )))
            }
            md::BlockType::Ul => {
                // SAFETY: FFI into JSC bindings.
                Ok(Some(BunMarkdownMeta__createList(
                    g,
                    false,
                    JSValue::UNDEFINED,
                    self.list_depth.saturating_sub(1),
                )))
            }
            md::BlockType::Code => {
                if flags & md::BLOCK_FENCED_CODE != 0 {
                    let lang = extract_language(self.src_text, data);
                    if !lang.is_empty() {
                        let obj = JSValue::create_empty_object(g, 1);
                        obj.put(g, b"language", bun_string_jsc::create_utf8_for_js(g, lang)?);
                        return Ok(Some(obj));
                    }
                }
                Ok(None)
            }
            md::BlockType::Th | md::BlockType::Td => {
                let alignment = md::types::alignment_from_data(data);
                let align_js = if let Some(align_str) = md::types::alignment_name(alignment) {
                    bun_core::String::static_(align_str).to_js(g)?
                } else {
                    JSValue::UNDEFINED
                };
                // SAFETY: FFI into JSC bindings.
                Ok(Some(BunMarkdownMeta__createCell(g, align_js)))
            }
            md::BlockType::Li => {
                // The li entry is still on top of the stack; parent ul/ol is at len-2.
                let len = self.stack.len();
                let item_index = if len > 1 {
                    self.stack[len - 1].child_index
                } else {
                    0
                };
                let parent = self.parent_list();
                let is_ordered =
                    parent.is_some() && parent.unwrap().block_type == md::BlockType::Ol;
                // `list_depth` includes the immediate parent list; subtract it
                // so that items in a top-level list report depth 0.
                let depth = self.list_depth.saturating_sub(1);
                let task_mark = md::types::task_mark_from_data(data);

                let start_js = if is_ordered {
                    JSValue::js_number(parent.unwrap().data as f64)
                } else {
                    JSValue::UNDEFINED
                };
                let checked_js = if task_mark != 0 {
                    JSValue::from(md::types::is_task_checked(task_mark))
                } else {
                    JSValue::UNDEFINED
                };

                // SAFETY: FFI into JSC bindings.
                Ok(Some(BunMarkdownMeta__createListItem(
                    g, item_index, depth, is_ordered, start_js, checked_js,
                )))
            }
            _ => Ok(None),
        }
    }

    fn create_span_meta(
        &self,
        span_type: md::SpanType,
        href: &[u8],
        title: &[u8],
    ) -> JsResult<Option<JSValue>> {
        let g = self.global_object;
        match span_type {
            md::SpanType::A => {
                let href = bun_string_jsc::create_utf8_for_js(g, href)?;
                let title = if !title.is_empty() {
                    bun_string_jsc::create_utf8_for_js(g, title)?
                } else {
                    JSValue::UNDEFINED
                };
                // SAFETY: FFI into JSC bindings.
                Ok(Some(BunMarkdownMeta__createLink(g, href, title)))
            }
            md::SpanType::Img => {
                // Image meta shares shape with link (src/href are both the first
                // field). We use a separate cached structure would require a
                // second slot, so just fall back to the generic path here —
                // images are rare enough that it doesn't matter.
                let obj = JSValue::create_empty_object(g, 2);
                obj.put(g, b"src", bun_string_jsc::create_utf8_for_js(g, href)?);
                if !title.is_empty() {
                    obj.put(g, b"title", bun_string_jsc::create_utf8_for_js(g, title)?);
                }
                Ok(Some(obj))
            }
            _ => Ok(None),
        }
    }
}

/// Slice the language token out of a fenced-code info string.
fn extract_language(src_text: &[u8], info_beg: u32) -> &[u8] {
    let mut lang_end = info_beg;
    while (lang_end as usize) < src_text.len() {
        let c = src_text[lang_end as usize];
        if c == b' ' || c == b'\t' || c == b'\n' || c == b'\r' {
            break;
        }
        lang_end += 1;
    }
    if lang_end > info_beg {
        return &src_text[info_beg as usize..lang_end as usize];
    }
    b""
}

/// Cached tag string indices — must match `BunMarkdownTagStrings.h`.
#[repr(u8)]
#[derive(Copy, Clone)]
pub(crate) enum TagIndex {
    H1 = 0,
    H2 = 1,
    H3 = 2,
    H4 = 3,
    H5 = 4,
    H6 = 5,
    P = 6,
    Blockquote = 7,
    Ul = 8,
    Ol = 9,
    Li = 10,
    Pre = 11,
    Hr = 12,
    Html = 13,
    Table = 14,
    Thead = 15,
    Tbody = 16,
    Tr = 17,
    Th = 18,
    Td = 19,
    Div = 20,
    Em = 21,
    Strong = 22,
    A = 23,
    Img = 24,
    Code = 25,
    Del = 26,
    Math = 27,
    U = 28,
    Br = 29,
}

// `JSGlobalObject` is `#[repr(C)]` with `UnsafeCell<[u8; 0]>`, so `&JSGlobalObject`
// is ABI-identical to a non-null pointer; all other params are value types.
unsafe extern "C" {
    safe fn BunMarkdownTagStrings__getTagString(global: &JSGlobalObject, index: u8) -> JSValue;

    // Fast-path meta-object constructors using cached Structures (see
    // BunMarkdownMeta.cpp). Each constructs via putDirectOffset so the
    // resulting objects share a single Structure and stay monomorphic.
    safe fn BunMarkdownMeta__createListItem(
        global: &JSGlobalObject,
        index: u32,
        depth: u32,
        ordered: bool,
        start: JSValue,
        checked: JSValue,
    ) -> JSValue;
    safe fn BunMarkdownMeta__createList(
        global: &JSGlobalObject,
        ordered: bool,
        start: JSValue,
        depth: u32,
    ) -> JSValue;
    safe fn BunMarkdownMeta__createCell(global: &JSGlobalObject, align: JSValue) -> JSValue;
    safe fn BunMarkdownMeta__createLink(
        global: &JSGlobalObject,
        href: JSValue,
        title: JSValue,
    ) -> JSValue;
}

fn get_cached_tag_string(global_object: &JSGlobalObject, tag: TagIndex) -> JSValue {
    BunMarkdownTagStrings__getTagString(global_object, tag as u8)
}

fn get_block_type_tag(block_type: md::BlockType, data: u32) -> TagIndex {
    match block_type {
        md::BlockType::H => match data {
            1 => TagIndex::H1,
            2 => TagIndex::H2,
            3 => TagIndex::H3,
            4 => TagIndex::H4,
            5 => TagIndex::H5,
            _ => TagIndex::H6,
        },
        md::BlockType::P => TagIndex::P,
        md::BlockType::Quote => TagIndex::Blockquote,
        md::BlockType::Ul => TagIndex::Ul,
        md::BlockType::Ol => TagIndex::Ol,
        md::BlockType::Li => TagIndex::Li,
        md::BlockType::Code => TagIndex::Pre,
        md::BlockType::Hr => TagIndex::Hr,
        md::BlockType::Html => TagIndex::Html,
        md::BlockType::Table => TagIndex::Table,
        md::BlockType::Thead => TagIndex::Thead,
        md::BlockType::Tbody => TagIndex::Tbody,
        md::BlockType::Tr => TagIndex::Tr,
        md::BlockType::Th => TagIndex::Th,
        md::BlockType::Td => TagIndex::Td,
        md::BlockType::Doc => TagIndex::Div,
    }
}

fn get_span_type_tag(span_type: md::SpanType) -> TagIndex {
    match span_type {
        md::SpanType::Em => TagIndex::Em,
        md::SpanType::Strong => TagIndex::Strong,
        md::SpanType::A => TagIndex::A,
        md::SpanType::Img => TagIndex::Img,
        md::SpanType::Code => TagIndex::Code,
        md::SpanType::Del => TagIndex::Del,
        md::SpanType::Latexmath => TagIndex::Math,
        md::SpanType::LatexmathDisplay => TagIndex::Math,
        md::SpanType::Wikilink => TagIndex::A,
        md::SpanType::U => TagIndex::U,
    }
}
