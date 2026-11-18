//! The functions that take arrays and images.

use bun_jsc::bindgen::{
    BufferSource, IntoError as _, JsHeap, JsLocal, JsScope, Result, TypedArray,
};
use bun_jsc::{DOMExceptionCode, JSType};

use super::commands::{Op, Word as _, bytes_of};
use super::{
    Context, INVALID_OPERATION, INVALID_VALUE, OUT_OF_MEMORY, Readback, WebGLUniformLocation,
};
use crate::abi_webgl::{Upload, scalar, source, view};
use crate::api::canvas::{Source, flush_canvases};
use crate::api::graphics::Failure;
use crate::generated_bindgen::webgl::*;

type Cx<'c, 'a> = &'c mut JsScope<'a>;
type View<'a> = JsLocal<'a, TypedArray<u8>>;

const NO_OVERLOAD: Failure = Failure::Type("The arguments match no overload.");

pub(super) trait List<'a> {
    fn with_bytes<R>(&self, heap: &JsHeap<'a>, read: impl FnOnce(&[u8]) -> R) -> R;
}

macro_rules! lists {
    ($($type:ident)*) => {$(
        impl<'a> List<'a> for $type<'a> {
            #[inline]
            fn with_bytes<R>(&self, heap: &JsHeap<'a>, read: impl FnOnce(&[u8]) -> R) -> R {
                match self {
                    $type::Array(it) => it.as_buffer_source().with_bytes(heap, read),
                    // SAFETY: numbers have no padding, and bytes need no alignment.
                    $type::Sequence(it) => read(unsafe { core::slice::from_raw_parts(it.as_ptr().cast(), it.len() * 4) }),
                }
            }
        }
    )*};
}

lists!(Float32List Int32List Uint32List);

/// The kind, and the size of an element.
fn describe(array: View<'_>) -> (u32, u64) {
    match array.to_js().js_type() {
        JSType::Int8Array => (view::INT8, 1),
        JSType::Uint8Array | JSType::Uint8ClampedArray => (view::UINT8, 1),
        JSType::Int16Array => (view::INT16, 2),
        JSType::Uint16Array => (view::UINT16, 2),
        JSType::Int32Array => (view::INT32, 4),
        JSType::Uint32Array => (view::UINT32, 4),
        JSType::Float32Array => (view::FLOAT32, 4),
        JSType::DataView => (u32::MAX, 1),
        JSType::Float16Array => (u32::MAX, 2),
        _ => (u32::MAX, 8),
    }
}

/// In elements. A length of 0 is the rest.
#[inline]
fn range(bytes: usize, size: u64, offset: i64, length: u32) -> Option<core::ops::Range<usize>> {
    let start = (offset as u64).checked_mul(size)?;
    let end = if length == 0 {
        bytes as u64
    } else {
        start.checked_add(u64::from(length) * size)?
    };
    (start <= end && end <= bytes as u64).then_some(start as usize..end as usize)
}

fn command<const N: usize>(
    op: Op,
    upload: &Upload,
    rest: [u32; N],
) -> impl core::ops::Deref<Target = [u32]> {
    // SAFETY: it is that many words.
    let upload = unsafe { core::mem::transmute::<Upload, [u32; 14]>(*upload) };
    [&[op as u32][..], &upload, &rest].concat()
}

impl Context {
    pub(super) fn send_bytes(&self, words: &[u32], bytes: &[u8]) {
        if !self.stream().send_with(words, &[bytes]) {
            self.fail(OUT_OF_MEMORY, "out of memory");
        }
    }

    fn send_part(&self, words: &[u32], bytes: &[u8], size: u64, offset: i64, length: u32) {
        match range(bytes.len(), size, offset, length) {
            Some(range) => self.send_bytes(words, &bytes[range]),
            None => self.fail(INVALID_VALUE, "the range ends outside of the array"),
        }
    }

    fn set_uniform(
        &self,
        location: Option<&WebGLUniformLocation>,
        shape: u32,
        bytes: &[u8],
        offset: i64,
        length: u32,
    ) {
        let Some(location) = location else { return };
        let (offset, length) = if self.is_webgl2() {
            (offset, length)
        } else {
            (0, 0)
        };
        self.send_part(
            &[Op::Uniform as u32, self.number_of(location), shape],
            bytes,
            4,
            offset,
            length,
        );
    }

