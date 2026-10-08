//! DOM nodes and collections, printed like pretty-format's `DOMElement` and `DOMCollection` plugins.

use core::cmp::Ordering;
use core::ffi::c_void;

use bun_core::{StackCheck, String, strings};
use bun_jsc::{
    JSGlobalObject, JSPropertyIterator, JSType, JSValue, JsError, JsResult,
    PropertyIteratorOptions, StringJsc as _, VM, console_object,
};

use super::pretty_format;

/// jest-matcher-utils `stringify`.
pub(crate) fn print_in_message(
    formatter: &mut console_object::Formatter<'_>,
    writer: &mut dyn bun_io::Write,
    value: JSValue,
) -> JsResult<bool> {
    const MAX_LENGTH: usize = 10_000;
    let global = formatter.global_this;
    if !is_dom(global, value)? {
        return Ok(false);
    }
    let depth = u32::from(formatter.depth);
    let (mut max_depth, mut max_width) = (10, 10);
    loop {
        let mut printer = Printer {
            global,
            host: &mut *formatter,
            out: Vec::new(),
            min: true,
            max_depth,
            max_width,
            // A UTF-16 code unit is at most 3 bytes of UTF-8.
            give_up_at: if max_depth > 1 || max_width > 1 {
                MAX_LENGTH * 3
            } else {
                usize::MAX
            },
        };
        if !printer.print_dom(value, 0, depth)? {
            return Ok(false);
        }
        let out = printer.out;
        if out.len() >= MAX_LENGTH && strings::element_length_utf8_into_utf16(&out) >= MAX_LENGTH {
            if max_depth > 1 {
                max_depth /= 2;
                continue;
            }
            if max_width > 1 {
                max_width /= 2;
                continue;
            }
        }
        formatter.add_for_new_line(out.len());
        let _ = writer.write_all(&out);
        return Ok(true);
    }
}

/// jest-snapshot `serialize`.
pub(crate) fn print_in_snapshot(
    formatter: &mut pretty_format::Formatter<'_>,
    writer: &mut dyn bun_io::Write,
    value: JSValue,
) -> JsResult<bool> {
    if !is_dom(formatter.global_this, value)? {
        return Ok(false);
    }
    let indent = formatter.indent;
    let mut printer = Printer {
        global: formatter.global_this,
        host: formatter,
        out: Vec::new(),
        min: false,
        max_depth: u32::MAX,
        max_width: u32::MAX,
        give_up_at: usize::MAX,
    };
    if !printer.print_dom(value, indent, 0)? {
        return Ok(false);
    }
    let out = printer.out;
    let extra_line_breaks = indent == 0 && strings::contains_char(&out, b'\n');
    if extra_line_breaks {
        let _ = writer.write_all(b"\n");
    }
    let _ = writer.write_all(&out);
    if extra_line_breaks {
        let _ = writer.write_all(b"\n");
    }
    Ok(true)
}

/// The formatter that met the DOM value. It prints what is not DOM.
trait Host {
    fn print(&mut self, out: &mut Vec<u8>, value: JSValue, indent: u32) -> JsResult<()>;
}

impl Host for console_object::Formatter<'_> {
    fn print(&mut self, out: &mut Vec<u8>, value: JSValue, _indent: u32) -> JsResult<()> {
        let global = self.global_this;
        let tag = console_object::Tag::get(value, global)?;
        let prev_single_line = core::mem::replace(&mut self.single_line, true);
        let result = self.format::<false>(tag, out, value, global);
        self.single_line = prev_single_line;
        result
    }
}

impl Host for pretty_format::Formatter<'_> {
    fn print(&mut self, out: &mut Vec<u8>, value: JSValue, indent: u32) -> JsResult<()> {
        let global = self.global_this;
        let tag = pretty_format::Tag::get(value, global)?;
        let mut bridge = bun_io::AsFmt::new(out);
        let mut writer = bun_io::write::FmtAdapter::new(&mut bridge);
        let (prev_indent, prev_quote_strings) = (self.indent, self.quote_strings);
        self.indent = indent;
        self.quote_strings = true;
        let result = self.format::<_, false>(tag, &mut writer, value, global);
        self.indent = prev_indent;
        self.quote_strings = prev_quote_strings;
        result
    }
}

