//! <https://html.spec.whatwg.org/#printing>

use super::*;
use crate::api::events::{fire, queue_task_for};
use crate::api::markup::{Purpose, snapshot};

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
        let empty = (!core::ptr::eq(printer, self))
            .then(|| {
                snapshot(
                    cx,
                    self.document(),
                    0,
                    Purpose::Print,
                    &mut Default::default(),
                )
            })
            .transpose()?;
        let kept = Strong::create(self.to_js(), cx.global());
        printer.host().print(
            empty.map(|it| it.to_utf8().into_owned()),
            move |global, ()| {
                Window::from_js(JsHeap::from_global(global), kept.get())
                    .into_iter()
                    .for_each(|it| queue_task_for(it.document(), &[it.to_js()], Box::new(printed)));
            },
        );
        Ok(())
    }
}
