//! `abi_webgl::WebGl`. Each context has a thread, which trusts nothing of what it is sent.

mod buffers;
mod context;
mod decoder;
mod draw;
#[cfg(target_os = "linux")]
mod far;
mod formats;
mod framebuffers;
#[path = "../../../src/dom/abi_webgl_constants.rs"]
pub mod gl;
mod glsl;
mod memo;
mod native;
mod objects;
mod parameters;
mod pixels;
mod programs;
mod queries;
mod surface;
mod textures;
mod uploads;

use std::collections::VecDeque;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::atomic::{AtomicU32, AtomicUsize, Ordering};
use std::sync::{Arc, mpsc};
use std::time::{Duration, Instant};

use crate::abi::Slice;
use crate::abi_webgl::{Attributes, Progress, Room, Unpacking, Upload, WebGl};
use crate::gfx::Pixmap;
use crate::host::thread;
use crate::remote::guest;
use crate::sync::{Condvar, Mutex};
use crate::{canvas, graphics, guard, images};
use context::Context;
#[cfg(target_os = "linux")]
pub use far::{is_hung, load_driver, serve_page};

pub(crate) static WEBGL: WebGl = WebGl {
    open,
    send,
    answer,
    recall,
    show,
    offer,
    close,
    set_unpacking,
    measure,
};

const MAX_CONTEXTS: usize = 128;
const ROOM: usize = 1 << 13;
const MAX_WAITING_WORDS: usize = 1 << 24;
/// After that, the context is lost.
pub const PATIENCE: Duration = Duration::from_secs(30);
/// An answer, or the next question, often takes less time than going to sleep.
const AWAKE_FOR: Duration = Duration::from_micros(50);

/// How long a window waits, to show a frame together with what else has changed.
const DELAY: Duration = Duration::from_millis(4);

/// A reset of the GPU takes all contexts with it.
pub const SAME_FAILURE: Duration = Duration::from_secs(5);
pub const FAILURES_COUNT_FOR: Duration = Duration::from_secs(180);

static CONTEXTS: AtomicUsize = AtomicUsize::new(0);
/// When contexts were lost, the last time first.
static FAILURES: Mutex<[Option<Instant>; 3]> = Mutex::new([None; 3]);

/// A page cannot go on hanging the GPU, or threads.
fn is_refused() -> bool {
    FAILURES.lock()[2].is_some_and(|it| it.elapsed() < FAILURES_COUNT_FOR)
}

enum Offered {
    Image(images::Kept),
    /// And whether they are in Display P3.
    Pixels(Option<Pixmap>, bool),
}

/// Whether the texture is in Display P3, colors are converted, it is premultiplied, and the source is not.
type Wanted = [bool; 4];

struct Picture {
    pixels: Option<Pixmap>,
    size: [u32; 2],
    is_wide: bool,
}

impl Picture {
    fn show(self, canvas: u32) {
        canvas::set_wide(canvas, self.is_wide);
        canvas::show(canvas, self.size, [0; 2], self.pixels);
    }
}

#[derive(Default)]
struct Shared {
    room: Vec<u32>,
    waiting: VecDeque<Vec<u32>>,
    waiting_words: usize,
    spare: Vec<Vec<u32>>,
    answer: Vec<u32>,
    facts: memo::Facts,
    memo: memo::Memo,
    offers: VecDeque<mpsc::Receiver<Offered>>,
    copy: Option<Picture>,
    frame: Option<Picture>,
    last_frame: u32,
    /// For how many more frames the window does not wait.
    impatience: u32,
    is_closed: bool,
    is_context_asleep: bool,
    is_awaited: bool,
}

/// Between the thread of the page and that of the context.
#[repr(C)]
struct Link {
    progress: Progress,
    sent: AtomicU32,
    shared: Mutex<Shared>,
    was_sent: Condvar,
    was_done: Condvar,
    /// If it is in another process.
    #[cfg(target_os = "linux")]
    page: std::sync::OnceLock<crate::remote::gpu::Line>,
}

fn spin_until(is_over: impl Fn() -> bool) -> bool {
    let start = Instant::now();
    while !is_over() && start.elapsed() < AWAKE_FOR {
        std::hint::spin_loop();
    }
    is_over()
}

