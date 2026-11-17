//! What controls look like unless the page styles them.

use crate::abi::{Item, Outline, Rect, RoundedRect, Stroke};
use crate::boxes::BoxId;
use crate::color::mix_colors;
use crate::name::{is_name, name};
use crate::paint::{Painter, Space, alpha, fit, square};
use crate::path::Path;
use crate::properties::{Id, Style};
use crate::selector::Pseudo;
use crate::tree::{Element, State};
use crate::types::{Appearance, FillRule};

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Look {
    None,
    Button,
    TextField,
    SearchField,
    ListBox,
    MenuList,
    /// Only has the arrow.
    MenuListButton,
    Checkbox,
    Radio,
    Slider,
    SliderThumb,
    SpinButton,
    CancelButton,
    Progress,
    Meter,
}

bitflags::bitflags! {
    /// What the page has rules for.
    #[derive(Clone, Copy)]
    pub(crate) struct Styled: u8 {
        const DECORATION = 1;
        const SHADOW = 1 << 1;
    }
}

impl Styled {
    pub(crate) fn by(id: Id) -> Styled {
        match id {
            Id::BoxShadow => Styled::SHADOW,
            Id::BackgroundBlendMode | Id::BorderCollapse | Id::BorderShape => Styled::empty(),
            _ if id.name().starts_with("border-") || id.name().starts_with("background-") => {
                Styled::DECORATION
            }
            _ => Styled::empty(),
        }
    }
}

impl Look {
    /// For `appearance: auto`. Styles are shared, so the rules of the user agent have to differ where this does.
    pub(crate) fn of(element: &Element) -> Look {
        if let Pseudo::Part(part) = element.pseudo {
            return match () {
                () if part == name!("-webkit-slider-thumb") => Look::SliderThumb,
                () if part == name!("-webkit-inner-spin-button") => Look::SpinButton,
                () if part == name!("-webkit-search-cancel-button") => Look::CancelButton,
                () if part == name!("file-selector-button") => Look::Button,
                () => Look::None,
            };
        }
        match element.html_tag() {
            tag if tag == name!("button") => Look::Button,
            tag if tag == name!("textarea") => Look::TextField,
            tag if tag == name!("progress") => Look::Progress,
            tag if tag == name!("meter") => Look::Meter,
            tag if tag == name!("select") => match element.attribute(name!("size")) {
                Some("1") => Look::MenuList,
                None | Some("0") if !element.has(name!("multiple")) => Look::MenuList,
                _ => Look::ListBox,
            },
            tag if tag == name!("input") => match element.input_type() {
                kind if is_name!(kind, "button" | "submit" | "reset" | "color") => Look::Button,
                kind if is_name!(kind, "file" | "image" | "hidden") => Look::None,
                kind if kind == name!("checkbox") => Look::Checkbox,
                kind if kind == name!("radio") => Look::Radio,
                kind if kind == name!("range") => Look::Slider,
                kind if kind == name!("search") => Look::SearchField,
                _ => Look::TextField,
            },
            _ => Look::None,
        }
    }

    /// <https://drafts.csswg.org/css-ui/#appearance-switching>
    pub(crate) fn used(self, appearance: Appearance, styled: Styled) -> Look {
        let look = match (self, appearance) {
            (_, Appearance::None) | (Look::MenuList | Look::ListBox, Appearance::BaseSelect) => {
                Look::None
            }
            (Look::MenuList, Appearance::MenulistButton) => Look::MenuListButton,
            (Look::SearchField, Appearance::Textfield) => Look::TextField,
            (look, _) => look,
        };
        match look {
            Look::Button | Look::Progress | Look::Meter if styled.contains(Styled::DECORATION) => {
                Look::None
            }
            Look::TextField | Look::SearchField if !styled.is_empty() => Look::None,
            Look::MenuList if !styled.is_empty() => Look::MenuListButton,
            look => look,
        }
    }

