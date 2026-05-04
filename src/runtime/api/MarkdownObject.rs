use core::ffi::c_void;

use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult, MarkedArgumentBuffer};
use bun_str::{String as BunString, ZigString};
use bun_core::StackCheck;
use bun_md as md;

pub fn create(global_this: &JSGlobalObject) -> JSValue {
    let object = JSValue::create_empty_object(global_this, 4);
    object.put(
        global_this,
        ZigString::static_(b"html"),
        bun_jsc::JSFunction::create(global_this, "html", render_to_html, 1, Default::default()),
    );
    object.put(
        global_this,
        ZigString::static_(b"ansi"),
        bun_jsc::JSFunction::create(global_this, "ansi", render_to_ansi, 2, Default::default()),
    );
    object.put(
        global_this,
        ZigString::static_(b"render"),
        bun_jsc::JSFunction::create(global_this, "render", render, 3, Default::default()),
    );
    object.put(
        global_this,
        ZigString::static_(b"react"),
        bun_jsc::JSFunction::create(global_this, "react", render_react, 3, Default::default()),
    );
    object
}

/// `Bun.markdown.ansi(text, theme?)` — render markdown to an ANSI-colored
/// terminal string. `theme` is an optional object: `{ colors?, hyperlinks?,
/// light?, columns? }`. By default colors are enabled, hyperlinks are
/// disabled (the caller doesn't know if stdout is a TTY), and columns is 80.
#[bun_jsc::host_fn]
pub fn render_to_ansi(
    global_this: &JSGlobalObject,
    callframe: &CallFrame,
) -> JsResult<JSValue> {
    let [input_value, theme_value] = callframe.arguments_as_array::<2>();

    if input_value.is_empty_or_undefined_or_null() {
        return global_this.throw_invalid_arguments("Expected a string or buffer to render", &[]);
    }

    // PERF(port): was arena bulk-free — profile in Phase B
    let Some(buffer) = bun_jsc::node::StringOrBuffer::from_js(global_this, input_value)? else {
        return global_this.throw_invalid_arguments("Expected a string or buffer to render", &[]);
    };

    let input = buffer.slice();

    let mut theme = md::AnsiTheme {
        colors: true,
        hyperlinks: false,
        kitty_graphics: false,
        light: md::detect_light_background(),
        columns: 80,
    };
    if theme_value.is_object() {
        if let Some(v) = theme_value.get_boolean_loose(global_this, "colors")? { theme.colors = v; }
        if let Some(v) = theme_value.get_boolean_loose(global_this, "hyperlinks")? { theme.hyperlinks = v; }
        if let Some(v) = theme_value.get_boolean_loose(global_this, "kittyGraphics")? { theme.kitty_graphics = v; }
        if let Some(v) = theme_value.get_boolean_loose(global_this, "light")? { theme.light = v; }
        if let Some(cols) = theme_value.get(global_this, "columns")? {
            if cols.is_number() {
                let n = cols.to_int32();
                theme.columns = if n <= 0 { 0 } else { u16::try_from(n.min(u16::MAX as i32)).unwrap() };
            }
        }
    }

    let result = match md::render_to_ansi(input, md::AnsiTarget::Terminal, theme) {
        Ok(Some(r)) => r,
        Ok(None) => {
            // The parser can only return null via JSError / JSTerminated
            // from a renderer callback; the ANSI renderer has none, so this
            // path is unreachable but handle it safely.
            return global_this.throw_out_of_memory();
        }
        Err(err) if err == bun_core::err!("OutOfMemory") => return global_this.throw_out_of_memory(),
        Err(err) if err == bun_core::err!("StackOverflow") => return global_this.throw_stack_overflow(),
        Err(_) => return global_this.throw_out_of_memory(),
    };

    BunString::create_utf8_for_js(global_this, &result)
}

#[bun_jsc::host_fn]
pub fn render_to_html(
    global_this: &JSGlobalObject,
    callframe: &CallFrame,
) -> JsResult<JSValue> {
    let [input_value, opts_value] = callframe.arguments_as_array::<2>();

    if input_value.is_empty_or_undefined_or_null() {
        return global_this.throw_invalid_arguments("Expected a string or buffer to render", &[]);
    }

    // PERF(port): was arena bulk-free — profile in Phase B
    let Some(buffer) = bun_jsc::node::StringOrBuffer::from_js(global_this, input_value)? else {
        return global_this.throw_invalid_arguments("Expected a string or buffer to render", &[]);
    };

    let input = buffer.slice();

    let options = parse_options(global_this, opts_value)?;

    let result = match md::render_to_html_with_options(input, options) {
        Ok(r) => r,
        Err(_) => return global_this.throw_out_of_memory(),
    };

    BunString::create_utf8_for_js(global_this, &result)
}

