//! `protocol::Ui`

use std::cell::RefCell;
use std::mem::MaybeUninit;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::thread::LocalKey;
use std::time::{Duration, Instant};

use crate::abi::Rect;
use crate::codec::Rgba;
use crate::error::{Context as _, Result};
use crate::host::{self, platform, thread};
use crate::protocol::*;
use crate::{app, bridge, cover, guard, images, surface, text, webview};

fn here<T>(work: impl FnOnce() -> Result<T>) -> Outcome<T> {
    match catch_unwind(AssertUnwindSafe(work)) {
        Ok(Ok(value)) => Outcome::Done(value),
        Ok(Err(error)) => Outcome::Failed(format!("{error:#}").into()),
        Err(panic) => Outcome::Failed(bridge::panic_message(panic).into()),
    }
}

fn ask<T: Send + 'static>(work: impl FnOnce() -> Result<T> + Send + 'static) -> Outcome<T> {
    here(|| thread::ask(work))
}

/// For what may make an `Answer` out of date.
fn change<T: Send + 'static>(work: impl FnOnce() -> Result<T> + Send + 'static) -> Outcome<T> {
    bridge::expect_changes();
    ask(|| (work(), app::finish_command()).0)
}

fn failure(outcome: Outcome<()>) -> Maybe<Text> {
    outcome.get().err().into()
}

/// To a question that is asked several times for each frame of a resize.
struct Answer<T> {
    about: u32,
    value: T,
    state: [u32; 2],
    until: Instant,
}

type Answers<T> = RefCell<Vec<Answer<T>>>;

thread_local! {
    static GEOMETRIES: Answers<Geometry> = RefCell::default();
    static FOCUS: Answers<bool> = RefCell::default();
    static DISPLAYS: Answers<List<Display>> = RefCell::default();
    static STATES: Answers<SystemState> = RefCell::default();
}

fn ask_once<T: Clone + Send>(
    answers: &'static LocalKey<Answers<T>>,
    about: u32,
    depends_on_moves: bool,
    work: impl FnOnce() -> Result<T> + Send + 'static,
) -> Outcome<T> {
    if !thread::is_elsewhere() {
        return here(work);
    }
    let ([moves, changes], now) = (bridge::changes(), Instant::now());
    let state = [if depends_on_moves { moves } else { 0 }, changes];
    let known = answers.with_borrow_mut(|answers| {
        answers.retain(|it| now < it.until && it.state == state);
        answers
            .iter()
            .find(|it| it.about == about)
            .map(|it| it.value.clone())
    });
    if let Some(value) = known {
        return Outcome::Done(value);
    }
    let outcome = ask(work);
    if let Outcome::Done(value) = &outcome {
        answers.with_borrow_mut(|it| {
            it.push(Answer {
                about,
                value: value.clone(),
                state,
                until: now + Duration::from_millis(100),
            })
        });
    }
    outcome
}

fn will_execute(command: &Command) -> u32 {
    if !matches!(command, Command::Surface { .. } | Command::KeyWasHandled) {
        bridge::expect_changes();
    }
    bridge::edits_taken()
}

extern "C" fn tell(command: Command) {
    let edits = will_execute(&command);
    thread::post(move || {
        guard("error", (), move || {
            bridge::report(app::execute(command, edits))
        })
    });
}

extern "C" fn perform(command: Command) -> Maybe<Text> {
    let edits = will_execute(&command);
    failure(ask(move || app::execute(command, edits)))
}

extern "C" fn request(id: u32, request: Request) -> Maybe<Text> {
    failure(match request {
        Request::DecodeFont(_) => here(|| app::request(id, request)),
        #[cfg(target_os = "macos")]
        Request::System(request @ SystemRequest::ReadKeychain { .. }) => {
            here(|| crate::platform::macos::request(id, &request))
        }
        request => change(move || app::request(id, request)),
    })
}

