//! blocking, but off the main thread

use crate::node::fs as node_fs;
#[cfg(not(target_os = "freebsd"))]
use crate::webcore::blob::MAX_SIZE;
use crate::webcore::blob::creating_parents;
use crate::webcore::blob::fd_job::Target;
use crate::webcore::blob::write_file::{note_written, settle};
use crate::webcore::blob::{SizeType, Store};
use crate::webcore::node_types::PathOrFileDescriptor;
use bun_jsc::SystemError;
use bun_jsc::{self as jsc, JSValue};
use bun_paths::Path;
use bun_ptr::RefPtr;
use bun_sys::{self, Fd, Mode};
use bun_sys::{File, MaybeOwnedFile, Stat};

// ───────────────────────────────────────────────────────────────────────────
// CopyFile (POSIX, blocking off-thread)
// ───────────────────────────────────────────────────────────────────────────

pub(crate) struct CopyFile {
    destination: RefPtr<Store>,
    source: RefPtr<Store>,
    destination_file: Target,
    source_file: Target,
    /// What the store knew when the copy was asked for.
    #[cfg(any(target_os = "linux", target_os = "android"))]
    destination_cached_mode: Mode,
    #[cfg(any(target_os = "linux", target_os = "android"))]
    destination_is_atty: bool,
    offset: SizeType,
    max_length: SizeType,
    mkdirp: bool,
    new_mode: Option<Mode>,
    copied: Result<SizeType, Box<SystemError>>,
}

impl jsc::JobContext for CopyFile {
    type OffThread = Self;
    type Js = jsc::JSPromiseStrong;

    fn run(this: &mut Self, done: bun_jsc::Completion<Self>) -> Option<bun_jsc::Completion<Self>> {
        this.copied = this.copy();
        Some(done)
    }

    fn then(
        this: Self,
        mut promise: jsc::JSPromiseStrong,
        cx: &jsc::JsThread<'_>,
    ) -> jsc::JsResult<()> {
        let copied = this.copied.map_err(|mut err| {
            if let PathOrFileDescriptor::Path(path) = &this.source.data.as_file().pathlike
                && err.path.is_empty()
            {
                err.path = bun_core::String::clone_utf8(path.slice());
            }
            err
        });
        if copied.is_ok() {
            note_written(&this.destination);
        }
        settle(promise.swap(), cx.global(), copied)
    }
}

impl CopyFile {
    /// Schedule the copy on the work pool; returns its promise.
    pub(crate) fn create(
        destination: RefPtr<Store>,
        source: RefPtr<Store>,
        offset: SizeType,
        max_length: SizeType,
        cx: &bun_jsc::JsThread<'_>,
        mkdirp: bool,
        new_mode: Option<Mode>,
    ) -> JSValue {
        let copy = CopyFile {
            destination_file: Target::of(&destination),
            source_file: Target::of(&source),
            #[cfg(any(target_os = "linux", target_os = "android"))]
            destination_cached_mode: destination.data.as_file().mode,
            #[cfg(any(target_os = "linux", target_os = "android"))]
            destination_is_atty: destination.data.as_file().is_atty.unwrap_or(false),
            destination,
            source,
            offset,
            max_length,
            mkdirp,
            new_mode,
            copied: Ok(0),
        };
        let promise = jsc::JSPromiseStrong::init(cx.global());
        let value = promise.value();
        jsc::Job::<CopyFile>::schedule(cx, copy, promise);
        value
    }

    fn opens_destination(&self) -> bool {
        !matches!(self.destination_file, Target::Fd(_))
    }

