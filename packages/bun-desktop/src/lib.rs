//! The native half of `bun:desktop`: windows and what is in them, behind a C ABI that `bun` loads with `dlopen`.
//!
//! Everything here is called on Bun's main thread. Its event loop waits in `bun_desktop_pump`, and JavaScript takes
//! the events (`drain`) when that has returned.

#[path = "../../../src/dom/abi.rs"]
#[allow(dead_code)]
mod abi;
mod accessibility;
mod allocator;
mod app;
mod bridge;
mod bun;
mod canvas;
mod codec;
mod cover;
mod diagnostics;
mod error;
mod frame;
mod gfx;
mod hash;
mod host;
mod icc;
mod images;
mod input;
mod json;
mod keys;
mod motion;
mod paint;
mod platform;
mod png_rows;
mod small_vec;
mod surface;
mod sync;
#[cfg(test)]
mod system_icu;
mod text;
mod unicode;
mod webview;
mod window;

use std::cell::RefCell;
use std::ffi::c_void;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::Once;
use std::time::{Duration, Instant};

use host::thread;

use crate::json::{Value, json};

#[global_allocator]
static ALLOCATOR: allocator::Allocator = allocator::Allocator;

/// Owned by this library: the caller hands it back to `bun_desktop_free`.
#[repr(C)]
pub struct Bytes {
    ptr: *mut u8,
    len: usize,
    capacity: usize,
}

impl From<Vec<u8>> for Bytes {
    fn from(bytes: Vec<u8>) -> Self {
        let mut bytes = std::mem::ManuallyDrop::new(bytes);
        Bytes {
            ptr: bytes.as_mut_ptr(),
            len: bytes.len(),
            capacity: bytes.capacity(),
        }
    }
}

/// # Safety
/// `ptr` points to `len` readable bytes, or `len` is 0.
unsafe fn borrow<'a>(ptr: *const u8, len: usize) -> &'a [u8] {
    if len == 0 {
        return &[];
    }
    // SAFETY: the caller's contract.
    unsafe { std::slice::from_raw_parts(ptr, len) }
}

/// `kind` is the event that reports a panic.
fn guard<R>(kind: &str, otherwise: R, f: impl FnOnce() -> R) -> R {
    catch_unwind(AssertUnwindSafe(f)).unwrap_or_else(|panic| {
        bridge::emit(json!({ "t": kind, "message": bridge::panic_message(panic) }));
        otherwise
    })
}

unsafe extern "C" fn font_describe(description: *const abi::FontDescription) -> u32 {
    // SAFETY: the contract of `abi::Renderer`.
    let description = unsafe {
        let from = &*description;
        text::Description {
            scope: from.scope,
            families: from.families.get().to_vec(),
            weight: from.weight,
            stretch: from.stretch,
            style: from.style,
            synthesis: from.synthesis,
            optical_sizing: from.optical_sizing,
            kerning: from.kerning,
            oblique_angle: from.oblique_angle,
            variations: from.variations.get().to_vec(),
            features: from.features.get().to_vec(),
            language: from.language.get().to_vec(),
            device_scale: from.device_scale,
            language_override: from.language_override,
            size_adjust: (from.size_adjust_metric, from.size_adjust),
            emoji: from.emoji,
            palette_family: from.palette_family.get().to_vec(),
            palette: text::Palette {
                base: from.palette,
                overrides: from.palette_overrides.get().to_vec(),
            },
        }
    };
    guard("error", u32::MAX, || text::describe(description))
}

extern "C" fn font_metrics(font: u32, size: f32) -> abi::FontMetrics {
    guard("error", abi::FontMetrics::default(), || {
        text::metrics(font, size)
    })
}

unsafe extern "C" fn shape(
    text: abi::Slice<u8>,
    runs: abi::Slice<abi::TextRun>,
    direction: u8,
) -> abi::ShapedText {
    thread_local! {
        static SHAPED: RefCell<text::Shaped> = RefCell::default();
    }
    // SAFETY: the contract of `abi::Renderer`.
    let (text, runs) = unsafe { (text.get(), runs.get()) };
    SHAPED.with_borrow_mut(|shaped| {
        let text = std::str::from_utf8(text).unwrap_or_default();
        if !guard("error", false, || {
            (text::shape(text, runs, direction, shaped), true).1
        }) {
            *shaped = text::Shaped::default();
        }
        abi::ShapedText {
            clusters: abi::Slice::new(&shaped.clusters),
            glyphs: abi::Slice::new(&shaped.glyphs),
            faces: abi::Slice::new(&shaped.faces),
            base_level: shaped.base_level,
        }
    })
}