extern "C" fn answer(question: Question) -> Outcome<Maybe<u32>> {
    match question {
        Question::Color(_) => ask(move || Ok(crate::platform::answer(&question))),
        _ => here(|| Ok(crate::platform::answer(&question))),
    }
}

unsafe extern "C" fn drain(events: *mut Event, capacity: usize) -> usize {
    thread::run_calls();
    // SAFETY: the caller's contract.
    bridge::drain(unsafe {
        std::slice::from_raw_parts_mut(events.cast::<MaybeUninit<Event>>(), capacity)
    })
}

unsafe extern "C" fn decode_bitmap(bytes: *const u8, length: usize) -> Outcome<Bitmap> {
    // SAFETY: the caller's contract.
    here(|| images::decode_still(unsafe { crate::borrow(bytes, length) }).map(bitmap))
}

fn bitmap(
    Rgba {
        width,
        height,
        data,
    }: Rgba,
) -> Bitmap {
    Bitmap {
        width,
        height,
        pixels: data.into(),
    }
}

fn rgba(from: &Bitmap) -> Result<Rgba> {
    let is_whole = !from.pixels.is_empty()
        && from.pixels.len() == from.width as usize * from.height as usize * 4;
    is_whole
        .then(|| Rgba {
            width: from.width,
            height: from.height,
            data: from.pixels.to_vec(),
        })
        .context("the image is empty")
}

macro_rules! function {
    (|| -> $result:ty $body:block) => { function!(| | -> $result $body) };
    (|$($argument:ident: $type:ty),*| -> $result:ty $body:block) => {{
        extern "C" fn function($($argument: $type),*) -> $result $body
        function
    }};
    ($how:ident || -> $result:ty $body:block) => { function!($how | | -> $result $body) };
    ($how:ident |$($argument:ident: $type:ty),*| -> $result:ty $body:block) => {
        function!(|$($argument: $type),*| -> Outcome<$result> { $how(move || Ok($body)) })
    };
}

