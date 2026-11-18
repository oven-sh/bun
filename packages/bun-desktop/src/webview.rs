//! The pixels of a page that a browser engine renders in another process.

use std::cell::{Cell, RefCell};
use std::fs::File;
use std::io::{Read, Seek as _, SeekFrom};
use std::sync::mpsc::Receiver;
use std::time::Duration;

use crate::abi::Rect;
use crate::error::{Context as _, Result, ensure};
use crate::gfx::Pixmap;
use crate::hash::FastMap;
use crate::paint::raster::IntRect;
use crate::protocol::{FramePixels, HelperSources, WebViewCommand};
use crate::sync::Mutex;
use crate::{images, surface};

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
    let mut rows = Some(std::mem::take(&mut *SPARE.lock()))
        .filter(|it| it.len() / 8 <= length)
        .unwrap_or_default();
    rows.resize(length, 0);
    from.read_exact(&mut rows)?;
    for [b, g, r, a] in rows.as_chunks_mut().0 {
        (*b, *g, *r) = ((*r).min(*a), (*g).min(*a), (*b).min(*a));
    }
    Ok(rows)
}

/// The end for the other process. A file would be written to the disk.
pub fn open_channel() -> Result<i32> {
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
            crate::host::thread::is_needed_for_frames();
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
    Ok(theirs.into_raw_fd())
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

    fn read(
        &mut self,
        [width, height]: [u32; 2],
        area: [u32; 4],
        received: Option<Vec<u8>>,
    ) -> Result<()> {
        ensure!(
            area.iter()
                .chain(&[width, height])
                .all(|it| u64::from(*it) <= MAX_SIDE),
            "bad frame"
        );
        let [left, top, columns, rows] = area.map(|it| it as i32);
        let rect = IntRect::new(left, top, left + columns, top + rows);
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

pub extern "C" fn helper_sources() -> HelperSources {
    HelperSources {
        wire: include_str!("webview/wire.js").into(),
        main: include_str!("webview/helper.js").into(),
        frame: include_str!("webview/frame.js").into(),
    }
}

pub fn open(file: Option<&str>) -> Result<u32> {
    let file = file.map(File::open).transpose()?;
    let (id, pixmap) = (images::next_id(), Pixmap::new(1, 1).expect("it is a size"));
    VIEWS.with_borrow_mut(|views| {
        views.insert(
            id,
            View {
                pixmap,
                scale: 1.,
                version: 0,
                tiles: vec![0],
                file,
            },
        )
    });
    Ok(id)
}

pub fn command(id: u32, command: WebViewCommand) -> Result<()> {
    match command {
        WebViewCommand::Close => {
            VIEWS.with_borrow_mut(|views| views.remove(&id));
            crate::accessibility::image_closed(id);
            *SPARE.lock() = Vec::new();
        }
        WebViewCommand::Mirror {
            surface,
            scale,
            area,
        } => {
            let surface = surface::get(surface).context("there is no such surface")?;
            let shown = with(id, |view, _| (view.scale == scale).then(|| view.all())).flatten();
            let part = area.get().zip(shown).map(|(rect, shown)| {
                IntRect::nearest(Rect {
                    x: rect.x * scale,
                    y: rect.y * scale,
                    width: rect.width * scale,
                    height: rect.height * scale,
                })
                .intersect(shown)
            });
            if part.is_some_and(|part| part.is_empty()) {
                return Ok(());
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
        WebViewCommand::Frame { scale, pixels } => VIEWS.with_borrow_mut(|views| {
            let channel = |it: &Option<Receiver<_>>| loop {
                let received = it.as_ref()?.recv_timeout(Duration::from_secs(1)).ok()?;
                if OWED.replace(OWED.get() - 1) == 1 {
                    break Some(received);
                }
            };
            let is_sent = matches!(
                pixels,
                FramePixels::Raw {
                    is_in_channel: true,
                    ..
                }
            );
            OWED.set(OWED.get() + usize::from(is_sent));
            let received = if is_sent {
                CHANNEL.with_borrow(channel)
            } else {
                None
            };
            let Some(view) = views.get_mut(&id) else {
                return Ok(());
            };
            (view.version, view.scale) = (view.version.wrapping_add(1), scale);
            match pixels {
                FramePixels::Encoded(bytes) => images::decode_pixmap(&bytes)
                    .context("bad frame")
                    .map(|it| view.show(it)),
                FramePixels::Raw { size, area, .. } => view.read(size, area, received),
            }
        })?,
    }
    surface::image_changed(id);
    Ok(())
}
