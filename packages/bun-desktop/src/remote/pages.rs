//! In the process with the windows.

use std::collections::VecDeque;
use std::os::fd::{AsFd as _, BorrowedFd, IntoRawFd as _, OwnedFd};
use std::os::unix::net::UnixStream;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicUsize, Ordering};
use std::sync::{Arc, LazyLock, Once, mpsc};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use super::ring::{Consumer, Producer, Shared};
use super::{
    Asked, DOWN, Fetch, Header, LENT, Reader, Sent, Source, Told, UP, Writer, bytes_of, clock,
    receive, ring, send_all, send_answer, send_some,
};
use crate::abi::accessibility::{self as tree, Number, TREE_OF_IMAGE};
use crate::abi::{Filter, Item, Rect, Slice, Span};
use crate::error::{Context as _, Result};
use crate::gfx::Pixmap;
use crate::hash::{FastMap, FastSet};
use crate::host::thread;
use crate::paint::allowance::Allowance;
use crate::paint::scene::Scene;
use crate::protocol::{
    self, Dragged, Event, Input, InputField, Maybe, Message, PageCommand, PageProcess, Proxy,
    SurfaceCommand, WebViewCommand,
};
use crate::sync::{Condvar, Mutex, MutexGuard};
use crate::{accessibility, bridge, canvas, images, surface, text, webview};

const MOST_IN_MESSAGE: usize = (512 << 20) + 4096;
const MOST_IN_LIST: usize = 128 << 20;
const MOST_IN_TEXT: usize = 8 << 20;
const MOST_IN_NAME: usize = 1 << 10;
const MOST_IN_FONT: usize = 128 << 20;
const MOST_IN_FONTS: usize = 256 << 20;
const MOST_IN_ALL_FONTS: usize = 512 << 20;
const MOST_MAPPED_FONTS: usize = 1 << 12;
const IN_FACE: usize = 1 << 10;
const MOST_IN_IMAGES: usize = 2 << 30;
const MOST_FILES: usize = 1 << 11;
const MOST_FACES: u32 = 1 << 16;
const MOST_IMAGES: usize = 1 << 16;
const MOST_FRAMES: usize = 1 << 14;
const MOST_DEPTH: u32 = 1 << 11;
/// Items, with those of the recordings that they show.
const MOST_WEIGHT: u64 = 1 << 26;
/// Before the page has to wait for JavaScript, and for the UI.
const MOST_UNHANDLED: usize = 32 << 20;
const MOST_JOBS: usize = 64;
const BYTES_IN_JOB: usize = 4 << 20;
/// Behind the next message, before a page that does not listen is given up.
const MOST_UNSENT: usize = 256 << 20;
const MOST_UNSENT_MESSAGES: usize = 1 << 18;
/// What a message counts as, at least.
const OVERHEAD: usize = 8 << 10;

struct Unsent {
    bytes: Vec<u8>,
    sent: usize,
}

struct Lane {
    ring: Producer,
    bell: UnixStream,
    unsent: VecDeque<Unsent>,
    in_unsent: usize,
    /// Frames and sizes.
    told: [u32; 2],
    handled: [u32; 2],
    told_at: Instant,
}

type Fetched = Box<dyn FnOnce(Vec<Pixmap>) + Send>;

struct Fetcher {
    socket: UnixStream,
    next: u32,
    waiting: FastMap<u32, Fetched>,
}

pub struct Page {
    id: u32,
    is_trusted: bool,
    lanes: [Mutex<Lane>; 2],
    lent: Mutex<FastSet<u32>>,
    /// Where decoded fonts are stored.
    fonts: Mutex<Option<PathBuf>>,
    fetcher: Mutex<Fetcher>,
    answers: UnixStream,
    petitions: UnixStream,
    shared: Arc<Shared>,
    listens_for_pixels: Once,
    /// It has let the UI wait.
    is_slow: AtomicBool,
    unhandled: Mutex<usize>,
    jobs: AtomicUsize,
    has_progressed: Condvar,
    is_closed: AtomicBool,
}

static PAGES: LazyLock<Mutex<FastMap<u32, Arc<Page>>>> = LazyLock::new(Mutex::default);
/// By surface.
static PROXIES: LazyLock<Mutex<FastMap<u32, Proxy>>> = LazyLock::new(Mutex::default);
static OWNERS: LazyLock<Mutex<FastMap<u32, Arc<Page>>>> = LazyLock::new(Mutex::default);
static EXIST: AtomicBool = AtomicBool::new(false);
static OWED: [AtomicU32; 2] = [const { AtomicU32::new(0) }; 2];

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
enum Kept {
    File(usize),
    Mapped(usize),
    Face(u32),
}

#[derive(Default)]
struct Budget {
    known: FastSet<Kept>,
    in_all: usize,
    mapped: usize,
}

/// For the processes that are not trusted, and for those that are.
static KEPT: LazyLock<Mutex<[Budget; 2]>> = LazyLock::new(Mutex::default);

#[inline]
pub fn exist() -> bool {
    EXIST.load(Ordering::Relaxed)
}

/// How many frames and sizes pages were told of and are not done with.
pub fn owed() -> [u32; 2] {
    OWED.each_ref().map(|it| it.load(Ordering::Relaxed))
}

/// Windows do not wait for a page that hangs.
pub fn forgive(after: Duration) {
    if owed() != [0; 2] {
        for page in PAGES.lock().values() {
            let lane = &mut *page.lanes[0].lock();
            if lane.told_at.elapsed() >= after {
                lane.note_handled(lane.told);
            }
        }
    }
}

impl Lane {
    fn note_told(&mut self, which: usize) {
        (self.told[which], self.told_at) = (self.told[which].wrapping_add(1), Instant::now());
        OWED[which].fetch_add(1, Ordering::Relaxed);
    }

    fn note_handled(&mut self, handled: [u32; 2]) {
        for which in 0..2 {
            let more = handled[which].wrapping_sub(self.handled[which]);
            if more <= self.told[which].wrapping_sub(self.handled[which]) {
                self.handled[which] = handled[which];
                OWED[which].fetch_sub(more, Ordering::Relaxed);
            }
        }
    }

