//! The functions whose arguments are numbers, objects and names.

use bun_core::Utf8Bytes;
use bun_jsc::JSValue;
use bun_jsc::bindgen::{JsHeap, JsInterface as _, JsLocal, Result};

use super::{
    Context, INVALID_ENUM, INVALID_VALUE, Object, WebGLActiveInfo, WebGLShaderPrecisionFormat,
    WebGLUniformLocation,
};
use crate::abi_webgl::{NEGATIVE, TOO_LARGE, answer, commands, extensions, object, scalar};
use crate::generated_bindgen::webgl::*;

pub(super) trait Word: Sized {
    fn word(self, context: &Context) -> u32;

    /// For a command that may make the context refer to it.
    fn held(self, context: &Context) -> u32 {
        self.word(context)
    }
}

macro_rules! words {
    ($($type:ty = |$it:ident, $context:pat_param| $word:expr;)*) => {$(
        impl Word for $type {
            #[inline(always)]
            fn word(self, $context: &Context) -> u32 {
                let $it = self;
                $word
            }
        }
    )*};
}

words! {
    u32 = |it, _| it;
    f32 = |it, _| it.to_bits();
    bool = |it, _| it.into();
    i64 = |it, _| if it < 0 { NEGATIVE } else if it > i32::MAX.into() { TOO_LARGE } else { it as u32 };
    &WebGLUniformLocation = |it, context| context.number_of(it);
}

impl<T: core::ops::Deref<Target = Object>> Word for &T {
    #[inline(always)]
    fn word(self, context: &Context) -> u32 {
        context.id_of(self)
    }

    #[inline(always)]
    fn held(self, context: &Context) -> u32 {
        context.hold(self)
    }
}

impl<T: Word> Word for Option<T> {
    #[inline(always)]
    fn word(self, context: &Context) -> u32 {
        self.map_or(0, |it| it.word(context))
    }

    #[inline(always)]
    fn held(self, context: &Context) -> u32 {
        self.map_or(0, |it| it.held(context))
    }
}

macro_rules! member {
    (send $op:ident $name:ident($($argument:ident: $type:ty),*)) => {
        pub(crate) fn $name(&self, $($argument: $type),*) {
            self.target().inspect(|it| it.stream().send([Op::$op as u32, $($argument.word(it)),*]));
        }
    };
    (bind $op:ident $name:ident($($argument:ident: $type:ty),*)) => {
        pub(crate) fn $name(&self, $($argument: $type),*) {
            self.target().inspect(|it| it.stream().send([Op::$op as u32, $($argument.held(it)),*]));
        }
    };
    (draw $op:ident $name:ident($($argument:ident: $type:ty),*)) => {
        pub(crate) fn $name(&self, $($argument: $type),*) {
            self.target().inspect(|it| it.drawing().send([Op::$op as u32, $($argument.word(it)),*]));
        }
    };
    (ask $op:ident $name:ident($($argument:ident: $type:ty),*) $otherwise:tt) => {
        pub(crate) fn $name<'a>(&self, heap: &JsHeap<'a>, $($argument: $type),*) -> Result<'a, JSValue> {
            self.context().ask(heap, &[Op::$op as u32, $($argument.word(self.context())),*], &[], member!(heap, $otherwise))
        }
    };
    ($heap:ident, null) => { JSValue::NULL };
    ($heap:ident, false) => { JSValue::FALSE };
    ($heap:ident, empty) => { $heap.create_latin1_string(b"").to_js() };
    ($heap:ident, $number:literal) => { JSValue::js_number_from_int32($number) };
}

macro_rules! members {
    (
        other { $($other:ident $other_function:ident $words:tt)* }
        $($kind:ident $owner:ident { $($op:ident $name:ident $arguments:tt $(-> $otherwise:tt)?)* })*
    ) => {
        #[derive(Clone, Copy)]
        pub(super) enum Op { $($other,)* $($($op,)*)* }
        $(impl $owner { $(member!($kind $op $name $arguments $($otherwise)?);)* })*
    };
}

commands!(members);

pub(super) fn bytes_of(words: &[u32]) -> &[u8] {
    // SAFETY: they have no padding, and bytes need no alignment.
    unsafe { core::slice::from_raw_parts(words.as_ptr().cast(), words.len() * 4) }
}

pub(super) fn text_in(words: &[u32]) -> &[u8] {
    words
        .split_first()
        .and_then(|(length, rest)| bytes_of(rest).get(..*length as usize))
        .unwrap_or_default()
}

