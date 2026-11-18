//! The files of <https://fs.spec.whatwg.org/>

use core::ops::Deref;
use core::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, OnceLock};

use bun_core::fmt::bytes_to_hex_lower_string as hex;
use bun_core::{ZBox, strings};
use bun_sha_hmac::sha::evp::SHA256;
use bun_sys::{Dir, E, EntryKind, Fd, File, O};
use bun_threading::Guarded;

use super::{Origins, QUOTA, Shelf, Storage};
use crate::Bytes;
use crate::exec::{Receiver, blocking};
use crate::net::schemes::mime_of_file;
use crate::remote::petition::{self, Handle};
use crate::serial::Serial;

const MAX_NAME_LEN: usize = 100;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum FileError {
    NotFound,
    TypeMismatch,
    Locked,
    NotEmpty,
    IsDirectory,
    QuotaExceeded,
    Failed,
}

crate::wire!(impl enum FileError { NotFound, TypeMismatch, Locked, NotEmpty, IsDirectory, QuotaExceeded, Failed, });

impl From<bun_sys::Error> for FileError {
    fn from(error: bun_sys::Error) -> FileError {
        match error.get_errno() {
            E::ENOENT | E::ENOTDIR => FileError::NotFound,
            E::ENOSPC | E::EFBIG => FileError::QuotaExceeded,
            E::ENOTEMPTY => FileError::NotEmpty,
            _ => FileError::Failed,
        }
    }
}

pub type Result<T = ()> = core::result::Result<T, FileError>;

keywords! {
    pub enum Kind {
        File = b"file",
        Directory = b"directory",
    }
}

/// Only those of the same mode get along, and exclusive ones do not.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum LockMode {
    Exclusive,
    Siloed,
    ReadOnly,
    Unsafe,
    Removing,
}

crate::wire!(impl enum LockMode { Exclusive, Siloed, ReadOnly, Unsafe, Removing, });

#[derive(Default)]
pub(super) struct Files {
    directory: OnceLock<Bytes>,
    operations: Arc<Serial>,
    locks: Guarded<Vec<(u32, Bytes, LockMode)>>,
}

static TEMPORARY_DIRECTORIES: Guarded<Vec<Bytes>> = Guarded::new(Vec::new());

fn next_id() -> u32 {
    static NEXT: AtomicU32 = AtomicU32::new(0);
    NEXT.fetch_add(1, Ordering::Relaxed)
}

fn temporary_directory() -> Bytes {
    extern "C" fn delete_all() {
        TEMPORARY_DIRECTORIES
            .lock()
            .iter()
            .for_each(|it| _ = Dir::cwd().delete_tree(it));
    }
    let directory = Bytes::from(
        [
            bun_resolver::fs::RealFS::tmpdir_path(),
            format!("/bun-desktop-files-{:016x}", crate::random()).as_bytes(),
        ]
        .concat(),
    );
    TEMPORARY_DIRECTORIES.lock().push(directory.clone());
    bun_core::add_exit_callback(delete_all);
    directory
}

fn hash_of(bucket: &[u8]) -> String {
    let mut digest = [0; 32];
    SHA256::hash(bucket, &mut digest);
    hex(&digest[..16])
}

/// Starts with that of the origin.
fn name_of(bucket: &[u8]) -> String {
    strings::split_once_char(bucket, b'^').map_or_else(
        || hash_of(bucket),
        |(origin, top)| hash_of(origin) + &hash_of(top),
    )
}

fn kind_of(path: &[u8]) -> Option<Kind> {
    let stat = bun_sys::stat(&ZBox::from_bytes(path)).ok()?;
    Some(if bun_sys::S::ISDIR(stat.st_mode as _) {
        Kind::Directory
    } else {
        Kind::File
    })
}

fn require(path: &[u8], kind: Kind) -> Result {
    if kind_of(path) == Some(kind) {
        Ok(())
    } else {
        Err(FileError::NotFound)
    }
}

/// Also if it is being read, which `rename` refuses on Windows.
fn replace(path: &[u8], by: &[u8]) -> Result {
    Ok(bun_sys::renameat(
        Fd::cwd(),
        &ZBox::from_bytes(by),
        Fd::cwd(),
        &ZBox::from_bytes(path),
    )?)
}

fn entries_of(directory: &[u8]) -> Result<Vec<(Bytes, Kind)>> {
    let (directory, mut found) = (Dir::open(directory)?, Vec::new());
    let mut entries = bun_sys::iterate_dir(directory.fd());
    while let Some(entry) = entries.next()? {
        found.push((
            entry.name.slice_u8().into(),
            if entry.kind == EntryKind::Directory {
                Kind::Directory
            } else {
                Kind::File
            },
        ));
    }
    Ok(found)
}

