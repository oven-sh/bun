use std::cell::{Cell, RefCell};
use std::rc::Rc;
use std::time::{Duration, Instant};

use super::super::cursors;
use super::super::typing::Click;
use super::window::Window;
use super::wire::{Event, Kind};
use super::{Global, Wayland, pixels};
use crate::platform::{Cursor, Input, Phase, Point, Window as _};
use crate::{host, input};

const LINES_PER_CLICK: f32 = 3.;
/// As in Chromium.
const PIXELS_PER_UNIT: f32 = 2.5;

/// What comes before the next `frame` event belongs together. The vertical axis is the first.
#[derive(Clone, Copy, Default)]
struct Turn {
    units: [f32; 2],
    clicks: [f32; 2],
    is_by_fingers: bool,
    has_stopped: bool,
    time: u32,
}

/// The fling curve of Chromium.
#[derive(Clone, Copy)]
struct Coasting {
    window: u32,
    at: Point,
    /// For each axis, the share of the way along the curve.
    shares: [f32; 2],
    start: Instant,
    /// Where on the curve it starts.
    offset: f32,
    position: f32,
    next_step: Instant,
}

impl Coasting {
    const ALPHA: f32 = -5707.62;
    const BETA: f32 = 172.;
    const GAMMA: f32 = 3.7;

    fn position_at(time: f32) -> f32 {
        Self::ALPHA * (-Self::GAMMA * time).exp() - Self::BETA * time - Self::ALPHA
    }

    fn time_at(velocity: f32) -> f32 {
        -((velocity + Self::BETA) / (-Self::ALPHA * Self::GAMMA)).ln() / Self::GAMMA
    }
}

/// In pixels, at a time in milliseconds.
#[derive(Default)]
struct Trail(Vec<(u32, [f32; 2])>);

impl Trail {
    /// In pixels per second.
    fn velocity(&self, now: u32) -> [f32; 2] {
        const RECENT: u32 = 80;
        let mut recent = self.0.iter().filter(|it| now.wrapping_sub(it.0) <= RECENT);
        let Some(&(since, _)) = recent.next() else {
            return [0.; 2];
        };
        let way = recent.fold([0.; 2], |all, (_, it)| [all[0] + it[0], all[1] + it[1]]);
        way.map(|it| it * 1000. / now.wrapping_sub(since).max(8) as f32)
    }

    fn add(&mut self, time: u32, way: [f32; 2]) {
        self.0.drain(..self.0.len().saturating_sub(15));
        self.0.push((time, way));
    }
}

#[derive(Clone, Copy, PartialEq)]
enum Gesture {
    Tap,
    Scroll,
    /// The finger is the pointer.
    Press,
}

#[derive(Clone, Copy)]
struct Finger {
    id: u32,
    window: u32,
    at: Point,
    gesture: Gesture,
}

#[derive(Default)]
pub struct Pointer {
    object: Cell<u32>,
    shapes: Cell<u32>,
    gestures: Cell<[u32; 2]>,
    touch: Cell<u32>,
    window: Cell<Option<u32>>,
    entered: Cell<u32>,
    /// The serial of the last press.
    pub press: Cell<u32>,
    pub buttons: Cell<u8>,
    last_click: Cell<Click>,
    last_seen: Cell<Point>,
    turn: Cell<Turn>,
    is_scrolling: Cell<bool>,
    trail: RefCell<Trail>,
    coasting: Cell<Option<Coasting>>,
    pinch_scale: Cell<f32>,
    finger: Cell<Option<Finger>>,
    /// The surface, and its buffer.
    picture: Cell<[u32; 2]>,
}

impl Pointer {
    pub fn next_step(&self) -> Option<Instant> {
        self.coasting.get().map(|it| it.next_step)
    }
}

