//! A picture of the main window from the last run, shown until the app has painted.

use std::cell::{Cell, RefCell};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{Instant, UNIX_EPOCH};

use crate::abi::{Glyph, Item, Rect, Region, RoundedRect, Span, TextRun, Tile};
use crate::error::{Context, Result, bail, ensure};
use crate::frame::Overlay;
use crate::gfx::Pixmap;
use crate::host::thread;
use crate::json::{Deserialize as _, Serialize as _, Value, json, record};
use crate::paint::raster::{IntRect, Layer, Pixel, demultiply};
use crate::paint::scene::Scene;
use crate::text::{Line, Recipe};
use crate::window::{self, Options, WindowState};
use crate::{app, bridge, images, input, surface};

record! {
    required
    struct Saved {
        picture: PathBuf,
        /// In device pixels.
        size: [u32; 2],
        scale: f32,
        regions: Vec<([f32; 4], bool)>,
        options: Options,
        theme: String,
        is_dark: bool,
        displays: Value,
        executable: (PathBuf, u64, u128),
        arguments: Vec<String>,
        variables: Vec<(String, Option<String>)>,
        field: Option<Field>,
        /// What native addons have put behind the window's contents.
        backdrop: Value,
    }
}

record! {
    required
    /// Where typed text goes, in the window's coordinates.
    struct Field {
        rect: [f32; 4],
        caret: [f32; 4],
        baseline: f32,
        font: Recipe,
        size: f32,
        zoom: f32,
        letter_spacing: f32,
        color: u32,
        caret_color: u32,
        background: u32,
    }
}

struct Echo {
    field: Field,
    file: PathBuf,
    font: Option<Option<u32>>,
    text: String,
    has_stopped: bool,
}

struct Shown {
    window: u32,
    surface: u32,
    pieces: Vec<(IntRect, Piece<u32>)>,
    scale: f32,
    echo: Option<Echo>,
    kept: Vec<Rect>,
}

/// Most of a window has one color, which takes no memory.
enum Piece<Image> {
    Color(Pixel),
    Image(Image),
}

thread_local! {
    static SHOWN: RefCell<Option<Shown>> = const { RefCell::new(None) };
    /// And the app has not.
    pub static HAS_SET_THEME: Cell<bool> = const { Cell::new(false) };
    /// Keys that went down, and texts.
    static SENT: Cell<u32> = const { Cell::new(0) };
    pub static NEXT_OVERLAY: Cell<Option<Option<Overlay>>> = const { Cell::new(None) };
}

const RUN: u32 = 0;
const LITERALS: u32 = 1;
const AS_ABOVE: u32 = 2;

fn encode(pixels: &[Pixel], width: usize) -> Vec<u8> {
    let (mut out, mut at, mut literals) = (Vec::new(), 0, 0);
    let flush = |out: &mut Vec<u8>, pixels: &[Pixel]| {
        if !pixels.is_empty() {
            out.extend(((pixels.len() as u32) << 2 | LITERALS).to_le_bytes());
            out.extend(pixels.as_flattened());
        }
    };
    while at < pixels.len() {
        let rest = &pixels[at..];
        let above = at.checked_sub(width).map_or(0, |up| {
            rest.iter()
                .zip(&pixels[up..])
                .take_while(|(a, b)| a == b)
                .count()
        });
        let run = rest.iter().take_while(|pixel| **pixel == rest[0]).count();
        if above.max(run) < 4 {
            (at, literals) = (at + 1, literals + 1);
            continue;
        }
        flush(&mut out, &pixels[at - literals..at]);
        literals = 0;
        if above >= run {
            out.extend(((above as u32) << 2 | AS_ABOVE).to_le_bytes());
        } else {
            out.extend(((run as u32) << 2 | RUN).to_le_bytes());
            out.extend(rest[0]);
        }
        at += above.max(run);
    }
    flush(&mut out, &pixels[at - literals..]);
    out
}

