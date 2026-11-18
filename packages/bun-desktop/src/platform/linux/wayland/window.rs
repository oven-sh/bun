//! https://wayland.app/protocols/xdg-shell

use std::cell::{Cell, RefCell};
use std::rc::Rc;
use std::time::{Duration, Instant};

use super::super::desktop;
use super::super::socket::Bytes as _;
use super::pixels::{self, Buffers};
use super::wire::{Event, Kind};
use super::{Global, Wayland};
use crate::abi::Rect;
use crate::diagnostics::{self, trace};
use crate::error::Result;
use crate::frame::TITLEBAR_HEIGHT;
use crate::gfx::Pixmap;
use crate::host;
use crate::paint::raster::IntRect;
use crate::platform::{self, Cursor, Display, Edge, Geometry, Icon, Painter, Point, Window as _};
use crate::protocol::{Background, Dragged, Limits, Maybe, Size, WindowCommand, WindowKind};
use crate::window::{self, Options};

const MAXIMIZED: u32 = 1 << 1;
const FULLSCREEN: u32 = 1 << 2;
const RESIZING: u32 = 1 << 3;
const ACTIVATED: u32 = 1 << 4;
const TILED: u32 = 0b1111 << 5;
const SUSPENDED: u32 = 1 << 9;

/// What makes a surface a window. It only exists while that is shown.
#[derive(Clone, Copy, Default)]
struct Role {
    object: u32,
    toplevel: u32,
    popup: u32,
    grabs: bool,
    decoration: u32,
    dialog: u32,
    exported: u32,
}

pub struct Window {
    wayland: &'static Wayland,
    pub id: u32,
    pub surface: u32,
    viewport: u32,
    fractions: u32,
    opacity: Cell<u32>,
    /// And its pixels.
    icon: Cell<(u32, u32)>,
    ignores_mouse: Cell<bool>,
    shape: RefCell<Vec<Rect>>,
    may_pop_up: Cell<bool>,
    has_popped_up: Cell<bool>,
    app_id: String,
    has_title_bar: bool,
    title: RefCell<String>,
    parent: Cell<Option<u32>>,
    is_modal: Cell<bool>,
    is_opaque: Cell<bool>,
    limits: Cell<Limits>,
    aspect_ratio: Cell<(f32, Size)>,
    role: Cell<Role>,
    name: RefCell<String>,
    /// On the screen, which only means something for a popup.
    position: Cell<Point>,
    size: Cell<(i32, i32)>,
    floating_size: Cell<(i32, i32)>,
    scale: Cell<f32>,
    is_told_scale: Cell<bool>,
    states: Cell<u32>,
    proposed: Cell<Option<((i32, i32), u32)>>,
    /// The serial of what the next picture answers.
    unanswered: Cell<Option<u32>>,
    is_configured: Cell<bool>,
    is_mapped: Cell<bool>,
    is_client_decorated: Cell<bool>,
    is_minimized: Cell<bool>,
    was_visible: Cell<bool>,
    outputs: RefCell<Vec<u32>>,
    pub pointer: Cell<Point>,
    pub cursor: Cell<Cursor>,
    buffers: RefCell<Buffers>,
    /// The size, the scale and whether it is opaque.
    committed: Cell<((i32, i32), f32, bool)>,
    commits: Cell<u32>,
    committed_at: Cell<Instant>,
    measured_interval: Cell<Option<Duration>>,
    wants_frame: Cell<bool>,
    last_frame: Cell<Option<Instant>>,
    /// Since when the compositor is expected to say that it is time for a frame, and whether it has.
    awaited_since: Cell<Option<Instant>>,
    is_invited: Cell<bool>,
}

fn whole(width: f32, height: f32) -> (i32, i32) {
    (
        (width.round() as i32).clamp(1, 16384),
        (height.round() as i32).clamp(1, 16384),
    )
}

fn square_icon(wayland: &Wayland, size: (u32, u32), pixels: &[u8]) -> Option<(u32, u32)> {
    let manager = Some(wayland.global(Global::Icons)).filter(|it| *it != 0 && size.0 == size.1)?;
    let premultiplied = |&[r, g, b, a]: &[u8; 4]| {
        [b, g, r, 255].map(|it| (u16::from(it) * u16::from(a) / 255) as u8)
    };
    let pixels = pixels.as_chunks().0.iter().map(premultiplied);
    let buffer = pixels::picture(&wayland.wire, wayland.global(Global::Memory), size, pixels)?;
    let object = wayland.wire.create(Kind::Silent, 0, manager, 1, &[]);
    wayland.wire.send(object, 2, &[buffer, 1]);
    Some((object, buffer))
}

