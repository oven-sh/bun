//! DOM node detection and markup printing for `bun test` output, after
//! pretty-format's `DOMElement` plugin (the serializer Jest applies to
//! jsdom / happy-dom nodes in snapshots and matcher messages).
//!
//! Detection is duck-typed on the value's class name and `nodeType`, the
//! same two reads the reference plugin makes. A custom element (a class
//! name outside the `HTML*Element` / `SVG*Element` pattern) qualifies when
//! `tagName` contains `-` or `hasAttribute("is")` is true.
//!
//! Both test-runner formatters (the snapshot serializer in
//! `pretty_format.rs` and the console formatter used for matcher messages)
//! call [`node_kind`] with the class name they already computed for the
//! object header, and print through [`print_node`].

use bun_core::{Utf8Bytes, strings};
use bun_jsc::{JSGlobalObject, JSValue, JsResult, StringJsc as _};

#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum NodeKind {
    Element,
    Text,
    Comment,
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

/// Classifies `value` as a DOM node. `class_name` is the value's computed
/// class name (`JSValue::get_class_name`). Returns `None` for anything that
/// does not duck-type as a node, without reading any property of a plain
/// object (`{}`) or of an instance whose class name is empty.
///
/// `#[inline(never)]`: this runs in the formatter's per-object arm, which
/// recurses once per nesting level. Keeping it out of line keeps that frame
/// small.
#[inline(never)]
pub(crate) fn node_kind(
    global: &JSGlobalObject,
    value: JSValue,
    class_name: &bun_core::String,
) -> JsResult<Option<NodeKind>> {
    if class_name.is_empty() || class_name.eq_ascii(b"Object") {
        return Ok(None);
    }
    let by_name = kind_for_class_name(&class_name.to_utf8());

    let Some(node_type) = value.get(global, "nodeType")? else {
        return Ok(None);
    };
    if !node_type.is_int32() {
        return Ok(None);
    }
    let node_type = node_type.to_int32();

    match by_name {
        Some(kind) => Ok((node_type == kind.node_type()).then_some(kind)),
        None if node_type == ELEMENT_NODE => {
            Ok(is_custom_element(global, value)?.then_some(NodeKind::Element))
        }
        None => Ok(None),
    }
}

fn is_custom_element(global: &JSGlobalObject, value: JSValue) -> JsResult<bool> {
    if let Some(tag_name) = value.get(global, "tagName")? {
        if tag_name.is_string() {
            let view = tag_name.to_js_string_view(global)?;
            if strings::contains_char(&view.to_utf8(), b'-') {
                return Ok(true);
            }
        }
    }
    if let Some(has_attribute) = value.get(global, "hasAttribute")? {
        if has_attribute.is_callable() {
            let is = bun_core::String::static_("is").to_js(global)?;
            return Ok(has_attribute.call(global, value, &[is])?.to_boolean());
        }
    }
    Ok(false)
}

/// The formatter-side operations [`print_node`] needs. `W` is the writer
/// type of the formatter (`dyn bun_io::Write` for the console formatter, a
/// concrete `W` for the snapshot serializer).
pub(crate) trait NodePrinter<W: bun_io::Write + ?Sized, const ANSI: bool> {
    fn write_indent(&self, writer: &mut W);
    /// Indents one level for attributes. Attributes do not count as depth.
    fn indent_push(&mut self);
    fn indent_pop(&mut self);
    /// Indents one level for child nodes and records one level of depth.
    fn children_push(&mut self);
    fn children_pop(&mut self);
    /// True when the formatter's depth limit is reached, so an element
    /// prints as the leaf `<tag … />`.
    fn depth_exceeded(&self) -> bool;
    /// Called before and after a node that spans several lines (one with
    /// attributes or children). The snapshot serializer uses it to put a
    /// top-level value on its own lines.
    fn multiline_start(&mut self, writer: &mut W);
    fn multiline_end(&mut self, writer: &mut W);
    /// Formats any value through the formatter's normal dispatch. A child
    /// node comes back through [`node_kind`] and [`print_node`].
    fn print_value(&mut self, writer: &mut W, value: JSValue) -> JsResult<()>;
}