    fn set_attribute(&self, index: u32, scalar: u32, size: usize, bytes: &[u8]) {
        let Some(given) = bytes.as_chunks().0.get(..size) else {
            return self.fail(INVALID_VALUE, "vertexAttrib: too few values");
        };
        let [x, y, z, w] = core::array::from_fn(|at| {
            given
                .get(at)
                .map_or(if at == 3 { 1f32.to_bits() } else { 0 }, |it| {
                    u32::from_ne_bytes(*it)
                })
        });
        self.stream()
            .send([Op::VertexAttrib as u32, index, scalar, x, y, z, w]);
    }

    fn clear_buffer(&self, buffer: u32, index: u32, scalar: u32, bytes: &[u8], offset: i64) {
        let values = range(bytes.len(), 4, offset, 0).map_or(&[][..], |it| &bytes[it]);
        self.drawing().send_with(
            &[Op::ClearBuffer as u32, buffer, index, scalar],
            &[&values[..values.len().min(16)]],
        );
    }

    fn fill_buffer(&self, target: u32, usage: u32, bytes: &[u8]) {
        self.send_bytes(&[Op::BufferData as u32, target, usage, 0], bytes);
    }

    fn upload_source<'a>(
        &self,
        cx: Cx<'_, 'a>,
        upload: &Upload,
        mut flags: u32,
        from: TexImageSource<'a>,
    ) -> Result<'a, ()> {
        let image = match from {
            TexImageSource::Data(it) => {
                let [width, height] = it.size();
                let words = command(
                    Op::TexImageFromData,
                    upload,
                    [
                        flags | if it.is_wide() { source::IS_WIDE } else { 0 },
                        width,
                        height,
                    ],
                );
                it.with_pixels(&cx.heap, |pixels| self.send_bytes(&words, pixels))
                    .unwrap_or_else(|_| self.send_bytes(&words, &[]));
                return Ok(());
            }
            TexImageSource::Bitmap(it) => {
                flags |= source::IS_BITMAP;
                it.exact_source().ok()
            }
            TexImageSource::Image(it) => it.source(cx).ok().flatten().map(|source| Source {
                size: it.size_of_texture().unwrap_or(source.size),
                ..source
            }),
            TexImageSource::Canvas(it) => Some(it.source(cx, Readback::AsDrawn)),
            TexImageSource::Video(it) => it.source(&cx.heap),
            TexImageSource::Offscreen(it) => it.source(&cx.heap, Readback::AsDrawn).ok(),
        };
        match image {
            Some(it) if !it.is_origin_clean => {
                return Err(Failure::Dom(
                    DOMExceptionCode::SecurityError,
                    "The page may not read the pixels of this source.",
                )
                .into_error(&cx.heap));
            }
            Some(it) if it.is_empty() => {
                self.send_bytes(&command(Op::TexImageFromData, upload, [flags, 0, 0]), &[])
            }
            Some(it) => {
                flush_canvases();
                self.stream()
                    .offer(it.id, it.size.map(|it| it.ceil() as u32));
                self.stream().send_with(
                    &command(
                        Op::TexImageFromSource,
                        upload,
                        [flags
                            | if it.is_straight {
                                source::IS_STRAIGHT
                            } else {
                                0
                            }],
                    ),
                    &[],
                );
            }
            None => self.send_bytes(&command(Op::TexImageFromData, upload, [flags, 1, 1]), &[]),
        }
        Ok(())
    }

    fn upload<'a>(
        &self,
        cx: Cx<'_, 'a>,
        upload: &Upload,
        pixels: Option<TexImagePixels<'a>>,
        offset: i64,
    ) -> Result<'a, ()> {
        let source = match pixels {
            None => {
                self.send_bytes(&command(Op::TexImage, upload, [view::NULL]), &[]);
                return Ok(());
            }
            Some(TexImagePixels::View(array)) => {
                let ((kind, size), offset) =
                    (describe(array), if self.is_webgl2() { offset } else { 0 });
                // SAFETY: it only reads them.
                let needed =
                    unsafe { (self.stream().library().measure)(upload, self.unpacking.as_ptr()) };
                array.as_buffer_source().with_bytes(&cx.heap, |bytes| {
                    match range(bytes.len(), size, offset, 0).map(|it| &bytes[it]) {
                        Some(bytes) => self.send_bytes(
                            &command(Op::TexImage, upload, [kind]),
                            bytes.get(..needed).unwrap_or_default(),
                        ),
                        None => self.fail(
                            INVALID_OPERATION,
                            "texImage: srcOffset is outside of the array",
                        ),
                    }
                });
                return Ok(());
            }
            _ if !self.is_webgl2() => return Err(NO_OVERLOAD.into_error(&cx.heap)),
            Some(TexImagePixels::Offset(it)) => {
                return Ok(_ = self.stream().send_with(
                    &command(Op::TexImageFromBuffer, upload, [it.word(self)]),
                    &[],
                ));
            }
            Some(TexImagePixels::Bitmap(it)) => TexImageSource::Bitmap(it),
            Some(TexImagePixels::Data(it)) => TexImageSource::Data(it),
            Some(TexImagePixels::Image(it)) => TexImageSource::Image(it),
            Some(TexImagePixels::Canvas(it)) => TexImageSource::Canvas(it),
            Some(TexImagePixels::Video(it)) => TexImageSource::Video(it),
            Some(TexImagePixels::Offscreen(it)) => TexImageSource::Offscreen(it),
        };
        self.upload_source(cx, upload, source::HAS_SIZE, source)
    }

    fn upload_blocks<'a>(
        &self,
        cx: Cx<'_, 'a>,
        upload: &Upload,
        data: ViewOrNumber<'a>,
        offset: Option<i64>,
        length: Option<u32>,
    ) -> Result<'a, ()> {
        match (data, offset, length) {
            (ViewOrNumber::View(array), ..) => {
                array.as_buffer_source().with_bytes(&cx.heap, |bytes| {
                    let (offset, length) = if self.is_webgl2() {
                        (offset.unwrap_or(0), length.unwrap_or(0))
                    } else {
                        (0, 0)
                    };
                    let rest = range(bytes.len(), describe(array).1, offset, 0)
                        .map_or(&[][..], |it| &bytes[it]);
                    self.send_part(
                        &command(Op::CompressedTexImage, upload, [0; 3]),
                        rest,
                        1,
                        0,
                        length,
                    );
                })
            }
            (ViewOrNumber::Number(size), Some(offset), None) if self.is_webgl2() => self
                .send_bytes(
                    &command(
                        Op::CompressedTexImage,
                        upload,
                        [1, size as u32, offset.word(self)],
                    ),
                    &[],
                ),
            _ => return Err(NO_OVERLOAD.into_error(&cx.heap)),
        }
        Ok(())
    }

    /// Each list starts at its offset.
    pub(super) fn multi_draw<'a>(
        &self,
        heap: &JsHeap<'a>,
        mode: u32,
        kind: Option<u32>,
        lists: [Option<(Int32List<'a>, i64)>; 3],
        count: u32,
    ) {
        if (count as i32) < 0 {
            return self.fail(INVALID_VALUE, "multiDraw: negative drawcount");
        }
        let part = |(list, offset): (Int32List<'a>, i64)| {
            list.with_bytes(heap, |it| {
                Some(
                    it.get(range(it.len(), 4, offset, 0)?)?
                        .get(..count as usize * 4)?
                        .to_vec(),
                )
            })
        };
        let [Some(starts), Some(counts), Some(instances)] =
            lists.map(|it| it.map_or(Some(Vec::new()), part))
        else {
            return self.fail(INVALID_OPERATION, "multiDraw: a list is too short");
        };
        self.drawing().send_with(
            &[
                Op::MultiDraw as u32,
                mode,
                kind.is_some().into(),
                kind.unwrap_or(0),
            ],
            &[&starts, &counts, &instances],
        );
    }
}