fn joined(names: &[Utf8Bytes<'_>]) -> Vec<u8> {
    names
        .iter()
        .flat_map(|it| it.iter().chain(&[0]))
        .copied()
        .collect()
}

impl Context {
    #[optimize(size)]
    fn convert<'a>(
        &self,
        heap: &JsHeap<'a>,
        words: &[u32],
        otherwise: JSValue,
    ) -> Result<'a, JSValue> {
        let array = |convert: &dyn Fn(u32) -> JSValue| {
            heap.create_array(&words[1..], |heap, it| Ok(JsLocal::new(heap, convert(*it))))
                .map(JsLocal::to_js)
        };
        Ok(match *words {
            [answer::BOOLEAN, it] => JSValue::js_boolean(it != 0),
            [answer::INT, it] => JSValue::js_number_from_int32(it as i32),
            [answer::UINT, it] => JSValue::js_number(it.into()),
            [answer::FLOAT, it] => {
                JSValue::js_number(JSValue::purify_nan(f32::from_bits(it).into()))
            }
            [answer::DOUBLE, low, high] => JSValue::js_number(JSValue::purify_nan(f64::from_bits(
                u64::from(high) << 32 | u64::from(low),
            ))),
            [answer::TEXT, ref text @ ..] => heap.create_utf8_string(text_in(text))?.to_js(),
            [answer::INT_ARRAY, ref it @ ..] => heap
                .create_typed_array(&it.iter().map(|it| *it as i32).collect::<Vec<_>>())?
                .to_js(),
            [answer::UINT_ARRAY, ref it @ ..] => heap.create_typed_array(it)?.to_js(),
            [answer::FLOAT_ARRAY, ref it @ ..] => heap
                .create_typed_array(&it.iter().map(|it| f32::from_bits(*it)).collect::<Vec<_>>())?
                .to_js(),
            [answer::BOOLEANS, ..] => array(&|it| JSValue::js_boolean(it != 0))?,
            [answer::INTS, ..] => array(&|it| JSValue::js_number_from_int32(it as i32))?,
            [answer::UINTS, ..] => array(&|it| JSValue::js_number(it.into()))?,
            [answer::OBJECT, id, ..] => self.held_object(id),
            [answer::OBJECTS, ..] => array(&|it| self.held_object(it))?,
            [answer::ACTIVE_INFO, size, kind, ref name @ ..] => js_WebGLActiveInfo::create(
                heap,
                WebGLActiveInfo {
                    size,
                    kind,
                    name: text_in(name).into(),
                },
            )
            .to_js(),
            [answer::PRECISION_FORMAT, min, max, precision] => {
                js_WebGLShaderPrecisionFormat::create(
                    heap,
                    WebGLShaderPrecisionFormat([min, max, precision]),
                )
                .to_js()
            }
            [answer::LOCATION, it] => self.create_location(heap, it),
            _ => otherwise,
        })
    }

    #[inline(never)]
    pub(super) fn ask<'a>(
        &self,
        heap: &JsHeap<'a>,
        words: &[u32],
        parts: &[&[u8]],
        otherwise: JSValue,
    ) -> Result<'a, JSValue> {
        self.stream().ask(words, parts, |it| {
            self.convert(self.realm(heap), it, otherwise)
        })
    }

    /// Without waiting.
    fn completion(&self, object: &Object, name: u32) -> Option<JSValue> {
        const COMPLETION_STATUS: u32 = 0x91B1;
        (name == COMPLETION_STATUS && (self.is_lost() || self.has(Named::ParallelCompile))).then(
            || {
                self.stream().flush();
                JSValue::js_boolean(
                    object
                        .position
                        .get()
                        .is_none_or(|it| self.stream().has_run(it)),
                )
            },
        )
    }

    /// There is no need to wait for the library to say that the GPU is not done.
    fn poll<'a>(
        &self,
        heap: &JsHeap<'a>,
        object: &Object,
        words: &[u32],
        unready: JSValue,
        otherwise: JSValue,
    ) -> Result<'a, JSValue> {
        let is_unready = !self.is_lost()
            && (object.unready_in.get() == self.task()
                || object
                    .position
                    .get()
                    .is_some_and(|it| !self.stream().has_run(it)));
        let answer = if is_unready {
            unready
        } else {
            self.ask(heap, words, &[], otherwise)?
        };
        object
            .unready_in
            .set(if answer == unready { self.task() } else { 0 });
        Ok(answer)
    }

    pub(super) fn get_query_result<'a>(
        &self,
        heap: &JsHeap<'a>,
        query: &Object,
        name: u32,
    ) -> Result<'a, JSValue> {
        const QUERY_RESULT_AVAILABLE: u32 = 0x8867;
        let words = [Op::GetQueryParameter as u32, self.id_of(query), name];
        match name {
            QUERY_RESULT_AVAILABLE => self.poll(
                heap,
                query,
                &words,
                JSValue::FALSE,
                if self.is_lost() {
                    JSValue::TRUE
                } else {
                    JSValue::NULL
                },
            ),
            _ => self.ask(heap, &words, &[], JSValue::NULL),
        }
    }

    pub(super) fn set_draw_buffers(&self, buffers: &[u32]) {
        self.stream()
            .send_with(&[Op::DrawBuffers as u32], &[bytes_of(buffers)]);
    }

    fn ask_about<'a>(
        &self,
        heap: &JsHeap<'a>,
        op: Op,
        program: &WebGLProgram,
        name: &[u8],
        otherwise: JSValue,
    ) -> Result<'a, JSValue> {
        self.ask(heap, &[op as u32, self.id_of(program)], &[name], otherwise)
    }
}