fn decode(bytes: &[u8], [width, height]: [u32; 2]) -> Option<Pixmap> {
    let (row, total) = (width as usize, width as usize * height as usize);
    if total > 1 << 26 {
        return None;
    }
    let (mut words, mut out) = (bytes.as_chunks::<4>().0, Vec::<Pixel>::with_capacity(total));
    while let [head, rest @ ..] = words {
        let head = u32::from_le_bytes(*head);
        let end = out
            .len()
            .checked_add((head >> 2) as usize)
            .filter(|end| *end <= total)?;
        words = match head & 3 {
            RUN => {
                out.resize(end, *rest.first()?);
                &rest[1..]
            }
            LITERALS => {
                let (literals, rest) = rest.split_at_checked(end - out.len())?;
                out.extend_from_slice(literals);
                rest
            }
            _ => {
                while out.len() < end {
                    let from = out.len().checked_sub(row)?;
                    out.extend_from_within(from..from + row.min(end - out.len()));
                }
                rest
            }
        };
    }
    // What is not premultiplied overflows when it is blended.
    let is_valid = out.iter().all(|[r, g, b, a]| r.max(g).max(b) <= a);
    Pixmap::from_vec(out.into_flattened(), width, height).filter(|_| is_valid)
}

fn split(picture: &Layer) -> Vec<u8> {
    const WIDTH: i32 = 64;
    const HEIGHT: i32 = 32;
    let (all, mut out) = (picture.rect, Vec::new());
    for top in (0..all.bottom).step_by(HEIGHT as usize) {
        let bottom = all.bottom.min(top + HEIGHT);
        let color = |left: i32| {
            let first = picture.row(top, left, left + 1)[0];
            let is_flat = (top..bottom).all(|y| {
                picture
                    .row(y, left, all.right.min(left + WIDTH))
                    .iter()
                    .all(|it| *it == first)
            });
            is_flat.then_some(first)
        };
        let mut left = 0;
        while left < all.right {
            let (first, mut right) = (color(left), left + WIDTH);
            while right < all.right && color(right) == first {
                right += WIDTH;
            }
            right = right.min(all.right);
            let pixels: Vec<Pixel> = (top..bottom)
                .flat_map(|y| picture.row(y, left, right))
                .copied()
                .collect();
            let encoded = encode(&pixels, (right - left) as usize);
            out.extend(
                [left, top, right, bottom, encoded.len() as i32]
                    .map(i32::to_le_bytes)
                    .as_flattened(),
            );
            out.extend(encoded);
            left = right;
        }
    }
    out
}

fn pieces(mut bytes: &[u8], [width, height]: [u32; 2]) -> Option<Vec<(IntRect, Piece<Pixmap>)>> {
    let (all, mut pieces, mut area) = (
        IntRect::new(0, 0, width as i32, height as i32),
        Vec::new(),
        0,
    );
    while let Some((head, rest)) = bytes.split_first_chunk::<20>() {
        let [left, top, right, bottom, length] =
            std::array::from_fn(|i| i32::from_le_bytes(head.as_chunks().0[i]));
        let (rect, (encoded, rest)) = (
            IntRect::new(left, top, right, bottom),
            rest.split_at_checked(length as usize)?,
        );
        area += rect.intersect(all).area();
        if rect.is_empty() || rect.intersect(all) != rect || area > all.area() {
            return None;
        }
        let run = ((rect.area() as u32) << 2 | RUN).to_le_bytes();
        pieces.push(match encoded.as_chunks().0 {
            [head, color @ [r, g, b, a]] if *head == run && r.max(g).max(b) <= a => {
                (rect, Piece::Color(*color))
            }
            _ => (
                rect,
                Piece::Image(decode(
                    encoded,
                    [rect.width() as u32, rect.height() as u32],
                )?),
            ),
        });
        bytes = rest;
    }
    (area == all.area()).then_some(pieces)
}

fn paste(into: &mut Layer, rect: IntRect, piece: Piece<&Pixmap>) {
    let shared = rect.intersect(into.rect);
    for y in (shared.top..shared.bottom).filter(|_| !shared.is_empty()) {
        let row = into.row_mut(y, shared.left, shared.right);
        match piece {
            Piece::Color(color) => row.fill(color),
            Piece::Image(image) => {
                let start =
                    (y - rect.top) as usize * rect.width() + (shared.left - rect.left) as usize;
                row.copy_from_slice(&image.data().as_chunks().0[start..start + shared.width()]);
            }
        }
    }
}