    fn send(&mut self, kind: Told, bytes: &[u8]) {
        let header: Header = [
            kind as u32,
            bytes.len() as u32,
            self.told[0],
            self.told[1],
            bridge::edits_taken(),
        ];
        if self.unsent.is_empty() && self.ring.room() >= size_of::<Header>() + bytes.len() {
            // SAFETY: an array and a slice.
            unsafe {
                self.ring.push(header.as_ptr().cast(), size_of::<Header>());
                self.ring.push(bytes.as_ptr(), bytes.len());
            }
        } else {
            let mut all = Writer::default();
            all.put(header).all(bytes);
            self.in_unsent += all.0.capacity();
            self.unsent.push_back(Unsent {
                bytes: all.0,
                sent: 0,
            });
        }
        self.flush();
    }

    fn is_ignored(&self) -> bool {
        self.unsent.len() > MOST_UNSENT_MESSAGES
            || self.in_unsent - self.unsent.front().map_or(0, |it| it.bytes.capacity())
                > MOST_UNSENT
    }

    fn flush(&mut self) {
        while let Some(first) = self.unsent.front_mut() {
            let left = &first.bytes[first.sent..];
            // SAFETY: a slice.
            first.sent += unsafe { self.ring.push(left.as_ptr(), left.len()) };
            if first.sent == first.bytes.len() {
                self.in_unsent -= first.bytes.capacity();
                self.unsent.pop_front();
            } else if self.ring.will_wait() {
                break;
            }
        }
        if self.ring.publish() {
            ring(&self.bell);
        }
    }
}

fn get(id: u32) -> Option<Arc<Page>> {
    PAGES.lock().get(&id).cloned()
}

static THREADS: Mutex<Vec<JoinHandle<()>>> = Mutex::new(Vec::new());

fn spawn(
    name: &str,
    stack_size: usize,
    run: impl FnOnce() + Send + 'static,
) -> std::io::Result<()> {
    let thread = std::thread::Builder::new()
        .name(name.into())
        .stack_size(stack_size)
        .spawn(run)?;
    let mut all = THREADS.lock();
    all.extract_if(.., |it| it.is_finished())
        .for_each(|it| drop(it.join()));
    all.push(thread);
    Ok(())
}

/// Before the process exits, so that nothing is left halfway.
pub fn close_all() {
    Vec::from_iter(PAGES.lock().values().cloned())
        .iter()
        .for_each(|it| it.close());
    let deadline = Instant::now() + Duration::from_millis(500);
    for thread in std::mem::take(&mut *THREADS.lock()) {
        while !thread.is_finished() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_micros(50));
        }
        if thread.is_finished() {
            drop(thread.join());
        }
    }
}

pub fn open(is_trusted: bool) -> Result<PageProcess> {
    static NEXT_ID: AtomicU32 = AtomicU32::new(1);
    let (shared, memory) = Shared::create().context("could not share memory")?;
    let pair = UnixStream::pair;
    let [bell, other_bell, room, answers, pixels, petitions] =
        [pair()?, pair()?, pair()?, pair()?, pair()?, pair()?];
    let theirs = vec![
        memory,
        other_bell.1.into(),
        room.1.into(),
        answers.1.into(),
        pixels.1.into(),
        petitions.1.into(),
    ];
    for it in &theirs {
        send_all(&bell.0, &mut [bytes_of(&[0u8])], Some(it.as_fd()))
            .context("could not send a descriptor")?;
    }
    let epoch = clock() - (surface::milliseconds(Instant::now()) * 1e6) as u64;
    send_all(&bell.0, &mut [bytes_of(&[epoch])], None).context("could not send the time")?;
    let lane = |index: usize, bell| {
        let (ring, unsent) = (Producer::new(&shared, DOWN[index]), VecDeque::new());
        Mutex::new(Lane {
            ring,
            bell,
            unsent,
            in_unsent: 0,
            told: [0; 2],
            handled: [0; 2],
            told_at: Instant::now(),
        })
    };
    let page = Arc::new(Page {
        id: NEXT_ID.fetch_add(1, Ordering::Relaxed),
        is_trusted,
        lanes: [lane(0, bell.0.try_clone()?), lane(1, other_bell.0)],
        lent: Mutex::default(),
        fonts: Mutex::default(),
        fetcher: Mutex::new(Fetcher {
            socket: pixels.0,
            next: 0,
            waiting: FastMap::default(),
        }),
        answers: answers.0,
        petitions: petitions.0,
        shared: shared.clone(),
        listens_for_pixels: Once::new(),
        is_slow: AtomicBool::new(false),
        unhandled: Mutex::new(0),
        jobs: AtomicUsize::new(0),
        has_progressed: Condvar::new(),
        is_closed: AtomicBool::new(false),
    });
    let (id, up) = (
        page.id,
        Up {
            ring: Consumer::new(&shared, UP),
            bell: bell.0,
            room: room.0,
            theirs,
            page: page.clone(),
            taken: 0,
        },
    );
    PAGES.lock().insert(id, page.clone());
    EXIST.store(true, Ordering::Relaxed);
    let (faces, files, images) = Default::default();
    let allowance = Arc::new(Allowance::new(move || command(id, PageCommand::Close)));
    let listener = Listener {
        allowance,
        from: Reader(up),
        page,
        faces,
        files,
        images,
        in_fonts: 0,
        in_images: 0,
    };
    spawn("page", 512 << 10, move || listener.run())?;
    Ok(PageProcess {
        id,
        socket: OwnedFd::from(bell.1).into_raw_fd(),
    })
}

pub fn command(id: u32, command: PageCommand) {
    let Some(page) = get(id) else { return };
    match command {
        PageCommand::Grant(surface) => drop(OWNERS.lock().insert(surface, page)),
        PageCommand::Revoke(surface) => {
            OWNERS
                .lock()
                .retain(|it, owner| *it != surface || owner.id != id);
            PROXIES.lock().remove(&surface);
        }
        PageCommand::Represent(proxy) => _ = PROXIES.lock().insert(proxy.surface, proxy),
        PageCommand::Lend(image) => _ = page.lent.lock().insert(image),
        PageCommand::TakeBack(image) => _ = page.lent.lock().remove(&image),
        PageCommand::StoreFontsFor(site) => *page.fonts.lock() = text::store_for(&site),
        PageCommand::Handled(length) => {
            let mut unhandled = page.unhandled.lock();
            *unhandled = unhandled.saturating_sub(length + OVERHEAD);
            page.has_progressed.notify_one();
        }
        PageCommand::Outdate => _ = page.shared.times_outdated().fetch_add(1, Ordering::SeqCst),
        PageCommand::Close => page.close(),
    }
}

