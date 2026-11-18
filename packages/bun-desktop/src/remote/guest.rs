//! In the process of a page.

use std::cell::Cell;
use std::os::fd::{AsRawFd as _, FromRawFd as _, IntoRawFd as _, OwnedFd};
use std::os::unix::net::UnixStream;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};

use super::ring::{Consumer, Producer, Shared};
use super::valid::Valid;
use super::{
    Asked, DOWN, Fetch, Header, LENT, Reader, Sent, Told, UP, Writer, bytes_of, clock, receive,
    ring, send_all,
};
use crate::abi::{self, Item, Rect};
use crate::gfx::Pixmap;
use crate::hash::{FastMap, FastSet};
use crate::host::{self, thread};
use crate::images::{self, Exported};
use crate::motion::Tables;
use crate::paint::scene::{Scene, copy};
use crate::protocol::{
    Command, Event, Input, Lane, Maybe, Message, Ruling, SOCKET_TO_PARENT, SurfaceCommand,
    WebViewCommand,
};
use crate::sync::Mutex;
use crate::text::{self, Origin};
use crate::{bridge, canvas};

struct Up {
    ring: Producer,
    /// What the host knows of.
    faces: Vec<bool>,
    images: FastSet<u32>,
    files: FastMap<usize, u32>,
    handled: [u32; 2],
}

struct Down {
    ring: Consumer,
    bell: UnixStream,
    header: Option<Header>,
    /// What has arrived of the header, or of what follows it.
    bytes: Vec<u8>,
    told: [u32; 2],
}

struct Host {
    up: Mutex<Up>,
    bell: UnixStream,
    room: UnixStream,
    answers: Mutex<UnixStream>,
    petitions: Mutex<UnixStream>,
    pixels: Mutex<UnixStream>,
    down: [Mutex<Down>; 2],
    epoch: Instant,
    shared: Arc<Shared>,
}

static IS_ON: AtomicBool = AtomicBool::new(false);
static HOST: OnceLock<Host> = OnceLock::new();

thread_local! {
    /// Until JavaScript is done with its events, so that the host wakes once.
    static HOLDS: Cell<bool> = const { Cell::new(false) };
}

#[inline]
pub fn is_on() -> bool {
    IS_ON.load(Ordering::Relaxed)
}

fn host() -> &'static Host {
    HOST.get().expect("there is a host")
}

fn host_is_gone() -> ! {
    // SAFETY: nothing is left to do.
    unsafe { libc::_exit(0) }
}

pub fn connect() {
    let descriptor = SOCKET_TO_PARENT;
    // SAFETY: it was inherited for this.
    let bell = unsafe { UnixStream::from_raw_fd(descriptor) };
    // SAFETY: a descriptor.
    unsafe { libc::fcntl(descriptor, libc::F_SETFD, libc::FD_CLOEXEC) };
    let connect = || {
        bell.set_nonblocking(false).ok()?;
        let next = || receive(&bell, &mut [0], 0).ok()?;
        let [memory, other_bell, room, answers, pixels, petitions] =
            [next()?, next()?, next()?, next()?, next()?, next()?];
        let (shared, epoch) = (Shared::map(&memory)?, Reader(&bell).get::<u64>()?);
        let down = |lane: usize, bell| {
            let ring = Consumer::new(&shared, DOWN[lane]);
            Mutex::new(Down {
                ring,
                bell,
                header: None,
                bytes: Vec::new(),
                told: [0; 2],
            })
        };
        let pixels = UnixStream::from(pixels);
        let requests = pixels.try_clone().ok()?;
        let (faces, images, files, handled) = Default::default();
        HOST.get_or_init(|| Host {
            up: Mutex::new(Up {
                ring: Producer::new(&shared, UP),
                faces,
                images,
                files,
                handled,
            }),
            down: [
                down(0, bell.try_clone().expect("it is open")),
                down(1, other_bell.into()),
            ],
            room: room.into(),
            answers: Mutex::new(answers.into()),
            petitions: Mutex::new(petitions.into()),
            pixels: Mutex::new(pixels),
            epoch: Instant::now() - Duration::from_nanos(clock().saturating_sub(epoch)),
            bell,
            shared: shared.clone(),
        });
        std::thread::Builder::new()
            .name("pixels".into())
            .stack_size(256 << 10)
            .spawn(move || serve_pixels(&requests))
            .ok()
    };
    if connect().is_none() {
        host_is_gone();
    }
    IS_ON.store(true, Ordering::Relaxed);
}

