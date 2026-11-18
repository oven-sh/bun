//! https://specifications.freedesktop.org/wm-spec/latest/

use std::cell::{Cell, RefCell};
use std::rc::Rc;
use std::time::{Duration, Instant};

use super::atom::{self, Name};
use super::pixels::{Presenter, Target};
use super::wire::{Bytes as _, Request};
use super::{X11, event, mask};
use crate::error::{Context as _, Result};
use crate::host;
use crate::paint::raster::IntRect;
use crate::platform::{self, Cursor, Edge, Geometry, Icon, Painter, Point};
use crate::protocol::{Background, WindowCommand, WindowKind};
use crate::window::{self, Options};

#[derive(Clone, Copy)]
struct Limits {
    min: (f32, f32),
    max: Option<(f32, f32)>,
    is_resizable: bool,
}

pub struct Window {
    x11: &'static X11,
    pub id: u32,
    pub xid: u32,
    colormap: Option<u32>,
    is_client_decorated: bool,
    is_managed: bool,
    /// The left, the top, the width and the height of the content, in pixels of the screen.
    pub area: Cell<[i32; 4]>,
    /// Instead of what is in `area`, and when.
    asked: Cell<([Option<i32>; 4], Instant)>,
    aspect_ratio: Cell<f32>,
    limits: Cell<Limits>,
    /// `_NET_WM_STATE`, which the window manager forgets while the window is withdrawn.
    state: RefCell<Vec<u32>>,
    is_withdrawn: Cell<bool>,
    is_unmapped: Cell<bool>,
    is_covered: Cell<bool>,
    was_visible: Cell<bool>,
    takes_focus: Cell<bool>,
    pub is_active: Cell<bool>,
    pub pointer: Cell<Point>,
    cursor: Cell<Option<Cursor>>,
    presenter: RefCell<Option<Presenter>>,
    has_pixels: Cell<bool>,
    wants_frame: Cell<bool>,
    last_frame: Cell<Option<Instant>>,
    counter: Option<u32>,
    /// What the window manager waits for the counter to become, and whether the new size is known.
    awaited_count: Cell<Option<([u32; 2], bool)>>,
}