unsafe extern "C" fn submit(surface: u32, list: *const abi::DisplayList) {
    // SAFETY: the contract of `abi::Renderer`.
    guard("error", (), || unsafe {
        surface::submit(surface, &*list, None)
    });
}

unsafe extern "C" fn ink_spans(
    face: u32,
    size: f32,
    glyphs: abi::Slice<abi::Glyph>,
    top: f32,
    bottom: f32,
) -> abi::Slice<[f32; 2]> {
    thread_local! {
        static SPANS: RefCell<Vec<[f32; 2]>> = RefCell::default();
    }
    // SAFETY: the contract of `abi::Renderer`.
    let glyphs = unsafe { glyphs.get() };
    SPANS.with_borrow_mut(|spans| {
        spans.clear();
        guard("error", (), || {
            text::ink_spans(face, size, glyphs, top, bottom, spans)
        });
        abi::Slice::new(spans)
    })
}

unsafe extern "C" fn submit_composited(
    surface: u32,
    list: *const abi::DisplayList,
    compositing: *const abi::Compositing,
) {
    // SAFETY: the contract of `abi::Renderer`.
    guard("error", (), || unsafe {
        surface::submit(surface, &*list, Some(&*compositing))
    });
}

extern "C" fn now() -> f64 {
    surface::milliseconds(Instant::now())
}

extern "C" fn image_alpha(image: u32, width: u32, height: u32) -> abi::Slice<u8> {
    thread_local! {
        static ALPHA: RefCell<Vec<u8>> = RefCell::default();
    }
    ALPHA.with_borrow_mut(|alpha| {
        *alpha = guard("error", None, || images::alpha(image, width, height)).unwrap_or_default();
        abi::Slice::new(alpha)
    })
}

unsafe extern "C" fn record_image(list: *const abi::DisplayList, width: f32, height: f32) -> u32 {
    guard("error", 0, || {
        let mut scene = paint::scene::Scene::default();
        // SAFETY: the contract of `abi::Renderer`.
        unsafe { scene.copy_list(&*list) };
        images::record(scene, [width, height])
    })
}

extern "C" fn font_table(face: u32, tag: u32) -> abi::Slice<u8> {
    abi::Slice::new(guard("error", None, || text::face(face)?.table(tag)).unwrap_or_default())
}

extern "C" fn glyph_extent(face: u32, size: f32, glyph: u32) -> abi::GlyphExtent {
    guard("error", None, || text::glyph_extent(face, size, glyph)).unwrap_or_default()
}

static RENDERER: abi::Renderer = abi::Renderer {
    font_describe,
    font_metrics,
    shape,
    submit,
    ink_spans,
    submit_composited,
    now,
    image_alpha,
    record_image,
    font_table,
    glyph_extent,
};

#[unsafe(no_mangle)]
pub extern "C" fn bun_desktop_abi_version() -> u32 {
    abi::ABI_VERSION
}

fn init(has_main_thread: bool) {
    static INIT: Once = Once::new();
    INIT.call_once(|| {
        diagnostics::init();
        host::init(has_main_thread);
        text::prewarm();
    });
}

/// Called once by the thread that runs JavaScript, before the other functions. `tick` runs its event loop once, without
/// waiting. With `has_main_thread`, the main thread is another one, which calls `bun_desktop_run`.
#[unsafe(no_mangle)]
pub extern "C" fn bun_desktop_init(tick: extern "C" fn(), has_main_thread: bool) {
    guard("fatal", (), || {
        host::set_tick(tick);
        host::thread::runs_javascript();
        init(has_main_thread);
        #[cfg(target_os = "macos")]
        if !has_main_thread {
            platform::macos::create_application();
        }
    });
}