impl Window {
    pub fn open(wayland: &'static Wayland, options: &Options, icon: Option<&Icon>) -> Rc<Window> {
        let (wire, id) = (&wayland.wire, options.id);
        let surface = wire.create(
            Kind::Surface,
            id,
            wayland.global(Global::Compositor),
            0,
            &[],
        );
        let fractions = if wayland.scales_by_fractions() {
            wayland.global(Global::Scales)
        } else {
            0
        };
        let has_title_bar =
            options.frame && !options.hidden_title_bar && options.kind != WindowKind::Popup;
        let active = wayland
            .keyboard
            .focus
            .get()
            .and_then(|it| wayland.window(it));
        let likely_scale = active.as_ref().map(|it| it.scale.get()).or(wayland
            .displays
            .borrow()
            .first()
            .map(|it| it.scale));
        let (size, min) = (
            whole(options.width, options.height),
            Size {
                width: options.min_width,
                height: options.min_height,
            },
        );
        Rc::new(Window {
            wayland,
            id,
            surface,
            viewport: wire.create(
                Kind::Silent,
                id,
                wayland.global(Global::Viewports),
                1,
                &[surface],
            ),
            fractions: wire.create(Kind::Scale, id, fractions, 1, &[surface]),
            opacity: Cell::default(),
            icon: icon
                .and_then(|it| square_icon(wayland, (it.width, it.height), &it.pixels))
                .unwrap_or_default()
                .into(),
            ignores_mouse: Cell::default(),
            shape: RefCell::default(),
            may_pop_up: (options.kind == WindowKind::Popup).into(),
            has_popped_up: Cell::default(),
            app_id: options.app_id.to_string(),
            has_title_bar,
            title: options.title.to_string().into(),
            parent: active
                .filter(|_| options.kind != WindowKind::Normal)
                .map(|it| it.id)
                .into(),
            is_modal: (options.kind == WindowKind::Dialog).into(),
            is_opaque: (options.background == Background::Opaque).into(),
            limits: Limits {
                min,
                max: Maybe::No,
                is_resizable: options.resizable,
            }
            .into(),
            aspect_ratio: Cell::default(),
            role: Cell::default(),
            name: RefCell::default(),
            position: Point {
                x: options.x.get().unwrap_or(0.),
                y: options.y.get().unwrap_or(0.),
            }
            .into(),
            size: size.into(),
            floating_size: size.into(),
            scale: likely_scale.unwrap_or(1.).into(),
            is_told_scale: Cell::default(),
            states: (if options.maximized { MAXIMIZED } else { 0 }
                | if options.fullscreen { FULLSCREEN } else { 0 })
            .into(),
            proposed: Cell::default(),
            unanswered: Cell::default(),
            is_configured: Cell::default(),
            is_mapped: Cell::default(),
            is_client_decorated: (!has_title_bar || wayland.version(Global::Decorations) == 0)
                .into(),
            is_minimized: Cell::default(),
            was_visible: Cell::default(),
            outputs: RefCell::default(),
            pointer: Cell::default(),
            cursor: Cursor::Arrow.into(),
            buffers: RefCell::default(),
            committed: Cell::default(),
            commits: Cell::default(),
            committed_at: Instant::now().into(),
            measured_interval: Cell::default(),
            wants_frame: Cell::default(),
            last_frame: Cell::default(),
            awaited_since: Cell::default(),
            is_invited: Cell::default(),
        })
    }

    fn has(&self, states: u32) -> bool {
        self.states.get() & states != 0
    }

    pub fn scale(&self) -> f32 {
        self.scale.get()
    }

    fn display(&self) -> Option<Display> {
        let entered = self
            .outputs
            .borrow()
            .first()
            .and_then(|it| self.wayland.display_of(*it));
        entered.or_else(|| self.wayland.displays.borrow().first().cloned())
    }

    fn shown_parent(&self) -> Option<Rc<Window>> {
        self.wayland
            .window(self.parent.get()?)
            .filter(|it| it.is_mapped.get())
    }

    // ───────────────────────────── roles ─────────────────────────────

    fn positioner(&self, parent: &Window) -> u32 {
        const TOP_LEFT: u32 = 5;
        const BOTTOM_RIGHT: u32 = 8;
        const SLIDE: u32 = 3;
        let (wire, (width, height), origin, within) = (
            &self.wayland.wire,
            self.size.get(),
            parent.geometry(),
            parent.size.get(),
        );
        let (x, y) = (
            (self.position.get().x - origin.x) as i32,
            (self.position.get().y - origin.y) as i32,
        );
        let anchor = (x.clamp(0, within.0 - 1), y.clamp(0, within.1 - 1));
        let positioner = wire.create(Kind::Silent, 0, self.wayland.global(Global::Shell), 1, &[]);
        wire.send(positioner, 1, &[width as u32, height as u32]);
        wire.send(positioner, 2, &[anchor.0 as u32, anchor.1 as u32, 1, 1]);
        wire.send(positioner, 3, &[TOP_LEFT]);
        wire.send(positioner, 4, &[BOTTOM_RIGHT]);
        wire.send(positioner, 5, &[SLIDE]);
        wire.send(
            positioner,
            6,
            &[(x - anchor.0) as u32, (y - anchor.1) as u32],
        );
        positioner
    }