enum Dom {
    Element { tag_name: String },
    Fragment,
    Text { data: String },
    Comment { data: String },
    List { name: String },
    NamedNodeMap { name: String },
    Record { name: String },
}

/// For the values a formatter meets: one whose properties throw prints as it did before.
fn is_dom(global: &JSGlobalObject, value: JSValue) -> JsResult<bool> {
    match classify(global, value) {
        Ok(dom) => Ok(dom.is_some()),
        Err(JsError::Thrown) if global.clear_exception_except_termination() => Ok(false),
        Err(error) => Err(error),
    }
}

fn classify(global: &JSGlobalObject, value: JSValue) -> JsResult<Option<Dom>> {
    if !matches!(
        value.js_type(),
        JSType::FinalObject | JSType::ProxyObject | JSType::Array
    ) {
        return Ok(None);
    }
    // `get` does not look at `Object.prototype`, so a plain object has none. An array has a native one.
    let Some(constructor) = value.get(global, "constructor")? else {
        return Ok(None);
    };
    if constructor.js_type() == JSType::InternalFunction {
        return Ok(None);
    }
    let name = string_property(global, constructor, "name")?.unwrap_or(String::EMPTY);
    let node_type = match value.get(global, "nodeType")? {
        Some(node_type) if node_type.is_number() => node_type.as_number(),
        _ => 0.0,
    };

    if node_type == 1.0 {
        let Some(tag_name) = string_property(global, value, "tagName")? else {
            return Ok(None);
        };
        let is_element = is_element_name(name.to_utf8().slice())
            || tag_name.index_of_ascii_char(b'-').is_some()
            || has_is_attribute(global, value)?;
        return Ok(is_element.then_some(Dom::Element { tag_name }));
    }
    if node_type == 3.0 && name.eq_ascii(b"Text") {
        return Ok(string_property(global, value, "data")?.map(|data| Dom::Text { data }));
    }
    if node_type == 8.0 && name.eq_ascii(b"Comment") {
        return Ok(string_property(global, value, "data")?.map(|data| Dom::Comment { data }));
    }
    if node_type == 11.0 && name.eq_ascii(b"DocumentFragment") {
        return Ok(Some(Dom::Fragment));
    }

    if name.eq_ascii(b"NamedNodeMap") {
        return Ok(Some(Dom::NamedNodeMap { name }));
    }
    // pretty-format has no plugin for a DOMTokenList, and prints it as the object it is.
    if name.eq_ascii(b"DOMStringMap") || name.eq_ascii(b"DOMTokenList") {
        return Ok(Some(Dom::Record { name }));
    }
    let is_list = is_list_name(name.to_utf8().slice());
    Ok(is_list.then_some(Dom::List { name }))
}

fn string_property(
    global: &JSGlobalObject,
    object: JSValue,
    name: &str,
) -> JsResult<Option<String>> {
    match object.get(global, name)? {
        Some(value) if value.is_string() => Ok(Some(value.to_bun_string(global)?)),
        _ => Ok(None),
    }
}

fn has_is_attribute(global: &JSGlobalObject, value: JSValue) -> JsResult<bool> {
    match value.get(global, "hasAttribute")? {
        Some(has_attribute) if has_attribute.is_callable() => Ok(has_attribute
            .call(global, value, &[String::static_("is").to_js(global)?])?
            .to_boolean()),
        _ => Ok(false),
    }
}

fn is_word(bytes: &[u8]) -> bool {
    bytes
        .iter()
        .all(|byte| byte.is_ascii_alphanumeric() || *byte == b'_')
}

/// `/^((HTML|SVG)\w*)?Element$/`
fn is_element_name(name: &[u8]) -> bool {
    name.strip_suffix(b"Element").is_some_and(|prefix| {
        prefix.is_empty()
            || ((prefix.starts_with(b"HTML") || prefix.starts_with(b"SVG")) && is_word(prefix))
    })
}

/// `/^(HTML\w*Collection|NodeList)$/`
fn is_list_name(name: &[u8]) -> bool {
    name == b"NodeList"
        || name
            .strip_prefix(b"HTML")
            .and_then(|rest| rest.strip_suffix(b"Collection"))
            .is_some_and(is_word)
}