macro_rules! arrays {
    (
        vectors { $($vector:ident $scalar:ident $size:literal $list:ident $owner:ident)* }
        matrices { $($matrix:ident $columns:literal $rows:literal $in:ident)* }
        attributes { $($attribute:ident $of:ident $count:literal $values:ident $at:ident)* }
        clears { $($clear:ident $with:ident $colors:ident)* }
    ) => {
        $(impl $owner {
            pub(crate) fn $vector<'a>(&self, heap: &JsHeap<'a>, location: Option<&WebGLUniformLocation>, data: $list<'a>, offset: i64, length: u32) {
                data.with_bytes(heap, |it| self.set_uniform(location, scalar::$scalar | $size << 8 | 1 << 16, it, offset, length));
            }
        })*
        $(impl $in {
            pub(crate) fn $matrix<'a>(&self, heap: &JsHeap<'a>, location: Option<&WebGLUniformLocation>, transposes: bool, data: Float32List<'a>, offset: i64, length: u32) {
                data.with_bytes(heap, |it| self.set_uniform(location, scalar::FLOAT | $rows << 8 | $columns << 16 | u32::from(transposes) << 24, it, offset, length));
            }
        })*
        $(impl $at {
            pub(crate) fn $attribute<'a>(&self, heap: &JsHeap<'a>, index: u32, values: $values<'a>) {
                values.with_bytes(heap, |it| self.set_attribute(index, scalar::$of, $count, it));
            }
        })*
        impl WebGL2RenderingContextBase {
            $(pub(crate) fn $clear<'a>(&self, heap: &JsHeap<'a>, buffer: u32, index: u32, values: $colors<'a>, offset: i64) {
                values.with_bytes(heap, |it| self.clear_buffer(buffer, index, scalar::$with, it, offset));
            })*
        }
    };
}