    fn reposition(&self) {
        let (wire, popup) = (&self.wayland.wire, self.role.get().popup);
        if let Some(parent) = self
            .shown_parent()
            .filter(|_| popup != 0 && self.wayland.version(Global::Shell) >= 3)
        {
            let positioner = self.positioner(&parent);
            wire.send(popup, 2, &[positioner, 0]);
            wire.destroy(positioner, 0);
        }
    }

    fn take_role(&self, takes_focus: bool) {
        const CLIENT: u32 = 1;
        const SERVER: u32 = 2;
        let (wayland, wire, id) = (self.wayland, &self.wayland.wire, self.id);
        let any_window = || {
            wayland
                .all_windows()
                .into_iter()
                .filter(|it| it.is_mapped.get())
                .max_by_key(|it| it.is_active())
        };
        let parent = self
            .may_pop_up
            .get()
            .then(|| self.shown_parent().or_else(any_window))
            .flatten();
        // A surface cannot have one after the other.
        if parent.is_none() && self.has_popped_up.get() {
            return;
        }
        self.may_pop_up.set(parent.is_some());
        self.has_popped_up.set(parent.is_some());
        let object = wire.create(
            Kind::Role,
            id,
            wayland.global(Global::Shell),
            2,
            &[self.surface],
        );
        if let Some(parent) = parent {
            self.parent.set(Some(parent.id));
            let positioner = self.positioner(&parent);
            let popup = wire.create(
                Kind::Popup,
                id,
                object,
                2,
                &[parent.role.get().object, positioner],
            );
            wire.destroy(positioner, 0);
            // Those that do are on top of each other.
            let grabbing = || {
                wayland
                    .all_windows()
                    .into_iter()
                    .filter(|it| it.role.get().grabs)
            };
            let is_topmost = match parent.role.get() {
                Role { popup: 0, .. } => grabbing().next().is_none(),
                role => role.grabs && grabbing().all(|it| it.parent.get() != Some(parent.id)),
            };
            let grabs = takes_focus && parent.is_active() && is_topmost;
            if grabs {
                wire.send(
                    popup,
                    1,
                    &[wayland.global(Global::Seat), wayland.serial.get()],
                );
            }
            return self.role.set(Role {
                object,
                popup,
                grabs,
                ..Role::default()
            });
        }
        let toplevel = wire.create(Kind::Toplevel, id, object, 1, &[]);
        let decoration = wire.create(
            Kind::Decoration,
            id,
            wayland.global(Global::Decorations),
            1,
            &[toplevel],
        );
        self.role.set(Role {
            object,
            toplevel,
            decoration,
            ..Role::default()
        });
        wire.send(
            decoration,
            1,
            &[if self.has_title_bar { SERVER } else { CLIENT }],
        );
        wire.send_text(toplevel, 2, &[], &self.title.borrow(), &[]);
        if !self.app_id.is_empty() {
            wire.send_text(toplevel, 3, &[], &self.app_id, &[]);
        }
        self.tell_icon();
        if self.has(MAXIMIZED) {
            wire.send(toplevel, 9, &[]);
        }
        if self.has(FULLSCREEN) {
            wire.send(toplevel, 11, &[0]);
        }
        self.tell_parent();
        self.tell_limits();
    }

    fn give_up_role(&self) {
        let (wayland, wire) = (self.wayland, &self.wayland.wire);
        let popups = wayland
            .all_windows()
            .into_iter()
            .filter(|it| it.parent.get() == Some(self.id) && it.role.get().popup != 0);
        popups.for_each(|it| it.give_up_role());
        let Role {
            object,
            toplevel,
            popup,
            decoration,
            dialog,
            exported,
            ..
        } = self.role.take();
        [exported, dialog, decoration, toplevel, popup, object]
            .into_iter()
            .for_each(|it| wire.destroy(it, 0));
        wire.send(self.surface, 1, &[0; 3]);
        wire.send(self.surface, 6, &[]);
        self.buffers.borrow_mut().clear(wire);
        self.name.take();
        self.states.update(|it| it & (MAXIMIZED | FULLSCREEN));
        [&self.is_configured, &self.is_mapped, &self.is_minimized]
            .into_iter()
            .for_each(|it| it.set(false));
        self.proposed.set(None);
        self.unanswered.set(None);
        self.awaited_since.set(None);
    }

    fn tell_icon(&self) {
        let (toplevel, icon) = (self.role.get().toplevel, self.icon.get().0);
        if toplevel != 0 && icon != 0 {
            self.wayland
                .wire
                .send(self.wayland.global(Global::Icons), 2, &[toplevel, icon]);
        }
    }

