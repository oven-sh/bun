//! What scripts say to the library.

use crate::protocol::*;

impl Cursor {
    /// By a value of the CSS property.
    pub fn named(name: &[u8]) -> Cursor {
        match name {
            b"pointer" => Cursor::PointingHand,
            b"text" => Cursor::IBeam,
            b"vertical-text" => Cursor::VerticalIBeam,
            #[cfg(windows)]
            b"wait" => Cursor::Wait,
            #[cfg(windows)]
            b"progress" => Cursor::Progress,
            #[cfg(windows)]
            b"help" => Cursor::Help,
            #[cfg(windows)]
            b"cell" => Cursor::Cell,
            #[cfg(windows)]
            b"zoom-in" => Cursor::ZoomIn,
            #[cfg(windows)]
            b"zoom-out" => Cursor::ZoomOut,
            #[cfg(windows)]
            b"move" | b"all-scroll" => Cursor::Move,
            #[cfg(unix)]
            b"cell" => Cursor::Crosshair,
            #[cfg(unix)]
            b"move" | b"all-scroll" => Cursor::ClosedHand,
            b"crosshair" => Cursor::Crosshair,
            b"grab" => Cursor::OpenHand,
            b"grabbing" => Cursor::ClosedHand,
            b"not-allowed" | b"no-drop" => Cursor::NotAllowed,
            b"alias" => Cursor::DragLink,
            b"copy" => Cursor::DragCopy,
            b"context-menu" => Cursor::ContextMenu,
            b"col-resize" => Cursor::ResizeColumn,
            b"row-resize" => Cursor::ResizeRow,
            b"w-resize" => Cursor::ResizeLeft,
            b"e-resize" => Cursor::ResizeRight,
            b"n-resize" => Cursor::ResizeUp,
            b"s-resize" => Cursor::ResizeDown,
            b"ew-resize" => Cursor::ResizeLeftRight,
            b"ns-resize" => Cursor::ResizeUpDown,
            b"nwse-resize" | b"nw-resize" | b"se-resize" => Cursor::ResizeUpLeftDownRight,
            b"nesw-resize" | b"ne-resize" | b"sw-resize" => Cursor::ResizeUpRightDownLeft,
            b"none" => Cursor::Hidden,
            _ => Cursor::Arrow,
        }
    }
}