impl Link {
    fn new(extensions: u64) -> Arc<Link> {
        Arc::new(Link {
            progress: Progress {
                extensions,
                done: 0.into(),
                bytes: 0.into(),
                is_lost: false.into(),
                has_messages: false.into(),
            },
            sent: 0.into(),
            shared: Mutex::default(),
            was_sent: Condvar::new(),
            was_done: Condvar::new(),
            #[cfg(target_os = "linux")]
            page: Default::default(),
        })
    }

    /// # Safety
    /// `open` has returned it, and it was not closed.
    unsafe fn of<'a>(context: *const Progress) -> &'a Link {
        // SAFETY: it is the first field.
        unsafe { &*context.cast() }
    }

    fn is_lost(&self) -> bool {
        self.progress.is_lost.load(Ordering::Relaxed)
    }

    fn lose(&self) {
        let was_lost = self.progress.is_lost.swap(true, Ordering::Relaxed);
        if !self.shared.lock().is_closed && !was_lost {
            let mut failures = FAILURES.lock();
            if failures[0].is_none_or(|it| it.elapsed() > SAME_FAILURE) {
                *failures = [Some(Instant::now()), failures[0], failures[1]];
            }
        }
        self.was_done.notify_all();
    }

    fn guard<R>(&self, otherwise: R, run: impl FnOnce(&Link) -> R) -> R {
        guard("error", None, || Some(run(self))).unwrap_or_else(|| {
            self.lose();
            otherwise
        })
    }

    fn has_done(&self, sent: u32) -> bool {
        self.progress
            .done
            .load(Ordering::Acquire)
            .wrapping_sub(sent) as i32
            >= 0
            || self.is_lost()
    }

    fn sleep_until_done(&self, sent: u32, patience: Duration) -> bool {
        let (mut shared, deadline) = (self.shared.lock(), Instant::now() + patience);
        while !self.has_done(sent) && Instant::now() < deadline {
            shared.is_awaited = true;
            self.was_done.wait_until(&mut shared, deadline);
        }
        self.has_done(sent)
    }

    fn wait_for(&self, sent: u32) {
        if !self.has_done(sent) {
            thread::release_jobs();
            if !spin_until(|| self.has_done(sent)) && !self.sleep_until_done(sent, PATIENCE) {
                self.lose();
            }
        }
    }

    fn catch_up(&self) {
        self.wait_for(self.sent.load(Ordering::Relaxed));
    }

    fn next(&self) -> Option<Vec<u32>> {
        let mut shared = self.shared.lock();
        while shared.waiting.is_empty() && !shared.is_closed {
            shared.is_context_asleep = true;
            self.was_sent.wait(&mut shared);
        }
        let words = shared
            .waiting
            .pop_front()
            .filter(|_| !shared.is_closed && !self.is_lost())?;
        shared.waiting_words -= words.len();
        Some(words)
    }

    fn serve(&self, context: &mut Context) {
        while let Some(words) = self.next() {
            let task = context.task;
            if !context.run(&words) {
                return;
            }
            let (facts, expects_more) = (context.facts(), context.task == task);
            self.finish(
                [words].into_iter(),
                |it| context.swap_answer(it),
                facts,
                expects_more,
            );
        }
    }

    fn finish(
        &self,
        run: impl ExactSizeIterator<Item = Vec<u32>>,
        answer: impl FnOnce(&mut Vec<u32>),
        facts: memo::Facts,
        expects_more: bool,
    ) {
        let (mut shared, count) = (self.shared.lock(), run.len() as u32);
        answer(&mut shared.answer);
        shared.facts = facts;
        for mut words in run {
            if words.capacity() == ROOM && shared.spare.len() < 4 {
                words.clear();
                shared.spare.push(words);
            }
        }
        let done = self
            .progress
            .done
            .fetch_add(count, Ordering::Release)
            .wrapping_add(count);
        if std::mem::take(&mut shared.is_awaited) {
            self.was_done.notify_all();
        }
        drop(shared);
        if expects_more {
            spin_until(|| self.sent.load(Ordering::Relaxed) != done);
        }
    }

