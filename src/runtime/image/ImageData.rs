//! `ImageData`: <https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html#imagedata>

use bun_core::comptime_string_map::ComptimeStringMap;
use bun_jsc::bindgen::{JsLocal, JsScope, JsStructure, JsWrapper};
use bun_jsc::{
    ArrayBuffer, DOMExceptionCode, JSGlobalObject, JSType, JSValue, JsClass as _, JsResult,
    comptime_string_map_jsc,
};

use crate::generated_bindgen::image_data::js_ImageData as js;
pub(crate) use crate::generated_bindgen::image_data::{ImageDataPixelFormat, PredefinedColorSpace};

pub(crate) struct ImageData {
    width: u32,
    height: u32,
    pixel_format: ImageDataPixelFormat,
    color_space: PredefinedColorSpace,
}

bun_core::comptime_string_map! {
    static COLOR_SPACES: PredefinedColorSpace = {
        b"srgb" => PredefinedColorSpace::Srgb,
        b"srgb-linear" => PredefinedColorSpace::SrgbLinear,
        b"display-p3" => PredefinedColorSpace::DisplayP3,
        b"display-p3-linear" => PredefinedColorSpace::DisplayP3Linear,
    };
}

bun_core::comptime_string_map! {
    static PIXEL_FORMATS: ImageDataPixelFormat = {
        b"rgba-unorm8" => ImageDataPixelFormat::RgbaUnorm8,
        b"rgba-float16" => ImageDataPixelFormat::RgbaFloat16,
    };
}

/// The index is what a structured clone stores, so a new one goes last.
const COLOR_SPACE_TAGS: [PredefinedColorSpace; 4] = [
    PredefinedColorSpace::Srgb,
    PredefinedColorSpace::SrgbLinear,
    PredefinedColorSpace::DisplayP3,
    PredefinedColorSpace::DisplayP3Linear,
];

impl ImageDataPixelFormat {
    fn of_array(data: JSValue) -> Option<Self> {
        match data.js_type() {
            JSType::Uint8ClampedArray => Some(Self::RgbaUnorm8),
            JSType::Float16Array => Some(Self::RgbaFloat16),
            _ => None,
        }
    }

    fn bytes_per_pixel(self) -> usize {
        match self {
            Self::RgbaUnorm8 => 4,
            Self::RgbaFloat16 => 8,
        }
    }
}

/// `ImageDataSettings`, with the defaults filled in.
pub(crate) struct Settings {
    pub(crate) color_space: PredefinedColorSpace,
    pub(crate) pixel_format: ImageDataPixelFormat,
}

impl Settings {
    pub(crate) fn from_js(global: &JSGlobalObject, value: JSValue) -> JsResult<Self> {
        if !value.is_undefined_or_null() && !value.is_object() {
            return Err(global.throw_invalid_argument_type_value("settings", "object", value));
        }
        let color_space = enumeration(
            global,
            value,
            "colorSpace",
            &COLOR_SPACES,
            r#""srgb", "srgb-linear", "display-p3" or "display-p3-linear""#,
        )?;
        let pixel_format = enumeration(
            global,
            value,
            "pixelFormat",
            &PIXEL_FORMATS,
            r#""rgba-unorm8" or "rgba-float16""#,
        )?;
        Ok(Self {
            color_space: color_space.unwrap_or(PredefinedColorSpace::Srgb),
            pixel_format: pixel_format.unwrap_or(ImageDataPixelFormat::RgbaUnorm8),
        })
    }
}

/// WebIDL calls `ToString` on the value, which `b.enumeration` does not.
fn enumeration<M: ComptimeStringMap<Value: Copy>>(
    global: &JSGlobalObject,
    dictionary: JSValue,
    member: &'static str,
    values: &'static M,
    one_of: &'static str,
) -> JsResult<Option<M::Value>> {
    let Some(value) = dictionary.get(global, member)? else {
        return Ok(None);
    };
    match comptime_string_map_jsc::from_js(values, global, value)? {
        Some(known) => Ok(Some(known)),
        None => Err(global.throw_invalid_arguments(format_args!("{member} must be {one_of}"))),
    }
}

