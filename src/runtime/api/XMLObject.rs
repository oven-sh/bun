//! `Bun.XML` — `parse()` and `stringify()` host functions.
//!
//! `parse` builds one of two shapes from `bun_parsers::xml` (see bun.d.ts
//! for the user-facing description): the compact object (default) —
//! `{ [root]: value }` where an element with no attributes and no child
//! elements is its text, exactly, and otherwise an object with `"@name"`
//! attribute keys, one key per distinct child element name (an array when
//! the name repeats), and `"#text"` — or, with
//! `{ compact: false }`, the node tree `{ name, attributes, children }` whose
//! children also include `{ comment }` and `{ target, data }`. `stringify`
//! accepts either shape and always emits well-formed XML or throws.

use bun_collections::HashMap;
use bun_core::String as BunString;
use bun_core::{StackCheck, strings};
use bun_js_parser_jsc::ExprJsc;
use bun_jsc::{self as jsc, CallFrame, JSGlobalObject, JSValue, JsError, JsResult, wtf};
use bun_parsers::xml::{self, XML};

pub(crate) fn create(global: &JSGlobalObject) -> JSValue {
    bun_jsc::create_host_function_object(
        global,
        &[
            ("parse", __jsc_host_parse, 2),
            ("stringify", __jsc_host_stringify, 3),
        ],
    )
}

#[bun_jsc::host_fn]
pub(crate) fn parse(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    // A function here is reserved for a reviver; reject it rather than read
    // it as an options object with no keys.
    let options = frame.argument(1);
    let compact = if options.is_undefined_or_null() {
        true
    } else if options.is_object() && !options.is_callable() {
        options
            .get_boolean_strict(global, "compact")?
            .unwrap_or(true)
    } else {
        return Err(
            global.throw_invalid_arguments(format_args!("XML.parse options must be an object"))
        );
    };

    // Bytes (TypedArray, ArrayBuffer, DataView, Blob) go through BOM /
    // UTF-16 / declared-encoding detection. A string is already-decoded text
    // whose encoding declaration must not be acted upon: a Latin-1 string is
    // parsed byte-per-character as is, anything else re-encoded as UTF-8.
    super::with_text_format_source_encoded(
        global,
        frame,
        b"input.xml",
        super::BlobOrBufferInput::Bytes,
        super::NullishInput::Throw,
        super::StringInput::AsIs,
        |arena, log, source, source_encoding| {
            let encoding = match source_encoding {
                super::SourceEncoding::Bytes => xml::InputEncoding::Bytes,
                super::SourceEncoding::Utf8Text => xml::InputEncoding::Text,
                super::SourceEncoding::Latin1Text => xml::InputEncoding::Latin1,
                super::SourceEncoding::Utf16Text => xml::InputEncoding::Text,
            };
            bun_core::analytics::Features::xml_parse_inc();
            let options = xml::Options { compact, encoding };
            let mut result = if source_encoding == super::SourceEncoding::Utf16Text {
                // The scaffold hands the string's code units over as bytes.
                let units: &[u16] = bytemuck::cast_slice(&source.contents);
                XML::parse_utf16(source, units, log, arena, options)
            } else {
                XML::parse(source, log, arena, options)
            };
            let utf8;
            let utf8_source;
            if matches!(result, Err(bun_parsers::Error::NeedsWiderEncoding)) {
                // A character reference the Latin-1 result cannot hold: once
                // more, over the same text as UTF-8.
                utf8 = strings::allocate_latin1_into_utf8(&source.contents)
                    .map_err(|_| JsError::OutOfMemory)?;
                utf8_source = bun_ast::Source::init_path_string(b"input.xml", &utf8[..]);
                *log = bun_ast::Log::init();
                let options = xml::Options {
                    compact,
                    encoding: xml::InputEncoding::Text,
                };
                result = XML::parse(&utf8_source, log, arena, options);
            }
            let root = match result {
                Ok(root) => root,
                Err(bun_parsers::Error::StackOverflow) => {
                    return Err(global.throw_stack_overflow());
                }
                Err(bun_parsers::Error::Alloc(_)) => {
                    return Err(JsError::OutOfMemory);
                }
                Err(_) => {
                    if let Some(first_msg) = log.msgs.first() {
                        return Err(global.throw_value(global.create_syntax_error_instance(
                            format_args!(
                                "XML Parse error: {}",
                                bstr::BStr::new(&first_msg.data.text),
                            ),
                        )));
                    }
                    return Err(global.throw_value(global.create_syntax_error_instance(
                        format_args!("XML Parse error: Unable to parse XML"),
                    )));
                }
            };

            root.to_js(global)
                .map_err(|e| bun_js_parser_jsc::to_js_error(e, global))
        },
    )
}

