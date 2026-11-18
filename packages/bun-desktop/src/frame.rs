//! The title bar, border and resize handles of a window whose compositor draws none, and the buttons of a window whose
//! content is its title bar.

use crate::abi::{
    self, Item, LineStyle, Outline, PathVerb, Rect, RoundedRect, Span, Stroke, TextRun,
};
use crate::paint::scene::Scene;
use crate::platform::{Cursor, Edge, Geometry, WindowButton};
use crate::surface::contains;
use crate::text::{self, Description, Line};
use crate::window::{Metrics, Options, WindowState};
use crate::{app, host};

pub const TITLEBAR_HEIGHT: f32 = 36.;
const RESIZE_BORDER: f32 = 5.;
const IS_WINDOWS: bool = cfg!(target_os = "windows");
const BUTTON: f32 = if IS_WINDOWS { 46. } else { 24. };
const GAP: f32 = if IS_WINDOWS { 0. } else { 13. };
const OUTER_MARGIN: f32 = if IS_WINDOWS { 0. } else { 10. };
const INNER_MARGIN: f32 = if IS_WINDOWS { 0. } else { 5. };

#[derive(Clone, Copy, PartialEq)]
pub enum Part {
    Edge(Edge),
    Button(WindowButton),
    Drag,
}

pub type Buttons = Vec<(WindowButton, Rect)>;

pub fn default_background() -> u32 {
    if app::is_dark() {
        0x1e1e_1eff
    } else {
        0xffff_ffff
    }
}

pub fn part_at(metrics: &Metrics, buttons: &Buttons, x: f32, y: f32) -> Option<Part> {
    if metrics.has_resize_handles {
        let near = |reach: f32| {
            (
                x < reach,
                y < reach,
                x >= metrics.width - reach,
                y >= metrics.height - reach,
            )
        };
        let edge = match (near(RESIZE_BORDER * 2.), near(RESIZE_BORDER)) {
            ((true, true, ..), _) => Some(Edge::TopLeft),
            ((_, true, true, _), _) => Some(Edge::TopRight),
            ((true, .., true), _) => Some(Edge::BottomLeft),
            ((.., true, true), _) => Some(Edge::BottomRight),
            (_, (true, ..)) => Some(Edge::Left),
            (_, (_, true, ..)) => Some(Edge::Top),
            (_, (.., true, _)) => Some(Edge::Right),
            (_, (.., true)) => Some(Edge::Bottom),
            _ => None,
        };
        if let Some(edge) = edge {
            return Some(Part::Edge(edge));
        }
    }
    let button = buttons.iter().find(|(_, rect)| contains(*rect, x, y));
    button
        .map(|(button, _)| Part::Button(*button))
        .or((y < metrics.content.y).then_some(Part::Drag))
}

pub fn cursor(part: Part) -> Cursor {
    match part {
        Part::Edge(Edge::Top | Edge::Bottom) => Cursor::ResizeUpDown,
        Part::Edge(Edge::Left | Edge::Right) => Cursor::ResizeLeftRight,
        Part::Edge(Edge::TopLeft | Edge::BottomRight) => Cursor::ResizeUpLeftDownRight,
        Part::Edge(Edge::TopRight | Edge::BottomLeft) => Cursor::ResizeUpRightDownLeft,
        _ => Cursor::Arrow,
    }
}

fn place_buttons(width: f32, height: f32, options: &Options) -> Buttons {
    let usual = || {
        [
            vec![],
            vec![
                WindowButton::Minimize,
                WindowButton::Maximize,
                WindowButton::Close,
            ],
        ]
    };
    let [left, right] = host::platform()
        .ok()
        .and_then(|it| it.button_layout())
        .unwrap_or_else(usual);
    let shown = |mut side: Vec<WindowButton>| {
        side.retain(|button| match button {
            WindowButton::Minimize => options.minimizable,
            WindowButton::Maximize => options.resizable,
            WindowButton::Close => true,
        });
        side.into_iter()
    };
    let button_height = if IS_WINDOWS { height } else { BUTTON };
    let rect = |x: f32| Rect {
        x,
        y: ((height - button_height) / 2.).floor(),
        width: BUTTON,
        height: button_height,
    };
    let inset = |index: usize| OUTER_MARGIN + index as f32 * (BUTTON + GAP);
    let left = shown(left)
        .enumerate()
        .map(|(index, button)| (button, rect(inset(index))));
    let right = shown(right)
        .rev()
        .enumerate()
        .map(|(index, button)| (button, rect(width - BUTTON - inset(index))));
    left.chain(right).collect()
}

