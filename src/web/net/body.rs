//! Bodies are bytes that any thread can read.

use core::future::poll_fn;
use core::ops::{Deref, Range};
use core::pin::Pin;
use core::sync::atomic::{AtomicUsize, Ordering};
use core::task::{Context, Poll, ready};
use std::collections::VecDeque;
use std::sync::Arc;

use bun_sys::{Fd, File, O};
use bun_threading::Guarded;

use super::error::{NetError, Result};
use crate::Bytes;
use crate::exec::{Receiver, Waiter, blocking};
use crate::remote;
use crate::wire::{self, Wire};

/// Before all of `room` is written.
pub fn prefault<T>(room: &mut [T]) {
    unsafe extern "C" {
        fn Bun__prefault(start: *mut core::ffi::c_void, length: usize);
    }
    // SAFETY: what the memory holds does not change.
    unsafe { Bun__prefault(room.as_mut_ptr().cast(), size_of_val(room)) };
}

pub fn concat(parts: &[&[u8]]) -> Vec<u8> {
    let mut all = Vec::with_capacity(parts.iter().map(|it| it.len()).sum());
    prefault(all.spare_capacity_mut());
    parts.iter().for_each(|it| all.extend_from_slice(it));
    all
}

pub enum Chunk {
    Owned(Vec<u8>),
    Shared(SharedBytes),
}

impl Chunk {
    pub fn into_vec(self) -> Vec<u8> {
        match self {
            Chunk::Owned(bytes) => bytes,
            Chunk::Shared(bytes) => bytes.into_vec(),
        }
    }

    pub fn into_shared(self) -> SharedBytes {
        match self {
            Chunk::Owned(bytes) => bytes.into(),
            Chunk::Shared(bytes) => bytes,
        }
    }
}

impl Deref for Chunk {
    type Target = [u8];

    fn deref(&self) -> &[u8] {
        match self {
            Chunk::Owned(bytes) => bytes,
            Chunk::Shared(bytes) => bytes,
        }
    }
}

pub trait Owner: AsRef<[u8]> + Send + Sync + 'static {
    fn take(&mut self) -> Option<Vec<u8>> {
        None
    }
}

impl Owner for &'static [u8] {}

impl Owner for Vec<u8> {
    fn take(&mut self) -> Option<Vec<u8>> {
        Some(core::mem::take(self))
    }
}

#[derive(Clone)]
pub struct SharedBytes {
    owner: Arc<dyn Owner>,
    range: Range<usize>,
}

impl SharedBytes {
    fn into_vec(mut self) -> Vec<u8> {
        let is_most = self.range.len() > (*self.owner).as_ref().len() / 2;
        let owner = Arc::get_mut(&mut self.owner).filter(|_| is_most);
        let Some(mut all) = owner.and_then(Owner::take) else {
            return concat(&[&self]);
        };
        all.truncate(self.range.end);
        all.drain(..self.range.start);
        all
    }

    pub fn new(owner: impl Owner) -> SharedBytes {
        SharedBytes {
            range: 0..owner.as_ref().len(),
            owner: Arc::new(owner),
        }
    }

    pub fn slice(&self, range: Range<usize>) -> SharedBytes {
        let end = (self.range.start + range.end).min(self.range.end);
        SharedBytes {
            owner: Arc::clone(&self.owner),
            range: (self.range.start + range.start).min(end)..end,
        }
    }
}

impl From<Vec<u8>> for SharedBytes {
    fn from(bytes: Vec<u8>) -> SharedBytes {
        SharedBytes::new(bytes)
    }
}

impl Deref for SharedBytes {
    type Target = [u8];

    fn deref(&self) -> &[u8] {
        &(*self.owner).as_ref()[self.range.clone()]
    }
}

/// What can be read any number of times.
#[derive(Clone)]
pub enum Data {
    Bytes(SharedBytes),
    File {
        path: Bytes,
        range: Range<u64>,
        /// It cannot be read if [`time_of_modification`] has become another.
        modified: Option<i64>,
    },
    Parts(Arc<[Data]>),
}