#[bun_jsc::host_fn]
fn stringify(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let [value, replacer, space_value] = frame.arguments_as_array::<3>();

    value.ensure_still_alive();

    if skipped(value) {
        return Ok(JSValue::UNDEFINED);
    }

    if !replacer.is_undefined_or_null() {
        return Err(global.throw(format_args!(
            "XML.stringify does not support the replacer argument"
        )));
    }

    let root = value.unwrap_boxed_primitive(global)?;
    if !root.is_object() || root.is_array() {
        return Err(global.throw(format_args!(
            "XML.stringify expects an object: a {{ name, attributes, children }} node or an object with a single root element key"
        )));
    }

    let mut stringifier = Stringifier {
        stack_check: StackCheck::init(),
        builder: wtf::StringBuilder::init(),
        indent: 0,
        space: Space::init(global, space_value)?,
        visiting: HashMap::default(),
    };

    let result = if is_node(global, root)? {
        let name = root.get(global, "name")?;
        stringifier.stringify_node(global, root, name)
    } else {
        stringifier.stringify_compact_document(global, root)
    };
    if let Err(err) = result {
        return match err {
            StringifyError::Js(js_err) => Err(js_err),
            StringifyError::StackOverflow => Err(global.throw_stack_overflow()),
        };
    }

    stringifier.builder.to_string(global)
}

/// A top-level value is taken as a `{ name, attributes, children }` node
/// (rather than a compact document) when it has a string `name` and a
/// `children` or `attributes` property; their types are checked when the node
/// is written.
fn is_node(global: &JSGlobalObject, value: JSValue) -> JsResult<bool> {
    if !value.is_object() || value.is_array() {
        return Ok(false);
    }
    let Some(name) = value.get(global, "name")? else {
        return Ok(false);
    };
    if !name.is_string() {
        return Ok(false);
    }
    for key in ["children", "attributes"] {
        // `get` (which walks the prototype chain, so accessors count) maps
        // an undefined value to None; an own property that holds undefined
        // still marks the shape.
        if value.get(global, key)?.is_some()
            || value
                .get_own(global, &BunString::static_(key.as_bytes()))?
                .is_some()
        {
            return Ok(true);
        }
    }
    Ok(false)
}

#[derive(Debug)]
enum StringifyError {
    Js(JsError),
    StackOverflow,
}

impl From<JsError> for StringifyError {
    fn from(e: JsError) -> Self {
        StringifyError::Js(e)
    }
}

type StringifyResult<T> = Result<T, StringifyError>;

enum Space {
    Minified,
    Number(u32),
    Str(bun_core::String),
}

impl Space {
    /// Same interpretation as `JSON.stringify`'s `space`.
    fn init(global: &JSGlobalObject, space_value: JSValue) -> JsResult<Space> {
        let space = space_value.unwrap_boxed_primitive(global)?;
        if space.is_number() {
            let n = space.as_number();
            if n.is_nan() || n < 1.0 {
                return Ok(Space::Minified);
            }
            return Ok(Space::Number(if n > 10.0 { 10 } else { n as u32 }));
        }
        if space.is_string() {
            let str = space.to_bun_string(global)?;
            if str.length() == 0 {
                return Ok(Space::Minified);
            }
            return Ok(Space::Str(str));
        }
        Ok(Space::Minified)
    }

    fn is_pretty(&self) -> bool {
        !matches!(self, Space::Minified)
    }
}

/// How a JS value is written as element content or an attribute value.
enum Scalar {
    /// Nothing to write (undefined, function, symbol).
    Skip,
    /// An empty element / absent text (null).
    Empty,
    Text(bun_core::String),
}

struct Stringifier {
    stack_check: StackCheck,
    builder: wtf::StringBuilder,
    indent: usize,
    space: Space,
    // NOTE: `JSValue` keys live on the heap here, but every entry is also
    // live on the native stack via the recursion chain, so the conservative
    // GC scan keeps them alive.
    visiting: HashMap<JSValue, ()>,
}

