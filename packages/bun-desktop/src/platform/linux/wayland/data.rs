//! What is copied, selected and dragged.

use std::cell::{Cell, RefCell};
use std::fs::File;
use std::io::{ErrorKind, Read as _, Write as _};
use std::os::fd::{AsRawFd as _, OwnedFd};
use std::sync::Arc;
use std::time::{Duration, Instant};

use super::super::formats::{self, Contents, URI_LIST, paths_in};
use super::super::socket;
use super::window::Window;
use super::wire::{Event, Kind};
use super::{Global, Wayland, pixels};
use crate::error::Result;
use crate::gfx::Pixmap;
use crate::hash::FastMap;
use crate::input;
use crate::platform::{Cursor, Input, Point};
use crate::protocol::{Clipboard, ClipboardPart, Dragged};

const COPY: u32 = 1;
const DRAGGED_BY_PAGE: &str = "application/x-dragged-by-page";
const ELSEWHERE: Point = Point { x: -1e4, y: -1e4 };

#[derive(Clone, Default)]
struct Source {
    object: u32,
    contents: Contents,
}

/// What a page has begun.
struct OwnDrag {
    source: Source,
    window: u32,
    /// The surface, its viewport and its buffer.
    icon: [u32; 3],
}

/// What is over a window.
#[derive(Clone, Copy)]
struct Visit {
    offer: u32,
    serial: u32,
    window: u32,
    is_accepted: bool,
}

/// The clipboard comes first, and then the primary selection.
#[derive(Default)]
pub struct Data {
    devices: Cell<[u32; 2]>,
    types: RefCell<FastMap<u32, Vec<String>>>,
    offers: [Cell<u32>; 2],
    sources: RefCell<[Source; 2]>,
    was_pasted: Cell<bool>,
    own_drag: RefCell<Option<OwnDrag>>,
    visit: Cell<Option<Visit>>,
}

/// Returns what is left.
fn write_while_read<'a>(file: &mut File, mut bytes: &'a [u8], patience: i32) -> &'a [u8] {
    while !bytes.is_empty() && socket::wait(file.as_raw_fd(), libc::POLLOUT, patience) {
        match file.write(bytes) {
            Ok(count) => bytes = &bytes[count..],
            Err(error)
                if matches!(error.kind(), ErrorKind::WouldBlock | ErrorKind::Interrupted) => {}
            Err(_) => return &[],
        }
    }
    bytes
}

fn write_out(file: OwnedFd, bytes: Arc<Vec<u8>>) {
    const READERS: usize = 32;
    // SAFETY: it is open.
    unsafe { libc::fcntl(file.as_raw_fd(), libc::F_SETFL, libc::O_NONBLOCK) };
    let mut file = File::from(file);
    let left = write_while_read(&mut file, &bytes, 0).len();
    if left != 0 && Arc::strong_count(&bytes) < READERS {
        _ = std::thread::Builder::new()
            .stack_size(1 << 16)
            .spawn(move || write_while_read(&mut file, &bytes[bytes.len() - left..], 10_000).len());
    }
}

fn is_for_source(event: &Event) -> bool {
    matches!(event.kind, Kind::DataSource | Kind::PrimarySource)
}

impl Wayland {
    pub fn watch_data(&self) {
        let seat = self.global(Global::Seat);
        if seat != 0 {
            let devices = [
                (Kind::DataDevice, Global::Data),
                (Kind::PrimaryDevice, Global::Primary),
            ];
            self.data.devices.set(devices.map(|(kind, manager)| {
                self.wire.create(kind, 0, self.global(manager), 1, &[seat])
            }));
        }
    }

    fn has_type(&self, offer: u32, name: &str) -> bool {
        self.data
            .types
            .borrow()
            .get(&offer)
            .is_some_and(|it| it.iter().any(|it| it == name))
    }