/// How much of the title bar the buttons take on the left and on the right.
fn taken_by(buttons: &Buttons, width: f32) -> [f32; 2] {
    buttons.iter().fold([0.; 2], |[left, right], (_, rect)| {
        match rect.x < width / 2. {
            true => [left.max(rect.x + rect.width + INNER_MARGIN), right],
            false => [left, right.max(width - rect.x + INNER_MARGIN)],
        }
    })
}

pub fn overlay_insets(options: &Options) -> [f32; 2] {
    taken_by(&place_buttons(1e4, 0., options), 1e4)
}

/// The colors of the background and the symbol.
fn button_colors(
    button: WindowButton,
    symbol: u32,
    is_hovered: bool,
    is_pressed: bool,
) -> (u32, u32) {
    let [at_rest, hovered, pressed] = if IS_WINDOWS {
        [0, 0x1A, 0x33]
    } else {
        [0x19, 0x26, 0x4D]
    };
    match (is_hovered, is_pressed) {
        (true, _) if IS_WINDOWS && button == WindowButton::Close => (
            if is_pressed { 0xE811_2398 } else { 0xE811_23FF },
            0xFFFF_FFFF,
        ),
        (true, true) => (symbol & !0xFF | pressed, symbol),
        (true, false) => (symbol & !0xFF | hovered, symbol),
        _ => (symbol & !0xFF | at_rest, symbol),
    }
}

/// Lines in a square of 24 pixels.
fn symbol_lines(button: WindowButton, is_maximized: bool) -> &'static [&'static [[f32; 2]]] {
    match (button, is_maximized) {
        (WindowButton::Minimize, _) if IS_WINDOWS => &[&[[7., 12.5], [17., 12.5]]],
        (WindowButton::Maximize, false) if IS_WINDOWS => &[&[
            [7.5, 7.5],
            [16.5, 7.5],
            [16.5, 16.5],
            [7.5, 16.5],
            [7.5, 7.],
        ]],
        (WindowButton::Maximize, true) if IS_WINDOWS => &[
            &[
                [7.5, 9.5],
                [14.5, 9.5],
                [14.5, 16.5],
                [7.5, 16.5],
                [7.5, 9.],
            ],
            &[
                [9.5, 9.5],
                [9.5, 7.5],
                [16.5, 7.5],
                [16.5, 14.5],
                [14.5, 14.5],
            ],
        ],
        (WindowButton::Minimize, _) => &[&[[8., 15.], [16., 15.]]],
        (WindowButton::Maximize, false) => {
            &[&[[9., 9.], [15., 9.], [15., 15.], [9., 15.], [9., 8.]]]
        }
        (WindowButton::Maximize, true) => {
            &[&[[10., 10.], [14., 10.], [14., 14.], [10., 14.], [10., 9.]]]
        }
        (WindowButton::Close, _) if IS_WINDOWS => {
            &[&[[7., 7.], [17., 17.]], &[[17., 7.], [7., 17.]]]
        }
        (WindowButton::Close, _) => &[&[[8.5, 8.5], [15.5, 15.5]], &[[15.5, 8.5], [8.5, 15.5]]],
    }
}

fn add_title(scene: &mut Scene, title: &str, area: Rect, color: u32) {
    const SIZE: f32 = 13.;
    let font = text::describe(Description::new(b"\x01system-ui\0\x01sans-serif\0", 600.));
    let run = TextRun {
        end: title.len() as u32,
        font,
        size: SIZE,
        letter_spacing: 0.,
        word_spacing: 0.,
        word_break: abi::BREAK_NORMAL,
    };
    let (line, metrics) = (
        Line::new(title, run, abi::DIRECTION_AUTO),
        text::metrics(font, SIZE),
    );
    let x = area.x + ((area.width - line.width) / 2.).max(0.);
    let y = area.y + (area.height + metrics.ascent - metrics.descent) / 2.;
    scene.items.push(Item::PushClip(RoundedRect {
        rect: area,
        ..RoundedRect::default()
    }));
    for (face, glyphs) in line.runs {
        let start = scene.glyphs.len() as u32;
        scene.glyphs.extend(glyphs);
        scene.items.push(Item::Text {
            origin: [x, y],
            bounds: area,
            face: face.id,
            size: face.size,
            glyphs: Span {
                start,
                end: scene.glyphs.len() as u32,
            },
            color,
            blur: 0.,
        });
    }
    scene.items.push(Item::Pop);
}