pub fn times_outdated() -> u32 {
    host().shared.times_outdated().load(Ordering::SeqCst)
}

/// That of the host.
pub fn epoch() -> Option<Instant> {
    Some(HOST.get()?.epoch)
}

impl Up {
    fn all<T: Valid>(&mut self, values: &[T]) -> &mut Up {
        let (mut from, mut left) = (values.as_ptr().cast::<u8>(), size_of_val(values));
        loop {
            // SAFETY: what is left of the values.
            let pushed = unsafe { self.ring.push(from, left) };
            (from, left) = (from.wrapping_add(pushed), left - pushed);
            if left == 0 {
                return self;
            }
            self.flush();
            while self.ring.will_wait() {
                if receive(&host().room, &mut [0; 16], 0).is_err() {
                    host_is_gone();
                }
            }
        }
    }

    fn put<T: Valid>(&mut self, value: T) -> &mut Up {
        self.all(&[value])
    }

    fn flag(&mut self, value: bool) -> &mut Up {
        self.put(u8::from(value))
    }

    fn list<T: Valid>(&mut self, values: &[T]) -> &mut Up {
        self.put(values.len() as u32).all(values)
    }

    fn start(&mut self, kind: Sent, about: u32) -> &mut Up {
        self.put([kind as u32, about])
    }

    fn area(&mut self, area: Option<Rect>) -> &mut Up {
        self.flag(area.is_some()).put(area.unwrap_or_default())
    }

    fn flush(&mut self) {
        if self.ring.publish() {
            ring(&host().bell);
        }
    }

    fn finish(&mut self) {
        if !HOLDS.get() {
            self.flush();
        }
    }

    fn lacks_face(&self, face: u32) -> bool {
        !self.faces.get(face as usize).is_some_and(|it| *it) && face != u32::MAX
    }

    fn lacks_image(&self, image: u32) -> bool {
        image != 0 && image & LENT == 0 && !self.images.contains(&image)
    }

    fn face(&mut self, id: u32, recipe: &str) {
        let Some(face) = text::face(id) else { return };
        let origin = match face.file.origin {
            Origin::Unknown => {
                let (next, address) = (self.files.len() as u32, face.file.data.as_ptr().addr());
                let number = *self.files.entry(address).or_insert(next);
                if number == next {
                    self.start(Sent::File, number).list(face.file.data);
                }
                [0, number]
            }
            Origin::Listed(number) => [1, number],
            Origin::Stored(number) => [2, number],
        };
        self.start(Sent::Face, id)
            .put(origin)
            .flag(face.embolden)
            .flag(face.skew)
            .flag(face.is_smoothed);
        self.put(face.palette().base)
            .list(&face.palette().overrides)
            .list(face.coords)
            .list(recipe.as_bytes());
        self.faces
            .resize(self.faces.len().max(id as usize + 1), false);
        self.faces[id as usize] = true;
    }

    fn pixels(&mut self, id: u32) -> bool {
        let sent = canvas::take_changes(id, !self.images.contains(&id), |size, area, rows| {
            self.start(Sent::Pixels, id).put(size).put(area);
            rows.for_each(|row| _ = self.all(row));
        });
        sent.is_some()
    }

    /// # Safety
    /// The slices are valid.
    unsafe fn display_list(&mut self, list: &abi::DisplayList) -> &mut Up {
        // SAFETY: the caller's contract.
        unsafe {
            self.put(list.zoom)
                .list(list.items.get())
                .list(list.glyphs.get())
                .list(list.stops.get())
                .list(list.filters.get());
            self.list(list.verbs.get())
                .list(list.bytes.get())
                .list(list.regions.get())
        }
    }
}

/// Sends the faces and images that the host lacks. False if that takes the thread of the canvases.
fn send_what_is_used(items: &[Item]) -> bool {
    let (mut faces, mut images) = (Vec::new(), Vec::new());
    let up = host().up.lock();
    for item in items {
        match *item {
            Item::Text { face, .. } | Item::TextStroke { face, .. }
                if up.lacks_face(face) && !faces.contains(&face) =>
            {
                faces.push(face)
            }
            Item::Image { image, .. } | Item::ImagePart { image, .. }
                if up.lacks_image(image) && !images.contains(&image) =>
            {
                images.push(image)
            }
            _ => {}
        }
    }
    drop(up);
    for face in faces {
        let recipe = text::Recipe::exported(face);
        host().up.lock().face(face, &recipe);
    }
    images.into_iter().all(send_image)
}

