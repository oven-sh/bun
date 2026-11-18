//! What is copied and dragged, by the names of X11's targets, most of which are MIME types.

use std::os::unix::ffi::OsStringExt as _;
use std::path::PathBuf;
use std::sync::Arc;

use super::dbus;
use crate::error::{Context as _, Result};
use crate::protocol::{Clipboard, ClipboardPart, Text};

pub const URI_LIST: &str = "text/uri-list";
const IMAGES: [&str; 6] = [
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
    "image/bmp",
    "image/svg+xml",
];

pub type Contents = Vec<(&'static str, Arc<Vec<u8>>)>;

pub fn paths_in(list: &[u8]) -> Vec<PathBuf> {
    let paths = list
        .split(|it| *it == b'\n')
        .filter_map(|line| line.trim_ascii().strip_prefix(b"file://"));
    let without_host = paths.filter_map(|it| Some(&it[it.iter().position(|it| *it == b'/')?..]));
    without_host
        .map(|it| std::ffi::OsString::from_vec(dbus::percent_decoded(it)).into())
        .collect()
}

/// Firefox offers UTF-16.
fn html(bytes: &[u8]) -> String {
    match bytes {
        [0xff, 0xfe, rest @ ..] => String::from_utf16_lossy(
            &rest
                .as_chunks()
                .0
                .iter()
                .map(|it| u16::from_le_bytes(*it))
                .collect::<Vec<_>>(),
        ),
        _ => String::from_utf8_lossy(bytes).into_owned(),
    }
}

fn image_type(bytes: &[u8]) -> Option<&'static str> {
    Some(
        IMAGES[match bytes {
            [0x89, b'P', b'N', b'G', ..] => 0,
            [0xff, 0xd8, ..] => 1,
            [b'R', b'I', b'F', b'F', ..] => 2,
            [b'G', b'I', b'F', ..] => 3,
            [b'B', b'M', ..] => 4,
            _ if bytes.trim_ascii_start().starts_with(b"<") => 5,
            _ => return None,
        }],
    )
}

pub fn gather(part: ClipboardPart, read: impl Fn(&str) -> Option<Vec<u8>>) -> Clipboard {
    let text = ["UTF8_STRING", "text/plain;charset=utf-8"]
        .into_iter()
        .find_map(&read)
        .map(|it| Text::lossy(&it));
    let text = text.or_else(|| {
        Some(
            read("STRING")?
                .into_iter()
                .map(char::from)
                .collect::<String>()
                .into(),
        )
    });
    let text = text
        .or_else(|| Some(Text::lossy(&read("text/plain")?)))
        .into();
    if part == ClipboardPart::Text {
        return Clipboard {
            text,
            ..Clipboard::default()
        };
    }
    let files = read(URI_LIST)
        .map(|list| paths_in(&list))
        .unwrap_or_default();
    Clipboard {
        text,
        html: read("text/html").map(|bytes| html(&bytes).into()).into(),
        files: files
            .iter()
            .map(|it| (*it.to_string_lossy()).into())
            .collect(),
        image: IMAGES.into_iter().find_map(read).map(Into::into).into(),
    }
}

pub fn offer(from: Clipboard) -> Result<Contents> {
    let mut contents = Contents::new();
    if let Some(bytes) = from.image.get().map(|it| it.into_vec()) {
        contents.push((
            image_type(&bytes).context("the image has an unknown format")?,
            bytes.into(),
        ));
    }
    if let Some(html) = from.html.as_ref().map(|it| &**it) {
        let bytes = format!(
            "<meta http-equiv=\"content-type\" content=\"text/html; charset=utf-8\">{html}"
        );
        contents.push(("text/html", bytes.into_bytes().into()));
    }
    if let Some(text) = from.text.as_ref() {
        let bytes = Arc::new(text.as_bytes().to_vec());
        contents.extend(
            [
                "UTF8_STRING",
                "text/plain;charset=utf-8",
                "text/plain",
                "TEXT",
            ]
            .map(|name| (name, bytes.clone())),
        );
        contents.push((
            "STRING",
            Arc::new(
                text.chars()
                    .map(|it| it.try_into().unwrap_or(b'?'))
                    .collect(),
            ),
        ));
    }
    Ok(contents)
}