    fn tell_parent(&self) {
        let (wire, role) = (&self.wayland.wire, self.role.get());
        let ancestors = std::iter::successors(self.shown_parent(), |it| it.shown_parent())
            .take(self.wayland.windows.borrow().len());
        let parent = self
            .shown_parent()
            .filter(|_| { ancestors }.all(|it| it.id != self.id))
            .map_or(0, |it| it.role.get().toplevel);
        wire.send(role.toplevel, 1, &[parent]);
        if self.is_modal.get() && parent != 0 && role.toplevel != 0 && role.dialog == 0 {
            let dialog = wire.create(
                Kind::Silent,
                0,
                self.wayland.global(Global::Dialogs),
                1,
                &[role.toplevel],
            );
            wire.send(dialog, 1, &[]);
            self.role.set(Role { dialog, ..role });
        }
    }

    /// The least and the most, where 0 is no limit.
    fn limits(&self) -> [(i32, i32); 2] {
        let Limits {
            min,
            max,
            is_resizable,
        } = self.limits.get();
        let (min, max) = (
            (min.width as i32, min.height as i32),
            max.get()
                .map_or((0, 0), |it| (it.width as i32, it.height as i32)),
        );
        let at_least = |max: i32, min: i32| if max > 0 { max.max(min) } else { 0 };
        if is_resizable {
            [min, (at_least(max.0, min.0), at_least(max.1, min.1))]
        } else {
            [self.floating_size.get(); 2]
        }
    }

    fn tell_limits(&self) {
        for (opcode, (width, height)) in [8, 7].into_iter().zip(self.limits()) {
            self.wayland.wire.send(
                self.role.get().toplevel,
                opcode,
                &[width.max(0) as u32, height.max(0) as u32],
            );
        }
    }

    fn set_state(&self, state: u32, opcode: u16, arguments: &[u32], is_on: bool) {
        match (self.role.get().toplevel, is_on) {
            (0, _) => {
                self.states
                    .update(|it| if is_on { it | state } else { it & !state });
                window::bounds_changed(self.id);
            }
            (toplevel, true) => self.wayland.wire.send(toplevel, opcode, arguments),
            (toplevel, false) => self.wayland.wire.send(toplevel, opcode + 1, &[]),
        }
    }

    /// Without proof that the user wants it, the compositor only draws attention to the window.
    fn activate(&self, is_wanted_by_user: bool) {
        let (wayland, wire) = (self.wayland, &self.wayland.wire);
        let activation = wayland.global(Global::Activation);
        if let Some(token) = desktop::take_token().filter(|_| is_wanted_by_user) {
            return wire.send_text(activation, 2, &[], &token, &[self.surface]);
        }
        let token = wire.create(Kind::Token, self.id, activation, 1, &[]);
        if let Some(active) = wayland
            .keyboard
            .focus
            .get()
            .and_then(|it| wayland.window(it))
            .filter(|_| is_wanted_by_user)
        {
            wire.send(
                token,
                0,
                &[wayland.serial.get(), wayland.global(Global::Seat)],
            );
            wire.send(token, 2, &[active.surface]);
        }
        wire.send(token, 3, &[]);
    }

    fn resize(&self, size: (i32, i32)) {
        self.floating_size.set(size);
        self.tell_limits();
        if !self.has(MAXIMIZED | FULLSCREEN | TILED) || !self.is_configured.get() {
            self.size.set(size);
            self.reposition();
            window::bounds_changed(self.id);
        }
    }

    // ───────────────────────────── events ─────────────────────────────

    fn configured(&self, serial: u32) {
        if let Some((mut size, states)) = self.proposed.take() {
            let (usual, is_floating) = (
                self.floating_size.get(),
                states & (MAXIMIZED | FULLSCREEN | TILED) == 0,
            );
            size = (
                if size.0 > 0 { size.0 } else { usual.0 },
                if size.1 > 0 { size.1 } else { usual.1 },
            );
            if is_floating {
                let ((ratio, extra), [min, max]) = (self.aspect_ratio.get(), self.limits());
                if ratio > 0. && states & RESIZING != 0 {
                    size.1 = ((size.0 as f32 - extra.width) / ratio
                        + extra.height
                        + self.geometry().top)
                        .round() as i32;
                }
                let within = |it: i32, min: i32, max: i32| {
                    it.min(if max > 0 { max } else { i32::MAX }).max(min).max(1)
                };
                size = (within(size.0, min.0, max.0), within(size.1, min.1, max.1));
                self.floating_size.set(size);
            }
            self.size.set(size);
            self.states.set(states);
        }
        self.unanswered.set(Some(serial));
        self.is_configured.set(true);
        window::bounds_changed(self.id);
        self.activation_may_have_changed();
        match self.buffers.borrow().size() == Some(self.size_in_pixels()) {
            true if !self.is_mapped.get() || self.committed.get().0 == self.size.get() => {}
            _ => return window::refresh(self.id),
        }
        let everything = IntRect::new(0, 0, self.size_in_pixels().0, self.size_in_pixels().1);
        self.commit(if self.is_mapped.get() {
            &[]
        } else {
            std::slice::from_ref(&everything)
        });
    }

