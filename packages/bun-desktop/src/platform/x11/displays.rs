//! Monitors, and what the desktop says about sizes and looks.

use super::wire::{Bytes as _, Connection, Property, Request, padded};
use super::{X11, atom};
use crate::abi::Rect;
use crate::platform::Display;

#[derive(Default)]
pub struct Settings(Vec<(String, String)>);

impl Settings {
    /// From xrdb.
    pub fn add_resources(&mut self, property: Option<Property>) {
        let text = String::from_utf8_lossy(property.as_ref().map_or(&[], |it| &it.value));
        let pairs = text.lines().filter_map(|line| line.split_once(':'));
        self.0
            .extend(pairs.map(|(name, value)| (name.trim().into(), value.trim().into())));
    }

    /// https://specifications.freedesktop.org/xsettings-spec/latest/
    pub fn add_xsettings(&mut self, property: Option<Property>) {
        let Some(bytes) = property.map(|it| it.value).filter(|it| it.u8(0) == 0) else {
            return;
        };
        let (text, mut at) = (
            |at, length| String::from_utf8_lossy(bytes.part(at, length)).into_owned(),
            12,
        );
        for _ in 0..bytes.u32(8).min(1024) {
            let (kind, length) = (bytes.u8(at), usize::from(bytes.u16(at + 2)));
            let name = text(at + 4, length);
            at += 8 + padded(length);
            let length = bytes.u32(at) as usize;
            match kind {
                0 => self.0.push((name, bytes.i32(at).to_string())),
                1 => self.0.push((name, text(at + 4, length))),
                _ => {}
            }
            at = at.saturating_add([4, 4 + padded(length), 8][usize::from(kind.min(2))]);
        }
    }

    pub fn get(&self, name: &str) -> Option<&str> {
        self.0
            .iter()
            .find(|it| it.0 == name)
            .map(|it| it.1.as_str())
    }

    pub fn number(&self, name: &str) -> Option<f32> {
        self.get(name)?.parse().ok().filter(|it| *it > 0.)
    }

    pub fn scale(&self) -> f32 {
        let mut from_environment = ["GDK_SCALE"].into_iter().map(std::env::var);
        let chosen = from_environment.find_map(|it| it.ok()?.parse().ok());
        let dpi = || {
            self.number("Xft.dpi")
                .or_else(|| Some(self.number("Xft/DPI")? / 1024.))
        };
        chosen
            .or_else(|| Some(dpi()? / 96.))
            .unwrap_or(1f32)
            .clamp(0.5, 8.)
    }
}

/// In pixels of the screen.
struct Monitor {
    id: u32,
    is_primary: bool,
    area: [i32; 4],
    frequency: f32,
}

fn monitors(x: &Connection, randr: u8) -> Option<Vec<Monitor>> {
    let (monitors, resources) = (
        x.ask(Request::new(randr, 42).words(&[x.screen.root, 1])),
        x.ask(Request::new(randr, 25).u32(x.screen.root)),
    );
    let (monitors, resources) = (x.reply(monitors), x.reply(resources).unwrap_or_default());
    let [controllers, outputs, modes] = [16, 18, 20].map(|at| usize::from(resources.u16(at)));
    let modes = resources.part(32 + (controllers + outputs) * 4, modes * 32);
    let controllers = resources.part(32, controllers * 4).words().into_iter();
    let controllers: Vec<_> = controllers
        .map(|it| x.ask(Request::new(randr, 20).words(&[it, resources.u32(8)])))
        .collect();
    let controllers: Vec<_> = controllers
        .into_iter()
        .filter_map(|cookie| x.reply(cookie).ok())
        .collect();
    let frequency = |left: i16, top: i16| {
        let controller = controllers
            .iter()
            .find(|it| it.u32(20) != 0 && (it.i16(12), it.i16(14)) == (left, top))?;
        let mode = modes
            .as_chunks::<32>()
            .0
            .iter()
            .find(|mode| mode.u32(0) == controller.u32(20))?;
        let (is_interlaced, scans_twice) = (mode.u32(28) & 16 != 0, mode.u32(28) & 32 != 0);
        let lines = f32::from(mode.u16(24))
            * if scans_twice {
                2.
            } else if is_interlaced {
                0.5
            } else {
                1.
            };
        Some(mode.u32(8) as f32 / (f32::from(mode.u16(16)) * lines)).filter(|it| it.is_finite())
    };
    let (monitors, mut at) = (monitors.ok()?, 32);
    let monitors = (0..monitors.u32(12).min(64)).map(|_| {
        let monitor = monitors.part(at, 24);
        at += 24 + usize::from(monitor.u16(6)) * 4;
        Monitor {
            id: monitor.u32(0),
            is_primary: monitor.u8(4) != 0,
            area: [
                monitor.i16(8).into(),
                monitor.i16(10).into(),
                monitor.u16(12).into(),
                monitor.u16(14).into(),
            ],
            frequency: frequency(monitor.i16(8), monitor.i16(10)).unwrap_or(0.),
        }
    });
    Some(monitors.collect())
}

pub fn read(x11: &X11) -> Vec<Display> {
    let (x, scale) = (&x11.x, x11.scale.get());
    let [areas, desktop] = [atom::_NET_WORKAREA, atom::_NET_CURRENT_DESKTOP]
        .map(|it| x.ask_for_property(x.screen.root, x11.atom(it), false));
    let monitors = x11
        .randr
        .and_then(|randr| monitors(x, randr.opcode))
        .filter(|it| !it.is_empty());
    let [areas, desktop] =
        [areas, desktop].map(|it| x.property(it).map(|it| it.value).unwrap_or_default());
    let work_area = areas.part(desktop.u32(0) as usize % 64 * 16, 16);
    let mut monitors = monitors.unwrap_or_else(|| {
        let area = [0, 0, x.screen.size.0.into(), x.screen.size.1.into()];
        vec![Monitor {
            id: x.screen.root,
            is_primary: true,
            area,
            frequency: 0.,
        }]
    });
    monitors.sort_by_key(|it| !it.is_primary);
    let logical = |area: [i32; 4]| {
        let [x, y, width, height] = area.map(|it| it as f32 / scale);
        Rect {
            x,
            y,
            width,
            height,
        }
    };
    let describe = |Monitor {
                        id,
                        area,
                        frequency,
                        ..
                    }: Monitor| {
        let [left, top] = [0, 1].map(|axis| area[axis].max(work_area.i32(axis * 4)));
        let [right, bottom] = [0, 1].map(|axis| {
            (area[axis] + area[axis + 2]).min(work_area.i32(axis * 4) + work_area.i32(axis * 4 + 8))
        });
        let free = if right > left && bottom > top {
            [left, top, right - left, bottom - top]
        } else {
            area
        };
        Display {
            id: id.into(),
            bounds: logical(area),
            work_area: logical(free),
            scale,
            frequency,
        }
    };
    monitors.into_iter().map(describe).collect()
}
