//! https://www.x.org/releases/current/doc/man/man3/Xcursor.3.xhtml

use std::path::PathBuf;

use super::wire::{Bytes as _, Connection, Extension, Request};
use crate::platform::Cursor;

/// The names in themes, and the glyph in the font "cursor".
fn names(cursor: Cursor) -> (&'static [&'static str], u16) {
    match cursor {
        Cursor::Arrow | Cursor::Hidden => (&["default", "left_ptr"], 68),
        Cursor::IBeam => (&["text", "xterm"], 152),
        Cursor::VerticalIBeam => (&["vertical-text", "text", "xterm"], 152),
        Cursor::Crosshair => (&["crosshair", "cross"], 34),
        Cursor::OpenHand => (&["grab", "openhand", "hand1"], 58),
        Cursor::ClosedHand => (&["grabbing", "closedhand", "fleur"], 52),
        Cursor::PointingHand => (&["pointer", "hand2", "hand"], 60),
        Cursor::ResizeLeft => (&["w-resize", "left_side"], 70),
        Cursor::ResizeRight => (&["e-resize", "right_side"], 96),
        Cursor::ResizeLeftRight => (&["ew-resize", "sb_h_double_arrow"], 108),
        Cursor::ResizeUp => (&["n-resize", "top_side"], 138),
        Cursor::ResizeDown => (&["s-resize", "bottom_side"], 16),
        Cursor::ResizeUpDown => (&["ns-resize", "sb_v_double_arrow"], 116),
        Cursor::ResizeUpLeftDownRight => (&["nwse-resize", "size_fdiag", "bd_double_arrow"], 14),
        Cursor::ResizeUpRightDownLeft => (&["nesw-resize", "size_bdiag", "fd_double_arrow"], 12),
        Cursor::ResizeColumn => (&["col-resize", "sb_h_double_arrow"], 108),
        Cursor::ResizeRow => (&["row-resize", "sb_v_double_arrow"], 116),
        Cursor::NotAllowed => (&["not-allowed", "crossed_circle"], 24),
        Cursor::DragLink => (&["alias", "dnd-link"], 68),
        Cursor::DragCopy => (&["copy", "dnd-copy"], 90),
        Cursor::ContextMenu => (&["context-menu", "left_ptr"], 68),
    }
}

fn folders() -> Vec<PathBuf> {
    let paths = std::env::var("XCURSOR_PATH");
    let paths = paths
        .as_deref()
        .unwrap_or("~/.local/share/icons:~/.icons:/usr/share/icons:/usr/share/pixmaps");
    let home = std::env::home_dir().unwrap_or_default();
    paths
        .split(':')
        .map(|path| {
            path.strip_prefix("~/")
                .map_or(path.into(), |rest| home.join(rest))
        })
        .collect()
}

fn find(folders: &[PathBuf], theme: &str, name: &str, depth: u32) -> Option<Vec<u8>> {
    let read = |path: &str| {
        folders
            .iter()
            .find_map(|folder| std::fs::read(folder.join(theme).join(path)).ok())
    };
    read(&format!("cursors/{name}")).or_else(|| {
        let index = String::from_utf8(read("index.theme").filter(|_| depth < 5)?).ok()?;
        let inherited = index
            .lines()
            .find_map(|line| line.strip_prefix("Inherits")?.trim().strip_prefix('='))?;
        inherited
            .split([',', ';'])
            .find_map(|parent| find(folders, parent.trim(), name, depth + 1))
    })
}

/// The width, the height, the hot spot and the pixels of the first picture that is closest to `size`.
fn picture(file: &[u8], size: u32) -> Option<([u16; 4], &[u8])> {
    const IMAGE: u32 = 0xfffd_0002;
    let count = file.u32(12).min(4096) as usize;
    let contents = file
        .strip_prefix(b"Xcur")
        .map(|_| file.part(file.u32(4) as usize, count * 12))?;
    let images = contents
        .chunks_exact(12)
        .filter(|entry| entry.u32(0) == IMAGE);
    let at = images
        .min_by_key(|entry| entry.u32(4).abs_diff(size))?
        .u32(8) as usize;
    let numbers = [16, 20, 24, 28].map(|offset| file.u32(at + offset).min(256) as u16);
    Some((
        numbers,
        file.get(at + 36..)?
            .get(..usize::from(numbers[0]) * usize::from(numbers[1]) * 4)?,
    ))
}

