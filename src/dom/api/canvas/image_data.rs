//! https://html.spec.whatwg.org/#imagedata

use std::borrow::Cow;

use bun_jsc::bindgen::{
    self, BufferSource, ClassStructure, IntoError as _, JsHeap, JsInterface as _, JsLocal, JsScope,
    try_zeroed_bytes,
};
use bun_jsc::{JSType, JSValue};

use super::Failure;
use super::bitmap::{area_of, convert, size_from};
use crate::generated_bindgen::canvas::{
    ImageDataArray, ImageDataPixelFormat as Format, ImageDataSettings, PredefinedColorSpace,
    js_ImageData,
};

pub(crate) struct ImageData {
    pub(super) size: [u32; 2],
    color_space: PredefinedColorSpace,
    format: Format,
    /// Its fields are written through a shared reference.
    _fields: core::cell::Cell<()>,
}

/// The binary16 number that is nearest to `byte / 255`.
fn to_half(byte: u8) -> u16 {
    let bits = (f32::from(byte) / 255.0).to_bits();
    if byte == 0 {
        0
    } else {
        (((bits + 0xfff + (bits >> 13 & 1)) >> 13) - ((127 - 15) << 10)) as u16
    }
}

fn from_half(half: u16) -> u8 {
    let (exponent, fraction) = (half >> 10 & 31, half & 1023);
    let is_zero = half >> 15 != 0 || exponent == 0 || exponent == 31 && fraction != 0;
    let value = f32::from_bits((u32::from(exponent) + 127 - 15) << 23 | u32::from(fraction) << 13);
    if is_zero {
        0
    } else {
        (value * 255.0).round_ties_even() as u8
    }
}

fn array<'a>(heap: &JsHeap<'a>, bytes: Box<[u8]>, format: Format) -> bindgen::Result<'a, JSValue> {
    let kind = if format == Format::RgbaFloat16 {
        JSType::Float16Array
    } else {
        JSType::Uint8ClampedArray
    };
    heap.create_typed_array_from_box(kind, bytes)
        .map(JsLocal::to_js)
}

const OUT_OF_MEMORY: Failure = Failure::Range("Out of memory at ImageData creation");

impl ImageData {
    fn with_data(&self, data: JSValue) -> &Self {
        js_ImageData::set_data(self, data);
        self
    }

