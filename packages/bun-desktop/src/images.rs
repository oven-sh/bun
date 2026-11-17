//! Decoded images, SVG documents, and the ids that they share with canvases.

use std::cell::RefCell;
use std::collections::VecDeque;
use std::panic::catch_unwind;
use std::rc::Rc;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, LazyLock};
use std::time::{Duration, Instant};

use crate::abi::Rect;
use crate::abi_graphics::Decoded;
use crate::codec::{self, Format, Rgba};
use crate::error::{Context as _, Result};
use crate::gfx::{Pixmap, Transform};
use crate::hash::FastMap;
use crate::icc::Conversion;
use crate::paint::cpu::Painter;
use crate::paint::raster::{Clip, IntRect, Layer, demultiply, multiply};
use crate::paint::scene::{Frame, Scene};
use crate::small_vec::SmallVec;
use crate::sync::{Condvar, Mutex};
use crate::{bridge, canvas, png_rows, webview};

const MAX_ANIMATION_BYTES: usize = 64 << 20;
/// The GPU has what is on screen.
const DECODED_BYTES: usize = 16 << 20;
/// From there on, an image is decoded once it is known how large it is drawn.
const DEFERRED_PIXELS: u64 = 1 << 18;
/// From there on it only grows, or two boxes that show the same image would take turns forever.
const FEW_SIZES: u32 = 3;
const POLL: Duration = Duration::from_millis(3);

type Size = (u32, u32);

/// What the engine has painted of an SVG file.
pub struct Svg {
    scene: Scene,
    size: [f32; 2],
}

impl Svg {
    pub fn draw(&self, target: &mut Layer, rect: Rect, matrix: &Transform) {
        let matrix = matrix
            .pre_translate(rect.x, rect.y)
            .pre_scale(rect.width / self.size[0], rect.height / self.size[1]);
        let painter = Painter {
            scene: &self.scene,
            frame: &Frame::new(1., false),
            limit: usize::MAX,
            left_out: &[],
        };
        painter.paint(
            0..self.scene.items.len(),
            target,
            &matrix,
            &Clip::new(target.rect),
        );
    }
}

pub fn record(mut list: Scene, size: [f32; 2]) -> u32 {
    let (id, mut scene) = (next_id(), Scene::default());
    scene.replace(&[], &mut list);
    IMAGES
        .lock()
        .insert(id, Arc::new(Image::Svg(Box::new(Svg { scene, size }))));
    id
}

/// Each with the time at which it ends.
type Frames = Vec<(Pixmap, Duration)>;

/// A deferred image at the size that it was last drawn at.
#[derive(Default)]
struct Fitted {
    pixels: Option<Arc<Pixmap>>,
    is_pending: bool,
    /// Something else was drawn in its place.
    was_missed: bool,
    was_drawn: bool,
    is_broken: bool,
    other_sizes: u32,
}

struct Bitmap {
    size: Size,
    ends: Vec<Duration>,
    start: Instant,
    /// What `frames` are decoded from again after they were dropped. Without it, they are kept.
    encoded: Option<Vec<u8>>,
    frames: Mutex<Option<Arc<Frames>>>,
    last_used: AtomicU32,
    /// In seconds since `start`.
    last_played: AtomicU32,
    is_deferred: bool,
    fitted: Mutex<Fitted>,
    was_fitted: Condvar,
    generation: AtomicU32,
}

enum Image {
    Bitmap(Bitmap),
    Svg(Box<Svg>),
}