    pub fn activation_may_have_changed(&self) {
        if self.is_active() {
            self.is_minimized.set(false);
        }
        window::activation_changed(self.id, self.is_active());
        self.visibility_may_have_changed();
    }

    fn visibility_may_have_changed(&self) {
        if self.was_visible.replace(self.is_visible()) != self.is_visible() {
            window::visibility_changed(self.id);
        }
    }

    pub fn display_changed(&self) {
        let scales = || {
            self.outputs
                .borrow()
                .iter()
                .filter_map(|it| Some(self.wayland.display_of(*it)?.scale))
                .reduce(f32::max)
        };
        if let Some(scale) = (!self.is_told_scale.get()).then(scales).flatten() {
            self.scale.set(scale);
        }
        self.measured_interval.set(None);
        self.commits.set(0);
        window::bounds_changed(self.id);
    }

    pub fn left(&self, output: u32) {
        self.outputs.borrow_mut().retain(|it| *it != output);
        self.display_changed();
    }

    fn set_scale(&self, scale: f32) {
        self.is_told_scale.set(true);
        self.scale.set(scale.clamp(0.25, 8.));
        window::bounds_changed(self.id);
        self.wayland.show_cursor();
    }

    fn presented(&self, event: &Event) {
        let interval = Duration::from_nanos(event.u32(3).into());
        self.measured_interval
            .set(Some(interval).filter(|it| !it.is_zero()));
        if diagnostics::logs_frames() {
            let mut now = libc::timespec {
                tv_sec: 0,
                tv_nsec: 0,
            };
            // SAFETY: a local.
            unsafe { libc::clock_gettime(self.wayland.clock.get(), &raw mut now) };
            let ago = Duration::new(now.tv_sec as u64, now.tv_nsec as u32)
                .saturating_sub(Duration::new(event.u32(1).into(), event.u32(2)));
            trace!(
                "presented {ago:.2?} ago, refresh {} of {interval:.2?}",
                event.u32(5)
            );
        }
    }

    pub fn event(&self, event: &Event) {
        let wire = &self.wayland.wire;
        match (event.kind, event.opcode) {
            (Kind::Surface, 0) => {
                self.outputs.borrow_mut().push(event.u32(0));
                self.display_changed();
            }
            (Kind::Surface, 1) => self.left(event.u32(0)),
            (Kind::Surface, 2) if self.fractions == 0 => self.set_scale(event.i32(0) as f32),
            (Kind::Scale, _) => self.set_scale(event.u32(0) as f32 / 120.),
            (Kind::Role, _) => self.configured(event.u32(0)),
            (Kind::Toplevel, 0) => {
                let states = event
                    .array(2)
                    .0
                    .words()
                    .into_iter()
                    .filter(|it| *it < 32)
                    .fold(0, |all, it| all | 1 << it);
                self.proposed
                    .set(Some(((event.i32(0), event.i32(1)), states)));
            }
            (Kind::Toplevel, 1) | (Kind::Popup, 1) => window::close_requested(self.id),
            (Kind::Toplevel, 2)
                if !self.is_mapped.get() && event.i32(0) > 0 && event.i32(1) > 0 =>
            {
                self.floating_size
                    .update(|(width, height)| (width.min(event.i32(0)), height.min(event.i32(1))));
            }
            (Kind::Popup, 0) => {
                let origin = self
                    .shown_parent()
                    .map(|it| it.geometry())
                    .unwrap_or_default();
                self.position.set(Point {
                    x: origin.x + event.i32(0) as f32,
                    y: origin.y + event.i32(1) as f32,
                });
                self.proposed.set(Some(((event.i32(2), event.i32(3)), 0)));
            }
            (Kind::Decoration, _) => self.is_client_decorated.set(event.u32(0) == 1),
            (Kind::Frame, _) => {
                self.awaited_since.set(None);
                self.is_invited.set(true);
            }
            (Kind::Feedback, 1) => self.presented(event),
            (Kind::Buffer, _) => self.buffers.borrow_mut().was_released(event.object),
            (Kind::Token, _) => {
                wire.send_text(
                    self.wayland.global(Global::Activation),
                    2,
                    &[],
                    &event.text(0).0,
                    &[self.surface],
                );
                wire.destroy(event.object, 4);
            }
            (Kind::Exported, _) => drop(self.name.replace(format!("wayland:{}", event.text(0).0))),
            _ => {}
        }
    }

    // ───────────────────────────── frames ─────────────────────────────

    fn size_in_pixels(&self) -> (i32, i32) {
        let ((width, height), scale) = (self.size.get(), self.scale.get());
        whole(width as f32 * scale, height as f32 * scale)
    }