macro_rules! name_extensions {
    ($($name:ident $interface:ident $versions:literal)*) => {
        #[derive(Clone, Copy)]
        pub(super) enum Named { $($name),* }
        paste::paste! {
            pub(super) static EXTENSIONS: &[(Named, &str, bun_jsc::bindgen::Class<super::Extension>)] =
                &[$((Named::$name, stringify!($interface), [<js_Gl $name>]::CLASS.widen())),*];
        }
    };
}

extensions!(name_extensions);

const ONE: u32 = 1f32.to_bits();

macro_rules! values {
    (
        uniforms { $($uniform:ident $scalar:ident $type:ty, $size:literal $owner:ident($($part:ident)*);)* }
        attributes { $($attribute:ident $of:ident $given:ty, $in:ident($($component:ident)*) $($missing:expr),*;)* }
    ) => {
        $(impl $owner {
            pub(crate) fn $uniform(&self, location: Option<&WebGLUniformLocation>, $($part: $type),*) {
                location.inspect(|it| self.stream().send([Op::Uniform as u32, self.number_of(it), scalar::$scalar | $size << 8 | 1 << 16, $size * 4, $($part.word(self)),*]));
            }
        })*
        $(impl $in {
            pub(crate) fn $attribute(&self, index: u32, $($component: $given),*) {
                self.stream().send([Op::VertexAttrib as u32, index, scalar::$of, $($component.word(self),)* $($missing),*]);
            }
        })*
    };
}

values! {
    uniforms {
        uniform1f FLOAT f32, 1 WebGLRenderingContextBase(x);
        uniform2f FLOAT f32, 2 WebGLRenderingContextBase(x y);
        uniform3f FLOAT f32, 3 WebGLRenderingContextBase(x y z);
        uniform4f FLOAT f32, 4 WebGLRenderingContextBase(x y z w);
        uniform1i INT u32, 1 WebGLRenderingContextBase(x);
        uniform2i INT u32, 2 WebGLRenderingContextBase(x y);
        uniform3i INT u32, 3 WebGLRenderingContextBase(x y z);
        uniform4i INT u32, 4 WebGLRenderingContextBase(x y z w);
        uniform1ui UINT u32, 1 WebGL2RenderingContextBase(x);
        uniform2ui UINT u32, 2 WebGL2RenderingContextBase(x y);
        uniform3ui UINT u32, 3 WebGL2RenderingContextBase(x y z);
        uniform4ui UINT u32, 4 WebGL2RenderingContextBase(x y z w);
    }
    attributes {
        vertex_attrib1f FLOAT f32, WebGLRenderingContextBase(x) 0, 0, ONE;
        vertex_attrib2f FLOAT f32, WebGLRenderingContextBase(x y) 0, ONE;
        vertex_attrib3f FLOAT f32, WebGLRenderingContextBase(x y z) ONE;
        vertex_attrib4f FLOAT f32, WebGLRenderingContextBase(x y z w);
        vertex_attrib_i4i INT u32, WebGL2RenderingContextBase(x y z w);
        vertex_attrib_i4ui UINT u32, WebGL2RenderingContextBase(x y z w);
    }
}