pub fn send(id: u32, kind: protocol::Lane, bytes: &[u8]) {
    let Some(page) = get(id) else { return };
    let mut lane = page.lanes[usize::from(kind == protocol::Lane::Elsewhere)].lock();
    if kind == protocol::Lane::NewSize {
        lane.note_told(1);
    }
    let told = match kind {
        protocol::Lane::Input => Told::Input,
        protocol::Lane::Motion => Told::Motion,
        _ => Told::Message,
    };
    lane.send(told, bytes);
    page.close_if_deaf(lane);
}

pub fn next_petition(from: u32) -> Option<Vec<u8>> {
    Reader(&get(from)?.petitions).list(MOST_IN_MESSAGE)
}

pub fn rule(to: u32, bytes: &[u8], descriptor: Option<BorrowedFd<'_>>) {
    get(to).and_then(|it| send_answer(&it.petitions, bytes, descriptor));
}

/// Whether it went to the page right away.
pub fn tell(surface: u32, input: &Input) -> bool {
    if !matches!(input, Input::Frame { .. } | Input::Scroll { .. }) {
        return false;
    }
    let Some(page) = OWNERS.lock().get(&surface).cloned() else {
        return false;
    };
    let (mut lane, mut bytes) = (page.lanes[0].lock(), Writer::default());
    match *input {
        Input::Frame { time, interval } => {
            lane.note_told(0);
            lane.send(Told::Frame, &bytes.put(surface).put([time, interval]).0);
        }
        Input::Scroll {
            node,
            generation,
            total,
            has_ended,
        } if lane.unsent.len() < 1 << 12 => {
            lane.send(
                Told::Scroll,
                &bytes
                    .put([surface, node, generation])
                    .put(total)
                    .flag(has_ended)
                    .0,
            );
        }
        _ => {}
    }
    page.close_if_deaf(lane);
    true
}

/// An image that a page has the file of.
pub struct Original {
    page: Arc<Page>,
    id: u32,
}

impl Original {
    /// `done` gets nothing if it fails.
    pub fn fetch(
        &self,
        (width, height): (u32, u32),
        is_exact: bool,
        done: impl FnOnce(Vec<Pixmap>) + Send + 'static,
    ) {
        self.page.listens_for_pixels.call_once(|| {
            let (page, Ok(socket)) = (
                self.page.clone(),
                self.page.fetcher.lock().socket.try_clone(),
            ) else {
                return;
            };
            drop(spawn("pixels", 256 << 10, move || {
                page.take_pixels(&socket)
            }));
        });
        let mut fetcher = self.page.fetcher.lock();
        let request: Fetch = [fetcher.next, self.id, width, height, is_exact.into()];
        if send_some(
            &fetcher.socket,
            &[bytes_of(&request)],
            None,
            libc::MSG_DONTWAIT,
        )
        .is_ok_and(|it| it == size_of::<Fetch>())
        {
            fetcher.next = fetcher.next.wrapping_add(1);
            fetcher.waiting.insert(request[0], Box::new(done));
        } else {
            drop(fetcher);
            done(Vec::new());
        }
    }

    pub fn fetch_now(&self, size: (u32, u32)) -> Vec<Pixmap> {
        const PATIENCE: Duration = Duration::from_secs(1);
        if self.page.is_slow.load(Ordering::Relaxed) {
            return Vec::new();
        }
        let (sender, receiver) = mpsc::sync_channel(1);
        self.fetch(size, true, move |it| drop(sender.send(it)));
        receiver.recv_timeout(PATIENCE).unwrap_or_else(|_| {
            self.page.is_slow.store(true, Ordering::Relaxed);
            Vec::new()
        })
    }
}

impl Page {
    fn take_pixels(&self, socket: &UnixStream) {
        let mut from = Reader(socket);
        let mut next = || {
            let (ticket, sizes) = (from.get::<u32>()?, from.list::<[u32; 2]>(MOST_FRAMES * 8)?);
            let done = self.fetcher.lock().waiting.remove(&ticket)?;
            let bytes = sizes
                .iter()
                .map(|[width, height]| u64::from(*width) * u64::from(*height))
                .fold(0, u64::saturating_add);
            let frames = (bytes <= 1 << 28)
                .then(|| {
                    sizes
                        .into_iter()
                        .map(|it| from.pixels(it))
                        .collect::<Option<Vec<_>>>()
                })
                .flatten();
            let is_valid = frames.is_some();
            done(frames.unwrap_or_default());
            self.is_slow.store(false, Ordering::Relaxed);
            is_valid.then_some(())
        };
        while next().is_some() {}
        drop(socket.shutdown(std::net::Shutdown::Both));
        let waiting = std::mem::take(&mut self.fetcher.lock().waiting);
        waiting.into_values().for_each(|done| done(Vec::new()));
    }

    /// Whatever its threads are waiting for.
    fn close(&self) {
        self.is_closed.store(true, Ordering::Relaxed);
        self.has_progressed.notify_one();
        for socket in [
            &self.lanes[0].lock().bell,
            &self.fetcher.lock().socket,
            &self.answers,
            &self.petitions,
        ] {
            drop(socket.shutdown(std::net::Shutdown::Both));
        }
    }

    fn close_if_deaf(&self, mut lane: MutexGuard<'_, Lane>) {
        if lane.is_ignored() {
            (lane.unsent, lane.in_unsent) = Default::default();
            drop(lane);
            self.close();
        }
    }

    /// Fonts are never freed. `key` is only counted once.
    fn keep<T>(
        &self,
        bytes: usize,
        keep: impl FnOnce() -> Option<T>,
        key: impl FnOnce(&T) -> Kept,
    ) -> Option<T> {
        let Budget {
            known,
            in_all,
            mapped,
        } = &mut KEPT.lock()[usize::from(self.is_trusted)];
        let kept =
            (*in_all + bytes <= MOST_IN_ALL_FONTS && *mapped < MOST_MAPPED_FONTS).then(keep)??;
        let key = key(&kept);
        if known.insert(key) {
            (*in_all, *mapped) = (
                *in_all + bytes,
                *mapped + usize::from(matches!(key, Kept::Mapped(_))),
            );
        }
        Some(kept)
    }

    fn flush(&self) {
        self.lanes.iter().for_each(|it| it.lock().flush());
    }

    fn owns(&self, surface: u32) -> bool {
        OWNERS
            .lock()
            .get(&surface)
            .is_some_and(|it| it.id == self.id)
    }

    fn target_of(&self, surface: u32, command: &SurfaceCommand) -> Option<u32> {
        let proxy = self
            .owns(surface)
            .then(|| PROXIES.lock().get(&surface).copied())?;
        match (command, proxy) {
            (SurfaceCommand::Field(_) | SurfaceCommand::PasswordField, Some(it)) => {
                it.has_keys.then_some(it.top)
            }
            (SurfaceCommand::Cursor(_) | SurfaceCommand::BeginDrag(_), Some(it)) => {
                it.has_pointer.then_some(it.top)
            }
            _ => Some(surface),
        }
    }