impl Data {
    pub fn concat(parts: Vec<Data>) -> Data {
        let in_memory = parts.iter().map(|it| match it {
            Data::Bytes(bytes) => Some(&**bytes),
            _ => None,
        });
        match in_memory.collect::<Option<Vec<_>>>() {
            Some(all) => Data::Bytes(concat(&all).into()),
            None => Data::Parts(parts.into()),
        }
    }

    pub fn len(&self) -> u64 {
        match self {
            Data::Bytes(bytes) => bytes.len() as u64,
            Data::File { range, .. } => range.end - range.start,
            Data::Parts(parts) => parts.iter().map(Data::len).sum(),
        }
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    pub fn slice(&self, part: Range<u64>) -> Data {
        match self {
            Data::Bytes(bytes) => Data::Bytes(bytes.slice(part.start as usize..part.end as usize)),
            Data::File {
                path,
                range,
                modified,
            } => {
                let end = range.start.saturating_add(part.end).min(range.end);
                Data::File {
                    path: path.clone(),
                    range: range.start.saturating_add(part.start).min(end)..end,
                    modified: *modified,
                }
            }
            Data::Parts(parts) => {
                let slices = parts.iter().scan(0, |start, it| {
                    let slice = part.start.saturating_sub(*start)..part.end.saturating_sub(*start);
                    *start += it.len();
                    Some(it.slice(slice.start.min(it.len())..slice.end.min(it.len())))
                });
                Data::Parts(slices.collect())
            }
        }
    }

    pub fn open(&self) -> Body {
        match self {
            Data::Bytes(bytes) => Chunk::Shared(bytes.clone()).into(),
            Data::File {
                path,
                range,
                modified,
            } => Body::new(FileSource {
                file: Err(path.clone()),
                modified: *modified,
                first: range.start,
                left: range.clone(),
                reading: None,
                part: PART,
            }),
            Data::Parts(parts) => parts.iter().map(Data::open).collect(),
        }
    }

    /// Blocks.
    pub fn read_now(&self) -> Result<Chunk> {
        Ok(match self {
            Data::Bytes(bytes) => Chunk::Shared(bytes.clone()),
            Data::File {
                path,
                range,
                modified,
            } => Chunk::Owned(read_part(Err(path.clone()), range.clone(), *modified)?.1),
            Data::Parts(parts) => {
                let mut all = Vec::new();
                for part in &**parts {
                    all.extend_from_slice(&part.read_now()?);
                }
                Chunk::Owned(all)
            }
        })
    }
}

impl Wire for SharedBytes {
    fn write(self, to: &mut wire::Writer) {
        to.put_bytes(&self);
    }

    fn read(from: &mut wire::Reader<'_>) -> wire::Result<SharedBytes> {
        Vec::read(from).map(Into::into)
    }
}

crate::wire! {
    enum Part {
        Bytes(SharedBytes),
        File { path: Bytes, range: Range<u64>, modified: Option<i64> },
    }
}

impl Data {
    fn flatten(self, into: &mut Vec<Part>) {
        match self {
            Data::Bytes(bytes) => into.push(Part::Bytes(bytes)),
            Data::File {
                path,
                range,
                modified,
            } => into.push(Part::File {
                path,
                range,
                modified,
            }),
            Data::Parts(parts) => parts.iter().for_each(|it| it.clone().flatten(into)),
        }
    }
}

/// A page process can only name the files that it has been given.
impl Wire for Data {
    fn write(self, to: &mut wire::Writer) {
        let mut parts = Vec::new();
        self.flatten(&mut parts);
        for part in &parts {
            if let (Part::File { path, .. }, Some(peer)) = (part, to.peer()) {
                remote::grant(peer, path);
            }
        }
        parts.write(to);
    }

