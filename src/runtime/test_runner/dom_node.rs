//! DOM nodes (jsdom, happy-dom) as markup in `bun test` output, after
//! pretty-format's `DOMElement` plugin. Both test-runner formatters call
//! [`as_node`] with the class name they already computed, then [`print_node`].

use bun_core::{Utf8Bytes, strings};
use bun_jsc::{JSGlobalObject, JSValue, JsError, JsResult, StringJsc as _};

#[derive(Copy, Clone, PartialEq, Eq)]
enum NodeKind {
    Element,
    Text,
    Comment,
    Fragment,
}

/// A DOM node with the string its markup starts from. [`as_node`] reads that
/// string once and [`print_node`] does not read it again.
#[derive(Copy, Clone)]
pub(crate) enum Node {
    /// With its `tagName`.
    Element(JSValue),
    /// With its `data`.
    Text(JSValue),
    /// With its `data`.
    Comment(JSValue),
    Fragment,
}

const ELEMENT_NODE: i32 = 1;
const TEXT_NODE: i32 = 3;
const COMMENT_NODE: i32 = 8;
const FRAGMENT_NODE: i32 = 11;

impl NodeKind {
    const fn node_type(self) -> i32 {
        match self {
            NodeKind::Element => ELEMENT_NODE,
            NodeKind::Text => TEXT_NODE,
            NodeKind::Comment => COMMENT_NODE,
            NodeKind::Fragment => FRAGMENT_NODE,
        }
    }
}

/// `/^((HTML|SVG)\w*)?Element$/`, `Text`, `Comment`, `DocumentFragment`.
fn kind_for_class_name(name: &[u8]) -> Option<NodeKind> {
    if let Some(stem) = name.strip_suffix(b"Element") {
        if stem.is_empty() {
            return Some(NodeKind::Element);
        }
        let middle = stem
            .strip_prefix(b"HTML")
            .or_else(|| stem.strip_prefix(b"SVG"))?;
        return middle
            .iter()
            .all(|b| b.is_ascii_alphanumeric() || *b == b'_')
            .then_some(NodeKind::Element);
    }
    match name {
        b"Text" => Some(NodeKind::Text),
        b"Comment" => Some(NodeKind::Comment),
        b"DocumentFragment" => Some(NodeKind::Fragment),
        _ => None,
    }
}

/// `None` unless `value` duck-types as a node, or a getter it reads throws.
/// `#[inline(never)]` keeps the recursive per-object formatter frame small.
#[inline(never)]
pub(crate) fn as_node(
    global: &JSGlobalObject,
    value: JSValue,
    class_name: &bun_core::String,
) -> JsResult<Option<Node>> {
    if class_name.is_empty() || class_name.eq_ascii(b"Object") {
        return Ok(None);
    }
    match as_node_inner(global, value, class_name) {
        Ok(node) => Ok(node),
        Err(JsError::Thrown) if global.clear_exception_except_termination() => Ok(None),
        Err(err) => Err(err),
    }
}

fn as_node_inner(
    global: &JSGlobalObject,
    value: JSValue,
    class_name: &bun_core::String,
) -> JsResult<Option<Node>> {
    let by_name = kind_for_class_name(&class_name.to_utf8());

    let Some(node_type) = value.get(global, "nodeType")? else {
        return Ok(None);
    };
    if !node_type.is_int32() {
        return Ok(None);
    }
    let node_type = node_type.to_int32();

    match by_name {
        Some(kind) if node_type != kind.node_type() => Ok(None),
        Some(NodeKind::Fragment) => Ok(Some(Node::Fragment)),
        Some(NodeKind::Text) => Ok(string_property(global, value, "data")?.map(Node::Text)),
        Some(NodeKind::Comment) => Ok(string_property(global, value, "data")?.map(Node::Comment)),
        Some(NodeKind::Element) => {
            Ok(string_property(global, value, "tagName")?.map(Node::Element))
        }
        None if node_type == ELEMENT_NODE => {
            let Some(tag_name) = string_property(global, value, "tagName")? else {
                return Ok(None);
            };
            Ok(is_custom_element(global, value, tag_name)?.then_some(Node::Element(tag_name)))
        }
        None => Ok(None),
    }
}

fn string_property(
    global: &JSGlobalObject,
    value: JSValue,
    name: &'static str,
) -> JsResult<Option<JSValue>> {
    Ok(value
        .get(global, name)?
        .filter(|property| property.is_string()))
}