    /// It may be from this app.
    fn receive(&self, offer: u32, opcode: u16, name: &str, deadline: Instant) -> Option<Vec<u8>> {
        const FOR_A_PART: Duration = Duration::from_secs(2);
        let most = if name == URI_LIST { 1 << 22 } else { 1 << 28 };
        let (mut reader, writer) = self.has_type(offer, name).then(std::io::pipe)?.ok()?;
        self.wire.attach(writer.into());
        self.wire.send_text(offer, opcode, &[], name, &[]);
        let (mut all, mut part) = (Vec::new(), vec![0; 1 << 16]);
        let until = || (Instant::now() + FOR_A_PART).min(deadline);
        while all.len() <= most
            && self.wire.wait_for_file(
                reader.as_raw_fd(),
                until(),
                |event| self.source_event(event),
                is_for_source,
            )
        {
            match reader.read(&mut part).ok()? {
                0 => return Some(all),
                count => all.extend(&part[..count]),
            }
        }
        None
    }

    fn forget_offer(&self, offer: u32, opcode: u16) {
        self.data.types.borrow_mut().remove(&offer);
        self.wire.destroy(offer, opcode);
    }

    fn new_source(&self, is_primary: bool, contents: Contents) -> Source {
        let (kind, manager) = if is_primary {
            (Kind::PrimarySource, Global::Primary)
        } else {
            (Kind::DataSource, Global::Data)
        };
        let object = self.wire.create(kind, 0, self.global(manager), 0, &[]);
        contents
            .iter()
            .for_each(|(name, _)| self.wire.send_text(object, 0, &[], name, &[]));
        Source { object, contents }
    }

    pub fn read_selection(&'static self, part: ClipboardPart) -> Clipboard {
        let which = usize::from(part == ClipboardPart::Selection);
        self.wire.sync();
        self.handle(|it| match it.kind {
            Kind::DataDevice => matches!(it.opcode, 0 | 5),
            kind => {
                matches!(
                    kind,
                    Kind::DataOffer | Kind::PrimaryOffer | Kind::PrimaryDevice
                ) || is_for_source(it)
            }
        });
        // Only the active app is told what there is, and none that its own offer was turned down.
        let own = Some(self.data.sources.borrow()[which].clone())
            .filter(|it| it.object != 0 && self.keyboard.focus.get().is_none());
        let deadline = Instant::now() + Duration::from_secs(10);
        formats::gather(part, |name| match &own {
            Some(own) => own
                .contents
                .iter()
                .find(|it| it.0 == name)
                .map(|it| it.1.to_vec()),
            None => self.receive(self.data.offers[which].get(), [1, 0][which], name, deadline),
        })
    }

    pub fn write_clipboard(&self, from: Clipboard, is_selection: bool) -> Result<()> {
        let (which, contents) = (usize::from(is_selection), formats::offer(from)?);
        // The same serial does not take the place of a source.
        self.wire
            .destroy(self.data.sources.borrow()[which].object, 1);
        let source = if contents.is_empty() {
            Source::default()
        } else {
            self.new_source(is_selection, contents)
        };
        self.wire.send(
            self.data.devices.get()[which],
            [1, 0][which],
            &[source.object, self.serial.get()],
        );
        self.data.sources.borrow_mut()[which] = source;
        self.data.was_pasted.set(false);
        Ok(())
    }

    /// A manager of the clipboard asks for everything as soon as it is copied.
    pub fn hand_over_clipboard(&'static self) {
        let until = Instant::now() + Duration::from_millis(100);
        let is_request = |it: &Event| it.kind == Kind::DataSource;
        while self.data.sources.borrow()[0].object != 0 && !self.data.was_pasted.take() {
            if !self
                .wire
                .wait_for(until.saturating_duration_since(Instant::now()), is_request)
            {
                return;
            }
            self.handle(is_request);
        }
    }

    pub fn offer_event(&self, event: &Event) {
        if event.opcode == 0 {
            self.data
                .types
                .borrow_mut()
                .entry(event.object)
                .or_default()
                .push(event.text(0).0);
        }
    }

    pub fn source_event(&self, mut event: Event) {
        let is_dragged = self
            .data
            .own_drag
            .borrow()
            .as_ref()
            .is_some_and(|it| it.source.object == event.object);
        match (event.file.take(), event.kind, event.opcode) {
            (Some(file), ..) => {
                let (name, sources, drag) = (
                    event.text(0).0,
                    self.data.sources.borrow(),
                    self.data.own_drag.borrow(),
                );
                let source = sources
                    .iter()
                    .chain(drag.iter().map(|it| &it.source))
                    .find(|it| it.object == event.object);
                let contents = source.and_then(|it| it.contents.iter().find(|it| it.0 == name));
                write_out(file, contents.map(|it| it.1.clone()).unwrap_or_default());
                self.data.was_pasted.set(true);
            }
            (_, Kind::DataSource, 2 | 4) if is_dragged => self.end_drag(ELSEWHERE),
            (_, Kind::DataSource, 2) | (_, Kind::PrimarySource, 1) => {
                self.data
                    .sources
                    .borrow_mut()
                    .iter_mut()
                    .filter(|it| it.object == event.object)
                    .for_each(|it| *it = Source::default());
                self.wire.destroy(event.object, 1);
            }
            _ => {}
        }
    }

