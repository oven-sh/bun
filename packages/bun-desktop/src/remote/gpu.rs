//! The process that has the GPU for the process of a page. They talk to each other, and trust each other no more than the app trusts them.

use std::ffi::CString;
use std::io;
use std::os::fd::{AsFd as _, AsRawFd as _, FromRawFd as _};
use std::os::unix::net::UnixStream;
use std::ptr::null_mut;
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};

use super::{Reader, Writer, bytes_of, receive, sandbox, send_some};
use crate::gfx::Pixmap;
use crate::protocol::{Launch, SOCKET_TO_PARENT, Text};
use crate::sync::Mutex;
use crate::webgl;

const MOST_PROCESSES: usize = 16;
const MOST_FOR_OWNER: usize = 4;
const MOST_STARTS: u32 = 4;

/// Their owners.
static RUNNING: Mutex<Vec<u32>> = Mutex::new(Vec::new());
static FAILURES: Mutex<Vec<(u32, Instant)>> = Mutex::new(Vec::new());
static MISSING_SINCE: Mutex<Option<Instant>> = Mutex::new(None);

/// All that it tells the app, a byte each.
const IS_READY: u8 = 0;
const HAS_NO_DRIVER: u8 = 1;
const HAS_LOST_CONTEXT: u8 = 2;

/// In the way that leaves no room for descriptors.
fn send_plainly(socket: &UnixStream, part: &mut libc::iovec) -> Option<()> {
    while part.iov_len > 0 {
        // SAFETY: that many bytes are readable.
        match usize::try_from(unsafe {
            libc::send(
                socket.as_raw_fd(),
                part.iov_base,
                part.iov_len,
                libc::MSG_NOSIGNAL,
            )
        }) {
            Ok(sent) => {
                (part.iov_base, part.iov_len) =
                    (part.iov_base.wrapping_byte_add(sent), part.iov_len - sent)
            }
            Err(_) => {
                (io::Error::last_os_error().kind() == io::ErrorKind::Interrupted).then_some(())?
            }
        }
    }
    Some(())
}

fn note_failure(owner: u32) {
    let mut all = FAILURES.lock();
    if !all
        .iter()
        .any(|it| it.0 == owner && it.1.elapsed() < webgl::SAME_FAILURE)
    {
        all.push((owner, Instant::now()));
    }
}

fn is_refused(owner: u32) -> bool {
    let mut all = FAILURES.lock();
    all.retain(|it| it.1.elapsed() < webgl::FAILURES_COUNT_FOR);
    all.iter().filter(|it| it.0 == owner).count() >= 3
        || MISSING_SINCE
            .lock()
            .is_some_and(|it| it.elapsed() < Duration::from_secs(60))
}

struct Seat(u32);

impl Seat {
    fn take(owner: u32) -> Option<Seat> {
        let mut all = RUNNING.lock();
        (all.len() < MOST_PROCESSES
            && all.iter().filter(|it| **it == owner).count() < MOST_FOR_OWNER)
            .then_some(())?;
        all.push(owner);
        Some(Seat(owner))
    }
}

impl Drop for Seat {
    fn drop(&mut self) {
        let mut all = RUNNING.lock();
        all.iter()
            .position(|it| *it == self.0)
            .map(|it| all.swap_remove(it));
    }
}

struct Child {
    process: libc::pid_t,
    socket: UnixStream,
    seat: Arc<Seat>,
}

impl Drop for Child {
    fn drop(&mut self) {
        self.listen();
        let (process, seat, deadline) = (
            self.process,
            self.seat.clone(),
            Instant::now() + Duration::from_millis(200),
        );
        // SAFETY: nobody else waits for it, so the number is still its own.
        let is_over = move |flags| unsafe { libc::waitpid(process, null_mut(), flags) } != 0;
        // SAFETY: as above.
        unsafe { libc::kill(process, libc::SIGKILL) };
        while !is_over(libc::WNOHANG) {
            if Instant::now() > deadline {
                // A driver does not have to let go of it.
                return drop(
                    std::thread::Builder::new()
                        .stack_size(64 << 10)
                        .spawn(move || drop((is_over(0), seat))),
                );
            }
            std::thread::sleep(Duration::from_micros(200));
        }
    }
}