fn parse_options(global_this: &JSGlobalObject, opts_value: JSValue) -> JsResult<md::Options> {
    let mut options = md::Options::default();
    if opts_value.is_object() {
        // Handle compound autolinks: true | { url, www, email }
        if let Some(autolinks_val) = opts_value.get(global_this, "autolinks")? {
            if autolinks_val.is_boolean() {
                if autolinks_val.to_boolean() {
                    options.permissive_autolinks = true;
                }
            } else if autolinks_val.is_object() {
                if let Some(v) = autolinks_val.get_boolean_loose(global_this, "url")? { options.permissive_url_autolinks = v; }
                if let Some(v) = autolinks_val.get_boolean_loose(global_this, "www")? { options.permissive_www_autolinks = v; }
                if let Some(v) = autolinks_val.get_boolean_loose(global_this, "email")? { options.permissive_email_autolinks = v; }
            }
        }

        // Handle compound headings: true | { ids, autolink }
        if let Some(headings_val) = opts_value.get(global_this, "headings")? {
            if headings_val.is_boolean() {
                if headings_val.to_boolean() {
                    options.heading_ids = true;
                    options.autolink_headings = true;
                }
            } else if headings_val.is_object() {
                if let Some(v) = headings_val.get_boolean_loose(global_this, "ids")? { options.heading_ids = v; }
                if let Some(v) = headings_val.get_boolean_loose(global_this, "autolink")? { options.autolink_headings = v; }
            }
        }

        // Handle remaining boolean options (autolinks/headings are only settable via compound options above)
        // TODO(port): comptime reflection over md::Options bool fields — Zig used
        // `inline for (@typeInfo(md.Options).@"struct".fields)` to iterate every bool
        // field (excluding the six handled above), checking both camelCase and
        // snake_case keys. Phase B should generate this list from md::Options
        // (proc-macro or hand-maintained const slice in bun_md).
        for (snake, camel, set) in md::Options::BOOL_FIELD_SETTERS {
            // skip the compound-only fields
            if matches!(
                *snake,
                b"permissive_autolinks"
                    | b"permissive_url_autolinks"
                    | b"permissive_www_autolinks"
                    | b"permissive_email_autolinks"
                    | b"heading_ids"
                    | b"autolink_headings"
            ) {
                continue;
            }
            if let Some(val) = opts_value.get_boolean_loose(global_this, camel)? {
                set(&mut options, val);
            } else if camel != snake {
                if let Some(val) = opts_value.get_boolean_loose(global_this, snake)? {
                    set(&mut options, val);
                }
            }
        }
    }
    Ok(options)
}

// TODO(port): `camelCaseOf` was a comptime fn producing `&'static [u8]` from a
// snake_case literal. In Rust this should be `const_format::map_ascii_case!` or
// a `macro_rules!` mapper. The only caller is the reflection loop above, which
// is itself TODO'd to use a precomputed table that already carries the camelCase
// form, so this helper is intentionally omitted.

/// `Bun.markdown.render(text, callbacks, options?)` — render markdown with custom callbacks.
///
/// Each callback receives the accumulated children as a string plus an optional
/// metadata object, and returns a string. The final result is the concatenation
/// of all callback outputs.
#[bun_jsc::host_fn]
pub fn render(
    global_this: &JSGlobalObject,
    callframe: &CallFrame,
) -> JsResult<JSValue> {
    let [input_value, callbacks_value, opts_value] = callframe.arguments_as_array::<3>();

    if input_value.is_empty_or_undefined_or_null() {
        return global_this.throw_invalid_arguments("Expected a string or buffer to render", &[]);
    }

    // PERF(port): was arena bulk-free — profile in Phase B
    let Some(buffer) = bun_jsc::node::StringOrBuffer::from_js(global_this, input_value)? else {
        return global_this.throw_invalid_arguments("Expected a string or buffer to render", &[]);
    };

    let input = buffer.slice();

    // Parse parser options from 3rd argument
    let options = parse_options(global_this, opts_value)?;

    // Create JS callback renderer
    let mut js_renderer = match JsCallbackRenderer::init(global_this, input, options.heading_ids) {
        Ok(r) => r,
        Err(_) => return global_this.throw_out_of_memory(),
    };

    // Extract callbacks from 2nd argument
    js_renderer.extract_callbacks(if callbacks_value.is_object() { callbacks_value } else { JSValue::UNDEFINED })?;

    // Run parser with the JS callback renderer
    if let Err(err) = md::render_with_renderer(input, options, js_renderer.renderer()) {
        return match err {
            e if e == bun_core::err!("JSError")
                || e == bun_core::err!("JSTerminated")
                || e == bun_core::err!("OutOfMemory") => Err(e.into()),
            e if e == bun_core::err!("StackOverflow") => global_this.throw_stack_overflow(),
            e => Err(e.into()),
        };
    }

    // Return accumulated result
    let result = js_renderer.get_result();
    BunString::create_utf8_for_js(global_this, result)
}

/// `Bun.markdown.react(text, components?, options?)` — returns a React Fragment element
/// containing the parsed markdown as children.
// TODO(port): Zig used `jsc.MarkedArgumentBuffer.wrap(renderReactImpl)` to generate
// the host-fn shim that allocates a MarkedArgumentBuffer. Here we hand-roll the
// equivalent until bun_jsc provides a `#[marked_args]` attribute.
#[bun_jsc::host_fn]
pub fn render_react(
    global_this: &JSGlobalObject,
    callframe: &CallFrame,
) -> JsResult<JSValue> {
    let mut marked_args = MarkedArgumentBuffer::new();
    render_react_impl(global_this, callframe, &mut marked_args)
}

// TODO(port): move to <area>_sys
unsafe extern "C" {
    fn JSReactElement__createFragment(
        global_object: *const JSGlobalObject,
        react_version: u8,
        children: JSValue,
    ) -> JSValue;
}

fn render_react_impl(
    global_this: &JSGlobalObject,
    callframe: &CallFrame,
    marked_args: &mut MarkedArgumentBuffer,
) -> JsResult<JSValue> {
    let args = callframe.arguments_as_array::<3>();
    let opts_value = args[2]; // options are the 3rd argument

    let mut react_version: u8 = 1; // default: react.transitional.element (React 19+)
    if opts_value.is_object() {
        if let Some(rv) = opts_value.get(global_this, "reactVersion")? {
            if rv.is_number() {
                let num = rv.to_int32();
                if num <= 18 {
                    react_version = 0; // react.element (React 18 and older)
                }
            }
        }
    }

    let children = render_ast(global_this, callframe, marked_args, Some(react_version))?;
    // SAFETY: FFI call into JSC bindings; global_this is a live &JSGlobalObject.
    let fragment = unsafe { JSReactElement__createFragment(global_this, react_version, children) };
    marked_args.append(fragment);
    Ok(fragment)
}