impl Window {
    pub fn open(x11: &'static X11, options: &Options, icon: Option<&Icon>) -> Result<Rc<Window>> {
        const BORDER_GRAVITY_REDIRECT_EVENTS_COLORMAP: u32 = 0x8 | 0x10 | 0x200 | 0x800 | 0x2000;
        const NORTH_WEST: u32 = 1;
        let (x, scale) = (&x11.x, x11.scale.get());
        let area = [
            options.x.get().unwrap_or(0.),
            options.y.get().unwrap_or(0.),
            options.width,
            options.height,
        ];
        let [left, top, width, height] = area.map(|it| (it * scale).round() as i32);
        let [width, height] = [width, height].map(|it| it.clamp(1, 16384));
        let with_alpha = x
            .screen
            .visual_with_alpha
            .filter(|_| options.background != Background::Opaque);
        let (depth, visual) =
            with_alpha.map_or((x.screen.depth, x.screen.visual), |visual| (32, visual));
        let (xid, colormap) = (x.new_id(), (depth == 32).then(|| x.new_id()));
        if let Some(colormap) = colormap {
            x.send(Request::new(78, 0).words(&[colormap, x.screen.root, visual]));
        }
        let is_managed = options.kind != WindowKind::Popup;
        let events = mask::KEYS
            | mask::EXPOSURE
            | mask::VISIBILITY
            | mask::STRUCTURE
            | mask::FOCUS
            | mask::PROPERTY;
        let create = Request::new(1, depth)
            .words(&[xid, x.screen.root])
            .i16(left)
            .i16(top)
            .i16(width)
            .i16(height);
        let values = [
            0,
            NORTH_WEST,
            (!is_managed).into(),
            events,
            colormap.unwrap_or(0),
        ];
        x.check(
            create
                .u16(0)
                .u16(1)
                .words(&[visual, BORDER_GRAVITY_REDIRECT_EVENTS_COLORMAP])
                .words(&values),
        )?;
        let presenter = Presenter::new(xid, depth, host::thread::exists())?;
        x.send(
            Request::new(x11.xinput.opcode, 46)
                .u32(xid)
                .u16(1)
                .u16(0)
                .u16(1)
                .u16(1)
                .u32(x11.pointer_events),
        );

        let counter = x11.sync.map(|sync| {
            let counter = x.new_id();
            x.send(Request::new(sync.opcode, 2).words(&[counter, 0, 0]));
            x.set_words(
                xid,
                x11.atom(atom::_NET_WM_SYNC_REQUEST_COUNTER),
                atom::CARDINAL,
                &[counter],
            );
            counter
        });
        let protocols = [
            atom::WM_DELETE_WINDOW,
            atom::_NET_WM_PING,
            atom::_NET_WM_SYNC_REQUEST,
        ]
        .map(|it| x11.atom(it));
        x.set_words(
            xid,
            x11.atom(atom::WM_PROTOCOLS),
            atom::ATOM,
            &protocols[..2 + usize::from(counter.is_some())],
        );
        x.set_words(
            xid,
            atom::WM_HINTS,
            atom::WM_HINTS,
            &[3, 1, 1, 0, 0, 0, 0, 0, 0],
        );
        x.set_words(
            xid,
            x11.atom(atom::_NET_WM_PID),
            atom::CARDINAL,
            &[std::process::id()],
        );
        x.set_bytes(xid, atom::WM_CLIENT_MACHINE, atom::STRING, &x.host_name);
        x.set_words(xid, x11.atom(atom::XdndAware), atom::ATOM, &[5]);
        if let Some(id) = options.app_id.unless_empty() {
            x.set_bytes(
                xid,
                atom::WM_CLASS,
                atom::STRING,
                format!("{id}\0{id}\0").as_bytes(),
            );
        }
        let kind = match options.kind {
            WindowKind::Popup => atom::_NET_WM_WINDOW_TYPE_NOTIFICATION,
            WindowKind::Dialog => atom::_NET_WM_WINDOW_TYPE_DIALOG,
            _ => atom::_NET_WM_WINDOW_TYPE_NORMAL,
        };
        x.set_words(
            xid,
            x11.atom(atom::_NET_WM_WINDOW_TYPE),
            atom::ATOM,
            &[x11.atom(kind)],
        );
        let parent = x11
            .active_window()
            .filter(|_| matches!(options.kind, WindowKind::Floating | WindowKind::Dialog));
        if let Some(parent) = &parent {
            x.set_words(xid, atom::WM_TRANSIENT_FOR, atom::WINDOW, &[parent.xid]);
        }
        let is_client_decorated = !options.frame || options.hidden_title_bar;
        let motif = x11.atom(atom::_MOTIF_WM_HINTS);
        x.set_words(
            xid,
            motif,
            motif,
            &[2, 0, (!is_client_decorated).into(), 0, 0],
        );
        let state = [
            (atom::_NET_WM_STATE_MAXIMIZED_HORZ, options.maximized),
            (atom::_NET_WM_STATE_MAXIMIZED_VERT, options.maximized),
            (atom::_NET_WM_STATE_FULLSCREEN, options.fullscreen),
            (
                atom::_NET_WM_STATE_MODAL,
                options.kind == WindowKind::Dialog && parent.is_some(),
            ),
        ];
        let window = Rc::new(Window {
            x11,
            id: options.id,
            xid,
            colormap,
            is_client_decorated,
            is_managed,
            area: [left, top, width, height].into(),
            asked: ([None; 4], Instant::now()).into(),
            aspect_ratio: Cell::default(),
            limits: Limits {
                min: (options.min_width, options.min_height),
                max: None,
                is_resizable: options.resizable,
            }
            .into(),
            state: state
                .into_iter()
                .filter(|it| it.1)
                .map(|it| x11.atom(it.0))
                .collect::<Vec<_>>()
                .into(),
            is_withdrawn: true.into(),
            is_unmapped: false.into(),
            is_covered: false.into(),
            was_visible: false.into(),
            takes_focus: false.into(),
            is_active: false.into(),
            pointer: Cell::default(),
            cursor: None.into(),
            presenter: Some(presenter).into(),
            has_pixels: false.into(),
            wants_frame: false.into(),
            last_frame: None.into(),
            counter,
            awaited_count: None.into(),
        });
        icon.into_iter()
            .for_each(|it| window.set_icon(it.width, it.height, &it.pixels));
        window.set_title(&options.title);
        window.set_dark(crate::app::is_dark());
        Ok(window)
    }