    fn copy(&mut self) -> Result<SizeType, Box<SystemError>> {
        let source_file = &self.source_file.get();
        let destination_file = &self.destination_file.get();

        #[cfg(not(target_os = "macos"))]
        let known_stat: Option<Stat> = None;
        // clonefile() is the fastest way to copy a file, so it goes first.
        #[cfg(target_os = "macos")]
        let known_stat = match (source_file, destination_file) {
            (PathOrFileDescriptor::Path(from), PathOrFileDescriptor::Path(to))
                if self.offset == 0 =>
            {
                let from = &Path::from(from.slice());
                let stat = bun_sys::stat(from)?;
                if bun_sys::S::ISDIR(stat.st_mode as u32) {
                    return Err(unsupported_directory_error());
                }
                if bun_sys::S::ISREG(stat.st_mode as u32) {
                    let to = &Path::from(to.slice());
                    // The destination may exist or be on a network volume: then go on to fcopyfile.
                    let clone = || bun_sys::clonefile(from, to);
                    if creating_parents(&mut self.mkdirp, to.as_bytes(), clone).is_ok() {
                        return Ok(self.finish_clone(to, &stat)?);
                    }
                }
                Some(stat)
            }
            _ => None,
        };

        // Source first: if it fails, no destination file is left behind.
        let source = match source_file {
            PathOrFileDescriptor::Fd(fd) => MaybeOwnedFile::Borrowed(*fd),
            PathOrFileDescriptor::Path(path) => {
                File::open(&Path::from(path.slice()), OPEN_SOURCE_FLAGS, 0)?.into()
            }
        };
        let destination = match destination_file {
            PathOrFileDescriptor::Fd(fd) => MaybeOwnedFile::Borrowed(*fd),
            PathOrFileDescriptor::Path(path) => {
                let path = &Path::from(path.slice());
                let mode = self.new_mode.unwrap_or(node_fs::DEFAULT_PERMISSION);
                let open = || File::open(path, OPEN_DESTINATION_FLAGS, mode);
                creating_parents(&mut self.mkdirp, path.as_bytes(), open)?.into()
            }
        };

        // open() sets the mode of a new file only.
        let set_mode = || match self.new_mode {
            Some(mode) => bun_sys::fchmod(destination.fd(), mode),
            None => Ok(()),
        };
        let stat = match known_stat.map_or_else(|| bun_sys::fstat(source.fd()), Ok) {
            Ok(stat) => stat,
            Err(err) => {
                // The destination may exist already, and fstat() has the error to report.
                let _ = set_mode();
                return Err(err.into());
            }
        };
        let copied = self.copy_opened(source.fd(), destination.fd(), &stat)?;
        set_mode()?;
        Ok(copied)
    }

    #[cfg(target_os = "macos")]
    fn finish_clone(&self, to: &bun_core::ZStr, stat: &Stat) -> bun_sys::Result<SizeType> {
        let size = size_of_file(stat);
        let copied = if self.max_length != MAX_SIZE && self.max_length < size {
            let _ = bun_sys::truncate(to, self.max_length as i64);
            self.max_length
        } else {
            size
        };
        // clonefile() copies the permissions of the source.
        if let Some(mode) = self.new_mode {
            bun_sys::chmod(to, mode)?;
        }
        Ok(copied)
    }

