//! Decoded images, SVG documents, and the ids that they share with canvases.

use std::cell::RefCell;
use std::collections::VecDeque;
use std::io::Cursor;
use std::rc::Rc;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, LazyLock};
use std::time::{Duration, Instant};

use anyhow::{Context as _, Result, bail, ensure};
use image::codecs::{gif::GifDecoder, png::PngDecoder, webp::WebPDecoder};
use image::{
    AnimationDecoder, DynamicImage, ImageDecoder as _, ImageFormat, ImageReader, RgbaImage,
};
use parking_lot::Mutex;
use resvg::tiny_skia::{IntSize, Pixmap, Transform};
use resvg::usvg::{self, fontdb, roxmltree};
use rustc_hash::FxHashMap;
use serde_json::{Value, json};

use crate::abi::{self, Rect};
use crate::paint::cpu::Painter;
use crate::paint::raster::{Clip, IntRect, Layer, demultiply, multiply};
use crate::paint::scene::{Frame, Scene};
use crate::{bridge, canvas, svg_limits, text, webview};

const MAX_SIDE: u32 = 32768;
const MAX_BYTES: usize = 512 << 20;
const MAX_ANIMATION_BYTES: usize = 64 << 20;
/// The GPU has what is on screen.
const DECODED_BYTES: usize = 16 << 20;

pub enum Svg {
    Tree {
        tree: usvg::Tree,
        keeps_ratio: bool,
    },
    /// What the engine has painted of an SVG file.
    Recording {
        scene: Scene,
        size: [f32; 2],
    },
}

impl Svg {
    pub fn draw(&self, target: &mut Layer, rect: Rect, matrix: &Transform) {
        match self {
            Svg::Tree { tree, keeps_ratio } => {
                let size = tree.size();
                let (mut x, mut y) = (rect.width / size.width(), rect.height / size.height());
                if *keeps_ratio {
                    (x, y) = (x.min(y), x.min(y));
                }
                let (left, top) = (
                    (rect.width - size.width() * x) / 2.,
                    (rect.height - size.height() * y) / 2.,
                );
                crate::paint::svg::draw(
                    target,
                    tree,
                    &matrix
                        .pre_translate(rect.x + left, rect.y + top)
                        .pre_scale(x, y),
                );
            }
            Svg::Recording { scene, size } => {
                let matrix = matrix
                    .pre_translate(rect.x, rect.y)
                    .pre_scale(rect.width / size[0], rect.height / size[1]);
                let painter = Painter {
                    scene,
                    frame: &Frame::new(1., false),
                    limit: usize::MAX,
                };
                painter.paint(
                    0..scene.items.len(),
                    target,
                    &matrix,
                    &Clip::new(target.rect),
                );
            }
        }
    }
}

pub fn record(mut list: Scene, size: [f32; 2]) -> u32 {
    let (id, mut scene) = (next_id(), Scene::default());
    scene.replace(&[], &mut list);
    IMAGES.lock().insert(
        id,
        Arc::new(Image::Svg(Box::new(Svg::Recording { scene, size }))),
    );
    id
}

/// Each with the time at which it ends.
type Frames = Vec<(Pixmap, Duration)>;

struct Bitmap {
    size: (u32, u32),
    ends: Vec<Duration>,
    start: Instant,
    /// What `frames` are decoded from again after they were dropped. Without it, they are kept.
    encoded: Option<Vec<u8>>,
    frames: Mutex<Option<Arc<Frames>>>,
    last_used: AtomicU32,
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
}