fn send_image(id: u32) -> bool {
    let is_sent = images::export(id, |image| match image {
        Exported::Recording { list, size } => {
            // SAFETY: the image is alive.
            unsafe {
                send_what_is_used(list.items.get()).then_some(())?;
                host()
                    .up
                    .lock()
                    .start(Sent::Recording, id)
                    .put(size)
                    .display_list(&list);
            }
            Some(())
        }
        Exported::Bitmap {
            size,
            ends,
            is_deferred,
            can_be_fetched,
            frames,
        } => {
            let up = &mut *host().up.lock();
            up.start(Sent::Bitmap, id)
                .put(size)
                .list(&ends)
                .flag(is_deferred)
                .flag(can_be_fetched)
                .put(frames.len() as u32);
            frames
                .iter()
                .for_each(|it| _ = up.put([it.width(), it.height()]).all(it.data()));
            Some(())
        }
    });
    let up = &mut *host().up.lock();
    match is_sent {
        Some(Some(())) => _ = up.images.insert(id),
        Some(None) => return false,
        None if thread::is_elsewhere() => return false,
        None => {
            if up.pixels(id) {
                up.images.insert(id);
            }
        }
    }
    true
}

/// After what the canvases were told to draw.
fn in_order(send: impl FnOnce(&mut Up) + Send + 'static) {
    let send = move || {
        let up = &mut *host().up.lock();
        send(up);
        up.finish();
    };
    if thread::is_behind() {
        thread::post(send)
    } else {
        send()
    }
}

/// # Safety
/// The slices are valid.
unsafe fn send_scene(
    surface: u32,
    list: &abi::DisplayList,
    tables: (&[abi::Scroller], &[abi::Driver], &[f32], &[abi::Hit]),
) {
    let up = &mut *host().up.lock();
    // SAFETY: the caller's contract.
    unsafe { up.start(Sent::Scene, surface).display_list(list) }
        .list(tables.0)
        .list(tables.1)
        .list(tables.2)
        .list(tables.3)
        .finish();
}

/// # Safety
/// The slices of `list` and `compositing` are valid.
pub unsafe fn submit(
    surface: u32,
    list: &abi::DisplayList,
    compositing: Option<&abi::Compositing>,
) {
    // SAFETY: the caller's contract, and then they are those of the copy.
    unsafe {
        if !thread::is_behind() && send_what_is_used(list.items.get()) {
            let tables = compositing.map(|it| {
                (
                    it.scrollers.get(),
                    it.drivers.get(),
                    it.numbers.get(),
                    it.hits.get(),
                )
            });
            return send_scene(surface, list, tables.unwrap_or_default());
        }
        let (mut scene, mut tables) = (Scene::default(), Tables::default());
        scene.copy_list(list);
        if let Some(compositing) = compositing {
            copy(compositing.scrollers, &mut tables.scrollers);
            copy(compositing.drivers, &mut tables.drivers);
            copy(compositing.numbers, &mut tables.numbers);
            copy(compositing.hits, &mut tables.hits);
        }
        thread::post(move || {
            let list = scene.list();
            send_what_is_used(list.items.get());
            send_scene(
                surface,
                &list,
                (
                    &tables.scrollers,
                    &tables.drivers,
                    &tables.numbers,
                    &tables.hits,
                ),
            );
        });
    }
}

pub fn submit_scrollers(surface: u32, scrollers: Vec<abi::Scroller>) {
    in_order(move |up| _ = up.start(Sent::Scrollers, surface).list(&scrollers));
}

/// # Safety
/// The slices are valid.
pub unsafe fn update_accessibility(tree: u32, it: &abi::accessibility::Update) {
    let mut bytes = Writer::default();
    bytes
        .flag(it.is_first)
        .flag(it.is_complete)
        .put(it.zoom)
        .put([it.root, it.focus])
        .put(it.selection);
    // SAFETY: the caller's contract.
    unsafe {
        bytes
            .list(it.removed.get())
            .list(it.nodes.get())
            .list(it.placements.get())
            .list(it.announcements.get())
            .list(it.children.get());
        bytes
            .list(it.texts.get())
            .list(it.numbers.get())
            .list(it.relations.get())
            .list(it.runs.get())
            .list(it.advances.get());
        bytes.list(it.misspelled.get()).list(it.bytes.get());
    }
    in_order(move |up| _ = up.start(Sent::Accessibility, tree).all(&bytes.0));
}