    fn read(from: &mut wire::Reader<'_>) -> wire::Result<Data> {
        let (peer, mut length) = (from.peer(), 0u64);
        let check = |part| {
            let data = match part {
                Part::Bytes(bytes) => Data::Bytes(bytes),
                Part::File { path, .. }
                    if peer.is_some_and(|it| !remote::is_granted(it, &path)) =>
                {
                    return Err(wire::Malformed);
                }
                Part::File {
                    path,
                    range,
                    modified,
                } => Data::File {
                    path,
                    range,
                    modified,
                },
            };
            length = length.checked_add(data.len()).ok_or(wire::Malformed)?;
            Ok(data)
        };
        let mut parts =
            (Vec::read(from)?.into_iter().map(check)).collect::<wire::Result<Vec<_>>>()?;
        Ok(match parts.pop_if(|_| true) {
            Some(only) if parts.is_empty() => only,
            last => Data::Parts(parts.into_iter().chain(last).collect()),
        })
    }
}

struct Chain(VecDeque<Body>);

impl Source for Chain {
    fn poll_read(&mut self, cx: &mut Context<'_>) -> Poll<Read> {
        while let Some(first) = self.0.front_mut() {
            match ready!(first.poll_read(cx)) {
                Ok(None) => drop(self.0.pop_front()),
                read => return Poll::Ready(read),
            }
        }
        Poll::Ready(Ok(None))
    }
}

crate::wire! {
    #[derive(Clone)]
    pub struct Blob {
        pub data: Data,
        pub mime: Bytes,
    }
}

/// For the responses that are on their way into memory as a whole.
pub struct Budget {
    used: AtomicUsize,
    limit: usize,
}

pub static FOR_SUBRESOURCES: Budget = Budget {
    used: AtomicUsize::new(0),
    limit: 512 << 20,
};
pub static FOR_DATA: Budget = Budget {
    used: AtomicUsize::new(0),
    limit: 2 << 30,
};

pub struct Share {
    of: &'static Budget,
    used: usize,
}

impl Share {
    pub fn of(budget: &'static Budget) -> Share {
        Share {
            of: budget,
            used: 0,
        }
    }