fn shape(cursor: Cursor) -> u32 {
    match cursor {
        Cursor::Arrow | Cursor::Hidden => 1,
        Cursor::ContextMenu => 2,
        Cursor::PointingHand => 4,
        Cursor::Crosshair => 8,
        Cursor::IBeam => 9,
        Cursor::VerticalIBeam => 10,
        Cursor::DragLink => 11,
        Cursor::DragCopy => 12,
        Cursor::NotAllowed => 15,
        Cursor::OpenHand => 16,
        Cursor::ClosedHand => 17,
        Cursor::ResizeRight => 18,
        Cursor::ResizeUp => 19,
        Cursor::ResizeDown => 22,
        Cursor::ResizeLeft => 25,
        Cursor::ResizeLeftRight => 26,
        Cursor::ResizeUpDown => 27,
        Cursor::ResizeUpRightDownLeft => 28,
        Cursor::ResizeUpLeftDownRight => 29,
        Cursor::ResizeColumn => 30,
        Cursor::ResizeRow => 31,
    }
}

impl Wayland {
    pub fn use_pointer(&self, exists: bool) {
        let (pointer, wire) = (&self.pointer, &self.wire);
        if !exists {
            pointer
                .gestures
                .take()
                .into_iter()
                .chain([pointer.shapes.take()])
                .for_each(|it| wire.destroy(it, 0));
            wire.destroy(pointer.object.take(), 1);
        } else if pointer.object.get() == 0 {
            let (object, gestures) = (
                wire.create(Kind::Pointer, 0, self.global(Global::Seat), 0, &[]),
                self.global(Global::Gestures),
            );
            let holds = if self.version(Global::Gestures) >= 3 {
                gestures
            } else {
                0
            };
            pointer.object.set(object);
            pointer.shapes.set(wire.create(
                Kind::Silent,
                0,
                self.global(Global::Cursors),
                1,
                &[object],
            ));
            pointer.gestures.set([
                wire.create(Kind::Pinch, 0, gestures, 1, &[object]),
                wire.create(Kind::Hold, 0, holds, 3, &[object]),
            ]);
        }
    }

    pub fn use_touch(&self, exists: bool) {
        let touch = &self.pointer.touch;
        if !exists {
            self.wire.destroy(touch.take(), 0);
        } else if touch.get() == 0 {
            touch.set(
                self.wire
                    .create(Kind::Touch, 0, self.global(Global::Seat), 2, &[]),
            );
        }
    }

    pub fn pointer_on_screen(&self) -> Point {
        self.pointer.last_seen.get()
    }

    pub fn pointer_is_at(&self, window: &Window, at: Point) {
        let origin = window.geometry();
        window.pointer.set(at);
        self.pointer.last_seen.set(Point {
            x: origin.x + at.x,
            y: origin.y + at.y,
        });
    }

    /// The compositor takes it over. Returns the serial of the press.
    pub fn let_go_of_pointer(&self) -> u32 {
        self.pointer.buttons.set(0);
        self.pointer.finger.set(None);
        self.pointer.press.get()
    }

    // ───────────────────────────── cursors ─────────────────────────────

    pub fn show_cursor(&self) {
        let (pointer, wire) = (&self.pointer, &self.wire);
        let Some(window) = pointer.window.get().and_then(|it| self.window(it)) else {
            return;
        };
        match (window.cursor.get(), pointer.shapes.get()) {
            (Cursor::Hidden, _) => {
                wire.send(pointer.object.get(), 0, &[pointer.entered.get(), 0, 0, 0])
            }
            (cursor, 0) => drop(self.show_cursor_of_theme(cursor, window.scale().ceil() as u32)),
            (cursor, shapes) => wire.send(shapes, 1, &[pointer.entered.get(), shape(cursor)]),
        }
    }