    fn set_region(&self, opcode: u16, parts: Option<&[Rect]>) {
        let wire = &self.wayland.wire;
        let region = parts.map_or(0, |parts| {
            let region = wire.create(
                Kind::Silent,
                0,
                self.wayland.global(Global::Compositor),
                1,
                &[],
            );
            parts.iter().for_each(|it| {
                wire.send(
                    region,
                    1,
                    &[it.x, it.y, it.width.max(0.), it.height.max(0.)]
                        .map(|it| it.round() as i32 as u32),
                )
            });
            region
        });
        wire.send(self.surface, opcode, &[region]);
        wire.destroy(region, 0);
    }

    fn tell_what_takes_input(&self) {
        let shape = self.shape.borrow();
        self.set_region(
            5,
            if self.ignores_mouse.get() {
                Some(&[])
            } else {
                Some(&shape[..]).filter(|it| !it.is_empty())
            },
        );
        self.apply_changes();
    }

    /// With what was painted last, if something has changed.
    fn commit(&self, changed: &[IntRect]) {
        const MAX_AREAS: usize = 32;
        let (wire, surface, now) = (&self.wayland.wire, self.surface, Instant::now());
        self.unanswered
            .take()
            .into_iter()
            .for_each(|serial| wire.send(self.role.get().object, 4, &[serial]));
        if !changed.is_empty() {
            let shape @ (size, scale, is_opaque) =
                (self.size.get(), self.scale.get(), self.is_opaque.get());
            let was_mapped = self.is_mapped.replace(true);
            if self.committed.replace(shape) != shape || !was_mapped {
                match self.viewport {
                    0 => wire.send(surface, 8, &[scale as u32]),
                    viewport => wire.send(viewport, 2, &[size.0 as u32, size.1 as u32]),
                }
                wire.send(
                    self.role.get().object,
                    3,
                    &[0, 0, size.0 as u32, size.1 as u32],
                );
                self.set_region(
                    4,
                    is_opaque.then_some(&[Rect {
                        x: 0.,
                        y: 0.,
                        width: size.0 as f32,
                        height: size.1 as f32,
                    }]),
                );
            }
            wire.send(surface, 1, &[self.buffers.borrow_mut().hand_over(), 0, 0]);
            let all = [changed
                .iter()
                .fold(IntRect::default(), |all, it| all.union(*it))];
            for area in if changed.len() > MAX_AREAS {
                &all
            } else {
                changed
            } {
                wire.send(
                    surface,
                    9,
                    &[
                        area.left as u32,
                        area.top as u32,
                        area.width() as u32,
                        area.height() as u32,
                    ],
                );
            }
            self.commits.update(|it| it + 1);
            self.committed_at.set(now);
            let presentation = self.wayland.global(Global::Presentation);
            if presentation != 0 && (self.commits.get() % 64 == 2 || diagnostics::logs_frames()) {
                wire.send(
                    presentation,
                    1,
                    &[surface, wire.new_id(Kind::Feedback, self.id)],
                );
            }
        }
        if self.awaited_since.get().is_none() {
            self.awaited_since.set(Some(now));
            wire.create(Kind::Frame, self.id, surface, 3, &[]);
        }
        wire.send(surface, 6, &[]);
        wire.flush();
    }

    fn apply_changes(&self) {
        if self.is_mapped.get() && self.unanswered.get().is_none() {
            self.commit(&[]);
        }
    }

    fn next_frame(&self, now: Instant) -> Option<Instant> {
        const IF_NOT_SEEN: Duration = Duration::from_secs(1);
        if !self.wants_frame.get() || !self.buffers.borrow().has_free_one() {
            return None;
        }
        let after_pause = || {
            self.last_frame.get().map_or(now, |it| {
                it + self
                    .refresh_interval()
                    .unwrap_or(Duration::from_micros(16_667))
            })
        };
        Some(match self.awaited_since.get() {
            Some(since) if self.unanswered.get().is_none() => {
                since.max(self.last_frame.get().unwrap_or(since)) + IF_NOT_SEEN
            }
            None if self.is_invited.get() => now,
            _ => after_pause(),
        })
    }

    /// Returns when there is something to do.
    pub fn before_waiting(&self, now: Instant) -> Option<Instant> {
        const SPARES_LAST: Duration = Duration::from_secs(2);
        let follows_closely =
            self.awaited_since.get().is_none() && self.next_frame(now).is_some_and(|it| it > now);
        if follows_closely && !host::is_about_to_draw(self.id) {
            self.apply_changes();
        }
        let release = self
            .buffers
            .borrow()
            .has_spares()
            .then(|| self.committed_at.get() + SPARES_LAST);
        if release.is_some_and(|it| it <= now) {
            self.buffers.borrow_mut().release_spares(&self.wayland.wire);
        }
        self.next_frame(now)
            .into_iter()
            .chain(release.filter(|it| *it > now))
            .min()
    }

