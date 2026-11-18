//! Logical pixels have another size on each display, so the displays are put next to each other anew.

use std::cell::RefCell;

use super::taskbar::dictionary;
use crate::abi::Rect;
use crate::platform::{Display, Point};
use crate::protocol::PreferenceValue as Value;
use crate::win32::*;

#[derive(Clone)]
pub struct Monitor {
    handle: Handle,
    pub area: DeviceRect,
    pub display: Display,
}

thread_local! {
    static MONITORS: RefCell<Vec<Monitor>> = RefCell::default();
}

fn describe(handle: Handle) -> Option<(Monitor, DeviceRect)> {
    let mut info = MonitorInfoExW {
        cb_size: size_of::<MonitorInfoExW>() as u32,
        ..Default::default()
    };
    let (mut dpi, mut mode) = (
        96,
        DevModeW {
            dm_size: size_of::<DevModeW>() as u16,
            ..Default::default()
        },
    );
    succeeded(GetMonitorInfoW(handle, &mut info)).ok()?;
    _ = GetDpiForMonitor(handle, MDT_EFFECTIVE_DPI, &mut dpi, &mut 0);
    // SAFETY: there is a zero at the end of the name.
    unsafe { EnumDisplaySettingsW(info.sz_device.as_ptr(), ENUM_CURRENT_SETTINGS, &mut mode) };
    let id = info.sz_device.iter().fold(0x811c_9dc5_u32, |hash, unit| {
        (hash ^ u32::from(*unit)).wrapping_mul(0x0100_0193)
    });
    let frequency = Some(mode.dm_display_frequency)
        .filter(|it| *it > 1)
        .unwrap_or(0) as f32;
    let display = Display {
        id: id.into(),
        bounds: Rect::default(),
        work_area: Rect::default(),
        scale: dpi as f32 / 96.,
        frequency,
    };
    Some((
        Monitor {
            handle,
            area: info.rc_monitor,
            display,
        },
        info.rc_work,
    ))
}

/// Where a display begins that touches `placed`.
fn beside(placed: &Monitor, area: DeviceRect, (width, height): (f32, f32)) -> Option<(f32, f32)> {
    let (other, bounds, scale) = (placed.area, placed.display.bounds, placed.display.scale);
    let along = |start: i32,
                 end: i32,
                 other_start: i32,
                 other_end: i32,
                 origin: f32,
                 length: f32,
                 own: f32| match end == other_end {
        true if start != other_start => origin + length - own,
        _ if start < other_start => {
            origin - (other_start - start) as f32 / (end - start) as f32 * own
        }
        _ => origin + (start - other_start) as f32 / scale,
    };
    let x = along(
        area.left,
        area.right,
        other.left,
        other.right,
        bounds.x,
        bounds.width,
        width,
    )
    .round();
    let y = along(
        area.top,
        area.bottom,
        other.top,
        other.bottom,
        bounds.y,
        bounds.height,
        height,
    )
    .round();
    let (shares_rows, shares_columns) = (
        area.top <= other.bottom && area.bottom >= other.top,
        area.left <= other.right && area.right >= other.left,
    );
    match () {
        () if shares_rows && area.left == other.right => Some((bounds.x + bounds.width, y)),
        () if shares_rows && area.right == other.left => Some((bounds.x - width, y)),
        () if shares_columns && area.top == other.bottom => Some((x, bounds.y + bounds.height)),
        () if shares_columns && area.bottom == other.top => Some((x, bounds.y - height)),
        () => None,
    }
}