fn render_ast(
    global_this: &JSGlobalObject,
    callframe: &CallFrame,
    marked_args: &mut MarkedArgumentBuffer,
    react_version: Option<u8>,
) -> JsResult<JSValue> {
    let [input_value, components_value, opts_value] = callframe.arguments_as_array::<3>();

    if input_value.is_empty_or_undefined_or_null() {
        return global_this.throw_invalid_arguments("Expected a string or buffer to render", &[]);
    }

    // PERF(port): was arena bulk-free — profile in Phase B
    let Some(buffer) = bun_jsc::node::StringOrBuffer::from_js(global_this, input_value)? else {
        return global_this.throw_invalid_arguments("Expected a string or buffer to render", &[]);
    };

    let input = buffer.slice();

    // Parse parser options from 3rd argument
    let options = parse_options(global_this, opts_value)?;

    let mut renderer = match ParseRenderer::init(global_this, input, marked_args, options.heading_ids, react_version) {
        Ok(r) => r,
        Err(_) => return global_this.throw_out_of_memory(),
    };

    // Extract component overrides from 2nd argument
    renderer.extract_components(if components_value.is_object() { components_value } else { JSValue::UNDEFINED })?;

    if let Err(err) = md::render_with_renderer(input, options, renderer.renderer()) {
        return match err {
            e if e == bun_core::err!("JSError")
                || e == bun_core::err!("JSTerminated")
                || e == bun_core::err!("OutOfMemory") => Err(e.into()),
            e if e == bun_core::err!("StackOverflow") => global_this.throw_stack_overflow(),
            e => Err(e.into()),
        };
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
    // PORT NOTE: JSValue in Vec is safe here — every entry.children is also appended to self.marked_args (GC root).
    stack: Vec<ParseStackEntry>,
    stack_check: StackCheck,
    src_text: &'a [u8],
    heading_tracker: md::helpers::HeadingIdTracker,
    components: Components,
    react_version: Option<u8>,
}

// TODO(port): move to <area>_sys
unsafe extern "C" {
    fn JSReactElement__create(
        global_object: *const JSGlobalObject,
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
// PORT NOTE: `Default` for JSValue must be `JSValue::ZERO` (encoded 0), matching Zig's `.zero` initializers.

struct ParseStackEntry {
    children: JSValue,
    block_type: Option<md::BlockType>,
    span_type: Option<md::SpanType>,
    data: u32,
    flags: u32,
    detail: md::SpanDetail,
}

impl Default for ParseStackEntry {
    fn default() -> Self {
        Self {
            children: JSValue::ZERO,
            block_type: None,
            span_type: None,
            data: 0,
            flags: 0,
            detail: md::SpanDetail::default(),
        }
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
        let root_array = JSValue::create_empty_array(global_object, 0).map_err(|_| bun_alloc::AllocError)?;
        self_.marked_args.append(root_array);
        self_.stack.push(ParseStackEntry {
            children: root_array,
            block_type: Some(md::BlockType::Doc),
            ..Default::default()
        });
        Ok(self_)
    }

    // PORT NOTE: deinit() dropped — Vec<ParseStackEntry> and HeadingIdTracker free via Drop.

    /// Extract component overrides from options. Any non-boolean truthy value
    /// (function, class, string, etc.) keyed by an HTML tag name is stored
    /// and used as the `type` field instead of the default string tag name.
    fn extract_components(&mut self, opts: JSValue) -> JsResult<()> {
        if opts.is_undefined_or_null() || !opts.is_object() {
            return Ok(());
        }
        macro_rules! extract {
            ($($name:ident),* $(,)?) => {$(
                if let Some(val) = opts.get_truthy(self.global_object, stringify!($name))? {
                    if !val.is_boolean() {
                        self.components.$name = val;
                        self.marked_args.append(val);
                    }
                }
            )*};
        }
        extract!(
            h1, h2, h3, h4, h5, h6, p, blockquote, ul, ol, li, pre, hr, html,
            table, thead, tbody, tr, th, td, em, strong, a, img, code, del, math, u, br,
        );
        Ok(())
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

    fn renderer(&mut self) -> md::Renderer {
        md::Renderer {
            ptr: self as *mut _ as *mut c_void,
            vtable: &Self::VTABLE,
        }
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
            // SAFETY: FFI call into JSC bindings; global_object is a live &JSGlobalObject.
            let obj = unsafe { JSReactElement__create(self.global_object, version, type_val, props) };
            self.marked_args.append(obj);
            obj
        } else {
            let obj = JSValue::create_empty_object(self.global_object, 2);
            self.marked_args.append(obj);
            obj.put(self.global_object, ZigString::static_(b"type"), type_val);
            obj.put(self.global_object, ZigString::static_(b"props"), props);
            obj
        }
    }

    const VTABLE: md::renderer::VTable = md::renderer::VTable {
        enter_block: Self::enter_block_impl,
        leave_block: Self::leave_block_impl,
        enter_span: Self::enter_span_impl,
        leave_span: Self::leave_span_impl,
        text: Self::text_impl,
    };

    // ========================================
    // Block callbacks
    // ========================================

    fn enter_block_impl(ptr: *mut c_void, block_type: md::BlockType, data: u32, flags: u32) -> JsResult<()> {
        // SAFETY: ptr was set from `&mut Self` in renderer().
        let self_: &mut ParseRenderer = unsafe { &mut *ptr.cast::<ParseRenderer>() };
        if !self_.stack_check.is_safe_to_recurse() {
            return self_.global_object.throw_stack_overflow();
        }
        if block_type == md::BlockType::Doc {
            return Ok(());
        }

        if block_type == md::BlockType::H {
            self_.heading_tracker.enter_heading();
        }

        let array = JSValue::create_empty_array(self_.global_object, 0)?;
        self_.marked_args.append(array);
        self_.stack.push(ParseStackEntry {
            children: array,
            block_type: Some(block_type),
            data,
            flags,
            ..Default::default()
        });
        Ok(())
    }

    fn leave_block_impl(ptr: *mut c_void, block_type: md::BlockType, _: u32) -> JsResult<()> {
        // SAFETY: ptr was set from `&mut Self` in renderer().
        let self_: &mut ParseRenderer = unsafe { &mut *ptr.cast::<ParseRenderer>() };
        if !self_.stack_check.is_safe_to_recurse() {
            return self_.global_object.throw_stack_overflow();
        }
        if block_type == md::BlockType::Doc {
            return Ok(());
        }

        if self_.stack.len() <= 1 {
            return Ok(());
        }
        let entry = self_.stack.pop().unwrap();
        let g = self_.global_object;

        // Determine HTML tag index for cached string
        let tag_index = get_block_type_tag(block_type, entry.data);

        // For headings, compute slug before counting props
        let slug: Option<&[u8]> = if block_type == md::BlockType::H {
            self_.heading_tracker.leave_heading()
        } else {
            None
        };

        // Count props fields
        let mut props_count: usize = if block_type == md::BlockType::Hr { 0 } else { 1 }; // children
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
                    let lang = extract_language(self_.src_text, entry.data);
                    if !lang.is_empty() {
                        props_count += 1;
                    }
                }
            }
            md::BlockType::Th | md::BlockType::Td => {
                let alignment = md::types::alignment_from_data(entry.data);
                if alignment != md::types::Alignment::Default {
                    props_count += 1;
                }
            }
            _ => {}
        }

        // Build React element — use component override as type if set
        let component = self_.get_block_component(block_type, entry.data);
        let type_val: JSValue = if !component.is_empty() { component } else { get_cached_tag_string(g, tag_index) };

        let props = JSValue::create_empty_object(g, props_count);
        self_.marked_args.append(props);

        // Set metadata props
        match block_type {
            md::BlockType::H => {
                if let Some(s) = slug {
                    props.put(g, ZigString::static_(b"id"), BunString::create_utf8_for_js(g, s)?);
                }
            }
            md::BlockType::Ol => {
                props.put(g, ZigString::static_(b"start"), JSValue::js_number(entry.data));
            }
            md::BlockType::Li => {
                let task_mark = md::types::task_mark_from_data(entry.data);
                if task_mark != 0 {
                    props.put(g, ZigString::static_(b"checked"), JSValue::from(md::types::is_task_checked(task_mark)));
                }
            }
            md::BlockType::Code => {
                if entry.flags & md::BLOCK_FENCED_CODE != 0 {
                    let lang = extract_language(self_.src_text, entry.data);
                    if !lang.is_empty() {
                        props.put(g, ZigString::static_(b"language"), BunString::create_utf8_for_js(g, lang)?);
                    }
                }
            }
            md::BlockType::Th | md::BlockType::Td => {
                let alignment = md::types::alignment_from_data(entry.data);
                if let Some(align_str) = md::types::alignment_name(alignment) {
                    props.put(g, ZigString::static_(b"align"), BunString::create_utf8_for_js(g, align_str)?);
                }
            }
            _ => {}
        }

        // Set children (skip for void elements)
        if block_type != md::BlockType::Hr {
            props.put(g, ZigString::static_(b"children"), entry.children);
        }

        let obj = self_.create_element(type_val, props);

        // Push to parent's children array
        if let Some(parent) = self_.stack.last() {
            parent.children.push(g, obj)?;
        }

        if block_type == md::BlockType::H {
            self_.heading_tracker.clear_after_heading();
        }
        Ok(())
    }

    // ========================================
    // Span callbacks
    // ========================================

    fn enter_span_impl(ptr: *mut c_void, _: md::SpanType, detail: md::SpanDetail) -> JsResult<()> {
        // SAFETY: ptr was set from `&mut Self` in renderer().
        let self_: &mut ParseRenderer = unsafe { &mut *ptr.cast::<ParseRenderer>() };
        if !self_.stack_check.is_safe_to_recurse() {
            return self_.global_object.throw_stack_overflow();
        }

        let array = JSValue::create_empty_array(self_.global_object, 0)?;
        self_.marked_args.append(array);
        self_.stack.push(ParseStackEntry {
            children: array,
            detail,
            ..Default::default()
        });
        Ok(())
    }

    fn leave_span_impl(ptr: *mut c_void, span_type: md::SpanType) -> JsResult<()> {
        // SAFETY: ptr was set from `&mut Self` in renderer().
        let self_: &mut ParseRenderer = unsafe { &mut *ptr.cast::<ParseRenderer>() };
        if !self_.stack_check.is_safe_to_recurse() {
            return self_.global_object.throw_stack_overflow();
        }

        if self_.stack.len() <= 1 {
            return Ok(());
        }
        let entry = self_.stack.pop().unwrap();
        let g = self_.global_object;

        let tag_index = get_span_type_tag(span_type);

        // Count props fields: always children (or alt for img) + metadata
        let mut props_count: usize = 1; // children (or alt for img)
        match span_type {
            md::SpanType::A => {
                props_count += 1; // href
                if !entry.detail.title.is_empty() {
                    props_count += 1;
                }
            }
            md::SpanType::Img => {
                props_count += 1; // src
                if !entry.detail.title.is_empty() {
                    props_count += 1;
                }
            }
            md::SpanType::Wikilink => props_count += 1, // target
            md::SpanType::LatexmathDisplay => props_count += 1, // display
            _ => {}
        }

        // Build React element: { $$typeof, type, key, ref, props }
        let component = self_.get_span_component(span_type);
        let type_val: JSValue = if !component.is_empty() { component } else { get_cached_tag_string(g, tag_index) };

        let props = JSValue::create_empty_object(g, props_count);
        self_.marked_args.append(props);

        // Set metadata props
        match span_type {
            md::SpanType::A => {
                props.put(g, ZigString::static_(b"href"), BunString::create_utf8_for_js(g, &entry.detail.href)?);
                if !entry.detail.title.is_empty() {
                    props.put(g, ZigString::static_(b"title"), BunString::create_utf8_for_js(g, &entry.detail.title)?);
                }
            }
            md::SpanType::Img => {
                props.put(g, ZigString::static_(b"src"), BunString::create_utf8_for_js(g, &entry.detail.href)?);
                if !entry.detail.title.is_empty() {
                    props.put(g, ZigString::static_(b"title"), BunString::create_utf8_for_js(g, &entry.detail.title)?);
                }
            }
            md::SpanType::Wikilink => {
                props.put(g, ZigString::static_(b"target"), BunString::create_utf8_for_js(g, &entry.detail.href)?);
            }
            md::SpanType::LatexmathDisplay => {
                props.put(g, ZigString::static_(b"display"), JSValue::TRUE);
            }
            _ => {}
        }

        if span_type == md::SpanType::Img {
            // img is a void element — convert children to alt prop
            let len: u32 = entry.children.get_length(g)? as u32;
            if len == 1 {
                let child = entry.children.get_index(g, 0)?;
                if child.is_string() {
                    props.put(g, ZigString::static_(b"alt"), child);
                }
            } else if len > 1 {
                // Multiple children — concatenate string parts
                let mut alt_buf: Vec<u8> = Vec::new();
                for i in 0..len {
                    let child = entry.children.get_index(g, i as u32)?;
                    if child.is_string() {
                        let str = child.to_slice(g)?;
                        let _ = alt_buf.extend_from_slice(str.slice());
                    }
                }
                if !alt_buf.is_empty() {
                    props.put(g, ZigString::static_(b"alt"), BunString::create_utf8_for_js(g, &alt_buf)?);
                }
            }
        } else {
            props.put(g, ZigString::static_(b"children"), entry.children);
        }

        let obj = self_.create_element(type_val, props);

        // Push to parent's children array
        if let Some(parent) = self_.stack.last() {
            parent.children.push(g, obj)?;
        }
        Ok(())
    }

    // ========================================
    // Text callback
    // ========================================

    fn text_impl(ptr: *mut c_void, text_type: md::TextType, content: &[u8]) -> JsResult<()> {
        // SAFETY: ptr was set from `&mut Self` in renderer().
        let self_: &mut ParseRenderer = unsafe { &mut *ptr.cast::<ParseRenderer>() };
        if !self_.stack_check.is_safe_to_recurse() {
            return self_.global_object.throw_stack_overflow();
        }

        let g = self_.global_object;

        // Track plain text for slug generation when inside a heading
        self_.heading_tracker.track_text(text_type, content);

        if self_.stack.is_empty() {
            return Ok(());
        }
        // PORT NOTE: reshaped for borrowck — capture parent.children (Copy JSValue) instead of holding &mut into self_.stack.
        let parent_children = self_.stack.last().unwrap().children;

        match text_type {
            md::TextType::Br => {
                let br_component = self_.components.br;
                let br_type: JSValue = if !br_component.is_empty() { br_component } else { get_cached_tag_string(g, TagIndex::Br) };
                let empty_props = JSValue::create_empty_object(g, 0);
                self_.marked_args.append(empty_props);
                let obj = self_.create_element(br_type, empty_props);
                parent_children.push(g, obj)?;
            }
            md::TextType::Softbr => {
                let str = BunString::create_utf8_for_js(g, b"\n")?;
                self_.marked_args.append(str);
                parent_children.push(g, str)?;
            }
            md::TextType::NullChar => {
                let str = BunString::create_utf8_for_js(g, b"\xEF\xBF\xBD")?;
                self_.marked_args.append(str);
                parent_children.push(g, str)?;
            }
            md::TextType::Entity => {
                let mut buf = [0u8; 8];
                let decoded = md::helpers::decode_entity_to_utf8(content, &mut buf).unwrap_or(content);
                let str = BunString::create_utf8_for_js(g, decoded)?;
                self_.marked_args.append(str);
                parent_children.push(g, str)?;
            }
            _ => {
                let str = BunString::create_utf8_for_js(g, content)?;
                self_.marked_args.append(str);
                parent_children.push(g, str)?;
            }
        }
        Ok(())
    }
}