    fn show_cursor_of_theme(&self, cursor: Cursor, scale: u32) -> Option<()> {
        let (pointer, wire) = (&self.pointer, &self.wire);
        let known = &self.desktop.known;
        let size = std::env::var("XCURSOR_SIZE")
            .ok()
            .and_then(|it| it.parse().ok())
            .or(known.cursor_size.get())
            .unwrap_or(24);
        let theme = std::env::var("XCURSOR_THEME")
            .ok()
            .or_else(|| known.cursor_theme.borrow().clone());
        let file = cursors::file(theme.as_deref().unwrap_or("default"), cursor)?;
        let (numbers, bgra) = cursors::picture(&file, size * scale)?;
        let [width, height, x, y] = numbers.map(u32::from);
        let scale = if width % scale == 0 && height % scale == 0 && width > size {
            scale
        } else {
            1
        };
        let buffer = pixels::picture(
            wire,
            self.global(Global::Memory),
            (width, height),
            bgra.as_chunks().0.iter().copied(),
        )?;
        let [mut surface, before] = pointer.picture.get();
        if surface == 0 {
            surface = wire.create(Kind::Silent, 0, self.global(Global::Compositor), 0, &[]);
        }
        pointer.picture.set([surface, buffer]);
        wire.send(
            pointer.object.get(),
            0,
            &[pointer.entered.get(), surface, x / scale, y / scale],
        );
        wire.send(surface, 8, &[scale]);
        wire.send(surface, 1, &[buffer, 0, 0]);
        wire.send(surface, 9, &[0, 0, width, height]);
        wire.send(surface, 6, &[]);
        wire.destroy(before, 0);
        Some(())
    }

    // ───────────────────────────── the mouse and the touchpad ─────────────────────────────

    fn scroll(&self, window: u32, at: Point, [y, x]: [f32; 2], is_precise: bool, phase: Phase) {
        let modifiers = self.keyboard.modifiers();
        let (x, y) = if modifiers & 1 != 0 && x == 0. {
            (y, 0.)
        } else {
            (x, y)
        };
        input::handle(
            window,
            Input::Scroll {
                at,
                delta: Point { x, y },
                is_precise,
                phase,
                modifiers,
            },
        );
    }

    fn follow_fingers(&self, window: u32, at: Point, way: [f32; 2], time: u32) {
        self.pointer.trail.borrow_mut().add(time, way);
        self.scroll(
            window,
            at,
            way,
            true,
            if self.pointer.is_scrolling.replace(true) {
                Phase::Moved
            } else {
                Phase::Started
            },
        );
    }

    fn fingers_have_left(&self, window: u32, at: Point, time: u32) {
        const TOO_SLOW: f32 = 50.;
        let velocity = self.pointer.trail.take().velocity(time);
        let fastest = velocity[0].abs().max(velocity[1].abs());
        if !self.pointer.is_scrolling.take() {
            return;
        }
        if fastest < TOO_SLOW {
            return self.scroll(window, at, [0.; 2], true, Phase::Ended);
        }
        let (offset, start) = (Coasting::time_at(fastest).max(0.), Instant::now());
        let (shares, position) = (
            velocity.map(|it| it / fastest),
            Coasting::position_at(offset),
        );
        self.pointer.coasting.set(Some(Coasting {
            window,
            at,
            shares,
            start,
            offset,
            position,
            next_step: start,
        }));
    }

    fn stop_coasting(&self) {
        if let Some(Coasting { window, at, .. }) = self.pointer.coasting.take() {
            self.scroll(window, at, [0.; 2], true, Phase::Ended);
        }
    }

    pub fn coast(&self, now: Instant) {
        let Some(it) = self.pointer.coasting.get().filter(|it| it.next_step <= now) else {
            return;
        };
        let (time, end) = (
            it.offset + (now - it.start).as_secs_f32(),
            Coasting::time_at(0.),
        );
        if time >= end {
            return self.stop_coasting();
        }
        let position = Coasting::position_at(time);
        let next_step = now + (host::interval() / 2).max(Duration::from_millis(2));
        self.pointer.coasting.set(Some(Coasting {
            position,
            next_step,
            ..it
        }));
        self.scroll(
            it.window,
            it.at,
            it.shares.map(|share| share * (position - it.position)),
            true,
            Phase::Moved,
        );
    }

