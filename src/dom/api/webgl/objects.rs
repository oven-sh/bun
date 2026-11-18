//! What stands for an object of the library, and what describes one.

use core::cell::Cell;
use std::rc::{Rc, Weak};

use bun_jsc::bindgen::{self, Class, JsHeap, JsInterface as _};
use bun_jsc::{JSValue, JsCell};

use super::Context;
use super::commands::Op;
use super::stream::Stream;
use crate::abi_webgl::object;
use crate::generated_bindgen::webgl::*;

/// The id of what another context has made.
const FOREIGN: u32 = u32::MAX;

pub(crate) struct Object {
    stream: Rc<Stream>,
    id: u32,
    is_held: Cell<bool>,
    /// In the stream, of what has to be run before it is complete.
    pub(super) position: Cell<Option<u32>>,
    /// The task in which it was said not to be ready.
    pub(super) unready_in: Cell<u32>,
    label: JsCell<Box<[u8]>>,
}

impl Drop for Object {
    fn drop(&mut self) {
        self.stream.released.borrow_mut().push(self.id);
    }
}

impl Object {
    pub(crate) fn get_label(&self) -> &[u8] {
        self.label.get()
    }

    pub(crate) fn set_label(&self, label: &[u8]) {
        self.label.set(label.into());
    }
}

pub(crate) struct WebGLUniformLocation {
    stream: Weak<Stream>,
    location: u32,
}

pub(crate) struct WebGLActiveInfo {
    pub(super) size: u32,
    pub(super) kind: u32,
    pub(super) name: Box<[u8]>,
}

impl WebGLActiveInfo {
    pub(crate) fn get_size(&self) -> u32 {
        self.size
    }

    pub(crate) fn get_type(&self) -> u32 {
        self.kind
    }

    pub(crate) fn get_name(&self) -> &[u8] {
        &self.name
    }
}

pub(crate) struct WebGLShaderPrecisionFormat(pub(super) [u32; 3]);

impl WebGLShaderPrecisionFormat {
    pub(crate) fn get_range_min(&self) -> u32 {
        self.0[0]
    }

    pub(crate) fn get_range_max(&self) -> u32 {
        self.0[1]
    }

    pub(crate) fn get_precision(&self) -> u32 {
        self.0[2]
    }
}

impl Context {
    #[inline]
    pub(super) fn id_of(&self, object: &Object) -> u32 {
        if core::ptr::eq(Rc::as_ptr(&object.stream), self.stream()) {
            object.id
        } else {
            FOREIGN
        }
    }

    #[inline]
    pub(super) fn number_of(&self, location: &WebGLUniformLocation) -> u32 {
        if core::ptr::eq(location.stream.as_ptr(), self.stream()) {
            location.location
        } else {
            FOREIGN
        }
    }

    pub(super) fn create_location(&self, heap: &JsHeap<'_>, location: u32) -> JSValue {
        js_WebGLUniformLocation::create(
            heap,
            WebGLUniformLocation {
                stream: Rc::downgrade(&self.shared_stream()),
                location,
            },
        )
        .to_js()
    }

