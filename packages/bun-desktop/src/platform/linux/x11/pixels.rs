//! Gets what is painted into a window, on a connection of its own.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, mpsc};

use super::super::socket::Memory;
use super::wire::{Connection, Cookie, Extension, Request};
use super::{event, mask};
use crate::error::{Context as _, Result};
use crate::paint::raster::IntRect;
use crate::platform::{Painter, Pixels};
use crate::sync::{Condvar, Mutex};

struct Buffer {
    id: u64,
    memory: Memory,
    capacity: (i32, i32),
    shown: (i32, i32),
    /// Unless the server is on another machine.
    segment: Option<u32>,
    /// What the window shows, including where it is covered.
    pixmap: u32,
}

pub struct Target {
    x: Connection,
    shm: Option<Extension>,
    window: u32,
    depth: u8,
    gc: u32,
    buffer: Option<Buffer>,
    /// The server is done with the last frame when it replies.
    fence: Option<Cookie>,
    waits_for_exposure: bool,
}

impl Target {
    fn new(window: u32, depth: u8) -> Result<Target> {
        const GRAPHICS_EXPOSURES: u32 = 0x10000;
        let x = Connection::open()?;
        let (shm, gc) = (x.ask_for_extension("MIT-SHM"), x.new_id());
        x.send(Request::new(55, 0).words(&[gc, window, GRAPHICS_EXPOSURES, 0]));
        Ok(Target {
            shm: x.extension(shm),
            x,
            window,
            depth,
            gc,
            buffer: None,
            fence: None,
            waits_for_exposure: false,
        })
    }

    pub fn release(&mut self) {
        if let Some(buffer) = self.buffer.take() {
            self.x.send(Request::new(54, 0).u32(buffer.pixmap));
            self.x.free_id(buffer.pixmap);
            if let Some((shm, segment)) = self.shm.zip(buffer.segment) {
                self.x.send(Request::new(shm.opcode, 2).u32(segment));
                self.x.free_id(segment);
            }
            self.x.flush();
        }
    }

    fn allocate(&self, capacity: (i32, i32)) -> Result<Buffer> {
        static NEXT_ID: AtomicU64 = AtomicU64::new(1);
        let (memory, descriptor) = Memory::new(capacity.0 as usize * capacity.1 as usize)?;
        let segment = self
            .shm
            .map(|shm| (shm, self.x.new_id()))
            .and_then(|(shm, segment)| {
                let attach = Request::new(shm.opcode, 6).words(&[segment, 1]);
                self.x
                    .send_with_descriptor(attach, descriptor)
                    .ok()
                    .map(|()| segment)
            });
        let pixmap = self.x.new_id();
        self.x.send(
            Request::new(53, self.depth)
                .words(&[pixmap, self.window])
                .i16(capacity.0)
                .i16(capacity.1),
        );
        Ok(Buffer {
            id: NEXT_ID.fetch_add(1, Ordering::Relaxed),
            memory,
            capacity,
            shown: (0, 0),
            segment,
            pixmap,
        })
    }

    fn copy(&self, from: u32, to: u32, area: IntRect, down: i32) {
        let request = Request::new(62, 0)
            .words(&[from, to, self.gc])
            .i16(area.left)
            .i16(area.top - down);
        self.x.send(
            request
                .i16(area.left)
                .i16(area.top)
                .u16(area.width() as u16)
                .u16(area.height() as u16),
        );
    }

    fn put(&self, buffer: &mut Buffer, area: IntRect) {
        let (width, height) = (area.width() as u16, area.height() as u16);
        if let Some((shm, segment)) = self.shm.zip(buffer.segment) {
            let request = Request::new(shm.opcode, 3).words(&[buffer.pixmap, self.gc]);
            let request = request
                .i16(buffer.capacity.0)
                .i16(buffer.capacity.1)
                .i16(area.left)
                .i16(area.top);
            let request = request.u16(width).u16(height).i16(area.left).i16(area.top);
            return self
                .x
                .send(request.bytes(&[self.depth, 2, 0, 0]).words(&[segment, 0]));
        }
        let rows = (self.x.max_request_bytes - 24) / (area.width().max(1) * 4);
        for top in (area.top..area.bottom).step_by(rows) {
            let bottom = (top + rows as i32).min(area.bottom);
            let request = Request::new(72, 2)
                .words(&[buffer.pixmap, self.gc])
                .u16(width)
                .i16(bottom - top);
            let mut request = request
                .i16(area.left)
                .i16(top)
                .bytes(&[0, self.depth, 0, 0]);
            for row in top..bottom {
                let start = (row * buffer.capacity.0 + area.left) as usize;
                request = request
                    .bytes(buffer.memory.pixels()[start..start + area.width()].as_flattened());
            }
            self.x.send(request);
        }
    }