/// From the thread that runs JavaScript, for native addons, which expect that to be the main thread.
///
/// # Safety
/// `function` can be called with `context` on another thread.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn bun_desktop_call_on_main_thread(
    function: host::thread::Function,
    context: *mut c_void,
) {
    init(true);
    host::thread::runs_javascript();
    // SAFETY: the caller's contract.
    unsafe { host::thread::call_on_ui_thread(function, context) }
}

/// The way back.
///
/// # Safety
/// As above.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn bun_desktop_call_on_javascript_thread(
    function: host::thread::Function,
    context: *mut c_void,
) {
    // SAFETY: the caller's contract.
    unsafe { host::thread::call_on_javascript_thread(function, context) }
}

#[unsafe(no_mangle)]
pub extern "C" fn bun_desktop_run() -> ! {
    init(true);
    host::thread::enter();
    #[cfg(target_os = "macos")]
    if platform::macos::create_application() {
        // It takes a while, and JavaScript is going to ask for it.
        let options = json!({ "headless": false, "accessory": platform::macos::is_accessory() });
        guard("fatal", (), || {
            bridge::report(app::execute("start", &options, None).map(drop))
        });
    }
    host::run_main_thread()
}

#[unsafe(no_mangle)]
pub extern "C" fn bun_desktop_renderer() -> *const abi::Renderer {
    &RENDERER
}

/// Takes `[command, argument, replyId, ignoresResult]`. Returns `{ value }`, `{ error }`, or nothing for null.
///
/// # Safety
/// `json` points to `len` bytes.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn bun_desktop_call(json: *const u8, len: usize) -> Bytes {
    // SAFETY: the caller's contract.
    let request = unsafe { borrow(json, len) };
    let asks = |name: &str| {
        request
            .get(2..)
            .is_some_and(|it| it.starts_with(name.as_bytes()))
    };
    if !thread::is_elsewhere()
        || ![
            "window.geometry\"",
            "window.isFocused\"",
            "displays\"",
            "info\"",
        ]
        .into_iter()
        .any(asks)
    {
        if !["surface.", "image", "font.", "canvas."]
            .into_iter()
            .any(asks)
        {
            bridge::expect_changes();
        }
        return call(request).into();
    }
    let ([moves, changes], now) = (bridge::changes(), Instant::now());
    let state = [if asks("window.geometry") { moves } else { 0 }, changes];
    ANSWERS.with_borrow_mut(|answers| answers.retain(|it| now < it.until));
    let known = ANSWERS.with_borrow(|answers| {
        answers
            .iter()
            .find(|it| it.state == state && it.request == request)
            .map(|it| it.reply.clone())
    });
    known
        .unwrap_or_else(|| {
            let reply = call(request);
            let answer = Answer {
                request: request.to_vec(),
                reply: reply.clone(),
                state,
                until: now + Duration::from_millis(100),
            };
            ANSWERS.with_borrow_mut(|answers| answers.push(answer));
            reply
        })
        .into()
}

/// To a question that is asked several times for each frame of a resize.
struct Answer {
    request: Vec<u8>,
    reply: Vec<u8>,
    state: [u32; 2],
    until: Instant,
}

thread_local! {
    static ANSWERS: RefCell<Vec<Answer>> = RefCell::default();
}

fn call(request: &[u8]) -> Vec<u8> {
    let result = catch_unwind(|| {
        let mut request: Value = crate::json::parse(request)?;
        if request[0] == "surface.ime" {
            request[1]["edits"] = bridge::edits_taken().into();
        }
        let name = request[0].as_str().unwrap_or("");
        // What was posted may still draw the image.
        let is_about_images = name.starts_with("image") && name != "image.release";
        let runs_here = name.starts_with("font.")
            || is_about_images
            || name.starts_with("defaults.")
            || name == "canvas.font"
            || name == "keychain.read";
        let is_awaited = request[3] != true;
        let run = move || {
            app::execute(
                request[0].as_str().unwrap_or(""),
                &request[1],
                request[2].as_u64(),
            )
        };
        if runs_here {
            run()
        } else if is_awaited || !thread::exists() {
            thread::ask(run)
        } else {
            thread::post(move || guard("error", (), move || bridge::report(run().map(drop))));
            Ok(Value::Null)
        }
    });
    let reply = match result {
        Ok(Ok(Value::Null)) => return Vec::new(),
        Ok(Ok(value)) => json!({ "value": value }),
        Ok(Err(error)) => json!({ "error": format!("{error:#}") }),
        Err(panic) => json!({ "error": bridge::panic_message(panic) }),
    };
    reply.to_string().into_bytes()
}