impl<'f, 'w, const ANSI: bool> NodePrinter<dyn bun_io::Write + 'w, ANSI>
    for bun_jsc::Formatter<'f>
{
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
        self.format::<ANSI>(tag, writer, value, global)
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

/// Prints `value`, a node of `kind`, as markup:
///
/// ```text
/// <div
///   id="x"
/// >
///   text
///   <!--comment-->
///   <span />
/// </div>
/// ```
///
/// Attributes sort by name. Element and fragment children each start on
/// their own line. Text and comment data escape `<` and `>`.
///
/// `#[inline(never)]` for the same reason as [`node_kind`].
#[inline(never)]
pub(crate) fn print_node<P, W, const ANSI: bool>(
    printer: &mut P,
    global: &JSGlobalObject,
    writer: &mut W,
    value: JSValue,
    kind: NodeKind,
) -> JsResult<()>
where
    P: NodePrinter<W, ANSI>,
    W: bun_io::Write + ?Sized,
{
    match kind {
        NodeKind::Text => {
            let _ = writer.write_all(pf!("<r>").as_bytes());
            write_data(global, writer, value)?;
            return Ok(());
        }
        NodeKind::Comment => {
            let _ = writer.write_all(pf!("<r><d>").as_bytes());
            let _ = writer.write_all(b"<!--");
            write_data(global, writer, value)?;
            let _ = writer.write_all(b"-->");
            let _ = writer.write_all(pf!("<r>").as_bytes());
            return Ok(());
        }
        NodeKind::Element | NodeKind::Fragment => {}
    }

    let tag: Utf8Bytes<'static> = if kind == NodeKind::Fragment {
        Utf8Bytes::Borrowed(b"DocumentFragment")
    } else {
        match value.get(global, "tagName")? {
            Some(tag_name) if tag_name.is_string() => {
                let mut bytes = tag_name.to_utf8(global)?.to_vec();
                bytes.make_ascii_lowercase();
                Utf8Bytes::Owned(bytes)
            }
            _ => Utf8Bytes::Borrowed(b"unknown"),
        }
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

    let attribute_names = match kind {
        NodeKind::Element => attribute_names(global, value)?,
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
            let _ = writer.write_all(b"\n");
            printer.write_indent(writer);
            let child = children.get_index(global, i)?;
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

/// `value.attributes` with its attribute names sorted, paired with each
/// attribute's index in the collection. `None` when there are no attributes.
///
/// Names are copied out so that the sort holds no JS value across later
/// property reads. Values are read again by index when printed.
fn attribute_names(
    global: &JSGlobalObject,
    value: JSValue,
) -> JsResult<Option<(JSValue, Vec<(Utf8Bytes<'static>, u32)>)>> {
    let Some(attributes) = value.get(global, "attributes")?.filter(|v| v.is_object()) else {
        return Ok(None);
    };
    let count = index_length(global, attributes)?;
    let mut names: Vec<(Utf8Bytes<'static>, u32)> = Vec::with_capacity(count as usize);
    for i in 0..count {
        let attribute = attributes.get_index(global, i)?;
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

/// `collection.length` as a count for `get_index`. Non-integer or negative
/// lengths count as empty.
fn index_length(global: &JSGlobalObject, collection: JSValue) -> JsResult<u32> {
    Ok(match collection.get(global, "length")? {
        Some(length) if length.is_int32() => length.to_int32().max(0) as u32,
        _ => 0,
    })
}

/// Writes `value.data` with `<` and `>` escaped, as pretty-format's
/// `escapeHTML` does for text and comment nodes.
fn write_data<W: bun_io::Write + ?Sized>(
    global: &JSGlobalObject,
    writer: &mut W,
    value: JSValue,
) -> JsResult<()> {
    let Some(data) = value.get(global, "data")? else {
        return Ok(());
    };
    if !data.is_string() {
        return Ok(());
    }
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