    fn set_icon(&self, width: u32, height: u32, rgba: &[u8]) {
        let argb = rgba
            .as_chunks()
            .0
            .iter()
            .map(|&[r, g, b, a]| u32::from_be_bytes([a, r, g, b]));
        let words: Vec<_> = [width, height].into_iter().chain(argb).collect();
        self.x11.x.set_words(
            self.xid,
            self.x11.atom(atom::_NET_WM_ICON),
            atom::CARDINAL,
            &words,
        );
    }

    fn set_title(&self, title: &str) {
        let (x, utf8) = (&self.x11.x, self.x11.atom(atom::UTF8_STRING));
        x.set_bytes(self.xid, atom::WM_NAME, utf8, title.as_bytes());
        x.set_bytes(
            self.xid,
            self.x11.atom(atom::_NET_WM_NAME),
            utf8,
            title.as_bytes(),
        );
    }

    pub fn set_dark(&self, is_dark: bool) {
        let (variant, utf8) = (
            self.x11.atom(atom::_GTK_THEME_VARIANT),
            self.x11.atom(atom::UTF8_STRING),
        );
        self.x11.x.set_bytes(
            self.xid,
            variant,
            utf8,
            if is_dark { b"dark" } else { b"light" },
        );
    }

    fn set_size_hints(&self, [left, top, width, height]: [i32; 4]) {
        const POSITION_MIN_GRAVITY: u32 = 1 | 16 | 512;
        const MAX: u32 = 32;
        const STATIC: u32 = 10;
        let (limits, scale) = (self.limits.get(), self.x11.scale.get());
        let device =
            |(width, height): (f32, f32)| [(width * scale) as u32, (height * scale) as u32];
        let fixed = (!limits.is_resizable).then_some([width as u32, height as u32]);
        let (min, max) = (
            fixed.unwrap_or(device(limits.min)),
            fixed.or(limits.max.map(device)),
        );
        let mut hints = [0; 18];
        hints[..3].copy_from_slice(&[
            POSITION_MIN_GRAVITY | max.map_or(0, |_| MAX),
            left as u32,
            top as u32,
        ]);
        hints[5..9].copy_from_slice([min, max.unwrap_or_default()].as_flattened());
        if self.aspect_ratio.get() > 0. {
            hints[0] |= 128;
            hints[11..15].copy_from_slice(
                [[(self.aspect_ratio.get() * 10_000.) as u32, 10_000]; 2].as_flattened(),
            );
        }
        hints[17] = STATIC;
        self.x11
            .x
            .set_words(self.xid, atom::WM_NORMAL_HINTS, atom::WM_SIZE_HINTS, &hints);
    }

    fn tell_manager(&self, kind: Name, data: [u32; 5]) {
        let x = &self.x11.x;
        x.send_message(
            x.screen.root,
            mask::FOR_MANAGER,
            self.xid,
            self.x11.atom(kind),
            data,
        );
    }

    fn has_state(&self, name: Name) -> bool {
        self.state.borrow().contains(&self.x11.atom(name))
    }

    fn set_state(&self, names: &[Name], on: bool) {
        let atom = |index: usize| names.get(index).map_or(0, |name| self.x11.atom(*name));
        if !self.is_withdrawn.get() {
            return self.tell_manager(atom::_NET_WM_STATE, [on.into(), atom(0), atom(1), 1, 0]);
        }
        self.state
            .borrow_mut()
            .retain(|it| ![atom(0), atom(1)].contains(it));
        self.state
            .borrow_mut()
            .extend((0..names.len()).filter(|_| on).map(atom));
        window::bounds_changed(self.id);
    }

    fn set_maximized(&self, on: bool) {
        self.set_state(
            &[
                atom::_NET_WM_STATE_MAXIMIZED_HORZ,
                atom::_NET_WM_STATE_MAXIMIZED_VERT,
            ],
            on,
        );
    }

    /// The window manager may refuse.
    fn unanswered(&self) -> [Option<i32>; 4] {
        Some(self.asked.get())
            .filter(|it| it.1.elapsed() < Duration::from_millis(250))
            .map_or([None; 4], |it| it.0)
    }

    fn area_soon(&self) -> [i32; 4] {
        std::array::from_fn(|it| self.unanswered()[it].unwrap_or(self.area.get()[it]))
    }