/// Renderer that calls JavaScript callbacks for each markdown element.
/// Uses a content-stack pattern: each enter pushes a new buffer, text
/// appends to the top buffer, and each leave pops the buffer, calls
/// the JS callback with the accumulated children, and appends the
/// callback's return value to the parent buffer.
struct JsCallbackRenderer<'a> {
    global_object: &'a JSGlobalObject,
    // PORT NOTE: #allocator field dropped — global mimalloc.
    src_text: &'a [u8],
    stack: Vec<CallbackStackEntry>,
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
// PORT NOTE: `Default` for JSValue must be `JSValue::ZERO`.

struct CallbackStackEntry {
    buffer: Vec<u8>,
    block_type: md::BlockType,
    data: u32,
    flags: u32,
    /// For ul/ol: number of li children seen so far (next li's index).
    /// For li: this item's 0-based index within its parent list.
    child_index: u32,
    detail: md::SpanDetail,
}

impl Default for CallbackStackEntry {
    fn default() -> Self {
        Self {
            buffer: Vec::new(),
            block_type: md::BlockType::Doc,
            data: 0,
            flags: 0,
            child_index: 0,
            detail: md::SpanDetail::default(),
        }
    }
}

impl<'a> JsCallbackRenderer<'a> {
    fn init(global_object: &'a JSGlobalObject, src_text: &'a [u8], heading_ids: bool) -> Result<JsCallbackRenderer<'a>, bun_alloc::AllocError> {
        let mut self_ = JsCallbackRenderer {
            global_object,
            src_text,
            stack: Vec::new(),
            callbacks: Callbacks::default(),
            heading_tracker: md::helpers::HeadingIdTracker::init(heading_ids),
            stack_check: StackCheck::init(),
        };
        self_.stack.push(CallbackStackEntry::default());
        Ok(self_)
    }

    fn extract_callbacks(&mut self, opts: JSValue) -> JsResult<()> {
        if opts.is_undefined_or_null() || !opts.is_object() {
            return Ok(());
        }
        macro_rules! extract {
            ($($field:ident => $key:literal),* $(,)?) => {$(
                if let Some(val) = opts.get_truthy(self.global_object, $key)? {
                    if val.is_callable() {
                        self.callbacks.$field = val;
                    }
                }
            )*};
        }
        extract!(
            heading => "heading",
            paragraph => "paragraph",
            blockquote => "blockquote",
            code => "code",
            list => "list",
            list_item => "listItem",
            hr => "hr",
            table => "table",
            thead => "thead",
            tbody => "tbody",
            tr => "tr",
            th => "th",
            td => "td",
            html => "html",
            strong => "strong",
            emphasis => "emphasis",
            link => "link",
            image => "image",
            codespan => "codespan",
            strikethrough => "strikethrough",
            text => "text",
        );
        Ok(())
    }

    // PORT NOTE: deinit() dropped — Vec<CallbackStackEntry> (with Vec<u8> buffers) and HeadingIdTracker free via Drop.

    fn renderer(&mut self) -> md::Renderer {
        md::Renderer {
            ptr: self as *mut _ as *mut c_void,
            vtable: &Self::VTABLE,
        }
    }

    const VTABLE: md::renderer::VTable = md::renderer::VTable {
        enter_block: Self::enter_block_impl,
        leave_block: Self::leave_block_impl,
        enter_span: Self::enter_span_impl,
        leave_span: Self::leave_span_impl,
        text: Self::text_impl,
    };

    // ========================================
    // Content stack operations
    // ========================================

    fn append_to_top(&mut self, data: &[u8]) -> Result<(), bun_alloc::AllocError> {
        if let Some(top) = self.stack.last_mut() {
            top.buffer.extend_from_slice(data);
        }
        Ok(())
    }

    fn pop_and_callback(&mut self, callback: JSValue, meta: Option<JSValue>) -> JsResult<()> {
        if self.stack.len() <= 1 {
            return Ok(()); // don't pop root
        }
        let Some(entry) = self.stack.pop() else { return Ok(()); };

        let children = entry.buffer.as_slice();

        if callback.is_empty() {
            // No callback registered - pass children through to parent
            self.append_to_top(children)?;
            return Ok(());
        }

        if !self.stack_check.is_safe_to_recurse() {
            return self.global_object.throw_stack_overflow();
        }

        // Convert children to JS string
        let children_js = BunString::create_utf8_for_js(self.global_object, children)?;

        // Call the JS callback
        let result = if let Some(m) = meta {
            callback.call(self.global_object, JSValue::UNDEFINED, &[children_js, m])?
        } else {
            callback.call(self.global_object, JSValue::UNDEFINED, &[children_js])?
        };

        if result.is_undefined_or_null() {
            return Ok(()); // callback returned null/undefined → omit element
        }
        let slice = result.to_slice(self.global_object)?;
        self.append_to_top(slice.slice())?;
        Ok(())
    }

    fn get_result(&self) -> &[u8] {
        if self.stack.is_empty() {
            return b"";
        }
        self.stack[0].buffer.as_slice()
    }

    // ========================================
    // VTable implementation
    // ========================================

    fn enter_block_impl(ptr: *mut c_void, block_type: md::BlockType, data: u32, flags: u32) -> JsResult<()> {
        // SAFETY: ptr was set from `&mut Self` in renderer().
        let self_: &mut JsCallbackRenderer = unsafe { &mut *ptr.cast::<JsCallbackRenderer>() };
        if !self_.stack_check.is_safe_to_recurse() {
            return self_.global_object.throw_stack_overflow();
        }
        if block_type == md::BlockType::Doc {
            return Ok(());
        }
        if block_type == md::BlockType::H {
            self_.heading_tracker.enter_heading();
        }

        // For li: record its 0-based index within the parent list, then
        // increment the parent's counter so the next sibling gets index+1.
        let mut child_index: u32 = 0;
        if block_type == md::BlockType::Li && !self_.stack.is_empty() {
            let parent = self_.stack.last_mut().unwrap();
            child_index = parent.child_index;
            parent.child_index += 1;
        }

        self_.stack.push(CallbackStackEntry {
            block_type,
            data,
            flags,
            child_index,
            ..Default::default()
        });
        Ok(())
    }

    fn leave_block_impl(ptr: *mut c_void, block_type: md::BlockType, _: u32) -> JsResult<()> {
        // SAFETY: ptr was set from `&mut Self` in renderer().
        let self_: &mut JsCallbackRenderer = unsafe { &mut *ptr.cast::<JsCallbackRenderer>() };
        if !self_.stack_check.is_safe_to_recurse() {
            return self_.global_object.throw_stack_overflow();
        }
        if block_type == md::BlockType::Doc {
            return Ok(());
        }

        let callback = self_.get_block_callback(block_type);
        // PORT NOTE: reshaped for borrowck — clone the saved entry (cheap; buffer not used) instead of holding a borrow across method calls.
        let saved = if self_.stack.len() > 1 {
            CallbackStackEntry {
                buffer: Vec::new(),
                block_type: self_.stack.last().unwrap().block_type,
                data: self_.stack.last().unwrap().data,
                flags: self_.stack.last().unwrap().flags,
                child_index: self_.stack.last().unwrap().child_index,
                detail: self_.stack.last().unwrap().detail.clone(),
            }
        } else {
            CallbackStackEntry::default()
        };
        let meta = self_.create_block_meta(block_type, saved.data, saved.flags)?;
        self_.pop_and_callback(callback, meta)?;

        if block_type == md::BlockType::H {
            self_.heading_tracker.clear_after_heading();
        }
        Ok(())
    }

    fn enter_span_impl(ptr: *mut c_void, _: md::SpanType, detail: md::SpanDetail) -> JsResult<()> {
        // SAFETY: ptr was set from `&mut Self` in renderer().
        let self_: &mut JsCallbackRenderer = unsafe { &mut *ptr.cast::<JsCallbackRenderer>() };
        if !self_.stack_check.is_safe_to_recurse() {
            return self_.global_object.throw_stack_overflow();
        }
        self_.stack.push(CallbackStackEntry {
            detail,
            ..Default::default()
        });
        Ok(())
    }

    fn leave_span_impl(ptr: *mut c_void, span_type: md::SpanType) -> JsResult<()> {
        // SAFETY: ptr was set from `&mut Self` in renderer().
        let self_: &mut JsCallbackRenderer = unsafe { &mut *ptr.cast::<JsCallbackRenderer>() };
        if !self_.stack_check.is_safe_to_recurse() {
            return self_.global_object.throw_stack_overflow();
        }

        let callback = self_.get_span_callback(span_type);
        let detail = if self_.stack.len() > 1 {
            self_.stack.last().unwrap().detail.clone()
        } else {
            md::SpanDetail::default()
        };
        let meta = self_.create_span_meta(span_type, &detail)?;
        self_.pop_and_callback(callback, meta)?;
        Ok(())
    }

    fn text_impl(ptr: *mut c_void, text_type: md::TextType, content: &[u8]) -> JsResult<()> {
        // SAFETY: ptr was set from `&mut Self` in renderer().
        let self_: &mut JsCallbackRenderer = unsafe { &mut *ptr.cast::<JsCallbackRenderer>() };
        if !self_.stack_check.is_safe_to_recurse() {
            return self_.global_object.throw_stack_overflow();
        }

        // Track plain text for slug generation when inside a heading
        self_.heading_tracker.track_text(text_type, content);

        match text_type {
            md::TextType::NullChar => self_.append_to_top(b"\xEF\xBF\xBD")?,
            md::TextType::Br => self_.append_to_top(b"\n")?,
            md::TextType::Softbr => self_.append_to_top(b"\n")?,
            md::TextType::Entity => self_.decode_and_append_entity(content)?,
            _ => {
                if !self_.callbacks.text.is_empty() {
                    self_.call_text_callback(content)?;
                } else {
                    self_.append_to_top(content)?;
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
            return self.global_object.throw_stack_overflow();
        }
        let text_js = BunString::create_utf8_for_js(self.global_object, content)?;
        let result = self.callbacks.text.call(self.global_object, JSValue::UNDEFINED, &[text_js])?;
        if !result.is_undefined_or_null() {
            let slice = result.to_slice(self.global_object)?;
            self.append_to_top(slice.slice())?;
        }
        Ok(())
    }

    fn decode_and_append_entity(&mut self, entity_text: &[u8]) -> JsResult<()> {
        let mut buf = [0u8; 8];
        let decoded = md::helpers::decode_entity_to_utf8(entity_text, &mut buf).unwrap_or(entity_text);
        // PORT NOTE: reshaped for borrowck — copy the (≤8-byte) decoded slice out of `buf`
        // before calling &mut self method, to avoid overlapping borrows when the
        // borrow checker tracks `buf` as borrowed by `decoded`.
        self.append_text_or_raw(decoded)
    }

    /// Append text through the text callback if one is set, otherwise raw append.
    fn append_text_or_raw(&mut self, content: &[u8]) -> JsResult<()> {
        if !self.callbacks.text.is_empty() {
            self.call_text_callback(content)
        } else {
            self.append_to_top(content)?;
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

    /// Walks the stack to count enclosing ul/ol blocks. Called during leave,
    /// so the top entry is the block itself (skip it for li, count it for ul/ol's
    /// own depth which excludes self).
    fn count_list_depth(&self) -> u32 {
        let mut depth: u32 = 0;
        // Skip the top entry (self) — we want enclosing lists only.
        let len = self.stack.len();
        if len < 2 {
            return 0;
        }
        for entry in &self.stack[0..len - 1] {
            if entry.block_type == md::BlockType::Ul || entry.block_type == md::BlockType::Ol {
                depth += 1;
            }
        }
        depth
    }

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

    fn create_block_meta(&self, block_type: md::BlockType, data: u32, flags: u32) -> JsResult<Option<JSValue>> {
        let g = self.global_object;
        match block_type {
            md::BlockType::H => {
                let slug = self.heading_tracker.leave_heading();
                let field_count: usize = if slug.is_some() { 2 } else { 1 };
                let obj = JSValue::create_empty_object(g, field_count);
                obj.put(g, ZigString::static_(b"level"), JSValue::js_number(data));
                if let Some(s) = slug {
                    obj.put(g, ZigString::static_(b"id"), BunString::create_utf8_for_js(g, s)?);
                }
                Ok(Some(obj))
            }
            md::BlockType::Ol => {
                // SAFETY: FFI into JSC bindings.
                Ok(Some(unsafe { BunMarkdownMeta__createList(g, true, JSValue::js_number(data), self.count_list_depth()) }))
            }
            md::BlockType::Ul => {
                // SAFETY: FFI into JSC bindings.
                Ok(Some(unsafe { BunMarkdownMeta__createList(g, false, JSValue::UNDEFINED, self.count_list_depth()) }))
            }
            md::BlockType::Code => {
                if flags & md::BLOCK_FENCED_CODE != 0 {
                    let lang = extract_language(self.src_text, data);
                    if !lang.is_empty() {
                        let obj = JSValue::create_empty_object(g, 1);
                        obj.put(g, ZigString::static_(b"language"), BunString::create_utf8_for_js(g, lang)?);
                        return Ok(Some(obj));
                    }
                }
                Ok(None)
            }
            md::BlockType::Th | md::BlockType::Td => {
                let alignment = md::types::alignment_from_data(data);
                let align_js = if let Some(align_str) = md::types::alignment_name(alignment) {
                    BunString::create_utf8_for_js(g, align_str)?
                } else {
                    JSValue::UNDEFINED
                };
                // SAFETY: FFI into JSC bindings.
                Ok(Some(unsafe { BunMarkdownMeta__createCell(g, align_js) }))
            }
            md::BlockType::Li => {
                // The li entry is still on top of the stack; parent ul/ol is at len-2.
                let len = self.stack.len();
                let item_index = if len > 1 { self.stack[len - 1].child_index } else { 0 };
                let parent = self.parent_list();
                let is_ordered = parent.is_some() && parent.unwrap().block_type == md::BlockType::Ol;
                // count_list_depth() includes the immediate parent list; subtract it
                // so that items in a top-level list report depth 0.
                let enclosing = self.count_list_depth();
                let depth: u32 = if enclosing > 0 { enclosing - 1 } else { 0 };
                let task_mark = md::types::task_mark_from_data(data);

                let start_js = if is_ordered { JSValue::js_number(parent.unwrap().data) } else { JSValue::UNDEFINED };
                let checked_js = if task_mark != 0 {
                    JSValue::from(md::types::is_task_checked(task_mark))
                } else {
                    JSValue::UNDEFINED
                };

                // SAFETY: FFI into JSC bindings.
                Ok(Some(unsafe { BunMarkdownMeta__createListItem(g, item_index, depth, is_ordered, start_js, checked_js) }))
            }
            _ => Ok(None),
        }
    }

    fn create_span_meta(&self, span_type: md::SpanType, detail: &md::SpanDetail) -> JsResult<Option<JSValue>> {
        let g = self.global_object;
        match span_type {
            md::SpanType::A => {
                let href = BunString::create_utf8_for_js(g, &detail.href)?;
                let title = if !detail.title.is_empty() {
                    BunString::create_utf8_for_js(g, &detail.title)?
                } else {
                    JSValue::UNDEFINED
                };
                // SAFETY: FFI into JSC bindings.
                Ok(Some(unsafe { BunMarkdownMeta__createLink(g, href, title) }))
            }
            md::SpanType::Img => {
                // Image meta shares shape with link (src/href are both the first
                // field). We use a separate cached structure would require a
                // second slot, so just fall back to the generic path here —
                // images are rare enough that it doesn't matter.
                let obj = JSValue::create_empty_object(g, 2);
                obj.put(g, ZigString::static_(b"src"), BunString::create_utf8_for_js(g, &detail.href)?);
                if !detail.title.is_empty() {
                    obj.put(g, ZigString::static_(b"title"), BunString::create_utf8_for_js(g, &detail.title)?);
                }
                Ok(Some(obj))
            }
            _ => Ok(None),
        }
    }
}

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

// Cached tag string indices - must match BunMarkdownTagStrings.h
#[repr(u8)]
#[derive(Copy, Clone)]
enum TagIndex {
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

// TODO(port): move to <area>_sys
unsafe extern "C" {
    fn BunMarkdownTagStrings__getTagString(global: *const JSGlobalObject, index: u8) -> JSValue;

    // Fast-path meta-object constructors using cached Structures (see
    // BunMarkdownMeta.cpp). Each constructs via putDirectOffset so the
    // resulting objects share a single Structure and stay monomorphic.
    fn BunMarkdownMeta__createListItem(global: *const JSGlobalObject, index: u32, depth: u32, ordered: bool, start: JSValue, checked: JSValue) -> JSValue;
    fn BunMarkdownMeta__createList(global: *const JSGlobalObject, ordered: bool, start: JSValue, depth: u32) -> JSValue;
    fn BunMarkdownMeta__createCell(global: *const JSGlobalObject, align: JSValue) -> JSValue;
    fn BunMarkdownMeta__createLink(global: *const JSGlobalObject, href: JSValue, title: JSValue) -> JSValue;
}

fn get_cached_tag_string(global_object: &JSGlobalObject, tag: TagIndex) -> JSValue {
    // SAFETY: FFI into JSC bindings; tag is a valid index.
    unsafe { BunMarkdownTagStrings__getTagString(global_object, tag as u8) }
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/api/MarkdownObject.zig (1292 lines)
//   confidence: medium
//   todos:      4
//   notes:      parse_options reflection over md::Options fields stubbed via assumed BOOL_FIELD_SETTERS table; MarkedArgumentBuffer.wrap hand-rolled; bun_md crate path/variant casing assumed; arenas dropped (non-AST crate)
// ──────────────────────────────────────────────────────────────────────────