    pub fn grow(&mut self, by: usize) -> Result<()> {
        const SMALL: usize = 4 << 20;
        self.used += by;
        let used = self.of.used.fetch_add(by, Ordering::Relaxed) + by;
        if self.used > SMALL && used > self.of.limit {
            return Err(NetError::InsufficientResources);
        }
        Ok(())
    }
}

impl Drop for Share {
    fn drop(&mut self) {
        self.of.used.fetch_sub(self.used, Ordering::Relaxed);
    }
}

/// `None` at the end.
pub type Read = Result<Option<Chunk>>;

pub trait Source: Send {
    fn poll_read(&mut self, cx: &mut Context<'_>) -> Poll<Read>;

    /// There is no use in holding back, or in small parts. If it takes what has been `read`, it returns that again.
    fn expect_read_to_end(&mut self, _: &'static Budget, _read: &mut Vec<u8>) {}

    /// The bytes that it has gathered since.
    fn gathered(&self) -> u64 {
        0
    }
}

#[derive(Default)]
pub struct Body {
    first: Option<Chunk>,
    rest: Option<Box<dyn Source>>,
}

impl From<Chunk> for Body {
    fn from(all: Chunk) -> Body {
        Body {
            first: Some(all).filter(|it| !it.is_empty()),
            rest: None,
        }
    }
}

impl From<Vec<u8>> for Body {
    fn from(all: Vec<u8>) -> Body {
        Chunk::Owned(all).into()
    }
}

impl FromIterator<Body> for Body {
    fn from_iter<I: IntoIterator<Item = Body>>(parts: I) -> Body {
        Body::new(Chain(parts.into_iter().collect()))
    }
}

impl Source for NetError {
    fn poll_read(&mut self, _: &mut Context<'_>) -> Poll<Read> {
        Poll::Ready(Err(*self))
    }
}

impl Source for Body {
    fn poll_read(&mut self, cx: &mut Context<'_>) -> Poll<Read> {
        if let Some(first) = self.first.take() {
            return Poll::Ready(Ok(Some(first)));
        }
        let Some(rest) = &mut self.rest else {
            return Poll::Ready(Ok(None));
        };
        let read = ready!(rest.poll_read(cx));
        if matches!(read, Ok(None)) {
            self.rest = None;
        }
        Poll::Ready(read)
    }

    /// It always takes it.
    fn expect_read_to_end(&mut self, budget: &'static Budget, read: &mut Vec<u8>) {
        let mut read = core::mem::take(read);
        match self.first.take() {
            Some(first) if !read.is_empty() => read.extend_from_slice(&first),
            Some(Chunk::Owned(first)) => read = first,
            first => self.first = first,
        }
        if let Some(rest) = &mut self.rest {
            rest.expect_read_to_end(budget, &mut read);
        }
        if !read.is_empty() {
            self.first = Some(Chunk::Owned(read));
        }
    }

    fn gathered(&self) -> u64 {
        self.rest.as_ref().map_or(0, |it| it.gathered())
    }
}

impl Body {
    pub fn new(source: impl Source + 'static) -> Body {
        Body {
            first: None,
            rest: Some(Box::new(source)),
        }
    }

    pub(crate) fn after(self, start: Vec<u8>) -> Body {
        Body {
            first: Some(Chunk::Owned(start)).filter(|it| !it.is_empty()),
            ..self
        }
    }

    pub async fn read(&mut self) -> Read {
        poll_fn(|cx| self.poll_read(cx)).await
    }

    pub async fn read_to_end(self) -> Result<Chunk> {
        self.read_within(&FOR_DATA).await
    }

    pub async fn read_within(mut self, budget: &'static Budget) -> Result<Chunk> {
        self.expect_read_to_end(budget, &mut Vec::new());
        let Some(first) = self.read().await? else {
            return Ok(Chunk::Owned(Vec::new()));
        };
        let Some(second) = self.read().await? else {
            return Ok(first);
        };
        let (mut all, mut share) = (concat(&[&first, &second]), Share::of(budget));
        while let Some(more) = self.read().await? {
            if self.gathered() == 0 {
                share.grow(more.len())?;
            }
            all.extend_from_slice(&more);
        }
        Ok(Chunk::Owned(all))
    }

    /// Up to `length` bytes of its start, which are still to be read.
    pub async fn peek(&mut self, length: usize) -> Result<&[u8]> {
        let mut start = self.first.take();
        while start.as_ref().is_none_or(|it| it.len() < length) {
            let Some(more) = self.read().await? else {
                break;
            };
            start = Some(match start {
                Some(start) => Chunk::Owned([&*start, &*more].concat()),
                None => more,
            });
        }
        self.first = start;
        let start = self.first.as_deref().unwrap_or_default();
        Ok(&start[..start.len().min(length)])
    }
}

const PART: u64 = 256 << 10;

struct FileSource {
    /// The path, until it is opened.
    file: core::result::Result<Arc<File>, Bytes>,
    modified: Option<i64>,
    first: u64,
    left: Range<u64>,
    reading: Option<Receiver<Result<(Arc<File>, Vec<u8>)>>>,
    part: u64,
}

/// In nanoseconds.
pub fn time_of_modification(stat: &bun_sys::Stat) -> i64 {
    let time = bun_sys::stat_mtime(stat);
    time.sec
        .saturating_mul(1_000_000_000)
        .saturating_add(time.nsec)
}

fn read_part(
    file: core::result::Result<Arc<File>, Bytes>,
    range: Range<u64>,
    modified: Option<i64>,
) -> Result<(Arc<File>, Vec<u8>)> {
    let file = match file {
        Ok(file) => file,
        Err(path) => Arc::new(File::openat(Fd::cwd(), &path, O::RDONLY | O::CLOEXEC, 0)?),
    };
    let stat = file.stat()?;
    let size = stat.st_size as u64;
    if modified.is_some_and(|it| it != time_of_modification(&stat) || size < range.end) {
        return Err(NetError::UploadFileChanged);
    }
    let length = (range.end - range.start).min(size.saturating_sub(range.start));
    let mut bytes = Vec::new();
    (bytes.try_reserve_exact(length as usize)).map_err(|_| NetError::InsufficientResources)?;
    prefault(bytes.spare_capacity_mut());
    // SAFETY: `pread_all` only writes, and returns how much.
    unsafe {
        bun_core::vec::fill_spare(&mut bytes, 0, |room| {
            let read = file.pread_all(&mut room[..length as usize], range.start);
            (*read.as_ref().unwrap_or(&0), read)
        })
    }?;
    Ok((file, bytes))
}

impl Source for FileSource {
    fn poll_read(&mut self, cx: &mut Context<'_>) -> Poll<Read> {
        if self.left.is_empty() {
            return Poll::Ready(Ok(None));
        }
        let reading = self.reading.get_or_insert_with(|| {
            let (file, start, modified) = (self.file.clone(), self.left.start, self.modified);
            let end = start.saturating_add(self.part).min(self.left.end);
            blocking(move || read_part(file, start..end, modified))
        });
        let read = ready!(Pin::new(reading).poll(cx));
        self.reading = None;
        let (file, bytes) = read.ok_or(NetError::Failed)??;
        self.file = Ok(file);
        let is_short = (bytes.len() as u64) < self.part;
        self.left.start = if is_short {
            self.left.end
        } else {
            self.left.start + bytes.len() as u64
        };
        Poll::Ready(Ok(Some(Chunk::Owned(bytes)).filter(|it| !it.is_empty())))
    }

    fn expect_read_to_end(&mut self, _: &'static Budget, read: &mut Vec<u8>) {
        let has_read = read.len() as u64 <= self.left.start - self.first;
        if has_read && !self.left.is_empty() && self.part != u64::MAX {
            self.left.start -= core::mem::take(read).len() as u64;
            (self.reading, self.part) = (None, u64::MAX);
        }
    }
}

#[derive(Default)]
struct Pipe {
    chunks: VecDeque<Chunk>,
    length: usize,
    end: Option<Result<()>>,
    is_abandoned: bool,
    reader: Waiter,
    writer: Waiter,
}

pub struct Writer {
    pipe: Arc<Guarded<Pipe>>,
    capacity: usize,
}

struct Reader(Arc<Guarded<Pipe>>);

/// With a capacity of 0, nothing is asked of the writer before there is a read.
pub fn pipe(capacity: usize) -> (Writer, Body) {
    let pipe = Arc::new(Guarded::new(Pipe::default()));
    (
        Writer {
            pipe: Arc::clone(&pipe),
            capacity,
        },
        Body::new(Reader(pipe)),
    )
}

impl Writer {
    /// False if nobody will read.
    pub async fn ready(&self) -> bool {
        poll_fn(|cx| {
            let mut pipe = self.pipe.lock();
            if pipe.is_abandoned || pipe.length < self.capacity || pipe.reader.is_waiting() {
                return Poll::Ready(!pipe.is_abandoned);
            }
            pipe.writer.pending(cx)
        })
        .await
    }

    pub async fn abandoned(&self) {
        poll_fn(|cx| {
            let mut pipe = self.pipe.lock();
            if pipe.is_abandoned {
                Poll::Ready(())
            } else {
                pipe.writer.pending(cx)
            }
        })
        .await;
    }

    pub fn write(&self, chunk: Chunk) {
        let mut pipe = self.pipe.lock();
        if !chunk.is_empty() {
            pipe.length += chunk.len();
            pipe.chunks.push_back(chunk);
            pipe.reader.wake();
        }
    }

    pub fn fail(&self, error: NetError) {
        self.pipe.lock().end = Some(Err(error));
    }

    pub fn end(self, how: Result<()>) {
        self.pipe.lock().end = Some(how);
    }
}

impl Drop for Writer {
    fn drop(&mut self) {
        let mut pipe = self.pipe.lock();
        pipe.end.get_or_insert(Err(NetError::Aborted));
        pipe.reader.wake();
    }
}

impl Source for Reader {
    fn poll_read(&mut self, cx: &mut Context<'_>) -> Poll<Read> {
        let mut pipe = self.0.lock();
        if let Some(chunk) = pipe.chunks.pop_front() {
            pipe.length -= chunk.len();
            pipe.writer.wake();
            return Poll::Ready(Ok(Some(chunk)));
        }
        if let Some(end) = pipe.end {
            return Poll::Ready(end.map(|()| None));
        }
        pipe.writer.wake();
        pipe.reader.pending(cx)
    }
}

impl Drop for Reader {
    fn drop(&mut self) {
        let mut pipe = self.0.lock();
        pipe.is_abandoned = true;
        pipe.chunks.clear();
        pipe.writer.wake();
    }
}