    fn configure(&self, first: usize, values: (f32, f32)) {
        let (scale, mut area) = (self.x11.scale.get(), self.area_soon());
        area[first..first + 2].copy_from_slice(&[
            (values.0 * scale).round() as i32,
            (values.1 * scale).round() as i32,
        ]);
        (area[2], area[3]) = (area[2].clamp(1, 16384), area[3].clamp(1, 16384));
        self.set_size_hints(area);
        let request = Request::new(12, 0).u32(self.xid).u16(3 << first).u16(0);
        self.x11
            .x
            .send(request.words(&[area[first] as u32, area[first + 1] as u32]));
        // Nobody has a say in it.
        if self.is_withdrawn.get() {
            self.area.set(area);
            window::bounds_changed(self.id);
        }
        let mut asked = self.unanswered();
        asked[first..first + 2].copy_from_slice(&[Some(area[first]), Some(area[first + 1])]);
        self.asked.set((asked, Instant::now()));
    }

    fn activate(&self) {
        const ABOVE: u32 = 0;
        let x = &self.x11.x;
        if self.is_managed && self.x11.manager_supports(atom::_NET_ACTIVE_WINDOW) {
            let active = self.x11.active_window().map_or(0, |it| it.xid);
            return self.tell_manager(
                atom::_NET_ACTIVE_WINDOW,
                [1, self.x11.time.get(), active, 0, 0],
            );
        }
        x.send(
            Request::new(12, 0)
                .u32(self.xid)
                .u16(0x40)
                .u16(0)
                .u32(ABOVE),
        );
        x.send(Request::new(42, 1).words(&[self.xid, 0]));
    }

    fn pointer_on_screen(&self, at: Point) -> [u32; 2] {
        let ([left, top, ..], scale) = (self.area.get(), self.x11.scale.get());
        [
            (left + (at.x * scale) as i32) as u32,
            (top + (at.y * scale) as i32) as u32,
        ]
    }

    fn move_or_resize(&self, direction: u32) {
        let [x, y] = self.pointer_on_screen(self.pointer.get());
        self.x11.x.send(Request::new(27, 0).u32(0));
        self.tell_manager(atom::_NET_WM_MOVERESIZE, [x, y, direction, 1, 1]);
    }

    fn with_pixels(&self, job: impl FnOnce(&mut Target) + Send + 'static) {
        if let Some(presenter) = &mut *self.presenter.borrow_mut() {
            presenter.run(job);
        }
    }

    fn visibility_may_have_changed(&self) {
        let is_visible = platform::Window::is_visible(self);
        if self.was_visible.replace(is_visible) != is_visible {
            if !is_visible && self.has_pixels.take() {
                self.with_pixels(Target::release);
            }
            window::visibility_changed(self.id);
        }
    }

    fn set_counter(&self, count: [u32; 2]) -> Option<Request> {
        Some(
            Request::new(self.x11.sync?.opcode, 3)
                .u32(self.counter?)
                .words(&count),
        )
    }

    fn interval(&self) -> Duration {
        platform::Window::refresh_interval(self).unwrap_or(Duration::from_micros(16_667))
    }

    pub fn next_frame(&self, now: Instant) -> Option<Instant> {
        let is_free = || {
            !self
                .presenter
                .borrow()
                .as_ref()
                .is_none_or(|it| it.is_busy(true))
        };
        (self.wants_frame.get() && is_free())
            .then(|| self.last_frame.get().map_or(now, |it| it + self.interval()))
    }

    pub fn begin_frame_if_due(&self, now: Instant) {
        if let Some(due) = self.next_frame(now).filter(|it| *it <= now) {
            self.wants_frame.set(false);
            self.last_frame
                .set(Some(if now - due < self.interval() / 2 {
                    due
                } else {
                    now
                }));
            window::frame_is_due(self.id);
        }
    }

    pub fn configured(&self, event: &[u8]) {
        let mut origin = (event.i16(16), event.i16(18));
        // Unless the window manager sent it, the position is in the frame.
        if event[0] & 0x80 == 0 && self.is_managed && !self.is_withdrawn.get() {
            let translate = Request::new(40, 0).words(&[self.xid, self.x11.x.screen.root, 0]);
            let Ok(reply) = self.x11.x.call(translate) else {
                return;
            };
            origin = (reply.i16(12), reply.i16(14));
        }
        let area = [
            origin.0.into(),
            origin.1.into(),
            event.u16(20).into(),
            event.u16(22).into(),
        ];
        let is_resized = self.area.replace(area)[2..] != area[2..];
        self.asked.update(|(asked, at)| {
            (
                std::array::from_fn(|it| asked[it].filter(|asked| *asked != area[it])),
                at,
            )
        });
        if let Some((count, false)) = self.awaited_count.get() {
            self.awaited_count.set(is_resized.then_some((count, true)));
            self.set_counter(count)
                .filter(|_| !is_resized)
                .into_iter()
                .for_each(|it| self.x11.x.send(it));
        }
        window::bounds_changed(self.id);
    }