fn format_with_alpha(x: &Connection, render: Extension) -> Option<u32> {
    x.forget(x.ask(Request::new(render.opcode, 0).words(&[0, 11])));
    let reply = x.call(Request::new(render.opcode, 1)).ok()?;
    let mut formats = reply.part(32, reply.u32(8) as usize * 28).chunks_exact(28);
    let is_argb = |it: &&[u8]| {
        it[4] == 1 && it[5] == 32 && (it.u16(8), it.u16(20), it.u16(22)) == (16, 24, 255)
    };
    Some(formats.find(is_argb)?.u32(0))
}

fn from_picture(
    x: &Connection,
    render: Extension,
    format: u32,
    numbers: [u16; 4],
    pixels: &[u8],
) -> u32 {
    let [width, height, hot_x, hot_y] = numbers;
    let [pixmap, gc, picture, cursor] = [(); 4].map(|()| x.new_id());
    x.send(
        Request::new(53, 32)
            .words(&[pixmap, x.screen.root])
            .u16(width)
            .u16(height),
    );
    x.send(Request::new(55, 0).words(&[gc, pixmap, 0]));
    let rows = (x.max_request_bytes - 24) / (usize::from(width) * 4);
    for (index, part) in pixels.chunks(rows * usize::from(width) * 4).enumerate() {
        let put = Request::new(72, 2)
            .words(&[pixmap, gc])
            .u16(width)
            .u16((part.len() / 4 / usize::from(width)) as u16);
        x.send(
            put.u16(0)
                .u16((index * rows) as u16)
                .bytes(&[0, 32, 0, 0])
                .bytes(part),
        );
    }
    x.send(Request::new(render.opcode, 4).words(&[picture, pixmap, format, 0]));
    x.send(
        Request::new(render.opcode, 27)
            .words(&[cursor, picture])
            .u16(hot_x)
            .u16(hot_y),
    );
    x.send(Request::new(render.opcode, 7).u32(picture));
    x.send(Request::new(60, 0).u32(gc));
    x.send(Request::new(54, 0).u32(pixmap));
    cursor
}

fn from_font(x: &Connection, glyph: u16) -> u32 {
    let (font, cursor) = (x.new_id(), x.new_id());
    x.send(Request::new(45, 0).u32(font).u16(6).u16(0).bytes(b"cursor"));
    let create = Request::new(94, 0)
        .words(&[cursor, font, font])
        .u16(glyph)
        .u16(glyph + 1);
    x.send(create.bytes(&[0; 6]).bytes(&[255; 6]));
    x.send(Request::new(46, 0).u32(font));
    cursor
}

pub struct Cursors {
    theme: String,
    size: u32,
    format: Option<(Extension, u32)>,
    loaded: Vec<(Cursor, u32)>,
}

impl Cursors {
    pub fn new(x: &Connection, theme: Option<String>, size: u32) -> Cursors {
        let render = x.extension(x.ask_for_extension("RENDER"));
        Cursors {
            theme: theme.unwrap_or_else(|| "default".into()),
            size,
            format: render.and_then(|render| Some((render, format_with_alpha(x, render)?))),
            loaded: Vec::new(),
        }
    }

    pub fn get(&mut self, x: &Connection, cursor: Cursor) -> u32 {
        if let Some((_, id)) = self.loaded.iter().find(|it| it.0 == cursor) {
            return *id;
        }
        let (names, glyph) = names(cursor);
        let themed = self.format.and_then(|(render, format)| {
            if cursor == Cursor::Hidden {
                return Some(from_picture(x, render, format, [1, 1, 0, 0], &[0; 4]));
            }
            let folders = folders();
            let in_theme = |theme| names.iter().find_map(|name| find(&folders, theme, name, 0));
            let file = in_theme(&self.theme).or_else(|| in_theme("default"))?;
            let (numbers, pixels) = picture(&file, self.size).filter(|it| !it.1.is_empty())?;
            Some(from_picture(x, render, format, numbers, pixels))
        });
        let id = themed.unwrap_or_else(|| from_font(x, glyph));
        self.loaded.push((cursor, id));
        id
    }
}