/// A dash in the tag name, or an `is` attribute.
fn is_custom_element(global: &JSGlobalObject, value: JSValue, tag_name: JSValue) -> JsResult<bool> {
    if strings::contains_char(&tag_name.to_js_string_view(global)?.to_utf8(), b'-') {
        return Ok(true);
    }
    if let Some(has_attribute) = value.get(global, "hasAttribute")? {
        if has_attribute.is_callable() {
            let is = bun_core::String::static_("is").to_js(global)?;
            return Ok(has_attribute.call(global, value, &[is])?.to_boolean());
        }
    }
    Ok(false)
}

/// What [`print_node`] needs from a formatter.
pub(crate) trait NodePrinter<W: bun_io::Write + ?Sized, const ANSI: bool> {
    fn write_indent(&self, writer: &mut W);
    /// Indent for attributes (no depth).
    fn indent_push(&mut self);
    fn indent_pop(&mut self);
    /// Indent and depth for child nodes.
    fn children_push(&mut self);
    fn children_pop(&mut self);
    /// At the depth limit an element prints as `<tag … />`.
    fn depth_exceeded(&self) -> bool;
    /// Around a node that spans several lines.
    fn multiline_start(&mut self, writer: &mut W);
    fn multiline_end(&mut self, writer: &mut W);
    /// The formatter's normal dispatch for any value.
    fn print_value(&mut self, writer: &mut W, value: JSValue) -> JsResult<()>;
}

