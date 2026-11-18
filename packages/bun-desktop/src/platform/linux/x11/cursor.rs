use super::super::cursors::{file, names, picture};
use super::wire::{Bytes as _, Connection, Extension, Request};
use crate::platform::Cursor;

fn format_with_alpha(x: &Connection, render: Extension) -> Option<u32> {
    x.forget(x.ask(Request::new(render.opcode, 0).words(&[0, 11])));
    let reply = x.call(Request::new(render.opcode, 1)).ok()?;
    let mut formats = reply
        .part(32, reply.u32(8) as usize * 28)
        .as_chunks::<28>()
        .0
        .iter();
    let is_argb = |it: &&[u8; 28]| {
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
        let themed = self.format.and_then(|(render, format)| {
            if cursor == Cursor::Hidden {
                return Some(from_picture(x, render, format, [1, 1, 0, 0], &[0; 4]));
            }
            let file = file(&self.theme, cursor)?;
            let (numbers, pixels) = picture(&file, self.size).filter(|it| !it.1.is_empty())?;
            Some(from_picture(x, render, format, numbers, pixels))
        });
        let id = themed.unwrap_or_else(|| from_font(x, names(cursor).1));
        self.loaded.push((cursor, id));
        id
    }
}
