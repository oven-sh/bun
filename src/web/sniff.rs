//! https://mimesniff.spec.whatwg.org/#matching-a-mime-type-pattern

use bun_core::strings;

pub const HEADER_LENGTH: usize = 1445;

fn is_container(start: &[u8], kind: &[u8], form: &[u8]) -> bool {
    start.starts_with(kind) && start.get(8..).is_some_and(|it| it.starts_with(form))
}

pub fn image(start: &[u8]) -> Option<&'static [u8]> {
    Some(match start {
        [0, 0, 1 | 2, 0, ..] => b"image/x-icon",
        [b'B', b'M', ..] => b"image/bmp",
        [b'G', b'I', b'F', b'8', b'7' | b'9', b'a', ..] => b"image/gif",
        [0x89, b'P', b'N', b'G', b'\r', b'\n', 0x1a, b'\n', ..] => b"image/png",
        [0xff, 0xd8, 0xff, ..] => b"image/jpeg",
        [b'I', b'I', b'*', 0, ..] | [b'M', b'M', 0, b'*', ..] => b"image/tiff",
        _ if is_container(start, b"RIFF", b"WEBPVP") => b"image/webp",
        _ => return None,
    })
}

pub fn is_audio_or_video(start: &[u8]) -> bool {
    [
        &b"ID3"[..],
        b"OggS\0",
        b"MThd\0\0\0\x06",
        b"fLaC",
        b".snd",
        b"\x1a\x45\xdf\xa3",
        b"#EXTM3U",
    ]
    .iter()
    .any(|it| start.starts_with(it))
        || is_container(start, b"FORM", b"AIFF")
        || is_container(start, b"RIFF", b"AVI ")
        || is_container(start, b"RIFF", b"WAVE")
        || start.get(4..8) == Some(b"ftyp")
        || matches!(start, [0xff, 0xe0..=0xfd, ..] | [0, 0, 1, 0xb0..=0xbf, ..])
}

fn starts_with_any_case(text: &[u8], prefix: &[u8]) -> bool {
    text.get(..prefix.len())
        .is_some_and(|it| it.eq_ignore_ascii_case(prefix))
}

/// In a way that a script is not. A comment is the start of either.
pub fn is_html(mut start: &[u8]) -> bool {
    loop {
        start = start.trim_ascii_start();
        let tags = b"!doctype html,script,html,head,iframe,h1,div,font,table,a,style,title,b,p";
        if start
            .strip_prefix(b"<")
            .is_some_and(|it| strings::split(tags, b",").any(|tag| starts_with_any_case(it, tag)))
        {
            return true;
        }
        let Some((_, after)) = start
            .strip_prefix(b"<!--")
            .and_then(|it| strings::split_once(it, b"-->"))
        else {
            return false;
        };
        let Some(end) = strings::index_of_any(after, b"\r\n") else {
            return false;
        };
        start = &after[end..];
    }
}

pub fn is_xml(start: &[u8]) -> bool {
    starts_with_any_case(start.trim_ascii_start(), b"<?xml")
}

/// A JSON object, or what has been put before one to keep it from running.
pub fn is_only_for_fetch(start: &[u8]) -> bool {
    let start = start.trim_ascii_start();
    let breakers = [
        &b")]}'"[..],
        b"{}&&",
        b"{} &&",
        b"for(;;);",
        b"while(1);",
        b"for (;;);",
        b"while (1);",
    ];
    if breakers.iter().any(|it| start.starts_with(it)) {
        return true;
    }
    let Some(mut rest) = start
        .strip_prefix(b"{")
        .and_then(|it| it.trim_ascii_start().strip_prefix(b"\""))
    else {
        return false;
    };
    loop {
        rest = match rest {
            [b'"', after @ ..] => return after.trim_ascii_start().starts_with(b":"),
            [] | [0..=0x1f, ..] => return false,
            [b'\\', _, after @ ..] | [_, after @ ..] => after,
        };
    }
}