arrays! {
    vectors {
        uniform1fv FLOAT 1 Float32List WebGLRenderingContextBase uniform2fv FLOAT 2 Float32List WebGLRenderingContextBase
        uniform3fv FLOAT 3 Float32List WebGLRenderingContextBase uniform4fv FLOAT 4 Float32List WebGLRenderingContextBase
        uniform1iv INT 1 Int32List WebGLRenderingContextBase uniform2iv INT 2 Int32List WebGLRenderingContextBase
        uniform3iv INT 3 Int32List WebGLRenderingContextBase uniform4iv INT 4 Int32List WebGLRenderingContextBase
        uniform1uiv UINT 1 Uint32List WebGL2RenderingContextBase uniform2uiv UINT 2 Uint32List WebGL2RenderingContextBase
        uniform3uiv UINT 3 Uint32List WebGL2RenderingContextBase uniform4uiv UINT 4 Uint32List WebGL2RenderingContextBase
    }
    matrices {
        uniform_matrix2fv 2 2 WebGLRenderingContextBase uniform_matrix3fv 3 3 WebGLRenderingContextBase uniform_matrix4fv 4 4 WebGLRenderingContextBase
        uniform_matrix2x3fv 2 3 WebGL2RenderingContextBase uniform_matrix2x4fv 2 4 WebGL2RenderingContextBase uniform_matrix3x2fv 3 2 WebGL2RenderingContextBase
        uniform_matrix3x4fv 3 4 WebGL2RenderingContextBase uniform_matrix4x2fv 4 2 WebGL2RenderingContextBase uniform_matrix4x3fv 4 3 WebGL2RenderingContextBase
    }
    attributes {
        vertex_attrib1fv FLOAT 1 Float32List WebGLRenderingContextBase vertex_attrib2fv FLOAT 2 Float32List WebGLRenderingContextBase
        vertex_attrib3fv FLOAT 3 Float32List WebGLRenderingContextBase vertex_attrib4fv FLOAT 4 Float32List WebGLRenderingContextBase
        vertex_attrib_i4iv INT 4 Int32List WebGL2RenderingContextBase vertex_attrib_i4uiv UINT 4 Uint32List WebGL2RenderingContextBase
    }
    clears { clear_bufferfv FLOAT Float32List clear_bufferiv INT Int32List clear_bufferuiv UINT Uint32List }
}

const WHOLE: Upload = Upload {
    target: 0,
    level: 0,
    internal_format: 0,
    offset: [0; 3],
    size: [0; 3],
    border: 0,
    format: 0,
    kind: 0,
    dimensions: 2,
    is_partial: 0,
};
const PART: Upload = Upload {
    is_partial: 1,
    ..WHOLE
};