pub fn build(state: &WindowState, geometry: &Geometry) -> (Scene, Buttons) {
    let (metrics, options) = (state.metrics.get(), state.options.borrow());
    let [surface, mut text, border] = match app::is_dark() {
        true => [0x2b2b_2bff, 0xeded_edff, 0x4545_45ff],
        false => [0xf6f6_f6ff, 0x1717_17ff, 0xd4d4_d4ff_u32],
    };
    let outline = |width: f32, height: f32, widths: [f32; 4]| Item::Border {
        shape: RoundedRect {
            rect: Rect {
                x: 0.,
                y: 0.,
                width,
                height,
            },
            ..RoundedRect::default()
        },
        widths,
        colors: [border; 4],
        styles: [LineStyle::Solid; 4],
    };
    let (mut scene, mut buttons) = (Scene::default(), Buttons::new());
    if metrics.content.y > 0. {
        let bar = Rect {
            x: 0.,
            y: 0.,
            width: metrics.width,
            height: TITLEBAR_HEIGHT,
        };
        scene.items.push(Item::Fill {
            shape: RoundedRect {
                rect: bar,
                ..RoundedRect::default()
            },
            color: surface,
        });
        scene
            .items
            .push(outline(bar.width, bar.height, [0., 0., 1., 0.]));
        buttons = place_buttons(bar.width, bar.height, &options);
        let [left, right] = taken_by(&buttons, bar.width);
        let margin = left.max(right);
        add_title(
            &mut scene,
            &options.title,
            Rect {
                x: margin,
                width: (bar.width - margin * 2.).max(0.),
                ..bar
            },
            text,
        );
    } else if let Some(overlay) = options.overlay.get().filter(|_| !geometry.is_fullscreen) {
        buttons = place_buttons(metrics.width, overlay.height, &options);
        text = overlay.symbol_color.get().unwrap_or(text);
        let [left, right] = taken_by(&buttons, metrics.width);
        for (x, width) in [(0., left), (metrics.width - right, right)] {
            let shape = RoundedRect {
                rect: Rect {
                    x,
                    y: 0.,
                    width,
                    height: overlay.height,
                },
                ..RoundedRect::default()
            };
            scene.items.push(Item::Fill {
                shape,
                color: overlay.color.get().unwrap_or(surface),
            });
        }
    }
    for &(button, rect) in &buttons {
        let is_hovered = state.pointer.hovered_part() == Some(Part::Button(button));
        let (color, symbol) = button_colors(button, text, is_hovered, state.pointer.is_pressed());
        let radius = if IS_WINDOWS { 0. } else { BUTTON / 2. };
        scene.items.push(Item::Fill {
            shape: RoundedRect {
                rect,
                radii: [[radius; 2]; 4],
                smoothing: 0.,
            },
            color,
        });
        let (x, y) = (
            rect.x + (rect.width - 24.) / 2.,
            rect.y + ((rect.height - 24.) / 2.).floor(),
        );
        let start = scene.verbs.len() as u32;
        for line in symbol_lines(button, geometry.is_maximized) {
            let mut points = line.iter().map(|it| [x + it[0], y + it[1]]);
            scene.verbs.extend(
                points
                    .next()
                    .map(PathVerb::Move)
                    .into_iter()
                    .chain(points.map(PathVerb::Line)),
            );
        }
        let outline = Outline {
            verbs: Span {
                start,
                end: scene.verbs.len() as u32,
            },
            bounds: Rect {
                x,
                y,
                width: 24.,
                height: 24.,
            },
            stroke: Stroke {
                width: if IS_WINDOWS { 1. } else { 2. },
                miter_limit: 4.,
                ..Stroke::default()
            },
            ..Outline::default()
        };
        scene.items.push(Item::Path {
            outline,
            color: symbol | 0xff,
        });
    }
    if metrics.has_border {
        scene
            .items
            .push(outline(metrics.width, metrics.height, [1.; 4]));
    }
    scene.index();
    (scene, buttons)
}
