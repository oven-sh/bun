//! The objects that `getExtension()` returns.

use core::cell::Cell;

use bun_jsc::JSValue;
use bun_jsc::bindgen::{JsHeap, JsInterface as _, JsLocal, Result};

use super::Context;
use super::commands::{EXTENSIONS, Named, Op, Word as _};
use crate::api::core::List;
use crate::generated_bindgen::webgl::*;

pub(crate) struct Extension {
    /// How often the context had been lost.
    losses: Cell<u32>,
}

impl Extension {
    pub(super) fn context(&self) -> &Context {
        js_WebGLExtension::context(self).expect("it is set when this is made")
    }

    pub(super) fn target(&self) -> Option<&Context> {
        Some(self.context()).filter(|it| it.losses.get() == self.losses.get())
    }
}

impl Context {
    fn supported(&self) -> impl Iterator<Item = (u32, &'static str)> {
        let bits = self.stream().with_progress(|it| it.extensions).unwrap_or(0);
        EXTENSIONS
            .iter()
            .map(|it| (it.0 as u32, it.1))
            .filter(move |it| bits >> it.0 & 1 != 0)
    }

    pub(super) fn has(&self, extension: Named) -> bool {
        js_WebGL::extensions(self)
            .is_some_and(|it| List::from_value(it).get(extension as u32).is_cell())
    }

    pub(super) fn forget_extensions(&self, heap: &JsHeap<'_>) {
        if let Some(all) = js_WebGL::extensions(self).map(List::from_value) {
            (0..all.len())
                .filter(|it| *it != Named::LoseContext as u32)
                .for_each(|it| all.set(heap, it, JSValue::NULL));
        }
    }
}

fn names<'a>(heap: &JsHeap<'a>, names: impl Iterator<Item = &'static str>) -> Result<'a, JSValue> {
    heap.create_array(names, |heap, it| {
        Ok(JsLocal::new(
            heap,
            heap.create_latin1_string(it.as_bytes()).to_js(),
        ))
    })
    .map(JsLocal::to_js)
}

impl WebGLRenderingContextBase {
    pub(crate) fn get_supported_extensions<'a>(&self, heap: &JsHeap<'a>) -> Result<'a, JSValue> {
        if self.is_lost() {
            Ok(JSValue::NULL)
        } else {
            names(heap, self.supported().map(|it| it.1))
        }
    }

    pub(crate) fn get_extension(&self, heap: &JsHeap<'_>, name: &[u8]) -> JSValue {
        let Some((index, _)) = self
            .supported()
            .find(|it| it.1.as_bytes().eq_ignore_ascii_case(name))
        else {
            return JSValue::NULL;
        };
        let all = js_WebGL::extensions(self).map_or_else(
            || List::from_fn(heap, EXTENSIONS.len() as u32, |_| JSValue::NULL),
            List::from_value,
        );
        js_WebGL::set_extensions(self, all.to_js());
        if !all.get(index).is_cell() {
            let made = EXTENSIONS[index as usize].2.create(
                self.realm(heap),
                Extension {
                    losses: self.losses.clone(),
                },
            );
            js_WebGLExtension::set_context(made, Some(self));
            all.set(heap, index, made.to_js());
            self.stream().send([Op::EnableExtension as u32, index]);
        }
        all.get(index)
    }
}

impl GlInstancedArrays {
    pub(crate) fn draw_arrays_instanced_angle(
        &self,
        mode: u32,
        first: u32,
        count: u32,
        instances: u32,
    ) {
        self.target().inspect(|it| {
            it.drawing().send([
                Op::DrawArraysInstanced as u32,
                mode,
                first,
                count,
                instances,
            ])
        });
    }

    pub(crate) fn draw_elements_instanced_angle(
        &self,
        mode: u32,
        count: u32,
        kind: u32,
        offset: i64,
        instances: u32,
    ) {
        self.target().inspect(|it| {
            it.drawing().send([
                Op::DrawElementsInstanced as u32,
                mode,
                count,
                kind,
                offset.word(it),
                instances,
            ])
        });
    }

    pub(crate) fn vertex_attrib_divisor_angle(&self, index: u32, divisor: u32) {
        self.target().inspect(|it| {
            it.stream()
                .send([Op::VertexAttribDivisor as u32, index, divisor])
        });
    }
}

impl GlTimerQuery {
    pub(crate) fn begin_query_ext(&self, target: u32, query: &WebGLTimerQueryEXT) {
        self.target().inspect(|it| {
            it.stream()
                .send([Op::BeginQuery as u32, target, query.held(it)])
        });
    }