impl<'f, 'w> NodePrinter<dyn bun_io::Write + 'w, false> for bun_jsc::Formatter<'f> {
    fn write_indent(&self, writer: &mut (dyn bun_io::Write + 'w)) {
        let _ = bun_jsc::Formatter::write_indent(self, writer);
    }
    fn indent_push(&mut self) {
        bun_jsc::ConsoleFormatter::indent_inc(self);
    }
    fn indent_pop(&mut self) {
        bun_jsc::ConsoleFormatter::indent_dec(self);
    }
    fn children_push(&mut self) {
        bun_jsc::ConsoleFormatter::indent_inc(self);
        self.depth += 1;
    }
    fn children_pop(&mut self) {
        bun_jsc::ConsoleFormatter::indent_dec(self);
        self.depth = self.depth.saturating_sub(1);
    }
    fn depth_exceeded(&self) -> bool {
        bun_jsc::Formatter::depth_exceeded(self)
    }
    fn multiline_start(&mut self, _writer: &mut (dyn bun_io::Write + 'w)) {}
    fn multiline_end(&mut self, _writer: &mut (dyn bun_io::Write + 'w)) {}
    fn print_value(
        &mut self,
        writer: &mut (dyn bun_io::Write + 'w),
        value: JSValue,
    ) -> JsResult<()> {
        let global = self.global_this;
        let tag = bun_jsc::console_object::formatter::Tag::get(value, global)?;
        self.format::<false>(tag, writer, value, global)
    }
}

macro_rules! pf {
    ($s:literal) => {
        if ANSI {
            ::bun_core::pretty_fmt!($s, true)
        } else {
            ::bun_core::pretty_fmt!($s, false)
        }
    };
}

/// Prints `value` as markup: attributes sorted by name and one per line,
/// children one per line, text and comment data with `<` and `>` escaped.
#[inline(never)]
pub(crate) fn print_node<P, W, const ANSI: bool>(
    printer: &mut P,
    global: &JSGlobalObject,
    writer: &mut W,
    value: JSValue,
    node: Node,
) -> JsResult<()>
where
    P: NodePrinter<W, ANSI>,
    W: bun_io::Write + ?Sized,
{
    let tag: Utf8Bytes<'static> = match node {
        Node::Text(data) => {
            let _ = writer.write_all(pf!("<r>").as_bytes());
            return write_data(global, writer, data);
        }
        Node::Comment(data) => {
            let _ = writer.write_all(pf!("<r><d>").as_bytes());
            let _ = writer.write_all(b"<!--");
            write_data(global, writer, data)?;
            let _ = writer.write_all(b"-->");
            let _ = writer.write_all(pf!("<r>").as_bytes());
            return Ok(());
        }
        Node::Element(tag_name) => {
            let mut bytes = tag_name.to_utf8(global)?.to_vec();
            bytes.make_ascii_lowercase();
            Utf8Bytes::Owned(bytes)
        }
        Node::Fragment => Utf8Bytes::Borrowed(b"DocumentFragment"),
    };

    if printer.depth_exceeded() {
        let _ = write!(
            writer,
            "{}<{}{} \u{2026}{} />{}",
            pf!("<r><cyan>"),
            bstr::BStr::new(&tag),
            pf!("<r>"),
            pf!("<cyan>"),
            pf!("<r>"),
        );
        return Ok(());
    }

    let attribute_names = match node {
        Node::Element(_) => attribute_names(global, value)?,
        _ => None,
    };
    let children = value.get(global, "childNodes")?.filter(|v| v.is_object());
    let child_count = match children {
        Some(children) => index_length(global, children)?,
        None => 0,
    };
    let multiline = attribute_names.is_some() || child_count > 0;

    if multiline {
        printer.multiline_start(writer);
    }
    let _ = write!(
        writer,
        "{}<{}{}",
        pf!("<r><cyan>"),
        bstr::BStr::new(&tag),
        pf!("<r>")
    );

    if let Some((attributes, names)) = &attribute_names {
        printer.indent_push();
        let result: JsResult<()> = (|| {
            for (name, i) in names {
                let _ = writer.write_all(b"\n");
                printer.write_indent(writer);
                let _ = write!(
                    writer,
                    "{}{}{}={}",
                    pf!("<yellow>"),
                    bstr::BStr::new(name),
                    pf!("<r>"),
                    pf!("<green>"),
                );
                let attribute = attributes.get_index(global, *i)?;
                let attribute_value = attribute
                    .get(global, "value")?
                    .unwrap_or(JSValue::UNDEFINED);
                printer.print_value(writer, attribute_value)?;
                let _ = writer.write_all(pf!("<r>").as_bytes());
            }
            Ok(())
        })();
        printer.indent_pop();
        result?;
        let _ = writer.write_all(b"\n");
        printer.write_indent(writer);
    }

    if child_count == 0 {
        let _ = write!(
            writer,
            "{}{}/>{}",
            pf!("<cyan>"),
            if attribute_names.is_some() { "" } else { " " },
            pf!("<r>"),
        );
        if multiline {
            printer.multiline_end(writer);
        }
        return Ok(());
    }
    let children = children.expect("child_count > 0 implies childNodes is an object");

    let _ = write!(writer, "{}>{}", pf!("<cyan>"), pf!("<r>"));
    printer.children_push();
    let result: JsResult<()> = (|| {
        for i in 0..child_count {
            let child = children.get_index(global, i)?;
            // A `length` past the last index ends the list.
            if child.is_undefined() {
                break;
            }
            let _ = writer.write_all(b"\n");
            printer.write_indent(writer);
            printer.print_value(writer, child)?;
        }
        Ok(())
    })();
    printer.children_pop();
    result?;

    let _ = writer.write_all(b"\n");
    printer.write_indent(writer);
    let _ = write!(
        writer,
        "{}</{}>{}",
        pf!("<cyan>"),
        bstr::BStr::new(&tag),
        pf!("<r>"),
    );
    printer.multiline_end(writer);
    Ok(())
}

/// Attribute names sorted, each with its index in `value.attributes`.
/// Values are read again by index when printed, so no `JSValue` is held in
/// the heap across later property reads.
fn attribute_names(
    global: &JSGlobalObject,
    value: JSValue,
) -> JsResult<Option<(JSValue, Vec<(Utf8Bytes<'static>, u32)>)>> {
    let Some(attributes) = value.get(global, "attributes")?.filter(|v| v.is_object()) else {
        return Ok(None);
    };
    let count = index_length(global, attributes)?;
    let mut names: Vec<(Utf8Bytes<'static>, u32)> = Vec::new();
    for i in 0..count {
        let attribute = attributes.get_index(global, i)?;
        if attribute.is_undefined() {
            break;
        }
        if !attribute.is_object() {
            continue;
        }
        let Some(name) = attribute.get(global, "name")? else {
            continue;
        };
        if !name.is_string() {
            continue;
        }
        names.push((name.to_utf8(global)?, i));
    }
    if names.is_empty() {
        return Ok(None);
    }
    names.sort_by(|a, b| a.0[..].cmp(&b.0[..]));
    Ok(Some((attributes, names)))
}

fn index_length(global: &JSGlobalObject, collection: JSValue) -> JsResult<u32> {
    Ok(match collection.get(global, "length")? {
        Some(length) if length.is_int32() => length.to_int32().max(0) as u32,
        _ => 0,
    })
}

/// `data` with `<` and `>` escaped.
fn write_data<W: bun_io::Write + ?Sized>(
    global: &JSGlobalObject,
    writer: &mut W,
    data: JSValue,
) -> JsResult<()> {
    let view = data.to_js_string_view(global)?;
    let utf8 = view.to_utf8();
    let mut rest: &[u8] = &utf8;
    while let Some(i) = strings::index_of_any(rest, b"<>") {
        let _ = writer.write_all(&rest[..i]);
        let _ = writer.write_all(if rest[i] == b'<' { b"&lt;" } else { b"&gt;" });
        rest = &rest[i + 1..];
    }
    let _ = writer.write_all(rest);
    Ok(())
}