fn write_private(path: &Path, bytes: &[u8]) -> Result<()> {
    let temporary = path.with_extension("tmp");
    let mut options = OpenOptions::new();
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    fs::remove_file(&temporary).ok();
    options
        .write(true)
        .create_new(true)
        .open(&temporary)?
        .write_all(bytes)?;
    Ok(fs::rename(&temporary, path)?)
}

fn executable() -> Result<(PathBuf, u64, u128)> {
    let path = std::env::current_exe()?;
    let metadata = fs::metadata(&path)?;
    Ok((
        path,
        metadata.len(),
        metadata.modified()?.duration_since(UNIX_EPOCH)?.as_nanos(),
    ))
}

fn arguments() -> Vec<String> {
    std::env::args_os()
        .skip(1)
        .map(|it| it.to_string_lossy().into_owned())
        .collect()
}

fn displays() -> Value {
    json!(
        app::displays()
            .iter()
            .map(|display| app::rectangle(display.bounds))
            .collect::<Vec<_>>()
    )
}

fn device(rect: Rect, scale: f32) -> IntRect {
    IntRect::nearest(Rect {
        x: rect.x * scale,
        y: rect.y * scale,
        width: rect.width * scale,
        height: rect.height * scale,
    })
}

/// What the surfaces show in `area`, which is in the window's device pixels.
fn paint(state: &WindowState, area: IntRect, backdrop: Option<u32>) -> Result<Layer> {
    let mut layer = Layer::new(area).context("the area is empty or too large")?;
    if let Some([r, g, b, 255]) = backdrop
        .or(state.options.borrow().background_color)
        .map(u32::to_be_bytes)
    {
        layer.pixels_mut().fill([r, g, b, 255]);
    }
    for surface in surface::in_window(state) {
        surface.borrow().paint_in_window(&mut layer);
    }
    Ok(layer)
}

fn number(value: &Value) -> Result<u32> {
    Ok(value.as_u64().context("expected a number")? as u32)
}

fn rect_from([x, y, width, height]: [f32; 4]) -> Rect {
    Rect {
        x,
        y,
        width,
        height,
    }
}

impl Shown {
    fn items(&self, area: Option<IntRect>) -> impl Iterator<Item = Item> {
        let wanted = self
            .pieces
            .iter()
            .filter(move |(it, _)| area.is_none_or(|area| !area.intersect(*it).is_empty()));
        wanted.map(|(area, piece)| {
            let Rect {
                x,
                y,
                width,
                height,
            } = area.to_rect();
            let rect = rect_from([x, y, width, height].map(|it| it / self.scale));
            let shape = RoundedRect {
                rect,
                radii: Default::default(),
            };
            match *piece {
                Piece::Color(color) => Item::Fill {
                    shape,
                    color: u32::from_be_bytes(demultiply(color)),
                },
                Piece::Image(image) => Item::Image {
                    clip: shape,
                    tile: Tile {
                        rect,
                        step: [0.; 2],
                    },
                    image,
                    pixelated: false,
                },
            }
        })
    }
}

impl Echo {
    fn caret(&self, offset: f32) -> Item {
        let [x, y, width, height] = self.field.caret;
        Item::Caret {
            rect: Rect {
                x: x + offset,
                y,
                width,
                height,
            },
            color: self.field.caret_color,
        }
    }

