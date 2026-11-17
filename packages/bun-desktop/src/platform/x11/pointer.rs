//! https://gitlab.freedesktop.org/xorg/proto/xorgproto/-/blob/master/specs/XI2proto.txt and
//! https://www.freedesktop.org/wiki/Specifications/XDND/

use std::cell::{Cell, RefCell};

use super::window::Window;
use super::wire::{Bytes as _, Connection, Extension, Request, padded};
use super::{X11, atom, keyboard, selection};
use crate::error::{Result, ensure};
use crate::input;
use crate::platform::{Input, Phase, Point};

const DEVICE_CHANGED: u16 = 1;
const PRESS: u16 = 4;
const RELEASE: u16 = 5;
const MOTION: u16 = 6;
const ENTER: u16 = 7;
const LEAVE: u16 = 8;
const PINCH_BEGIN: u16 = 27;
const PINCH_UPDATE: u16 = 28;
const PINCH_END: u16 = 29;
const LINES_PER_CLICK: f32 = 3.;
const PIXELS_PER_CLICK: f32 = 120.;

/// Returns the events to select.
pub fn start(x: &Connection, xinput: Extension) -> Result<u32> {
    let version = x.call(Request::new(xinput.opcode, 47).u16(2).u16(4))?;
    ensure!(version.u16(8) >= 2, "the display does not have XInput 2");
    let pinch = [PINCH_BEGIN, PINCH_UPDATE, PINCH_END]
        .into_iter()
        .filter(|_| version.u16(10) >= 4);
    Ok([DEVICE_CHANGED, PRESS, RELEASE, MOTION, ENTER, LEAVE]
        .into_iter()
        .chain(pinch)
        .map(|it| 1 << it)
        .sum())
}

struct ScrollAxis {
    device: u16,
    number: u16,
    is_vertical: bool,
    per_click: f64,
    value: f64,
}

#[derive(Clone, Copy, Default)]
struct Click {
    time: u32,
    button: u8,
    at: Point,
    count: u32,
}

#[derive(Clone, Copy)]
struct Drag {
    source: u32,
    has_files: bool,
    has_entered: bool,
    at: Point,
}

#[derive(Default)]
pub struct Pointer {
    axes: RefCell<Vec<ScrollAxis>>,
    last_click: Cell<Click>,
    pinch_scale: Cell<f32>,
    drag: Cell<Option<Drag>>,
}

fn fixed_32_32(bytes: &[u8], at: usize) -> f64 {
    f64::from(bytes.i32(at)) + f64::from(bytes.u32(at + 4)) / 2f64.powi(32)
}

impl X11 {
    fn read_scroll_axes(&self) {
        const VALUATOR: u16 = 2;
        const SCROLL: u16 = 3;
        let Ok(reply) = self.x.call(Request::new(self.xinput.opcode, 48).u32(0)) else {
            return;
        };
        let (mut axes, mut at) = (Vec::new(), 32);
        for _ in 0..reply.u16(8) {
            let (device, count) = (reply.u16(at), reply.u16(at + 6));
            at += 12 + padded(reply.u16(at + 8).into());
            let classes = (0..count).map(|_| {
                let class = reply.part(at, usize::from(reply.u16(at + 2)) * 4);
                at += class.len();
                class
            });
            let classes: Vec<_> = classes.collect();
            axes.extend(
                classes
                    .iter()
                    .filter(|it| it.u16(0) == SCROLL)
                    .filter_map(|scroll| {
                        let (number, per_click) = (scroll.u16(6), fixed_32_32(scroll, 16));
                        let valuator = classes
                            .iter()
                            .find(|it| it.u16(0) == VALUATOR && it.u16(6) == number)?;
                        let (is_vertical, value) = (scroll.u16(8) == 1, fixed_32_32(valuator, 28));
                        (per_click != 0.).then_some(ScrollAxis {
                            device,
                            number,
                            is_vertical,
                            per_click,
                            value,
                        })
                    }),
            );
        }
        self.pointer.axes.replace(axes);
    }

    /// In clicks of a wheel.
    fn scrolled(&self, event: &[u8]) -> Option<Point> {
        let mut axes = self.pointer.axes.borrow_mut();
        let (mask, length) = (
            80 + usize::from(event.u16(48)) * 4,
            usize::from(event.u16(50)) * 4,
        );
        let is_set = |number: u16| {
            event.part(mask, length).u8(usize::from(number / 8)) >> (number % 8) & 1 != 0
        };
        let mut delta = None;
        for axis in axes
            .iter_mut()
            .filter(|it| it.device == event.u16(52) && is_set(it.number))
        {
            let value = fixed_32_32(
                event,
                mask + length + (0..axis.number).filter(|it| is_set(*it)).count() * 8,
            );
            let clicks =
                ((std::mem::replace(&mut axis.value, value) - value) / axis.per_click) as f32;
            let Point { x, y } = delta.get_or_insert_default();
            *if axis.is_vertical { y } else { x } += clicks;
        }
        delta
    }

    fn count_click(&self, time: u32, button: u8, at: Point) -> u32 {
        let (last, interval) = (
            self.pointer.last_click.get(),
            self.settings.borrow().number("Net/DoubleClickTime"),
        );
        let is_soon = time.wrapping_sub(last.time) < interval.unwrap_or(400.) as u32;
        let is_near = (at.x - last.at.x).abs() <= 5. && (at.y - last.at.y).abs() <= 5.;
        let count = if is_soon && is_near && button == last.button {
            last.count + 1
        } else {
            1
        };
        self.pointer.last_click.set(Click {
            time,
            button,
            at,
            count,
        });
        count
    }