    fn borrowed(&self, image: u32) -> Option<u32> {
        Some(image & !LENT).filter(|it| image & LENT != 0 && self.lent.lock().contains(it))
    }
}

struct Up {
    ring: Consumer,
    bell: UnixStream,
    room: UnixStream,
    /// Until they have arrived: macOS may shut down a socket that is only on its way.
    theirs: Vec<OwnedFd>,
    page: Arc<Page>,
    /// For what is being read.
    taken: usize,
}

impl Source for Up {
    unsafe fn fill(&mut self, mut to: *mut u8, mut length: usize) -> Option<()> {
        self.taken += length;
        loop {
            // SAFETY: the caller's contract.
            let pulled = unsafe { self.ring.pull(to, length)? };
            (to, length) = (to.wrapping_add(pulled), length - pulled);
            if self.ring.release() {
                ring(&self.room);
            }
            if length == 0 {
                return Some(());
            }
            if self.ring.will_sleep() {
                thread::release_jobs();
                let has_ended = receive(&self.bell, &mut [0; 64], 0).is_err();
                thread::hold_jobs();
                self.theirs.clear();
                self.page.flush();
                if has_ended && self.ring.available()? == 0 {
                    return None;
                }
            }
            self.ring.is_awake();
        }
    }
}

#[derive(Clone, Copy, Default)]
struct Cost {
    depth: u32,
    weight: u64,
}

struct Image {
    id: u32,
    cost: Cost,
    bytes: usize,
    is_canvas: bool,
}

struct Listener {
    allowance: Arc<Allowance>,
    from: Reader<Up>,
    page: Arc<Page>,
    /// By the numbers that the page has for them.
    faces: Vec<u32>,
    files: FastMap<[u32; 2], &'static [u8]>,
    images: FastMap<u32, Image>,
    in_fonts: usize,
    in_images: usize,
}

/// The numbers of the images of pages, which would use up those of the app.
static IMPORTED: LazyLock<Mutex<(u32, FastSet<u32>)>> = LazyLock::new(Mutex::default);

fn number_for_image() -> u32 {
    let (last, used) = &mut *IMPORTED.lock();
    loop {
        *last = ((*last + 1) % LENT) | (1 << 31);
        if used.insert(*last) {
            return *last;
        }
    }
}

fn release(image: u32) {
    canvas::release(image);
    IMPORTED.lock().1.remove(&image);
}

/// And how many it counts as.
struct Job(Arc<Page>, usize);

impl Drop for Job {
    fn drop(&mut self) {
        if self.0.jobs.fetch_sub(self.1, Ordering::Relaxed) >= MOST_JOBS {
            let _unhandled = self.0.unhandled.lock();
            self.0.has_progressed.notify_one();
        }
    }
}

impl Listener {
    fn run(mut self) {
        thread::stay_outside();
        while crate::guard("error", None, || self.next()).is_some() {}
        let page = self.page;
        page.close();
        PAGES.lock().remove(&page.id);
        OWNERS.lock().retain(|surface, owner| {
            owner.id != page.id || (PROXIES.lock().remove(surface), false).1
        });
        let lane = &mut *page.lanes[0].lock();
        lane.note_handled(lane.told);
        let (id, images) = (page.id, self.images);
        thread::post(move || {
            images.into_values().for_each(|it| release(it.id));
            bridge::emit(Event::Disconnected { from: id });
        });
        thread::release_jobs();
    }

    fn wait_for_turn(&self) -> Option<()> {
        (!self.page.is_closed.load(Ordering::Relaxed)).then_some(())?;
        let mut unhandled = self.page.unhandled.lock();
        while *unhandled > MOST_UNHANDLED || self.page.jobs.load(Ordering::Relaxed) >= MOST_JOBS {
            thread::release_jobs();
            self.page
                .has_progressed
                .wait_until(&mut unhandled, Instant::now() + Duration::from_millis(5));
            self.page.flush();
            (!self.page.is_closed.load(Ordering::Relaxed)).then_some(())?;
        }
        Some(())
    }

    fn post(&mut self, job: impl FnOnce(&Page) + Send + 'static) {
        let of = Job(
            self.page.clone(),
            1 + std::mem::take(&mut self.from.0.taken) / BYTES_IN_JOB,
        );
        self.page.jobs.fetch_add(of.1, Ordering::Relaxed);
        thread::post(move || job(&of.0));
    }

    fn command(&mut self, surface: u32, command: SurfaceCommand, edits: u32) {
        self.post(move |page| {
            if let Some(surface) = page.target_of(surface, &command) {
                drop(surface::command(surface, command, edits));
            }
        });
    }

    fn area(&mut self) -> Option<Option<Rect>> {
        let (is_some, area) = (self.from.flag()?, self.from.get()?);
        Some(is_some.then_some(area))
    }

