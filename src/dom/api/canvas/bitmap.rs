//! Pixels, which the UI library keeps.

use core::cell::Cell;
use core::ffi::c_void;
use core::sync::atomic::{AtomicUsize, Ordering};
use std::rc::Rc;

use bun_jsc::{DOMExceptionCode, JSValue};

use super::Failure;
use super::recorder::Recorder;
use crate::abi::{Rect, Slice};
use crate::abi_graphics::{Area, Command, Decoded, Format, Snapshot};
use crate::platform::graphics;

pub(super) const MAX_AREA: u64 = 1 << 28;

pub(super) fn area_of([width, height]: [u32; 2]) -> u64 {
    u64::from(width) * u64::from(height)
}

pub(super) fn size_from(serialized: [JSValue; 2]) -> [u32; 2] {
    serialized.map(|it| it.get_number().unwrap_or_default() as u32)
}

/// An id of the library.
pub(crate) struct Owned {
    id: u32,
    pub(super) recorder: Rc<Recorder>,
}

impl Owned {
    pub(crate) fn adopt(id: u32) -> Owned {
        Owned {
            id,
            recorder: Recorder::current(),
        }
    }

    fn reserve() -> Owned {
        Owned::adopt(graphics().map_or(0, |it| (it.reserve_id)()))
    }

    /// `rgba` has all the pixels.
    pub(super) fn from_pixels(size: [u32; 2], rgba: &[u8]) -> Owned {
        assert_eq!(rgba.len() as u64, area_of(size) * 4);
        // SAFETY: as asserted.
        Owned::adopt(graphics().map_or(0, |it| unsafe { (it.insert)(&size, rgba.as_ptr()) }))
    }

    pub(crate) fn id(&self) -> u32 {
        self.id
    }

    pub(crate) fn into_id(mut self) -> u32 {
        core::mem::take(&mut self.id)
    }
}

impl Drop for Owned {
    fn drop(&mut self) {
        if self.id != 0 {
            self.recorder.send(Command::Release(self.id));
        }
    }
}

pub(crate) fn drop_font_scope(scope: u32) {
    if scope != 0 {
        Recorder::current().send(Command::DropFontScope(scope));
    }
}

pub(crate) fn open(bytes: &[u8], density: f32, scale: f32) -> Decoded {
    // SAFETY: a live slice.
    graphics().map_or_else(Decoded::default, |it| unsafe {
        (it.open)(Slice::new(bytes), density, scale)
    })
}

pub(crate) fn decode(bytes: &[u8], is_oriented: bool) -> Decoded {
    // SAFETY: a live slice.
    graphics().map_or_else(Decoded::default, |it| unsafe {
        (it.decode)(Slice::new(bytes), is_oriented)
    })
}

/// What can be drawn.
#[derive(Clone, Copy)]
pub(crate) struct Source {
    pub(crate) id: u32,
    pub(crate) size: [f64; 2],
    pub(crate) is_origin_clean: bool,
    /// The one of EXIF that was applied and has to be undone, or 1.
    pub(crate) ignored_orientation: u8,
}

impl Source {
    #[optimize(size)]
    pub(crate) fn new(id: u32, size: [u32; 2], is_origin_clean: bool) -> Source {
        Source {
            id,
            size: size.map(f64::from),
            is_origin_clean,
            ignored_orientation: 1,
        }
    }

    pub(super) fn is_empty(&self) -> bool {
        !(self.size[0] > 0.0 && self.size[1] > 0.0)
    }

    pub(super) fn read(&self) -> Option<Box<[u8]>> {
        let size = self.size.map(|it| it as u32);
        let context = super::Context::new(size, super::host::DEFAULT_SETTINGS);
        context.draw_source(self, None, [0.0; 2], None);
        context
            .bitmap
            .read([0, 0, size[0] as i32, size[1] as i32], false)
    }

    #[optimize(size)]
    pub(crate) fn without_orientation(&self) -> Owned {
        let mut size = self.size.map(|it| it as u32);
        if self.ignored_orientation > 4 {
            size.reverse();
        }
        let context = super::Context::new(size, super::host::DEFAULT_SETTINGS);
        context.draw_source(self, None, [0.0; 2], None);
        let copy = snapshot(context.bitmap.source().whole());
        copy.recorder.flush();
        copy
    }

    pub(super) fn whole(&self) -> Snapshot {
        let size = self.size.map(|it| it as f32);
        Snapshot {
            id: 0,
            source: self.id,
            size,
            part: Rect {
                x: 0.0,
                y: 0.0,
                width: size[0],
                height: size[1],
            },
            to: self.size.map(|it| it.ceil() as u32),
            flips: false,
            is_smooth: true,
            is_tile: false,
        }
    }
}

pub(super) fn snapshot(wanted: Snapshot) -> Owned {
    let copy = Owned::reserve();
    copy.recorder.send(Command::Snapshot(Snapshot {
        id: copy.id,
        ..wanted
    }));
    copy
}

/// https://html.spec.whatwg.org/#output-bitmap
pub(crate) struct Bitmap {
    pixels: Owned,
    size: Cell<[u32; 2]>,
    pub(super) is_origin_clean: Cell<bool>,
    bytes: AtomicUsize,
}

fn bytes_of(size: [u32; 2]) -> usize {
    Some(area_of(size))
        .filter(|it| *it <= MAX_AREA)
        .map_or(0, |it| it as usize * 4)
}