    pub fn event(&self, event: &[u8]) {
        match event[0] & 0x7f {
            event::EXPOSE => {
                let [left, top, width, height] = [8, 10, 12, 14].map(|at| i32::from(event.u16(at)));
                self.with_pixels(move |it| {
                    it.expose(IntRect::new(left, top, left + width, top + height))
                });
                if !self.has_pixels.get() {
                    window::refresh(self.id);
                }
            }
            event::VISIBILITY => {
                self.is_covered.set(event[8] == 2);
                // Before the first exposure, so that what can be seen gets the keys. The window manager takes longer.
                if self.takes_focus.take() {
                    self.x11
                        .x
                        .check(Request::new(42, 1).words(&[self.xid, 0]))
                        .ok();
                    self.activate();
                }
            }
            event::UNMAP => self.is_unmapped.set(true),
            event::MAP => {
                self.is_unmapped.set(false);
                self.x11.x.send(Request::new(2, 0).words(&[self.xid, 1, 0]));
            }
            event::PROPERTY
                if event.u32(8) == self.x11.atom(atom::_NET_WM_STATE)
                    && !self.is_withdrawn.get() =>
            {
                self.state.replace(self.x11.x.words(self.xid, event.u32(8)));
                window::bounds_changed(self.id);
            }
            _ => return,
        }
        self.visibility_may_have_changed();
    }

    pub fn protocol_message(&self, data: &[u8]) {
        let (x, is) = (&self.x11.x, |name| data.u32(0) == self.x11.atom(name));
        if is(atom::WM_DELETE_WINDOW) {
            window::close_requested(self.id);
        } else if is(atom::_NET_WM_SYNC_REQUEST) {
            self.awaited_count
                .set(Some(([data.u32(12), data.u32(8)], false)));
        } else if is(atom::_NET_WM_PING) {
            let (root, data) = (x.screen.root, [0, 4, 8, 12, 16].map(|at| data.u32(at)));
            x.send_message(
                root,
                mask::FOR_MANAGER,
                root,
                self.x11.atom(atom::WM_PROTOCOLS),
                data,
            );
        }
    }

    pub fn scale_limits(&self) {
        self.set_size_hints(self.area_soon());
    }

    pub fn reload_cursor(&self) {
        self.cursor
            .take()
            .into_iter()
            .for_each(|it| platform::Window::set_cursor(self, it));
    }
}

impl platform::Window for Window {
    fn geometry(&self) -> Geometry {
        let scale = self.x11.scale.get();
        let [x, y, width, height] = self.area.get().map(|it| it as f32 / scale);
        Geometry {
            x,
            y,
            top: 0.,
            border: 0.,
            width,
            height,
            scale,
            is_maximized: self.has_state(atom::_NET_WM_STATE_MAXIMIZED_HORZ)
                && self.has_state(atom::_NET_WM_STATE_MAXIMIZED_VERT),
            is_fullscreen: self.has_state(atom::_NET_WM_STATE_FULLSCREEN),
            is_client_decorated: self.is_client_decorated,
        }
    }

    fn geometry_soon(&self) -> Geometry {
        let [x, y, width, height] = self.area_soon().map(|it| it as f32 / self.x11.scale.get());
        Geometry {
            x,
            y,
            width,
            height,
            ..self.geometry()
        }
    }

    fn is_active(&self) -> bool {
        self.is_active.get()
    }

    fn is_visible(&self) -> bool {
        let is_away = self.is_withdrawn.get() || self.is_unmapped.get() || self.is_covered.get();
        !is_away && !self.has_state(atom::_NET_WM_STATE_HIDDEN)
    }