    fn display_list(&mut self, scene: &mut Scene) -> Option<Cost> {
        fn list<T: super::Valid>(from: &mut Reader<Up>, into: &mut Vec<T>) -> Option<()> {
            let count = from.get()?;
            from.all_into(into, count, MOST_IN_LIST)
        }
        scene.allowance = Some(self.allowance.clone());
        let from = &mut self.from;
        scene.zoom = Some(from.get::<f32>()?)
            .filter(|it| (1e-3..1e3).contains(it))
            .unwrap_or(1.);
        list(from, scene.submitted_mut())?;
        list(from, &mut scene.glyphs)?;
        list(from, &mut scene.stops)?;
        list(from, &mut scene.filters)?;
        list(from, &mut scene.verbs)?;
        list(from, &mut scene.bytes)?;
        list(from, &mut scene.regions)?;
        let (mut cost, mut depth) = (
            Cost {
                depth: 0,
                weight: scene.submitted_mut().len() as u64,
            },
            0u32,
        );
        let length = |it: Span| u64::from(it.end.saturating_sub(it.start));
        cost.weight += scene
            .filters
            .iter()
            .map(|it| {
                if let Filter::Primitive { arguments, .. } = it {
                    length(*arguments)
                } else {
                    0
                }
            })
            .sum::<u64>();
        for item in scene.submitted_mut() {
            cost.weight += match *item {
                Item::PushClipPath { verbs: it, .. }
                | Item::PushLayer { filters: it, .. }
                | Item::Backdrop { filters: it, .. }
                | Item::Svg { source: it, .. }
                | Item::Gradient { stops: it, .. }
                | Item::Shade { stops: it, .. }
                | Item::Text { glyphs: it, .. } => length(it),
                Item::Path { outline, .. } | Item::PushClipOutline(outline) => {
                    length(outline.verbs) + length(outline.stroke.dashes)
                }
                Item::TextStroke { glyphs, stroke, .. } => length(glyphs) + length(stroke.dashes),
                _ => 0,
            };
            match item {
                Item::Text { face, .. } | Item::TextStroke { face, .. } => {
                    *face = self.faces.get(*face as usize).copied().unwrap_or(u32::MAX)
                }
                Item::Image { image, .. } | Item::ImagePart { image, .. } => {
                    match self.images.get(image) {
                        Some(it) => {
                            (*image, cost.depth, cost.weight) = (
                                it.id,
                                cost.depth.max(depth + it.cost.depth),
                                cost.weight.saturating_add(it.cost.weight),
                            );
                        }
                        None => *image = self.page.borrowed(*image).unwrap_or(0),
                    }
                }
                Item::PushClip(_)
                | Item::PushClipPath { .. }
                | Item::PushTransform(_)
                | Item::PushLayer { .. }
                | Item::PushClipOutline(_)
                | Item::PushVector(_)
                | Item::PushPattern { .. }
                | Item::PushProjection(_) => {
                    depth += 1;
                    cost.depth = cost.depth.max(depth);
                }
                Item::Pop => depth = depth.checked_sub(1)?,
                _ => {}
            }
        }
        (cost.depth <= MOST_DEPTH && cost.weight <= MOST_WEIGHT).then_some(cost)
    }

    fn forget_image(&mut self, number: u32) -> Option<u32> {
        let image = self.images.remove(&number)?;
        self.in_images -= image.bytes;
        Some(image.id)
    }

    fn release_image(&mut self, number: u32) {
        if let Some(id) = self.forget_image(number) {
            self.post(move |_| release(id));
        }
    }

    fn add_image(&mut self, number: u32, image: Image) -> Option<()> {
        self.release_image(number);
        self.in_images += image.bytes;
        self.images.insert(number, image);
        (self.in_images <= MOST_IN_IMAGES && self.images.len() <= MOST_IMAGES).then_some(())
    }

    fn accessibility(&mut self, tree: u32) -> Option<()> {
        let from = &mut self.from;
        let (is_first, is_complete, zoom, [root, focus], selection) = (
            from.flag()?,
            from.flag()?,
            from.get()?,
            from.get()?,
            from.get()?,
        );
        let (removed, nodes, placements) = (
            from.list(MOST_IN_LIST)?,
            from.list::<tree::Node>(MOST_IN_LIST)?,
            from.list(MOST_IN_LIST)?,
        );
        let (announcements, children) = (
            from.list::<tree::Announcement>(MOST_IN_LIST)?,
            from.list(MOST_IN_LIST)?,
        );
        let (texts, mut numbers) = (
            from.list::<tree::TextEntry>(MOST_IN_LIST)?,
            from.list::<tree::NumberEntry>(MOST_IN_LIST)?,
        );
        let (relations, runs, advances) = (
            from.list(MOST_IN_LIST)?,
            from.list(MOST_IN_LIST)?,
            from.list(MOST_IN_LIST)?,
        );
        let (misspelled, bytes) = (from.list(MOST_IN_LIST)?, from.list(MOST_IN_LIST)?);
        let mut copied = 0;
        let mut fits = |span: Span, length: usize| {
            copied += span.end.saturating_sub(span.start) as usize;
            span.start <= span.end && span.end as usize <= length && copied <= MOST_IN_LIST
        };
        let lengths = [
            children.len(),
            texts.len(),
            numbers.len(),
            relations.len(),
            runs.len(),
            advances.len(),
            misspelled.len(),
        ];
        for it in &nodes {
            (it.id != 0).then_some(())?;
            let spans = [
                it.children,
                it.texts,
                it.numbers,
                it.relations,
                it.runs,
                it.advances,
                it.misspelled,
            ];
            spans
                .into_iter()
                .zip(lengths)
                .all(|(span, length)| fits(span, length))
                .then_some(())?;
            texts[it.texts.range()]
                .iter()
                .all(|it| fits(it.value, bytes.len()))
                .then_some(())?;
        }
        announcements
            .iter()
            .all(|it| fits(it.text, bytes.len()))
            .then_some(())?;
        for it in numbers.iter_mut().filter(|it| it.key == Number::Frame) {
            it.value = self.page.borrowed(it.value as u32).unwrap_or(0).into();
        }
        let update = tree::Update {
            is_first,
            is_complete,
            zoom,
            root,
            focus,
            selection,
            removed: Slice::new(&removed),
            nodes: Slice::new(&nodes),
            placements: Slice::new(&placements),
            announcements: Slice::new(&announcements),
            children: Slice::new(&children),
            texts: Slice::new(&texts),
            numbers: Slice::new(&numbers),
            relations: Slice::new(&relations),
            runs: Slice::new(&runs),
            advances: Slice::new(&advances),
            misspelled: Slice::new(&misspelled),
            bytes: Slice::new(&bytes),
        };
        // SAFETY: the slices are alive, and the spans are inside of them.
        let mut update = unsafe { accessibility::Update::copy(&update) };
        update.is_doubtful = true;
        self.post(move |page| {
            let of_image = || Some(page.borrowed(tree & !TREE_OF_IMAGE)? | TREE_OF_IMAGE);
            let tree = if tree & TREE_OF_IMAGE == 0 {
                page.owns(tree).then_some(tree)
            } else {
                of_image()
            };
            if let Some(tree) = tree {
                accessibility::apply(tree, update);
            }
        });
        Some(())
    }

    fn keep_file(&mut self, key: [u32; 2], data: &'static [u8]) -> Option<()> {
        self.in_fonts += data.len();
        self.files.insert(key, data);
        (self.in_fonts <= MOST_IN_FONTS && self.files.len() <= MOST_FILES).then_some(())
    }