/// The commands that are sent for every frame, mouse move or key.
#[unsafe(no_mangle)]
pub extern "C" fn bun_desktop_post(command: u32, surface: u32, argument: u32) {
    thread::post(move || {
        guard("error", (), || match command {
            0 => surface::request_frame(surface),
            1 => surface::set_cursor(surface, argument),
            _ => input::key_was_handled(),
        })
    });
}

/// # Safety
/// `numbers` points to `len` bytes, and `text` to `text_len`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn bun_desktop_draw(
    numbers: *const u8,
    len: usize,
    text: *const u8,
    text_len: usize,
) {
    // SAFETY: the caller's contract.
    let (numbers, text) = unsafe { (borrow(numbers, len), borrow(text, text_len)) };
    if !thread::exists() {
        return guard("error", (), || canvas::draw(numbers, text));
    }
    let (numbers, text) = (numbers.to_vec(), text.to_vec());
    thread::post(move || guard("error", (), || canvas::draw(&numbers, &text)));
}

/// # Safety
/// `numbers` points to 12 numbers, which are read and then written, and `text` to `text_len` bytes.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn bun_desktop_measure(
    numbers: *mut [f64; 12],
    text: *const u8,
    text_len: usize,
) {
    // SAFETY: the caller's contract.
    let (numbers, text) = unsafe { (&mut *numbers, borrow(text, text_len)) };
    guard("error", (), || {
        *numbers = canvas::measure(numbers, text).unwrap_or_default()
    });
}

/// # Safety
/// `buffer` points to `capacity` writable numbers.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn bun_desktop_drain_numbers(buffer: *mut f64, capacity: usize) -> usize {
    host::thread::run_calls();
    // SAFETY: the caller's contract.
    bridge::drain_numbers(unsafe { std::slice::from_raw_parts_mut(buffer, capacity) })
}

/// The events that `bun_desktop_drain_numbers` only announced.
#[unsafe(no_mangle)]
pub extern "C" fn bun_desktop_drain() -> Bytes {
    bridge::drain_json().into()
}

/// Runs the UI until it has events, `source` (the event loop's descriptor or completion port, or -1) is ready, or the
/// time (-1 for no limit) is up. Returns whether there are events.
#[unsafe(no_mangle)]
pub extern "C" fn bun_desktop_pump(source: isize, timeout_ns: i64, from_tick: bool) -> bool {
    guard("fatal", true, || host::pump(source, timeout_ns, from_tick))
}

/// Whether JavaScript has more than a frame to see to. Does not run the UI.
#[unsafe(no_mangle)]
pub extern "C" fn bun_desktop_has_input() -> bool {
    host::has_input()
}

/// Draws the windows that waited for JavaScript to handle their `frame` events.
#[unsafe(no_mangle)]
pub extern "C" fn bun_desktop_present() {
    guard("fatal", (), host::events_were_handled);
}

/// Copies bytes that a later message names by the returned id.
///
/// # Safety
/// `ptr` points to `len` bytes.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn bun_desktop_put_blob(ptr: *const u8, len: usize) -> u32 {
    // SAFETY: the caller's contract.
    bridge::put_blob(unsafe { borrow(ptr, len) }.to_vec())
}

#[unsafe(no_mangle)]
pub extern "C" fn bun_desktop_take_blob(id: u32) -> Bytes {
    bridge::take_blob(id).unwrap_or_default().into()
}

/// # Safety
/// `bytes` came from this library and was not freed.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn bun_desktop_free(bytes: Bytes) {
    // SAFETY: the parts of a `Vec` that `From<Vec<u8>>` forgot.
    drop(unsafe { Vec::from_raw_parts(bytes.ptr, bytes.len, bytes.capacity) });
}