macro_rules! uploads {
    ($($owner:ident $name:ident($($number:ident)*) $kind:ident $upload:expr;)*) => { $(impl $owner { uploads!($kind $name($($number)*) $upload); })* };
    (pixels $name:ident($($number:ident)*) $upload:expr) => {
        pub(crate) fn $name<'a>(&self, cx: Cx<'_, 'a>, $($number: u32,)* pixels: Option<TexImagePixels<'a>>, offset: i64) -> Result<'a, ()> {
            self.upload(cx, &$upload, pixels, offset)
        }
    };
    (source $name:ident($($number:ident)*) $upload:expr) => {
        pub(crate) fn $name<'a>(&self, cx: Cx<'_, 'a>, $($number: u32,)* source: TexImageSource<'a>) -> Result<'a, ()> {
            self.upload_source(cx, &$upload, 0, source)
        }
    };
    (blocks $name:ident($($number:ident)*) $upload:expr) => {
        pub(crate) fn $name<'a>(&self, cx: Cx<'_, 'a>, $($number: u32,)* data: ViewOrNumber<'a>, offset: Option<i64>, length: Option<u32>) -> Result<'a, ()> {
            self.upload_blocks(cx, &$upload, data, offset, length)
        }
    };
}

uploads! {
    WebGLRenderingContextBase tex_image_2d(target level internal_format width height border format kind) pixels
        Upload { target, level, internal_format, size: [width, height, 1], border, format, kind, ..WHOLE };
    WebGLRenderingContextBase tex_image_2d_from_source(target level internal_format format kind) source
        Upload { target, level, internal_format, format, kind, ..WHOLE };
    WebGLRenderingContextBase tex_sub_image_2d(target level x y width height format kind) pixels
        Upload { target, level, offset: [x, y, 0], size: [width, height, 1], format, kind, ..PART };
    WebGLRenderingContextBase tex_sub_image_2d_from_source(target level x y format kind) source
        Upload { target, level, offset: [x, y, 0], format, kind, ..PART };
    WebGLRenderingContextBase compressed_tex_image_2d(target level internal_format width height border) blocks
        Upload { target, level, internal_format, size: [width, height, 1], border, ..WHOLE };
    WebGLRenderingContextBase compressed_tex_sub_image_2d(target level x y width height internal_format) blocks
        Upload { target, level, internal_format, offset: [x, y, 0], size: [width, height, 1], ..PART };
    WebGL2RenderingContextBase tex_image_3d(target level internal_format width height depth border format kind) pixels
        Upload { target, level, internal_format, size: [width, height, depth], border, format, kind, dimensions: 3, ..WHOLE };
    WebGL2RenderingContextBase tex_sub_image_3d(target level x y z width height depth format kind) pixels
        Upload { target, level, offset: [x, y, z], size: [width, height, depth], format, kind, dimensions: 3, ..PART };
    WebGL2RenderingContextBase compressed_tex_image_3d(target level internal_format width height depth border) blocks
        Upload { target, level, internal_format, size: [width, height, depth], border, dimensions: 3, ..WHOLE };
    WebGL2RenderingContextBase compressed_tex_sub_image_3d(target level x y z width height depth internal_format) blocks
        Upload { target, level, internal_format, offset: [x, y, z], size: [width, height, depth], dimensions: 3, ..PART };
}