impl Child {
    /// It ends with this thread.
    fn start(launch: &Launch) -> Option<Child> {
        let terminated = |all: &[Text]| {
            all.iter()
                .map(|it| CString::new(it.as_bytes()).ok())
                .collect::<Option<Vec<_>>>()
        };
        let pointers = |all: &[CString]| {
            Vec::from_iter(
                all.iter()
                    .map(|it| it.as_ptr().cast_mut())
                    .chain([null_mut()]),
            )
        };
        let (arguments, environment, (ours, theirs)) = (
            terminated(&launch.arguments)?,
            terminated(&launch.environment)?,
            UnixStream::pair().ok()?,
        );
        theirs.set_read_timeout(Some(Duration::from_secs(5))).ok()?;
        let (program, mut process, seat) = (arguments.first()?, 0, Seat::take(launch.owner)?);
        // SAFETY: each is initialized first, and the lists are terminated.
        let status = unsafe {
            let (mut files, mut attributes, mut signals) =
                (std::mem::zeroed(), std::mem::zeroed(), std::mem::zeroed());
            libc::posix_spawn_file_actions_init(&mut files);
            for standard in 0..if launch.may_log { 2 } else { 3 } {
                libc::posix_spawn_file_actions_addopen(
                    &mut files,
                    standard,
                    c"/dev/null".as_ptr(),
                    libc::O_RDWR,
                    0,
                );
            }
            libc::posix_spawn_file_actions_adddup2(
                &mut files,
                theirs.as_raw_fd(),
                SOCKET_TO_PARENT,
            );
            libc::posix_spawnattr_init(&mut attributes);
            libc::sigemptyset(&mut signals);
            libc::posix_spawnattr_setsigmask(&mut attributes, &signals);
            libc::posix_spawnattr_setflags(&mut attributes, libc::POSIX_SPAWN_SETSIGMASK as _);
            let status = libc::posix_spawn(
                &mut process,
                program.as_ptr(),
                &files,
                &attributes,
                pointers(&arguments).as_ptr(),
                pointers(&environment).as_ptr(),
            );
            libc::posix_spawnattr_destroy(&mut attributes);
            libc::posix_spawn_file_actions_destroy(&mut files);
            status
        };
        drop(theirs);
        (status == 0).then_some(())?;
        let (child, mut first) = (
            Child {
                process,
                socket: ours,
                seat: seat.into(),
            },
            [u8::MAX],
        );
        child
            .socket
            .set_read_timeout(Some(Duration::from_secs(20)))
            .ok()?;
        drop(receive(&child.socket, &mut first, 0));
        if first == [HAS_NO_DRIVER] {
            *MISSING_SINCE.lock() = Some(Instant::now());
        }
        child
            .socket
            .set_read_timeout(Some(Duration::from_secs(3)))
            .ok()?;
        (first == [IS_READY]).then_some(child)
    }

    /// Unless it is asked, it has nothing good to say.
    fn listen(&self) {
        if !receive(&self.socket, &mut [0; 256], libc::MSG_DONTWAIT)
            .is_err_and(|it| it.kind() == io::ErrorKind::WouldBlock)
        {
            note_failure(self.seat.0);
        }
    }

    fn connect(&self) -> Option<UnixStream> {
        let (of_page, of_child) = UnixStream::pair().ok()?;
        of_page
            .set_read_timeout(Some(webgl::PATIENCE))
            .and(of_page.set_write_timeout(Some(webgl::PATIENCE)))
            .ok()?;
        send_some(
            &self.socket,
            &[bytes_of(&[0u8])],
            Some(of_child.as_fd()),
            libc::MSG_DONTWAIT,
        )
        .ok()?;
        for _ in 0..256 {
            let mut said = [u8::MAX];
            if receive(&self.socket, &mut said, 0).is_ok() && said == [IS_READY] {
                return Some(of_page);
            }
            note_failure(self.seat.0);
            (said == [HAS_LOST_CONTEXT]).then_some(())?;
        }
        None
    }
}

/// What the app knows about that of a page.
#[derive(Default)]
pub struct Process {
    child: Option<Child>,
    starts: u32,
}

impl Process {
    /// To a new context.
    pub fn connect(&mut self, launch: &Launch) -> Option<UnixStream> {
        self.child.iter().for_each(Child::listen);
        (!is_refused(launch.owner)).then_some(())?;
        self.child.as_ref().and_then(Child::connect).or_else(|| {
            self.child = None;
            (self.starts < MOST_STARTS && webgl::is_wanted()).then_some(())?;
            self.starts += 1;
            self.child.insert(Child::start(launch)?).connect()
        })
    }
}