fn iter_options() -> jsc::JSPropertyIteratorOptions {
    jsc::JSPropertyIteratorOptions::new(false, true)
}

/// Values `stringify` leaves out entirely, as `JSON.stringify` does.
fn skipped(value: JSValue) -> bool {
    value.is_undefined() || value.is_symbol() || value.is_function()
}

impl Stringifier {
    fn mark_visiting(&mut self, global: &JSGlobalObject, value: JSValue) -> StringifyResult<()> {
        let was_present = self
            .visiting
            .get_or_put(value)
            .map_err(|_| StringifyError::Js(JsError::OutOfMemory))?
            .found_existing;
        if was_present {
            return Err(global
                .throw(format_args!("Converting circular structure to XML"))
                .into());
        }
        Ok(())
    }

    // ── node tree ──────────────────────────────────────────────────────────

    /// `{ name, attributes, children }` → `<name ...>children</name>`;
    /// `name` is the node's already-fetched `name` property.
    fn stringify_node(
        &mut self,
        global: &JSGlobalObject,
        node: JSValue,
        name: Option<JSValue>,
    ) -> StringifyResult<()> {
        if !self.stack_check.is_safe_to_recurse() {
            return Err(StringifyError::StackOverflow);
        }
        self.mark_visiting(global, node)?;
        let result = self.stringify_node_inner(global, node, name);
        self.visiting.remove(&node);
        result
    }

    fn stringify_node_inner(
        &mut self,
        global: &JSGlobalObject,
        node: JSValue,
        name: Option<JSValue>,
    ) -> StringifyResult<()> {
        let name = match name {
            Some(name) if name.is_string() => name.to_bun_string(global)?,
            _ => {
                return Err(global
                    .throw(format_args!("XML.stringify: element children must be strings, {{ name, attributes, children }} elements, {{ comment }} or {{ target, data }}"))
                    .into());
            }
        };
        self.check_name(global, &name, "element")?;

        self.builder.append_lchar(b'<');
        self.builder.append_string(&name);

        if let Some(attributes) = node.get(global, "attributes")? {
            if !attributes.is_null() {
                if !attributes.is_object() || attributes.is_array() {
                    return Err(global
                        .throw(format_args!(
                            "XML.stringify: a node's attributes must be an object"
                        ))
                        .into());
                }
                let iter = jsc::JSPropertyIterator::init(
                    global,
                    attributes.to_object(global)?,
                    iter_options(),
                )?;
                while let Some((attr_name, prop_value)) = iter.next()? {
                    match self.scalar(global, prop_value, "an attribute value")? {
                        Scalar::Skip | Scalar::Empty => {}
                        Scalar::Text(text) => self.append_attribute(global, &attr_name, &text)?,
                    }
                }
            }
        }

        let children = match node.get(global, "children")? {
            Some(children) if children.is_array() => Some(children),
            Some(children) if children.is_null() => None,
            Some(_) => {
                return Err(global
                    .throw(format_args!(
                        "XML.stringify: a node's children must be an array"
                    ))
                    .into());
            }
            None => None,
        };
        let Some(children) = children else {
            self.builder.append_latin1(b"/>");
            return Ok(());
        };

        // Element-only content is indented when pretty-printing; any text
        // child makes the content inline so character data is kept exactly.
        let mut count = 0usize;
        let mut has_text = false;
        {
            let mut iter = children.array_iterator(global)?;
            while let Some(child) = iter.next()? {
                let child = child.unwrap_boxed_primitive(global)?;
                if child.is_null() || skipped(child) {
                    continue;
                }
                count += 1;
                if !child.is_object() || child.is_array() || child.is_date() {
                    has_text = true;
                }
            }
        }
        if count == 0 {
            self.builder.append_latin1(b"/>");
            return Ok(());
        }
        self.builder.append_lchar(b'>');
        let pretty = self.space.is_pretty() && !has_text;
        if pretty {
            self.indent += 1;
        }
        let mut iter = children.array_iterator(global)?;
        while let Some(child) = iter.next()? {
            let child = child.unwrap_boxed_primitive(global)?;
            if child.is_null() || skipped(child) {
                continue;
            }
            if pretty {
                self.newline();
            }
            if child.is_object() && !child.is_array() && !child.is_date() {
                // Inside `children` there is no compact/node ambiguity: any
                // object is an element (`name`), a comment (`comment`) or a
                // processing instruction (`target`).
                let name = child.get(global, "name")?;
                if name.is_none() && self.stringify_markup(global, child)? {
                    continue;
                }
                self.stringify_node(global, child, name)?;
            } else if child.is_array() {
                return Err(global
                    .throw(format_args!(
                        "XML.stringify: a node's children cannot contain arrays"
                    ))
                    .into());
            } else {
                match self.scalar(global, child, "a text child")? {
                    Scalar::Skip | Scalar::Empty => {}
                    Scalar::Text(text) => self.append_text(global, &text)?,
                }
            }
        }
        if pretty {
            self.indent -= 1;
            self.newline();
        }
        self.append_end_tag(&name);
        Ok(())
    }