pub fn tell(command: Command) {
    let edits = bridge::edits_taken();
    match command {
        Command::Surface {
            id,
            command: SurfaceCommand::BeginDrag(it),
        } => thread::post(move || {
            let image = if it.image != 0 && send_image(it.image) {
                it.image
            } else {
                0
            };
            let up = &mut *host().up.lock();
            up.start(Sent::BeginDrag, id)
                .put(image)
                .put(it.area)
                .flag(it.copies)
                .flag(it.links);
            up.list(it.text.as_bytes())
                .list(it.html.as_bytes())
                .list(it.url.as_bytes())
                .finish();
            up.images.remove(&image);
            images::release(it.image);
        }),
        Command::Surface { id, command } => in_order(move |up| match command {
            SurfaceCommand::RequestFrame => _ = up.start(Sent::RequestFrame, id),
            SurfaceCommand::Cursor(cursor) => _ = up.start(Sent::Cursor, id).put(cursor),
            SurfaceCommand::Canvas(color) => _ = up.start(Sent::Canvas, id).put(color),
            SurfaceCommand::PasswordField => _ = up.start(Sent::PasswordField, id),
            SurfaceCommand::Bounds(bounds) => _ = up.start(Sent::Bounds, id).area(bounds.get()),
            SurfaceCommand::Field(Maybe::No) => {
                _ = up.start(Sent::Field, id).put(edits).flag(false)
            }
            SurfaceCommand::Field(Maybe::Yes(it)) => {
                up.start(Sent::Field, id)
                    .put(edits)
                    .flag(true)
                    .list(&it.text)
                    .put(it.selection)
                    .put(it.caret);
                up.flag(it.composing.as_ref().is_some())
                    .put(it.composing.get().unwrap_or_default())
                    .flag(it.is_out_of_date);
            }
            _ => {}
        }),
        Command::WebView {
            id,
            command:
                WebViewCommand::Mirror {
                    surface,
                    scale,
                    area,
                },
        } => {
            in_order(move |up| {
                _ = up
                    .start(Sent::Mirror, surface)
                    .put(id)
                    .put(scale)
                    .area(area.get())
            });
        }
        _ => {}
    }
}

/// On the thread of the canvases.
pub fn image_changed(id: u32) {
    let up = &mut *host().up.lock();
    if up.images.contains(&id) {
        up.pixels(id);
        up.finish();
    }
}

pub fn image_released(id: u32) {
    let up = &mut *host().up.lock();
    if up.images.remove(&id) {
        up.start(Sent::Release, id).finish();
    }
}

pub fn send(bytes: &[u8], can_wait: bool) {
    if thread::is_behind() {
        let bytes = bytes.to_vec();
        return thread::post(move || {
            host()
                .up
                .lock()
                .start(Sent::Message, 0)
                .list(&bytes)
                .flush()
        });
    }
    let up = &mut *host().up.lock();
    up.start(Sent::Message, 0).list(bytes);
    if can_wait { up.finish() } else { up.flush() }
}

pub struct Answer {
    bytes: Vec<u8>,
    at: usize,
    descriptor: Option<OwnedFd>,
}

impl Answer {
    fn from(socket: &UnixStream) -> Answer {
        let answer = || {
            let descriptor = receive(socket, &mut [0], 0).ok()?;
            Some(Answer {
                descriptor,
                bytes: Reader(socket).list(usize::MAX)?,
                at: 0,
            })
        };
        answer().unwrap_or_else(|| host_is_gone())
    }

    fn get<T: Valid>(&mut self) -> Option<T> {
        let value = Reader(self.bytes.get(self.at..)?).get();
        self.at += size_of::<T>();
        value
    }
}

fn ask(question: Asked, numbers: [u32; 2], lists: [&[u8]; 2]) -> Answer {
    let answers = host().answers.lock();
    host()
        .up
        .lock()
        .start(Sent::Question, question as u32)
        .put(numbers)
        .list(lists[0])
        .list(lists[1])
        .flush();
    Answer::from(&answers)
}