    fn face(&mut self, number: u32) -> Option<()> {
        let from = &mut self.from;
        let (origin, style) = (
            from.get::<[u32; 2]>()?,
            [from.flag()?, from.flag()?, from.flag()?],
        );
        let palette = text::Palette {
            base: from.get()?,
            overrides: from.list(MOST_IN_NAME * 8)?,
        };
        let (coords, recipe) = (from.list(MOST_IN_NAME)?, from.list(MOST_IN_NAME * 64)?);
        let file = match origin {
            [1, listed] => text::listed_file(listed),
            origin => text::file_of(self.files.get(&origin)?),
        };
        (number < MOST_FACES).then_some(())?;
        self.faces
            .resize(self.faces.len().max(number as usize + 1), u32::MAX);
        (self.faces[number as usize] == u32::MAX).then_some(())?;
        let bytes = IN_FACE
            + 2 * (size_of_val(&coords[..]) + size_of_val(&palette.overrides[..]) + recipe.len());
        let import = || {
            Some(text::import_face(
                file?,
                coords,
                style,
                palette,
                &recipe,
                origin[0] != 1,
            ))
        };
        self.faces[number as usize] = self
            .page
            .keep(bytes, import, |it| Kept::Face(*it))
            .unwrap_or(u32::MAX);
        Some(())
    }

    fn answer(&mut self, question: Asked) -> Option<()> {
        let most = if matches!(question, Asked::Store) {
            MOST_IN_FONT
        } else {
            MOST_IN_NAME
        };
        let (numbers, first, second) = (
            self.from.get::<[u32; 2]>()?,
            self.from.list::<u8>(most)?,
            self.from.list::<u8>(most)?,
        );
        let (mut answer, mut file, name) =
            (Writer::default(), None, || std::str::from_utf8(&first).ok());
        let found = match question {
            Asked::Named => text::family_named(name()?),
            Asked::Generic => text::generic_family(name()?),
            Asked::Fallback => text::fallback_family(
                char::from_u32(numbers[0])?,
                numbers[1] != 0,
                &first,
                Reader(&second[..]).get(),
            ),
            #[cfg(target_os = "macos")]
            Asked::Native => {
                answer.all(&text::about_glyph(
                    numbers[0],
                    numbers[1],
                    Reader(&first[..]).get()?,
                )?);
                None
            }
            #[cfg(not(target_os = "macos"))]
            Asked::Native => return None,
            Asked::Local => text::font_named(name()?),
            Asked::Fonts => {
                text::fonts_of(numbers[0])
                    .into_iter()
                    .for_each(|(font, ranges)| _ = answer.put(font).put(ranges));
                None
            }
            Asked::Names => {
                text::font_families()
                    .iter()
                    .for_each(|it| _ = answer.all(it.as_bytes()).put(b'\n'));
                None
            }
            Asked::Open => {
                if let Some((opened, data, index)) = text::open_font(numbers[0]) {
                    answer
                        .put(index)
                        .all(if opened.is_some() { &[] } else { data });
                    file = opened;
                }
                None
            }
            Asked::Stored | Asked::Store => {
                let path =
                    self.page.fonts.lock().as_ref().map(|it| {
                        it.with_extension(format!("{:08x}{:08x}", numbers[1], numbers[0]))
                    });
                let (data, length) = match question {
                    Asked::Store => (Some(&second[..]), first.len()),
                    _ => (None, Reader(&first[..]).get::<u32>()? as usize),
                };
                let bytes = data.map_or_else(
                    || Some(path.as_ref()?.metadata().ok()?.len() as usize),
                    |it| Some(first.len() + it.len()),
                );
                let open = || text::open_stored(&path?, &first, data);
                let (stored, number) = (
                    bytes.and_then(|it| {
                        self.page
                            .keep(it, open, |it| Kept::Mapped(it.1.as_ptr().addr()))
                    }),
                    self.files.len() as u32,
                );
                if let Some((opened, data)) =
                    stored.and_then(|(file, all)| Some((file, all.get(length..)?)))
                {
                    self.in_fonts += length;
                    self.keep_file([2, number], data)?;
                    file = Some(opened);
                }
                Some(number)
            }
        };
        answer.all(found.as_slice());
        thread::release_jobs();
        send_answer(
            &self.page.answers,
            &answer.0,
            file.as_ref().map(|it| it.as_fd()),
        )
    }