    /// `{ comment }` → `<!--comment-->`, `{ target, data }` → `<?target data?>`;
    /// `false` if `child` is neither.
    fn stringify_markup(
        &mut self,
        global: &JSGlobalObject,
        child: JSValue,
    ) -> StringifyResult<bool> {
        if let Some(comment) = child.get(global, "comment")? {
            if child.get(global, "target")?.is_some() {
                return Err(global.throw(format_args!("XML.stringify: a child with both 'comment' and 'target' is neither a comment nor a processing instruction")).into());
            }
            if !comment.is_string() {
                return Err(global
                    .throw(format_args!(
                        "XML.stringify: a comment node's 'comment' must be a string"
                    ))
                    .into());
            }
            let text = comment.to_bun_string(global)?;
            let len = text.length();
            let mut i = 0;
            let mut prev_dash = false;
            while i < len {
                let (cp, w) = code_point_at(&text, i);
                i += w;
                if !xml::is_xml_char(cp) {
                    return Err(global
                        .throw(format_args!(
                            "XML.stringify: XML cannot represent the character U+{:04X}",
                            cp
                        ))
                        .into());
                }
                if cp == 0x2D && (prev_dash || i == len) {
                    return Err(global
                        .throw(format_args!(
                            "XML.stringify: a comment cannot contain '--' or end with '-'"
                        ))
                        .into());
                }
                prev_dash = cp == 0x2D;
            }
            self.builder.append_latin1(b"<!--");
            self.builder.append_string(&text);
            self.builder.append_latin1(b"-->");
            return Ok(true);
        }
        if let Some(target) = child.get(global, "target")? {
            if !target.is_string() {
                return Err(global
                    .throw(format_args!(
                        "XML.stringify: a processing instruction's 'target' must be a string"
                    ))
                    .into());
            }
            let target = target.to_bun_string(global)?;
            self.check_name(global, &target, "processing instruction target")?;
            if target.length() == 3 {
                let lower = |i| target.char_at(i) | 0x20;
                if lower(0) == u16::from(b'x')
                    && lower(1) == u16::from(b'm')
                    && lower(2) == u16::from(b'l')
                {
                    return Err(global.throw(format_args!("XML.stringify: 'xml' is reserved and cannot be a processing instruction target")).into());
                }
            }
            self.builder.append_latin1(b"<?");
            self.builder.append_string(&target);
            match child.get(global, "data")? {
                None => {}
                Some(data) if data.is_null() => {}
                Some(data) if data.is_string() => {
                    let data = data.to_bun_string(global)?;
                    let len = data.length();
                    if len > 0 {
                        let mut i = 0;
                        let mut prev_q = false;
                        while i < len {
                            let (cp, w) = code_point_at(&data, i);
                            i += w;
                            if !xml::is_xml_char(cp) {
                                return Err(global.throw(format_args!("XML.stringify: XML cannot represent the character U+{:04X}", cp)).into());
                            }
                            if prev_q && cp == 0x3E {
                                return Err(global.throw(format_args!("XML.stringify: processing instruction data cannot contain '?>'")).into());
                            }
                            prev_q = cp == 0x3F;
                        }
                        self.builder.append_lchar(b' ');
                        self.builder.append_string(&data);
                    }
                }
                Some(_) => {
                    return Err(global
                        .throw(format_args!(
                            "XML.stringify: a processing instruction's 'data' must be a string"
                        ))
                        .into());
                }
            }
            self.builder.append_latin1(b"?>");
            return Ok(true);
        }
        Ok(false)
    }

    // ── compact object ─────────────────────────────────────────────────────