static IMAGES: LazyLock<Mutex<FxHashMap<u32, Arc<Image>>>> = LazyLock::new(Mutex::default);
static NEXT_ID: AtomicU32 = AtomicU32::new(1);
static USES: AtomicU32 = AtomicU32::new(1);

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

    fn frames(&self) -> Option<Arc<Frames>> {
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

/// Of the images that were used least recently, until `kept` bytes are left.
fn drop_pixels(kept: usize) {
    let images = IMAGES.lock();
    let mut decoded: Vec<_> = (images.values())
        .filter_map(|image| match &**image {
            Image::Bitmap(bitmap) if bitmap.encoded.is_some() && bitmap.frames.lock().is_some() => {
                Some(bitmap)
            }
            _ => None,
        })
        .collect();
    decoded
        .sort_unstable_by_key(|bitmap| std::cmp::Reverse(bitmap.last_used.load(Ordering::Relaxed)));
    let mut total = 0;
    for (index, bitmap) in decoded.into_iter().enumerate() {
        total += bitmap.size.0 as usize * bitmap.size.1 as usize * 4 * bitmap.ends.len();
        if total > kept && (index > 0 || kept == 0) {
            bitmap.frames.lock().take();
        }
    }
}

pub fn release_memory() {
    drop_pixels(0);
    REDUCED.take();
    INLINE.take();
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
        }),
        Some(Image::Bitmap(bitmap)) => Some(Info {
            size: Some(bitmap.size),
            version: bitmap.index_at(frame) as u32,
        }),
        None => with_changing(id, |pixmap, version| Info {
            size: Some((pixmap.width(), pixmap.height())),
            version,
        }),
    }
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
            Some(layer.pixmap.pixels().iter().map(|it| it.alpha()).collect())
        }
        Content::Pixels(pixmap) => {
            let source = |at: u32, to: u32, from: u32| {
                ((at as u64 * 2 + 1) * from as u64 / (to as u64 * 2)) as u32
            };
            let pixel = |x, y| {
                pixmap.pixel(
                    source(x, width, pixmap.width()),
                    source(y, height, pixmap.height()),
                )
            };
            Some(
                (0..height)
                    .flat_map(|y| (0..width).map(move |x| pixel(x, y).map_or(0, |it| it.alpha())))
                    .collect(),
            )
        }
    })?
}

pub fn insert(pixmap: Pixmap) -> u32 {
    let id = next_id();
    IMAGES.lock().insert(
        id,
        Arc::new(Image::Bitmap(Bitmap::new(
            vec![(pixmap, Duration::ZERO)],
            None,
        ))),
    );
    id
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
    Pixmap::from_vec(rgba, IntSize::from_wh(width, height)?)
}

fn pixmap_from(image: RgbaImage) -> Option<Pixmap> {
    pixmap_from_rgba(image.width(), image.height(), image.into_raw())
}

pub fn straight_rgba(layer: &Layer) -> Vec<u8> {
    layer
        .pixels()
        .iter()
        .flat_map(|pixel| demultiply(*pixel))
        .collect()
}

fn limits() -> image::Limits {
    let mut limits = image::Limits::default();
    (limits.max_image_width, limits.max_image_height) = (Some(MAX_SIDE), Some(MAX_SIDE));
    limits.max_alloc = Some(MAX_BYTES as u64);
    limits
}

pub fn decode_still(bytes: &[u8]) -> Result<DynamicImage> {
    decode_oriented(bytes, true)
}

fn decode_oriented(bytes: &[u8], is_oriented: bool) -> Result<DynamicImage> {
    let mut reader = ImageReader::new(Cursor::new(bytes)).with_guessed_format()?;
    reader.limits(limits());
    let mut decoder = reader.into_decoder()?;
    let (width, height) = decoder.dimensions();
    ensure!(
        u64::from(width) * u64::from(height) * 4 <= MAX_BYTES as u64,
        "the image is too large"
    );
    let orientation = decoder.orientation()?;
    let mut image = DynamicImage::from_decoder(decoder)?;
    if is_oriented {
        image.apply_orientation(orientation);
    }
    Ok(image)
}

pub fn decode_pixmap(bytes: &[u8]) -> Option<Pixmap> {
    pixmap_from(decode_still(bytes).ok()?.into_rgba8())
}

/// Stops at a frame that is broken or does not fit in memory.
fn decode_frames<'a>(decoder: impl AnimationDecoder<'a>) -> Frames {
    let (mut end, mut bytes) = (Duration::ZERO, 0);
    let frames = decoder.into_frames().map_while(|frame| {
        let frame = frame.ok()?;
        let delay = Duration::from(frame.delay());
        // What browsers do with a delay that is too short.
        end += if delay <= Duration::from_millis(10) {
            Duration::from_millis(100)
        } else {
            delay
        };
        bytes += frame.buffer().len();
        Some((pixmap_from(frame.into_buffer())?, end)).filter(|_| bytes <= MAX_ANIMATION_BYTES)
    });
    frames.collect()
}

