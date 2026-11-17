//! <https://html.spec.whatwg.org/#printing>

use bun_core::strings;

use super::*;
use crate::api::events::{fire, queue_task_for};
use crate::generated_bindgen::canvas::HTMLCanvasElement;

/// With what scripts have drawn, and the rules that they have inserted.
fn markup_to_print<'a>(cx: Cx<'_, 'a>, doc: &'a Doc) -> Result<'a, String> {
    let heap = JsHeap::from_global(doc.global());
    let canvases = List::from_nodes(
        heap,
        doc.elements_with_objects()
            .filter(|it| HTMLCanvasElement::is(it.to_js()))
            .map(|it| &**it),
    );
    let mut canvases = canvases
        .values()
        .filter_map(|it| HTMLCanvasElement::from_js(heap, it));
    let markup = doc
        .document_element()
        .map(|it| it.get_outer_html(cx))
        .transpose()?;
    let markup = markup
        .map(|it| DomString::from_js_string(&cx.heap, it))
        .transpose()?
        .unwrap_or_default();
    let markup = markup.to_utf8();
    let (mut rest, mut out) = (markup.as_bytes(), Vec::new());
    while let Some((before, from_tag)) = strings::split_once(rest, b"<canvas")
        && let Some((attributes, contents)) = strings::split_once_char(from_tag, b'>')
        && let Some((_, after)) = strings::split_once(contents, b"</canvas>")
    {
        let picture = match canvases
            .next()
            .map(|it| it.to_data_url(cx, b"image/png", JsLocal::new(&cx.heap, JSValue::UNDEFINED)))
        {
            Some(Ok(picture)) => picture,
            Some(Err(error)) => cx.catch(error).map(|_| Vec::new())?,
            None => Vec::new(),
        };
        out.extend([before, b"<img src=\"", &picture, b"\"", attributes, b">"].concat());
        rest = after;
    }
    out.extend([rest, b"<style>"].concat());
    let rules = crate::api::cssom::rules_without_markup(&cx.heap, doc);
    out.extend(
        strings::split(&rules, b"</")
            .collect::<Vec<_>>()
            .join(&b"<\\/"[..]),
    );
    out.extend(b"</style>");
    Ok(bun_ui::protocol::Text::lossy(&out).into_string())
}

fn printed<'a>(cx: Cx<'_, 'a>, window: &[JSValue]) -> Result<'a> {
    Window::from_js(&cx.heap, window[0])
        .map(|it| fire(cx, it, atom!("afterprint"), Default::default()));
    Ok(())
}

impl Window {
    /// An empty frame has no host that could.
    fn printer<'a>(&'a self, heap: &JsHeap<'a>) -> Option<&'a Window> {
        let Some(frame) = js_DomWindow::empty_frame(self).and_then(|it| Element::from_js(heap, it))
        else {
            return Some(self).filter(|it| it.host().can_print());
        };
        let allows_modals = |sandbox: DomString| {
            sandbox
                .to_utf8()
                .split_ascii_whitespace()
                .any(|it| it.eq_ignore_ascii_case("allow-modals"))
        };
        Window::of(frame.doc())
            .filter(|_| frame.attr(atom!("sandbox")).is_none_or(allows_modals))?
            .printer(heap)
    }

    pub(crate) fn print<'a>(&'a self, cx: Cx<'_, 'a>) -> Result<'a> {
        let Some(printer) = self
            .printer(&cx.heap)
            .filter(|_| !self.is_disposed() && !self.is_unloading())
        else {
            return Ok(());
        };
        fire(cx, self, atom!("beforeprint"), Default::default());
        let (markup, kept) = (
            markup_to_print(cx, self.document())?,
            Strong::create(self.to_js(), cx.global()),
        );
        printer.host().print(
            self.document().base_url().to_utf8().into_owned(),
            markup,
            move |global, ()| {
                Window::from_js(JsHeap::from_global(global), kept.get())
                    .into_iter()
                    .for_each(|it| queue_task_for(it.document(), &[it.to_js()], Box::new(printed)));
            },
        );
        Ok(())
    }
}