/// The order of `Array.prototype.sort` without a comparator.
fn compare_code_units(a: &String, b: &String) -> Ordering {
    let (a, b) = (a.to_encoded_slice(), b.to_encoded_slice());
    (0..a.len.min(b.len))
        .map(|i| a.char_at(i).cmp(&b.char_at(i)))
        .find(|order| order.is_ne())
        .unwrap_or(a.len.cmp(&b.len))
}

fn length_of(global: &JSGlobalObject, list: JSValue) -> JsResult<u32> {
    Ok(match list.get(global, "length")? {
        Some(length) if length.is_number() => length.as_number() as u32,
        _ => 0,
    })
}

/// The items `Array.from(list)` has: what its iterator yields, or its indexes when it has none.
fn for_each_item(
    global: &JSGlobalObject,
    list: JSValue,
    each: &mut dyn FnMut(JSValue) -> JsResult<()>,
) -> JsResult<()> {
    struct Iteration<'a> {
        each: &'a mut dyn FnMut(JSValue) -> JsResult<()>,
        result: JsResult<()>,
    }
    extern "C" fn next(_: *mut VM, _: &JSGlobalObject, iteration: *mut c_void, item: JSValue) {
        // SAFETY: `iteration` is the `Iteration` below, which outlives the `for_each` call.
        let iteration = unsafe { &mut *iteration.cast::<Iteration<'_>>() };
        if iteration.result.is_ok() {
            iteration.result = (iteration.each)(item);
        }
    }

    if !list.is_object() {
        return Ok(());
    }
    if list.is_iterable(global)? {
        let mut iteration = Iteration {
            each,
            result: Ok(()),
        };
        list.for_each(global, (&raw mut iteration).cast::<c_void>(), next)?;
        return iteration.result;
    }
    for i in 0..length_of(global, list)? {
        let item = list.get_index(global, i)?;
        if item.is_undefined() {
            break;
        }
        each(item)?;
    }
    Ok(())
}

enum Printed {
    String(String),
    Other(Vec<u8>),
}

type Entries = Vec<(String, Printed)>;

struct Printer<'a> {
    global: &'a JSGlobalObject,
    host: &'a mut dyn Host,
    out: Vec<u8>,
    /// pretty-format's `min` option: everything on one line.
    min: bool,
    max_depth: u32,
    max_width: u32,
    /// With this many bytes in `out`, it is too long to be used and the rest of it does not matter.
    give_up_at: usize,
}

