//! `screen`

use bun_ui::protocol::Display;
use bun_ui::value::decimal;

use crate::generated_bindgen::base::{DesktopPoint, DesktopRectangle};
use crate::generated_bindgen::system::{DesktopScreen, js_DesktopScreen};
use crate::prelude::*;

#[derive(Default)]
struct State {
    /// As the listeners were last told.
    known: RefCell<Vec<Display>>,
}

state!(fn state() -> State);

pub(crate) fn object() -> JSValue {
    js_DesktopScreen::CLASS.constructor(heap())
}

notices_listeners!(DesktopScreen, object(), |_: &str| remember());

fn remember() -> JsResult<()> {
    if state().known.borrow().is_empty() {
        state().known.replace(displays()?);
    }
    Ok(())
}

/// There is at least one.
fn displays() -> JsResult<Vec<Display>> {
    let mut displays = answer((ui()?.displays)())?.into_vec();
    if displays.is_empty() {
        let bounds = Rect {
            x: 0.,
            y: 0.,
            width: 1280.,
            height: 800.,
        };
        displays.push(Display {
            id: 1,
            bounds,
            work_area: bounds,
            scale: 1.,
            frequency: 60.,
        });
    }
    Ok(displays)
}

fn best(score: impl Fn(Rect) -> f32) -> JsResult<Display> {
    let better = |a: Display, b: Display| {
        if score(b.bounds) > score(a.bounds) {
            b
        } else {
            a
        }
    };
    Ok(displays()?.into_iter().reduce(better).unwrap_or_default())
}

pub(crate) fn primary_display() -> JsResult<Display> {
    Ok(displays()?[0])
}

pub(crate) fn display_matching(a: Rect) -> JsResult<Display> {
    best(|b| {
        let width = (a.x + a.width).min(b.x + b.width) - a.x.max(b.x);
        let height = (a.y + a.height).min(b.y + b.height) - a.y.max(b.y);
        width.max(0.) * height.max(0.)
    })
}

fn display_nearest(Point { x, y }: Point) -> JsResult<Display> {
    best(|it| {
        -(it.x - x)
            .max(0.)
            .max(x - it.x - it.width)
            .hypot((it.y - y).max(0.).max(y - it.y - it.height))
    })
}

/// They are fractions where the scale is one.
pub(crate) fn whole(it: Rect) -> Rect {
    Rect {
        x: it.x.round(),
        y: it.y.round(),
        width: it.width.round(),
        height: it.height.round(),
    }
}

fn describe(mut it: Display) -> JsResult<JSValue> {
    (it.bounds, it.work_area) = (whole(it.bounds), whole(it.work_area));
    let size = |it: Rect| Size {
        width: it.width,
        height: it.height,
    };
    Ok(object!({
        "accelerometerSupport": "unknown",
        "bounds": it.bounds,
        "colorDepth": 24,
        "colorSpace": "{primaries:BT709, transfer:SRGB, matrix:RGB, range:FULL}",
        "depthPerComponent": 8,
        "detected": true,
        "displayFrequency": it.frequency.round(),
        "id": it.id,
        "internal": false,
        "label": "",
        "maximumCursorSize": Size::default(),
        "monochrome": false,
        "nativeOrigin": Point { x: it.bounds.x, y: it.bounds.y },
        "rotation": 0,
        "scaleFactor": decimal(it.scale),
        "size": size(it.bounds),
        "touchSupport": "unknown",
        "workArea": it.work_area,
        "workAreaSize": size(it.work_area),
    }))
}

pub(crate) fn changed(event: &str, id: u64) -> JsResult<()> {
    let now = displays()?.into_iter().find(|it| it.id == id);
    let before = {
        let mut known = state().known.borrow_mut();
        let at = known.iter().position(|it| it.id == id);
        let before = at.map(|at| known.remove(at));
        known.extend(now.or_else(|| before.filter(|_| event != "display-removed")));
        before
    };
    crate::window::displays_changed()?;
    let before = before.unwrap_or_else(|| Display {
        id,
        scale: 1.,
        ..Default::default()
    });
    match (event, now) {
        ("display-removed", _) => announce(object(), event, &[describe(before)?]),
        ("display-added", Some(now)) => announce(object(), event, &[describe(now)?]),
        (_, Some(now)) => {
            let metrics = [
                ("bounds", before.bounds != now.bounds),
                ("workArea", before.work_area != now.work_area),
                ("scaleFactor", before.scale != now.scale),
            ];
            let changed = metrics.into_iter().filter(|it| it.1).map(|it| it.0);
            let changed = js(changed.collect::<Vec<_>>())?;
            announce(object(), event, &[describe(now)?, changed])
        }
        // It is about to be removed.
        (_, None) => Ok(()),
    }
}

fn scaling(at: Point, power: i32) -> JsResult<impl Fn(f32) -> f32> {
    let scale = if IS_MAC {
        1.
    } else {
        display_nearest(at)?.scale.powi(power)
    };
    Ok(move |it: f32| (it * scale).round())
}

fn scale_point(point: &DesktopPoint, power: i32) -> JsResult<JSValue> {
    let (point, scale) = (Point::from(point), scaling(point.into(), power)?);
    js(Point {
        x: scale(point.x),
        y: scale(point.y),
    })
}

fn scale_rectangle(rectangle: &DesktopRectangle, power: i32) -> JsResult<JSValue> {
    let Rect {
        x,
        y,
        width,
        height,
    } = rectangle.or(Rect::default());
    let [x, y, width, height] = [x, y, width, height].map(scaling(Point { x, y }, power)?);
    js(Rect {
        x,
        y,
        width,
        height,
    })
}

impl DesktopScreen {
    pub(crate) fn get_all_displays(_: Cx<'_, '_>) -> JsResult<JSValue> {
        JSValue::create_array_from_iter(global(), displays()?.into_iter(), describe)
    }

    pub(crate) fn get_primary_display(_: Cx<'_, '_>) -> JsResult<JSValue> {
        describe(primary_display()?)
    }

    pub(crate) fn get_cursor_screen_point(_: Cx<'_, '_>) -> JsResult<JSValue> {
        js(answer((ui()?.cursor_position)())?)
    }

    pub(crate) fn get_display_nearest_point(
        _: Cx<'_, '_>,
        point: &DesktopPoint,
    ) -> JsResult<JSValue> {
        describe(display_nearest(point.into())?)
    }

    pub(crate) fn get_display_matching(
        _: Cx<'_, '_>,
        area: &DesktopRectangle,
    ) -> JsResult<JSValue> {
        describe(display_matching(area.or(Rect::default()))?)
    }

    pub(crate) fn dip_to_screen_point(_: Cx<'_, '_>, point: &DesktopPoint) -> JsResult<JSValue> {
        scale_point(point, 1)
    }

    pub(crate) fn screen_to_dip_point(_: Cx<'_, '_>, point: &DesktopPoint) -> JsResult<JSValue> {
        scale_point(point, -1)
    }

    pub(crate) fn dip_to_screen_rect<'a>(
        _: Cx<'a, '_>,
        _: JsLocal<'a>,
        it: &DesktopRectangle,
    ) -> JsResult<JSValue> {
        scale_rectangle(it, 1)
    }

    pub(crate) fn screen_to_dip_rect<'a>(
        _: Cx<'a, '_>,
        _: JsLocal<'a>,
        it: &DesktopRectangle,
    ) -> JsResult<JSValue> {
        scale_rectangle(it, -1)
    }
}