fn size_of_tree(directory: &[u8]) -> u64 {
    let (mut size, mut left) = (0, vec![directory.to_vec()]);
    while let Some(directory) = left.pop() {
        for (name, kind) in entries_of(&directory).unwrap_or_default() {
            let path = [&*directory, b"/", &name].concat();
            match kind {
                Kind::Directory => left.push(path),
                Kind::File => {
                    size += bun_sys::stat(&ZBox::from_bytes(path)).map_or(0, |it| it.st_size as u64)
                }
            }
        }
    }
    size
}

impl Storage {
    fn directory_of_files(&self) -> &[u8] {
        self.files.directory.get_or_init(|| {
            self.directory
                .as_ref()
                .map_or_else(temporary_directory, |it| {
                    [it, &b"/File System"[..]].concat().into()
                })
        })
    }

    fn directory_of(&self, bucket: &[u8]) -> Vec<u8> {
        [self.directory_of_files(), b"/", name_of(bucket).as_bytes()].concat()
    }

    pub(super) fn size_of_files(&self, bucket: &[u8]) -> u64 {
        size_of_tree(&self.directory_of(bucket))
    }

    pub(super) fn clear_files(
        self: &Arc<Self>,
        origins: Arc<Origins>,
    ) -> impl Future<Output = Option<()>> + use<> {
        let this = Arc::clone(self);
        self.files.operations.run(move || {
            let listed: Vec<_> = origins.listed.iter().map(|it| hash_of(it)).collect();
            for (name, _) in entries_of(this.directory_of_files()).unwrap_or_default() {
                if listed.iter().any(|it| name.starts_with(it.as_bytes())) == origins.are_meant {
                    let _ = Dir::open(&[this.directory_of_files(), b"/", &name].concat())
                        .and_then(|it| it.delete_children());
                }
            }
        })
    }
}

/// Released when it is dropped.
enum Lock {
    Near(Arc<Storage>, u32),
    Far(Handle),
}

impl Drop for Lock {
    fn drop(&mut self) {
        if let Lock::Near(storage, id) = self {
            storage.files.locks.lock().retain(|it| it.0 != *id);
        }
    }
}

pub fn is_valid_name(name: &[u8]) -> bool {
    !matches!(name, b"" | b"." | b"..")
        && !strings::contains_any(name, b"/\\")
        && name.len() <= MAX_NAME_LEN
}

/// <https://fs.spec.whatwg.org/#file-system-locator>
#[derive(Clone)]
pub struct Locator {
    storage: Arc<Storage>,
    bucket: Arc<[u8]>,
    pub names: Vec<Bytes>,
}

crate::wire! {
    /// A locator on its way to the host.
    pub(crate) struct Entry {
        pub(crate) shelf: Shelf,
        pub(crate) names: Vec<Bytes>,
    }
}

async fn from_host<T>(answer: Receiver<Result<T>>) -> Result<T> {
    answer.await.unwrap_or(Err(FileError::Failed))
}

async fn file_from_host(opened: Receiver<Result>, handle: Handle) -> Result<OpenFile> {
    from_host(opened).await?;
    let file = petition::descriptor(handle.id())
        .and_then(|it| it.1)
        .ok_or(FileError::Failed)?;
    Ok(OpenFile {
        file,
        _lock: Lock::Far(handle),
    })
}

pub fn mime_of_name(name: &[u8]) -> Vec<u8> {
    Some(mime_of_file(name))
        .filter(|it| !bun_paths::extension(name).is_empty() && it != b"application/octet-stream")
        .unwrap_or_default()
}

macro_rules! later {
    ($result:ty) => { impl Future<Output = Result<$result>> + use<> };
}

impl Locator {
    pub fn new(storage: Arc<Storage>, bucket: &[u8], names: Vec<Bytes>) -> Locator {
        Locator {
            storage,
            bucket: bucket.into(),
            names,
        }
    }

    pub fn child(&self, name: &[u8]) -> Locator {
        let mut child = self.clone();
        child.names.push(name.into());
        child
    }

    pub fn parent(&self) -> Locator {
        let mut parent = self.clone();
        parent.names.pop();
        parent
    }

    pub fn bucket(&self) -> &[u8] {
        &self.bucket
    }

    fn entry(&self) -> Option<Entry> {
        Some(Entry {
            shelf: self.storage.far_shelf(&self.bucket)?,
            names: self.names.clone(),
        })
    }