fn read() -> Vec<Monitor> {
    unsafe extern "system" fn add(
        monitor: Handle,
        _: Handle,
        _: *mut DeviceRect,
        all: isize,
    ) -> Bool {
        // SAFETY: the vector below.
        unsafe { &mut *(all as *mut Vec<Handle>) }.push(monitor);
        1
    }
    let mut handles = Vec::<Handle>::new();
    // SAFETY: what `add` expects.
    unsafe { EnumDisplayMonitors(0, None, add, (&raw mut handles) as isize) };
    let mut left: Vec<_> = handles.into_iter().filter_map(describe).collect();
    left.sort_by_key(|(it, _)| (it.area.left, it.area.top) != (0, 0));
    let mut placed = Vec::<Monitor>::new();
    while !left.is_empty() {
        let size = |it: &Monitor| {
            (
                (it.area.width() as f32 / it.display.scale).ceil(),
                (it.area.height() as f32 / it.display.scale).ceil(),
            )
        };
        let touching = left.iter().enumerate().find_map(|(index, (it, _))| {
            Some((
                index,
                placed
                    .iter()
                    .find_map(|other| beside(other, it.area, size(it)))?,
            ))
        });
        let (index, (x, y)) =
            touching.unwrap_or((0, (left[0].0.area.left as f32, left[0].0.area.top as f32)));
        let (mut monitor, work) = left.remove(index);
        let ((width, height), scale) = (size(&monitor), monitor.display.scale);
        let inset = |from: i32, to: i32| ((to - from) as f32 / scale).round();
        let (dx, dy) = (
            inset(monitor.area.left, work.left),
            inset(monitor.area.top, work.top),
        );
        monitor.display.bounds = Rect {
            x,
            y,
            width,
            height,
        };
        monitor.display.work_area = Rect {
            x: x + dx,
            y: y + dy,
            width: width - dx - inset(work.right, monitor.area.right),
            height: height - dy - inset(work.bottom, monitor.area.bottom),
        };
        placed.push(monitor);
    }
    placed
}

fn monitors() -> Vec<Monitor> {
    MONITORS.with_borrow_mut(|all| {
        if all.is_empty() {
            *all = read();
        }
        all.clone()
    })
}

pub fn all() -> Vec<Display> {
    monitors().into_iter().map(|it| it.display).collect()
}

pub fn areas() -> Vec<DeviceRect> {
    monitors().into_iter().map(|it| it.area).collect()
}

/// What a display is connected with, and what it calls itself.
fn target_of(device: &[u16; 32]) -> Option<DisplayConfigTargetDeviceName> {
    let (mut paths, mut modes) = ([DisplayConfigPathInfo::default(); 32], [[0u64; 8]; 96]);
    let (mut count, mut count_of_modes) = (paths.len() as u32, modes.len() as u32);
    // SAFETY: arrays with their lengths, and structures that start with what they are and their size.
    unsafe {
        (QueryDisplayConfig(
            QDC_ONLY_ACTIVE_PATHS,
            &mut count,
            paths.as_mut_ptr(),
            &mut count_of_modes,
            modes.as_mut_ptr().cast(),
            0,
        ) == 0)
            .then_some(())?;
        paths[..count as usize].iter().find_map(|path| {
            let header = |kind, size: usize, adapter_id, id| DisplayConfigDeviceInfoHeader {
                r#type: kind,
                size: size as u32,
                adapter_id,
                id,
            };
            let mut source = DisplayConfigSourceDeviceName {
                header: header(
                    1,
                    size_of::<DisplayConfigSourceDeviceName>(),
                    path.source_adapter,
                    path.source,
                ),
                ..Default::default()
            };
            let mut target = DisplayConfigTargetDeviceName {
                header: header(
                    2,
                    size_of::<DisplayConfigTargetDeviceName>(),
                    path.target_adapter,
                    path.target,
                ),
                ..Default::default()
            };
            let is_meant = DisplayConfigGetDeviceInfo((&raw mut source).cast()) == 0
                && string_in(&source.view_gdi_device_name) == string_in(device);
            (is_meant && DisplayConfigGetDeviceInfo((&raw mut target).cast()) == 0)
                .then_some(target)
        })
    }
}

