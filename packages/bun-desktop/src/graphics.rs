//! `abi_graphics::Graphics`

use std::cell::RefCell;
use std::ffi::c_void;
use std::mem::MaybeUninit;
use std::slice::{from_raw_parts, from_raw_parts_mut};
use std::sync::atomic::{AtomicUsize, Ordering};

use crate::abi::{Matrix, Slice};
use crate::abi_graphics::{
    Area, Commands, Decoded, Format, Graphics, Pen, Sink, TextMetrics, TextStyle,
};
use crate::canvas::Loan;
use crate::hash::FastMap;
use crate::host::thread;
use crate::icc::Conversion;
use crate::{canvas, codec, guard, images};

static GRAPHICS: Graphics = Graphics {
    reserve_id,
    draw,
    measure,
    is_in_path,
    is_in_stroke,
    read,
    write,
    insert,
    convert,
    has_wide_colors,
    encode,
    decode,
    open,
};

#[unsafe(no_mangle)]
pub extern "C" fn bun_desktop_graphics() -> *const Graphics {
    &GRAPHICS
}

thread_local! {
    /// Of the canvases that this thread, to which they belong, has read and not drawn on since.
    static LOANS: RefCell<FastMap<u32, Loan>> = RefCell::default();
}

fn byte_count(width: u32, height: u32) -> usize {
    width as usize * height as usize * 4
}

extern "C" fn reserve_id() -> u32 {
    images::next_id()
}

unsafe extern "C" fn draw(commands: *const Commands) {
    // SAFETY: the contract of `Graphics`.
    let commands = unsafe { canvas::Owned::new(&*commands) };
    // A canvas may be released while its thread ends.
    _ = LOANS.try_with(|loans| {
        Some(loans.borrow_mut())
            .filter(|it| !it.is_empty())
            .map(|mut it| commands.canvases().for_each(|id| drop(it.remove(&id))))
    });
    post_limited(commands.bytes(), move || std::rc::Rc::new(commands).run());
}

/// Scripts do not get far ahead of the pixels.
fn post_limited(weight: usize, job: impl FnOnce() + Send + 'static) {
    const MAX_WAITING: usize = 1 << 19;
    static WAITING: AtomicUsize = AtomicUsize::new(0);
    if WAITING.fetch_add(weight, Ordering::Relaxed) > MAX_WAITING {
        thread::catch_up();
    }
    thread::post(move || {
        guard("error", (), job);
        WAITING.fetch_sub(weight, Ordering::Relaxed);
    });
}

unsafe extern "C" fn measure(text: Slice<u8>, style: TextStyle) -> TextMetrics {
    // SAFETY: the contract of `Graphics`.
    guard("error", TextMetrics::default(), || {
        canvas::measure(unsafe { text.get() }, &style)
    })
}

unsafe extern "C" fn is_in_path(point: &[f32; 2], verbs: Slice<u32>, is_even_odd: bool) -> bool {
    // SAFETY: the contract of `Graphics`.
    guard("error", false, || {
        canvas::is_in_path(*point, unsafe { verbs.get() }, is_even_odd)
    })
}

unsafe extern "C" fn is_in_stroke(
    point: &[f32; 2],
    verbs: Slice<u32>,
    matrix: &Matrix,
    pen: Pen,
    dashes: Slice<f32>,
) -> bool {
    // SAFETY: the contract of `Graphics`.
    guard("error", false, || unsafe {
        canvas::is_in_stroke(*point, verbs.get(), *matrix, pen, dashes.get())
    })
}

unsafe extern "C" fn read(id: u32, area: &Area, is_on_black: bool, rgba: *mut u8) {
    // SAFETY: the contract of `Graphics`.
    let pixels =
        unsafe { from_raw_parts_mut(rgba.cast(), byte_count(area[2] as u32, area[3] as u32) / 4) };
    let read = |loans: &mut FastMap<u32, Loan>| {
        if !loans.get(&id).is_some_and(|it| it.has(*area)) {
            let area = *area;
            loans.remove(&id);
            loans.extend(thread::ask(move || canvas::lend(id, area)).map(|it| (id, it)));
        }
        loans
            .get(&id)
            .is_some_and(|it| it.read(*area, is_on_black, pixels))
    };
    if !guard("error", false, || LOANS.with_borrow_mut(read)) {
        pixels.fill(MaybeUninit::new([0; 4]));
    }
}

unsafe extern "C" fn write(id: u32, area: &Area, dirty: &Area, rgba: *const u8) {
    guard("error", (), || {
        // SAFETY: the contract of `Graphics`.
        let rgba = unsafe { from_raw_parts(rgba, byte_count(area[2] as u32, area[3] as u32)) };
        let (dirty, rgba) = (*dirty, canvas::part_of(rgba, *area, *dirty));
        let weight = rgba.len() >> 6;
        match LOANS
            .with_borrow_mut(|it| it.remove(&id))
            .filter(|it| it.is_all_in(dirty))
        {
            Some(mut loan) => {
                let pixmap = loan.replace(rgba);
                LOANS.with_borrow_mut(|it| it.insert(id, loan));
                post_limited(weight, move || canvas::write(id, dirty, |_| pixmap));
            }
            None => post_limited(weight, move || {
                canvas::write(id, dirty, |is_opaque| {
                    canvas::premultiplied(dirty, rgba, is_opaque)
                })
            }),
        }
    });
}

unsafe extern "C" fn insert(&[width, height]: &[u32; 2], rgba: *const u8, wide: *const u8) -> u32 {
    guard("error", None, || {
        // SAFETY: the contract of `Graphics`.
        let copy = |it: *const u8| {
            images::pixmap_from_rgba(
                width,
                height,
                unsafe { from_raw_parts(it, byte_count(width, height)) }.to_vec(),
            )
        };
        let id = images::next_id();
        match (rgba.is_null(), wide.is_null()) {
            (true, _) => images::insert_as(id, copy(wide)?, true, None),
            (_, true) => images::insert_as(id, copy(rgba)?, false, None),
            _ => images::insert_as(
                id,
                copy(rgba)?,
                false,
                Some(images::Widen::kept(copy(wide)?)),
            ),
        }
        Some(id)
    })
    .unwrap_or(0)
}

unsafe extern "C" fn convert(rgba: *mut u8, pixels: usize, widens: bool) {
    // SAFETY: the contract of `Graphics`.
    Conversion::between(widens).apply_to_colors(unsafe { from_raw_parts_mut(rgba.cast(), pixels) });
}

extern "C" fn has_wide_colors(image: u32) -> bool {
    guard("error", false, || {
        thread::ask(move || images::is_wide(image) || images::widen(image).is_some())
    })
}

unsafe extern "C" fn encode(
    size: &[u32; 2],
    rgba: *const u8,
    format: Format,
    quality: u8,
    sink: Sink,
    context: *mut c_void,
) -> bool {
    // SAFETY: the contract of `Graphics`.
    unsafe { codec::encode(size, rgba, format, quality, sink, context) }
}

unsafe extern "C" fn decode(bytes: Slice<u8>, is_oriented: bool) -> Decoded {
    // SAFETY: the contract of `Graphics`.
    guard("error", None, || {
        images::decode(unsafe { bytes.get() }.to_vec(), is_oriented).ok()
    })
    .unwrap_or_default()
}

unsafe extern "C" fn open(bytes: Slice<u8>, density: f32, scale: f32) -> Decoded {
    // SAFETY: the contract of `Graphics`.
    guard("error", None, || {
        images::open(unsafe { bytes.get() }, density, scale)
    })
    .unwrap_or_default()
}
