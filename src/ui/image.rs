//! `nativeImage`

use core::cell::{Cell, OnceCell};
use std::rc::Rc;

use bun_core::strings;
use bun_jsc::bindgen::{JsHeap, JsScope, JsWrapper};
use bun_jsc::{JSGlobalObject, JSPromise, JSValue, JsClass as _, JsResult};

use crate::generated_bindgen::native_image::{CropArea, ImageSize, ResizeOptions};
use crate::protocol::{Bitmap, Icon, ImageFormat, Size};

enum Contents {
    /// The size is 0 if it is no image.
    Encoded(Vec<u8>, OnceCell<[u32; 2]>),
    Pixels(Rc<Bitmap>),
}

pub struct NativeImage {
    contents: Contents,
    memory: usize,
    is_template: Cell<bool>,
    path: Option<Box<[u8]>>,
}

fn read(path: &[u8]) -> Option<Vec<u8>> {
    bun_sys::File::read_from(bun_sys::Fd::cwd(), path).ok()
}

/// Where the extension begins, and whether `@2x` or the like is before it.
fn split_name(path: &[u8]) -> Option<(usize, bool)> {
    let dot = strings::last_index_of_char(path, b'.')?;
    let is_word = |it: &u8| it.is_ascii_alphanumeric() || *it == b'_';
    let has_extension = dot + 1 < path.len() && path[dot + 1..].iter().all(is_word);
    let has_scale = matches!(path[..dot], [.., b'@', b'0'..=b'9', b'x']);
    has_extension.then_some((dot, has_scale))
}

fn buffer(global: &JSGlobalObject, bytes: Vec<u8>) -> JsResult<JSValue> {
    JSValue::create_buffer_from_box(global, bytes.into_boxed_slice())
}

impl NativeImage {
    fn new(contents: Contents, is_template: bool) -> Self {
        let memory = match &contents {
            Contents::Encoded(bytes, _) => bytes.len(),
            Contents::Pixels(bitmap) => bitmap.pixels.len(),
        };
        NativeImage {
            contents,
            memory,
            is_template: Cell::new(is_template),
            path: None,
        }
    }

    pub fn from_bytes(bytes: Vec<u8>) -> Self {
        Self::new(Contents::Encoded(bytes, OnceCell::new()), false)
    }

    pub fn from_pixels(bitmap: Bitmap) -> Self {
        Self::new(Contents::Pixels(Rc::new(bitmap)), false)
    }

    pub fn from_path(path: &[u8]) -> Self {
        let Some(bytes) = read(path) else {
            return Self::from_bytes(Vec::new());
        };
        let name =
            split_name(path).map(|(dot, has_scale)| &path[..dot - 3 * usize::from(has_scale)]);
        let image = NativeImage {
            path: Some(path.into()),
            ..Self::from_bytes(bytes)
        };
        image.set_template_image(name.is_some_and(|it| it.ends_with(b"Template")));
        image
    }

    /// `value` is a `NativeImage`, a path or the contents of a file.
    pub fn with<R>(
        global: &JSGlobalObject,
        value: JSValue,
        f: impl FnOnce(&NativeImage) -> JsResult<R>,
    ) -> JsResult<R> {
        if let Some(image) = value.as_class_ref::<NativeImage>() {
            return f(&image);
        }
        if value.is_string() {
            return f(&Self::from_path(&value.to_utf8(global)?));
        }
        match value.as_array_buffer(global) {
            Some(bytes) => f(&Self::from_bytes(bytes.byte_slice().to_vec())),
            None => {
                Err(global
                    .throw_type_error(format_args!("Expected a NativeImage, a path or a buffer")))
            }
        }
    }

    /// `None` if it is empty.
    fn pixels(&self, global: &JSGlobalObject) -> JsResult<Option<Rc<Bitmap>>> {
        let bitmap = match &self.contents {
            Contents::Pixels(bitmap) => Rc::clone(bitmap),
            Contents::Encoded(bytes, _) if bytes.is_empty() => return Ok(None),
            Contents::Encoded(bytes, size) => {
                let decode = crate::renderer(global)?.decode_bitmap;
                // SAFETY: the parts of a slice.
                let bitmap = unsafe { decode(bytes.as_ptr(), bytes.len()) };
                let bitmap = bitmap.get().unwrap_or_default();
                size.get_or_init(|| [bitmap.width, bitmap.height]);
                Rc::new(bitmap)
            }
        };
        Ok((!bitmap.pixels.is_empty()).then_some(bitmap))
    }

    pub fn size(&self, global: &JSGlobalObject) -> JsResult<[u32; 2]> {
        if let Contents::Encoded(_, size) = &self.contents
            && let Some(size) = size.get()
        {
            return Ok(*size);
        }
        Ok(self
            .pixels(global)?
            .map_or([0; 2], |it| [it.width, it.height]))
    }

