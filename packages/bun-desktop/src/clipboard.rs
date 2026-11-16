use anyhow::{Context as _, Result};
use gpui::{App, ClipboardEntry, ClipboardItem, Image, ImageFormat};
use serde_json::{Value, json};

use crate::bridge::{self, blob};

pub fn read_clipboard(selection: bool, cx: &App) -> Value {
    #[cfg(any(target_os = "linux", target_os = "freebsd"))]
    let item = match selection {
        true => cx.read_from_primary(),
        false => cx.read_from_clipboard(),
    };
    #[cfg(not(any(target_os = "linux", target_os = "freebsd")))]
    let item = cx.read_from_clipboard().filter(|_| !selection);

    let mut result = json!({});
    for entry in item.into_iter().flat_map(ClipboardItem::into_entries) {
        match entry {
            ClipboardEntry::String(text) => result["text"] = text.into_text().into(),
            ClipboardEntry::ExternalPaths(paths) => result["files"] = json!(paths.paths()),
            ClipboardEntry::Image(image) => {
                result["type"] = image.format.mime_type().into();
                result["image"] = bridge::put_blob(image.bytes).into();
            }
        }
    }
    result
}

fn image_format(bytes: &[u8]) -> Option<ImageFormat> {
    Some(match image::guess_format(bytes) {
        Ok(image::ImageFormat::Png) => ImageFormat::Png,
        Ok(image::ImageFormat::Jpeg) => ImageFormat::Jpeg,
        Ok(image::ImageFormat::WebP) => ImageFormat::Webp,
        Ok(image::ImageFormat::Gif) => ImageFormat::Gif,
        Ok(image::ImageFormat::Bmp) => ImageFormat::Bmp,
        Ok(image::ImageFormat::Tiff) => ImageFormat::Tiff,
        Ok(image::ImageFormat::Ico) => ImageFormat::Ico,
        _ if bytes.trim_ascii_start().starts_with(b"<") => ImageFormat::Svg,
        _ => return None,
    })
}

pub fn write_clipboard(arguments: &Value, cx: &App) -> Result<()> {
    let item = match arguments["text"].as_str() {
        Some(text) if arguments["image"].is_null() => ClipboardItem::new_string(text.to_owned()),
        _ => {
            let bytes = blob(&arguments["image"])?;
            let format = image_format(&bytes).context("the image has an unknown format")?;
            ClipboardItem::new_image(&Image::from_bytes(format, bytes))
        }
    };
    #[cfg(any(target_os = "linux", target_os = "freebsd"))]
    if arguments["selection"] == true {
        cx.write_to_primary(item);
        return Ok(());
    }
    cx.write_to_clipboard(item);
    Ok(())
}