    fn next(&mut self) -> Option<()> {
        self.wait_for_turn()?;
        self.from.0.taken = 0;
        let [kind, about] = self.from.get::<[u32; 2]>()?;
        match Sent::of(kind.try_into().ok()?)? {
            Sent::Message => {
                let bytes = self.from.list::<u8>(MOST_IN_MESSAGE)?;
                *self.page.unhandled.lock() += bytes.len() + OVERHEAD;
                bridge::emit(Event::Message {
                    from: self.page.id,
                    message: Message {
                        bytes: bytes.into(),
                        edits: 0,
                        lane: protocol::Lane::Scripts,
                    },
                });
            }
            Sent::Scene => {
                let mut submission = surface::spare_submission();
                self.display_list(&mut submission.0)?;
                let (from, tables) = (&mut self.from, &mut submission.1);
                (tables.scrollers, tables.drivers) =
                    (from.list(MOST_IN_LIST)?, from.list(MOST_IN_LIST)?);
                (tables.numbers, tables.hits) =
                    (from.list(MOST_IN_LIST)?, from.list(MOST_IN_LIST)?);
                (tables
                    .drivers
                    .iter()
                    .map(|it| u64::from(it.samples.end.saturating_sub(it.samples.start)))
                    .sum::<u64>()
                    <= MOST_WEIGHT)
                    .then_some(())?;
                self.post(move |page| {
                    if page.owns(about) {
                        surface::adopt(about, submission);
                    }
                });
            }
            Sent::Scrollers => {
                let scrollers = self.from.list(MOST_IN_LIST)?;
                self.post(move |page| {
                    if page.owns(about) {
                        surface::adopt_scrollers(about, scrollers);
                    }
                });
            }
            Sent::Accessibility => self.accessibility(about)?,
            Sent::RequestFrame => self.command(about, SurfaceCommand::RequestFrame, 0),
            Sent::PasswordField => self.command(about, SurfaceCommand::PasswordField, 0),
            Sent::Cursor => {
                let cursor = self.from.get()?;
                self.command(about, SurfaceCommand::Cursor(cursor), 0);
            }
            Sent::Canvas => {
                let color = self.from.get()?;
                self.command(about, SurfaceCommand::Canvas(color), 0);
            }
            Sent::Field => {
                let (from, mut field) = (&mut self.from, Maybe::No);
                let edits = from.get()?;
                if from.flag()? {
                    let (text, selection, caret) = (
                        from.list::<u16>(MOST_IN_TEXT)?,
                        from.get::<[u32; 2]>()?,
                        from.get()?,
                    );
                    let (is_composing, composing, is_out_of_date) =
                        (from.flag()?, from.get::<[u32; 2]>()?, from.flag()?);
                    let composing = is_composing.then_some(composing).into();
                    field = Maybe::Yes(InputField {
                        text: text.into(),
                        selection,
                        composing,
                        caret,
                        is_out_of_date,
                    });
                }
                self.command(about, SurfaceCommand::Field(field), edits);
            }
            Sent::BeginDrag => {
                let from = &mut self.from;
                let (image, area, copies, links) =
                    (from.get()?, from.get()?, from.flag()?, from.flag()?);
                let (text, html, url) = (
                    from.text(MOST_IN_TEXT)?.into(),
                    from.text(MOST_IN_TEXT)?.into(),
                    from.text(MOST_IN_TEXT)?,
                );
                let url = if url.starts_with("https://") || url.starts_with("http://") {
                    url
                } else {
                    String::new()
                }
                .into();
                let image = self.forget_image(image).unwrap_or(0);
                self.post(move |page| {
                    let command = SurfaceCommand::BeginDrag(Dragged {
                        image,
                        area,
                        text,
                        html,
                        url,
                        copies,
                        links,
                    });
                    let window_of =
                        |it| crate::window::state(surface::get(it)?.borrow().window?).ok();
                    if let Some(target) = page
                        .target_of(about, &command)
                        .filter(|it| window_of(*it).is_some_and(|it| it.pointer.is_pressed()))
                    {
                        drop(surface::command(target, command, 0));
                    }
                    release(image);
                });
            }
            Sent::Bounds => {
                let bounds = self.area()?;
                self.post(move |page| {
                    if page.owns(about)
                        && surface::get(about).is_some_and(|it| it.borrow().window.is_none())
                    {
                        drop(surface::command(
                            about,
                            SurfaceCommand::Bounds(bounds.into()),
                            0,
                        ));
                    }
                });
            }
            Sent::Mirror => {
                let (view, scale, area) = (self.from.get()?, self.from.get()?, self.area()?.into());
                self.post(move |page| {
                    if let Some(view) = page.borrowed(view).filter(|_| page.owns(about)) {
                        drop(webview::command(
                            view,
                            WebViewCommand::Mirror {
                                surface: about,
                                scale,
                                area,
                            },
                        ));
                    }
                });
            }
            Sent::Handled => {
                let handled = self.from.get()?;
                self.post(move |page| page.lanes[0].lock().note_handled(handled));
            }
            Sent::File => {
                let sent = self.from.list(MOST_IN_FONT)?;
                (self.in_fonts + sent.len() <= MOST_IN_FONTS).then_some(())?;
                let data = self.page.keep(
                    sent.len(),
                    || text::keep_font(sent),
                    |it| Kept::File(it.as_ptr().addr()),
                );
                self.keep_file([0, about], data.unwrap_or_default())?;
            }
            Sent::Face => self.face(about)?,
            Sent::Bitmap => {
                let from = &mut self.from;
                let (size, ends) = (from.get::<[u32; 2]>()?, from.list::<u32>(MOST_FRAMES * 4)?);
                let (is_deferred, can_be_fetched, count) =
                    (from.flag()?, from.flag()?, from.get::<u32>()? as usize);
                (size.iter().all(|it| (1..1 << 20).contains(it))
                    && !ends.is_empty()
                    && (count == 0 || count == ends.len()))
                .then_some(())?;
                let (mut frames, mut bytes) = (Vec::new(), 0);
                for _ in 0..count {
                    let sent = from
                        .get::<[u32; 2]>()
                        .filter(|it| is_deferred || *it == size)?;
                    frames.push(from.pixels(sent)?);
                    bytes += sent[0] as usize * sent[1] as usize * 4;
                    (bytes <= MOST_IN_IMAGES / 2).then_some(())?;
                }
                let original = can_be_fetched.then(|| Original {
                    page: self.page.clone(),
                    id: about,
                });
                let id = images::import(
                    number_for_image(),
                    size,
                    &ends,
                    is_deferred,
                    original,
                    frames,
                );
                // Pixels that can be fetched are dropped like those that can be decoded again.
                let bytes =
                    ends.len() * size_of::<Duration>() + if can_be_fetched { 0 } else { bytes };
                self.add_image(
                    about,
                    Image {
                        id,
                        cost: Cost::default(),
                        bytes,
                        is_canvas: false,
                    },
                )?;
            }
            Sent::Recording => {
                let (size, mut scene) = (self.from.get()?, Scene::default());
                let cost = self.display_list(&mut scene)?;
                let (cost, bytes) = (
                    Cost {
                        depth: cost.depth + 8,
                        ..cost
                    },
                    scene.bytes_of_list(),
                );
                self.add_image(
                    about,
                    Image {
                        id: images::record(number_for_image(), scene, size),
                        cost,
                        bytes,
                        is_canvas: false,
                    },
                )?;
            }
            Sent::Pixels => {
                let (size, [left, top, width, height]) =
                    (self.from.get::<[u32; 2]>()?, self.from.get::<[u32; 4]>()?);
                let fits = |start: u32, length: u32, all: u32| {
                    all <= 1 << 16 && start <= all && length <= all - start
                };
                (fits(left, width, size[0]) && fits(top, height, size[1])).then_some(())?;
                let pixels = if width == 0 || height == 0 {
                    None
                } else {
                    Some(self.from.pixels([width, height])?)
                };
                let bytes = size[0] as usize * size[1] as usize * 4;
                if !self.images.get(&about).is_some_and(|it| it.is_canvas) {
                    self.add_image(
                        about,
                        Image {
                            id: number_for_image(),
                            cost: Cost::default(),
                            bytes: 0,
                            is_canvas: true,
                        },
                    )?;
                }
                let image = self.images.get_mut(&about)?;
                self.in_images =
                    self.in_images + bytes - std::mem::replace(&mut image.bytes, bytes);
                let id = image.id;
                (self.in_images <= MOST_IN_IMAGES).then_some(())?;
                self.post(move |_| canvas::show(id, size, [left, top], pixels));
            }
            Sent::Release => self.release_image(about),
            Sent::Question => self.answer(Asked::of(about.try_into().ok()?)?)?,
        }
        Some(())
    }
}

#[cfg(test)]
mod tests {
    use std::io::Read as _;
    use std::os::fd::{AsRawFd as _, FromRawFd as _};

    use super::*;

    /// One that never reads what it is sent.
    struct Hostile {
        id: u32,
        bell: UnixStream,
        room: UnixStream,
        up: Producer,
        _others: [OwnedFd; 4],
    }