    /// The width and the height.
    pub(crate) fn size(self, style: &Style) -> [Option<f32>; 2] {
        match self {
            Look::SliderThumb => [Some(16.0 * style.zoom); 2],
            Look::SpinButton if style.flow().is_vertical() => [None, Some(15.0 * style.zoom)],
            Look::SpinButton => [Some(15.0 * style.zoom), None],
            Look::CancelButton => {
                [Some((9.0 * style.font.size.0 / 13.0).clamp(5.0, 21.0).round()); 2]
            }
            _ => [None; 2],
        }
    }

    pub(crate) fn is_checkable(self) -> bool {
        matches!(self, Look::Checkbox | Look::Radio)
    }

    /// Instead of the background and the border.
    pub(crate) fn is_painted(self) -> bool {
        !matches!(
            self,
            Look::None | Look::ListBox | Look::MenuListButton | Look::Meter
        )
    }
}

/// Normal, hovered, pressed and disabled.
type Shades = [u32; 4];

struct Palette {
    border: Shades,
    accent: Shades,
    slider: Shades,
    background: Shades,
    fill: Shades,
    button_border: Shades,
    button_fill: Shades,
    lighten: u32,
}

const LIGHT: Palette = Palette {
    border: [0x7676_76ff, 0x4f4f_4fff, 0x8d8d_8dff, 0x7676_764d],
    accent: [0x0075_ffff, 0x005c_c8ff, 0x3793_ffff, 0x7676_764d],
    slider: [0x0075_ffff, 0x005c_c8ff, 0x3793_ffff, 0xcbcb_cbff],
    background: [0xffff_ffff, 0xffff_ffff, 0xffff_ffff, 0xffff_ff99],
    fill: [0xefef_efff, 0xe5e5_e5ff, 0xf5f5_f5ff, 0xefef_ef4d],
    button_border: [0x7676_76ff, 0x4f4f_4fff, 0x8d8d_8dff, 0x7676_764d],
    button_fill: [0xefef_efff, 0xe5e5_e5ff, 0xf5f5_f5ff, 0xefef_ef4d],
    lighten: 0xa9a9_a933,
};

const DARK: Palette = Palette {
    border: [0x8585_85ff, 0xacac_acff, 0x6e6e_6eff, 0x6262_62ff],
    accent: [0x99c8_ffff, 0xd1e6_ffff, 0x61a9_ffff, 0x7575_75ff],
    slider: [0x99c8_ffff, 0xd1e6_ffff, 0x61a9_ffff, 0x7575_75ff],
    background: [0x3b3b_3bff; 4],
    fill: [0x3b3b_3bff, 0x3b3b_3bff, 0x3b3b_3bff, 0x3636_36ff],
    button_border: [0x6b6b_6bff, 0x7b7b_7bff, 0x6161_61ff, 0x3636_36ff],
    button_fill: [0x6b6b_6bff, 0x7b7b_7bff, 0x6161_61ff, 0x3636_36ff],
    lighten: 0x3b3b_3bff,
};

fn forced_palette(is_dark: bool) -> Palette {
    let [text, face, highlight, gray] = [
        &b"buttontext"[..],
        b"buttonface",
        b"accentcolor",
        b"graytext",
    ]
    .map(|it| crate::color::forced(it, is_dark));
    let (border, accent) = (
        [text, highlight, highlight, gray],
        [highlight, highlight, highlight, gray],
    );
    Palette {
        border,
        accent,
        slider: accent,
        background: [face; 4],
        fill: [face; 4],
        button_border: border,
        button_fill: [face; 4],
        lighten: face,
    }
}

const DISABLED: usize = 3;

fn channels(color: u32) -> [f32; 3] {
    [24, 16, 8].map(|shift| (color >> shift & 0xff) as f32 / 255.0)
}

