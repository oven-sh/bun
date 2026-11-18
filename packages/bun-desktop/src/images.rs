//! Decoded images, SVG documents, and the ids that they share with canvases.

use std::cell::RefCell;
use std::collections::VecDeque;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::rc::Rc;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicUsize, Ordering};
use std::sync::{Arc, LazyLock, OnceLock};
use std::time::{Duration, Instant};

use crate::abi::{DisplayList, Rect};
use crate::abi_graphics::Decoded;
use crate::codec::{self, Format, Rgba};
use crate::error::{Context as _, Result};
use crate::gfx::{Pixmap, Transform};
use crate::hash::FastMap;
use crate::icc::Conversion;
use crate::paint::cpu::Painter;
use crate::paint::raster::{Clip, IntRect, Layer, demultiply_row, multiply, premultiply_row};
use crate::paint::scene::{Frame, Scene};
use crate::remote::guest;
use crate::remote::pages::Original;
use crate::small_vec::SmallVec;
use crate::sync::{Condvar, Mutex};
use crate::{bridge, canvas, png_rows, webview};

const MAX_ANIMATION_BYTES: usize = 64 << 20;
/// Of all animations that are playing.
const PLAYING_BYTES: usize = 4 * MAX_ANIMATION_BYTES;
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
    pub fn draw(&self, target: &mut Layer, rect: Rect, matrix: &Transform, within: &Frame) {
        let matrix = matrix
            .pre_translate(rect.x, rect.y)
            .pre_scale(rect.width / self.size[0], rect.height / self.size[1]);
        let frame = Frame {
            gives_up_at: within.gives_up_at,
            ..Frame::new(1., false)
        };
        let painter = Painter {
            scene: &self.scene,
            frame: &frame,
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

pub fn record(id: u32, mut list: Scene, size: [f32; 2]) -> u32 {
    let mut scene = Scene::default();
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
    /// The frames of an animation are.
    stands_still: bool,
    other_sizes: u32,
}

struct Bitmap {
    size: Size,
    ends: Vec<Duration>,
    start: Instant,
    /// What `frames` are decoded from again after they were dropped. Without it, they are kept.
    encoded: Option<Vec<u8>>,
    is_oriented: bool,
    /// In its place.
    original: Option<Original>,
    frames: Mutex<Option<Arc<Frames>>>,
    last_used: AtomicU32,
    /// In seconds since `start`.
    last_played: AtomicU32,
    /// `frames` are on their way, or failed to come.
    was_requested: AtomicBool,
    is_deferred: bool,
    fitted: Mutex<Fitted>,
    was_fitted: Condvar,
    generation: AtomicU32,
    /// `frames` are in Display P3.
    is_wide: bool,
    widen: OnceLock<Option<Box<Widen>>>,
}

/// Makes the pixels again, in Display P3 and with the colors that sRGB lacks.
#[derive(Clone)]
pub struct Widen {
    make: Arc<dyn Fn() -> Option<Pixmap> + Send + Sync>,
    depth: u8,
}

impl Widen {
    pub fn kept(mut wide: Pixmap) -> Widen {
        wide.allow_sharing();
        Widen {
            make: Arc::new(move || wide.shared()),
            depth: 0,
        }
    }

    pub fn then(
        self,
        change: impl Fn(&Pixmap) -> Option<Pixmap> + Send + Sync + 'static,
    ) -> Option<Widen> {
        const MAX_DEPTH: u8 = 3;
        let Widen { make, depth } = self;
        match depth < MAX_DEPTH {
            true => Some(Widen {
                make: Arc::new(move || change(&make()?)),
                depth: depth + 1,
            }),
            false => change(&make()?).map(Widen::kept),
        }
    }
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
    fn new(mut frames: Frames, encoded: Option<Vec<u8>>) -> Bitmap {
        frames[0].0.allow_sharing();
        Bitmap {
            size: (frames[0].0.width(), frames[0].0.height()),
            ends: frames.iter().map(|(_, end)| *end).collect(),
            start: Instant::now(),
            encoded,
            is_oriented: true,
            original: None,
            frames: Mutex::new(Some(Arc::new(frames))),
            last_used: AtomicU32::new(USES.fetch_add(1, Ordering::Relaxed)),
            last_played: AtomicU32::new(0),
            was_requested: AtomicBool::new(false),
            is_deferred: false,
            fitted: Mutex::default(),
            was_fitted: Condvar::new(),
            generation: AtomicU32::new(0),
            is_wide: false,
            widen: OnceLock::new(),
        }
    }

    fn widen(&self) -> Option<Widen> {
        let again = || {
            let (encoded, is_oriented) = (self.encoded.as_ref()?, self.is_oriented);
            let profile = codec::profile(encoded).filter(|it| Conversion::of(it).is_some());
            let encoded =
                (profile.is_some() || codec::is_display_p3(encoded)).then(|| encoded.clone())?;
            let make = Arc::new(move || {
                let mut pixmap = pixmap_from(codec::decode(&encoded, is_oriented, (0, 0))?)?;
                profile
                    .iter()
                    .filter_map(|it| Conversion::to_display_p3(it))
                    .for_each(|it| it.apply(pixmap.data_mut().as_chunks_mut().0));
                Some(pixmap)
            });
            Some(Box::new(Widen { make, depth: 0 }))
        };
        self.widen.get_or_init(again).as_deref().cloned()
    }

    fn deferred(
        Outline {
            size,
            ends,
            is_oriented,
        }: Outline,
        encoded: Vec<u8>,
    ) -> Option<Bitmap> {
        let bitmap = Bitmap::new(vec![(Pixmap::new(1, 1)?, Duration::ZERO)], Some(encoded));
        Some(Bitmap {
            size,
            ends,
            is_oriented,
            frames: Mutex::new(None),
            is_deferred: true,
            ..bitmap
        })
    }

    fn decode(&self) -> Option<Frames> {
        decode_bitmap(
            self.encoded.as_ref()?,
            self.is_oriented,
            !self.is_deferred || self.ends.len() > 1,
        )
        .ok()
    }

    fn bytes_of_frames(&self) -> usize {
        byte_count(self.size).saturating_mul(self.ends.len())
    }

    /// Whether it is drawn from `fitted`. An animation stands still until its frames are there.
    fn is_fitted(&self, image: &Arc<Image>, frame: &Frame) -> bool {
        const RETRY: Duration = Duration::from_secs(1);
        if self.ends.len() == 1 {
            return self.is_deferred;
        }
        self.note_use();
        if frame.deadline.is_none() || self.frames.lock().is_some() {
            return false;
        }
        if !self.was_requested.load(Ordering::Relaxed) && reserve_for_playing(self) {
            let image = image.clone();
            let finish = move |fetched: Option<Vec<Pixmap>>| {
                let Image::Bitmap(bitmap) = &*image else {
                    return;
                };
                let frames = || {
                    Arc::strong_count(&image) > 1
                        && fetched
                            .map_or_else(|| bitmap.frames(), |it| bitmap.keep(bitmap.timed(it)?))
                            .is_some()
                };
                let has_frames = catch_unwind(AssertUnwindSafe(frames)).unwrap_or(false);
                let mut fitted = bitmap.fitted.lock();
                fitted.pixels.take_if(|_| has_frames);
                fitted.stands_still = !has_frames && bitmap.original.is_none();
                bitmap
                    .was_requested
                    .store(fitted.stands_still, Ordering::Relaxed);
            };
            match &self.original {
                Some(original) => original.fetch((0, 0), true, move |it| {
                    bridge::spawn(move || finish(Some(it)))
                }),
                None => spawn_decoding(self, move || finish(None)),
            }
        }
        let fitted = self.fitted.lock();
        let is_awaited = self.was_requested.load(Ordering::Relaxed) || fitted.was_missed;
        if !fitted.stands_still || fitted.was_missed {
            frame.changes_at(frame.now + if is_awaited { POLL } else { RETRY });
        }
        true
    }

    fn version(&self, is_fitted: bool, frame: &Frame) -> u32 {
        if is_fitted {
            !self.generation.load(Ordering::Relaxed)
        } else {
            self.index_at(frame) as u32
        }
    }

    fn note_use(&self) {
        self.last_played
            .store(self.start.elapsed().as_secs() as u32, Ordering::Relaxed);
        self.last_used
            .store(USES.fetch_add(1, Ordering::Relaxed), Ordering::Relaxed);
    }

    fn fit(&self, size: Size) -> Option<Arc<Pixmap>> {
        let whole = self.frames.lock().clone();
        match whole {
            Some(frames) => resample(&frames[0].0, size),
            None => match &self.original {
                Some(original) => original
                    .fetch_now(size)
                    .pop()
                    .filter(|it| size_of(it) == size),
                None => self.encoded.as_ref().and_then(|bytes| {
                    Some(in_srgb(
                        decode_at(bytes, self.is_oriented, self.size, size)?,
                        bytes,
                    ))
                }),
            },
        }
        .map(Arc::new)
    }

    /// Of the given size, unless the frame cannot wait.
    fn fitted(&self, image: &Arc<Image>, frame: &Frame, size: Size) -> Option<Arc<Pixmap>> {
        self.last_used
            .store(USES.fetch_add(1, Ordering::Relaxed), Ordering::Relaxed);
        let mut fitted = self.fitted.lock();
        if !std::mem::replace(&mut fitted.was_drawn, true) {
            note_drawn(self.size, size);
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
        self.note_use();
        let known = self.frames.lock().clone();
        known.or_else(|| {
            self.keep(
                self.original
                    .as_ref()
                    .map_or_else(|| self.decode(), |it| self.timed(it.fetch_now((0, 0))))?,
            )
        })
    }

    fn timed(&self, fetched: Vec<Pixmap>) -> Option<Frames> {
        let fits = (1..=self.ends.len()).contains(&fetched.len())
            && fetched.iter().all(|it| size_of(it) == self.size);
        fits.then(|| fetched.into_iter().zip(self.ends.clone()).collect())
    }

    fn keep(&self, frames: Frames) -> Option<Arc<Frames>> {
        let frames = Arc::new(frames);
        *self.frames.lock() = Some(frames.clone());
        drop_pixels(DECODED_BYTES);
        Some(frames)
    }
}

fn byte_count((width, height): Size) -> usize {
    width as usize * height as usize * 4
}

fn taken_for_playing() -> usize {
    // What has not played for a while may be further down in this frame.
    drop_pixels(DECODED_BYTES);
    let is_taken = |it: &Bitmap| match it.was_requested.load(Ordering::Relaxed) {
        true => !it.fitted.lock().stands_still,
        false => it.is_playing() && it.frames.lock().is_some(),
    };
    let bytes = |image: &Arc<Image>| match &**image {
        Image::Bitmap(it) if is_taken(it) => it.bytes_of_frames(),
        _ => 0,
    };
    IMAGES
        .lock()
        .values()
        .map(bytes)
        .fold(0, usize::saturating_add)
}

fn reserve_for_playing(bitmap: &Bitmap) -> bool {
    static TAKEN: Mutex<Option<(Instant, usize)>> = Mutex::new(None);
    let mut taken = TAKEN.lock();
    taken.take_if(|it| it.0.elapsed() > Duration::from_millis(500));
    let (_, taken) = taken.get_or_insert_with(|| (Instant::now(), taken_for_playing()));
    let fits = taken.saturating_add(bitmap.bytes_of_frames()) <= PLAYING_BYTES;
    if fits {
        *taken += bitmap.bytes_of_frames();
        bitmap.was_requested.store(true, Ordering::Relaxed);
    }
    fits
}

/// Of large images.
#[derive(Default)]
struct Decoding {
    count: usize,
    bytes: usize,
    waiting: VecDeque<(usize, Box<dyn FnOnce() + Send>)>,
}

static DECODING: LazyLock<Mutex<Decoding>> = LazyLock::new(Mutex::default);

impl Decoding {
    /// Together they are no larger than one can be, and they leave a thread to others.
    fn proceed(&mut self) {
        while let Some((bytes, job)) = self.waiting.pop_front_if(|it| {
            self.count == 0 || self.count < 3 && self.bytes + it.0 <= codec::MAX_BYTES
        }) {
            (self.count, self.bytes) = (self.count + 1, self.bytes + bytes);
            bridge::spawn(move || {
                job();
                let mut decoding = DECODING.lock();
                (decoding.count, decoding.bytes) = (decoding.count - 1, decoding.bytes - bytes);
                decoding.proceed();
            });
        }
    }
}

fn spawn_decoding(bitmap: &Bitmap, job: impl FnOnce() + Send + 'static) {
    let bytes = bitmap.bytes_of_frames().min(codec::MAX_BYTES);
    if bytes <= DECODED_BYTES {
        return bridge::spawn(job);
    }
    let mut decoding = DECODING.lock();
    decoding.waiting.push_back((bytes, Box::new(job)));
    decoding.proceed();
}

fn start_fitting(image: &Arc<Image>, fitted: &mut Fitted, size: Size) {
    let Image::Bitmap(bitmap) = &**image else {
        return;
    };
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
    let (keeps_whole, image) = (
        fitted.other_sizes > 1 && bitmap.ends.len() == 1,
        image.clone(),
    );
    if let Some(original) = &bitmap.original {
        return original.fetch(size, fitted.pixels.is_some(), move |mut it| {
            bridge::spawn(move || finish_fitting(&image, it.pop().map(Arc::new)))
        });
    }
    spawn_decoding(bitmap, move || {
        let Image::Bitmap(bitmap) = &*image else {
            return;
        };
        let fit = AssertUnwindSafe(|| {
            if keeps_whole {
                bitmap.frames();
            }
            bitmap.fit(size)
        });
        finish_fitting(
            &image,
            if Arc::strong_count(&image) > 1 {
                catch_unwind(fit).ok().flatten()
            } else {
                None
            },
        );
    });
}

fn finish_fitting(image: &Image, pixels: Option<Arc<Pixmap>>) {
    let Image::Bitmap(bitmap) = image else { return };
    let mut fitted = bitmap.fitted.lock();
    (fitted.is_pending, fitted.is_broken, fitted.pixels) = (false, pixels.is_none(), pixels);
    if std::mem::take(&mut fitted.was_missed) {
        bitmap.generation.fetch_add(1, Ordering::Relaxed);
        bitmap.note_use();
    }
    drop(fitted);
    bitmap.was_fitted.notify_all();
    drop_pixels(DECODED_BYTES);
}

fn note_drawn(whole: Size, size: Size) {
    let mut drawn = DRAWN.lock();
    drawn.retain(|it| it.0 != whole);
    drawn.truncate(7);
    drawn.push_front((whole, size));
}

pub enum Exported<'a> {
    Recording {
        list: DisplayList,
        size: [f32; 2],
    },
    /// `ends` are in milliseconds.
    Bitmap {
        size: [u32; 2],
        ends: Vec<u32>,
        is_deferred: bool,
        can_be_fetched: bool,
        frames: &'a [&'a Pixmap],
    },
}

/// For the process that draws it, which keeps the pixels from now on.
pub fn export<R>(id: u32, f: impl FnOnce(Exported) -> R) -> Option<R> {
    let id = in_space(id, false);
    let image = IMAGES.lock().get(&id).cloned()?;
    Some(match &*image {
        Image::Svg(svg) => f(Exported::Recording {
            list: svg.scene.list(),
            size: svg.size,
        }),
        Image::Bitmap(bitmap) => {
            let (is_deferred, can_be_fetched) = (bitmap.is_deferred, bitmap.encoded.is_some());
            let fitted = bitmap
                .fitted
                .lock()
                .pixels
                .take()
                .filter(|_| bitmap.ends.len() == 1);
            let whole = if can_be_fetched {
                bitmap.frames.lock().take_if(|_| !is_deferred)
            } else {
                bitmap.frames.lock().clone()
            };
            let frames: Vec<_> = fitted
                .as_deref()
                .into_iter()
                .chain(whole.iter().flat_map(|it| it.iter().map(|it| &it.0)))
                .collect();
            let ends = bitmap.ends.iter().map(|it| it.as_millis() as u32).collect();
            f(Exported::Bitmap {
                size: bitmap.size.into(),
                ends,
                is_deferred,
                can_be_fetched,
                frames: &frames,
            })
        }
    })
}

pub fn import(
    id: u32,
    size: [u32; 2],
    ends: &[u32],
    is_deferred: bool,
    original: Option<Original>,
    mut frames: Vec<Pixmap>,
) -> u32 {
    static IMPORTED: AtomicUsize = AtomicUsize::new(0);
    let bytes = frames.iter().map(|it| it.data().len()).sum::<usize>();
    let ends: Vec<_> = ends
        .iter()
        .map(|it| Duration::from_millis((*it).into()))
        .collect();
    let pixels = frames.pop_if(|_| is_deferred).map(Arc::new);
    let frames = (!is_deferred && !frames.is_empty())
        .then(|| Arc::new(frames.into_iter().zip(ends.clone()).collect()));
    let empty = Bitmap::new(
        vec![(Pixmap::new(1, 1).expect("it is a size"), Duration::ZERO)],
        None,
    );
    let fitted = Mutex::new(Fitted {
        pixels,
        ..Fitted::default()
    });
    let bitmap = Bitmap {
        size: size.into(),
        ends,
        original,
        frames: Mutex::new(frames),
        is_deferred,
        fitted,
        ..empty
    };
    IMAGES.lock().insert(id, Arc::new(Image::Bitmap(bitmap)));
    if IMPORTED.fetch_add(bytes, Ordering::Relaxed) + bytes > DECODED_BYTES / 4 {
        IMPORTED.store(0, Ordering::Relaxed);
        drop_pixels(DECODED_BYTES);
    }
    id
}

/// All frames for a size of zero.
pub fn fetch(id: u32, size: Size, is_exact: bool, reply: impl FnOnce(&[&Pixmap])) -> Option<()> {
    let image = IMAGES.lock().get(&id).cloned()?;
    let Image::Bitmap(bitmap) = &*image else {
        return None;
    };
    if size == (0, 0) {
        let known = bitmap.frames.lock().take();
        let frames = known.or_else(|| bitmap.decode().map(Arc::new))?;
        reply(&frames.iter().map(|it| &it.0).collect::<Vec<_>>());
        return Some(());
    }
    let mut fitted = bitmap.fitted.lock();
    bitmap
        .was_fitted
        .wait_while(&mut fitted, |it| it.is_pending);
    if !std::mem::replace(&mut fitted.was_drawn, true) {
        note_drawn(bitmap.size, size);
    }
    let will_do = |it: &Arc<Pixmap>| {
        size_of(it) == size || !is_exact && it.width() + 1 >= size.0 && it.height() + 1 >= size.1
    };
    let known = fitted.pixels.take().filter(will_do);
    drop(fitted);
    reply(&[&*known.or_else(|| bitmap.fit(size))?]);
    Some(())
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
        let bytes = byte_count(size).max(fitted.pixels.as_ref().map_or(0, |it| it.data().len()));
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
            Image::Bitmap(bitmap) if bitmap.encoded.is_some() || bitmap.original.is_some() => {
                Some(bitmap)
            }
            _ => None,
        })
        .collect();
    decoded
        .sort_unstable_by_key(|bitmap| std::cmp::Reverse(bitmap.last_used.load(Ordering::Relaxed)));
    let (mut still, mut playing, mut small) = (0, 0, 0);
    for (index, bitmap) in decoded.into_iter().enumerate() {
        let (mut fitted, mut frames) = (bitmap.fitted.lock(), bitmap.frames.lock());
        let (total, most) = if kept > 0 && bitmap.is_playing() {
            (&mut playing, PLAYING_BYTES)
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

#[cfg(test)]
pub fn bytes_of_pixels() -> usize {
    let of = |image: &Arc<Image>| match &**image {
        Image::Bitmap(it) if it.original.is_some() => it
            .frames
            .lock()
            .iter()
            .flat_map(|it| it.iter())
            .map(|it| it.0.data().len())
            .sum(),
        _ => 0,
    };
    IMAGES.lock().values().map(of).sum()
}

pub fn release_memory() {
    drop_pixels(0);
    REDUCED.take();
}

fn with_changing<R>(id: u32, f: impl FnOnce(&Pixmap, u32) -> R) -> Option<R> {
    match webview::size_and_version(id) {
        Some(_) => webview::with(id, |view, version| f(&view.pixmap, version)),
        None => canvas::with_pixels(id, f),
    }
}

pub fn info(id: u32, frame: &Frame) -> Option<Info> {
    let image = IMAGES.lock().get(&id).cloned();
    match image.as_ref().map(|image| (image, &**image)) {
        Some((_, Image::Svg(_))) => Some(Info {
            size: None,
            version: 0,
            is_deferred: false,
        }),
        Some((image, Image::Bitmap(bitmap))) => {
            let is_deferred = bitmap.is_fitted(image, frame);
            if bitmap.is_deferred && bitmap.fitted.lock().was_missed {
                frame.changes_at(frame.now + POLL);
            }
            Some(Info {
                size: Some(bitmap.size),
                version: bitmap.version(is_deferred, frame),
                is_deferred,
            })
        }
        None => (webview::size_and_version(id).or_else(|| canvas::size_and_version(id))).map(
            |(size, version)| Info {
                size: Some(size),
                version,
                is_deferred: false,
            },
        ),
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
    let id = in_space(id, false);
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
        Some((image, Image::Bitmap(bitmap))) if bitmap.is_fitted(image, frame) => {
            let (version, size) = (bitmap.version(true, frame), pick(bitmap.size));
            resize(
                &*bitmap.fitted(image, frame, size)?,
                version,
                size,
                &mut |it| call(Content::Pixels(it)),
            );
        }
        _ => with_frame(
            id,
            |bitmap| bitmap.index_at(frame),
            |content, version| match content {
                Content::Pixels(pixmap) => {
                    resize(pixmap, version, pick(size_of(pixmap)), &mut |it| {
                        call(Content::Pixels(it))
                    })
                }
                Content::Svg(_) => call(content),
            },
        )?,
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

pub fn with<R>(id: u32, frame: &Frame, f: impl FnOnce(Content) -> R) -> Option<R> {
    match frame.deadline {
        Some(_) => with_size(id, frame, |whole| whole, f),
        None => with_frame(
            in_space(id, false),
            |bitmap| bitmap.index_at(frame),
            |content, _| f(content),
        ),
    }
}

static HAS_WIDE: AtomicBool = AtomicBool::new(false);

/// There is something in Display P3.
pub fn note_wide() {
    HAS_WIDE.store(true, Ordering::Relaxed);
}

fn with_bitmap<R>(id: u32, f: impl FnOnce(&Bitmap) -> R) -> Option<R> {
    let image = IMAGES.lock().get(&id).cloned()?;
    if let Image::Bitmap(bitmap) = &*image {
        Some(f(bitmap))
    } else {
        None
    }
}

pub fn is_wide(id: u32) -> bool {
    HAS_WIDE.load(Ordering::Relaxed)
        && with_bitmap(id, |it| it.is_wide).unwrap_or_else(|| canvas::is_wide(id))
}

pub fn widen(id: u32) -> Option<Widen> {
    with_bitmap(id, Bitmap::widen)?
}

struct Converted {
    of: u32,
    version: u32,
    id: u32,
    bytes: usize,
}

static CONVERTED: Mutex<VecDeque<Converted>> = Mutex::new(VecDeque::new());

/// The number of what has its first frame in Display P3 or in sRGB, for now. SVG has no pixels.
#[inline]
pub fn in_space(id: u32, is_wide: bool) -> u32 {
    if self::is_wide(id) == is_wide {
        id
    } else {
        convert(id, is_wide)
    }
}

#[cold]
fn convert(of: u32, is_wide: bool) -> u32 {
    let version = webview::size_and_version(of)
        .or_else(|| canvas::size_and_version(of))
        .map_or(0, |it| it.1);
    if let Some(known) = CONVERTED
        .lock()
        .iter()
        .find(|it| (it.of, it.version) == (of, version))
    {
        return known.id;
    }
    let converted = widen(of)
        .filter(|_| is_wide)
        .and_then(|it| (it.make)())
        .or_else(|| {
            let copy = |content: Content, _| {
                if let Content::Pixels(it) = content {
                    converted(it, is_wide)
                } else {
                    None
                }
            };
            with_first_frame(of, copy)?
        });
    let Some(pixmap) = converted else { return of };
    let (id, bytes, mut kept) = (next_id(), pixmap.data().len(), 0);
    insert_as(id, pixmap, is_wide, None);
    let (mut all, mut dropped) = (CONVERTED.lock(), Vec::new());
    all.push_front(Converted {
        of,
        version,
        id,
        bytes,
    });
    all.retain(|it| {
        kept += it.bytes;
        let is_kept = it.id == id || it.of != of && kept <= DECODED_BYTES / 4;
        dropped.extend((!is_kept).then_some(it.id));
        is_kept
    });
    drop(all);
    dropped.into_iter().for_each(canvas::release);
    id
}

pub fn converted(pixmap: &Pixmap, widens: bool) -> Option<Pixmap> {
    let mut copy = Pixmap::from_vec(pixmap.data().to_vec(), pixmap.width(), pixmap.height())?;
    Conversion::between(widens).apply(copy.data_mut().as_chunks_mut().0);
    Some(copy)
}

/// In its own color space.
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
            let (index, frames) = (pick(bitmap), bitmap.frames()?);
            Some(f(
                Content::Pixels(&frames.get(index).or(frames.last())?.0),
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
        &Frame::new(1., false),
    );
    Some(layer.pixmap)
}

pub fn alpha(id: u32, width: u32, height: u32) -> Option<Vec<u8>> {
    let frame = Frame::new(1., false);
    if info(id, &frame)?
        .size
        .is_some_and(|it| byte_count(it) > MAX_ANIMATION_BYTES)
    {
        return None;
    }
    with(id, &frame, |content| match content {
        Content::Svg(svg) => {
            let mut layer = Layer::new(IntRect::new(0, 0, width as i32, height as i32))?;
            let rect = Rect {
                x: 0.,
                y: 0.,
                width: width as f32,
                height: height as f32,
            };
            svg.draw(&mut layer, rect, &Transform::identity(), &frame);
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
    insert_as(id, pixmap, false, None);
    id
}

pub fn insert_as(id: u32, pixmap: Pixmap, is_wide: bool, widen: Option<Widen>) {
    if is_wide {
        note_wide();
    }
    IMAGES.lock().insert(
        id,
        Arc::new(Image::Bitmap(Bitmap {
            is_wide,
            widen: widen.map(Box::new).into(),
            ..Bitmap::new(vec![(pixmap, Duration::ZERO)], None)
        })),
    );
}

pub fn release(id: u32) {
    drop(IMAGES.lock().remove(&id));
    if HAS_WIDE.load(Ordering::Relaxed) {
        let mut all = CONVERTED.lock();
        let converted = all
            .iter()
            .position(|it| it.of == id)
            .and_then(|it| all.remove(it));
        drop(all);
        converted.into_iter().for_each(|it| canvas::release(it.id));
    }
    if guest::is_on() {
        guest::image_released(id);
    }
}

pub fn pixmap_from_rgba(width: u32, height: u32, mut rgba: Vec<u8>) -> Option<Pixmap> {
    premultiply_row(rgba.as_chunks_mut().0);
    Pixmap::from_vec(rgba, width, height)
}

fn pixmap_from(image: Rgba) -> Option<Pixmap> {
    pixmap_from_rgba(image.width, image.height, image.data)
}

pub fn straight_rgba(layer: &Layer) -> Vec<u8> {
    let mut pixels = layer.pixels().to_vec();
    demultiply_row(&mut pixels);
    pixels.into_flattened()
}

fn in_srgb(mut pixmap: Pixmap, encoded: &[u8]) -> Pixmap {
    if let Some(conversion) = codec::profile(encoded).and_then(|it| Conversion::of(&it)) {
        conversion.apply(pixmap.data_mut().as_chunks_mut().0);
    } else if codec::is_display_p3(encoded) {
        Conversion::between(false).apply(pixmap.data_mut().as_chunks_mut().0);
    }
    pixmap
}

pub fn decode_still(bytes: &[u8]) -> Result<Rgba> {
    codec::decode(bytes, true, (0, 0)).context("the image could not be decoded")
}

pub fn decode_pixmap(bytes: &[u8]) -> Option<Pixmap> {
    pixmap_from(codec::decode(bytes, true, (0, 0))?)
}

/// What browsers do with one that is too short.
fn actual_delay(delay: Duration) -> Duration {
    if delay <= Duration::from_millis(10) {
        Duration::from_millis(100)
    } else {
        delay
    }
}

/// Stops at a frame that is broken or does not fit in memory.
fn decode_animation(bytes: &[u8]) -> Frames {
    let (mut frames, mut end, mut total) = (Frames::new(), Duration::ZERO, 0);
    codec::frames(bytes, &mut |frame, delay| {
        end += actual_delay(delay);
        total += frame.data.len();
        let frame = (total <= MAX_ANIMATION_BYTES)
            .then(|| pixmap_from(frame.clone()))
            .flatten();
        frame.map(|it| frames.push((it, end))).is_some()
    });
    frames
}

fn decode_bitmap(bytes: &[u8], is_oriented: bool, may_play: bool) -> Result<Frames> {
    let frames = if may_play && codec::is_animated(bytes) {
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

struct Outline {
    size: Size,
    ends: Vec<Duration>,
    is_oriented: bool,
}

/// Of a large image.
fn outline_to_defer(bytes: &[u8], is_oriented: bool) -> Option<Outline> {
    if codec::is_animated(bytes) {
        let (size, mut end) = (codec::size(bytes, false)?, Duration::ZERO);
        let ends = codec::delays(bytes)
            .take(MAX_ANIMATION_BYTES / byte_count(size))
            .map(|delay| {
                end += actual_delay(delay);
                end
            });
        if let Some(ends) = Some(ends.collect::<Vec<_>>()).filter(|it| it.len() > 1) {
            return (ends.len() * byte_count(size) > DECODED_BYTES / 4).then_some(Outline {
                size,
                ends,
                is_oriented: false,
            });
        }
    }
    (Format::of(bytes)? != Format::Png || codec::png_chunks(bytes).any(|it| it.0 == b"IDAT"))
        .then_some(())?;
    let size = codec::size(bytes, is_oriented)
        .filter(|it| byte_count(*it) as u64 >= DEFERRED_PIXELS * 4)?;
    Some(Outline {
        size,
        ends: vec![Duration::ZERO],
        is_oriented,
    })
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

fn decode_at(bytes: &[u8], is_oriented: bool, whole: Size, size: Size) -> Option<Pixmap> {
    decode_png_at(bytes, whole, size).or_else(|| {
        let decoded = pixmap_from(codec::decode(bytes, is_oriented, size)?)?;
        if size_of(&decoded) == size {
            Some(decoded)
        } else {
            resample(&decoded, size)
        }
    })
}

pub fn decode(bytes: Vec<u8>, is_oriented: bool) -> Result<Decoded> {
    let orientation = codec::orientation(&bytes);
    let bitmap = match outline_to_defer(&bytes, is_oriented) {
        Some(outline) => Bitmap::deferred(outline, bytes).context("out of memory")?,
        None => Bitmap {
            is_oriented,
            ..Bitmap::new(decode_bitmap(&bytes, is_oriented, true)?, Some(bytes))
        },
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
    let (outline, id) = (outline_to_defer(bytes, true)?, next_id());
    let (width, height) = outline.size;
    IMAGES.lock().insert(
        id,
        Arc::new(Image::Bitmap(Bitmap::deferred(outline, bytes.to_vec())?)),
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
pub fn resampled(id: u32, version: u32, source: &Pixmap, size: Size) -> Option<Rc<Pixmap>> {
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

/// With Catmull-Rom splines. `part` is what is enlarged, and is within it.
pub fn enlarge(source: &Pixmap, part: IntRect, result: &mut Pixmap) {
    let taps = |from: usize, to: u32| {
        let one = move |at: u32| {
            let exact = (at as f32 + 0.5) * from as f32 / to as f32 - 0.5;
            let (before, t) = (exact.floor(), exact - exact.floor());
            let weights = [
                ((2. - t) * t - 1.) * t,
                (3. * t - 5.) * t * t + 2.,
                ((4. - 3. * t) * t + 1.) * t,
                (t - 1.) * t * t,
            ]
            .map(|it| it / 2.);
            (
                [-1, 0, 1, 2].map(|it| (before as isize + it).clamp(0, from as isize - 1) as usize),
                weights,
            )
        };
        (0..to).map(one)
    };
    let (width, height) = size_of(result);
    let (columns, pixels) = (
        taps(part.width(), width).collect::<Vec<_>>(),
        source.data().as_chunks::<4>().0,
    );
    let mut between = vec![[0.; 4]; part.width()];
    for (row, (rows, weights)) in result
        .data_mut()
        .as_chunks_mut::<4>()
        .0
        .chunks_mut(width as usize)
        .zip(taps(part.height(), height))
    {
        let rows = rows.map(|it| {
            &pixels[(part.top as usize + it) * source.width() as usize + part.left as usize..]
                [..part.width()]
        });
        for (x, to) in between.iter_mut().enumerate() {
            *to = std::array::from_fn(|channel| {
                (0..4)
                    .map(|it| f32::from(rows[it][x][channel]) * weights[it])
                    .sum::<f32>()
            });
        }
        for (to, (columns, weights)) in row.iter_mut().zip(&columns) {
            let mixed: [u8; 4] = std::array::from_fn(|channel| {
                ((0..4)
                    .map(|it| between[columns[it]][channel] * weights[it])
                    .sum::<f32>()
                    + 0.5) as u8
            });
            *to = mixed.map(|it| it.min(mixed[3]));
        }
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn animations_keep_no_memory_that_is_not_counted_after_a_pause() {
        let [on_its_way, decoded, broken] = [2, 3, 4].map(|frames| {
            let outline = Outline {
                size: (2048, 2048),
                ends: vec![Duration::from_millis(50); frames],
                is_oriented: true,
            };
            let bitmap = Bitmap::deferred(outline, Vec::new()).unwrap();
            let image = Arc::new(Image::Bitmap(Bitmap {
                start: Instant::now() - Duration::from_secs(10),
                ..bitmap
            }));
            IMAGES.lock().insert(next_id(), image.clone());
            image
        });
        let [
            Image::Bitmap(on_its_way),
            Image::Bitmap(decoded),
            Image::Bitmap(broken),
        ] = [&*on_its_way, &*decoded, &*broken]
        else {
            unreachable!()
        };
        on_its_way.was_requested.store(true, Ordering::Relaxed);
        *decoded.frames.lock() = Some(Arc::new(
            decoded
                .ends
                .iter()
                .map(|it| (Pixmap::new(2048, 2048).unwrap(), *it))
                .collect(),
        ));
        broken.note_use();
        broken.was_requested.store(true, Ordering::Relaxed);
        broken.fitted.lock().stands_still = true;
        assert_eq!(taken_for_playing(), on_its_way.bytes_of_frames());
        assert!(decoded.frames.lock().is_none());
    }
}
