//! The title bar, border and resize handles of a window whose compositor draws none, and the buttons of a window whose
//! content is its title bar.

use gpui::{App, CursorStyle, ResizeEdge, Window, WindowButton};
use serde::{Deserialize, Serialize};

use crate::abi::{self, Item, LineStyle, Rect, RoundedRect, Span, TextRun};
use crate::paint::scene::{Scene, outset};
use crate::surface::contains;
use crate::text::{self, Description, Line};
use crate::window::{Metrics, WindowState, is_dark};

pub const TITLEBAR_HEIGHT: f32 = 36.;
const RESIZE_BORDER: f32 = 5.;
const IS_WINDOWS: bool = cfg!(target_os = "windows");
const BUTTON: f32 = if IS_WINDOWS { 46. } else { 24. };
const GAP: f32 = if IS_WINDOWS { 0. } else { 13. };
const OUTER_MARGIN: f32 = if IS_WINDOWS { 0. } else { 10. };
const INNER_MARGIN: f32 = if IS_WINDOWS { 0. } else { 5. };

#[derive(Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Overlay {
    height: f32,
    color: Option<u32>,
    symbol_color: Option<u32>,
}

#[derive(Clone, Copy, PartialEq)]
pub enum Part {
    Edge(ResizeEdge),
    Button(WindowButton),
    Drag,
}

pub type Buttons = Vec<(WindowButton, Rect)>;

pub fn default_background(window: &Window) -> u32 {
    if is_dark(window.appearance()) {
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
            ((true, true, ..), _) => Some(ResizeEdge::TopLeft),
            ((_, true, true, _), _) => Some(ResizeEdge::TopRight),
            ((true, .., true), _) => Some(ResizeEdge::BottomLeft),
            ((.., true, true), _) => Some(ResizeEdge::BottomRight),
            (_, (true, ..)) => Some(ResizeEdge::Left),
            (_, (_, true, ..)) => Some(ResizeEdge::Top),
            (_, (.., true, _)) => Some(ResizeEdge::Right),
            (_, (.., true)) => Some(ResizeEdge::Bottom),
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

pub fn cursor(part: Part) -> CursorStyle {
    match part {
        Part::Edge(ResizeEdge::Top | ResizeEdge::Bottom) => CursorStyle::ResizeUpDown,
        Part::Edge(ResizeEdge::Left | ResizeEdge::Right) => CursorStyle::ResizeLeftRight,
        Part::Edge(ResizeEdge::TopLeft | ResizeEdge::BottomRight) => {
            CursorStyle::ResizeUpLeftDownRight
        }
        Part::Edge(ResizeEdge::TopRight | ResizeEdge::BottomLeft) => {
            CursorStyle::ResizeUpRightDownLeft
        }
        _ => CursorStyle::Arrow,
    }
}

fn place_buttons(width: f32, height: f32, window: &Window, cx: &App) -> Buttons {
    let default_layout = [
        WindowButton::Minimize,
        WindowButton::Maximize,
        WindowButton::Close,
    ];
    let (left, right) = match cx.button_layout() {
        Some(layout) => (layout.left, layout.right),
        None => ([None; 3], default_layout.map(Some)),
    };
    let controls = window.window_controls();
    let shown = |side: [Option<WindowButton>; 3]| {
        side.into_iter().flatten().filter(|button| match button {
            WindowButton::Minimize => controls.minimize && window.is_minimizable(),
            WindowButton::Maximize => controls.maximize && window.is_resizable(),
            WindowButton::Close => true,
        })
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

pub fn overlay_insets(window: &Window, cx: &App) -> [f32; 2] {
    taken_by(&place_buttons(1e4, 0., window, cx), 1e4)
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

/// In a square of 24 pixels.
fn symbol_path(button: WindowButton, is_maximized: bool) -> &'static str {
    match (button, is_maximized) {
        (WindowButton::Minimize, _) if IS_WINDOWS => "M7 12.5h10",
        (WindowButton::Maximize, false) if IS_WINDOWS => "M7.5 7.5h9v9h-9z",
        (WindowButton::Maximize, true) if IS_WINDOWS => "M7.5 9.5h7v7h-7zM9.5 9.5v-2h7v7h-2",
        (WindowButton::Minimize, _) => "M8 15h8",
        (WindowButton::Maximize, false) => "M9 9h6v6h-6z",
        (WindowButton::Maximize, true) => "M10 10h4v4h-4z",
        (WindowButton::Close, _) => "M7 7l10 10m0-10l-10 10",
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

pub fn build(state: &WindowState, window: &Window, cx: &App) -> (Scene, Buttons) {
    let (metrics, options) = (state.metrics.get(), state.options.borrow());
    let [surface, mut text, border] = match is_dark(window.appearance()) {
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
        buttons = place_buttons(bar.width, bar.height, window, cx);
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
    } else if let Some(overlay) = options.overlay.filter(|_| !window.is_fullscreen()) {
        buttons = place_buttons(metrics.width, overlay.height, window, cx);
        text = overlay.symbol_color.unwrap_or(text);
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
                color: overlay.color.unwrap_or(surface),
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
            },
            color,
        });
        let icon = format!(
            r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="{}" fill="none" stroke="#{:06x}" stroke-width="{}"/></svg>"##,
            symbol_path(button, window.is_maximized()),
            symbol >> 8,
            if IS_WINDOWS { 1 } else { 2 },
        );
        let (x, y) = (
            rect.x + (rect.width - 24.) / 2.,
            rect.y + ((rect.height - 24.) / 2.).floor(),
        );
        let rect = Rect {
            x,
            y,
            width: 24.,
            height: 24.,
        };
        let start = scene.bytes.len() as u32;
        scene.bytes.extend(icon.as_bytes());
        let mut hasher = std::hash::DefaultHasher::new();
        std::hash::Hash::hash(&icon, &mut hasher);
        let source = Span {
            start,
            end: scene.bytes.len() as u32,
        };
        scene.items.push(Item::Svg {
            clip: outset(rect, if IS_WINDOWS { -7. } else { -8. }),
            rect,
            source,
            hash: std::hash::Hasher::finish(&hasher),
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