    pub fn device_event(&self, event: &Event) {
        match (event.kind, event.opcode) {
            (_, 0) => drop(self.data.types.borrow_mut().remove(&event.u32(0))),
            (Kind::PrimaryDevice, _) => {
                self.forget_offer(self.data.offers[1].replace(event.u32(0)), 1)
            }
            (_, 1) => self.drag_entered(event),
            (_, 2) => self.drag_left(),
            (_, 3) => self.drag_moved(Point {
                x: event.fixed(1),
                y: event.fixed(2),
            }),
            (_, 4) => self.dropped(),
            _ => self.forget_offer(self.data.offers[0].replace(event.u32(0)), 2),
        }
    }

    // ───────────────────────────── dragging ─────────────────────────────

    pub fn is_dragging(&self) -> bool {
        self.data.own_drag.borrow().is_some()
    }

    fn drag_icon(&self, image: &Pixmap, dragged: &Dragged) -> Option<[u32; 3]> {
        let (wire, area) = (&self.wire, dragged.area);
        let bgra = image
            .data()
            .as_chunks()
            .0
            .iter()
            .map(|&[r, g, b, a]| [b, g, r, a]);
        let buffer = pixels::picture(
            wire,
            self.global(Global::Memory),
            (image.width(), image.height()),
            bgra,
        )?;
        let surface = wire.create(Kind::Silent, 0, self.global(Global::Compositor), 0, &[]);
        let viewport = wire.create(
            Kind::Silent,
            0,
            self.global(Global::Viewports),
            1,
            &[surface],
        );
        wire.send(
            viewport,
            2,
            &[area.width, area.height].map(|it| it.round().max(1.) as u32),
        );
        let [x, y] = [area.x, area.y].map(|it| it.round() as i32 as u32);
        match self.version(Global::Compositor) {
            ..5 => wire.send(surface, 1, &[buffer, x, y]),
            _ => {
                wire.send(surface, 1, &[buffer, 0, 0]);
                wire.send(surface, 10, &[x, y]);
            }
        }
        wire.send(surface, 9, &[0, 0, image.width(), image.height()]);
        Some([surface, viewport, buffer])
    }

    pub fn begin_drag(&self, window: &Window, dragged: &Dragged, image: Option<&Pixmap>) {
        let device = self.data.devices.get()[0];
        if device == 0 || self.pointer.buttons.get() & 1 == 0 || self.is_dragging() {
            return;
        }
        let [text, html] =
            [&dragged.text, &dragged.html].map(|it| it.unless_empty().map(Into::into).into());
        let mut contents = formats::offer(Clipboard {
            text,
            html,
            ..Clipboard::default()
        })
        .unwrap_or_default();
        contents.extend(
            dragged
                .url
                .unless_empty()
                .map(|url| (URI_LIST, format!("{url}\r\n").into_bytes().into())),
        );
        contents.retain(|_| dragged.copies || dragged.links);
        contents.push((DRAGGED_BY_PAGE, Default::default()));
        let source = self.new_source(false, contents);
        let icon = image
            .and_then(|it| self.drag_icon(it, dragged))
            .unwrap_or_default();
        self.wire.send(source.object, 2, &[COPY]);
        self.wire.send(
            device,
            0,
            &[
                source.object,
                window.surface,
                icon[0],
                self.pointer.press.get(),
            ],
        );
        self.wire.send(icon[0], 6, &[]);
        self.data.own_drag.replace(Some(OwnDrag {
            source,
            window: window.id,
            icon,
        }));
    }

