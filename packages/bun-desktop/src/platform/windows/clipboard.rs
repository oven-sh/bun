//! What is copied and dragged.

use std::time::Duration;

use crate::error::{Result, ensure};
use crate::protocol::{Clipboard, ClipboardPart, Text};
use crate::win32::*;

pub type Contents = Vec<(u16, Vec<u8>)>;

pub fn format(name: Str) -> u16 {
    RegisterClipboardFormatW(name) as u16
}

fn html_format() -> u16 {
    format(wide!("HTML Format"))
}

fn png_format() -> u16 {
    format(wide!("PNG"))
}

pub fn global(bytes: &[u8]) -> Handle {
    let memory = GlobalAlloc(GMEM_MOVEABLE, bytes.len().max(1));
    // SAFETY: it has room for them, unless it is null.
    unsafe {
        let start = GlobalLock(memory).cast::<u8>();
        if !start.is_null() {
            start.copy_from_nonoverlapping(bytes.as_ptr(), bytes.len());
            GlobalUnlock(memory);
        }
    }
    memory
}

/// # Safety
/// It is from `GlobalAlloc`, or null.
pub unsafe fn bytes_in(memory: Handle) -> Option<Vec<u8>> {
    // SAFETY: it knows its size.
    unsafe {
        let start = Some(GlobalLock(memory)).filter(|it| !it.is_null())?;
        let bytes = std::slice::from_raw_parts(start.cast::<u8>(), GlobalSize(memory)).to_vec();
        GlobalUnlock(memory);
        Some(bytes)
    }
}

fn word(bytes: &[u8], at: usize) -> Option<usize> {
    Some(u32::from_le_bytes(*bytes.get(at..)?.first_chunk()?) as usize)
}

/// `DROPFILES`
pub fn paths_in(files: &[u8]) -> Vec<String> {
    let names = word(files, 0)
        .filter(|_| word(files, 16) != Some(0))
        .and_then(|start| files.get(start..))
        .map(units_in)
        .unwrap_or_default();
    names
        .split(|it| *it == 0)
        .take_while(|it| !it.is_empty())
        .map(String::from_utf16_lossy)
        .collect()
}

pub fn list_of_files(paths: &[Text]) -> Vec<u8> {
    let header = [20u32, 0, 0, 0, 1].into_iter().flat_map(u32::to_le_bytes);
    header
        .chain(paths.iter().flat_map(|it| Wide::new(&**it).bytes()))
        .chain([0, 0])
        .collect()
}

/// https://learn.microsoft.com/windows/win32/dataxchg/html-clipboard-format
fn html_in(bytes: &[u8]) -> String {
    let bytes = bytes.split(|it| *it == 0).next().unwrap_or_default();
    let header = String::from_utf8_lossy(&bytes[..bytes.len().min(512)]);
    let offset = |name: &str| {
        header
            .lines()
            .find_map(|it| it.strip_prefix(name)?.trim().parse::<usize>().ok())
    };
    let part = |start, end| bytes.get(offset(start)?..offset(end)?.min(bytes.len()));
    String::from_utf8_lossy(
        part("StartFragment:", "EndFragment:")
            .or_else(|| part("StartHTML:", "EndHTML:"))
            .unwrap_or_default(),
    )
    .into_owned()
}

fn with_header(html: &str) -> Vec<u8> {
    const BEFORE: &str = "<html>\r\n<body>\r\n<!--StartFragment-->";
    const AFTER: &str = "<!--EndFragment-->\r\n</body>\r\n</html>";
    let header = |[start, end, from, to]: [usize; 4]| {
        format!(
            "Version:0.9\r\nStartHTML:{start:010}\r\nEndHTML:{end:010}\r\nStartFragment:{from:010}\r\nEndFragment:{to:010}\r\n"
        )
    };
    let start = header([0; 4]).len();
    let (from, to) = (start + BEFORE.len(), start + BEFORE.len() + html.len());
    format!(
        "{}{BEFORE}{html}{AFTER}\0",
        header([start, to + AFTER.len(), from, to])
    )
    .into_bytes()
}