pub(super) static APP: OnceLock<UnixStream> = OnceLock::new();

pub fn report_loss() {
    if let Some(app) = APP.get() {
        // SAFETY: a byte.
        unsafe {
            libc::send(
                app.as_raw_fd(),
                [HAS_LOST_CONTEXT].as_ptr().cast(),
                1,
                libc::MSG_DONTWAIT | libc::MSG_NOSIGNAL,
            )
        };
    }
}

/// While there is only one thread.
pub fn serve(has_sandbox: bool) -> ! {
    // SAFETY: it was inherited for this.
    let app = APP.get_or_init(|| unsafe { UnixStream::from_raw_fd(SOCKET_TO_PARENT) });
    let vendor = (!has_sandbox || sandbox::prepare_for_driver())
        .then(webgl::load_driver)
        .flatten();
    let is_ready = vendor.is_some_and(|it| !has_sandbox || sandbox::enter_with_driver(&it));
    send_plainly(
        app,
        &mut bytes_of(&[if is_ready { IS_READY } else { HAS_NO_DRIVER }]),
    );
    while is_ready && !webgl::is_hung() {
        match receive(app, &mut [0], 0) {
            Ok(page) => {
                send_plainly(app, &mut bytes_of(&[IS_READY]));
                page.into_iter()
                    .for_each(|it| webgl::serve_page(Line(it.into())));
            }
            Err(it) if it.kind() == io::ErrorKind::WouldBlock => {}
            Err(_) => break,
        }
    }
    // SAFETY: drivers have threads, which what runs at the exit would pull things away from.
    unsafe { libc::_exit(0) }
}

/// For a context.
pub struct Line(pub(super) UnixStream);

impl Line {
    /// Numbers, and then more of them in parts.
    pub fn send(&self, numbers: &[u32], parts: &[Vec<u32>], bytes: &[u8]) -> Option<()> {
        let mut head = Writer::default();
        head.list(numbers)
            .put(u32::try_from(parts.iter().map(Vec::len).sum::<usize>()).ok()?);
        let length = [u32::try_from(bytes.len()).ok()?];
        let mut all = Vec::from_iter(
            [bytes_of(&head.0)]
                .into_iter()
                .chain(parts.iter().map(|it| bytes_of(it)))
                .chain([bytes_of(&length), bytes_of(bytes)]),
        );
        all.iter_mut().try_for_each(|it| send_plainly(&self.0, it))
    }

    pub fn receive(&self, words: &mut Vec<u32>) -> Option<(Vec<u32>, Vec<u8>)> {
        let mut from = Reader(&self.0);
        let (numbers, count) = (from.list(64)?, from.get()?);
        from.all_into(words, count, usize::MAX)?;
        Some((numbers, from.list(1 << 30)?))
    }
}

/// `None` unless there are as many bytes as it takes.
pub fn pixels(bytes: Vec<u8>, width: u32, height: u32) -> Option<Pixmap> {
    (bytes.len() as u64 == u64::from(width) * u64::from(height) * 4)
        .then(|| Pixmap::from_vec(bytes, width, height))?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn launch(owner: u32, script: &str) -> Launch {
        Launch {
            arguments: ["/bin/sh", "-c", script]
                .into_iter()
                .map(Into::into)
                .collect(),
            owner,
            ..Launch::default()
        }
    }

    const WORKS: &str = r"printf '\0\0' >&3; exec /bin/sleep 60";

    #[test]
    fn a_failure_does_not_last() {
        let mut process = Process::default();
        assert!(process.connect(&launch(1, "exit")).is_none());
        assert!(process.connect(&launch(1, WORKS)).is_some());

        assert!(
            Process::default()
                .connect(&launch(2, r"printf '\1' >&3"))
                .is_none()
        );
        assert!(Process::default().connect(&launch(3, WORKS)).is_none());
        *MISSING_SINCE.lock() = Instant::now().checked_sub(Duration::from_secs(61));
        assert!(Process::default().connect(&launch(3, WORKS)).is_some());

        let mut process = Process::default();
        assert_eq!(
            (0..MOST_STARTS + 2)
                .filter(|_| process
                    .connect(&launch(4, WORKS))
                    .is_some_and(|_| process.child.take().is_some()))
                .count(),
            MOST_STARTS as usize
        );
        drop(process);
        assert!(RUNNING.lock().iter().all(|it| *it == 1));
    }
}