    fn draw(
        &mut self,
        paint: Painter,
        shown: (i32, i32),
        afterwards: Option<Request>,
    ) -> Result<()> {
        if let Some(fence) = self.fence.take() {
            self.x.read(0);
            self.x.reply(fence)?;
        }
        let fits = |Buffer { capacity, .. }: &Buffer| {
            capacity.0 >= shown.0
                && capacity.1 >= shown.1
                && capacity.0 * capacity.1 / 3 <= shown.0 * shown.1
        };
        if !self.buffer.as_ref().is_some_and(fits) {
            let spare = if self.buffer.is_some() { 256 } else { 0 };
            self.release();
            self.buffer = Some(self.allocate((shown.0 + spare, shown.1 + spare))?);
        }
        let mut buffer = self.buffer.take().context("there is no buffer")?;
        let (id, width) = (buffer.id, buffer.capacity.0 as usize);
        let mut painted = paint(Pixels {
            id,
            data: buffer.memory.pixels(),
            width,
            shown,
            platform_moves: true,
        });
        // The pixmap is new.
        if buffer.shown == (0, 0) {
            painted.areas = vec![IntRect::new(0, 0, shown.0, shown.1)];
        }
        painted
            .moved
            .iter()
            .for_each(|area| self.copy(buffer.pixmap, buffer.pixmap, *area, painted.moved_by));
        painted
            .areas
            .iter()
            .for_each(|area| self.put(&mut buffer, *area));
        let mut damage = [painted.moved, painted.areas].concat();
        if std::mem::replace(&mut buffer.shown, shown) != shown {
            damage = vec![IntRect::new(0, 0, shown.0, shown.1)];
        }
        damage
            .into_iter()
            .filter(|_| !self.waits_for_exposure)
            .for_each(|area| self.copy(buffer.pixmap, self.window, area, 0));
        afterwards
            .into_iter()
            .for_each(|request| self.x.send(request));
        self.buffer = Some(buffer);
        self.fence = Some(self.x.fence());
        self.x.flush();
        Ok(())
    }

    pub fn expose(&mut self, area: IntRect) {
        self.waits_for_exposure = false;
        let Some(Buffer { pixmap, shown, .. }) = self.buffer else {
            return;
        };
        let (right, bottom) = (area.right.min(shown.0), area.bottom.min(shown.1));
        self.copy(
            pixmap,
            self.window,
            IntRect {
                right,
                bottom,
                ..area
            },
            0,
        );
        self.x.flush();
    }

    /// The server fills the window with what was drawn when it maps it, unless that has to wait.
    pub fn map(&mut self, waits_for_exposure: bool) {
        const BACKGROUND_PIXMAP: u32 = 1;
        let pixmap = self
            .buffer
            .as_ref()
            .filter(|_| !waits_for_exposure)
            .map_or(0, |buffer| buffer.pixmap);
        self.waits_for_exposure = waits_for_exposure;
        self.x
            .send(Request::new(2, 0).words(&[self.window, BACKGROUND_PIXMAP, pixmap]));
        self.x.send(Request::new(8, 0).u32(self.window));
        self.x.flush();
    }

    pub fn unmap(&mut self) {
        let root = self.x.screen.root;
        self.x.send(Request::new(10, 0).u32(self.window));
        // How ICCCM withdraws a minimized window, which is not mapped.
        self.x.send_event(
            root,
            mask::FOR_MANAGER,
            Request::new(event::UNMAP, 0).words(&[root, self.window]),
        );
        self.x.flush();
    }
}

type Job = Box<dyn FnOnce(&mut Target) + Send>;

#[derive(Default)]
pub struct Status {
    jobs: u32,
    wakes_when_done: bool,
}

/// Unless the UI has a thread of its own, it paints on another one, so that JavaScript does not wait.
pub enum Presenter {
    Here(Box<Target>),
    Elsewhere(mpsc::Sender<Job>, Arc<(Mutex<Status>, Condvar)>),
}

impl Presenter {
    /// The server has to know the window.
    pub fn new(window: u32, depth: u8, stays: bool) -> Result<Presenter> {
        let mut target = Target::new(window, depth)?;
        if stays {
            return Ok(Presenter::Here(Box::new(target)));
        }
        let (sender, jobs) = mpsc::channel::<Job>();
        let status: Arc<(Mutex<Status>, Condvar)> = Arc::default();
        std::thread::Builder::new().name("Render".into()).spawn({
            let status = status.clone();
            move || {
                for job in jobs {
                    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| job(&mut target)))
                        .ok();
                    let mut locked = status.0.lock();
                    locked.jobs -= 1;
                    if locked.jobs == 0 {
                        status.1.notify_all();
                        std::mem::take(&mut locked.wakes_when_done).then(crate::host::wake);
                    }
                }
            }
        })?;
        Ok(Presenter::Elsewhere(sender, status))
    }

    pub fn run(&mut self, job: impl FnOnce(&mut Target) + Send + 'static) {
        match self {
            Presenter::Here(target) => job(target),
            Presenter::Elsewhere(jobs, status) => {
                status.0.lock().jobs += 1;
                jobs.send(Box::new(job)).ok();
            }
        }
    }

    /// With a request to follow the pixels.
    pub fn draw(&mut self, paint: Painter, shown: (i32, i32), afterwards: Option<Request>) {
        self.run(move |target| {
            if let Err(error) = target.draw(paint, shown, afterwards) {
                crate::diagnostics::log!("could not draw: {error:#}");
            }
        });
    }

    pub fn is_busy(&self, wakes_when_done: bool) -> bool {
        let Presenter::Elsewhere(_, status) = self else {
            return false;
        };
        let mut status = status.0.lock();
        status.wakes_when_done |= wakes_when_done && status.jobs > 0;
        status.jobs > 0
    }

    pub fn wait(&self) {
        if let Presenter::Elsewhere(_, status) = self {
            status.1.wait_while(&mut status.0.lock(), |it| it.jobs > 0);
        }
    }
}