    fn take_offer(&self, wanted: Wanted) -> Option<(Pixmap, [bool; 2])> {
        #[cfg(target_os = "linux")]
        if let Some(page) = self.page.get() {
            return far::ask_for_offer(page, wanted);
        }
        let offer = self.shared.lock().offers.pop_front();
        offer?.recv_timeout(PATIENCE).ok()?.open(wanted)
    }

    fn hand_over(&self, picture: Picture) {
        #[cfg(target_os = "linux")]
        if let Some(page) = self.page.get() {
            return far::send_picture(page, None, &picture);
        }
        self.shared.lock().copy = Some(picture);
    }

    /// Without waiting for the page, if that is possible.
    fn present(self: &Arc<Link>, canvas: u32, picture: Picture) {
        #[cfg(target_os = "linux")]
        if let Some(page) = self.page.get() {
            return far::send_picture(page, Some(canvas), &picture);
        }
        if !thread::exists() {
            return self.hand_over(picture);
        }
        self.shared.lock().frame = Some(picture);
        let link = self.clone();
        thread::post(move || link.show_frame(canvas));
    }

    fn show_frame(&self, canvas: u32) {
        let mut shared = self.shared.lock();
        if let Some(picture) = shared.frame.take().filter(|_| !shared.is_closed) {
            drop(shared);
            picture.show(canvas);
        }
    }

    fn show_frame_in_time(&self, canvas: u32, sent: u32) {
        let left = self.shared.lock().impatience.checked_sub(1);
        let left = left.unwrap_or_else(|| {
            if self.sleep_until_done(sent, DELAY) {
                0
            } else {
                30
            }
        });
        self.shared.lock().impatience = left;
        self.show_frame(canvas);
    }
}

type Wish = (Attributes, mpsc::SyncSender<Arc<Link>>);

static WISHES: Mutex<Vec<Wish>> = Mutex::new(Vec::new());

fn run() {
    thread::set_name(c"WebGL");
    _ = catch_unwind(|| {
        let wish = WISHES.lock().pop();
        if guest::is_on() {
            #[cfg(target_os = "linux")]
            wish.map(far::pass_on);
        } else if let Some((attributes, tell)) = wish
            && let Some(_current) = native::enter()
            && let Some(mut context) = Context::new(attributes)
        {
            let link = context.link.clone();
            if tell.send(link.clone()).is_ok() {
                _ = catch_unwind(AssertUnwindSafe(|| link.serve(&mut context)));
            }
            link.lose();
        }
    });
    CONTEXTS.fetch_sub(1, Ordering::Relaxed);
}

pub fn is_wanted() -> bool {
    std::env::var("BUN_DESKTOP_WEBGL").map_or(cfg!(target_os = "linux"), |it| it != "0")
}

unsafe extern "C" fn open(attributes: *const Attributes) -> *const Progress {
    guard("error", std::ptr::null(), || {
        if is_refused() || !is_wanted() {
            return std::ptr::null();
        }
        let (tell, learn) = mpsc::sync_channel(1);
        let mut wishes = WISHES.lock();
        // SAFETY: the contract of `WebGl`.
        wishes.push((unsafe { *attributes }, tell));
        if CONTEXTS.fetch_add(1, Ordering::Relaxed) >= MAX_CONTEXTS || !thread::detach(8 << 20, run)
        {
            CONTEXTS.fetch_sub(1, Ordering::Relaxed);
            wishes.pop();
        }
        drop(wishes);
        learn
            .recv_timeout(PATIENCE)
            .map_or(std::ptr::null(), |it| Arc::into_raw(it).cast())
    })
}

unsafe extern "C" fn send(context: *const Progress, used: usize, wanted: usize) -> Room {
    // SAFETY: the contract of `WebGl`.
    unsafe { Link::of(context) }.guard(
        Room {
            start: std::ptr::null_mut(),
            words: 0,
        },
        |link| {
            let mut shared = link.shared.lock();
            if used > 0 {
                let mut words = std::mem::take(&mut shared.room);
                // SAFETY: the page has written them.
                unsafe { words.set_len(used.min(words.capacity())) };
                shared.memo.send(&words);
                shared.waiting_words += words.len();
                shared.waiting.push_back(words);
                link.sent.fetch_add(1, Ordering::Relaxed);
                if std::mem::take(&mut shared.is_context_asleep) {
                    link.was_sent.notify_one();
                }
                if shared.waiting_words > MAX_WAITING_WORDS {
                    drop(shared);
                    link.catch_up();
                    shared = link.shared.lock();
                }
            }
            if link.is_lost() {
                shared.waiting.clear();
                shared.room = Vec::new();
            } else if shared.room.capacity() < wanted {
                shared.room = if wanted <= ROOM {
                    shared.spare.pop().unwrap_or_default()
                } else {
                    Vec::new()
                };
                _ = shared.room.try_reserve_exact(wanted.max(ROOM));
            }
            Room {
                start: shared.room.as_mut_ptr(),
                words: shared.room.capacity(),
            }
        },
    )
}