    fn copy_opened(&self, src: Fd, dest: Fd, stat: &Stat) -> Result<SizeType, Box<SystemError>> {
        let mode = stat.st_mode as Mode;
        if bun_sys::S::ISDIR(mode) {
            return Err(unsupported_directory_error());
        }

        let mut max_length = self.max_length;
        // BSD fstat on a pipe reports bytes currently buffered in st_size;
        // only a regular-file st_size is a length.
        if stat.st_size > 0 && bun_sys::S::ISREG(mode) {
            max_length = (size_of_file(stat).min(max_length)).saturating_sub(self.offset);
            if max_length == 0 {
                return Ok(0);
            }

            #[cfg(any(target_os = "linux", target_os = "android"))]
            if self.opens_destination() && max_length > PREALLOCATE_LENGTH && max_length != MAX_SIZE
            {
                let _ = bun_sys::preallocate_file(dest.native(), 0, max_length as i64);
            }
        }

        #[cfg(any(target_os = "linux", target_os = "android"))]
        {
            use bun_sys::S::{ISCHR, ISFIFO, ISREG, ISSOCK};
            let dest_mode = self.destination_cached_mode;
            let syscall = if ISREG(mode) && (ISREG(dest_mode) || dest_mode == 0) {
                // Bun.write(Bun.file("a"), Bun.file("b"))
                TryWith::CopyFileRange
            } else if ISFIFO(mode) && ISFIFO(dest_mode) {
                // $ bun run foo.js | bun run bar.js
                TryWith::Splice
            } else if ISREG(mode) || ISCHR(mode) || ISSOCK(mode) {
                TryWith::Sendfile
            } else {
                return Err(unsupported_non_regular_file_error());
            };
            Ok(self.copy_in_kernel(syscall, src, dest, max_length)?)
        }

        #[cfg(any(target_os = "macos", target_os = "freebsd"))]
        {
            let mut copied = 0;
            // Copying from offset 0 and trimming with ftruncate() needs a destination opened with O_TRUNC.
            if !self.opens_destination() {
                read_write_loop_capped(src, dest, max_length, &mut copied)?;
                return Ok(copied);
            }

            #[cfg(target_os = "macos")]
            {
                let size = size_of_file(stat);
                let data = bun_sys::darwin::COPYFILE {
                    data: true,
                    ..Default::default()
                };
                match bun_sys::fcopyfile(src, dest, data.bits()) {
                    Ok(()) => copied = size,
                    // The file cannot seek: `bun test bun-write.test | xargs echo`
                    Err(err) if err.get_errno() == bun_sys::E::EBADF => {
                        read_write_loop(src, dest, 0, &mut copied)?
                    }
                    Err(err) => return Err(err.into()),
                }
            }
            #[cfg(target_os = "freebsd")]
            read_write_loop(src, dest, 0, &mut copied)?;

            if size_of_file(stat) > max_length {
                let _ = bun_sys::ftruncate(dest, max_length as i64);
                copied = copied.min(max_length);
            }
            Ok(copied)
        }
    }

    // TODO: this should use non-blocking I/O.
    #[cfg(any(target_os = "linux", target_os = "android"))]
    fn copy_in_kernel(
        &self,
        syscall: TryWith,
        src: Fd,
        dest: Fd,
        max_length: SizeType,
    ) -> bun_sys::Result<SizeType> {
        use bun_sys::{E, linux};

        // fstat() on a FIFO, a character device or a socket reports 0: copy chunks until EOF.
        let unknown_size = max_length == MAX_SIZE || max_length == 0;
        let mut remain = if unknown_size {
            64 * 1024
        } else {
            max_length as usize
        };
        let mut copied: SizeType = 0;
        let mut may_clear_append = self.destination_is_atty;

        // Without copy_file_range(), sendfile() and splice() are probably missing too.
        let mut supported = bun_sys::copy_file::can_use_copy_file_range_syscall();
        while supported {
            let (from, to) = (src.native(), dest.native());
            let written: isize = match syscall {
                TryWith::CopyFileRange => linux::copy_file_range(from, None, to, None, remain, 0),
                TryWith::Sendfile => linux::sendfile(to, from, None, remain),
                TryWith::Splice => linux::splice(from, to, remain),
            };

            match bun_sys::get_errno(written) {
                E::SUCCESS => {
                    copied += written as SizeType;
                    if !unknown_size {
                        remain = remain.saturating_sub(written as usize);
                    }
                    if written == 0 || remain == 0 {
                        return Ok(copied);
                    }
                }
                E::ENOSYS | E::EXDEV | E::ENOTSUP => supported = false,
                // make sets O_APPEND on stdout, which sendfile() refuses: https://kylelaker.com/2018/08/31/stdout-oappend.html
                E::EINVAL if core::mem::take(&mut may_clear_append) && clear_append(dest) => {}
                // eCryptfs, for one, or a descriptor that the syscall does not work with.
                E::EINVAL if copied == 0 => supported = false,
                errno => return Err(bun_sys::Error::from_code(errno, syscall.tag())),
            }
        }

        if self.opens_destination() {
            let size = if unknown_size { 0 } else { remain };
            read_write_loop(src, dest, size, &mut copied)?;
            let _ = bun_sys::ftruncate(dest, copied as i64);
        } else {
            let cap = if unknown_size {
                MAX_SIZE
            } else {
                remain as SizeType
            };
            read_write_loop_capped(src, dest, cap, &mut copied)?;
        }
        Ok(copied)
    }
}