    /// Replaces what follows the `pictured` items, if the text fits.
    fn draw(&mut self, scene: &mut Scene, pictured: usize) -> Option<()> {
        let Echo { field, text, .. } = self;
        let font = (*self
            .font
            .get_or_insert_with(|| field.font.describe(&self.file)))?;
        let (end, size, zoom) = (text.len() as u32, field.size, field.zoom);
        let run = TextRun {
            end,
            font,
            size,
            letter_spacing: field.letter_spacing,
            word_spacing: 0.,
            word_break: 0,
        };
        let (line, rect, x) = (
            Line::new(text, run, 0),
            rect_from(field.rect),
            field.caret[0],
        );
        (x + line.width * zoom <= rect.x + rect.width).then_some(())?;
        scene.items.truncate(pictured);
        scene.glyphs.clear();
        if end > 0 {
            scene.items.push(Item::Fill {
                shape: RoundedRect {
                    rect,
                    radii: Default::default(),
                },
                color: field.background,
            });
        }
        for (face, glyphs) in line.runs {
            let start = scene.glyphs.len() as u32;
            scene.glyphs.extend(glyphs.iter().map(|it| Glyph {
                id: it.id,
                x: it.x * zoom,
                y: it.y * zoom,
            }));
            let (glyphs, origin) = (
                Span {
                    start,
                    end: scene.glyphs.len() as u32,
                },
                [x, field.baseline],
            );
            let (face, size, color) = (face.id, face.size * zoom, field.color);
            scene.items.push(Item::Text {
                origin,
                bounds: rect,
                face,
                size,
                glyphs,
                color,
                blur: 0.,
            });
        }
        scene.items.push(self.caret(line.width * zoom));
        scene.index();
        Some(())
    }
}

fn edit_echo(edit: impl FnOnce(&mut String)) {
    let window = SHOWN.with_borrow_mut(|shown| {
        let shown = shown.as_mut()?;
        let (echo, surface) = (
            shown.echo.as_mut().filter(|it| !it.has_stopped)?,
            surface::get(shown.surface)?,
        );
        let surface = &mut *surface.borrow_mut();
        edit(&mut echo.text);
        echo.draw(&mut surface.scene, shown.pieces.len())?;
        surface.caret_moved_at = Instant::now();
        Some(shown.window)
    });
    window.into_iter().for_each(window::draw_soon);
}

/// What follows depends on the app.
pub fn stop_echo() {
    SHOWN.with_borrow_mut(|shown| {
        shown
            .iter_mut()
            .flat_map(|it| &mut it.echo)
            .for_each(|echo| echo.has_stopped = true)
    });
}

pub fn key_down(key: &str, modifiers: u8) {
    const SHORTCUT: u8 = 2 | 4 | 8;
    SENT.set(SENT.get() + 1);
    match key {
        "Backspace" if modifiers & SHORTCUT == 0 => edit_echo(|text| _ = text.pop()),
        "Backspace" | "Delete" | "Enter" | "Home" | "End" => stop_echo(),
        _ if key.starts_with("Arrow") => stop_echo(),
        _ => {}
    }
}

pub fn typed(text: &str, is_at_caret: bool) {
    SENT.set(SENT.get() + 1);
    // Backspace removes one of these, and they run from the left.
    match is_at_caret
        && text
            .chars()
            .all(|it| matches!(it, ' '..='\u{2FF}' | '\u{370}'..='\u{482}'))
    {
        true => edit_echo(|all| all.push_str(text)),
        false => stop_echo(),
    }
}

/// The font is that of the placeholder, which starts at the caret.
fn field(
    state: &WindowState,
    from: &Value,
    painted: &Layer,
) -> Option<(Field, Option<&'static [u8]>)> {
    let surface = surface::get(state.focused_surface.get()?)?;
    let surface = surface.borrow();
    let (caret, rect, zoom) = (
        surface.ime.caret_in_empty_field()?,
        surface::parse_rect(&from["rect"])?,
        surface.scene.zoom,
    );
    let (local, caret_color) = surface.scene.items.iter().find_map(|item| match *item {
        Item::Caret { rect, color } => Some((rect, color)),
        _ => None,
    })?;
    let (y, face, size) = surface.scene.items.iter().find_map(|item| match *item {
        Item::Text {
            origin: [x, y],
            face,
            size,
            ..
        } if (x - local.x).abs() < 2. && y > local.y && y < local.y + local.height => {
            Some((y, face, size))
        }
        _ => None,
    })?;
    let (font, file) = Recipe::of(face)?;
    let (x, top) = (surface.rect.x + caret.x, surface.rect.y + caret.y);
    let corner = device(rect, state.metrics.get().scale).intersect(painted.rect);
    (!corner.is_empty() && surface::contains(rect, x + 1., top + 1.)).then_some(())?;
    let background = painted.row(corner.top, corner.right - 1, corner.right)[0];
    let field = Field {
        rect: [rect.x, rect.y, rect.width, rect.height],
        caret: [x, top, local.width * zoom, local.height * zoom],
        baseline: top + (y - local.y) * zoom,
        size: size / font.size_adjust,
        font,
        zoom,
        letter_spacing: from["letterSpacing"].as_f64().unwrap_or(0.) as f32,
        color: from["color"].as_u64().map_or(caret_color, |it| it as u32),
        caret_color,
        background: u32::from_be_bytes(background),
    };
    (background[3] == 255).then_some((field, file))
}