static UI: Ui = Ui {
    tell,
    perform,
    request,
    drain,
    pump: function!(|source: isize, timeout_ns: i64, from_tick: bool| -> bool {
        guard("fatal", true, || host::pump(source, timeout_ns, from_tick))
    }),
    has_input: function!(|| -> bool { host::has_input() }),
    present: function!(|| -> () { guard("fatal", (), host::events_were_handled) }),

    window_geometry: function!(|window: u32| -> Outcome<Geometry> {
        ask_once(&GEOMETRIES, window, true, move || {
            Ok(app::open_window(window)?.geometry_soon())
        })
    }),
    window_is_focused: function!(|window: u32| -> Outcome<bool> {
        ask_once(&FOCUS, window, false, move || {
            Ok(app::open_window(window)?.is_active())
        })
    }),
    window_mouse: function!(ask |window: u32| -> Point { app::open_window(window)?.mouse_position() }),
    window_is_minimized: function!(ask |window: u32| -> bool { app::open_window(window)?.is_minimized() }),
    window_handle: function!(ask |window: u32| -> u64 { app::open_window(window)?.handle() }),
    window_number: function!(ask |window: u32| -> u64 { app::open_window(window)?.number() }),
    set_overlay: function!(change |window: u32, overlay: Maybe<Overlay>| -> [f32; 2] { app::set_overlay(window, overlay.get())? }),

    surface_metrics: function!(ask |id: u32| -> SurfaceMetrics { surface::metrics(id)? }),
    surface_accepts_text: function!(ask |id: u32| -> bool { surface::get(id).is_some_and(|it| it.borrow().ime.is_enabled()) }),
    capture: function!(ask |id: u32, area: Maybe<Rect>| -> Bitmap { surface::capture(id, area.get())? }),

    register_font: function!(here |face: FontFace, source: FontSource| -> u32 { text::register_font(face, source)? }),
    unregister_font: function!(|font: u32| -> () {
        guard("error", (), || text::unregister_font(font))
    }),
    drop_font_scope: function!(|scope: u32| -> () {
        guard("error", (), || text::drop_font_scope(scope))
    }),
    order_font: function!(here |font: u32, order: u32| -> bool { text::order_font(font, order) }),
    decode_font: function!(here |bytes: List<u8>| -> bool { text::decode_font(bytes.into_vec()) }),
    font_families: function!(here || -> List<Text> { text::font_families() }),

    decode_bitmap,
    resize_bitmap: function!(here |from: &Bitmap, width: u32, height: u32| -> Bitmap {
        bitmap(rgba(from)?.resized(width.clamp(1, 16384), height.clamp(1, 16384)).context("the image is empty")?)
    }),
    encode_bitmap: function!(here |from: &Bitmap, format: ImageFormat, quality: u8| -> List<u8> {
        let encoded = if format == ImageFormat::Png { rgba(from)?.to_png() } else { rgba(from)?.to_jpeg(quality.clamp(1, 100)) };
        encoded.context("the image is empty")?.into()
    }),

    open_web_view: function!(ask |file: Maybe<Text>| -> u32 { webview::open(file.as_ref().map(|it| &**it))? }),
    open_frame_channel: function!(ask || -> i32 { webview::open_channel()? }),
    helper_sources: webview::helper_sources,

    adopt_cover: function!(change |wanted: WindowOptions| -> bool { cover::adopt(&wanted) }),
    end_cover: function!(change |click: Maybe<Point>, keep: List<Rect>| -> Uncovered { cover::end(click.get(), keep.into_vec()) }),
    focused_under_cover: function!(ask || -> Maybe<u32> { cover::focused().into() }),
    sent_to_cover: function!(ask || -> u32 { cover::sent() }),
    cover_fits: function!(ask |at: Point| -> bool { cover::fits(at) }),

    system_state: function!(|| -> Outcome<SystemState> {
        ask_once(&STATES, 0, false, app::system_state)
    }),
    displays: function!(|| -> Outcome<List<Display>> {
        ask_once(&DISPLAYS, 0, false, || Ok(app::displays().into()))
    }),
    system_settings: function!(ask || -> SystemSettings { platform()?.settings() }),
    set_theme: function!(change |theme: Theme| -> bool {
        cover::HAS_SET_THEME.set(false);
        app::set_theme(theme)
    }),
    cursor_position: function!(ask || -> Point { platform()?.cursor_position()? }),
    idle_seconds: function!(ask || -> f64 { platform()?.idle_seconds()? }),
    is_on_battery: function!(ask || -> bool { platform()?.is_on_battery() }),
    is_hidden: function!(ask || -> bool { platform()?.is_hidden() }),
    opens_at_login: function!(ask || -> bool { platform()?.opens_at_login() }),
    is_trusted_for_accessibility: function!(ask |prompts: bool| -> bool { platform()?.is_trusted_for_accessibility(prompts) }),
    bounce: function!(ask |is_critical: bool| -> i32 { platform()?.bounce(is_critical) }),
    read_clipboard: function!(ask |part: ClipboardPart| -> Clipboard { platform()?.read_clipboard(part) }),
    tray_bounds: function!(ask |tray: u32| -> Rect { platform()?.tray_bounds(tray) }),
    application_for: function!(ask |url: Text| -> Maybe<Application> { platform()?.application_for(&url).into() }),
    file_icon: function!(ask |path: Text, side: u32| -> List<u8> { platform()?.file_icon(&path, side).into() }),
    answer,
    run_as_root: function!(here |prompt: Text, commands: List<List<Text>>| -> Text { crate::platform::run_as_root(&prompt, &commands)? }),
    named_image: function!(ask |name: Text| -> List<u8> { platform()?.named_image(&name).into() }),
    preference: function!(here |key: Text| -> Maybe<PreferenceValue> { crate::platform::preference(&key) }),
    change_preference: function!(|command: PreferenceCommand| -> Maybe<Text> {
        failure(here(|| crate::platform::change_preference(&command)))
    }),
};

#[unsafe(no_mangle)]
pub extern "C" fn bun_desktop_ui() -> &'static Ui {
    &UI
}