    fn finish_turn(&self, window: &Window) {
        let (
            Turn {
                units,
                clicks,
                is_by_fingers,
                has_stopped,
                time,
            },
            at,
        ) = (self.pointer.turn.take(), window.pointer.get());
        let pixels = units.map(|it| -it * PIXELS_PER_UNIT);
        if units != [0.; 2] || clicks != [0.; 2] {
            self.stop_coasting();
        }
        if clicks != [0.; 2] {
            self.scroll(
                window.id,
                at,
                clicks.map(|it| -it * LINES_PER_CLICK),
                false,
                Phase::Moved,
            );
        } else if units != [0.; 2] && is_by_fingers {
            self.follow_fingers(window.id, at, pixels, time);
        } else if units != [0.; 2] {
            self.scroll(window.id, at, pixels, true, Phase::Moved);
        } else if has_stopped {
            self.fingers_have_left(window.id, at, time);
        }
    }

    fn press(&self, window: u32, at: Point, button: u8, serial: u32, time: u32) {
        let pointer = &self.pointer;
        self.serial.set(serial);
        pointer.press.set(serial);
        pointer.buttons.update(|it| it | 1 << button);
        pointer.last_click.update(|it| {
            it.next(
                time,
                button,
                at,
                self.desktop.known.double_click.get().unwrap_or(400),
            )
        });
        self.stop_coasting();
        self.end_composition();
        input::handle(
            window,
            Input::MouseDown {
                at,
                button,
                clicks: pointer.last_click.get().count,
                modifiers: self.keyboard.modifiers(),
            },
        );
    }

    pub fn release(&self, window: u32, at: Point, button: u8) {
        self.pointer.buttons.update(|it| it & !(1 << button));
        input::handle(
            window,
            Input::MouseUp {
                at,
                button,
                clicks: self.pointer.last_click.get().count,
                modifiers: self.keyboard.modifiers(),
            },
        );
    }

    fn move_to(&self, window: &Window, at: Point) {
        self.pointer_is_at(window, at);
        input::handle(
            window.id,
            Input::MouseMove {
                at,
                is_pressed: self.pointer.buttons.get() != 0,
                modifiers: self.keyboard.modifiers(),
            },
        );
    }

    fn pointed_at(&self) -> Option<Rc<Window>> {
        self.window(self.pointer.window.get()?)
    }

    pub fn pointer_event(&self, event: &Event) {
        const FINGER: u32 = 1;
        let pointer = &self.pointer;
        if event.opcode == 0 {
            pointer.entered.set(event.u32(0));
            pointer
                .window
                .set(self.window_of(event.u32(1)).map(|it| it.id));
            self.show_cursor();
        }
        let Some(window) = self.pointed_at() else {
            return;
        };
        let (at, mut turn, axis) = (window.pointer.get(), pointer.turn.get(), |index| {
            event.u32(index) as usize & 1
        });
        match event.opcode {
            0 => self.move_to(
                &window,
                Point {
                    x: event.fixed(2),
                    y: event.fixed(3),
                },
            ),
            1 => {
                pointer.window.set(None);
                // No release follows.
                if !self.is_dragging() {
                    (0..5)
                        .filter(|it| pointer.buttons.get() & 1 << it != 0)
                        .for_each(|it| self.release(window.id, at, it));
                }
                input::handle(
                    window.id,
                    Input::MouseLeave {
                        at,
                        modifiers: self.keyboard.modifiers(),
                    },
                );
            }
            2 => self.move_to(
                &window,
                Point {
                    x: event.fixed(1),
                    y: event.fixed(2),
                },
            ),
            3 => {
                let Some(&button) =
                    [0, 2, 1, 3, 4, 4, 3].get(event.u32(2).wrapping_sub(0x110) as usize)
                else {
                    return;
                };
                match event.u32(3) {
                    0 => self.release(window.id, at, button),
                    _ => self.press(window.id, at, button, event.u32(0), event.u32(1)),
                }
            }
            4 => {
                (turn.time, turn.units[axis(1)]) =
                    (event.u32(0), turn.units[axis(1)] + event.fixed(2))
            }
            5 => return self.finish_turn(&window),
            6 => turn.is_by_fingers = event.u32(0) == FINGER,
            7 => (turn.time, turn.has_stopped) = (event.u32(0), true),
            8 => turn.clicks[axis(0)] += event.i32(1) as f32,
            9 => turn.clicks[axis(0)] += event.i32(1) as f32 / 120.,
            _ => {}
        }
        pointer.turn.set(turn);
    }

