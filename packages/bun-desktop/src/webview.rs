//! The pixels of a page that a browser engine renders in another process.

use std::cell::{Cell, RefCell};
use std::fs::File;
use std::io::{Read, Seek as _, SeekFrom};
use std::sync::mpsc::Receiver;
use std::time::Duration;

use crate::abi::{Rect, Region};
use crate::error::{Context as _, Result, bail, ensure};
use crate::gfx::Pixmap;
use crate::hash::FastMap;
use crate::json::{Deserialize as _, Value, json};
use crate::paint::raster::IntRect;
use crate::sync::Mutex;
use crate::{bridge, images, surface};

const TILE: i32 = 256;
const MAX_SIDE: u64 = 16384;

pub struct View {
    pub pixmap: Pixmap,
    /// Pixels for each unit of the display list that shows it.
    pub scale: f32,
    version: u32,
    /// Row by row, the `version` at which each has changed.
    tiles: Vec<u32>,
    /// Where the other process leaves what has changed, if there is no channel.
    file: Option<File>,
}

thread_local! {
    static VIEWS: RefCell<FastMap<u32, View>> = RefCell::default();
    static CHANNEL: RefCell<Option<Receiver<Vec<u8>>>> = RefCell::default();
    /// Frames that were announced and have not arrived.
    static OWED: Cell<usize> = const { Cell::new(0) };
}

static SPARE: Mutex<Vec<u8>> = Mutex::new(Vec::new());

fn read_pixels(from: &mut impl Read, length: usize) -> std::io::Result<Vec<u8>> {
    let mut rows = std::mem::take(&mut *SPARE.lock());
    if rows.len() / 8 > length {
        rows = Vec::new();
    }
    rows.resize(length, 0);
    from.read_exact(&mut rows)?;
    for [b, g, r, a] in rows.as_chunks_mut().0 {
        (*b, *g, *r) = ((*r).min(*a), (*g).min(*a), (*b).min(*a));
    }
    Ok(rows)
}

/// The end for the other process. A file would be written to the disk.
#[cfg(unix)]
fn open_channel() -> Result<Value> {
    use std::os::fd::{AsRawFd as _, IntoRawFd as _};
    let (mut ours, theirs) = std::os::unix::net::UnixStream::pair()?;
    for (socket, option) in [(&ours, libc::SO_RCVBUF), (&theirs, libc::SO_SNDBUF)] {
        let size: libc::c_int = 1 << 21;
        // SAFETY: `size` is as long as it is said to be.
        unsafe {
            libc::setsockopt(
                socket.as_raw_fd(),
                libc::SOL_SOCKET,
                option,
                (&raw const size).cast(),
                size_of_val(&size) as _,
            )
        };
    }
    let (sender, receiver) = std::sync::mpsc::channel();
    std::thread::Builder::new()
        .name("web frames".into())
        .spawn(move || {
            let mut next = || {
                let mut length = [0; 4];
                ours.read_exact(&mut length).ok()?;
                let length = u32::from_le_bytes(length) as u64;
                (length <= MAX_SIDE * MAX_SIDE).then_some(())?;
                sender
                    .send(read_pixels(&mut ours, length as usize).ok()?)
                    .ok()
            };
            while next().is_some() {}
        })?;
    CHANNEL.set(Some(receiver));
    OWED.set(0);
    Ok(theirs.into_raw_fd().into())
}

#[cfg(not(unix))]
fn open_channel() -> Result<Value> {
    Ok(Value::Null)
}

impl View {
    fn columns(&self) -> i32 {
        (self.pixmap.width() as i32 + TILE - 1) / TILE
    }

    fn all(&self) -> IntRect {
        IntRect::new(
            0,
            0,
            self.pixmap.width() as i32,
            self.pixmap.height() as i32,
        )
    }

    pub fn tiles(&self) -> impl Iterator<Item = (IntRect, u32)> {
        let (columns, all) = (self.columns(), self.all());
        (0..).zip(&self.tiles).map(move |(index, version)| {
            let (left, top) = (index % columns * TILE, index / columns * TILE);
            (
                IntRect::new(left, top, left + TILE, top + TILE).intersect(all),
                *version,
            )
        })
    }

    fn set_pixmap(&mut self, pixmap: Pixmap) {
        self.pixmap = pixmap;
        let rows = (self.pixmap.height() as i32 + TILE - 1) / TILE;
        self.tiles = vec![self.version; (rows * self.columns()) as usize];
    }

    /// `rows` has four bytes for each pixel of `rect`.
    fn update(&mut self, rect: IntRect, rows: &[u8]) {
        let (columns, stride) = (self.columns(), self.pixmap.width() as usize * 4);
        for (y, row) in (rect.top..rect.bottom).zip(rows.chunks_exact(rect.width() * 4)) {
            let mut left = rect.left;
            while left < rect.right {
                let right = ((left / TILE + 1) * TILE).min(rect.right);
                let from = &row[(left - rect.left) as usize * 4..(right - rect.left) as usize * 4];
                let to = &mut self.pixmap.data_mut()[y as usize * stride + left as usize * 4..]
                    [..from.len()];
                if from != to {
                    to.copy_from_slice(from);
                    self.tiles[(y / TILE * columns + left / TILE) as usize] = self.version;
                }
                left = right;
            }
        }
    }