    /// `{ [root]: value }` → the root element.
    fn stringify_compact_document(
        &mut self,
        global: &JSGlobalObject,
        document: JSValue,
    ) -> StringifyResult<()> {
        self.mark_visiting(global, document)?;
        let result = self.stringify_compact_document_inner(global, document);
        self.visiting.remove(&document);
        result
    }

    fn stringify_compact_document_inner(
        &mut self,
        global: &JSGlobalObject,
        document: JSValue,
    ) -> StringifyResult<()> {
        let mut root: Option<(bun_core::StringView<'_>, JSValue)> = None;
        let iter =
            jsc::JSPropertyIterator::init(global, document.to_object(global)?, iter_options())?;
        while let Some((key, prop_value)) = iter.next()? {
            let value = prop_value.unwrap_boxed_primitive(global)?;
            if skipped(value) {
                continue;
            }
            if key.starts_with_ascii(b"@") || key.starts_with_ascii(b"#") {
                return Err(global
                    .throw(format_args!(
                        "XML.stringify: the top-level object is the document, so it can only contain the root element (found '{}')",
                        key
                    ))
                    .into());
            }
            if root.is_some() {
                return Err(global
                    .throw(format_args!("XML.stringify: an XML document has exactly one root element, but the top-level object has more than one key"))
                    .into());
            }
            if value.is_array() {
                return Err(global
                    .throw(format_args!("XML.stringify: the root element '{}' cannot be an array (an XML document has exactly one root element)", key))
                    .into());
            }
            root = Some((key, value));
        }
        let Some((name, value)) = root else {
            return Err(global
                .throw(format_args!(
                    "XML.stringify: the top-level object must have one key naming the root element"
                ))
                .into());
        };
        self.stringify_compact_element(global, &name, value, false)
    }

    /// Whether a compact property value produces any output: everything but
    /// skipped scalars, and arrays holding only those.
    fn has_output(global: &JSGlobalObject, value: JSValue) -> JsResult<bool> {
        let value = value.unwrap_boxed_primitive(global)?;
        if skipped(value) {
            return Ok(false);
        }
        if !value.is_array() {
            return Ok(true);
        }
        let mut iter = value.array_iterator(global)?;
        while let Some(item) = iter.next()? {
            let item = item.unwrap_boxed_primitive(global)?;
            if !skipped(item) {
                return Ok(true);
            }
        }
        Ok(false)
    }

    /// One `name: value` pair of a compact object as an element (or, for an
    /// array, one element per item). `separate` is whether the enclosing
    /// content is being indented, so array items go on their own lines.
    fn stringify_compact_element(
        &mut self,
        global: &JSGlobalObject,
        name: &BunString,
        value: JSValue,
        separate: bool,
    ) -> StringifyResult<()> {
        if !self.stack_check.is_safe_to_recurse() {
            return Err(StringifyError::StackOverflow);
        }
        let value = value.unwrap_boxed_primitive(global)?;
        if !value.is_object() || value.is_date() {
            return self.stringify_compact_leaf(global, name, value);
        }
        self.mark_visiting(global, value)?;
        let result = if value.is_array() {
            self.stringify_compact_array(global, name, value, separate)
        } else {
            self.stringify_compact_object(global, name, value)
        };
        self.visiting.remove(&value);
        result
    }

    /// One element per item that is not skipped.
    fn stringify_compact_array(
        &mut self,
        global: &JSGlobalObject,
        name: &BunString,
        value: JSValue,
        separate: bool,
    ) -> StringifyResult<()> {
        let mut iter = value.array_iterator(global)?;
        let mut first = true;
        while let Some(item) = iter.next()? {
            let item = item.unwrap_boxed_primitive(global)?;
            if skipped(item) {
                continue;
            }
            if item.is_array() {
                return Err(global
                    .throw(format_args!(
                        "XML.stringify: nested arrays cannot be represented (element '{}')",
                        name
                    ))
                    .into());
            }
            if !first && separate {
                self.newline();
            }
            first = false;
            self.stringify_compact_element(global, name, item, separate)?;
        }
        Ok(())
    }

    /// A scalar as `<name>text</name>` (or `<name/>`).
    fn stringify_compact_leaf(
        &mut self,
        global: &JSGlobalObject,
        name: &BunString,
        value: JSValue,
    ) -> StringifyResult<()> {
        self.check_name(global, name, "element")?;
        match self.scalar(global, value, "element content")? {
            Scalar::Skip => {}
            Scalar::Empty => self.append_empty_element(name),
            Scalar::Text(text) if text.length() == 0 => self.append_empty_element(name),
            Scalar::Text(text) => {
                self.builder.append_lchar(b'<');
                self.builder.append_string(name);
                self.builder.append_lchar(b'>');
                self.append_text(global, &text)?;
                self.append_end_tag(name);
            }
        }
        Ok(())
    }

    /// An object as `<name @attrs>children #text</name>`.
    fn stringify_compact_object(
        &mut self,
        global: &JSGlobalObject,
        name: &BunString,
        value: JSValue,
    ) -> StringifyResult<()> {
        self.check_name(global, name, "element")?;
        let object = value.to_object(global)?;

        // Pass 1: the start tag with `@` attributes; note what content follows.
        self.builder.append_lchar(b'<');
        self.builder.append_string(name);
        let mut has_elements = false;
        let mut has_text = false;
        let iter = jsc::JSPropertyIterator::init(global, object, iter_options())?;
        while let Some((key, child)) = iter.next()? {
            if skipped(child) {
                continue;
            }
            if key.starts_with_ascii(b"@") {
                match self.scalar(global, child, "an attribute value")? {
                    Scalar::Skip | Scalar::Empty => {}
                    Scalar::Text(text) => {
                        self.append_attribute(global, &key.substring(1), &text)?
                    }
                }
            } else if key.eq_ascii(b"#text") {
                match self.scalar(global, child, "#text")? {
                    Scalar::Text(text) if text.length() > 0 => has_text = true,
                    _ => {}
                }
            } else if key.starts_with_ascii(b"#") {
                return Err(global
                    .throw(format_args!("XML.stringify: unknown key '{}' (keys starting with '#' are reserved; text content is \"#text\")", key))
                    .into());
            } else if Self::has_output(global, child)? {
                has_elements = true;
            }
        }

        if !has_elements && !has_text {
            self.builder.append_latin1(b"/>");
            return Ok(());
        }
        self.builder.append_lchar(b'>');

        // Pass 2: child elements and text, in key order. Element-only
        // content is indented when pretty-printing.
        let pretty = self.space.is_pretty() && !has_text;
        if pretty {
            self.indent += 1;
        }
        let iter = jsc::JSPropertyIterator::init(global, object, iter_options())?;
        while let Some((key, child)) = iter.next()? {
            if skipped(child) || key.starts_with_ascii(b"@") {
                continue;
            }
            if key.eq_ascii(b"#text") {
                if let Scalar::Text(text) = self.scalar(global, child, "#text")? {
                    self.append_text(global, &text)?;
                }
                continue;
            }
            if !Self::has_output(global, child)? {
                continue;
            }
            if pretty {
                self.newline();
            }
            self.stringify_compact_element(global, &key, child, pretty)?;
        }
        if pretty {
            self.indent -= 1;
            self.newline();
        }
        self.append_end_tag(name);
        Ok(())
    }

    // ── values ─────────────────────────────────────────────────────────────

    /// The text form of a leaf value. `what` names the position for errors.
    fn scalar(
        &mut self,
        global: &JSGlobalObject,
        value: JSValue,
        what: &'static str,
    ) -> StringifyResult<Scalar> {
        let value = value.unwrap_boxed_primitive(global)?;
        if skipped(value) {
            return Ok(Scalar::Skip);
        }
        if value.is_null() {
            return Ok(Scalar::Empty);
        }
        if value.is_string() || value.is_number() || value.is_boolean() || value.is_big_int() {
            return Ok(Scalar::Text(value.to_bun_string(global)?));
        }
        if value.is_date() {
            let mut buf = [0u8; 64];
            let Some(iso) = value.to_iso_string(global, &mut buf) else {
                return Err(global
                    .throw(format_args!(
                        "XML.stringify cannot serialize an invalid Date"
                    ))
                    .into());
            };
            return Ok(Scalar::Text(BunString::clone_utf8(iso)));
        }
        Err(global
            .throw(format_args!(
                "XML.stringify: {} must be a string, number, boolean, bigint, Date, or null",
                what
            ))
            .into())
    }

    /// Element and attribute names must match the XML `Name` production, or
    /// the output would not parse.
    fn check_name(
        &mut self,
        global: &JSGlobalObject,
        name: &BunString,
        what: &'static str,
    ) -> StringifyResult<()> {
        let len = name.length();
        let mut valid = len > 0;
        let mut i = 0;
        while valid && i < len {
            let (cp, width) = code_point_at(name, i);
            valid = if i == 0 {
                xml::is_name_start_char(cp)
            } else {
                xml::is_name_char(cp)
            };
            i += width;
        }
        if valid {
            Ok(())
        } else {
            Err(global
                .throw(format_args!(
                    "XML.stringify: '{}' is not a valid XML {} name",
                    name, what
                ))
                .into())
        }
    }

    // ── output pieces ──────────────────────────────────────────────────────

    fn append_empty_element(&mut self, name: &BunString) {
        self.builder.append_lchar(b'<');
        self.builder.append_string(name);
        self.builder.append_latin1(b"/>");
    }

    fn append_end_tag(&mut self, name: &BunString) {
        self.builder.append_latin1(b"</");
        self.builder.append_string(name);
        self.builder.append_lchar(b'>');
    }

    /// ` name="value"` with `& < > "` and whitespace other than space
    /// escaped (tabs and newlines would otherwise be normalized to spaces
    /// when parsed back, §3.3.3).
    fn append_attribute(
        &mut self,
        global: &JSGlobalObject,
        name: &BunString,
        value: &BunString,
    ) -> StringifyResult<()> {
        self.check_name(global, name, "attribute")?;
        self.builder.append_lchar(b' ');
        self.builder.append_string(name);
        self.builder.append_latin1(b"=\"");
        self.append_escaped(global, value, true)?;
        self.builder.append_lchar(b'"');
        Ok(())
    }

    /// Character data with `& < >` and CR escaped (`>` for the `]]>` rule,
    /// CR because a literal one would be normalized to LF when parsed).
    fn append_text(&mut self, global: &JSGlobalObject, text: &BunString) -> StringifyResult<()> {
        self.append_escaped(global, text, false)
    }

    fn append_escaped(
        &mut self,
        global: &JSGlobalObject,
        text: &BunString,
        attribute: bool,
    ) -> StringifyResult<()> {
        let len = text.length();
        let mut i = 0;
        while i < len {
            let (cp, width) = code_point_at(text, i);
            i += width;
            match cp {
                0x26 => self.builder.append_latin1(b"&amp;"),
                0x3C => self.builder.append_latin1(b"&lt;"),
                0x3E => self.builder.append_latin1(b"&gt;"),
                0x22 if attribute => self.builder.append_latin1(b"&quot;"),
                0x09 if attribute => self.builder.append_latin1(b"&#x9;"),
                0x0A if attribute => self.builder.append_latin1(b"&#xA;"),
                0x0D => self.builder.append_latin1(b"&#xD;"),
                _ if !xml::is_xml_char(cp) => {
                    return Err(global
                        .throw(format_args!(
                            "XML.stringify: XML cannot represent the character U+{:04X}",
                            cp
                        ))
                        .into());
                }
                _ if cp >= 0x10000 => {
                    self.builder.append_uchar(text.char_at(i - 2));
                    self.builder.append_uchar(text.char_at(i - 1));
                }
                _ => self.builder.append_uchar(cp as u16),
            }
        }
        Ok(())
    }

    fn newline(&mut self) {
        match &self.space {
            Space::Minified => {}
            Space::Number(n) => {
                self.builder.append_lchar(b'\n');
                for _ in 0..(self.indent * (*n as usize)) {
                    self.builder.append_lchar(b' ');
                }
            }
            Space::Str(s) => {
                self.builder.append_lchar(b'\n');
                let clamped = s.trunc(10);
                for _ in 0..self.indent {
                    self.builder.append_string(&clamped);
                }
            }
        }
    }
}

/// The code point starting at UTF-16 index `i` and how many code units it
/// spans. Unpaired surrogates are returned as-is (and rejected by the `Char`
/// check).
fn code_point_at(s: &BunString, i: usize) -> (u32, usize) {
    let c = s.char_at(i);
    if strings::u16_is_lead(c) && i + 1 < s.length() {
        let next = s.char_at(i + 1);
        if strings::u16_is_trail(next) {
            return (strings::u16_get_supplementary(c, next), 2);
        }
    }
    (u32::from(c), 1)
}