    /// The names on disk have nothing that a file system could refuse, or mistake for another name.
    fn path(&self) -> Vec<u8> {
        self.names
            .iter()
            .fold(self.storage.directory_of(&self.bucket), |all, it| {
                [&*all, b"/", hex(it).as_bytes()].concat()
            })
    }

    /// Who asks first gets it, whenever its turn comes.
    fn lock(&self, mode: LockMode) -> Result<Lock> {
        let path = &*self.path();
        let is_in =
            |path: &[u8], other: &[u8]| matches!(path.strip_prefix(other), Some([] | [b'/', ..]));
        let mut locks = self.storage.files.locks.lock();
        if locks.iter().any(|it| {
            (is_in(path, &it.1) || is_in(&it.1, path))
                && (mode == LockMode::Exclusive || mode != it.2)
        }) {
            return Err(FileError::Locked);
        }
        let id = next_id();
        locks.push((id, path.into(), mode));
        Ok(Lock::Near(Arc::clone(&self.storage), id))
    }

    /// <https://fs.spec.whatwg.org/#file-system-queue>
    fn enqueue<T: Send + 'static, F: FnOnce(&Locator, Vec<u8>) -> Result<T> + Send + 'static>(
        &self,
        steps: F,
    ) -> impl Future<Output = Result<T>> + use<T, F> {
        let this = self.clone();
        let result = self
            .storage
            .files
            .operations
            .run(move || steps(&this, this.path()));
        async { result.await.unwrap_or(Err(FileError::Failed)) }
    }

