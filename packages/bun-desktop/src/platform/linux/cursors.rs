//! https://www.x.org/releases/current/doc/man/man3/Xcursor.3.xhtml

use std::path::PathBuf;

use super::socket::Bytes as _;
use crate::platform::Cursor;

/// The names in themes, and the glyph in the font "cursor".
pub fn names(cursor: Cursor) -> (&'static [&'static str], u16) {
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
pub fn picture(file: &[u8], size: u32) -> Option<([u16; 4], &[u8])> {
    const IMAGE: u32 = 0xfffd_0002;
    let count = file.u32(12).min(4096) as usize;
    let contents = file
        .strip_prefix(b"Xcur")
        .map(|_| file.part(file.u32(4) as usize, count * 12))?;
    let images = contents
        .as_chunks::<12>()
        .0
        .iter()
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

pub fn file(theme: &str, cursor: Cursor) -> Option<Vec<u8>> {
    let folders = folders();
    let in_theme = |theme| {
        names(cursor)
            .0
            .iter()
            .find_map(|name| find(&folders, theme, name, 0))
    };
    in_theme(theme).or_else(|| in_theme("default"))
}