fn decode_animation(bytes: &[u8]) -> Option<Frames> {
    let frames = match image::guess_format(bytes).ok()? {
        ImageFormat::Gif => {
            let mut decoder = GifDecoder::new(Cursor::new(bytes)).ok()?;
            decoder.set_limits(limits()).ok()?;
            decode_frames(decoder)
        }
        ImageFormat::Png => {
            let decoder = PngDecoder::with_limits(Cursor::new(bytes), limits()).ok()?;
            decoder.is_apng().ok()?.then_some(())?;
            decode_frames(decoder.apng().ok()?)
        }
        ImageFormat::WebP => {
            let decoder = WebPDecoder::new(Cursor::new(bytes))
                .ok()
                .filter(WebPDecoder::has_animation)?;
            let (width, height) = decoder.dimensions();
            (u64::from(width) * u64::from(height) * 4 <= MAX_BYTES as u64).then_some(())?;
            decode_frames(decoder)
        }
        _ => return None,
    };
    Some(frames).filter(|frames| !frames.is_empty())
}

fn add_font(
    database: &mut Arc<fontdb::Database>,
    data: &'static [u8],
    index: u32,
) -> Option<fontdb::ID> {
    let find = |database: &fontdb::Database| {
        let is_it = |face: &&fontdb::FaceInfo| match &face.source {
            fontdb::Source::Binary(known) => {
                face.index == index && std::ptr::eq((**known).as_ref(), data)
            }
            _ => false,
        };
        database.faces().find(is_it).map(|face| face.id)
    };
    find(database).or_else(|| {
        Arc::make_mut(database).load_font_source(fontdb::Source::Binary(Arc::new(data)));
        find(database)
    })
}

fn svg_options() -> usvg::Options<'static> {
    let select_font = |font: &usvg::Font, database: &mut Arc<fontdb::Database>| {
        let mut families = Vec::new();
        for family in font.families() {
            match family {
                usvg::FontFamily::Named(name) if name != "system-ui" => {
                    families.extend(name.as_bytes())
                }
                generic => {
                    families.push(abi::GENERIC_FAMILY);
                    families.extend(generic.to_string().trim_matches('"').as_bytes());
                }
            }
            families.push(0);
        }
        let is_italic = font.style() != usvg::FontStyle::Normal;
        let file = text::file_for_family(&families, font.weight().into(), is_italic)?;
        add_font(database, file.data, file.index)
    };
    let select_fallback =
        |character: char, used: &[fontdb::ID], database: &mut Arc<fontdb::Database>| {
            let file = text::file_for_character(character)?;
            add_font(database, file.data, file.index).filter(|id| !used.contains(id))
        };
    usvg::Options {
        font_size: 16.,
        default_size: usvg::Size::from_wh(300., 150.).expect("it is a size"),
        font_resolver: usvg::FontResolver {
            select_font: Box::new(select_font),
            select_fallback: Box::new(select_fallback),
        },
        // An image does not get to read files.
        image_href_resolver: usvg::ImageHrefResolver {
            resolve_data: Box::new(resolve_data),
            resolve_string: Box::new(|_, _| None),
        },
        ..usvg::Options::default()
    }
}

fn resolve_data(_: &str, data: Arc<Vec<u8>>, _: &usvg::Options) -> Option<usvg::ImageKind> {
    let Ok(format) = image::guess_format(&data) else {
        let mut options = svg_options();
        options.image_href_resolver.resolve_data = Box::new(|_, _, _| None);
        let document = parse_xml(std::str::from_utf8(&data).ok()?).ok()?;
        return usvg::Tree::from_xmltree(&document, &options)
            .ok()
            .map(usvg::ImageKind::SVG);
    };
    let (width, height) = ImageReader::with_format(Cursor::new(&data[..]), format)
        .into_dimensions()
        .ok()?;
    (u64::from(width) * u64::from(height) * 4 <= MAX_ANIMATION_BYTES as u64).then_some(())?;
    Some(match format {
        ImageFormat::Jpeg => usvg::ImageKind::JPEG(data),
        ImageFormat::Png => usvg::ImageKind::PNG(data),
        ImageFormat::Gif => usvg::ImageKind::GIF(data),
        ImageFormat::WebP => usvg::ImageKind::WEBP(data),
        _ => return None,
    })
}