    pub(crate) fn end_query_ext(&self, target: u32) {
        self.target()
            .inspect(|it| it.stream().send([Op::EndQuery as u32, target]));
    }

    pub(crate) fn query_counter_ext(&self, query: &WebGLTimerQueryEXT, target: u32) {
        self.target().inspect(|it| {
            it.stream()
                .send([Op::QueryCounter as u32, query.word(it), target])
        });
    }

    pub(crate) fn get_query_ext<'a>(
        &self,
        heap: &JsHeap<'a>,
        target: u32,
        name: u32,
    ) -> Result<'a, JSValue> {
        self.context().ask(
            heap,
            &[Op::GetQuery as u32, target, name],
            &[],
            JSValue::NULL,
        )
    }

    pub(crate) fn get_query_object_ext<'a>(
        &self,
        heap: &JsHeap<'a>,
        query: &WebGLTimerQueryEXT,
        name: u32,
    ) -> Result<'a, JSValue> {
        self.context().get_query_result(heap, query, name)
    }
}

impl GlVertexArrayObject {
    pub(crate) fn bind_vertex_array_oes(&self, array: Option<&WebGLVertexArrayObjectOES>) {
        self.target().inspect(|it| {
            it.stream()
                .send([Op::BindVertexArray as u32, array.held(it)])
        });
    }
}

impl GlAstc {
    pub(crate) fn get_supported_profiles<'a>(&self, heap: &JsHeap<'a>) -> Result<'a, JSValue> {
        if self.target().is_some() {
            names(heap, ["ldr"].into_iter())
        } else {
            Ok(JSValue::NULL)
        }
    }
}

impl GlDrawBuffers {
    pub(crate) fn draw_buffers_webgl(&self, buffers: &[u32]) {
        self.target().inspect(|it| it.set_draw_buffers(buffers));
    }
}

impl GlLoseContext {
    pub(crate) fn lose_context(&self, heap: &JsHeap<'_>) {
        self.context().lose_on_request(heap);
    }

    pub(crate) fn restore_context(&self, heap: &JsHeap<'_>) {
        self.context().restore_on_request(heap);
    }
}

impl GlMultiDraw {
    pub(crate) fn multi_draw_arrays_webgl<'a>(
        &self,
        heap: &JsHeap<'a>,
        mode: u32,
        firsts: Int32List<'a>,
        from_first: i64,
        counts: Int32List<'a>,
        from_count: i64,
        count: u32,
    ) {
        self.target().inspect(|it| {
            it.multi_draw(
                heap,
                mode,
                None,
                [Some((firsts, from_first)), Some((counts, from_count)), None],
                count,
            )
        });
    }

    pub(crate) fn multi_draw_elements_webgl<'a>(
        &self,
        heap: &JsHeap<'a>,
        mode: u32,
        counts: Int32List<'a>,
        from_count: i64,
        kind: u32,
        offsets: Int32List<'a>,
        from_offset: i64,
        count: u32,
    ) {
        self.target().inspect(|it| {
            it.multi_draw(
                heap,
                mode,
                Some(kind),
                [
                    Some((offsets, from_offset)),
                    Some((counts, from_count)),
                    None,
                ],
                count,
            )
        });
    }

    pub(crate) fn multi_draw_arrays_instanced_webgl<'a>(
        &self,
        heap: &JsHeap<'a>,
        mode: u32,
        firsts: Int32List<'a>,
        from_first: i64,
        counts: Int32List<'a>,
        from_count: i64,
        instances: Int32List<'a>,
        from_instance: i64,
        count: u32,
    ) {
        self.target().inspect(|it| {
            it.multi_draw(
                heap,
                mode,
                None,
                [
                    Some((firsts, from_first)),
                    Some((counts, from_count)),
                    Some((instances, from_instance)),
                ],
                count,
            )
        });
    }

    pub(crate) fn multi_draw_elements_instanced_webgl<'a>(
        &self,
        heap: &JsHeap<'a>,
        mode: u32,
        counts: Int32List<'a>,
        from_count: i64,
        kind: u32,
        offsets: Int32List<'a>,
        from_offset: i64,
        instances: Int32List<'a>,
        from_instance: i64,
        count: u32,
    ) {
        self.target().inspect(|it| {
            it.multi_draw(
                heap,
                mode,
                Some(kind),
                [
                    Some((offsets, from_offset)),
                    Some((counts, from_count)),
                    Some((instances, from_instance)),
                ],
                count,
            )
        });
    }
}