    fn encode(
        &self,
        global: &JSGlobalObject,
        format: ImageFormat,
        quality: u8,
    ) -> JsResult<Vec<u8>> {
        let Some(pixels) = self.pixels(global)? else {
            return Ok(Vec::new());
        };
        let encoded = (crate::renderer(global)?.encode_bitmap)(&pixels, format, quality);
        Ok(encoded.or_throw(global)?.into_vec())
    }

    pub fn jpeg(&self, global: &JSGlobalObject, quality: u8) -> JsResult<Vec<u8>> {
        self.encode(global, ImageFormat::Jpeg, quality)
    }

    pub fn png(&self, global: &JSGlobalObject) -> JsResult<Vec<u8>> {
        match &self.contents {
            Contents::Encoded(bytes, _) if bytes.get(1..4) == Some(b"PNG") => Ok(bytes.clone()),
            _ => self.encode(global, ImageFormat::Png, 0),
        }
    }

    pub fn data_url(&self, global: &JSGlobalObject) -> JsResult<Vec<u8>> {
        let mut url = b"data:image/png;base64,".to_vec();
        bun_base64::encode_append(&mut url, &self.png(global)?);
        Ok(url)
    }

    /// For what the platform scales to a size that it knows.
    pub fn icon(&self, global: &JSGlobalObject) -> JsResult<Icon> {
        let sharper = || {
            let path = self.path.as_deref().filter(|_| cfg!(target_os = "macos"))?;
            let (dot, _) = split_name(path).filter(|it| !it.1)?;
            read(&[&path[..dot], b"@2x", &path[dot..]].concat())
        };
        let [width, height] = self.size(global)?.map(|it| it as f32);
        Ok(Icon {
            bytes: sharper().map_or_else(|| self.png(global), Ok)?.into(),
            size: Size { width, height },
            is_template: self.is_template.get(),
        })
    }

    fn aspect_ratio(&self, global: &JSGlobalObject) -> JsResult<f64> {
        let [width, height] = self.size(global)?.map(f64::from);
        Ok(if height == 0. { 1. } else { width / height })
    }

    fn resized(&self, global: &JSGlobalObject, options: &ResizeOptions) -> JsResult<NativeImage> {
        let Some(pixels) = self.pixels(global)? else {
            return Ok(Self::from_bytes(Vec::new()));
        };
        let ratio = f64::from(pixels.width) / f64::from(pixels.height);
        let width = options
            .width
            .unwrap_or_else(|| options.height.unwrap_or(0.) * ratio);
        let height = options.height.unwrap_or(width / ratio);
        let resize = crate::renderer(global)?.resize_bitmap;
        let resized =
            resize(&pixels, width.round() as u32, height.round() as u32).or_throw(global)?;
        Ok(Self::new(
            Contents::Pixels(Rc::new(resized)),
            self.is_template.get(),
        ))
    }

    pub(crate) fn estimated_size(&self) -> usize {
        self.memory
    }

    pub(crate) fn is_empty(&self, cx: &mut JsScope<'_>) -> JsResult<bool> {
        Ok(self.size(cx.global())?[0] == 0)
    }

    pub(crate) fn get_size(&self, cx: &mut JsScope<'_>) -> JsResult<ImageSize> {
        let [width, height] = self.size(cx.global())?;
        Ok(ImageSize { width, height })
    }

    pub(crate) fn get_aspect_ratio(&self, cx: &mut JsScope<'_>) -> JsResult<f64> {
        self.aspect_ratio(cx.global())
    }

    pub(crate) fn get_scale_factors(&self, cx: &mut JsScope<'_>) -> JsResult<Option<u8>> {
        Ok((!self.is_empty(cx)?).then_some(1))
    }

    pub(crate) fn to_png(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        let global = cx.global();
        buffer(global, self.png(global)?)
    }

    pub(crate) fn to_jpeg(&self, cx: &mut JsScope<'_>, quality: f64) -> JsResult<JSValue> {
        let global = cx.global();
        buffer(global, self.jpeg(global, quality as u8)?)
    }

    /// BGRA, premultiplied.
    pub(crate) fn to_bitmap(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        let global = cx.global();
        let mut bytes = self
            .pixels(global)?
            .map_or(Vec::new(), |it| it.pixels.to_vec());
        for pixel in bytes.as_chunks_mut().0 {
            let [r, g, b, a] = *pixel;
            let scaled = |it: u8| ((u32::from(it) * u32::from(a) + 127) / 255) as u8;
            *pixel = [scaled(b), scaled(g), scaled(r), a];
        }
        buffer(global, bytes)
    }

    pub(crate) fn to_data_url(&self, cx: &mut JsScope<'_>) -> JsResult<Vec<u8>> {
        self.data_url(cx.global())
    }