unsafe extern "C" fn answer(context: *const Progress) -> Slice<u32> {
    // SAFETY: the contract of `WebGl`.
    unsafe { Link::of(context) }.guard(Slice::new(&[]), |link| {
        link.catch_up();
        let shared = &mut *link.shared.lock();
        let answer: &[u32] = if link.is_lost() { &[] } else { &shared.answer };
        shared.memo.hear(answer, shared.facts);
        Slice::new(answer)
    })
}

unsafe extern "C" fn recall(context: *const Progress, start: usize, used: usize) -> Slice<u32> {
    // SAFETY: the contract of `WebGl`.
    unsafe { Link::of(context) }.guard(Slice::new(&[]), |link| {
        let shared = &mut *link.shared.lock();
        // SAFETY: the page has written them.
        let (written, question) =
            unsafe { std::slice::from_raw_parts(shared.room.as_ptr(), used) }.split_at(start);
        Slice::new(shared.memo.recall(written, question).unwrap_or_default())
    })
}

unsafe extern "C" fn show(context: *const Progress, canvas: u32, is_needed_now: bool) {
    // SAFETY: the contract of `WebGl`.
    unsafe { Link::of(context) }.guard((), |link| {
        graphics::end_loan(canvas);
        if !is_needed_now && thread::exists() {
            let sent = link.sent.load(Ordering::Relaxed);
            let before = std::mem::replace(&mut link.shared.lock().last_frame, sent);
            link.wait_for(before);
            // SAFETY: `open` has made it from an `Arc`, which gets another owner.
            let link = unsafe {
                Arc::increment_strong_count(link);
                Arc::from_raw(link)
            };
            return thread::post(move || link.show_frame_in_time(canvas, sent));
        }
        link.catch_up();
        if let Some(picture) = { link.shared.lock().copy.take() } {
            thread::post(move || picture.show(canvas));
        }
    })
}

unsafe extern "C" fn offer(context: *const Progress, image: u32, size: &[u32; 2]) {
    // SAFETY: the contract of `WebGl`.
    unsafe { Link::of(context) }.guard((), |link| {
        let ((give, take), size) = (mpsc::sync_channel(1), *size);
        link.shared.lock().offers.push_back(take);
        match images::keep(image) {
            Some(kept) => _ = give.send(Offered::Image(kept)),
            None => thread::post(move || {
                _ = give.send(Offered::Pixels(
                    canvas::copy(image, size),
                    images::is_wide(image),
                ))
            }),
        }
        thread::release_jobs();
    })
}

unsafe extern "C" fn close(context: *const Progress) {
    guard("error", (), || {
        // SAFETY: what `open` has returned.
        let link = unsafe { Arc::from_raw(context.cast::<Link>()) };
        link.shared.lock().is_closed = true;
        link.was_sent.notify_one();
    })
}

unsafe extern "C" fn set_unpacking(
    unpacking: *mut Unpacking,
    is_webgl2: bool,
    name: u32,
    value: u32,
) {
    // SAFETY: the contract of `WebGl`.
    guard("error", (), || {
        _ = uploads::set_unpacking(unsafe { &mut *unpacking }, is_webgl2, name, value as i32)
    });
}

unsafe extern "C" fn measure(upload: *const Upload, unpacking: *const Unpacking) -> usize {
    // SAFETY: the contract of `WebGl`.
    let (upload, unpacking) = unsafe { (&*upload, &*unpacking) };
    guard("error", 0, || {
        pixels::Layout::new(
            unpacking,
            upload.format,
            upload.kind,
            upload.size,
            upload.dimensions == 3,
        )
        .end as usize
    })
}