fn backdrop(window: u32, command: &str, value: &Value) -> Value {
    let window = window::platform_window(window).filter(|_| cfg!(target_os = "macos"));
    window
        .and_then(|window| window.command(command, value, None).ok())
        .unwrap_or_default()
}

fn show(from: &Value) -> Result<()> {
    let saved = Saved::deserialize(crate::json::parse(&fs::read(
        from["path"].as_str().unwrap_or(""),
    )?)?)?;
    ensure!(thread::exists(), "nothing draws while JavaScript runs");
    ensure!(
        saved.executable == executable()? && saved.arguments == arguments(),
        "another launch"
    );
    ensure!(
        saved
            .variables
            .iter()
            .all(|(name, value)| std::env::var(name).ok() == *value),
        "another environment"
    );
    ensure!(saved.displays == displays(), "other displays");
    let picture =
        pieces(&fs::read(&saved.picture)?, saved.size).context("the picture is damaged")?;
    // Linux tells the appearance later.
    let is_dark = app::is_dark();
    ensure!(
        saved.theme != "system" || is_dark == saved.is_dark || cfg!(target_os = "linux"),
        "another appearance"
    );
    if saved.theme != "system" {
        app::set_theme_source(&saved.theme);
        HAS_SET_THEME.set(true);
    }
    let (window, surface) = (number(&from["window"])?, number(&from["surface"])?);
    let pieces = picture.into_iter().map(|(area, piece)| match piece {
        Piece::Color(color) => (area, Piece::Color(color)),
        Piece::Image(pixmap) => (area, Piece::Image(images::insert(pixmap))),
    });
    let file = saved.picture.with_extension("font");
    let echo = saved.field.map(|field| Echo {
        field,
        file,
        font: None,
        text: String::new(),
        has_stopped: false,
    });
    let shown = Shown {
        window,
        surface,
        pieces: pieces.collect(),
        scale: saved.scale,
        echo,
        kept: Vec::new(),
    };
    let mut scene = Scene::default();
    scene.items.extend(shown.items(None));
    scene
        .items
        .extend(shown.echo.iter().map(|echo| echo.caret(0.)));
    scene
        .regions
        .extend(saved.regions.iter().map(|&(rect, drag)| Region {
            rect: rect_from(rect),
            drag,
        }));
    let [width, height] = saved.size.map(|it| it as f32 / saved.scale);
    surface::create_cover(
        surface,
        window,
        Rect {
            x: 0.,
            y: 0.,
            width,
            height,
        },
        scene,
    )?;
    SHOWN.set(Some(shown));
    let options = Options {
        id: window,
        show: true,
        focus: true,
        cover: Some(surface),
        ..saved.options
    };
    let created = window::create(options).and_then(|()| {
        ensure!(
            window::state(window)?.metrics.get().scale == saved.scale,
            "another scale"
        );
        backdrop(window, "imitateBackdrop", &saved.backdrop);
        Ok(())
    });
    created.inspect_err(|_| discard())
}

/// The surfaces are drawn, and get the keys.
fn lift(state: &WindowState) {
    if HAS_SET_THEME.take() {
        bridge::emit_latest(json!({ "t": "theme", "dark": app::set_theme_source("system") }));
    }
    if state.cover.take().is_some() {
        state.options.borrow_mut().overlay = NEXT_OVERLAY.take().flatten();
    }
    let window = state.id;
    app::after_command(move || {
        window::refresh(window);
        window::draw_now(window);
    });
}