impl WebGLRenderingContextBase {
    pub(crate) fn bind_attrib_location(&self, program: &WebGLProgram, index: u32, name: &[u8]) {
        self.stream().send_with(
            &[Op::BindAttribLocation as u32, self.id_of(program), index],
            &[name],
        );
    }

    pub(crate) fn compile_shader(&self, shader: &WebGLShader) {
        self.stream()
            .send([Op::CompileShader as u32, self.id_of(shader)]);
        shader.position.set(Some(self.stream().position()));
    }

    pub(crate) fn create_shader(&self, heap: &JsHeap<'_>, stage: u32) -> JSValue {
        const FRAGMENT_SHADER: u32 = 0x8B30;
        if stage & !1 == FRAGMENT_SHADER {
            return self
                .create_object(heap, js_WebGLShader::CLASS.widen(), object::SHADER, stage)
                .to_js();
        }
        self.fail(INVALID_ENUM, "createShader: unknown type");
        JSValue::NULL
    }

    pub(crate) fn finish(&self) {
        self.flush();
    }

    pub(crate) fn flush(&self) {
        self.stream().send([Op::Flush as u32]);
        self.stream().flush();
    }

    pub(crate) fn get_attrib_location<'a>(
        &self,
        heap: &JsHeap<'a>,
        program: &WebGLProgram,
        name: &[u8],
    ) -> Result<'a, JSValue> {
        self.ask_about(
            heap,
            Op::GetAttribLocation,
            program,
            name,
            JSValue::js_number_from_int32(-1),
        )
    }

    pub(crate) fn get_program_parameter<'a>(
        &self,
        heap: &JsHeap<'a>,
        program: &WebGLProgram,
        name: u32,
    ) -> Result<'a, JSValue> {
        self.completion(program, name).map_or_else(
            || {
                self.ask(
                    heap,
                    &[Op::GetProgramParameter as u32, self.id_of(program), name],
                    &[],
                    JSValue::NULL,
                )
            },
            Ok,
        )
    }

    pub(crate) fn get_shader_parameter<'a>(
        &self,
        heap: &JsHeap<'a>,
        shader: &WebGLShader,
        name: u32,
    ) -> Result<'a, JSValue> {
        self.completion(shader, name).map_or_else(
            || {
                self.ask(
                    heap,
                    &[Op::GetShaderParameter as u32, self.id_of(shader), name],
                    &[],
                    JSValue::NULL,
                )
            },
            Ok,
        )
    }

    pub(crate) fn get_uniform_location<'a>(
        &self,
        heap: &JsHeap<'a>,
        program: &WebGLProgram,
        name: &[u8],
    ) -> Result<'a, JSValue> {
        self.ask_about(heap, Op::GetUniformLocation, program, name, JSValue::NULL)
    }

    pub(crate) fn link_program(&self, program: &WebGLProgram) {
        self.stream()
            .send([Op::LinkProgram as u32, self.id_of(program)]);
        program.position.set(Some(self.stream().position()));
        self.stream().flush();
    }

    pub(crate) fn shader_source(&self, shader: &WebGLShader, source: &[u8]) {
        self.send_bytes(&[Op::ShaderSource as u32, self.id_of(shader)], source);
    }
}