pub fn details(id: u64) -> Value {
    const BUILT_IN: [u32; 3] = [0x8000_0000, 11, 13];
    let Some(monitor) = monitors().into_iter().find(|it| it.display.id == id) else {
        return dictionary([]);
    };
    let mut info = MonitorInfoExW {
        cb_size: size_of::<MonitorInfoExW>() as u32,
        ..Default::default()
    };
    let mut mode = DevModeW {
        dm_size: size_of::<DevModeW>() as u16,
        ..Default::default()
    };
    GetMonitorInfoW(monitor.handle, &mut info);
    // SAFETY: there is a zero at the end of the name.
    unsafe { EnumDisplaySettingsW(info.sz_device.as_ptr(), ENUM_CURRENT_SETTINGS, &mut mode) };
    let target = target_of(&info.sz_device).unwrap_or_default();
    dictionary([
        (
            "internal",
            Value::Flag(BUILT_IN.contains(&target.output_technology)),
        ),
        (
            "label",
            Value::Text(string_in(&target.monitor_friendly_device_name).into()),
        ),
        (
            "nativeOrigin",
            dictionary([
                ("x", Value::Number(monitor.area.left.into())),
                ("y", Value::Number(monitor.area.top.into())),
            ]),
        ),
        (
            "rotation",
            Value::Number((mode.dm_display_orientation * 90).into()),
        ),
    ])
}

pub fn may_have_changed() {
    let before = all();
    MONITORS.take();
    crate::platform::displays_changed(&before, &all());
}

fn with_handle(handle: Handle) -> Monitor {
    let find = || monitors().into_iter().find(|it| it.handle == handle);
    // The window may hear of a new one first.
    let found = find().or_else(|| {
        may_have_changed();
        find()
    });
    found.unwrap_or(Monitor {
        handle,
        area: DeviceRect::default(),
        display: Display {
            id: 0,
            bounds: Rect::default(),
            work_area: Rect::default(),
            scale: 1.,
            frequency: 0.,
        },
    })
}

pub fn of_window(window: Handle) -> Monitor {
    with_handle(MonitorFromWindow(window, MONITOR_DEFAULTTONEAREST))
}

pub fn of_area(area: DeviceRect) -> Monitor {
    with_handle(MonitorFromRect(&area, MONITOR_DEFAULTTONEAREST))
}

/// The one that has most of it, or the nearest one.
pub fn matching(rect: Rect) -> Monitor {
    let overlap = |start: f32, length: f32, other: f32, other_length: f32| {
        (start + length).min(other + other_length) - start.max(other)
    };
    let score = |it: &Monitor| {
        let bounds = it.display.bounds;
        let (x, y) = (
            overlap(rect.x, rect.width, bounds.x, bounds.width),
            overlap(rect.y, rect.height, bounds.y, bounds.height),
        );
        if x >= 0. && y >= 0. {
            x * y
        } else {
            x.min(0.) + y.min(0.)
        }
    };
    monitors()
        .into_iter()
        .rev()
        .max_by(|a, b| score(a).total_cmp(&score(b)))
        .unwrap_or_else(|| with_handle(0))
}

pub fn logical(at: DevicePoint) -> Point {
    of_area(DeviceRect {
        left: at.x,
        top: at.y,
        right: at.x + 1,
        bottom: at.y + 1,
    })
    .logical(at)
}

pub fn logical_area(area: DeviceRect) -> Rect {
    let monitor = of_area(area);
    let (Point { x, y }, scale) = (
        monitor.logical(DevicePoint {
            x: area.left,
            y: area.top,
        }),
        monitor.display.scale,
    );
    Rect {
        x,
        y,
        width: area.width() as f32 / scale,
        height: area.height() as f32 / scale,
    }
}

impl Monitor {
    pub fn logical(&self, at: DevicePoint) -> Point {
        let Display { bounds, scale, .. } = self.display;
        Point {
            x: bounds.x + (at.x - self.area.left) as f32 / scale,
            y: bounds.y + (at.y - self.area.top) as f32 / scale,
        }
    }

    pub fn device(&self, at: Point) -> DevicePoint {
        let Display { bounds, scale, .. } = self.display;
        DevicePoint {
            x: self.area.left + ((at.x - bounds.x) * scale).round() as i32,
            y: self.area.top + ((at.y - bounds.y) * scale).round() as i32,
        }
    }
}