fn keep(rects: Vec<Rect>) -> Option<u32> {
    let window = SHOWN.with_borrow_mut(|shown| {
        let shown = shown.as_mut()?;
        let surface = surface::get(shown.surface)?;
        let scene = &mut surface.borrow_mut().scene;
        scene.items.clear();
        for &rect in &rects {
            scene.items.push(Item::PushClip(RoundedRect {
                rect,
                radii: Default::default(),
            }));
            scene
                .items
                .extend(shown.items(Some(device(rect, shown.scale))));
            scene.items.push(Item::Pop);
        }
        scene.index();
        (shown.kept, shown.echo) = (rects, None);
        window::state(shown.window)
            .ok()?
            .kept_cover
            .set(Some(shown.surface));
        Some(shown.window)
    })?;
    lift(&*window::state(window).ok()?);
    Some(window)
}

pub fn keeps(x: f32, y: f32) -> bool {
    SHOWN.with_borrow(|shown| {
        shown
            .iter()
            .flat_map(|it| &it.kept)
            .any(|rect| surface::contains(*rect, x, y))
    })
}

fn uncover() -> Option<u32> {
    let Shown {
        window,
        surface,
        pieces,
        ..
    } = SHOWN.take()?;
    if let Ok(state) = window::state(window) {
        state.kept_cover.set(None);
        input::forget_surface(&state, surface);
        lift(&state);
    }
    surface::command("destroy", &json!({ "id": surface })).ok();
    for (_, piece) in pieces {
        if let Piece::Image(image) = piece {
            images::command("release", &json!({ "id": image }), None).ok();
        }
    }
    Some(window)
}

fn discard() {
    uncover().map(window::destroy);
}

/// Whether the window that shows the picture is the one that `wanted` describes.
fn adopt(wanted: Options) -> bool {
    let state = SHOWN.with_borrow(|shown| window::state(shown.as_ref()?.window).ok());
    let shape = |it: &Options| {
        (
            it.frame,
            it.hidden_title_bar,
            it.kind.clone(),
            it.fullscreen,
            it.width.round(),
            it.height.round(),
        )
    };
    let is_at = |wanted: Option<f32>, saved: Option<f32>| {
        wanted.is_none_or(|it| Some(it.round()) == saved.map(f32::round))
    };
    let fits = state.is_some_and(|state| {
        let saved = state.options.borrow();
        shape(&saved) == shape(&wanted) && is_at(wanted.x, saved.x) && is_at(wanted.y, saved.y)
    });
    match fits {
        true => drop(wanted.icon.and_then(bridge::take_blob)),
        false => discard(),
    }
    fits
}

/// The surface at `point`, if it looks there like the picture.
fn target(point: &Value) -> Option<Value> {
    const REACH: f32 = 20.;
    let window = SHOWN.with_borrow(|shown| shown.as_ref().map(|it| it.window))?;
    let (state, x, y) = (
        window::state(window).ok()?,
        point[0].as_f64()? as f32,
        point[1].as_f64()? as f32,
    );
    let metrics = state.metrics.get();
    let around = Rect {
        x: x - REACH,
        y: y - REACH,
        width: REACH * 2.,
        height: REACH * 2.,
    };
    let area = device(around, metrics.scale).intersect(device(metrics.content, metrics.scale));
    let (now, mut then) = (paint(&state, area, None).ok()?, Layer::new(area)?);
    SHOWN.with_borrow(|shown| {
        for (rect, piece) in shown.iter().flat_map(|it| &it.pieces) {
            match *piece {
                Piece::Color(color) => paste(&mut then, *rect, Piece::Color(color)),
                Piece::Image(image) => drop(images::with_first_frame(image, |content, _| {
                    if let images::Content::Pixels(image) = content {
                        paste(&mut then, *rect, Piece::Image(image));
                    }
                })),
            }
        }
    });
    // A backdrop is not quite the color that it stands for.
    let is_same = now
        .pixels()
        .as_flattened()
        .iter()
        .zip(then.pixels().as_flattened())
        .all(|(now, then)| now.abs_diff(*then) <= 16);
    let surfaces = surface::in_window(&state);
    let mut from_the_top = surfaces.iter().rev().map(|surface| surface.borrow());
    let hit = from_the_top
        .find(|it| it.is_visible && !it.is_passthrough && surface::contains(it.rect, x, y))
        .filter(|_| is_same)?;
    Some(json!({ "s": hit.id, "x": x - hit.rect.x, "y": y - hit.rect.y }))
}