    pub(super) fn create_object<'a>(
        &self,
        heap: &JsHeap<'a>,
        class: Class<Object>,
        kind: u32,
        argument: u32,
    ) -> &'a Object {
        let (stream, (is_held, position, unready_in, label)) =
            (self.shared_stream(), Default::default());
        let id = stream.new_id();
        stream.send([Op::Create as u32, kind, id, argument]);
        class.create(
            self.realm(heap),
            Object {
                stream,
                id,
                is_held,
                position,
                unready_in,
                label,
            },
        )
    }

    fn delete(&self, kind: u32, object: Option<&Object>) {
        if let Some(object) = object {
            object.position.set(None);
            object.unready_in.set(0);
            self.stream()
                .send([Op::Delete as u32, kind, self.id_of(object)]);
        }
    }

    fn is<'a>(
        &self,
        heap: &JsHeap<'a>,
        kind: u32,
        object: Option<&Object>,
    ) -> bindgen::Result<'a, JSValue> {
        object.map_or(Ok(JSValue::FALSE), |it| {
            self.ask(
                heap,
                &[Op::Is as u32, kind, self.id_of(it)],
                &[],
                JSValue::FALSE,
            )
        })
    }

    /// The page can ask for what the context refers to, and must get the same object.
    #[inline]
    pub(super) fn hold(&self, object: &Object) -> u32 {
        let id = self.id_of(object);
        object.unready_in.set(0);
        if !object.is_held.get() && id != FOREIGN {
            self.start_holding(object, id);
        }
        id
    }

    #[cold]
    fn start_holding(&self, object: &Object, id: u32) {
        object.is_held.set(true);
        js_WebGLObject::set_next_held(object, js_WebGL::held(self));
        js_WebGL::set_held(self, Some(object));
        self.held.update(|it| it + 1);
        let mut by_id = self.held_by_id.borrow_mut();
        if by_id.len() <= id as usize {
            by_id.resize(id as usize + 1, JSValue::NULL);
        }
        by_id[id as usize] = object.to_js();
    }

    pub(super) fn held_object(&self, id: u32) -> JSValue {
        self.held_by_id
            .borrow()
            .get(id as usize)
            .copied()
            .unwrap_or(JSValue::NULL)
    }

    /// `referenced` is sorted.
    pub(super) fn hold_only(&self, referenced: &[u32]) {
        let mut next = js_WebGL::held(self);
        js_WebGL::set_held(self, None);
        self.held.set(0);
        self.held_by_id.borrow_mut().clear();
        while let Some(object) = next {
            next = js_WebGLObject::next_held(object);
            js_WebGLObject::set_next_held(object, None);
            object.is_held.set(false);
            if referenced.binary_search(&object.id).is_ok() {
                self.hold(object);
            }
        }
    }
}

macro_rules! life_cycles {
    ($($owner:ident $type:ident $kind:ident $delete:ident $is:ident $($create:ident)?;)*) => {$(
        impl $owner {
            $(pub(crate) fn $create(&self, heap: &JsHeap<'_>) -> JSValue {
                self.context().create_object(heap, paste::paste!([<js_ $type>]::CLASS.widen()), object::$kind, 0).to_js()
            })?

            pub(crate) fn $delete(&self, object: Option<&$type>) {
                self.target().inspect(|it| it.delete(object::$kind, object.map(|it| &**it)));
            }

            pub(crate) fn $is<'a>(&self, heap: &JsHeap<'a>, object: Option<&$type>) -> bindgen::Result<'a, JSValue> {
                self.context().is(heap, object::$kind, object.map(|it| &**it))
            }
        }
    )*};
}

life_cycles! {
    WebGLRenderingContextBase WebGLBuffer BUFFER delete_buffer is_buffer create_buffer;
    WebGLRenderingContextBase WebGLFramebuffer FRAMEBUFFER delete_framebuffer is_framebuffer create_framebuffer;
    WebGLRenderingContextBase WebGLProgram PROGRAM delete_program is_program create_program;
    WebGLRenderingContextBase WebGLRenderbuffer RENDERBUFFER delete_renderbuffer is_renderbuffer create_renderbuffer;
    WebGLRenderingContextBase WebGLShader SHADER delete_shader is_shader;
    WebGLRenderingContextBase WebGLTexture TEXTURE delete_texture is_texture create_texture;
    WebGL2RenderingContextBase WebGLQuery QUERY delete_query is_query create_query;
    WebGL2RenderingContextBase WebGLSampler SAMPLER delete_sampler is_sampler create_sampler;
    WebGL2RenderingContextBase WebGLSync SYNC delete_sync is_sync;
    WebGL2RenderingContextBase WebGLTransformFeedback TRANSFORM_FEEDBACK delete_transform_feedback is_transform_feedback create_transform_feedback;
    WebGL2RenderingContextBase WebGLVertexArrayObject VERTEX_ARRAY delete_vertex_array is_vertex_array create_vertex_array;
    GlTimerQuery WebGLTimerQueryEXT QUERY delete_query_ext is_query_ext create_query_ext;
    GlVertexArrayObject WebGLVertexArrayObjectOES VERTEX_ARRAY delete_vertex_array_oes is_vertex_array_oes create_vertex_array_oes;
}