    fn end_drag(&self, at: Point) {
        let Some(OwnDrag {
            source,
            window,
            icon: [surface, viewport, buffer],
        }) = self.data.own_drag.take()
        else {
            return;
        };
        self.wire.destroy(source.object, 1);
        [viewport, surface, buffer]
            .into_iter()
            .for_each(|it| self.wire.destroy(it, 0));
        self.release(window, at, 0);
    }

    /// The window that the drag has begun in, if it is over that.
    fn at_home(&self) -> Option<(Visit, std::rc::Rc<Window>)> {
        let visit = self.data.visit.get().filter(|it| {
            self.data
                .own_drag
                .borrow()
                .as_ref()
                .is_some_and(|own| own.window == it.window)
        })?;
        Some((visit, self.window(visit.window)?))
    }

    fn answer(&self, visit: Visit, accepted: Option<&str>) {
        match accepted {
            Some(name) => self
                .wire
                .send_text(visit.offer, 0, &[visit.serial], name, &[]),
            None => self.wire.send(visit.offer, 0, &[visit.serial, 0]),
        }
        self.wire.send(
            visit.offer,
            4,
            &[if accepted.is_some() { COPY } else { 0 }; 2],
        );
        self.data.visit.set(Some(Visit {
            is_accepted: accepted.is_some(),
            ..visit
        }));
    }

    /// The cursor says what the page would do.
    pub fn answer_own_drag(&self) {
        if let Some((visit, window)) = self.at_home() {
            let accepts = matches!(
                window.cursor.get(),
                Cursor::DragCopy | Cursor::DragLink | Cursor::ClosedHand
            );
            self.answer(visit, accepts.then_some(DRAGGED_BY_PAGE));
        }
    }

    fn drag_at_home(&self, window: u32, at: Point) {
        input::handle(
            window,
            Input::MouseMove {
                at,
                is_pressed: true,
                modifiers: self.keyboard.modifiers(),
            },
        );
    }

    fn drag_entered(&self, event: &Event) {
        self.drag_left();
        let (at, offer) = (
            Point {
                x: event.fixed(2),
                y: event.fixed(3),
            },
            event.u32(4),
        );
        let Some(window) = self.window_of(event.u32(1)) else {
            return self.forget_offer(offer, 2);
        };
        let visit = Visit {
            offer,
            serial: event.u32(0),
            window: window.id,
            is_accepted: false,
        };
        self.data.visit.set(Some(visit));
        self.pointer_is_at(&window, at);
        if self.at_home().is_some() {
            self.answer_own_drag();
            return self.drag_at_home(window.id, at);
        }
        let list = || self.receive(offer, 1, URI_LIST, Instant::now() + Duration::from_secs(1));
        let paths = if self.is_dragging() {
            Vec::new()
        } else {
            paths_in(&list().unwrap_or_default())
        };
        self.answer(visit, (!paths.is_empty()).then_some(URI_LIST));
        if !paths.is_empty() {
            input::handle(window.id, Input::DragEnter { at, paths });
        }
    }

    fn drag_moved(&self, at: Point) {
        let Some((visit, window)) = self
            .data
            .visit
            .get()
            .and_then(|it| Some((it, self.window(it.window)?)))
        else {
            return;
        };
        self.pointer_is_at(&window, at);
        if self.at_home().is_some() {
            self.drag_at_home(window.id, at);
        } else if visit.is_accepted {
            input::handle(window.id, Input::DragOver { at });
        }
    }

    fn drag_left(&self) {
        let is_at_home = self.at_home().is_some();
        let Some(visit) = self.data.visit.take() else {
            return;
        };
        self.forget_offer(visit.offer, 2);
        if is_at_home {
            self.drag_at_home(visit.window, ELSEWHERE);
        } else if visit.is_accepted {
            input::handle(visit.window, Input::DragLeave);
        }
    }

    fn dropped(&self) {
        let is_at_home = self.at_home().is_some();
        let Some(visit) = self.data.visit.take() else {
            return;
        };
        let at = self
            .window(visit.window)
            .map_or(ELSEWHERE, |it| it.pointer.get());
        if visit.is_accepted {
            self.wire.send(visit.offer, 3, &[]);
        }
        self.forget_offer(visit.offer, 2);
        if is_at_home {
            self.end_drag(at);
        } else if visit.is_accepted {
            input::handle(visit.window, Input::Drop { at });
        }
    }
}