impl Bitmap {
    #[optimize(size)]
    pub(crate) fn new(size: [u32; 2], is_opaque: bool, is_read_often: bool) -> Rc<Bitmap> {
        let pixels = Owned::reserve();
        pixels.recorder.send(Command::Create {
            id: pixels.id,
            size,
            is_opaque,
            is_read_often,
        });
        Rc::new(Bitmap {
            pixels,
            size: Cell::new(size),
            is_origin_clean: Cell::new(true),
            bytes: bytes_of(size).into(),
        })
    }

    #[inline]
    pub(crate) fn id(&self) -> u32 {
        self.pixels.id
    }

    #[inline]
    pub(super) fn recorder(&self) -> &Recorder {
        &self.pixels.recorder
    }

    pub(crate) fn size(&self) -> [u32; 2] {
        self.size.get()
    }

    /// Any thread may ask.
    pub(super) fn bytes(&self) -> usize {
        self.bytes.load(Ordering::Relaxed)
    }

    pub(crate) fn source(&self) -> Source {
        Source::new(self.id(), self.size(), self.is_origin_clean.get())
    }

    pub(super) fn reset(&self, size: [u32; 2]) {
        self.size.set(size);
        self.bytes.store(bytes_of(size), Ordering::Relaxed);
        self.recorder()
            .record(self.id(), |list| list.push(Command::Reset(size)));
    }

    pub(super) fn erase(&self) {
        self.is_origin_clean.set(true);
        self.recorder()
            .record(self.id(), |list| list.push(Command::Erase));
    }

    pub(crate) fn require_origin_clean(&self) -> Result<(), Failure> {
        match self.is_origin_clean.get() {
            true => Ok(()),
            false => Err(Failure::Dom(
                DOMExceptionCode::SecurityError,
                "The canvas has been tainted by cross-origin data.",
            )),
        }
    }

    /// `None` if there is no memory. The area is not empty.
    pub(super) fn read(&self, area: Area, is_on_black: bool) -> Option<Box<[u8]>> {
        let pixels =
            Some(area_of([area[2] as u32, area[3] as u32])).filter(|it| *it <= MAX_AREA)?;
        let Some(graphics) = graphics() else {
            return bun_jsc::bindgen::try_zeroed_bytes(pixels as usize * 4);
        };
        let mut rgba = Vec::new();
        rgba.try_reserve_exact(pixels as usize * 4).ok()?;
        self.recorder().flush();
        // SAFETY: there is room for the area, all of which is written.
        unsafe {
            (graphics.read)(self.id(), &area, is_on_black, rgba.as_mut_ptr());
            rgba.set_len(pixels as usize * 4);
        }
        Some(rgba.into_boxed_slice())
    }

    /// `dirty` is relative to the pixels, inside of them and not empty.
    pub(super) fn write(&self, [x, y]: [i32; 2], size: [u32; 2], dirty: Area, rgba: &[u8]) {
        assert_eq!(rgba.len() as u64, area_of(size) * 4);
        let (Some(left), Some(top)) = (x.checked_add(dirty[0]), y.checked_add(dirty[1])) else {
            return;
        };
        self.recorder().flush();
        if let Some(graphics) = graphics() {
            // SAFETY: as asserted.
            unsafe {
                (graphics.write)(
                    self.id(),
                    &[x, y, size[0] as i32, size[1] as i32],
                    &[left, top, dirty[2], dirty[3]],
                    rgba.as_ptr(),
                )
            };
        }
        self.recorder().did_write();
    }

    /// `None` if it has no pixels.
    #[optimize(size)]
    pub(crate) fn to_encode(&self, mime_type: &[u8], quality: Option<f64>) -> Option<Unencoded> {
        let (size, format) = (
            Some(self.size()).filter(|it| area_of(*it) > 0)?,
            format_of(mime_type),
        );
        let [width, height] = size.map(|it| i32::try_from(it).ok());
        let quality = quality
            .filter(|it| (0.0..=1.0).contains(it))
            .unwrap_or(0.92);
        Some(Unencoded {
            rgba: self.read([0, 0, width?, height?], format == Format::Jpeg)?,
            size,
            format,
            quality: (quality * 100.0).round().clamp(1.0, 100.0) as u8,
        })
    }
}

fn format_of(mime_type: &[u8]) -> Format {
    match () {
        () if mime_type.eq_ignore_ascii_case(b"image/jpeg") => Format::Jpeg,
        () if mime_type.eq_ignore_ascii_case(b"image/webp") => Format::Webp,
        () => Format::Png,
    }
}

/// https://html.spec.whatwg.org/#a-serialisation-of-the-bitmap-as-a-file
pub(crate) struct Unencoded {
    rgba: Box<[u8]>,
    size: [u32; 2],
    format: Format,
    quality: u8,
}

impl Unencoded {
    pub(crate) fn mime_type(&self) -> &'static [u8] {
        match self.format {
            Format::Png => b"image/png",
            Format::Jpeg => b"image/jpeg",
            Format::Webp => b"image/webp",
        }
    }

    pub(crate) fn encode(&self) -> Option<Vec<u8>> {
        unsafe extern "C" fn keep(context: *mut c_void, bytes: *const u8, len: usize) {
            // SAFETY: the `Vec` below, and the parts of a slice.
            unsafe {
                (*context.cast::<Vec<u8>>())
                    .extend_from_slice(core::slice::from_raw_parts(bytes, len))
            };
        }
        let mut encoded = Vec::new();
        // SAFETY: `rgba` has all the pixels, and `encoded` outlives the call.
        let is_done = unsafe {
            (graphics()?.encode)(
                &self.size,
                self.rgba.as_ptr(),
                self.format,
                self.quality,
                keep,
                (&raw mut encoded).cast(),
            )
        };
        is_done.then_some(encoded)
    }
}