fn differs(path: &Path, bytes: &[u8]) -> bool {
    fs::read(path).ok().as_deref() != Some(bytes)
}

fn save(from: &Value, reply: u64) -> Result<()> {
    let state = window::state(number(&from["window"])?)?;
    let (path, picture) = (
        PathBuf::deserialize(&from["path"])?,
        PathBuf::deserialize(&from["picture"])?,
    );
    let metrics = state.metrics.get();
    let all = device(
        Rect {
            x: 0.,
            y: 0.,
            width: metrics.width,
            height: metrics.height,
        },
        metrics.scale,
    );
    let (size, part) = (
        [all.width() as u32, all.height() as u32],
        surface::parse_rect(&from["rect"]),
    );
    let painted = match from["keepsPicture"] == true {
        true => None,
        false => Some(paint(
            &state,
            part.map_or(all, |rect| device(rect, metrics.scale).intersect(all)),
            number(&from["backdrop"]).ok(),
        )?),
    };
    let (field, font) = painted
        .as_ref()
        .and_then(|painted| field(&state, &from["field"], painted))
        .unzip();
    let wanted_field =
        surface::parse_rect(&from["field"]["rect"]).map(|it| [it.x, it.y, it.width, it.height]);
    let mut regions = Vec::new();
    for surface in surface::in_window(&state) {
        let surface = surface.borrow();
        if surface.is_visible && !surface.is_passthrough {
            let (
                Rect {
                    x,
                    y,
                    width,
                    height,
                },
                zoom,
            ) = (surface.rect, surface.scene.zoom);
            regions.push(([x, y, width, height], false));
            regions.extend(surface.scene.regions.iter().map(|Region { rect, drag }| {
                (
                    [
                        x + rect.x * zoom,
                        y + rect.y * zoom,
                        rect.width * zoom,
                        rect.height * zoom,
                    ],
                    *drag,
                )
            }));
        }
    }
    let mut options = state.options.borrow().to_json();
    for (name, value) in from["options"].as_object().into_iter().flatten() {
        options[name.as_str()] = value.clone();
    }
    let variables = Vec::<String>::deserialize(&from["variables"])?;
    let mut saved = Saved {
        picture,
        size,
        scale: metrics.scale,
        regions,
        options: Options::deserialize(options)?,
        theme: String::deserialize(&from["theme"])?,
        is_dark: app::is_dark(),
        displays: displays(),
        executable: executable()?,
        arguments: arguments(),
        variables: variables
            .into_iter()
            .map(|name| (name.clone(), std::env::var(name).ok()))
            .collect(),
        field,
        backdrop: backdrop(state.id, "describeBackdrop", &Value::Null),
    };
    bridge::in_background(reply, move || {
        if part.is_some() || painted.is_none() {
            let before = Saved::deserialize(crate::json::parse(&fs::read(&path)?)?)?;
            ensure!(
                (before.size, before.scale) == (saved.size, saved.scale),
                "the window has another size"
            );
            (saved.regions, saved.field) = (before.regions, before.field);
        } else if saved.field.is_none() && wanted_field.is_some() {
            // A window without the focus has no caret.
            let before = fs::read(&path)
                .ok()
                .and_then(|it| Saved::deserialize(crate::json::parse(&it).ok()?).ok());
            let before = before.filter(|it| (it.scale, it.is_dark) == (saved.scale, saved.is_dark));
            saved.field = before
                .and_then(|it| it.field)
                .filter(|it| Some(it.rect) == wanted_field);
        }
        let file = saved.picture.with_extension("font");
        if let Some(font) = font.flatten().filter(|font| differs(&file, font)) {
            write_private(&file, font)?;
        }
        if let Some(mut painted) = painted {
            if part.is_some() {
                let mut whole = Layer::new(all).context("the window is too large")?;
                for (rect, piece) in
                    pieces(&fs::read(&saved.picture)?, size).context("the picture is damaged")?
                {
                    match piece {
                        Piece::Color(color) => paste(&mut whole, rect, Piece::Color(color)),
                        Piece::Image(image) => paste(&mut whole, rect, Piece::Image(&image)),
                    }
                }
                paste(&mut whole, painted.rect, Piece::Image(&painted.pixmap));
                painted = whole;
            }
            write_private(&saved.picture, &split(&painted))?;
        }
        write_private(&path, saved.to_json().to_string().as_bytes())?;
        Ok(Value::Null)
    });
    Ok(())
}