pub fn petition(bytes: &[u8], is_answered: bool) -> Ruling {
    let socket = host().petitions.lock();
    if send_all(
        &socket,
        &mut [bytes_of(&[bytes.len() as u32]), bytes_of(bytes)],
        None,
    )
    .is_none()
    {
        host_is_gone();
    }
    if !is_answered {
        return Ruling {
            bytes: Vec::new().into(),
            descriptor: -1,
        };
    }
    let answer = Answer::from(&socket);
    Ruling {
        bytes: answer.bytes.into(),
        descriptor: answer.descriptor.map_or(-1, OwnedFd::into_raw_fd),
    }
}

pub fn family_named(name: &str) -> Option<u32> {
    ask(Asked::Named, [0; 2], [name.as_bytes(), &[]]).get()
}

pub fn generic_family(name: &str) -> Option<u32> {
    ask(Asked::Generic, [0; 2], [name.as_bytes(), &[]]).get()
}

/// `like` is a font of the system, a weight, whether it is italic, and a scale.
pub fn fallback_family(
    character: char,
    is_in_color: bool,
    language: &[u8],
    like: Option<[u32; 4]>,
) -> Option<u32> {
    ask(
        Asked::Fallback,
        [character.into(), is_in_color.into()],
        [language, &Writer::default().all(like.as_slice()).0],
    )
    .get()
}

/// What only the system knows about a glyph.
#[cfg(target_os = "macos")]
pub fn ask_about_glyph(font: u32, glyph: u32, question: [f32; 4]) -> Vec<u8> {
    ask(
        Asked::Native,
        [font, glyph],
        [&Writer::default().put(question).0, &[]],
    )
    .bytes
}

pub fn font_named(name: &str) -> Option<u32> {
    ask(Asked::Local, [0; 2], [name.as_bytes(), &[]]).get()
}

/// With their ranges of weights, widths and slopes.
pub fn fonts_of(family: u32) -> Vec<(u32, [f32; 6])> {
    let mut answer = ask(Asked::Fonts, [family, 0], [&[], &[]]);
    std::iter::from_fn(|| Some((answer.get()?, answer.get()?))).collect()
}

/// One on each line.
pub fn family_names() -> String {
    String::from_utf8(ask(Asked::Names, [0; 2], [&[], &[]]).bytes).unwrap_or_default()
}

/// The file, and which of its fonts it is.
pub fn open_font(font: u32) -> Option<(&'static [u8], u32)> {
    let mut answer = ask(Asked::Open, [font, 0], [&[], &[]]);
    let index = answer.get()?;
    Some((
        answer.descriptor.take().map_or_else(
            || Some(&answer.bytes.leak()[size_of::<u32>()..]),
            |it| text::map_file(&it.into()),
        )?,
        index,
    ))
}

/// The original and then what it decodes to, which is `data` unless it has been stored before, and its number.
pub fn stored_font(
    hash: u64,
    original: &[u8],
    data: Option<&[u8]>,
) -> Option<(&'static [u8], u32)> {
    let hash = [hash as u32, (hash >> 32) as u32];
    let mut answer = match data {
        Some(data) => ask(Asked::Store, hash, [original, data]),
        None => ask(
            Asked::Stored,
            hash,
            [&(original.len() as u32).to_ne_bytes(), &[]],
        ),
    };
    Some((
        text::map_file(&answer.descriptor.take()?.into())?,
        answer.get()?,
    ))
}

fn serve_pixels(requests: &UnixStream) {
    while let Some([ticket, image, width, height, is_exact]) = Reader(requests).get::<Fetch>() {
        bridge::spawn(move || {
            let reply = |frames: &[&Pixmap]| {
                let (header, sizes) = (
                    [ticket, frames.len() as u32],
                    frames
                        .iter()
                        .map(|it| [it.width(), it.height()])
                        .collect::<Vec<_>>(),
                );
                let pixels = host().pixels.lock();
                send_all(&pixels, &mut [bytes_of(&header), bytes_of(&sizes)], None);
                frames
                    .iter()
                    .for_each(|it| _ = send_all(&pixels, &mut [bytes_of(it.data())], None));
            };
            let fetch = std::panic::AssertUnwindSafe(|| {
                images::fetch(image, (width, height), is_exact != 0, reply)
            });
            if !matches!(std::panic::catch_unwind(fetch), Ok(Some(()))) {
                reply(&[]);
            }
        });
    }
    host_is_gone();
}