fn size_of_file(stat: &Stat) -> SizeType {
    stat.st_size.max(0) as SizeType
}

/// Whether it was set.
#[cfg(any(target_os = "linux", target_os = "android"))]
fn clear_append(fd: Fd) -> bool {
    let flags = bun_sys::get_fcntl_flags(fd).unwrap_or(0) as i32;
    if flags & bun_sys::O::APPEND == 0 {
        return false;
    }
    // SAFETY: F_SETFL takes an integer.
    unsafe { libc::fcntl(fd.native(), libc::F_SETFL, flags ^ bun_sys::O::APPEND) };
    true
}

fn read_write_loop(src: Fd, dest: Fd, size: usize, total: &mut u64) -> bun_sys::Result<()> {
    let no_path = bun_core::ZStr::EMPTY;
    node_fs::NodeFS::copy_file_using_read_write_loop(no_path, no_path, src, dest, size, total)
}

#[inline(never)] // 64 KB stack buffer
fn read_write_loop_capped(
    src_fd: Fd,
    dest_fd: Fd,
    cap: SizeType,
    total: &mut u64,
) -> bun_sys::Result<()> {
    let mut stack_buf = [const { core::mem::MaybeUninit::uninit() }; 64 * 1024];
    let mut remaining = cap;
    while remaining > 0 {
        let want = (stack_buf.len() as SizeType).min(remaining) as usize;
        let mut buf = bun_core::vec::BorrowedBuf::from(&mut stack_buf[..want]);
        let amt = bun_sys::read_buf(src_fd, buf.unfilled())?;
        if amt == 0 {
            break;
        }
        remaining -= amt as SizeType;
        let mut slice = buf.filled();
        while !slice.is_empty() {
            match bun_sys::write(dest_fd, slice)? {
                0 => return Ok(()),
                n => {
                    *total += n as u64;
                    slice = &slice[n..];
                }
            }
        }
    }
    Ok(())
}

#[cfg(any(target_os = "linux", target_os = "android"))]
const PREALLOCATE_LENGTH: SizeType = 2048 * 1024;

const OPEN_DESTINATION_FLAGS: i32 =
    bun_sys::O::CLOEXEC | bun_sys::O::CREAT | bun_sys::O::WRONLY | bun_sys::O::TRUNC;
const OPEN_SOURCE_FLAGS: i32 = bun_sys::O::CLOEXEC | bun_sys::O::RDONLY;

#[derive(Clone, Copy)]
#[cfg(any(target_os = "linux", target_os = "android"))]
enum TryWith {
    Sendfile,
    CopyFileRange,
    Splice,
}

#[cfg(any(target_os = "linux", target_os = "android"))]
impl TryWith {
    const fn tag(self) -> bun_sys::Tag {
        match self {
            TryWith::Sendfile => bun_sys::Tag::sendfile,
            TryWith::CopyFileRange => bun_sys::Tag::copy_file_range,
            TryWith::Splice => bun_sys::Tag::splice,
        }
    }
}

// ───────────────────────────────────────────────────────────────────────────
// Module-level constants
// ───────────────────────────────────────────────────────────────────────────

fn unsupported_directory_error() -> Box<SystemError> {
    Box::new(SystemError {
        errno: bun_sys::SystemErrno::EISDIR as i32,
        message: bun_core::String::static_("That doesn't work on folders"),
        syscall: bun_core::String::static_("fstat"),
        ..SystemError::default()
    })
}

#[cfg(any(target_os = "linux", target_os = "android"))]
fn unsupported_non_regular_file_error() -> Box<SystemError> {
    Box::new(SystemError {
        errno: bun_sys::SystemErrno::ENOTSUP as i32,
        message: bun_core::String::static_("Non-regular files aren't supported yet"),
        syscall: bun_core::String::static_("fstat"),
        ..SystemError::default()
    })
}