impl Printer<'_> {
    /// False, with nothing written, when `value` is not DOM.
    fn print_dom(&mut self, value: JSValue, indent: u32, depth: u32) -> JsResult<bool> {
        if !StackCheck::init().is_safe_to_recurse() {
            return Err(self.global.throw_stack_overflow());
        }
        if self.out.len() >= self.give_up_at {
            return Ok(true);
        }
        let Some(dom) = classify(self.global, value)? else {
            return Ok(false);
        };
        match dom {
            Dom::Text { data } => self.write_text(&data),
            Dom::Comment { data } => {
                self.out.extend_from_slice(b"<!--");
                self.write_text(&data);
                self.out.extend_from_slice(b"-->");
            }
            Dom::Element { tag_name } => {
                let mut tag = tag_name.to_utf8().slice().to_vec();
                if strings::is_all_ascii(&tag) {
                    tag.make_ascii_lowercase();
                } else {
                    tag = std::string::String::from_utf8_lossy(&tag)
                        .to_lowercase()
                        .into_bytes();
                }
                self.print_element(value, &tag, true, indent, depth)?;
            }
            Dom::Fragment => {
                self.print_element(value, b"DocumentFragment", false, indent, depth)?
            }
            Dom::List { name } => {
                if self.open_collection(&name, b'[', depth) {
                    self.print_items(value, indent, depth + 1)?;
                    self.out.push(b']');
                }
            }
            Dom::NamedNodeMap { name } => {
                if self.open_collection(&name, b'{', depth) {
                    let attributes = self.read_attributes(value, indent + 1, depth + 1)?;
                    self.print_entries(&attributes, indent);
                    self.out.push(b'}');
                }
            }
            Dom::Record { name } => {
                if self.open_collection(&name, b'{', depth) {
                    let properties = self.read_properties(value, indent + 1, depth + 1)?;
                    self.print_entries(&properties, indent);
                    self.out.push(b'}');
                }
            }
        }
        Ok(true)
    }

    fn print_value(&mut self, value: JSValue, indent: u32, depth: u32) -> JsResult<()> {
        if value.is_string() {
            self.write_quoted(&value.to_bun_string(self.global)?);
        } else if !self.print_dom(value, indent, depth)? {
            self.host.print(&mut self.out, value, indent)?;
        }
        Ok(())
    }

    fn print_element(
        &mut self,
        node: JSValue,
        tag: &[u8],
        has_attributes: bool,
        indent: u32,
        depth: u32,
    ) -> JsResult<()> {
        self.out.push(b'<');
        self.out.extend_from_slice(tag);
        if depth >= self.max_depth {
            self.out.extend_from_slice(" \u{2026} />".as_bytes());
            return Ok(());
        }
        let depth = depth + 1;

        let attributes = match if has_attributes {
            node.get(self.global, "attributes")?
        } else {
            None
        } {
            Some(attributes) => self.read_attributes(attributes, indent + 2, depth)?,
            None => Entries::new(),
        };
        for same_name in attributes.chunk_by(|a, b| a.0.eql(&b.0)) {
            for (name, _) in same_name {
                self.item_line(indent + 1);
                self.out.extend_from_slice(name.to_utf8().slice());
                self.out.push(b'=');
                match &same_name[same_name.len() - 1].1 {
                    Printed::String(value) => self.write_quoted(value),
                    Printed::Other(value) => {
                        let multiline = strings::contains_char(value, b'\n');
                        self.out.push(b'{');
                        if multiline {
                            self.line(indent + 2);
                        }
                        self.out.extend_from_slice(value);
                        if multiline {
                            self.line(indent + 1);
                        }
                        self.out.push(b'}');
                    }
                }
            }
        }
        if !attributes.is_empty() {
            self.line(indent);
        }

        let end_of_open_tag = self.out.len();
        self.out.push(b'>');
        let mut children = node
            .get(self.global, "childNodes")?
            .filter(|list| list.is_object());
        if children.is_none() {
            children = node
                .get(self.global, "children")?
                .filter(|list| list.is_object());
        }
        if let Some(children) = children {
            for i in 0..length_of(self.global, children)? {
                let child = children.get_index(self.global, i)?;
                if child.is_undefined() || self.out.len() >= self.give_up_at {
                    break;
                }
                self.line(indent + 1);
                if child.is_string() {
                    self.write_text(&child.to_bun_string(self.global)?);
                } else {
                    self.print_value(child, indent + 1, depth)?;
                }
            }
        }

        if self.out.len() == end_of_open_tag + 1 {
            self.out.truncate(end_of_open_tag);
            if attributes.is_empty() || self.min {
                self.out.push(b' ');
            }
            self.out.extend_from_slice(b"/>");
        } else {
            self.line(indent);
            self.out.extend_from_slice(b"</");
            self.out.extend_from_slice(tag);
            self.out.push(b'>');
        }
        Ok(())
    }

    /// False when the collection is too deep to list.
    fn open_collection(&mut self, name: &String, bracket: u8, depth: u32) -> bool {
        let name = name.to_utf8();
        if depth >= self.max_depth {
            self.out.push(b'[');
            self.out.extend_from_slice(name.slice());
            self.out.push(b']');
            return false;
        }
        if !self.min {
            self.out.extend_from_slice(name.slice());
            self.out.push(b' ');
        }
        self.out.push(bracket);
        true
    }

    fn print_items(&mut self, list: JSValue, indent: u32, depth: u32) -> JsResult<()> {
        let mut count: u32 = 0;
        for_each_item(self.global, list, &mut |item| {
            if count <= self.max_width {
                self.separate(count == 0, indent + 1);
                if count == self.max_width {
                    self.out.extend_from_slice("\u{2026}".as_bytes());
                } else {
                    self.print_value(item, indent + 1, depth)?;
                }
            }
            count = count.saturating_add(1);
            Ok(())
        })?;
        if count > 0 {
            self.close(indent);
        }
        Ok(())
    }

    fn print_entries(&mut self, entries: &Entries, indent: u32) {
        for (i, same_key) in entries.chunk_by(|a, b| a.0.eql(&b.0)).enumerate() {
            self.separate(i == 0, indent + 1);
            self.write_quoted(&same_key[0].0);
            self.out.extend_from_slice(b": ");
            match &same_key[same_key.len() - 1].1 {
                Printed::String(value) => self.write_quoted(value),
                Printed::Other(value) => self.out.extend_from_slice(value),
            }
        }
        if !entries.is_empty() {
            self.close(indent);
        }
    }

    /// The `name` and `value` of each `Attr`, sorted by name.
    fn read_attributes(
        &mut self,
        attributes: JSValue,
        indent: u32,
        depth: u32,
    ) -> JsResult<Entries> {
        let mut entries = Entries::new();
        let global = self.global;
        for_each_item(global, attributes, &mut |attribute| {
            if attribute.is_object() {
                let name = attribute.get(global, "name")?.unwrap_or(JSValue::UNDEFINED);
                let name = name.to_bun_string(global)?;
                let value = attribute
                    .get(global, "value")?
                    .unwrap_or(JSValue::UNDEFINED);
                entries.push((name, self.capture(value, indent, depth)?));
            }
            Ok(())
        })?;
        entries.sort_by(|a, b| compare_code_units(&a.0, &b.0));
        Ok(entries)
    }

    /// Own enumerable string-keyed properties, sorted by key.
    fn read_properties(&mut self, object: JSValue, indent: u32, depth: u32) -> JsResult<Entries> {
        let mut entries = Entries::new();
        let Some(cell) = object.get_object() else {
            return Ok(entries);
        };
        let properties = JSPropertyIterator::init(
            self.global,
            cell,
            PropertyIteratorOptions {
                skip_empty_name: false,
                include_value: true,
            },
        )?;
        while let Some((key, value)) = properties.next()? {
            entries.push((String::clone(&key), self.capture(value, indent, depth)?));
        }
        entries.sort_by(|a, b| compare_code_units(&a.0, &b.0));
        Ok(entries)
    }

    fn capture(&mut self, value: JSValue, indent: u32, depth: u32) -> JsResult<Printed> {
        if value.is_string() {
            return Ok(Printed::String(value.to_bun_string(self.global)?));
        }
        let start = self.out.len();
        self.print_value(value, indent, depth)?;
        Ok(Printed::Other(self.out.split_off(start)))
    }

    /// `spacingOuter + indentation`
    fn line(&mut self, indent: u32) {
        if !self.min {
            self.out.push(b'\n');
            self.out.resize(self.out.len() + indent as usize * 2, b' ');
        }
    }

    /// `spacingInner + indentation`
    fn item_line(&mut self, indent: u32) {
        if self.min {
            self.out.push(b' ');
        } else {
            self.line(indent);
        }
    }

    fn separate(&mut self, is_first: bool, indent: u32) {
        if is_first {
            self.line(indent);
        } else {
            self.out.push(b',');
            self.item_line(indent);
        }
    }

    fn close(&mut self, indent: u32) {
        if !self.min {
            self.out.push(b',');
        }
        self.line(indent);
    }

    fn write_text(&mut self, text: &String) {
        self.write_replacing(text, if self.min { b"<>" } else { b"<>\r" });
    }

    /// `escapeString` is on in a message and off in a snapshot.
    fn write_quoted(&mut self, text: &String) {
        self.out.push(b'"');
        self.write_replacing(text, if self.min { b"\"\\" } else { b"\r" });
        self.out.push(b'"');
    }

    fn write_replacing(&mut self, text: &String, special: &[u8]) {
        let utf8 = text.to_utf8();
        let mut rest = utf8.slice();
        while let Some(i) = strings::index_of_any(rest, special) {
            self.out.extend_from_slice(&rest[..i]);
            let (replacement, replaced): (&[u8], usize) = match rest[i] {
                b'<' => (b"&lt;", 1),
                b'>' => (b"&gt;", 1),
                b'"' => (b"\\\"", 1),
                b'\\' => (b"\\\\", 1),
                // jest-snapshot `normalizeNewlines`
                _ => (
                    b"\n",
                    if rest.get(i + 1) == Some(&b'\n') {
                        2
                    } else {
                        1
                    },
                ),
            };
            self.out.extend_from_slice(replacement);
            rest = &rest[i + replaced..];
        }
        self.out.extend_from_slice(rest);
    }
}