#[derive(Clone, Copy)]
pub enum Content<'a> {
    Pixels(&'a Pixmap),
    Svg(&'a Svg),
}

pub struct Info {
    /// `None` for SVG.
    pub size: Option<(u32, u32)>,
    /// Changes with the content.
    pub version: u32,
    pub is_deferred: bool,
}

static IMAGES: LazyLock<Mutex<FastMap<u32, Arc<Image>>>> = LazyLock::new(Mutex::default);
static NEXT_ID: AtomicU32 = AtomicU32::new(1);
static USES: AtomicU32 = AtomicU32::new(1);
/// The sizes of the last deferred images, and what they were drawn at first.
static DRAWN: Mutex<VecDeque<(Size, Size)>> = Mutex::new(VecDeque::new());

pub fn next_id() -> u32 {
    NEXT_ID.fetch_add(1, Ordering::Relaxed)
}

impl Bitmap {
    fn new(frames: Frames, encoded: Option<Vec<u8>>) -> Bitmap {
        Bitmap {
            size: (frames[0].0.width(), frames[0].0.height()),
            ends: frames.iter().map(|(_, end)| *end).collect(),
            start: Instant::now(),
            encoded,
            frames: Mutex::new(Some(Arc::new(frames))),
            last_used: AtomicU32::new(USES.fetch_add(1, Ordering::Relaxed)),
            last_played: AtomicU32::new(0),
            is_deferred: false,
            fitted: Mutex::default(),
            was_fitted: Condvar::new(),
            generation: AtomicU32::new(0),
        }
    }

    fn deferred(size: Size, encoded: Vec<u8>) -> Option<Bitmap> {
        let bitmap = Bitmap::new(vec![(Pixmap::new(1, 1)?, Duration::ZERO)], Some(encoded));
        Some(Bitmap {
            size,
            frames: Mutex::new(None),
            is_deferred: true,
            ..bitmap
        })
    }

    fn fit(&self, size: Size) -> Option<Arc<Pixmap>> {
        let whole = self.frames.lock().clone();
        match whole {
            Some(frames) => resample(&frames[0].0, size),
            None => self
                .encoded
                .as_ref()
                .and_then(|bytes| Some(in_srgb(decode_at(bytes, self.size, size)?, bytes))),
        }
        .map(Arc::new)
    }

    /// Of the given size, unless the frame cannot wait.
    fn fitted(&self, image: &Arc<Image>, frame: &Frame, size: Size) -> Option<Arc<Pixmap>> {
        self.last_used
            .store(USES.fetch_add(1, Ordering::Relaxed), Ordering::Relaxed);
        let mut fitted = self.fitted.lock();
        if !std::mem::replace(&mut fitted.was_drawn, true) {
            let mut drawn = DRAWN.lock();
            drawn.retain(|it| it.0 != self.size);
            drawn.truncate(7);
            drawn.push_front((self.size, size));
        }
        loop {
            let halves = if fitted.other_sizes < FEW_SIZES { 3 } else { 2 };
            let will_do = |it: Size| {
                is_rounded_differently(it, size)
                    || it.0 * 2 >= size.0 * halves && it.1 * 2 >= size.1 * halves
            };
            let fits = |it: &Arc<Pixmap>| {
                size_of(it) == size || frame.deadline.is_some() && will_do(size_of(it))
            };
            if fitted.is_broken || fitted.pixels.as_ref().is_some_and(fits) {
                return fitted.pixels.clone();
            }
            let deadline = frame.deadline.filter(|_| self.frames.lock().is_none());
            let Some(deadline) = deadline else {
                drop(fitted);
                let pixels = self.fit(size);
                self.fitted.lock().pixels.clone_from(&pixels);
                drop_pixels(DECODED_BYTES);
                return pixels;
            };
            start_fitting(image, &mut fitted, size);
            if fitted.pixels.is_some()
                || self
                    .was_fitted
                    .wait_until(&mut fitted, deadline)
                    .timed_out()
            {
                fitted.was_missed = true;
                frame.changes_at(frame.now + POLL);
                return fitted.pixels.clone();
            }
        }
    }

    fn index_at(&self, frame: &Frame) -> usize {
        let total = self.ends.last().map_or(0, Duration::as_millis);
        if self.ends.len() == 1 || total == 0 {
            return 0;
        }
        let elapsed = Duration::from_millis(
            (frame.now.duration_since(self.start).as_millis() % total) as u64,
        );
        let index = self
            .ends
            .partition_point(|end| *end <= elapsed)
            .min(self.ends.len() - 1);
        frame.changes_at(frame.now + self.ends[index].saturating_sub(elapsed));
        index
    }

    fn is_playing(&self) -> bool {
        self.ends.len() > 1
            && self.start.elapsed().as_secs() as u32 <= self.last_played.load(Ordering::Relaxed) + 2
    }

    fn frames(&self) -> Option<Arc<Frames>> {
        self.last_played
            .store(self.start.elapsed().as_secs() as u32, Ordering::Relaxed);
        self.last_used
            .store(USES.fetch_add(1, Ordering::Relaxed), Ordering::Relaxed);
        let known = self.frames.lock().clone();
        known.or_else(|| {
            let frames = Arc::new(decode_bitmap(self.encoded.as_ref()?, true).ok()?);
            *self.frames.lock() = Some(frames.clone());
            drop_pixels(DECODED_BYTES);
            Some(frames)
        })
    }
}

fn start_fitting(image: &Arc<Image>, fitted: &mut Fitted, size: Size) {
    if std::mem::replace(&mut fitted.is_pending, true) {
        return;
    }
    fitted.other_sizes = if fitted.pixels.is_some() {
        fitted.other_sizes + 1
    } else {
        0
    };
    let known = fitted
        .pixels
        .as_deref()
        .map(size_of)
        .filter(|_| fitted.other_sizes >= FEW_SIZES);
    let size = known.map_or(size, |it| (it.0.max(size.0), it.1.max(size.1)));
    // It is being resized.
    let (keeps_whole, image) = (fitted.other_sizes > 1, image.clone());
    bridge::spawn(move || {
        let Image::Bitmap(bitmap) = &*image else {
            return;
        };
        let fit = std::panic::AssertUnwindSafe(|| {
            if keeps_whole {
                bitmap.frames();
            }
            bitmap.fit(size)
        });
        let pixels = if Arc::strong_count(&image) > 1 {
            catch_unwind(fit).ok().flatten()
        } else {
            None
        };
        let mut fitted = bitmap.fitted.lock();
        (fitted.is_pending, fitted.is_broken, fitted.pixels) = (false, pixels.is_none(), pixels);
        if std::mem::take(&mut fitted.was_missed) {
            bitmap.generation.fetch_add(1, Ordering::Relaxed);
        }
        drop(fitted);
        bitmap.was_fitted.notify_all();
        drop_pixels(DECODED_BYTES);
    });
}

/// They are about to be drawn, that many device pixels large.
pub fn expect_all(images: impl Iterator<Item = (u32, [f32; 2])>) {
    // More than what is kept would be decoded again and again.
    let mut budget = DECODED_BYTES / 4 * 3;
    images.for_each(|(id, [width, height])| expect(id, width, height, &mut budget));
}

fn expect(id: u32, width: f32, height: f32, budget: &mut usize) {
    let Some(image) = IMAGES.lock().get(&id).cloned() else {
        return;
    };
    if let Image::Bitmap(bitmap) = &*image
        && bitmap.is_deferred
    {
        let (size, mut fitted) = (
            reduced_size(bitmap.size, width, height),
            bitmap.fitted.lock(),
        );
        let bytes = (size.0 as usize * size.1 as usize * 4)
            .max(fitted.pixels.as_ref().map_or(0, |it| it.data().len()));
        let Some(left) = budget.checked_sub(bytes) else {
            return;
        };
        *budget = left;
        bitmap
            .last_used
            .store(USES.fetch_add(1, Ordering::Relaxed), Ordering::Relaxed);
        if !fitted.is_broken
            && fitted
                .pixels
                .as_ref()
                .is_none_or(|it| it.width() + 1 < size.0 || it.height() + 1 < size.1)
        {
            fitted.was_missed |= fitted.pixels.is_some();
            start_fitting(&image, &mut fitted, size);
        }
    }
}

/// Of the images that were used least recently, until `kept` bytes are left.
fn drop_pixels(kept: usize) {
    let images = IMAGES.lock();
    let mut decoded: Vec<_> = (images.values())
        .filter_map(|image| match &**image {
            Image::Bitmap(bitmap) if bitmap.encoded.is_some() => Some(bitmap),
            _ => None,
        })
        .collect();
    decoded
        .sort_unstable_by_key(|bitmap| std::cmp::Reverse(bitmap.last_used.load(Ordering::Relaxed)));
    let (mut still, mut playing, mut small) = (0, 0, 0);
    for (index, bitmap) in decoded.into_iter().enumerate() {
        let (mut fitted, mut frames) = (bitmap.fitted.lock(), bitmap.frames.lock());
        let (total, most) = if kept > 0 && bitmap.is_playing() {
            (&mut playing, 4 * MAX_ANIMATION_BYTES)
        } else {
            (&mut still, kept)
        };
        *total += frames
            .iter()
            .flat_map(|it| it.iter())
            .map(|it| it.0.data().len())
            .sum::<usize>();
        if *total > most && (index > 0 || kept == 0) {
            frames.take();
        }
        small += fitted.pixels.as_ref().map_or(0, |it| it.data().len());
        if small > kept && (index > 0 || kept == 0) {
            fitted.pixels.take();
        }
    }
}

pub fn release_memory() {
    drop_pixels(0);
    REDUCED.take();
}

fn with_changing<R>(id: u32, f: impl FnOnce(&Pixmap, u32) -> R) -> Option<R> {
    match webview::with(id, |_, _| ()) {
        Some(()) => webview::with(id, |view, version| f(&view.pixmap, version)),
        None => canvas::with_pixels(id, f),
    }
}

pub fn info(id: u32, frame: &Frame) -> Option<Info> {
    match IMAGES.lock().get(&id).map(|image| &**image) {
        Some(Image::Svg(_)) => Some(Info {
            size: None,
            version: 0,
            is_deferred: false,
        }),
        Some(Image::Bitmap(bitmap)) if bitmap.is_deferred => {
            if bitmap.fitted.lock().was_missed {
                frame.changes_at(frame.now + POLL);
            }
            Some(Info {
                size: Some(bitmap.size),
                version: bitmap.generation.load(Ordering::Relaxed),
                is_deferred: true,
            })
        }
        Some(Image::Bitmap(bitmap)) => Some(Info {
            size: Some(bitmap.size),
            version: bitmap.index_at(frame) as u32,
            is_deferred: false,
        }),
        None => with_changing(id, |pixmap, version| Info {
            size: Some(size_of(pixmap)),
            version,
            is_deferred: false,
        }),
    }
}

/// What is scaled is likely to be animated, so that it is stretched from one of few sizes.
pub fn size_to_draw(id: u32, frame: &Frame, matrix: &Transform, needed: Size) -> Size {
    if frame.deadline.is_none() || frame.is_translation(matrix) {
        return needed;
    }
    let Some(image) = IMAGES.lock().get(&id).cloned() else {
        return needed;
    };
    let Image::Bitmap(bitmap) = &*image else {
        return needed;
    };
    let mut fitted = bitmap.fitted.lock();
    let Some(mut size) = fitted.pixels.as_deref().map(size_of) else {
        return needed;
    };
    if size != bitmap.size && (needed.0 > size.0 + size.0 / 8 || needed.1 > size.1 + size.1 / 8) {
        let larger = (
            (size.0 * 2).max(needed.0).min(bitmap.size.0),
            (size.1 * 2).max(needed.1).min(bitmap.size.1),
        );
        start_fitting(&image, &mut fitted, larger);
        fitted.was_missed = true;
        frame.changes_at(frame.now + POLL);
    }
    while size.0 / 2 >= needed.0 && size.1 / 2 >= needed.1 {
        size = (size.0 / 2, size.1 / 2);
    }
    size
}

/// With pixels of the size that `pick` makes of that of the image.
pub fn with_size<R>(
    id: u32,
    frame: &Frame,
    pick: impl FnOnce(Size) -> Size,
    f: impl FnOnce(Content) -> R,
) -> Option<R> {
    let resize = |pixmap: &Pixmap, version: u32, size: Size, f: &mut dyn FnMut(&Pixmap)| match size
        == size_of(pixmap)
    {
        true => f(pixmap),
        false => resampled(id, version, pixmap, size)
            .iter()
            .for_each(|it| f(it)),
    };
    let (mut f, mut result) = (Some(f), None);
    let mut call = |content: Content| result = f.take().map(|f| f(content));
    let image = IMAGES.lock().get(&id).cloned();
    match image.as_ref().map(|image| (image, &**image)) {
        Some((image, Image::Bitmap(bitmap))) if bitmap.is_deferred => {
            let (version, size) = (bitmap.generation.load(Ordering::Relaxed), pick(bitmap.size));
            resize(
                &*bitmap.fitted(image, frame, size)?,
                version,
                size,
                &mut |it| call(Content::Pixels(it)),
            );
        }
        _ => with(id, frame, |content, version| match content {
            Content::Pixels(pixmap) => resize(pixmap, version, pick(size_of(pixmap)), &mut |it| {
                call(Content::Pixels(it))
            }),
            Content::Svg(_) => call(content),
        })?,
    }
    result
}

fn likely_size(whole: Size, density: f32, scale: f32) -> Size {
    const THUMBNAIL: [f32; 2] = [480., 320.];
    let drawn = DRAWN.lock();
    drawn
        .iter()
        .find(|it| it.0 == whole)
        .map(|it| it.1)
        .unwrap_or_else(|| {
            let width = drawn
                .iter()
                .map(|it| it.1.0)
                .max()
                .map_or(THUMBNAIL[0] * scale, |it| it as f32);
            let factor = (width / whole.0 as f32)
                .min(THUMBNAIL[1] * scale / whole.1 as f32)
                .min(scale / density);
            reduced_size(whole, whole.0 as f32 * factor, whole.1 as f32 * factor)
        })
}

/// `f` also gets `Info::version`.
pub fn with<R>(id: u32, frame: &Frame, f: impl FnOnce(Content, u32) -> R) -> Option<R> {
    with_frame(id, |bitmap| bitmap.index_at(frame), f)
}

pub fn with_first_frame<R>(id: u32, f: impl FnOnce(Content, u32) -> R) -> Option<R> {
    with_frame(id, |_| 0, f)
}

fn with_frame<R>(
    id: u32,
    pick: impl FnOnce(&Bitmap) -> usize,
    f: impl FnOnce(Content, u32) -> R,
) -> Option<R> {
    let Some(image) = IMAGES.lock().get(&id).cloned() else {
        return with_changing(id, |pixmap, version| f(Content::Pixels(pixmap), version));
    };
    match &*image {
        Image::Svg(svg) => Some(f(Content::Svg(svg), 0)),
        Image::Bitmap(bitmap) => {
            let index = pick(bitmap);
            Some(f(
                Content::Pixels(&bitmap.frames()?.get(index)?.0),
                index as u32,
            ))
        }
    }
}

/// Releases it.
pub fn take_recording(id: u32, width: i32, height: i32) -> Option<Pixmap> {
    let image = IMAGES.lock().remove(&id)?;
    let (Image::Svg(svg), mut layer) = (&*image, Layer::new(IntRect::new(0, 0, width, height))?)
    else {
        return None;
    };
    svg.draw(
        &mut layer,
        Rect {
            x: 0.,
            y: 0.,
            width: width as f32,
            height: height as f32,
        },
        &Transform::identity(),
    );
    Some(layer.pixmap)
}

pub fn alpha(id: u32, width: u32, height: u32) -> Option<Vec<u8>> {
    with(id, &Frame::new(1., false), |content, _| match content {
        Content::Svg(svg) => {
            let mut layer = Layer::new(IntRect::new(0, 0, width as i32, height as i32))?;
            let rect = Rect {
                x: 0.,
                y: 0.,
                width: width as f32,
                height: height as f32,
            };
            svg.draw(&mut layer, rect, &Transform::identity());
            Some(layer.alpha().data)
        }
        Content::Pixels(pixmap) => {
            let source = |at: u32, to: u32, from: u32| {
                ((at as u64 * 2 + 1) * from as u64 / (to as u64 * 2)) as u32
            };
            let pixel = |x, y| {
                source(y, height, pixmap.height()) as usize * pixmap.width() as usize
                    + source(x, width, pixmap.width()) as usize
            };
            Some(
                (0..height)
                    .flat_map(|y| (0..width).map(move |x| pixmap.data()[pixel(x, y) * 4 + 3]))
                    .collect(),
            )
        }
    })?
}

pub fn insert(pixmap: Pixmap) -> u32 {
    let id = next_id();
    insert_as(id, pixmap);
    id
}

pub fn insert_as(id: u32, pixmap: Pixmap) {
    IMAGES.lock().insert(
        id,
        Arc::new(Image::Bitmap(Bitmap::new(
            vec![(pixmap, Duration::ZERO)],
            None,
        ))),
    );
}

pub fn release(id: u32) {
    drop(IMAGES.lock().remove(&id));
}

pub fn pixmap_from_rgba(width: u32, height: u32, mut rgba: Vec<u8>) -> Option<Pixmap> {
    for [r, g, b, a] in rgba
        .as_chunks_mut()
        .0
        .iter_mut()
        .filter(|pixel| pixel[3] != 255)
    {
        (*r, *g, *b) = (multiply(*r, *a), multiply(*g, *a), multiply(*b, *a));
    }
    Pixmap::from_vec(rgba, width, height)
}

fn pixmap_from(image: Rgba) -> Option<Pixmap> {
    pixmap_from_rgba(image.width, image.height, image.data)
}

pub fn straight_rgba(layer: &Layer) -> Vec<u8> {
    layer
        .pixels()
        .iter()
        .flat_map(|pixel| demultiply(*pixel))
        .collect()
}

fn in_srgb(mut pixmap: Pixmap, encoded: &[u8]) -> Pixmap {
    if let Some(conversion) = codec::profile(encoded).and_then(|it| Conversion::of(&it)) {
        conversion.apply(pixmap.data_mut().as_chunks_mut().0);
    }
    pixmap
}

pub fn decode_still(bytes: &[u8]) -> Result<Rgba> {
    codec::decode(bytes, true, (0, 0)).context("the image could not be decoded")
}

pub fn decode_pixmap(bytes: &[u8]) -> Option<Pixmap> {
    pixmap_from(codec::decode(bytes, true, (0, 0))?)
}

/// Stops at a frame that is broken or does not fit in memory.
fn decode_animation(bytes: &[u8]) -> Frames {
    let (mut frames, mut end, mut total) = (Frames::new(), Duration::ZERO, 0);
    codec::frames(bytes, &mut |frame, delay| {
        // What browsers do with a delay that is too short.
        end += if delay <= Duration::from_millis(10) {
            Duration::from_millis(100)
        } else {
            delay
        };
        total += frame.data.len();
        let frame = (total <= MAX_ANIMATION_BYTES)
            .then(|| pixmap_from(frame.clone()))
            .flatten();
        frame.map(|it| frames.push((it, end))).is_some()
    });
    frames
}

fn decode_bitmap(bytes: &[u8], is_oriented: bool) -> Result<Frames> {
    let frames = if codec::is_animated(bytes) {
        decode_animation(bytes)
    } else {
        Frames::new()
    };
    if !frames.is_empty() {
        return Ok(frames);
    }
    let image = codec::decode(bytes, is_oriented, (0, 0))
        .and_then(pixmap_from)
        .map(|it| in_srgb(it, bytes));
    Ok(vec![(
        image.context("the image could not be decoded")?,
        Duration::ZERO,
    )])
}

/// The size of a large still image.
fn size_to_defer(bytes: &[u8]) -> Option<Size> {
    let is_still = match Format::of(bytes)? {
        Format::Png => codec::png_chunks(bytes).any(|it| it.0 == b"IDAT"),
        format => matches!(format, Format::Jpeg | Format::WebP),
    } && !codec::is_animated(bytes);
    is_still
        .then(|| codec::size(bytes))?
        .filter(|(width, height)| u64::from(*width) * u64::from(*height) >= DEFERRED_PIXELS)
}

/// Never has all of the pixels. What comes after an error stays transparent.
fn decode_png_at(bytes: &[u8], whole: Size, size: Size) -> Option<Pixmap> {
    match png_rows::channels(bytes)? {
        3 => {
            let mut resampler = Resampler::<3>::new(whole, size)?;
            png_rows::read::<3>(bytes, whole, |row| resampler.take(row));
            Some(resampler.result)
        }
        _ => {
            let (mut resampler, mut premultiplied) =
                (Resampler::<4>::new(whole, size)?, Vec::new());
            png_rows::read::<4>(bytes, whole, |row| {
                let pixels = row.as_chunks::<4>().0;
                if pixels.iter().fold(255, |all, pixel| all & pixel[3]) == 255 {
                    return resampler.take(row);
                }
                premultiplied.clear();
                premultiplied.extend(
                    pixels.iter().flat_map(|&[r, g, b, a]| {
                        [multiply(r, a), multiply(g, a), multiply(b, a), a]
                    }),
                );
                resampler.take(&premultiplied);
            });
            Some(resampler.result)
        }
    }
}

fn decode_at(bytes: &[u8], whole: Size, size: Size) -> Option<Pixmap> {
    decode_png_at(bytes, whole, size).or_else(|| {
        let decoded = pixmap_from(codec::decode(bytes, true, size)?)?;
        if size_of(&decoded) == size {
            Some(decoded)
        } else {
            resample(&decoded, size)
        }
    })
}

pub fn decode(bytes: Vec<u8>, is_oriented: bool) -> Result<Decoded> {
    let orientation = codec::orientation(&bytes);
    let bitmap = match size_to_defer(&bytes).filter(|_| is_oriented) {
        Some(size) => Bitmap::deferred(size, bytes).context("out of memory")?,
        None => Bitmap::new(
            decode_bitmap(&bytes, is_oriented)?,
            is_oriented.then_some(bytes),
        ),
    };
    let (id, (width, height)) = (next_id(), bitmap.size);
    IMAGES.lock().insert(id, Arc::new(Image::Bitmap(bitmap)));
    drop_pixels(DECODED_BYTES);
    Ok(Decoded {
        id,
        size: [width, height],
        orientation,
    })
}

pub fn open(bytes: &[u8], density: f32, scale: f32) -> Option<Decoded> {
    let ((width, height), id) = (size_to_defer(bytes)?, next_id());
    IMAGES.lock().insert(
        id,
        Arc::new(Image::Bitmap(Bitmap::deferred(
            (width, height),
            bytes.to_vec(),
        )?)),
    );
    let likely = likely_size((width, height), density, scale);
    expect_all([(id, [likely.0 as f32, likely.1 as f32])].into_iter());
    Some(Decoded {
        id,
        size: [width, height],
        orientation: codec::orientation(bytes),
    })
}

type ReducedKey = (u32, u32, Size);

thread_local! {
    static REDUCED: RefCell<VecDeque<(ReducedKey, Rc<Pixmap>)>> = RefCell::default();
}

/// `resample` for an image that is drawn piece by piece.
fn resampled(id: u32, version: u32, source: &Pixmap, size: Size) -> Option<Rc<Pixmap>> {
    let key = (id, version, size);
    REDUCED.with_borrow_mut(|recent| {
        if let Some((_, known)) = recent.iter().find(|(known, _)| *known == key) {
            return Some(known.clone());
        }
        let result = Rc::new(resample(source, size)?);
        recent.push_front((key, result.clone()));
        let mut bytes = 0;
        recent.retain(|(kept, pixmap)| {
            bytes += pixmap.data().len();
            bytes <= DECODED_BYTES / 4 || *kept == key
        });
        Some(result)
    })
}

/// For each pixel of the result: the first source pixel that it covers, and the weights from there on, 256 in all.
fn area_weights(from: u32, to: u32) -> Vec<(usize, SmallVec<u16, 8>)> {
    let (from, to) = (u64::from(from), u64::from(to));
    let weights = (0..to).map(|index| {
        let (start, end) = (index * from, (index + 1) * from);
        let up_to = |at: u64| (((at * to).clamp(start, end) - start) * 256 + from / 2) / from;
        (
            ((start / to) as usize),
            (start / to..end.div_ceil(to))
                .map(|at| (up_to(at + 1) - up_to(at)) as u16)
                .collect(),
        )
    });
    weights.collect()
}

/// Averages rows of RGB or premultiplied RGBA as they come.
struct Resampler<const CHANNELS: usize> {
    columns: Vec<(usize, SmallVec<u16, 8>)>,
    rows: Vec<(usize, SmallVec<u16, 8>)>,
    sums: Vec<u16>,
    taken: usize,
    finished: usize,
    result: Pixmap,
}

impl<const CHANNELS: usize> Resampler<CHANNELS> {
    fn new(from: Size, to: Size) -> Option<Self> {
        Some(Resampler {
            columns: area_weights(from.0, to.0),
            rows: area_weights(from.1, to.1),
            sums: vec![0; from.0 as usize * CHANNELS + 1],
            taken: 0,
            finished: 0,
            result: Pixmap::new(to.0, to.1)?,
        })
    }

    fn take(&mut self, row: &[u8]) {
        while let Some((first, weights)) = self.rows.get(self.finished)
            && let Some(&weight) = weights.get(self.taken.wrapping_sub(*first))
        {
            let pairs = self.sums.iter_mut().zip(row);
            match self.taken == *first {
                true => pairs.for_each(|(sum, value)| *sum = u16::from(*value) * weight),
                false => pairs.for_each(|(sum, value)| *sum += u16::from(*value) * weight),
            }
            if self.taken + 1 < first + weights.len() {
                break;
            }
            let width = self.columns.len();
            let output = &mut self.result.data_mut().as_chunks_mut::<4>().0
                [self.finished * width..][..width];
            for (pixel, (first, weights)) in output.iter_mut().zip(&self.columns) {
                let mut total = [1u32 << 15; 4];
                for (sum, weight) in self.sums[first * CHANNELS..]
                    .array_windows::<4>()
                    .step_by(CHANNELS)
                    .zip(weights)
                {
                    (0..4).for_each(|channel| {
                        total[channel] += u32::from(sum[channel]) * u32::from(*weight)
                    });
                }
                let alpha = if CHANNELS == 3 {
                    255
                } else {
                    (total[3] >> 16) as u8
                };
                *pixel = [
                    (total[0] >> 16) as u8,
                    (total[1] >> 16) as u8,
                    (total[2] >> 16) as u8,
                    alpha,
                ];
            }
            self.finished += 1;
        }
        self.taken += 1;
    }

    fn all(from: Size, to: Size, pixels: &[u8]) -> Option<Pixmap> {
        let mut resampler = Self::new(from, to)?;
        pixels
            .chunks(from.0 as usize * CHANNELS)
            .for_each(|row| resampler.take(row));
        Some(resampler.result)
    }
}

fn size_of(pixmap: &Pixmap) -> Size {
    (pixmap.width(), pixmap.height())
}

/// Where a box is decides which pixels its edges snap to.
fn is_rounded_differently(a: Size, b: Size) -> bool {
    a.0.abs_diff(b.0) <= 1 && a.1.abs_diff(b.1) <= 1 && a.0.min(a.1) >= 64
}

fn resample(source: &Pixmap, size: Size) -> Option<Pixmap> {
    if is_rounded_differently(size_of(source), size) {
        let (mut result, rows) = (
            Pixmap::new(size.0, size.1)?,
            source
                .data()
                .as_chunks::<4>()
                .0
                .chunks(source.width() as usize),
        );
        let rows = rows.clone().chain(rows.last());
        for (to, from) in result
            .data_mut()
            .as_chunks_mut::<4>()
            .0
            .chunks_mut(size.0 as usize)
            .zip(rows)
        {
            let shared = to.len().min(from.len());
            to[..shared].copy_from_slice(&from[..shared]);
            to[shared..].fill(from[shared - 1]);
        }
        return Some(result);
    }
    Resampler::<4>::all(size_of(source), size, source.data())
}

pub fn reduced_size(source: Size, width: f32, height: f32) -> Size {
    const THRESHOLD: f32 = 1.25;
    let target = |from: u32, to: f32| match from as f32 > to * THRESHOLD {
        true => (to.round() as u32).clamp(1, from),
        false => from,
    };
    (target(source.0, width), target(source.1, height))
}

/// Averages `source` down along the axes on which bilinear sampling would skip pixels.
pub fn reduce(source: &Pixmap, width: f32, height: f32) -> Option<Pixmap> {
    let size = reduced_size(size_of(source), width, height);
    (size != size_of(source)).then(|| resample(source, size))?
}