    pub fn begin_frame_if_due(&self, now: Instant) {
        if self.next_frame(now).is_some_and(|it| it <= now) {
            self.wants_frame.set(false);
            self.is_invited.set(false);
            self.last_frame.set(Some(now));
            window::frame_is_due(self.id);
        }
    }

    fn with_pointer(&self, opcode: u16, arguments: &[u32]) {
        let proof = [
            self.wayland.global(Global::Seat),
            self.wayland.let_go_of_pointer(),
        ];
        self.wayland.wire.send(
            self.role.get().toplevel,
            opcode,
            &[&proof, arguments].concat(),
        );
    }
}

impl platform::Window for Window {
    fn geometry(&self) -> Geometry {
        let ((width, height), origin) = (
            self.size.get(),
            self.display().map(|it| it.bounds).unwrap_or_default(),
        );
        let Point { x, y } = if self.role.get().popup != 0 {
            self.position.get()
        } else {
            Point {
                x: origin.x,
                y: origin.y,
            }
        };
        let has_bar = self.has_title_bar && self.is_client_decorated.get() && !self.has(FULLSCREEN);
        let top = if has_bar {
            TITLEBAR_HEIGHT.min(height as f32)
        } else {
            0.
        };
        Geometry {
            x,
            y,
            top,
            width: width as f32,
            height: height as f32 - top,
            scale: self.scale.get(),
            is_maximized: self.has(MAXIMIZED),
            is_fullscreen: self.has(FULLSCREEN),
            is_client_decorated: self.is_client_decorated.get(),
        }
    }

    fn is_active(&self) -> bool {
        self.has(ACTIVATED) || self.wayland.keyboard.focus.get() == Some(self.id)
    }

    fn is_visible(&self) -> bool {
        self.role.get().object != 0 && !self.has(SUSPENDED) && !self.is_minimized.get()
    }

    fn refresh_interval(&self) -> Option<Duration> {
        let of_display = || {
            Some(self.display()?.frequency)
                .filter(|it| *it > 0.)
                .map(|it| Duration::from_secs_f32(1. / it))
        };
        self.measured_interval.get().or_else(of_display)
    }

    fn mouse_position(&self) -> Point {
        self.pointer.get()
    }

    fn set_visible(&self, is_visible: bool, takes_focus: bool) {
        let wire = &self.wayland.wire;
        if !is_visible {
            self.give_up_role();
        } else if self.role.get().object == 0 {
            self.take_role(takes_focus);
            wire.send(self.surface, 6, &[]);
            let object = self.role.get().object;
            wire.wait_for(Duration::from_millis(200), |it| {
                it.object == object || object == 0
            });
            self.wayland.handle(|it| {
                it.owner == self.id
                    && matches!(
                        it.kind,
                        Kind::Scale
                            | Kind::Surface
                            | Kind::Role
                            | Kind::Toplevel
                            | Kind::Popup
                            | Kind::Decoration
                    )
            });
        }
        // What has launched the app waits for its token.
        if takes_focus
            && self.role.get().toplevel != 0
            && (!self.is_active() || desktop::has_token())
        {
            self.activate(true);
        }
        self.visibility_may_have_changed();
    }

    fn close(&self) {
        let wire = &self.wayland.wire;
        self.give_up_role();
        self.wayland
            .windows
            .borrow_mut()
            .retain(|it| it.id != self.id);
        self.wayland.text_input.has_changed.set(true);
        let objects = [
            self.opacity.get(),
            self.icon.get().0,
            self.icon.get().1,
            self.fractions,
            self.viewport,
            self.surface,
        ];
        objects.into_iter().for_each(|it| wire.destroy(it, 0));
        wire.flush();
    }

    fn request_frame(&self) {
        self.wants_frame.set(true);
    }

    fn can_present(&self) -> Option<bool> {
        let is_seen = self
            .awaited_since
            .get()
            .is_none_or(|it| it.elapsed() < Duration::from_millis(100));
        (is_seen && self.buffers.borrow().has_free_one()).then_some(true)
    }

    fn present(&self, paint: Painter) {
        let (wayland, size) = (self.wayland, self.size_in_pixels());
        let changed = self.buffers.borrow_mut().draw(
            &wayland.wire,
            wayland.global(Global::Memory),
            self.id,
            size,
            self.is_opaque.get(),
            paint,
        );
        match changed {
            None => window::refresh(self.id),
            Some(_) if !self.is_configured.get() => {}
            Some(changed) if changed.is_empty() && !self.is_mapped.get() => {
                self.commit(&[IntRect::new(0, 0, size.0, size.1)])
            }
            Some(changed) if changed.is_empty() && self.unanswered.get().is_none() => {}
            Some(changed) => self.commit(&changed),
        }
    }

    fn set_cursor(&self, cursor: Cursor) {
        if self.cursor.replace(cursor) != cursor {
            self.wayland.show_cursor();
            self.wayland.answer_own_drag();
        }
    }