    pub(crate) fn resize<'a>(
        &self,
        this_value: JsWrapper<'a, Self>,
        cx: &mut JsScope<'a>,
        options: &ResizeOptions,
    ) -> JsResult<JSValue> {
        if options.width.is_none() && options.height.is_none() {
            return Ok(this_value.to_js());
        }
        let global = cx.global();
        Ok(self.resized(global, options)?.to_js(global))
    }

    pub(crate) fn crop(&self, cx: &mut JsScope<'_>, area: &CropArea) -> JsResult<JSValue> {
        let global = cx.global();
        let from = self.pixels(global)?.unwrap_or_default();
        let (left, top) = (
            (area.x as u32).min(from.width),
            (area.y as u32).min(from.height),
        );
        let width = (area.width as u32).min(from.width - left);
        let height = (area.height as u32).min(from.height - top);
        let mut pixels = Vec::with_capacity(width as usize * height as usize * 4);
        for y in top..top + height {
            let start = (y as usize * from.width as usize + left as usize) * 4;
            pixels.extend_from_slice(&from.pixels[start..][..width as usize * 4]);
        }
        let cropped = Rc::new(Bitmap {
            width,
            height,
            pixels: pixels.into(),
        });
        Ok(Self::new(Contents::Pixels(cropped), self.is_template.get()).to_js(global))
    }

    pub(crate) fn add_representation(&self) {}

    pub(crate) fn is_template_image(&self) -> bool {
        self.is_template.get()
    }

    pub(crate) fn set_template_image(&self, is_template: bool) {
        self.is_template.set(is_template);
    }

    pub(crate) fn get_is_mac_template_image(&self) -> bool {
        self.is_template.get()
    }

    pub(crate) fn set_is_mac_template_image(&self, is_template: bool) {
        self.is_template.set(is_template);
    }
}

pub fn module(heap: &JsHeap<'_>) -> JSValue {
    crate::generated_bindgen::native_image::js_UiImages::CLASS.constructor(heap)
}

impl crate::generated_bindgen::native_image::UiImages {
    pub(crate) fn create_empty(cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        Self::create_from_buffer(cx, Vec::new())
    }

    pub(crate) fn create_from_buffer(cx: &mut JsScope<'_>, bytes: Vec<u8>) -> JsResult<JSValue> {
        Ok(NativeImage::from_bytes(bytes).to_js(cx.global()))
    }

    pub(crate) fn create_from_named_image(cx: &mut JsScope<'_>, name: &[u8]) -> JsResult<JSValue> {
        let global = cx.global();
        let png = (crate::start(global)?.named_image)(crate::protocol::Text::lossy(name))
            .or_throw(global)?;
        Ok(NativeImage::from_bytes(png.into_vec()).to_js(global))
    }

    pub(crate) fn create_from_data_url(cx: &mut JsScope<'_>, url: &[u8]) -> JsResult<JSValue> {
        let data = &url[strings::index_of_char_usize(url, b',').map_or(0, |it| it + 1)..];
        Self::create_from_buffer(cx, bun_base64::decode_alloc(data).unwrap_or_default())
    }

    pub(crate) fn create_from_path(cx: &mut JsScope<'_>, path: Option<&[u8]>) -> JsResult<JSValue> {
        Ok(NativeImage::from_path(path.unwrap_or_default()).to_js(cx.global()))
    }

    /// Of what `to_bitmap` returns.
    pub(crate) fn create_from_bitmap(
        cx: &mut JsScope<'_>,
        mut bytes: Vec<u8>,
        &ImageSize { width, height }: &ImageSize,
    ) -> JsResult<JSValue> {
        let global = cx.global();
        if bytes.len() as u128 != u128::from(width) * u128::from(height) * 4 {
            return Err(global.throw(format_args!("invalid buffer size")));
        }
        for pixel in bytes.as_chunks_mut().0 {
            let [b, g, r, a] = *pixel;
            let alpha = u32::from(a);
            let scaled = |it: u8| match alpha {
                0 => 0,
                _ => ((u32::from(it) * 255 + alpha / 2) / alpha).min(255) as u8,
            };
            *pixel = [scaled(r), scaled(g), scaled(b), a];
        }
        Ok(NativeImage::from_pixels(Bitmap {
            width,
            height,
            pixels: bytes.into(),
        })
        .to_js(global))
    }

    pub(crate) fn create_thumbnail_from_path(
        cx: &mut JsScope<'_>,
        path: &[u8],
        size: &ResizeOptions,
    ) -> JsResult<JSValue> {
        let (global, image) = (cx.global(), NativeImage::from_path(path));
        let [width, _] = image.size(global)?.map(f64::from);
        if width == 0. {
            return Err(global.throw(format_args!(
                "Unable to retrieve thumbnail preview image for the given path"
            )));
        }
        let options = ResizeOptions {
            width: Some(size.width.unwrap_or(width).min(width)),
            height: None,
        };
        let thumbnail = image.resized(global, &options)?.to_js(global);
        Ok(JSPromise::resolved_promise_value(global, thumbnail))
    }
}