    /// Until who has asked hears of the result.
    fn enqueue_holding<L, F: FnOnce(&Locator, Vec<u8>) -> Result + Send + 'static>(
        &self,
        locks: Result<L>,
        steps: F,
    ) -> impl Future<Output = Result> + use<L, F> {
        let started = locks.map(|it| (it, self.enqueue(steps)));
        async {
            let (_locks, result) = started?;
            result.await
        }
    }

    pub fn create_root(&self) -> later!(()) {
        in_host_or_here!(
            self.entry(),
            |it| from_host(petition::create_root(it.shelf)),
            {
                self.enqueue(|_, path| {
                    Ok(bun_sys::mkdir_recursive_at_mode(Fd::cwd(), &path, 0o700)?)
                })
            }
        )
    }

    pub fn find(&self, kind: Kind, creates: bool) -> later!(()) {
        in_host_or_here!(
            self.entry(),
            |it| from_host(petition::find(it, kind, creates)),
            {
                self.enqueue(move |_, path| match kind_of(&path) {
                    Some(found) if found == kind => Ok(()),
                    Some(_) => Err(FileError::TypeMismatch),
                    None if !creates => Err(FileError::NotFound),
                    None if kind == Kind::File => Ok(File::openat(
                        Fd::cwd(),
                        &path,
                        O::WRONLY | O::CREAT | O::CLOEXEC,
                        0o600,
                    )
                    .map(drop)?),
                    None => Ok(bun_sys::mkdir(&ZBox::from_bytes(path), 0o700)?),
                })
            }
        )
    }

    pub fn children(&self) -> later!(Vec<(Bytes, Kind)>) {
        in_host_or_here!(self.entry(), |it| from_host(petition::children(it)), {
            let decode = |(name, kind): (Bytes, Kind)| {
                let mut decoded = vec![0; name.len() / 2];
                strings::decode_hex_to_bytes(&mut decoded, &name).ok()?;
                Some((decoded.into(), kind))
            };
            self.enqueue(move |_, path| {
                Ok(entries_of(&path)?.into_iter().filter_map(decode).collect())
            })
        })
    }

    pub fn remove(&self, is_recursive: bool) -> later!(()) {
        in_host_or_here!(
            self.entry(),
            |it| from_host(petition::remove(it, is_recursive)),
            {
                self.enqueue_holding(
                    self.lock(LockMode::Removing),
                    move |this, path| match kind_of(&path).ok_or(FileError::NotFound)? {
                        Kind::Directory if this.names.is_empty() => {
                            Ok(Dir::open(&path)?.delete_children()?)
                        }
                        Kind::Directory if !is_recursive && !entries_of(&path)?.is_empty() => {
                            Err(FileError::NotEmpty)
                        }
                        _ => Ok(Dir::cwd().delete_tree(&path)?),
                    },
                )
            }
        )
    }

    pub fn move_file(&self, target: Locator) -> later!(()) {
        in_host_or_here!(
            self.entry(),
            |it| from_host(petition::move_file(
                it,
                target.entry().expect("it is of the same storage")
            )),
            {
                let locks = [
                    Some(self),
                    Some(&target).filter(|it| it.names != self.names),
                ]
                .into_iter()
                .flatten()
                .map(|it| it.lock(LockMode::Exclusive))
                .collect::<Result<Vec<_>>>();
                self.enqueue_holding(locks, move |_, from| {
                    let to = target.path();
                    require(&from, Kind::File)?;
                    require(&target.parent().path(), Kind::Directory)?;
                    if kind_of(&to) == Some(Kind::Directory) {
                        return Err(FileError::IsDirectory);
                    }
                    replace(&to, &from)
                })
            }
        )
    }

    pub fn snapshot(&self) -> later!((Vec<u8>, bun_sys::Stat)) {
        in_host_or_here!(
            self.entry(),
            |it| {
                let path = from_host(petition::snapshot(it));
                async {
                    let path = path.await?;
                    from_host(blocking(move || {
                        Ok(crate::remote::open_file(&path)?
                            .stat()
                            .map(|it| (path, it))?)
                    }))
                    .await
                }
            },
            {
                self.enqueue(|_, path| {
                    require(&path, Kind::File)?;
                    let stat = File::openat(Fd::cwd(), &path, O::RDONLY | O::CLOEXEC, 0)?.stat()?;
                    Ok((path, stat))
                })
            }
        )
    }

    pub fn open(&self, mode: LockMode) -> later!(OpenFile) {
        in_host_or_here!(
            self.entry(),
            |it| {
                let handle = Handle::new();
                file_from_host(petition::open(handle.id(), it, mode), handle)
            },
            {
                let lock = self.lock(mode);
                self.enqueue(move |_, path| {
                    let _lock = lock?;
                    require(&path, Kind::File)?;
                    Ok(OpenFile {
                        _lock,
                        file: File::openat(
                            Fd::cwd(),
                            &path,
                            if mode == LockMode::ReadOnly {
                                O::RDONLY
                            } else {
                                O::RDWR
                            } | O::CLOEXEC
                                | O::NOFOLLOW,
                            0,
                        )?,
                    })
                })
            }
        )
    }

    pub fn draft(&self, mode: LockMode, keeps_data: bool) -> later!(Draft) {
        in_host_or_here!(
            self.entry(),
            |it| {
                let (handle, operations) =
                    (Handle::new(), Arc::clone(&self.storage.files.operations));
                let file =
                    file_from_host(petition::draft(handle.id(), it, mode, keeps_data), handle);
                async {
                    Ok(Draft {
                        operations,
                        copy: Arc::new(Guarded::new(Copy {
                            file: Some(file.await?),
                            path: Vec::new(),
                            swap: Vec::new(),
                            position: 0,
                        })),
                    })
                }
            },
            {
                let lock = self.lock(mode);
                self.enqueue(move |this, path| {
                    let lock = lock?;
                    require(&path, Kind::File)?;
                    let swap = [&*path, format!(".{:016x}", crate::random()).as_bytes()].concat();
                    let file =
                        File::openat(Fd::cwd(), &swap, O::RDWR | O::CREAT | O::CLOEXEC, 0o600)?;
                    let copy = Copy {
                        file: Some(OpenFile { file, _lock: lock }),
                        path,
                        swap,
                        position: 0,
                    };
                    if let (true, Some(target)) = (keeps_data, &copy.file) {
                        let flags = O::RDONLY | O::CLOEXEC | O::NOFOLLOW;
                        copy_data(
                            &File::openat(Fd::cwd(), &copy.path, flags, 0)?,
                            &target.file,
                        )?;
                    }
                    Ok(Draft {
                        operations: Arc::clone(&this.storage.files.operations),
                        copy: Arc::new(Guarded::new(copy)),
                    })
                })
            }
        )
    }
}

/// It takes nothing to make a hole, however large.
#[cfg(unix)]
fn copy_data(from: &File, to: &File) -> Result {
    const SEEK_DATA: i32 = if cfg!(target_os = "macos") { 4 } else { 3 };
    const SEEK_HOLE: i32 = 7 - SEEK_DATA;
    let size = bun_sys::get_file_size(from.fd())? as i64;
    if bun_sys::lseek(from.fd(), 0, SEEK_HOLE).is_ok_and(|it| it < size) {
        let (mut at, mut buffer) = (0, vec![0; 1 << 20]);
        while let Ok(data) = bun_sys::lseek(from.fd(), at, SEEK_DATA)
            && data < size
        {
            let hole = bun_sys::lseek(from.fd(), data, SEEK_HOLE)?;
            let most = buffer.len().min((hole - data) as usize);
            let length = from.pread_all(&mut buffer[..most], data as u64)?;
            to.pwrite_all(&buffer[..length], data)?;
            at = data + length.max(1) as i64;
        }
        return Ok(bun_sys::ftruncate(to.fd(), size)?);
    }
    from.seek_to(0)?;
    Ok(bun_sys::copy_file(from.fd(), to.fd())?)
}