    fn begin_drag(&self, dragged: &Dragged, image: Option<&Pixmap>) {
        self.wayland.begin_drag(self, dragged, image);
    }

    fn text_input_changed(&self) {
        self.wayland.text_input.has_changed.set(true);
    }

    fn start_move(&self) {
        self.with_pointer(5, &[]);
    }

    fn start_resize(&self, edge: Edge) {
        self.with_pointer(6, &[[1, 9, 8, 10, 2, 6, 4, 5][edge as usize]]);
    }

    fn show_window_menu(&self, at: Point) {
        self.with_pointer(4, &[at.x as u32, at.y as u32]);
    }

    fn title_was_double_clicked(&self) {
        if self.limits.get().is_resizable {
            self.set_state(MAXIMIZED, 9, &[], !self.has(MAXIMIZED));
        }
    }

    fn is_minimized(&self) -> bool {
        self.is_minimized.get()
    }

    fn command(&self, command: &WindowCommand) -> Result<()> {
        let (wayland, wire, toplevel) =
            (self.wayland, &self.wayland.wire, self.role.get().toplevel);
        match *command {
            WindowCommand::Title(ref title) => {
                wire.send_text(toplevel, 2, &[], title, &[]);
                self.title.replace(title.to_string());
            }
            WindowCommand::Position(at) => {
                self.position.set(at);
                self.reposition();
            }
            WindowCommand::Size(size) => self.resize(whole(size.width, size.height)),
            WindowCommand::Limits(limits) => {
                self.limits.set(limits);
                self.tell_limits();
                self.apply_changes();
            }
            WindowCommand::AspectRatio { ratio, extra } => self.aspect_ratio.set((ratio, extra)),
            WindowCommand::Focus | WindowCommand::MoveTop | WindowCommand::Restore
                if toplevel != 0 =>
            {
                self.activate(true)
            }
            WindowCommand::Attention(true) if toplevel != 0 && !self.is_active() => {
                self.activate(false)
            }
            WindowCommand::Minimize if toplevel != 0 => {
                wire.send(toplevel, 13, &[]);
                self.states.update(|it| it & !ACTIVATED);
                self.is_minimized.set(true);
                self.visibility_may_have_changed();
            }
            WindowCommand::Maximize(on) => self.set_state(MAXIMIZED, 9, &[], on),
            WindowCommand::Fullscreen(on) | WindowCommand::SimpleFullscreen(on) => {
                self.set_state(FULLSCREEN, 11, &[0], on)
            }
            WindowCommand::Parent(parent) => {
                self.parent.set(parent.get());
                self.tell_parent();
            }
            WindowCommand::ShowAsSheet(parent) => {
                self.parent.set(Some(parent));
                self.is_modal.set(true);
                self.set_visible(true, true);
            }
            WindowCommand::Background(background) => {
                self.is_opaque.set(background == Background::Opaque)
            }
            WindowCommand::Opacity(opacity) => {
                if self.opacity.get() == 0 {
                    self.opacity.set(wire.create(
                        Kind::Silent,
                        0,
                        wayland.global(Global::Opacity),
                        1,
                        &[self.surface],
                    ));
                }
                wire.send(
                    self.opacity.get(),
                    1,
                    &[(f64::from(opacity).clamp(0., 1.) * f64::from(u32::MAX)) as u32],
                );
                self.apply_changes();
            }
            WindowCommand::IgnoreMouseEvents(on) => {
                self.ignores_mouse.set(on);
                self.tell_what_takes_input();
            }
            WindowCommand::Shape(ref parts) => {
                self.shape
                    .replace(parts.iter().copied().take(16_000).collect());
                self.tell_what_takes_input();
            }
            WindowCommand::Icon(ref encoded) => {
                let icon = crate::images::decode_still(encoded)?;
                let (before, pixels) = self.icon.replace(
                    square_icon(wayland, (icon.width, icon.height), &icon.data).unwrap_or_default(),
                );
                self.tell_icon();
                self.apply_changes();
                [before, pixels]
                    .into_iter()
                    .for_each(|it| wire.destroy(it, 0));
            }
            WindowCommand::Beep => wire.send(wayland.global(Global::Bell), 1, &[self.surface]),
            _ => {}
        }
        Ok(())
    }

    fn name_for_portals(&self) -> String {
        let (wire, role) = (&self.wayland.wire, self.role.get());
        if role.exported == 0 && role.toplevel != 0 && self.is_mapped.get() {
            let exported = wire.create(
                Kind::Exported,
                self.id,
                self.wayland.global(Global::Exporter),
                1,
                &[self.surface],
            );
            self.role.set(Role { exported, ..role });
            wire.sync();
            self.wayland.handle(|it| it.object == exported);
        }
        self.name.borrow().clone()
    }

    fn handle(&self) -> u64 {
        self.surface.into()
    }
}