impl WebGLRenderingContextBase {
    pub(crate) fn buffer_data<'a>(
        &self,
        heap: &JsHeap<'a>,
        target: u32,
        data: Option<BufferOrSize<'a>>,
        usage: u32,
    ) {
        match data {
            Some(BufferOrSize::Data(it)) => {
                it.with_bytes(heap, |it| self.fill_buffer(target, usage, it))
            }
            Some(BufferOrSize::Size(it)) => {
                self.stream()
                    .send([Op::BufferData as u32, target, usage, it.word(self), 0])
            }
            None => self.fail(INVALID_VALUE, "bufferData: null instead of data"),
        }
    }

    pub(crate) fn buffer_data_from_part<'a>(
        &self,
        heap: &JsHeap<'a>,
        target: u32,
        data: View<'a>,
        usage: u32,
        offset: i64,
        length: u32,
    ) {
        let (offset, length) = if self.is_webgl2() {
            (offset, length)
        } else {
            (0, 0)
        };
        data.as_buffer_source().with_bytes(heap, |it| {
            self.send_part(
                &[Op::BufferData as u32, target, usage, 0],
                it,
                describe(data).1,
                offset,
                length,
            )
        });
    }

    pub(crate) fn buffer_sub_data<'a>(
        &self,
        heap: &JsHeap<'a>,
        target: u32,
        offset: i64,
        data: JsLocal<'a, BufferSource>,
    ) {
        data.with_bytes(heap, |it| {
            self.send_bytes(&[Op::BufferSubData as u32, target, offset.word(self)], it)
        });
    }

    pub(crate) fn buffer_sub_data_from_part<'a>(
        &self,
        heap: &JsHeap<'a>,
        target: u32,
        offset: i64,
        data: View<'a>,
        src_offset: i64,
        length: u32,
    ) {
        let (src_offset, length) = if self.is_webgl2() {
            (src_offset, length)
        } else {
            (0, 0)
        };
        data.as_buffer_source().with_bytes(heap, |it| {
            self.send_part(
                &[Op::BufferSubData as u32, target, offset.word(self)],
                it,
                describe(data).1,
                src_offset,
                length,
            )
        });
    }

    pub(crate) fn pixel_storei(&self, name: u32, value: u32) {
        // SAFETY: nothing else refers to it.
        unsafe {
            (self.stream().library().set_unpacking)(
                self.unpacking.as_ptr(),
                self.is_webgl2(),
                name,
                value,
            )
        };
        self.stream().send([Op::PixelStorei as u32, name, value]);
    }

    pub(crate) fn read_pixels<'a>(
        &self,
        cx: Cx<'_, 'a>,
        x: u32,
        y: u32,
        width: u32,
        height: u32,
        format: u32,
        kind: u32,
        to: Option<ViewOrNumber<'a>>,
        offset: i64,
    ) -> Result<'a, ()> {
        let array = match to {
            Some(ViewOrNumber::View(it)) => it,
            Some(ViewOrNumber::Number(it)) if self.is_webgl2() => {
                self.stream().send([
                    Op::ReadPixelsToBuffer as u32,
                    x,
                    y,
                    width,
                    height,
                    format,
                    kind,
                    it.word(self),
                ]);
                return Ok(());
            }
            Some(_) => return Err(NO_OVERLOAD.into_error(&cx.heap)),
            None => {
                self.fail(INVALID_VALUE, "readPixels: null instead of an array");
                return Ok(());
            }
        };
        let ((view, size), offset) = (describe(array), if self.is_webgl2() { offset } else { 0 });
        let read = |bytes: &mut [u8]| {
            let Some(bytes) = range(bytes.len(), size, offset, 0).map(|it| &mut bytes[it]) else {
                return self.fail(
                    INVALID_VALUE,
                    "readPixels: dstOffset is outside of the array",
                );
            };
            self.stream().send([
                Op::ReadPixels as u32,
                x,
                y,
                width,
                height,
                format,
                kind,
                view,
                bytes.len().try_into().unwrap_or(u32::MAX),
            ]);
            self.stream().answer(|answer| {
                if let [
                    start,
                    stride @ 1..=u32::MAX,
                    row @ 1..=u32::MAX,
                    ref rows @ ..,
                ] = *answer
                {
                    let places = bytes
                        .get_mut(start as usize..)
                        .unwrap_or_default()
                        .chunks_mut(stride as usize)
                        .filter_map(|it| it.get_mut(..row as usize));
                    places
                        .zip(bytes_of(rows).chunks_exact(row as usize))
                        .take(height as usize)
                        .for_each(|(to, from)| to.copy_from_slice(from));
                }
            });
        };
        // SAFETY: there is no other borrow.
        unsafe { array.as_buffer_source().with_bytes_mut(&cx.heap, read) };
        Ok(())
    }
}

impl WebGL2RenderingContextBase {
    pub(crate) fn get_buffer_sub_data<'a>(
        &self,
        heap: &JsHeap<'a>,
        target: u32,
        from: i64,
        array: View<'a>,
        offset: i64,
        length: u32,
    ) {
        let read = |bytes: &mut [u8]| {
            let Some(bytes) =
                range(bytes.len(), describe(array).1, offset, length).map(|it| &mut bytes[it])
            else {
                return self.fail(
                    INVALID_VALUE,
                    "getBufferSubData: the range ends outside of the array",
                );
            };
            self.stream().send([
                Op::GetBufferSubData as u32,
                target,
                from.word(self),
                (bytes.len() as i64).word(self),
            ]);
            self.stream().answer(|it| {
                bytes_of(it)
                    .get(..bytes.len())
                    .map(|it| bytes.copy_from_slice(it))
            });
        };
        // SAFETY: there is no other borrow.
        unsafe { array.as_buffer_source().with_bytes_mut(heap, read) };
    }
}