fn unsigned_long(global: &JSGlobalObject, value: JSValue) -> JsResult<u32> {
    let number = JSValue::js_number(value.to_number(global)?);
    Ok(number.coerce_to_i32(global)? as u32)
}

type Refusal = (DOMExceptionCode, &'static str);

fn height_of(byte_len: usize, width: u32, format: ImageDataPixelFormat) -> Result<u32, Refusal> {
    if byte_len == 0 {
        return Err((DOMExceptionCode::InvalidStateError, "The data is empty"));
    }
    if !byte_len.is_multiple_of(format.bytes_per_pixel()) {
        return Err((
            DOMExceptionCode::InvalidStateError,
            "The length of the data is not a whole number of pixels",
        ));
    }
    let pixels = byte_len / format.bytes_per_pixel();
    if !pixels.is_multiple_of(width as usize) {
        return Err((
            DOMExceptionCode::IndexSizeError,
            "The length of the data is not a whole number of rows",
        ));
    }
    u32::try_from(pixels / width as usize)
        .map_err(|_| (DOMExceptionCode::IndexSizeError, "The image is too large"))
}

impl ImageData {
    pub(crate) fn constructor<'a>(
        cx: &mut JsScope<'a>,
        structure: JsStructure<'a, Self>,
        first: JsLocal<'a>,
        second: JsLocal<'a>,
        rest: &'a [JsLocal<'a>],
    ) -> JsResult<JsWrapper<'a, Self>> {
        let global = cx.global();
        let (first, second) = (first.to_js(), second.to_js());
        let optional = |index: usize| rest.get(index).map_or(JSValue::UNDEFINED, |it| it.to_js());
        let refuse = |(code, message): Refusal| {
            Err(global.throw_dom_exception(code, format_args!("{message}")))
        };

        let Some(format_of_data) = ImageDataPixelFormat::of_array(first) else {
            // `(buffer, width, height)` is a TypeError about the settings, which does not say what to change.
            let is_other_buffer = first.as_array_buffer(global).is_some();
            if rest.len() >= 2 || (is_other_buffer && optional(0).is_number()) {
                return Err(global.throw_invalid_argument_type_value2(
                    "data",
                    "an instance of Uint8ClampedArray or Float16Array",
                    first,
                ));
            }
            let width = unsigned_long(global, first)?;
            let height = unsigned_long(global, second)?;
            let settings = Settings::from_js(global, optional(0))?;
            if width == 0 || height == 0 {
                return refuse((
                    DOMExceptionCode::IndexSizeError,
                    match is_other_buffer {
                        true => "The data must be a Uint8ClampedArray or a Float16Array",
                        false => "The width and the height must not be zero",
                    },
                ));
            }
            let pixels = u64::from(width) * u64::from(height);
            let bytes_per_pixel = settings.pixel_format.bytes_per_pixel() as u64;
            // The spec has a RangeError here. WPT and the browsers have this, and leave that for a failed allocation.
            if pixels > u64::from(ArrayBuffer::MAX_SIZE) / bytes_per_pixel {
                return refuse((DOMExceptionCode::IndexSizeError, "The image is too large"));
            }
            let is_float16 = settings.pixel_format == ImageDataPixelFormat::RgbaFloat16;
            let this_value = structure.create(&cx.heap, Self::new(width, height, &settings));
            js::allocate_data(
                this_value.to_js(),
                cx.global(),
                is_float16,
                pixels as usize * 4,
            )?;
            return Ok(this_value);
        };

        if ArrayBuffer::from_typed_array(global, first).can_change_under_borrow() {
            return Err(global.throw_invalid_arguments(format_args!(
                "The data must not be a view of a shared or resizable buffer"
            )));
        }
        let width = unsigned_long(global, second)?;
        let expected_height = match optional(0) {
            height if height.is_undefined() => None,
            height => Some(unsigned_long(global, height)?),
        };
        let settings = Settings::from_js(global, optional(1))?;
        // Read after the conversions, which can detach the buffer.
        let byte_len = ArrayBuffer::from_typed_array(global, first).byte_len;
        let height = match height_of(byte_len, width, settings.pixel_format) {
            Ok(height) => height,
            Err(refusal) => return refuse(refusal),
        };
        if expected_height.is_some_and(|expected| expected != height) {
            return refuse((
                DOMExceptionCode::IndexSizeError,
                "The length of the data does not match the width and the height",
            ));
        }
        if format_of_data != settings.pixel_format {
            return refuse((
                DOMExceptionCode::InvalidStateError,
                match format_of_data {
                    ImageDataPixelFormat::RgbaUnorm8 => {
                        r#"A Uint8ClampedArray needs the pixelFormat "rgba-unorm8""#
                    }
                    ImageDataPixelFormat::RgbaFloat16 => {
                        r#"A Float16Array needs the pixelFormat "rgba-float16""#
                    }
                },
            ));
        }
        let this_value = structure.create(&cx.heap, Self::new(width, height, &settings));
        js::set_data(this_value.to_js(), first);
        Ok(this_value)
    }

    fn new(width: u32, height: u32, settings: &Settings) -> Self {
        Self {
            width,
            height,
            pixel_format: settings.pixel_format,
            color_space: settings.color_space,
        }
    }

    /// Takes over the allocation of `rgba`.
    pub(crate) fn from_rgba8(
        global: &JSGlobalObject,
        rgba: Vec<u8>,
        width: u32,
        height: u32,
        color_space: PredefinedColorSpace,
    ) -> JsResult<JSValue> {
        debug_assert_eq!(rgba.len(), width as usize * height as usize * 4);
        let data = ArrayBuffer::from_default_allocator(global, JSType::Uint8ClampedArray, rgba)?;
        let this_value = Self {
            width,
            height,
            pixel_format: ImageDataPixelFormat::RgbaUnorm8,
            color_space,
        }
        .to_js(global);
        js::set_data(this_value, data);
        Ok(this_value)
    }

    pub(crate) fn get_width(&self) -> u32 {
        self.width
    }

    pub(crate) fn get_height(&self) -> u32 {
        self.height
    }

    pub(crate) fn get_pixel_format(&self) -> ImageDataPixelFormat {
        self.pixel_format
    }

    pub(crate) fn get_color_space(&self) -> PredefinedColorSpace {
        self.color_space
    }

    pub(crate) fn width(&self) -> u32 {
        self.width
    }

    pub(crate) fn color_space_tag(&self) -> u8 {
        let tag = COLOR_SPACE_TAGS
            .iter()
            .position(|&it| it == self.color_space);
        tag.expect("every color space has a tag") as u8
    }
}

/// Empty if the record, which can come from outside the process, describes no `ImageData`.
#[unsafe(no_mangle)]
pub(crate) extern "C" fn ImageData__fromStructuredClone(
    global: &JSGlobalObject,
    data: JSValue,
    width: u32,
    color_space_tag: u8,
) -> JSValue {
    let (Some(pixel_format), Some(&color_space)) = (
        ImageDataPixelFormat::of_array(data),
        COLOR_SPACE_TAGS.get(usize::from(color_space_tag)),
    ) else {
        return JSValue::ZERO;
    };
    let view = ArrayBuffer::from_typed_array(global, data);
    if view.can_change_under_borrow() {
        return JSValue::ZERO;
    }
    let Ok(height) = height_of(view.byte_len, width, pixel_format) else {
        return JSValue::ZERO;
    };
    let this_value = ImageData {
        width,
        height,
        pixel_format,
        color_space,
    }
    .to_js(global);
    js::set_data(this_value, data);
    this_value
}