fn message(header: Header, bytes: Vec<u8>) -> Message {
    let lane = match Told::of(header[0] as u8) {
        Some(Told::Input) => Lane::Input,
        Some(Told::Motion) => Lane::Motion,
        _ => Lane::Scripts,
    };
    Message {
        bytes: bytes.into(),
        edits: header[4],
        lane,
    }
}

impl Down {
    fn listen(&mut self, flags: i32) {
        if receive(&self.bell, &mut [0; 64], flags)
            .is_err_and(|it| it.kind() != std::io::ErrorKind::WouldBlock)
        {
            host_is_gone();
        }
    }

    /// Whether `bytes` has that many now.
    fn gather(&mut self, length: usize) -> bool {
        let known = self.bytes.len();
        self.bytes.reserve_exact(length - known);
        // SAFETY: there is room, and that many were written.
        unsafe {
            let more = self
                .ring
                .pull(self.bytes.as_mut_ptr().add(known), length - known)
                .unwrap_or_else(|| host_is_gone());
            self.bytes.set_len(known + more);
        }
        self.bytes.len() == length
    }

    fn next(&mut self) -> Option<(Header, Vec<u8>)> {
        if self.header.is_none() && self.gather(size_of::<Header>()) {
            self.header = Reader(&self.bytes[..]).get();
            self.bytes.clear();
        }
        let next = self
            .header
            .filter(|it| self.gather(it[1] as usize))
            .map(|it| (it, std::mem::take(&mut self.bytes)));
        self.header.take_if(|_| next.is_some());
        if self.ring.release() {
            ring(&host().bell);
        }
        next
    }

    fn event(&mut self, header: Header, bytes: Vec<u8>) -> Option<Event> {
        self.told = [header[2], header[3]];
        let mut numbers = Reader(&bytes[..]);
        Some(match Told::of(header[0] as u8)? {
            Told::Message | Told::Input | Told::Motion => Event::Message {
                from: 0,
                message: message(header, bytes),
            },
            Told::Frame => {
                let (id, [time, interval]) = (numbers.get()?, numbers.get()?);
                Event::Surface {
                    id,
                    input: Input::Frame { time, interval },
                }
            }
            Told::Scroll => {
                let ([id, node, generation], total, has_ended) =
                    (numbers.get()?, numbers.get()?, numbers.flag()?);
                Event::Surface {
                    id,
                    input: Input::Scroll {
                        node,
                        generation,
                        total,
                        has_ended,
                    },
                }
            }
        })
    }
}

/// On the thread that runs JavaScript.
pub fn take_events() {
    let down = &mut *host().down[0].lock();
    while down.ring.available() != Some(0)
        && let Some((header, bytes)) = down.next()
    {
        down.event(header, bytes).into_iter().for_each(bridge::emit);
    }
}

pub fn hold() {
    HOLDS.set(true);
}

fn release() {
    if HOLDS.take() {
        host().up.lock().flush();
    }
}

pub fn events_were_handled() {
    let told = host().down[0].lock().told;
    if !bridge::has_events() && std::mem::replace(&mut host().up.lock().handled, told) != told {
        in_order(move |up| _ = up.start(Sent::Handled, 0).put(told));
    }
    release();
}

pub fn pump(source: Option<isize>, timeout: Option<Duration>) -> bool {
    release();
    take_events();
    if timeout != Some(Duration::ZERO) && !bridge::has_events() {
        let mut down = host().down[0].lock();
        if down.ring.will_sleep() && host::wait_for(source, down.bell.as_raw_fd(), timeout) {
            down.listen(libc::MSG_DONTWAIT);
        }
        down.ring.is_awake();
        drop(down);
        take_events();
    }
    bridge::has_events()
}

/// The next message that is not for the thread that runs JavaScript.
pub fn receive_elsewhere() -> Message {
    let down = &mut *host().down[1].lock();
    loop {
        if let Some((header, bytes)) = down.next() {
            return message(header, bytes);
        }
        if down.ring.will_sleep() {
            down.listen(0);
        }
        down.ring.is_awake();
    }
}