impl WebGL2RenderingContextBase {
    pub(crate) fn client_wait_sync<'a>(
        &self,
        heap: &JsHeap<'a>,
        sync: &WebGLSync,
        flags: u32,
        timeout: i64,
    ) -> Result<'a, JSValue> {
        const TIMEOUT_EXPIRED: i32 = 0x911B;
        const WAIT_FAILED: i32 = 0x911D;
        let (words, [expired, failed]) = (
            [
                Op::ClientWaitSync as u32,
                self.id_of(sync),
                flags,
                (timeout != 0).into(),
            ],
            [TIMEOUT_EXPIRED, WAIT_FAILED].map(JSValue::js_number_from_int32),
        );
        if flags <= 1 && timeout == 0 {
            self.poll(heap, sync, &words, expired, failed)
        } else {
            self.ask(heap, &words, &[], failed)
        }
    }

    pub(crate) fn draw_buffers(&self, buffers: &[u32]) {
        self.set_draw_buffers(buffers);
    }

    pub(crate) fn fence_sync(&self, heap: &JsHeap<'_>, condition: u32, flags: u32) -> JSValue {
        const SYNC_GPU_COMMANDS_COMPLETE: u32 = 0x9117;
        if condition == SYNC_GPU_COMMANDS_COMPLETE && flags == 0 && !self.is_lost() {
            let sync = self.create_object(heap, js_WebGLSync::CLASS.widen(), object::SYNC, 0);
            sync.position.set(Some(self.stream().position()));
            return sync.to_js();
        }
        self.fail(
            if condition == SYNC_GPU_COMMANDS_COMPLETE {
                INVALID_VALUE
            } else {
                INVALID_ENUM
            },
            "fenceSync: unknown condition or flags",
        );
        JSValue::NULL
    }

    pub(crate) fn get_active_uniforms<'a>(
        &self,
        heap: &JsHeap<'a>,
        program: &WebGLProgram,
        indices: &[u32],
        name: u32,
    ) -> Result<'a, JSValue> {
        self.ask(
            heap,
            &[Op::GetActiveUniforms as u32, self.id_of(program), name],
            &[bytes_of(indices)],
            JSValue::NULL,
        )
    }

    pub(crate) fn get_frag_data_location<'a>(
        &self,
        heap: &JsHeap<'a>,
        program: &WebGLProgram,
        name: &[u8],
    ) -> Result<'a, JSValue> {
        self.ask_about(
            heap,
            Op::GetFragDataLocation,
            program,
            name,
            JSValue::js_number_from_int32(-1),
        )
    }

    pub(crate) fn get_query_parameter<'a>(
        &self,
        heap: &JsHeap<'a>,
        query: &WebGLQuery,
        name: u32,
    ) -> Result<'a, JSValue> {
        self.get_query_result(heap, query, name)
    }

    pub(crate) fn get_sync_parameter<'a>(
        &self,
        heap: &JsHeap<'a>,
        sync: &WebGLSync,
        name: u32,
    ) -> Result<'a, JSValue> {
        const SYNC_STATUS: u32 = 0x9114;
        const UNSIGNALED: i32 = 0x9118;
        let (words, [unsignaled, signaled]) = (
            [Op::GetSyncParameter as u32, self.id_of(sync), name],
            [UNSIGNALED, UNSIGNALED + 1].map(JSValue::js_number_from_int32),
        );
        match name {
            SYNC_STATUS => self.poll(
                heap,
                sync,
                &words,
                unsignaled,
                if self.is_lost() {
                    signaled
                } else {
                    JSValue::NULL
                },
            ),
            _ => self.ask(heap, &words, &[], JSValue::NULL),
        }
    }

    pub(crate) fn get_uniform_block_index<'a>(
        &self,
        heap: &JsHeap<'a>,
        program: &WebGLProgram,
        name: &[u8],
    ) -> Result<'a, JSValue> {
        self.ask_about(
            heap,
            Op::GetUniformBlockIndex,
            program,
            name,
            JSValue::js_number_from_int32(0),
        )
    }

    pub(crate) fn get_uniform_indices<'a>(
        &self,
        heap: &JsHeap<'a>,
        program: &WebGLProgram,
        names: &[Utf8Bytes<'_>],
    ) -> Result<'a, JSValue> {
        self.ask_about(
            heap,
            Op::GetUniformIndices,
            program,
            &joined(names),
            JSValue::NULL,
        )
    }

    pub(crate) fn invalidate_framebuffer(&self, target: u32, attachments: &[u32]) {
        self.invalidate_sub_framebuffer(
            target,
            attachments,
            0,
            0,
            i32::MAX as u32,
            i32::MAX as u32,
        );
    }

    pub(crate) fn invalidate_sub_framebuffer(
        &self,
        target: u32,
        attachments: &[u32],
        x: u32,
        y: u32,
        width: u32,
        height: u32,
    ) {
        self.stream().send_with(
            &[
                Op::InvalidateFramebuffer as u32,
                target,
                x,
                y,
                width,
                height,
            ],
            &[bytes_of(attachments)],
        );
    }

    pub(crate) fn transform_feedback_varyings(
        &self,
        program: &WebGLProgram,
        names: &[Utf8Bytes<'_>],
        mode: u32,
    ) {
        self.send_bytes(
            &[
                Op::TransformFeedbackVaryings as u32,
                self.id_of(program),
                mode,
            ],
            &joined(names),
        );
    }

    pub(crate) fn wait_sync(&self, sync: &WebGLSync, flags: u32, timeout: i64) {
        self.stream().send([
            Op::WaitSync as u32,
            self.id_of(sync),
            flags,
            (timeout == -1).into(),
        ]);
    }
}