    fn blank_data<'a>(
        heap: &JsHeap<'a>,
        size: [u32; 2],
        format: Format,
    ) -> bindgen::Result<'a, JSValue> {
        let length = area_of(size).saturating_mul(4);
        if length == 0 || length >= 1 << 32 {
            return Err(
                Failure::index_size("The source size is zero, not a number or too large.")
                    .into_error(heap),
            );
        }
        let bytes =
            try_zeroed_bytes(length as usize * if format == Format::RgbaFloat16 { 2 } else { 1 });
        array(
            heap,
            bytes.ok_or_else(|| OUT_OF_MEMORY.into_error(heap))?,
            format,
        )
    }

    #[optimize(size)]
    fn new(
        size: [u32; 2],
        settings: &ImageDataSettings,
        otherwise: PredefinedColorSpace,
    ) -> ImageData {
        ImageData {
            size,
            color_space: settings.color_space.unwrap_or(otherwise),
            format: settings.pixel_format,
            _fields: Default::default(),
        }
    }

    pub(crate) fn construct_blank<'a>(
        heap: &JsHeap<'a>,
        structure: ClassStructure<'a, Self>,
        width: u32,
        height: u32,
        settings: &ImageDataSettings,
    ) -> bindgen::Result<'a, &'a Self> {
        let data = Self::blank_data(heap, [width, height], settings.pixel_format)?;
        let image = ImageData::new([width, height], settings, PredefinedColorSpace::Srgb);
        Ok(structure.create(heap, image).with_data(data))
    }

    pub(crate) fn construct_from_data<'a>(
        heap: &JsHeap<'a>,
        structure: ClassStructure<'a, Self>,
        data: ImageDataArray<'a>,
        width: u32,
        height: Option<u32>,
        settings: &ImageDataSettings,
    ) -> Result<&'a Self, Failure> {
        let (data, format, bytes_per_pixel) = match data {
            ImageDataArray::Bytes(data) => (data.as_buffer_source(), Format::RgbaUnorm8, 4),
            ImageDataArray::Halves(data) => (data.as_buffer_source(), Format::RgbaFloat16, 8),
        };
        let length = data.with_bytes(heap, <[u8]>::len);
        if format != settings.pixel_format {
            return Err(Failure::invalid_state(
                "The array does not have the pixel format.",
            ));
        }
        if length == 0 || length % bytes_per_pixel != 0 {
            return Err(Failure::invalid_state(
                "The input data length is not a non-zero multiple of 4.",
            ));
        }
        let pixels = length / bytes_per_pixel;
        if !pixels.is_multiple_of(width as usize) {
            return Err(Failure::index_size(
                "The input data length is not a multiple of (4 * width).",
            ));
        }
        let rows = (pixels / width as usize) as u32;
        if height.is_some_and(|it| it != rows) {
            return Err(Failure::index_size(
                "The input data length is not equal to (4 * width * height).",
            ));
        }
        let image = ImageData::new([width, rows], settings, PredefinedColorSpace::Srgb);
        Ok(structure.create(heap, image).with_data(data.to_js()))
    }

    pub(super) fn blank<'a>(
        heap: &JsHeap<'a>,
        size: [u32; 2],
        settings: &ImageDataSettings,
        otherwise: PredefinedColorSpace,
    ) -> bindgen::Result<'a, &'a Self> {
        let data = Self::blank_data(heap, size, settings.pixel_format)?;
        Ok(js_ImageData::create(heap, ImageData::new(size, settings, otherwise)).with_data(data))
    }

    pub(super) fn blank_like<'a>(&self, heap: &JsHeap<'a>) -> bindgen::Result<'a, &'a Self> {
        Self::blank(
            heap,
            self.size,
            &ImageDataSettings {
                color_space: None,
                pixel_format: self.format,
            },
            self.color_space,
        )
    }

    /// `None` is what there was no memory for. The pixels are in `otherwise`.
    pub(super) fn from_pixels<'a>(
        heap: &JsHeap<'a>,
        size: [u32; 2],
        rgba: Option<Box<[u8]>>,
        settings: &ImageDataSettings,
        otherwise: PredefinedColorSpace,
    ) -> bindgen::Result<'a, &'a Self> {
        let mut rgba = rgba;
        if let Some((rgba, wanted)) = rgba
            .as_mut()
            .zip(settings.color_space.filter(|it| *it != otherwise))
        {
            convert(rgba, wanted == PredefinedColorSpace::DisplayP3);
        }
        let bytes = rgba.and_then(|rgba| match settings.pixel_format {
            Format::RgbaUnorm8 => Some(rgba),
            Format::RgbaFloat16 => {
                let mut halves = try_zeroed_bytes(rgba.len() * 2)?;
                halves
                    .as_chunks_mut()
                    .0
                    .iter_mut()
                    .zip(&rgba)
                    .for_each(|(to, from)| *to = to_half(*from).to_ne_bytes());
                Some(halves)
            }
        });
        let data = array(
            heap,
            bytes.ok_or_else(|| OUT_OF_MEMORY.into_error(heap))?,
            settings.pixel_format,
        )?;
        Ok(js_ImageData::create(heap, ImageData::new(size, settings, otherwise)).with_data(data))
    }

    pub(crate) fn size(&self) -> [u32; 2] {
        self.size
    }

    pub(crate) fn is_wide(&self) -> bool {
        self.color_space == PredefinedColorSpace::DisplayP3
    }

    pub(crate) fn with_pixels<R>(
        &self,
        heap: &JsHeap<'_>,
        read: impl FnOnce(&[u8]) -> R,
    ) -> Result<R, Failure> {
        let data = js_ImageData::data(self).unwrap_or_default();
        // SAFETY: every constructor puts a typed array there.
        let data = unsafe { JsLocal::<BufferSource>::from_extern(data, heap) };
        data.with_bytes(heap, |bytes| {
            let rgba: Cow<[u8]> = match self.format {
                Format::RgbaUnorm8 => bytes.into(),
                Format::RgbaFloat16 => bytes
                    .as_chunks()
                    .0
                    .iter()
                    .map(|it| from_half(u16::from_ne_bytes(*it)))
                    .collect(),
            };
            let pixels = rgba.get(..area_of(self.size) as usize * 4);
            pixels
                .map(read)
                .ok_or(Failure::invalid_state("The source data has been detached."))
        })
    }

    pub(crate) fn serialize<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        _: bool,
    ) -> bindgen::Result<'a, JSValue> {
        let parts = [
            js_ImageData::data(self).unwrap_or_default(),
            JSValue::js_number(self.size[0].into()),
            JSValue::js_number(self.size[1].into()),
            JSValue::js_boolean(self.color_space == PredefinedColorSpace::Srgb),
        ];
        cx.heap
            .create_array(parts, |heap, it| Ok(JsLocal::new(heap, it)))
            .map(JsLocal::to_js)
    }

    pub(crate) fn deserialize<'a>(
        cx: &mut JsScope<'a>,
        parts: JsLocal<'a>,
    ) -> bindgen::Result<'a, JSValue> {
        let mut part = |at| parts.to_js().get_index(cx.global(), at);
        let (data, size) = (part(0)?, size_from([part(1)?, part(2)?]));
        let color_space = if part(3)?.to_boolean() {
            PredefinedColorSpace::Srgb
        } else {
            PredefinedColorSpace::DisplayP3
        };
        let (format, bytes_per_pixel) = match data.js_type() {
            JSType::Uint8ClampedArray => (Format::RgbaUnorm8, 4),
            JSType::Float16Array => (Format::RgbaFloat16, 8),
            _ => return Ok(JSValue::NULL),
        };
        if data
            .as_array_buffer(cx.global())
            .is_none_or(|it| it.byte_len as u64 != area_of(size).saturating_mul(bytes_per_pixel))
        {
            return Ok(JSValue::NULL);
        }
        Ok(js_ImageData::create(
            &cx.heap,
            ImageData {
                size,
                color_space,
                format,
                _fields: Default::default(),
            },
        )
        .with_data(data)
        .to_js())
    }

    pub(crate) fn get_width(&self) -> u32 {
        self.size[0]
    }

    pub(crate) fn get_height(&self) -> u32 {
        self.size[1]
    }

    pub(crate) fn get_pixel_format(&self) -> Format {
        self.format
    }

    pub(crate) fn get_color_space(&self) -> PredefinedColorSpace {
        self.color_space
    }
}