    pub fn pointer_event(&self, event: &[u8]) {
        const EMULATED: u32 = 1 << 16;
        let kind = event.u16(8);
        if matches!(kind, DEVICE_CHANGED | ENTER) {
            self.read_scroll_axes();
        }
        let Some(window) = self
            .window(event.u32(24))
            .filter(|_| kind != DEVICE_CHANGED)
        else {
            return;
        };
        let [x, y] = [40, 44].map(|at| event.i32(at) as f32 / 65536. / self.scale.get());
        let at = Point { x, y };
        window.pointer.set(at);
        let modifiers = keyboard::modifiers(event.u16(match kind {
            ENTER | LEAVE => 64,
            PINCH_BEGIN.. => 88,
            _ => 72,
        }));
        let scroll = |Point { x, y }, is_precise| {
            let unit = if is_precise {
                PIXELS_PER_CLICK
            } else {
                LINES_PER_CLICK
            };
            let (x, y) = if modifiers & 1 != 0 && x == 0. {
                (y, 0.)
            } else {
                (x, y)
            };
            Input::Scroll {
                at,
                delta: Point {
                    x: x * unit,
                    y: y * unit,
                },
                is_precise,
                phase: Phase::Moved,
                modifiers,
            }
        };
        let is_pressed = |at| event.u32(at) & (0b1110 | 0b11 << 8) != 0;
        input::handle(
            window.id,
            match (kind, event.u32(16)) {
                (PRESS, wheel @ 4..=7) if event.u32(56) & EMULATED == 0 => {
                    let (x, y) = [(0., 1.), (0., -1.), (1., 0.), (-1., 0.)][wheel as usize - 4];
                    scroll(Point { x, y }, false)
                }
                (PRESS | RELEASE, number @ (1..=3 | 8 | 9)) => {
                    let button = if number > 3 { number - 5 } else { number - 1 } as u8;
                    self.time.set(event.u32(12));
                    if kind == RELEASE {
                        Input::MouseUp {
                            at,
                            button,
                            clicks: self.pointer.last_click.get().count,
                            modifiers,
                        }
                    } else {
                        self.input_method
                            .get()
                            .into_iter()
                            .flatten()
                            .for_each(|it| it.reset());
                        Input::MouseDown {
                            at,
                            button,
                            clicks: self.count_click(event.u32(12), button, at),
                            modifiers,
                        }
                    }
                }
                (MOTION, _) => match self.scrolled(event) {
                    Some(clicks) => {
                        scroll(clicks, clicks.x.fract() != 0. || clicks.y.fract() != 0.)
                    }
                    None => Input::MouseMove {
                        at,
                        is_pressed: is_pressed(80),
                        modifiers,
                    },
                },
                (ENTER, _) => Input::MouseMove {
                    at,
                    is_pressed: is_pressed(72),
                    modifiers,
                },
                (LEAVE, _) => Input::MouseLeave { at, modifiers },
                (PINCH_BEGIN..=PINCH_END, _) => {
                    let scale = event.i32(64) as f32 / 65536.;
                    let before = self.pointer.pinch_scale.replace(scale);
                    Input::Pinch {
                        at,
                        delta: if kind == PINCH_UPDATE {
                            scale - before
                        } else {
                            0.
                        },
                        modifiers,
                    }
                }
                _ => return,
            },
        );
    }

    pub fn drag_message(&self, window: &Window, kind: u32, data: &[u8]) {
        let (source, is) = (data.u32(0), |name| kind == self.atom(name));
        let (files, copy) = (self.atom(atom::URI_LIST), self.atom(atom::XdndActionCopy));
        let answer = |name, data| {
            self.x
                .send_message(source, 0, source, self.atom(name), data)
        };
        if is(atom::XdndEnter) {
            let types = match data.u32(4) & 1 {
                0 => data[8..].words(),
                _ => self.x.words(source, self.atom(atom::XdndTypeList)),
            };
            let has_files = types.contains(&files);
            return self.pointer.drag.set(Some(Drag {
                source,
                has_files,
                has_entered: false,
                at: Point::default(),
            }));
        }
        let Some(mut drag) = self.pointer.drag.take().filter(|it| it.source == source) else {
            return;
        };
        if is(atom::XdndPosition) {
            let ([left, top, ..], scale) = (window.area.get(), self.scale.get());
            let [x, y] = [(10, left), (8, top)]
                .map(|(at, origin)| (i32::from(data.i16(at)) - origin) as f32 / scale);
            drag.at = Point { x, y };
            if drag.has_entered {
                input::handle(window.id, Input::DragOver { at: drag.at });
            } else if drag.has_files {
                let list = self.convert(self.atom(atom::XdndSelection), files, data.u32(12));
                let paths = selection::paths_in(&list.unwrap_or_default());
                (drag.has_files, drag.has_entered) = (false, !paths.is_empty());
                drag.has_entered
                    .then(|| input::handle(window.id, Input::DragEnter { at: drag.at, paths }));
            }
            let (accepts, action) = if drag.has_entered { (3, copy) } else { (0, 0) };
            answer(atom::XdndStatus, [window.xid, accepts, 0, 0, action]);
            self.pointer.drag.set(Some(drag));
        } else if is(atom::XdndDrop) {
            drag.has_entered
                .then(|| input::handle(window.id, Input::Drop { at: drag.at }));
            answer(
                atom::XdndFinished,
                [window.xid, drag.has_entered.into(), copy, 0, 0],
            );
        } else if is(atom::XdndLeave) {
            drag.has_entered
                .then(|| input::handle(window.id, Input::DragLeave));
        } else {
            self.pointer.drag.set(Some(drag));
        }
    }
}