/// A file has a header in front of it.
fn bmp_file(dib: &[u8]) -> Option<Vec<u8>> {
    const BIT_FIELDS: usize = 3;
    let (header, depth) = (word(dib, 0)?, word(dib, 12)? >> 16);
    let colors = Some(word(dib, 32)?)
        .filter(|it| *it != 0 || depth > 8)
        .unwrap_or(1 << depth.min(8));
    let masks = if header == 40 && word(dib, 16)? == BIT_FIELDS {
        12
    } else {
        0
    };
    let words =
        [14 + dib.len(), 0, 14 + header + masks + colors * 4].map(|it| (it as u32).to_le_bytes());
    Some([b"BM", words.as_flattened(), dib].concat())
}

/// On white, for the programs that know nothing of alpha.
fn dib(image: &crate::codec::Rgba) -> Vec<u8> {
    let header = [
        40,
        image.width,
        image.height,
        1 | 32 << 16,
        0,
        0,
        0,
        0,
        0,
        0,
    ]
    .into_iter()
    .flat_map(u32::to_le_bytes);
    let pixels = image
        .data
        .chunks(image.width as usize * 4)
        .rev()
        .flat_map(|row| row.as_chunks().0);
    let on_white = |&[r, g, b, a]: &[u8; 4]| {
        [b, g, r, 255].map(|it| 255 - crate::paint::raster::multiply(255 - it, a))
    };
    header.chain(pixels.flat_map(on_white)).collect()
}

pub fn offer(from: Clipboard) -> Result<Contents> {
    let mut contents = Contents::new();
    if let Some(bytes) = from.image.as_ref() {
        let image = crate::images::decode_still(bytes)?;
        contents.extend(image.to_png().map(|it| (png_format(), it)));
        contents.push((CF_DIB, dib(&image)));
    }
    contents.extend(
        from.html
            .as_ref()
            .map(|it| (html_format(), with_header(it))),
    );
    contents.extend(
        from.text
            .as_ref()
            .map(|it| (CF_UNICODETEXT, Wide::new(&**it).bytes())),
    );
    contents.extend((!from.files.is_empty()).then(|| (CF_HDROP, list_of_files(&from.files))));
    Ok(contents)
}

struct Opened;

impl Opened {
    /// Another program may have it for a moment.
    fn new() -> Result<Opened> {
        let is_open = (0..10).any(|attempt| {
            std::thread::sleep(Duration::from_millis(attempt));
            OpenClipboard(crate::host::system::window()) != 0
        });
        ensure!(is_open, "another program has the clipboard");
        Ok(Opened)
    }
}

impl Drop for Opened {
    fn drop(&mut self) {
        CloseClipboard();
    }
}

pub fn read(part: ClipboardPart) -> Clipboard {
    let Some(_opened) = (part != ClipboardPart::Selection)
        .then(Opened::new)
        .and_then(Result::ok)
    else {
        return Clipboard::default();
    };
    // SAFETY: what these formats are made of.
    let read = |format: u16| unsafe { bytes_in(GetClipboardData(format.into())) };
    let text = read(CF_UNICODETEXT)
        .map(|it| string_in(&units_in(&it)).into())
        .into();
    if part == ClipboardPart::Text {
        return Clipboard {
            text,
            ..Clipboard::default()
        };
    }
    Clipboard {
        text,
        html: read(html_format()).map(|it| html_in(&it).into()).into(),
        files: read(CF_HDROP)
            .iter()
            .flat_map(|it| paths_in(it))
            .map(Into::into)
            .collect(),
        image: read(png_format())
            .or_else(|| bmp_file(&read(CF_DIB)?))
            .map(Into::into)
            .into(),
    }
}

pub fn write(from: Clipboard) -> Result<()> {
    let (contents, _opened) = (offer(from)?, Opened::new()?);
    EmptyClipboard();
    for (format, bytes) in contents {
        let memory = global(&bytes);
        // SAFETY: it is the system's if that takes it.
        unsafe {
            if SetClipboardData(format.into(), memory) == 0 {
                GlobalFree(memory);
            }
        }
    }
    Ok(())
}
