//! In the process with the windows.

use std::collections::VecDeque;
use std::os::fd::{IntoRawFd as _, OwnedFd};
use std::os::unix::net::UnixStream;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicUsize, Ordering};
use std::sync::{Arc, LazyLock, Once, mpsc};
use std::time::{Duration, Instant};

use super::ring::{Consumer, Producer, Shared};
use super::{
    Asked, DOWN, Fetch, Header, LENT, Reader, Sent, Source, Told, UP, Writer, bytes_of, clock,
    receive, ring, send_all, send_some,
};
use crate::abi::accessibility::{self as tree, Number, TREE_OF_IMAGE};
use crate::abi::{Item, Rect, Slice, Span};
use crate::error::{Context as _, Result, ensure};
use crate::gfx::Pixmap;
use crate::hash::{FastMap, FastSet};
use crate::host::thread;
use crate::paint::scene::Scene;
use crate::protocol::{
    self, Dragged, Event, Input, InputField, Maybe, Message, PageCommand, PageProcess,
    SurfaceCommand, WebViewCommand,
};
use crate::sync::{Condvar, Mutex};
use crate::{accessibility, bridge, canvas, images, surface, text, webview};

const MOST_IN_MESSAGE: usize = (512 << 20) + 4096;
const MOST_IN_LIST: usize = 128 << 20;
const MOST_IN_TEXT: usize = 8 << 20;
const MOST_IN_NAME: usize = 1 << 10;
const MOST_IN_FONT: usize = 128 << 20;
const MOST_IN_FONTS: usize = 512 << 20;
const MOST_IN_IMAGES: usize = 2 << 30;
const MOST_FILES: usize = 1 << 11;
const MOST_FACES: u32 = 1 << 16;
const MOST_IMAGES: usize = 1 << 18;
const MOST_FRAMES: usize = 1 << 14;
const MOST_DEPTH: u32 = 1 << 11;
/// Items, with those of the recordings that they show.
const MOST_WEIGHT: u64 = 1 << 26;
/// Before the page has to wait for JavaScript, and for the UI.
const MOST_UNHANDLED: usize = 32 << 20;
const MOST_JOBS: usize = 64;
/// What a message counts as, at least.
const OVERHEAD: usize = 8 << 10;

struct Unsent {
    bytes: Vec<u8>,
    sent: usize,
    descriptor: Option<OwnedFd>,
}

struct Lane {
    ring: Producer,
    bell: UnixStream,
    unsent: VecDeque<Unsent>,
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
    lanes: [Mutex<Lane>; 2],
    lent: Mutex<FastSet<u32>>,
    /// Where decoded fonts are stored.
    fonts: Mutex<Option<PathBuf>>,
    fetcher: Mutex<Fetcher>,
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
static OWNERS: LazyLock<Mutex<FastMap<u32, Arc<Page>>>> = LazyLock::new(Mutex::default);
static EXIST: AtomicBool = AtomicBool::new(false);
static OWED: [AtomicU32; 2] = [const { AtomicU32::new(0) }; 2];

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

    fn send(&mut self, kind: Told, bytes: &[u8], descriptor: Option<OwnedFd>) {
        let header: Header = [
            kind as u32,
            descriptor.is_some().into(),
            bytes.len() as u32,
            self.told[0],
            self.told[1],
            bridge::edits_taken(),
        ];
        if self.unsent.is_empty()
            && descriptor.is_none()
            && self.ring.room() >= size_of::<Header>() + bytes.len()
        {
            // SAFETY: an array and a slice.
            unsafe {
                self.ring.push(header.as_ptr().cast(), size_of::<Header>());
                self.ring.push(bytes.as_ptr(), bytes.len());
            }
        } else {
            let mut all = Writer::default();
            all.put(header).all(bytes);
            self.unsent.push_back(Unsent {
                bytes: all.0,
                sent: 0,
                descriptor,
            });
        }
        self.flush();
    }

