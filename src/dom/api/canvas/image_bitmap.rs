//! https://html.spec.whatwg.org/#the-imagebitmap-interface

use core::sync::atomic::{AtomicUsize, Ordering};

use bun_jsc::bindgen::{self, IntoError as _, JsHeap, JsInterface as _, JsScope};
use bun_jsc::job::{Completion, Job, JobContext, JsThread};
use bun_jsc::webcore_types::Blob;
use bun_jsc::{GlobalRef, JSPromise, JSPromiseStrong, JSValue, JsCell, JsResult};
use bun_web::convert::blob_from_js;
use bun_web::net::body::Data;

use super::bitmap::{MAX_AREA, Owned, Source, area_of, decode, snapshot};
use super::context::normalized;
use super::{Failure, host};
use crate::abi::Rect;
use crate::abi_graphics::{Decoded, Snapshot};
use crate::generated_bindgen::canvas::{
    CanvasImageSource, ImageBitmapOptions, ImageBitmapRenderingContext, ImageBitmapSource,
    ImageOrientation, ResizeQuality, js_ImageBitmap, js_ImageBitmapRenderingContext as js_renderer,
};

pub(crate) struct ImageBitmap {
    /// `None` once it is detached.
    pixels: JsCell<Option<(Owned, [u32; 2])>>,
    is_origin_clean: bool,
    bytes: AtomicUsize,
}

impl ImageBitmap {
    pub(crate) fn create<'a>(
        heap: &JsHeap<'a>,
        pixels: Owned,
        size: [u32; 2],
        is_origin_clean: bool,
    ) -> &'a ImageBitmap {
        let bytes = AtomicUsize::new(area_of(size) as usize * 4);
        js_ImageBitmap::create(
            heap,
            ImageBitmap {
                pixels: JsCell::new(Some((pixels, size))),
                is_origin_clean,
                bytes,
            },
        )
    }

    pub(crate) fn estimated_size(&self) -> usize {
        self.bytes.load(Ordering::Relaxed)
    }

    pub(crate) fn source(&self) -> Result<Source, Failure> {
        let pixels = self
            .pixels
            .get()
            .as_ref()
            .ok_or(Failure::invalid_state("The image source is detached."));
        pixels.map(|(pixels, size)| Source::new(pixels.id(), *size, self.is_origin_clean))
    }

    pub(crate) fn detach(&self) -> Option<Owned> {
        self.bytes.store(0, Ordering::Relaxed);
        self.pixels.replace(None).map(|it| it.0)
    }

    pub(crate) fn get_width(&self) -> u32 {
        self.pixels.get().as_ref().map_or(0, |it| it.1[0])
    }

    pub(crate) fn get_height(&self) -> u32 {
        self.pixels.get().as_ref().map_or(0, |it| it.1[1])
    }

    pub(crate) fn close(&self) {
        drop(self.detach());
    }
}

#[derive(Clone, Copy)]
struct Wanted {
    part: Option<[i64; 4]>,
    resize: [Option<u32>; 2],
    flips: bool,
    quality: ResizeQuality,
}

impl Wanted {
    /// https://html.spec.whatwg.org/#cropped-to-the-source-rectangle-with-formatting
    fn crop<'a>(&self, heap: &JsHeap<'a>, source: &Source) -> Result<&'a ImageBitmap, Failure> {
        let [x, y, width, height] = self
            .part
            .map_or([0.0, 0.0, source.size[0], source.size[1]], |part| {
                part.map(|it| it as f64)
            });
        let to = match self.resize.map(|it| it.map(f64::from)) {
            [Some(to_width), Some(to_height)] => [to_width, to_height],
            [Some(to_width), None] => [to_width, height * to_width / width],
            [None, Some(to_height)] => [width * to_height / height, to_height],
            [None, None] => [width, height],
        };
        let to = to.map(|it| it.ceil() as u32);
        if area_of(to) > MAX_AREA {
            return Err(Failure::invalid_state(
                "The ImageBitmap could not be allocated.",
            ));
        }
        let part = Rect {
            x: x as f32,
            y: y as f32,
            width: width as f32,
            height: height as f32,
        };
        let pixels = snapshot(Snapshot {
            part,
            to,
            flips: self.flips,
            is_smooth: self.quality != ResizeQuality::Pixelated,
            is_sharpened: self.quality == ResizeQuality::High,
            ..source.whole()
        });
        Ok(ImageBitmap::create(
            heap,
            pixels,
            to,
            source.is_origin_clean,
        ))
    }
}

struct DecodeBlob {
    contents: Option<Data>,
    wanted: Wanted,
    decoded: Decoded,
}

impl JobContext for DecodeBlob {
    type OffThread = DecodeBlob;
    type Js = (JSPromiseStrong, GlobalRef);

    fn run(job: &mut DecodeBlob, done: Completion<Self>) -> Option<Completion<Self>> {
        job.decoded = decode(
            job.contents
                .as_ref()
                .and_then(|it| it.read_now().ok())
                .as_deref()
                .unwrap_or_default(),
            true,
        );
        Some(done)
    }

