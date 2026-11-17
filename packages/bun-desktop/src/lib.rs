//! The native half of `bun:desktop`: windows and what is in them, behind a C ABI that `bun` loads with `dlopen`.
//!
//! Everything here is called on Bun's main thread. Its event loop waits in `bun_desktop_pump`, and JavaScript takes
//! the events (`drain`) when that has returned.

#[path = "../../../src/dom/abi.rs"]
mod abi;
#[path = "../../../src/dom/abi_graphics.rs"]
mod abi_graphics;
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
mod graphics;
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
#[path = "../../../src/ui/protocol.rs"]
mod protocol;
mod small_vec;
mod surface;
mod sync;
#[cfg(test)]
mod system_icu;
mod table;
mod text;
mod unicode;
mod webview;
mod window;

use std::cell::RefCell;
use std::ffi::c_void;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::Once;
use std::time::Instant;

#[cfg(target_os = "macos")]
use crate::protocol::Command;
use crate::protocol::Event;

#[global_allocator]
static ALLOCATOR: allocator::Allocator = allocator::Allocator;

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
        let message = bridge::panic_message(panic).into();
        bridge::emit(if kind == "fatal" {
            Event::Fatal(message)
        } else {
            Event::Warning(message)
        });
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
            letters: abi::Slice::new(&shaped.letters),
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
        match list.as_ref() {
            Some(list) => surface::submit(surface, list, Some(&*compositing)),
            None => surface::submit_scrollers(surface, (*compositing).scrollers.get().to_vec()),
        }
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

unsafe extern "C" fn update_accessibility(tree: u32, update: *const abi::accessibility::Update) {
    // SAFETY: the contract of `abi::Renderer`.
    guard("error", (), || unsafe {
        accessibility::submit(tree, &*update)
    });
}

unsafe extern "C" fn inspect_accessibility(question: abi::Slice<u8>) -> abi::Slice<u8> {
    thread_local! {
        static ANSWER: std::cell::RefCell<String> = std::cell::RefCell::default();
    }
    // SAFETY: as above.
    let question = String::from_utf8_lossy(unsafe { question.get() }).into_owned();
    ANSWER.set(guard("error", String::new(), || {
        host::thread::ask(move || accessibility::inspect(&question))
    }));
    ANSWER.with_borrow(|it| abi::Slice::new(it.as_bytes()))
}

static RENDERER: abi::Renderer = abi::Renderer {
    update_accessibility,
    inspect_accessibility,
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
        let start = Command::Start {
            is_headless: false,
            is_accessory: platform::macos::is_accessory(),
        };
        guard("fatal", (), || bridge::report(app::execute(start, 0)));
    }
    host::run_main_thread()
}

#[unsafe(no_mangle)]
pub extern "C" fn bun_desktop_renderer() -> *const abi::Renderer {
    &RENDERER
}