    fn refresh_interval(&self) -> Option<Duration> {
        let Geometry {
            x,
            y,
            width,
            height,
            ..
        } = self.geometry();
        let frequency = self.x11.frequency_at(x + width / 2., y + height / 2.);
        (frequency > 0.).then(|| Duration::from_secs_f32(1. / frequency))
    }

    fn mouse_position(&self) -> Point {
        self.pointer.get()
    }

    fn set_visible(&self, is_visible: bool, takes_focus: bool) {
        let x = &self.x11.x;
        if self.is_withdrawn.replace(!is_visible) != is_visible {
            (is_visible && takes_focus).then(|| self.activate());
        } else if is_visible {
            x.set_words(
                self.xid,
                self.x11.atom(atom::_NET_WM_STATE),
                atom::ATOM,
                &self.state.borrow(),
            );
            self.set_size_hints(self.area_soon());
            match takes_focus {
                true => x.delete_property(self.xid, self.x11.atom(atom::_NET_WM_USER_TIME)),
                false => x.set_words(
                    self.xid,
                    self.x11.atom(atom::_NET_WM_USER_TIME),
                    atom::CARDINAL,
                    &[0],
                ),
            }
            self.takes_focus.set(takes_focus);
            self.is_unmapped.set(false);
            self.is_covered.set(false);
            x.sync();
            self.with_pixels(move |it| it.map(takes_focus));
        } else {
            let transient = [atom::_NET_WM_STATE_HIDDEN, atom::_NET_WM_STATE_FOCUSED]
                .map(|it| self.x11.atom(it));
            self.state.borrow_mut().retain(|it| !transient.contains(it));
            self.with_pixels(Target::unmap);
        }
    }

    fn close(&self) {
        let x = &self.x11.x;
        self.x11.forget(self);
        self.presenter.take().inspect(Presenter::wait);
        x.send(Request::new(4, 0).u32(self.xid));
        self.colormap
            .into_iter()
            .for_each(|it| x.send(Request::new(79, 0).u32(it)));
        self.x11
            .sync
            .zip(self.counter)
            .into_iter()
            .for_each(|it| x.send(Request::new(it.0.opcode, 6).u32(it.1)));
        x.flush();
    }

    fn request_frame(&self) {
        self.wants_frame.set(true);
    }

    fn can_present(&self) -> Option<bool> {
        Some(!self.presenter.borrow().as_ref()?.is_busy(false))
    }

    fn present(&self, paint: Painter) {
        let count = self
            .awaited_count
            .get()
            .filter(|it| it.1)
            .and_then(|it| self.set_counter(it.0));
        if count.is_some() {
            self.awaited_count.set(None);
        }
        if let Some(presenter) = &mut *self.presenter.borrow_mut() {
            self.has_pixels.set(true);
            presenter.draw(paint, (self.area.get()[2], self.area.get()[3]), count);
        }
    }

    fn set_cursor(&self, cursor: Cursor) {
        if self.cursor.replace(Some(cursor)) != Some(cursor) {
            self.x11
                .x
                .send(Request::new(2, 0).words(&[self.xid, 0x4000, self.x11.cursor(cursor)]));
        }
    }

    fn text_input_changed(&self) {
        self.x11.text_input_changed.set(true);
    }

    fn start_move(&self) {
        self.move_or_resize(8);
    }

    fn start_resize(&self, edge: Edge) {
        // They go around in the same order, from the top left.
        self.move_or_resize((edge as u32 + 1) % 8);
    }

    fn show_window_menu(&self, at: Point) {
        let [x, y] = self.pointer_on_screen(at);
        self.x11.x.send(Request::new(27, 0).u32(0));
        self.tell_manager(atom::_GTK_SHOW_WINDOW_MENU, [2, x, y, 0, 0]);
    }

    fn title_was_double_clicked(&self) {
        if self.limits.get().is_resizable {
            self.set_maximized(!self.geometry().is_maximized);
        }
    }

    fn is_minimized(&self) -> bool {
        self.has_state(atom::_NET_WM_STATE_HIDDEN)
    }