fn parse_xml(source: &str) -> Result<roxmltree::Document<'_>> {
    ensure!(
        svg_limits::is_shallow(source),
        "the document is nested too deeply"
    );
    let options = roxmltree::ParsingOptions {
        allow_dtd: true,
        ..roxmltree::ParsingOptions::default()
    };
    let document = roxmltree::Document::parse_with_options(source, options)?;
    ensure!(svg_limits::is_small(&document), "the document is too large");
    Ok(document)
}

fn decode_svg(bytes: &[u8]) -> Result<(Image, Value)> {
    let document = parse_xml(std::str::from_utf8(bytes)?)?;
    let tree = usvg::Tree::from_xmltree(&document, &svg_options())?;
    let root = document.root_element();
    let is_absolute = |name| {
        root.attribute(name)
            .is_some_and(|it| !it.trim_end().ends_with('%') && it != "auto")
    };
    let (has_width, has_height) = (is_absolute("width"), is_absolute("height"));
    let view_box = root.attribute("viewBox").and_then(|view_box| {
        let numbers = view_box
            .split([' ', ','])
            .filter_map(|number| number.parse::<f32>().ok());
        let [_, _, width, height] = numbers.collect::<Vec<_>>().try_into().ok()?;
        (width > 0. && height > 0.).then_some(width / height)
    });
    let size = tree.size();
    let ratio = if has_width && has_height {
        Some(size.width() / size.height())
    } else {
        view_box
    };
    let info = json!({
        "width": has_width.then_some(size.width()),
        "height": has_height.then_some(size.height()),
        "ratio": ratio,
        "svg": true,
    });
    let stretches = root
        .attribute("preserveAspectRatio")
        .is_some_and(|it| it.trim() == "none");
    let keeps_ratio = view_box.is_some() && !stretches;
    Ok((Image::Svg(Box::new(Svg::Tree { tree, keeps_ratio })), info))
}

fn decode_bitmap(bytes: &[u8], is_oriented: bool) -> Result<Frames> {
    if let Some(frames) = decode_animation(bytes) {
        return Ok(frames);
    }
    Ok(vec![(
        pixmap_from(decode_oriented(bytes, is_oriented)?.into_rgba8())
            .context("the image is empty")?,
        Duration::ZERO,
    )])
}

fn decode(bytes: Vec<u8>, is_oriented: bool) -> Result<Value> {
    let (image, mut info) = if image::guess_format(&bytes).is_err() {
        decode_svg(&bytes).context("the image could not be decoded")?
    } else {
        let bitmap = Bitmap::new(
            decode_bitmap(&bytes, is_oriented)?,
            is_oriented.then_some(bytes),
        );
        let info = json!({ "width": bitmap.size.0, "height": bitmap.size.1, "svg": false });
        (Image::Bitmap(bitmap), info)
    };
    let id = next_id();
    IMAGES.lock().insert(id, Arc::new(image));
    drop_pixels(DECODED_BYTES);
    info["id"] = id.into();
    Ok(info)
}

pub fn command(name: &str, arguments: &Value, reply: Option<u64>) -> Result<Value> {
    match name {
        "decode" => {
            let (reply, bytes) = (
                reply.context("the command needs a reply id")?,
                bridge::blob(&arguments["blob"])?,
            );
            let is_oriented = arguments["isOriented"] != false;
            bridge::in_background(reply, move || decode(bytes, is_oriented));
        }
        "decodeSync" => return decode(bridge::blob(&arguments["blob"])?, true),
        "release" => drop(
            IMAGES
                .lock()
                .remove(&(arguments["id"].as_u64().unwrap_or(0) as u32)),
        ),
        _ => bail!("unknown command image.{name}"),
    }
    Ok(Value::Null)
}

thread_local! {
    static INLINE: RefCell<FxHashMap<u64, Option<Rc<usvg::Tree>>>> = RefCell::default();
}