#[cfg(windows)]
fn copy_data(from: &File, to: &File) -> Result {
    Ok(bun_sys::copy_file(from.fd(), to.fd())?)
}

pub struct OpenFile {
    file: File,
    _lock: Lock,
}

impl OpenFile {
    pub(crate) fn fd(&self) -> Fd {
        self.file.fd()
    }

    pub fn size(&self) -> Result<u64> {
        Ok(bun_sys::get_file_size(self.file.fd())?)
    }

    pub fn read(&self, buffer: &mut [u8], position: u64) -> Result<usize> {
        Ok(self.file.pread_all(buffer, position)?)
    }

    pub fn write(&self, bytes: &[u8], position: u64) -> Result {
        if position.saturating_add(bytes.len() as u64) > QUOTA {
            return Err(FileError::QuotaExceeded);
        }
        if bytes.is_empty() && position > self.size()? {
            return self.truncate(position);
        }
        Ok(self.file.pwrite_all(bytes, position as i64)?)
    }

    pub fn truncate(&self, size: u64) -> Result {
        if size > QUOTA {
            Err(FileError::QuotaExceeded)
        } else {
            Ok(bun_sys::ftruncate(self.file.fd(), size as i64)?)
        }
    }

    pub fn flush(&self) -> Result {
        Ok(bun_sys::fsync(self.file.fd())?)
    }
}

struct Copy {
    /// Until it is kept.
    file: Option<OpenFile>,
    path: Vec<u8>,
    swap: Vec<u8>,
    position: u64,
}

impl Drop for Copy {
    fn drop(&mut self) {
        if let Some(OpenFile { file, _lock }) = self.file.take() {
            drop(file);
            if let Lock::Near(..) = _lock {
                let _ = bun_sys::unlink(&ZBox::from_bytes(&self.swap));
            }
        }
    }
}

/// A copy of a file, which is discarded when nothing has it any more.
#[derive(Clone)]
pub struct Draft {
    operations: Arc<Serial>,
    copy: Arc<Guarded<Copy>>,
}

impl Draft {
    pub(crate) fn duplicate_file(&self) -> Option<File> {
        bun_sys::dup(self.copy.lock().file.as_ref()?.fd())
            .ok()
            .map(File::from_fd)
    }

    fn enqueue<F: FnOnce(&OpenFile, &mut u64) -> Result + Send + 'static>(
        &self,
        steps: F,
    ) -> impl Future<Output = Result> + use<F> {
        let copy = Arc::clone(&self.copy);
        let result = self.operations.run(move || {
            let Copy { file, position, .. } = &mut *copy.lock();
            steps(file.as_ref().ok_or(FileError::Failed)?, position)
        });
        async { result.await.unwrap_or(Err(FileError::Failed)) }
    }

    pub fn write<B: Deref<Target = [u8]> + Send + 'static>(
        &self,
        bytes: B,
        at: Option<u64>,
    ) -> impl Future<Output = Result> + use<B> {
        self.enqueue(move |file, position| {
            let (bytes, at) = (&*bytes, at.unwrap_or(*position));
            file.write(bytes, at)
                .map(|()| *position = at + bytes.len() as u64)
        })
    }

    pub fn seek(&self, to: u64) -> later!(()) {
        self.enqueue(move |_, position| {
            *position = to;
            Ok(())
        })
    }

    pub fn truncate(&self, size: u64) -> later!(()) {
        self.enqueue(move |file, position| {
            file.truncate(size)
                .map(|()| *position = size.min(*position))
        })
    }

    /// In place of the file.
    pub fn keep(self) -> later!(()) {
        let result = self.operations.run(move || {
            let copy = self.copy;
            let mut copy = copy.lock();
            if let Some(OpenFile {
                _lock: Lock::Far(handle),
                ..
            }) = &copy.file
            {
                return Ok(Some((petition::keep(handle.id()), copy.file.take())));
            }
            require(&copy.path, Kind::File)?;
            let OpenFile { file, _lock } = copy.file.take().ok_or(FileError::Failed)?;
            drop(file);
            replace(&copy.path, &copy.swap).map(|()| None)
        });
        async {
            match result.await.unwrap_or(Err(FileError::Failed))? {
                Some((kept, _file)) => from_host(kept).await,
                None => Ok(()),
            }
        }
    }
}