pub fn command(name: &str, arguments: &Value, reply: Option<u64>) -> Result<Value> {
    match name {
        "show" => drop(
            show(arguments)
                .inspect_err(|error| crate::diagnostics::log!("no launch cover: {error:#}")),
        ),
        "adopt" => return Ok(adopt(Options::deserialize(arguments)?).into()),
        "discard" => discard(),
        "end" => {
            let clicked = target(&arguments["point"]);
            let kept: Vec<_> = arguments["keep"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(surface::parse_rect)
                .collect();
            let window = if kept.is_empty() {
                uncover()
            } else {
                keep(kept)
            };
            window.map(|window| backdrop(window, "imitateBackdrop", &Value::Null));
            let state = window.and_then(|window| window::state(window).ok());
            let focused = state.as_ref().and_then(|state| state.focused_surface.get());
            let next = clicked
                .as_ref()
                .and_then(|it| number(&it["s"]).ok())
                .filter(|id| surface::is_focusable(*id));
            if let (Some(state), Some(_)) = (state, next) {
                input::focus(&state, next);
            }
            return Ok(json!({ "clicked": clicked, "focused": focused }));
        }
        "focused" => {
            return Ok(json!(SHOWN.with_borrow(|shown| {
                window::state(shown.as_ref()?.window)
                    .ok()?
                    .focused_surface
                    .get()
            })));
        }
        "sent" => return Ok(SENT.get().into()),
        "fits" => return Ok(target(arguments).is_some().into()),
        "acceptsText" => {
            return Ok(surface::get(number(arguments)?)
                .is_some_and(|it| it.borrow().ime.is_enabled())
                .into());
        }
        "save" => save(arguments, reply.context("the command needs a reply id")?)?,
        _ => bail!("unknown command cover.{name}"),
    }
    Ok(Value::Null)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pictures_survive_and_damage_is_refused() {
        let pixels: Vec<Pixel> = (0..40 * 30u32)
            .map(|i| {
                if i % 40 < 9 || i > 900 {
                    [9, 9, 9, 255]
                } else {
                    [(i * i % 7) as u8, 0, 0, 255]
                }
            })
            .collect();
        let bytes = encode(&pixels, 40);
        assert_eq!(
            decode(&bytes, [40, 30]).unwrap().data(),
            pixels.as_flattened()
        );
        assert!(decode(&bytes, [40, 29]).is_none());
        assert!((0..bytes.len() / 4).all(|end| decode(&bytes[..end * 4], [40, 30]).is_none()));
        let (rect, pixmap) = (
            IntRect::new(0, 0, 40, 30),
            decode(&bytes, [40, 30]).unwrap(),
        );
        let bytes = split(&Layer { rect, pixmap });
        assert!(pieces(&bytes, [40, 30]).is_some() && pieces(&bytes, [41, 30]).is_none());
        assert!((0..bytes.len()).all(|end| pieces(&bytes[..end], [40, 30]).is_none()));
        assert!(decode(&(8 << 2 | AS_ABOVE).to_le_bytes(), [4, 2]).is_none());
    }
}