pub fn inline_svg(hash: u64, source: &[u8]) -> Option<Rc<usvg::Tree>> {
    INLINE.with_borrow_mut(|trees| {
        if trees.len() >= 512 {
            trees.clear();
        }
        let parse = || {
            let document = parse_xml(std::str::from_utf8(source).ok()?).ok()?;
            usvg::Tree::from_xmltree(&document, &svg_options())
                .ok()
                .map(Rc::new)
        };
        trees.entry(hash).or_insert_with(parse).clone()
    })
}

pub fn svg_bounds(tree: &usvg::Tree) -> Rect {
    let bounds = tree.root().abs_layer_bounding_box();
    Rect {
        x: bounds.x(),
        y: bounds.y(),
        width: bounds.width(),
        height: bounds.height(),
    }
}

type ReducedKey = (u32, u32, u32, u32);

thread_local! {
    static REDUCED: RefCell<VecDeque<(ReducedKey, Rc<Pixmap>)>> = RefCell::default();
}

/// `reduce` for an image that is drawn piece by piece.
pub fn reduced(
    id: u32,
    version: u32,
    source: &Pixmap,
    width: f32,
    height: f32,
) -> Option<Rc<Pixmap>> {
    let key = (id, version, width.round() as u32, height.round() as u32);
    REDUCED.with_borrow_mut(|recent| {
        if let Some((_, known)) = recent.iter().find(|(known, _)| *known == key) {
            return Some(known.clone());
        }
        let result = Rc::new(reduce(source, width, height)?);
        recent.push_front((key, result.clone()));
        let mut bytes = 0;
        recent.retain(|(kept, pixmap)| {
            bytes += pixmap.data().len();
            bytes <= DECODED_BYTES / 2 || *kept == key
        });
        Some(result)
    })
}

/// For each pixel of the result: the first source pixel that it covers, and the weights from there on.
fn area_weights(from: usize, to: usize) -> Vec<(usize, Vec<f32>)> {
    let ratio = from as f32 / to as f32;
    let weights = (0..to).map(|index| {
        let (start, end) = (index as f32 * ratio, (index + 1) as f32 * ratio);
        let covered = start as usize..(end.ceil() as usize).min(from);
        let weight = |at: usize| (end.min(at as f32 + 1.) - start.max(at as f32)) / ratio;
        (covered.start, covered.map(weight).collect())
    });
    weights.collect()
}

pub fn reduced_size(source: (u32, u32), width: f32, height: f32) -> (u32, u32) {
    const THRESHOLD: f32 = 1.25;
    let target = |from: u32, to: f32| match from as f32 > to * THRESHOLD {
        true => (to.round() as u32).clamp(1, from),
        false => from,
    };
    (target(source.0, width), target(source.1, height))
}

/// Averages `source` down along the axes on which bilinear sampling would skip pixels.
pub fn reduce(source: &Pixmap, width: f32, height: f32) -> Option<Pixmap> {
    let (from_width, from_height) = (source.width() as usize, source.height() as usize);
    let (width, height) = reduced_size((source.width(), source.height()), width, height);
    let (width, height) = (width as usize, height as usize);
    if (width, height) == (from_width, from_height) {
        return None;
    }
    let mut result = Pixmap::new(width as u32, height as u32)?;
    let (columns, rows) = (
        area_weights(from_width, width),
        area_weights(from_height, height),
    );
    let mut sums = vec![0f32; from_width * 4];
    for (output, (first, weights)) in result.data_mut().chunks_mut(width * 4).zip(rows) {
        sums.fill(0.);
        for (row, weight) in source
            .data()
            .chunks(from_width * 4)
            .skip(first)
            .zip(weights)
        {
            sums.iter_mut()
                .zip(row)
                .for_each(|(sum, value)| *sum += f32::from(*value) * weight);
        }
        for (pixel, (first, weights)) in output.as_chunks_mut::<4>().0.iter_mut().zip(&columns) {
            let mut total = [0.5f32; 4];
            for (sum, weight) in sums.as_chunks::<4>().0[*first..].iter().zip(weights) {
                (0..4).for_each(|channel| total[channel] += sum[channel] * weight);
            }
            let alpha = total[3] as u8;
            *pixel = total.map(|channel| (channel as u8).min(alpha));
        }
    }
    Some(result)
}