    fn then(job: DecodeBlob, (mut promise, global): Self::Js, _: &JsThread<'_>) -> JsResult<()> {
        let heap = JsHeap::from_global(&global);
        let bitmap = match job.decoded.id {
            0 => Err(Failure::invalid_state(
                "The source image could not be decoded.",
            )),
            id => job
                .wanted
                .crop(heap, &Source::new(id, job.decoded.size, true)),
        };
        promise.settle(
            &global,
            bitmap
                .map(|it| it.to_js())
                .map_err(|it| it.into_error(heap).into_js_error(&global)),
        )
    }
}

impl Drop for DecodeBlob {
    fn drop(&mut self) {
        drop(Owned::adopt(self.decoded.id));
    }
}

fn create<'a>(
    cx: &mut JsScope<'a>,
    image: ImageBitmapSource<'a>,
    part: Option<[i32; 4]>,
    options: &ImageBitmapOptions,
) -> bindgen::Result<'a, JSValue> {
    if part.is_some_and(|it| it[2] == 0 || it[3] == 0) {
        return Err(Failure::Range("The crop rect's width or height is 0.").into_error(&cx.heap));
    }
    let wanted = Wanted {
        part: part.map(|[x, y, width, height]| normalized(x, y, width, height)),
        resize: [options.resize_width, options.resize_height],
        flips: options.image_orientation == ImageOrientation::FlipY,
        quality: options.resize_quality,
    };
    if wanted.resize.contains(&Some(0)) {
        return Err(Failure::invalid_state("The resize size is 0.").into_error(&cx.heap));
    }
    let source = match image {
        ImageBitmapSource::Blob(blob) => {
            return Ok(decode_in_parallel(
                cx,
                &blob.to_js().as_class_ref::<Blob>().expect("a Blob"),
                wanted,
            ));
        }
        ImageBitmapSource::Data(data) => {
            let pixels = data.with_pixels(&cx.heap, |rgba| {
                Owned::from_pixels(
                    data.size,
                    if data.is_wide() {
                        [None, Some(rgba)]
                    } else {
                        [Some(rgba), None]
                    },
                )
            });
            let bitmap =
                pixels.and_then(|it| wanted.crop(&cx.heap, &Source::new(it.id(), data.size, true)));
            return resolved(cx, bitmap);
        }
        ImageBitmapSource::Image(it) => CanvasImageSource::Image(it),
        ImageBitmapSource::SvgImage(it) => CanvasImageSource::SvgImage(it),
        ImageBitmapSource::Video(it) => CanvasImageSource::Video(it),
        ImageBitmapSource::Canvas(it) => CanvasImageSource::Canvas(it),
        ImageBitmapSource::Bitmap(it) => CanvasImageSource::Bitmap(it),
        ImageBitmapSource::Offscreen(it) => CanvasImageSource::Offscreen(it),
    };
    let source = host::check_usability(cx, None, source)?
        .ok_or(Failure::invalid_state("The source image is not usable."));
    let bitmap = source.and_then(|it| wanted.crop(&cx.heap, &it));
    resolved(cx, bitmap)
}

fn resolved<'a>(
    cx: &mut JsScope<'a>,
    bitmap: Result<&'a ImageBitmap, Failure>,
) -> bindgen::Result<'a, JSValue> {
    let bitmap = bitmap.map_err(|it| it.into_error(&cx.heap))?.to_js();
    Ok(JSPromise::resolved_promise_value(cx.global(), bitmap))
}

fn decode_in_parallel(cx: &mut JsScope<'_>, blob: &Blob, wanted: Wanted) -> JSValue {
    let contents = blob_from_js(blob).map(|it| it.data);
    let (promise, global) = (
        JSPromiseStrong::init(cx.global()),
        GlobalRef::new(cx.global()),
    );
    let value = promise.value();
    Job::<DecodeBlob>::schedule(
        &cx.js_thread(),
        DecodeBlob {
            contents,
            wanted,
            decoded: Decoded::default(),
        },
        (promise, global),
    );
    value
}

impl crate::generated_bindgen::canvas::ImageBitmapFactories {
    pub(crate) fn create_image_bitmap<'a>(
        &self,
        cx: &mut JsScope<'a>,
        image: ImageBitmapSource<'a>,
        options: &ImageBitmapOptions,
    ) -> bindgen::Result<'a, JSValue> {
        create(cx, image, None, options)
    }

    pub(crate) fn create_image_bitmap_of_part<'a>(
        &self,
        cx: &mut JsScope<'a>,
        image: ImageBitmapSource<'a>,
        sx: i32,
        sy: i32,
        sw: i32,
        sh: i32,
        options: &ImageBitmapOptions,
    ) -> bindgen::Result<'a, JSValue> {
        create(cx, image, Some([sx, sy, sw, sh]), options)
    }
}

/// It shows the bitmap with a context that no script gets.
impl ImageBitmapRenderingContext {
    pub(crate) fn transfer_from_image_bitmap<'a>(
        &self,
        heap: &JsHeap<'a>,
        bitmap: Option<&'a ImageBitmap>,
    ) -> Result<(), Failure> {
        let Some(context) = js_renderer::context(self) else {
            return Ok(());
        };
        let Some(bitmap) = bitmap else {
            context.set_dimensions(heap, host::canvas_size(heap, context));
            return Ok(());
        };
        let source = bitmap.source()?;
        context.set_dimensions(heap, source.size.map(|it| it as u32));
        context.draw_source(&source, None, [0.0; 2], None);
        bitmap.close();
        Ok(())
    }
}