    fn flush(&mut self) {
        while let Some(first) = self.unsent.front_mut() {
            if first.descriptor.is_some()
                && send_some(
                    &self.bell,
                    &[bytes_of(&[0u8])],
                    first.descriptor.as_ref(),
                    libc::MSG_DONTWAIT,
                )
                .is_err()
            {
                self.ring.will_wait();
                break;
            }
            first.descriptor = None;
            let left = &first.bytes[first.sent..];
            // SAFETY: a slice.
            first.sent += unsafe { self.ring.push(left.as_ptr(), left.len()) };
            if first.sent == first.bytes.len() {
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

pub fn open() -> Result<PageProcess> {
    static NEXT_ID: AtomicU32 = AtomicU32::new(1);
    ensure!(
        thread::exists(),
        "windows do not have a thread of their own"
    );
    let (shared, memory) = Shared::create().context("could not share memory")?;
    let [bell, other_bell, room, answers, pixels] = [
        UnixStream::pair()?,
        UnixStream::pair()?,
        UnixStream::pair()?,
        UnixStream::pair()?,
        UnixStream::pair()?,
    ];
    for theirs in [
        memory,
        other_bell.1.into(),
        room.1.into(),
        answers.1.into(),
        pixels.1.into(),
    ] {
        send_all(&bell.0, &mut [bytes_of(&[0u8])], Some(&theirs))
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
            told: [0; 2],
            handled: [0; 2],
            told_at: Instant::now(),
        })
    };
    let page = Arc::new(Page {
        id: NEXT_ID.fetch_add(1, Ordering::Relaxed),
        lanes: [lane(0, bell.0.try_clone()?), lane(1, other_bell.0)],
        lent: Mutex::default(),
        fonts: Mutex::default(),
        fetcher: Mutex::new(Fetcher {
            socket: pixels.0,
            next: 0,
            waiting: FastMap::default(),
        }),
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
            page: page.clone(),
            has_ended: false,
        },
    );
    PAGES.lock().insert(id, page.clone());
    EXIST.store(true, Ordering::Relaxed);
    let (faces, files, images) = Default::default();
    let listener = Listener {
        from: Reader(up),
        page,
        answers: answers.0,
        faces,
        files,
        images,
        in_fonts: 0,
        in_images: 0,
    };
    std::thread::Builder::new()
        .name("page".into())
        .stack_size(512 << 10)
        .spawn(move || listener.run())?;
    Ok(PageProcess {
        id,
        socket: OwnedFd::from(bell.1).into_raw_fd(),
    })
}

pub fn command(id: u32, command: PageCommand) {
    let Some(page) = get(id) else { return };
    match command {
        PageCommand::Grant(surface) => drop(OWNERS.lock().insert(surface, page)),
        PageCommand::Revoke(surface) => OWNERS
            .lock()
            .retain(|it, owner| *it != surface || owner.id != id),
        PageCommand::Lend(image) => _ = page.lent.lock().insert(image),
        PageCommand::TakeBack(image) => _ = page.lent.lock().remove(&image),
        PageCommand::StoreFontsFor(site) => *page.fonts.lock() = text::store_for(&site),
        PageCommand::Handled(length) => {
            let mut unhandled = page.unhandled.lock();
            *unhandled = unhandled.saturating_sub(length + OVERHEAD);
            page.has_progressed.notify_one();
        }
        PageCommand::Close => {
            page.is_closed.store(true, Ordering::Relaxed);
            page.has_progressed.notify_one();
            drop(page.lanes[0].lock().bell.shutdown(std::net::Shutdown::Both));
        }
    }
}

pub fn send(id: u32, kind: protocol::Lane, bytes: &[u8], descriptor: Option<OwnedFd>) {
    let Some(page) = get(id) else { return };
    let lane = &mut *page.lanes[usize::from(kind == protocol::Lane::Elsewhere)].lock();
    if kind == protocol::Lane::NewSize {
        lane.note_told(1);
    }
    lane.send(Told::Message, bytes, descriptor);
}

/// Whether it went to the page right away.
pub fn tell(surface: u32, input: &Input) -> bool {
    if !matches!(input, Input::Frame { .. } | Input::Scroll { .. }) {
        return false;
    }
    let Some(page) = OWNERS.lock().get(&surface).cloned() else {
        return false;
    };
    let (lane, mut bytes) = (&mut *page.lanes[0].lock(), Writer::default());
    match *input {
        Input::Frame { time, interval } => {
            lane.note_told(0);
            lane.send(
                Told::Frame,
                &bytes.put(surface).put([time, interval]).0,
                None,
            );
        }
        Input::Scroll {
            node,
            generation,
            total,
            has_ended,
        } => {
            const MOST_UNSENT: usize = 1 << 12;
            if lane.unsent.len() < MOST_UNSENT {
                lane.send(
                    Told::Scroll,
                    &bytes
                        .put([surface, node, generation])
                        .put(total)
                        .flag(has_ended)
                        .0,
                    None,
                );
            }
        }
        _ => {}
    }
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
            drop(
                std::thread::Builder::new()
                    .name("pixels".into())
                    .stack_size(256 << 10)
                    .spawn(move || page.take_pixels(&socket)),
            );
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

    fn flush(&self) {
        self.lanes.iter().for_each(|it| it.lock().flush());
    }

    fn owns(&self, surface: u32) -> bool {
        OWNERS
            .lock()
            .get(&surface)
            .is_some_and(|it| it.id == self.id)
    }

    fn borrowed(&self, image: u32) -> Option<u32> {
        Some(image & !LENT).filter(|it| image & LENT != 0 && self.lent.lock().contains(it))
    }
}

struct Up {
    ring: Consumer,
    bell: UnixStream,
    room: UnixStream,
    page: Arc<Page>,
    has_ended: bool,
}

impl Source for Up {
    unsafe fn fill(&mut self, mut to: *mut u8, mut length: usize) -> Option<()> {
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
                self.has_ended = receive(&self.bell, &mut [0; 64], 0).is_err();
                thread::hold_jobs();
                self.page.flush();
                if self.has_ended && self.ring.available()? == 0 {
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
    from: Reader<Up>,
    page: Arc<Page>,
    answers: UnixStream,
    /// By the numbers that the page has for them.
    faces: Vec<u32>,
    files: FastMap<[u32; 2], &'static [u8]>,
    images: FastMap<u32, Image>,
    in_fonts: usize,
    in_images: usize,
}

struct Job(Arc<Page>);

impl Drop for Job {
    fn drop(&mut self) {
        if self.0.jobs.fetch_sub(1, Ordering::Relaxed) >= MOST_JOBS {
            let _unhandled = self.0.unhandled.lock();
            self.0.has_progressed.notify_one();
        }
    }
}

impl Listener {
    fn run(mut self) {
        while crate::guard("error", None, || self.next()).is_some() {}
        let page = self.page;
        PAGES.lock().remove(&page.id);
        OWNERS.lock().retain(|_, owner| owner.id != page.id);
        let lane = &mut *page.lanes[0].lock();
        lane.note_handled(lane.told);
        drop(
            page.fetcher
                .lock()
                .socket
                .shutdown(std::net::Shutdown::Both),
        );
        let has_misbehaved = !self.from.0.has_ended && !page.is_closed.load(Ordering::Relaxed);
        let (id, images) = (page.id, self.images);
        thread::post(move || {
            images.into_values().for_each(|it| canvas::release(it.id));
            bridge::emit(Event::Disconnected {
                from: id,
                has_misbehaved,
            });
        });
        thread::release_jobs();
    }

    fn wait_for_turn(&self) -> Option<()> {
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

    fn post(&self, job: impl FnOnce(&Page) + Send + 'static) {
        self.page.jobs.fetch_add(1, Ordering::Relaxed);
        let of = Job(self.page.clone());
        thread::post(move || job(&of.0));
    }

    fn command(&self, surface: u32, command: SurfaceCommand, edits: u32) {
        self.post(move |page| {
            if page.owns(surface) {
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
        for item in scene.submitted_mut() {
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
                                cost.weight + it.cost.weight,
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
                Item::Pop => depth = depth.saturating_sub(1),
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
            self.post(move |_| canvas::release(id));
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
        let update = unsafe { accessibility::Update::copy(&update) };
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
        self.faces[number as usize] = file.map_or(u32::MAX, |file| {
            text::import_face(file, coords, style, palette, &recipe, origin[0] != 1)
        });
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
            Asked::Fallback => {
                text::fallback_family(char::from_u32(numbers[0])?, numbers[1] != 0, &first)
            }
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
                let (stored, number) = (
                    path.and_then(|it| text::open_stored(&it, &first, data)),
                    self.files.len() as u32,
                );
                if let Some((opened, data)) =
                    stored.and_then(|(file, all)| Some((file, all.get(length..)?)))
                {
                    self.keep_file([2, number], data)?;
                    file = Some(opened);
                }
                Some(number)
            }
        };
        answer.all(found.as_slice());
        thread::release_jobs();
        send_all(
            &self.answers,
            &mut [bytes_of(&[0u8])],
            file.map(OwnedFd::from).as_ref(),
        )?;
        send_all(
            &self.answers,
            &mut [bytes_of(&[answer.0.len() as u32]), bytes_of(&answer.0)],
            None,
        )
    }

    fn next(&mut self) -> Option<()> {
        self.wait_for_turn()?;
        let [kind, about] = self.from.get::<[u32; 2]>()?;
        match Sent::of(kind.try_into().ok()?)? {
            Sent::Message => {
                let bytes = self.from.list::<u8>(MOST_IN_MESSAGE)?;
                *self.page.unhandled.lock() += bytes.len() + OVERHEAD;
                bridge::emit(Event::Message {
                    from: self.page.id,
                    message: Message {
                        bytes: bytes.into(),
                        descriptor: -1,
                        edits: 0,
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
                let url = if url
                    .get(..5)
                    .is_some_and(|it| it.eq_ignore_ascii_case("file:"))
                {
                    String::new()
                } else {
                    url
                }
                .into();
                let image = self.forget_image(image).unwrap_or(0);
                self.post(move |page| {
                    if page.owns(about) {
                        drop(surface::command(
                            about,
                            SurfaceCommand::BeginDrag(Dragged {
                                image,
                                area,
                                text,
                                html,
                                url,
                                copies,
                                links,
                            }),
                            0,
                        ));
                    }
                    canvas::release(image);
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
                let data = text::keep_font(self.from.list(MOST_IN_FONT)?).unwrap_or_default();
                self.keep_file([0, about], data)?;
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
                let id = images::import(size, &ends, is_deferred, original, frames);
                self.add_image(
                    about,
                    Image {
                        id,
                        cost: Cost::default(),
                        bytes: if can_be_fetched { 0 } else { bytes },
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
                        id: images::record(scene, size),
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
                            id: images::next_id(),
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