fn contrast(a: u32, b: u32) -> f32 {
    let [a, b] = [a, b].map(|color| {
        let [r, g, b] = channels(color).map(|it| {
            if it <= 0.04045 {
                it / 12.92
            } else {
                ((it + 0.055) / 1.055).powf(2.4)
            }
        });
        0.2126 * r + 0.7152 * g + 0.0722 * b + 0.05
    });
    a.max(b) / a.min(b)
}

fn lightness(color: u32) -> f32 {
    let [r, g, b] = channels(color);
    (r.max(g).max(b) + r.min(g).min(b)) / 2.0
}

/// With the same hue and saturation.
fn lightened(color: u32, by: f32) -> u32 {
    let (from, to) = (lightness(color), (lightness(color) * by).min(1.0));
    let (middle, pole) = (if to > 0.5 { 0xffff_ffff } else { 0xff }, |it: f32| {
        1.0 - (2.0 * it - 1.0).abs()
    });
    if pole(from) <= 0.0 {
        return mix_colors(color, middle, (to - from).abs());
    }
    let [r, g, b] = channels(color)
        .map(|it| ((to + (it - from) * pole(to) / pole(from)) * 255.0).round() as u32);
    r.min(255) << 24 | g.min(255) << 16 | b.min(255) << 8 | 0xff
}

fn inset(rect: Rect, x: f32, y: f32) -> Rect {
    rect.shrunk([y, x, y, x])
}

fn round(rect: Rect, radius: f32) -> RoundedRect {
    fit(rect, [[radius; 2]; 4])
}