    fn read(&mut self, arguments: &Value, received: Option<Vec<u8>>) -> Result<()> {
        let number = |key: &str| {
            arguments[key]
                .as_u64()
                .filter(|it| *it <= MAX_SIDE)
                .context("bad frame")
        };
        let (width, height) = (number("width")? as u32, number("height")? as u32);
        let (left, top) = (number("x")? as i32, number("y")? as i32);
        let rect = IntRect::new(
            left,
            top,
            left + number("w")? as i32,
            top + number("h")? as i32,
        );
        if (width, height) != (self.pixmap.width(), self.pixmap.height()) {
            self.set_pixmap(Pixmap::new(width, height).context("bad frame")?);
        }
        ensure!(
            !rect.is_empty() && rect.intersect(self.all()) == rect,
            "bad frame"
        );
        let rows = match received {
            Some(rows) => rows,
            None => {
                let file = self.file.as_mut().context("bad frame")?;
                file.seek(SeekFrom::Start(0))?;
                read_pixels(file, rect.area() as usize * 4)?
            }
        };
        ensure!(rows.len() == rect.area() as usize * 4, "bad frame");
        self.update(rect, &rows);
        *SPARE.lock() = rows;
        Ok(())
    }

    fn show(&mut self, pixmap: Pixmap) {
        match (pixmap.width(), pixmap.height()) == (self.pixmap.width(), self.pixmap.height()) {
            true => self.update(self.all(), pixmap.data()),
            false => self.set_pixmap(pixmap),
        }
    }
}

pub fn with<R>(id: u32, f: impl FnOnce(&View, u32) -> R) -> Option<R> {
    VIEWS.with_borrow(|views| views.get(&id).map(|view| f(view, view.version)))
}

pub fn command(name: &str, arguments: &Value) -> Result<Value> {
    let id = arguments["id"].as_u64().unwrap_or(0) as u32;
    match name {
        "helper" => {
            return Ok(json!({
                "wire": include_str!("../../../src/js/internal/desktop/webview/wire.ts"),
                "main": include_str!("webview/helper.js"),
                "frame": include_str!("webview/frame.js"),
            }));
        }
        "open" => {
            let file = arguments["path"].as_str().map(File::open).transpose()?;
            let pixmap = Pixmap::new(1, 1).expect("it is a size");
            let id = images::next_id();
            let view = View {
                pixmap,
                scale: 1.,
                version: 0,
                tiles: vec![0],
                file,
            };
            VIEWS.with_borrow_mut(|views| views.insert(id, view));
            return Ok(id.into());
        }
        "channel" => return open_channel(),
        "close" => {
            VIEWS.with_borrow_mut(|views| views.remove(&id));
            *SPARE.lock() = Vec::new();
        }
        "show" => surface::show_image(arguments["surface"].as_u64().unwrap_or(0) as u32, id),
        "regions" => {
            let regions: Vec<([f32; 4], bool)> = Vec::deserialize(&arguments["regions"])?;
            let region = |([x, y, width, height], drag): ([f32; 4], bool)| Region {
                rect: Rect {
                    x,
                    y,
                    width,
                    height,
                },
                drag,
            };
            let surface = arguments["surface"].as_u64().unwrap_or(0) as u32;
            surface::set_regions_of_image(surface, id, regions.into_iter().map(region).collect());
        }
        "mirror" => {
            let scale = arguments["scale"].as_f64().map_or(1., |scale| scale as f32);
            let surface = surface::get(arguments["surface"].as_u64().unwrap_or(0) as u32)
                .context("there is no such surface")?;
            let shown = with(id, |view, _| (view.scale == scale).then(|| view.all())).flatten();
            let part = surface::parse_rect(&arguments["rect"])
                .zip(shown)
                .map(|(rect, shown)| {
                    IntRect::nearest(Rect {
                        x: rect.x * scale,
                        y: rect.y * scale,
                        width: rect.width * scale,
                        height: rect.height * scale,
                    })
                    .intersect(shown)
                });
            if part.is_some_and(|part| part.is_empty()) {
                return Ok(Value::Null);
            }
            let layer = match part {
                Some(part) => surface.borrow().render_area(part, scale)?,
                None => surface.borrow().render(None, scale)?,
            };
            VIEWS.with_borrow_mut(|views| {
                let Some(view) = views.get_mut(&id) else {
                    return;
                };
                (view.version, view.scale) = (view.version.wrapping_add(1), scale);
                match part {
                    Some(part) => view.update(part, layer.pixmap.data()),
                    None => view.show(layer.pixmap),
                }
            });
        }
        "frame" => VIEWS.with_borrow_mut(|views| {
            let channel = |it: &Option<Receiver<_>>| loop {
                let received = it.as_ref()?.recv_timeout(Duration::from_secs(1)).ok()?;
                if OWED.replace(OWED.get() - 1) == 1 {
                    break Some(received);
                }
            };
            OWED.set(OWED.get() + usize::from(arguments["isSent"] == true));
            let received = if arguments["isSent"] == true {
                CHANNEL.with_borrow(channel)
            } else {
                None
            };
            let Some(view) = views.get_mut(&id) else {
                return Ok(());
            };
            view.version = view.version.wrapping_add(1);
            view.scale = arguments["scale"].as_f64().map_or(1., |scale| scale as f32);
            match arguments.get("blob") {
                Some(blob) => images::decode_pixmap(&bridge::blob(blob)?)
                    .context("bad frame")
                    .map(|it| view.show(it)),
                None => view.read(arguments, received),
            }
        })?,
        _ => bail!("unknown command webview.{name}"),
    }
    surface::image_changed(id);
    Ok(Value::Null)
}