    pub fn gesture_event(&self, event: &Event) {
        match (event.kind, event.opcode, self.pointed_at()) {
            (Kind::Hold, 0, _) => self.stop_coasting(),
            (Kind::Pinch, 0, _) => self.pointer.pinch_scale.set(1.),
            (Kind::Pinch, 1, Some(window)) => {
                let delta = event.fixed(3) - self.pointer.pinch_scale.replace(event.fixed(3));
                input::handle(
                    window.id,
                    Input::Pinch {
                        at: window.pointer.get(),
                        delta,
                        modifiers: self.keyboard.modifiers(),
                    },
                );
            }
            _ => {}
        }
    }

    // ───────────────────────────── the screen ─────────────────────────────

    pub fn touch_event(&self, event: &Event) {
        const SLOP: f32 = 8.;
        let pointer = &self.pointer;
        let finger = pointer
            .finger
            .get()
            .and_then(|it| Some((it, self.window(it.window)?)));
        match (event.opcode, finger) {
            (0, None) => {
                let Some(window) = self.window_of(event.u32(2)) else {
                    return;
                };
                let at = Point {
                    x: event.fixed(4),
                    y: event.fixed(5),
                };
                let gesture = if input::is_on_frame(window.id, at) {
                    Gesture::Press
                } else {
                    Gesture::Tap
                };
                pointer.finger.set(Some(Finger {
                    id: event.u32(3),
                    window: window.id,
                    at,
                    gesture,
                }));
                self.stop_coasting();
                self.move_to(&window, at);
                if gesture == Gesture::Press {
                    self.press(window.id, at, 0, event.u32(0), event.u32(1));
                }
            }
            (1, Some((finger, window))) if finger.id == event.u32(2) => {
                pointer.finger.set(None);
                if finger.gesture == Gesture::Tap {
                    self.press(window.id, finger.at, 0, event.u32(0), event.u32(1));
                }
                match finger.gesture {
                    Gesture::Scroll => self.fingers_have_left(window.id, finger.at, event.u32(1)),
                    _ => self.release(window.id, window.pointer.get(), 0),
                }
                input::handle(
                    window.id,
                    Input::MouseLeave {
                        at: finger.at,
                        modifiers: self.keyboard.modifiers(),
                    },
                );
            }
            (2, Some((finger, window))) if finger.id == event.u32(1) => {
                let (to, from) = (
                    Point {
                        x: event.fixed(2),
                        y: event.fixed(3),
                    },
                    window.pointer.get(),
                );
                let way = [to.y - from.y, to.x - from.x];
                match finger.gesture {
                    Gesture::Press => self.move_to(&window, to),
                    Gesture::Tap if way[0].hypot(way[1]) < SLOP => {}
                    _ => {
                        pointer.finger.set(Some(Finger {
                            gesture: Gesture::Scroll,
                            ..finger
                        }));
                        self.pointer_is_at(&window, to);
                        self.follow_fingers(window.id, finger.at, way, event.u32(0));
                    }
                }
            }
            (4, Some((finger, window))) => {
                pointer.finger.set(None);
                pointer.trail.take();
                match finger.gesture {
                    Gesture::Press => self.release(window.id, Point { x: -1e4, y: -1e4 }, 0),
                    _ => self.fingers_have_left(window.id, finger.at, 0),
                }
            }
            _ => {}
        }
    }
}