    fn command(&self, command: &WindowCommand) -> Result<()> {
        let x = &self.x11.x;
        match *command {
            WindowCommand::Title(ref title) => self.set_title(title),
            WindowCommand::Position(at) => self.configure(0, (at.x, at.y)),
            WindowCommand::Size(size) => self.configure(2, (size.width, size.height)),
            WindowCommand::Limits(limits) => {
                let (min, max) = (
                    (limits.min.width, limits.min.height),
                    limits.max.get().map(|it| (it.width, it.height)),
                );
                self.limits.set(Limits {
                    min,
                    max,
                    is_resizable: limits.is_resizable,
                });
                self.set_size_hints(self.area_soon());
            }
            WindowCommand::Focus | WindowCommand::MoveTop | WindowCommand::Restore
                if !self.is_withdrawn.get() =>
            {
                self.activate()
            }
            WindowCommand::Minimize => self.tell_manager(atom::WM_CHANGE_STATE, [3, 0, 0, 0, 0]),
            WindowCommand::Maximize(on) => self.set_maximized(on),
            WindowCommand::Fullscreen(on) | WindowCommand::SimpleFullscreen(on) => {
                self.set_state(&[atom::_NET_WM_STATE_FULLSCREEN], on)
            }
            WindowCommand::AlwaysOnTop(on) => self.set_state(&[atom::_NET_WM_STATE_ABOVE], on),
            WindowCommand::SkipTaskbar(on) => {
                self.set_state(&[atom::_NET_WM_STATE_SKIP_TASKBAR], on)
            }
            WindowCommand::AllWorkspaces(on) => self.set_state(&[atom::_NET_WM_STATE_STICKY], on),
            WindowCommand::Attention(on) => self.set_state(
                &[atom::_NET_WM_STATE_DEMANDS_ATTENTION],
                on && !self.is_active.get(),
            ),
            WindowCommand::Blur => x.send(Request::new(12, 0).words(&[self.xid, 0x40, 1])),
            WindowCommand::AspectRatio { ratio, .. } => {
                self.aspect_ratio.set(ratio);
                self.set_size_hints(self.area_soon());
            }
            WindowCommand::Opacity(opacity) => {
                let opacity = f64::from(opacity).clamp(0., 1.) * f64::from(u32::MAX);
                x.set_words(
                    self.xid,
                    self.x11.atom(atom::_NET_WM_WINDOW_OPACITY),
                    atom::CARDINAL,
                    &[opacity as u32],
                );
            }
            WindowCommand::IgnoreMouseEvents(on) => {
                const INPUT: [u8; 4] = [0, 2, 0, 0];
                let shape = x
                    .extension(x.ask_for_extension("SHAPE"))
                    .context("the display does not have SHAPE")?;
                x.send(match on {
                    true => Request::new(shape.opcode, 1)
                        .bytes(&INPUT)
                        .words(&[self.xid, 0]),
                    false => Request::new(shape.opcode, 2)
                        .bytes(&INPUT)
                        .words(&[self.xid, 0, 0]),
                });
            }
            WindowCommand::Shape(ref parts) => {
                const BOUNDING: [u8; 4] = [0; 4];
                let shape = x
                    .extension(x.ask_for_extension("SHAPE"))
                    .context("the display does not have SHAPE")?;
                let sides = parts
                    .iter()
                    .take(16_000)
                    .flat_map(|it| [it.x, it.y, it.width.max(0.), it.height.max(0.)]);
                x.send(match parts.is_empty() {
                    true => Request::new(shape.opcode, 2)
                        .bytes(&BOUNDING)
                        .words(&[self.xid, 0, 0]),
                    false => sides.fold(
                        Request::new(shape.opcode, 1)
                            .bytes(&BOUNDING)
                            .words(&[self.xid, 0]),
                        |all, it| all.i16((it * self.x11.scale.get()).round() as i32),
                    ),
                });
            }
            WindowCommand::Icon(ref encoded) => {
                let icon = crate::images::decode_still(encoded)?;
                self.set_icon(icon.width, icon.height, &icon.data);
            }
            WindowCommand::Parent(parent) => match parent
                .get()
                .and_then(|id| self.x11.all_windows().into_iter().find(|it| it.id == id))
            {
                Some(parent) => x.set_words(
                    self.xid,
                    atom::WM_TRANSIENT_FOR,
                    atom::WINDOW,
                    &[parent.xid],
                ),
                None => x.delete_property(self.xid, atom::WM_TRANSIENT_FOR),
            },
            WindowCommand::Beep => x.send(Request::new(104, 0)),
            _ => {}
        }
        Ok(())
    }

    fn name_for_portals(&self) -> String {
        format!("x11:{:x}", self.xid)
    }

    fn handle(&self) -> u64 {
        self.xid.into()
    }
}