    impl Hostile {
        fn new() -> Hostile {
            let PageProcess { id, socket } = open(false).unwrap();
            // SAFETY: it is the caller's.
            let bell = unsafe { UnixStream::from_raw_fd(socket) };
            let [memory, other_bell, room, answers, pixels, petitions] =
                [(); 6].map(|()| receive(&bell, &mut [0], 0).unwrap().unwrap());
            let up = Producer::new(&Shared::map(&memory).unwrap(), UP);
            let room = UnixStream::from(room);
            room.set_read_timeout(Some(Duration::from_secs(20)))
                .unwrap();
            Hostile {
                id,
                bell,
                room,
                up,
                _others: [other_bell, answers, pixels, petitions],
            }
        }

        /// False if the host has stopped reading.
        fn send(&mut self, kind: Sent, about: u32, rest: &Writer) -> bool {
            let mut all = Writer::default();
            all.put([kind as u32, about]).all(&rest.0);
            let mut left = &all.0[..];
            loop {
                // SAFETY: a slice.
                left = &left[unsafe { self.up.push(left.as_ptr(), left.len()) }..];
                if self.up.publish() {
                    ring(&self.bell);
                }
                if left.is_empty() {
                    return true;
                }
                if self.up.will_wait() && !(&self.room).read(&mut [0; 16]).is_ok_and(|it| it > 0) {
                    return false;
                }
            }
        }

        fn is_given_up(&self) -> bool {
            let deadline = Instant::now() + Duration::from_secs(5);
            while get(self.id).is_some() && Instant::now() < deadline {
                std::thread::sleep(Duration::from_millis(1));
            }
            get(self.id).is_none()
        }
    }

    #[test]
    fn descriptors_from_a_page_are_closed() {
        let (page, pairs) = (
            Hostile::new(),
            [(); 4].map(|()| UnixStream::pair().unwrap()),
        );
        pairs
            .iter()
            .for_each(|it| it.1.set_read_timeout(Some(Duration::from_secs(5))).unwrap());
        let mut part = bytes_of(&[0u8]);
        // SAFETY: zeros are a message without parts, which then gets some that outlive the call.
        unsafe {
            let (mut message, mut control): (libc::msghdr, super::super::WithDescriptors<4>) =
                (std::mem::zeroed(), std::mem::zeroed());
            (
                control.header.cmsg_len,
                control.header.cmsg_level,
                control.header.cmsg_type,
            ) = (libc::CMSG_LEN(16) as _, libc::SOL_SOCKET, libc::SCM_RIGHTS);
            control.descriptors = pairs.each_ref().map(|it| it.0.as_raw_fd());
            (message.msg_iov, message.msg_iovlen) = (&raw mut part, 1);
            (message.msg_control, message.msg_controllen) =
                ((&raw mut control).cast(), libc::CMSG_SPACE(16) as _);
            assert_eq!(libc::sendmsg(page.bell.as_raw_fd(), &message, 0), 1);
        }
        for (sent, mut kept) in pairs {
            drop(sent);
            assert_eq!(kept.read(&mut [0]).ok(), Some(0));
        }
    }

    #[test]
    fn a_page_that_does_not_read_its_answers_can_be_closed() {
        let (mut page, mut question) = (Hostile::new(), Writer::default());
        question
            .put([0u32; 2])
            .list::<u8>(&[0; MOST_IN_NAME])
            .list::<u8>(&[0; MOST_IN_NAME]);
        page.room
            .set_read_timeout(Some(Duration::from_millis(200)))
            .unwrap();
        while page.send(Sent::Question, Asked::Stored as u32, &question) {}
        assert!(get(page.id).is_some());
        command(page.id, PageCommand::Close);
        assert!(page.is_given_up());
    }

    #[test]
    fn a_page_that_does_not_read_is_given_up() {
        let page = Hostile::new();
        (0..3).for_each(|_| {
            send(
                page.id,
                protocol::Lane::Scripts,
                &vec![0; MOST_UNSENT / 2 + 1],
            )
        });
        assert!(page.is_given_up());
        let page = Hostile::new();
        command(page.id, PageCommand::Grant(page.id));
        (0..MOST_UNSENT_MESSAGES * 2).for_each(|_| {
            _ = tell(
                page.id,
                &Input::Frame {
                    time: 0.,
                    interval: 0.,
                },
            )
        });
        assert!(page.is_given_up());
    }

    #[test]
    fn bitmaps_that_can_be_fetched_take_limited_memory() {
        let (mut page, mut bitmap) = (Hostile::new(), Writer::default());
        bitmap
            .put([1024u32; 2])
            .list(&[0u32])
            .flag(false)
            .flag(true)
            .put(1u32)
            .put([1024u32; 2])
            .all(&vec![0u8; 4 << 20]);
        (1..=64).for_each(|it| assert!(page.send(Sent::Bitmap, it, &bitmap)));
        assert!(images::bytes_of_pixels() <= 32 << 20);
        let mut bitmap = Writer::default();
        bitmap
            .put([1u32; 2])
            .list(&[0u32; MOST_FRAMES])
            .flag(false)
            .flag(true)
            .put(0u32);
        let most = MOST_IN_IMAGES / (MOST_FRAMES * size_of::<Duration>());
        assert!(
            (100..)
                .take(most + UP_IN_BYTES / bitmap.0.len() + 2)
                .any(|it| !page.send(Sent::Bitmap, it, &bitmap))
        );
        assert!(page.is_given_up());
    }

    const UP_IN_BYTES: usize = 4 << 20;

    #[test]
    fn fonts_are_counted_before_they_are_kept() {
        let page = get(Hostile::new().id)
            .or_else(|| get(open(false).unwrap().id))
            .unwrap();
        assert_eq!(
            page.keep(MOST_IN_ALL_FONTS / 2, || Some(1), |it| Kept::File(*it)),
            Some(1)
        );
        assert_eq!(
            page.keep(MOST_IN_ALL_FONTS / 2, || Some(1), |it| Kept::File(*it)),
            Some(1)
        );
        assert_eq!(
            page.keep(
                MOST_IN_ALL_FONTS / 2 + 1,
                || -> Option<usize> { unreachable!() },
                |it| Kept::File(*it)
            ),
            None
        );
        (0..MOST_MAPPED_FONTS)
            .for_each(|it| assert_eq!(page.keep(0, || Some(it), |it| Kept::Mapped(*it)), Some(it)));
        assert_eq!(page.keep(0, || Some(0), |it| Kept::Face(*it)), None);
    }
}