impl Painter<'_> {
    fn stroke(&mut self, path: &Path, width: f32, color: u32, space: &Space) {
        let outline = self.outline_of(path, FillRule::Nonzero);
        let stroke = Stroke {
            width,
            miter_limit: 4.0,
            ..Stroke::default()
        };
        self.emit(
            &Item::Path {
                outline: Outline {
                    bounds: outline.bounds.grown(width * 2.0),
                    stroke,
                    ..outline
                },
                color,
            },
            space,
        );
    }

    /// Where it is, to a fraction of a pixel.
    fn fill_exactly(&mut self, shape: RoundedRect, color: u32, space: &Space) {
        let outline = self.outline_of(&Path::rounded_rect(&shape), FillRule::Nonzero);
        self.emit(&Item::Path { outline, color }, space);
    }

    fn ring(&mut self, rect: Rect, radius: f32, width: f32, color: u32, space: &Space) {
        self.stroke(
            &Path::rounded_rect(&round(inset(rect, width / 2.0, width / 2.0), radius)),
            width,
            color,
            space,
        );
    }

    pub(crate) fn menu_arrow(&mut self, style: &Style, rect: Rect, space: &Space) {
        let ([_, right, _, left], zoom) = (style.border(), style.zoom);
        let (width, height) = (8.0 * zoom, self.floor(4.0 * zoom));
        if style.flow().is_vertical() {
            let ([top, _, bottom, _], mode) = (style.border(), style.text.writing_mode);
            let y = if style.is_rtl() != (mode == crate::types::WritingMode::SidewaysLr) {
                rect.y + top + 3.5 * zoom
            } else {
                rect.bottom() - bottom - 11.5 * zoom
            };
            let [x, y] = [
                rect.x + self.floor(rect.width / 2.0) - self.floor(height / 2.0),
                self.floor(y),
            ];
            let [base, tip] = if matches!(
                mode,
                crate::types::WritingMode::VerticalRl | crate::types::WritingMode::SidewaysRl
            ) {
                [x + height, x]
            } else {
                [x, x + height]
            };
            return self.stroke(
                &Path::polygon(
                    [
                        [base, y],
                        [tip, y + self.floor(width / 2.0)],
                        [base, y + width],
                    ],
                    false,
                ),
                2.0 * zoom,
                style.color(),
                space,
            );
        }
        let x = if style.is_rtl() {
            rect.x + left + 3.5 * zoom
        } else {
            rect.right() - right - 11.5 * zoom
        };
        let [x, y] = [
            self.floor(x),
            rect.y + self.floor(rect.height / 2.0) - self.floor(height / 2.0),
        ];
        let width = self.floor(width).min(rect.right() - x);
        let points = [
            [x, y],
            [x + self.floor(width / 2.0), y + height],
            [x + width, y],
        ];
        self.stroke(
            &Path::polygon(points, false),
            2.0 * zoom,
            style.color(),
            space,
        );
    }

    pub(crate) fn grip(&mut self, rect: Rect, is_left: bool, space: &Space) {
        let environment = &self.document.environment;
        let pixel = (environment.scale / environment.zoom).ceil() / environment.scale;
        for (offset, color) in [(0.0, 0x99), (pixel, 0xffff_ff99)] {
            for part in [0.5, 0.75] {
                let [near, far] = [self.floor(rect.width * part), rect.width - pixel];
                let x = |from_start: f32| {
                    if is_left {
                        rect.right() - from_start
                    } else {
                        rect.x + from_start
                    }
                };
                let line = [
                    [x(far), rect.y + near + offset],
                    [x(near + offset), rect.y + far],
                ];
                self.stroke(&Path::polygon(line, false), pixel, color, space);
            }
        }
    }

    fn floor(&self, value: f32) -> f32 {
        let scale = self.document.environment.scale;
        (value * scale + 0.001).floor() / scale
    }

    /// The border box of a part, from the one of the control.
    fn part(&self, id: BoxId, part: crate::name::Name) -> Option<Rect> {
        let document = self.document;
        document.boxes[id].children.iter().find_map(|child| {
            let is_it = document
                .tree
                .element(document.boxes[*child].node)
                .is_some_and(|it| it.pseudo == Pseudo::Part(part));
            let found = if is_it {
                document.border_box(*child)
            } else {
                self.part(*child, part)?
            };
            Some(found.moved(document.offset_in_container(*child)))
        })
    }

    pub(crate) fn native_control(&mut self, id: BoxId, rect: Rect, space: &Space) {
        let document = self.document;
        let (style, Some(element)) = (
            &document.boxes[id].style,
            document.tree.element(document.boxes[id].node),
        ) else {
            return;
        };
        let owner = document
            .tree
            .element(element.originator)
            .filter(|_| matches!(element.pseudo, Pseudo::Part(_)))
            .unwrap_or(element);
        let (look, zoom) = (style.look, style.zoom);
        let state = if look == Look::SliderThumb {
            owner.state
        } else {
            element.state
        };
        let shade = match () {
            () if owner.state.contains(State::DISABLED) => DISABLED,
            () if look == Look::SpinButton && !owner.state.contains(State::READ_WRITE) => DISABLED,
            () if state.contains(State::HOVER | State::ACTIVE) => 2,
            () => usize::from(state.contains(State::HOVER)),
        };
        let is_checked = state.contains(State::CHECKED);
        let is_mixed = look == Look::Checkbox && state.contains(State::INDETERMINATE);
        let custom = style.ink.accent_color.0.map(|it| it.resolve(style.color()));
        let custom = custom.map(|it| {
            mix_colors(
                if style.dark { 0x1212_12ff } else { 0xffff_ffff },
                it | 0xff,
                alpha(it) as f32 / 255.0,
            )
        });
        let forced = (document.environment.forces_colors && style.takes_forced_colors())
            .then(|| forced_palette(style.dark));
        let (own, other) = forced.as_ref().map_or(
            if style.dark {
                (&DARK, &LIGHT)
            } else {
                (&LIGHT, &DARK)
            },
            |it| (it, it),
        );
        let against = |palette: &Palette| {
            if look.is_checkable() {
                palette.background[0]
            } else {
                palette.fill[0]
            }
        };
        let palette = match custom.filter(|_| {
            is_checked && shade != DISABLED || matches!(look, Look::Slider | Look::Progress)
        }) {
            Some(it)
                if contrast(it, against(own)) < 3.0
                    && contrast(it, against(other)) > contrast(it, against(own)) =>
            {
                other
            }
            _ => own,
        };
        let accented = |shades: &Shades, shade: usize| match custom {
            Some(custom) if shade == 0 => custom,
            Some(custom) if shade != DISABLED => {
                lightened(custom, lightness(shades[shade]) / lightness(shades[0]))
            }
            _ => shades[shade],
        };
        let base = |painter: &mut Self, shape: RoundedRect, shade: usize, color: u32| {
            if shade == DISABLED {
                painter.fill_exactly(shape, palette.lighten, space);
            }
            painter.fill_exactly(shape, color, space);
        };
        let groove = |painter: &mut Self, track: Rect, value: RoundedRect, shade: usize| {
            let (shape, mut inside) = (round(track, 40.0 * zoom), *space);
            base(painter, shape, shade, palette.fill[shade]);
            painter.clip(shape, &mut inside);
            painter.fill(value, accented(&palette.slider, shade), &inside);
            let border = if shade == DISABLED || forced.is_some() {
                palette.border[shade]
            } else {
                palette.border[shade] & !0xff | 0x80
            };
            painter.ring(track, 40.0 * zoom, zoom, border, space);
        };
        let axis = usize::from(style.flow().is_vertical());
        let starts_far =
            style.is_rtl() != (style.text.writing_mode == crate::types::WritingMode::SidewaysLr);
        let band = |thickness: f32, [start, end]: [f32; 2]| {
            let [from, to] = rect.span(1 - axis);
            let [from, to] = [
                from.max((from + to - thickness) / 2.0),
                to.min((from + to + thickness) / 2.0),
            ];
            if axis == 0 {
                Rect::from_edges(start, from, end, to)
            } else {
                Rect::from_edges(from, start, to, end)
            }
        };
        let [start, end] = rect.span(axis);
        match look {
            Look::Checkbox | Look::Radio => {
                let size = rect.width.min(rect.height);
                let rect = inset(rect, (rect.width - size) / 2.0, (rect.height - size) / 2.0);
                let radius = if look == Look::Radio {
                    size / 2.0
                } else {
                    2.0 * zoom
                };
                let (accent, background) =
                    (accented(&palette.accent, shade), palette.background[shade]);
                if size <= 2.0 {
                    return self.fill(square(rect), palette.border[shade], space);
                }
                base(
                    self,
                    round(inset(rect, zoom * 0.2, zoom * 0.2), radius),
                    shade,
                    background,
                );
                if look == Look::Radio || !is_checked && !is_mixed {
                    self.ring(
                        rect,
                        radius,
                        zoom,
                        if is_checked && shade != DISABLED {
                            accent
                        } else {
                            palette.border[shade]
                        },
                        space,
                    );
                }
                if look == Look::Radio {
                    if is_checked {
                        self.fill_exactly(
                            round(inset(rect, size * 0.2, size * 0.2), radius),
                            accent,
                            space,
                        );
                    }
                } else if is_mixed {
                    self.fill_exactly(round(rect, radius), accent, space);
                    self.fill_exactly(
                        round(inset(rect, size * 2.5 / 13.0, size * 5.5 / 13.0), radius),
                        background,
                        space,
                    );
                } else if is_checked {
                    self.fill_exactly(round(rect, radius), accent, space);
                    let points = [[0.2, 0.5], [0.4, 0.7], [0.8, 0.2]]
                        .map(|it| [rect.x + it[0] * size, rect.y + it[1] * size]);
                    self.stroke(
                        &Path::polygon(points, false),
                        size * 0.16,
                        background,
                        space,
                    );
                }
            }
            Look::Button if rect.width < 5.0 || rect.height < 5.0 => {
                self.fill(square(rect), palette.button_fill[shade], space)
            }
            Look::Button => {
                base(
                    self,
                    round(inset(rect, zoom * 0.2, zoom * 0.2), 2.0 * zoom),
                    shade,
                    palette.button_fill[shade],
                );
                self.ring(rect, 1.5 * zoom, zoom, palette.button_border[shade], space);
            }
            Look::TextField | Look::SearchField | Look::MenuList => {
                let shade = if look == Look::MenuList || shade == DISABLED {
                    shade
                } else {
                    shade.min(1)
                };
                base(
                    self,
                    round(rect, 2.0 * zoom),
                    shade,
                    palette.background[shade],
                );
                self.ring(rect, 1.5 * zoom, zoom, palette.border[shade], space);
            }
            Look::Slider => {
                let thumb = self
                    .part(id, name!("-webkit-slider-thumb"))
                    .map_or([0.0; 2], |it| it.span(axis));
                let middle = start + self.floor(thumb[0]) + 8.0 * zoom;
                let value = if starts_far {
                    [middle, end]
                } else {
                    [start, middle]
                };
                groove(
                    self,
                    band(8.0 * zoom, [start + zoom, end - zoom]),
                    square(band(8.0 * zoom, value)),
                    shade,
                );
            }
            Look::SliderThumb => self.fill_exactly(
                round(rect, rect.width.max(rect.height) / 2.0),
                accented(&own.slider, shade),
                space,
            ),
            Look::Progress => {
                let thickness = [rect.height, rect.width][axis] / 2.0;
                let value = self
                    .part(id, name!("-webkit-progress-value"))
                    .map_or([0.0; 2], |it| it.span(axis));
                let length = if state.contains(State::INDETERMINATE) {
                    (end - start) / 5.0
                } else {
                    value[1] - value[0]
                };
                let length = if length > 0.0 {
                    self.floor(length).max(2.0)
                } else {
                    0.0
                };
                let value = band(
                    thickness,
                    if starts_far {
                        [end - length, end]
                    } else {
                        [start, start + length]
                    },
                );
                let radius = if state.contains(State::INDETERMINATE) {
                    40.0 * zoom
                } else {
                    0.0
                };
                groove(self, band(thickness, [start, end]), round(value, radius), 0);
            }
            Look::SpinButton => {
                let (color, background) = if style.dark {
                    (0x9f9f_9fff, 0x2c2c_2cff)
                } else {
                    (0x8b8b_8bff, 0xfcfc_fcff)
                };
                self.fill(square(rect), background, space);
                let (half, x) = (self.floor(rect.height / 2.0), rect.x + rect.width / 2.0);
                let size = (half * 0.3).min(4.5 * zoom);
                for (y, direction) in [(rect.y + half / 2.0, -1.0), (rect.y + half * 1.5, 1.0)] {
                    let points = [[-1.0, -0.7], [1.0, -0.7], [0.0, 0.7]]
                        .map(|it| [x + it[0] * size, y + it[1] * size * direction]);
                    self.polygon(&points, color, space);
                }
            }
            Look::CancelButton => {
                let size = rect.width.min(rect.height);
                let rect = inset(
                    rect,
                    (rect.width - size) / 2.0 + size * 0.1,
                    (rect.height - size) / 2.0 + size * 0.1,
                );
                let color = if style.dark { 0xaecb_faff } else { 0x395b_bbff };
                self.stroke(
                    &Path::polygon([[rect.x, rect.y], [rect.right(), rect.bottom()]], false),
                    size * 0.24,
                    color,
                    space,
                );
                self.stroke(
                    &Path::polygon([[rect.right(), rect.y], [rect.x, rect.bottom()]], false),
                    size * 0.24,
                    color,
                    space,
                );
            }
            Look::None | Look::ListBox | Look::MenuListButton | Look::Meter => {}
        }
    }
}
