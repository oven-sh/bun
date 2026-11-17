//! Bun's filesystem watcher implementation for linux using inotify
//! https://man7.org/linux/man-pages/man7/inotify.7.html

use core::ffi::c_int;

use bun_core::{ZStr, env_var, output as Output};
use bun_paths::MAX_PATH_BYTES;
use bun_sys::{self, CloseOnDrop, Fd};

use crate::watcher_impl::{
    MAX_COUNT as max_count, Op, WatchEvent, WatchItemColumns, WatchItemIndex, Watcher,
    WatcherThread,
};
use bun_collections::index_sort;

bun_core::declare_scope!(watcher, visible);

// inotify events are variable-sized, so a byte buffer is used (also needed
// since communication is done via the `read` syscall). what is notable about
// this is that while a max_count is defined, more events than max_count can be
// read if the paths are short. the buffer is sized not to the maximum possible,
// but an arbitrary but reasonable size. when reading, the strategy is to read
// as much as possible, then process the buffer in `max_count` chunks, since
// `bun.Watcher` has the same hardcoded `max_count`.
const EVENTLIST_BYTES_SIZE: usize = (Event::LARGEST_SIZE / 2) * max_count;

pub(crate) type Platform = INotifyWatcher;

pub struct INotifyWatcher {
    pub(crate) fd: CloseOnDrop,
    /// Readable from [`Watcher::wake`] on.
    eventfd: CloseOnDrop,
    /// nanoseconds
    pub(crate) coalesce_interval: isize,
    /// `WatcherContext::waits_for_close` of the consumer.
    wait_for_close: bool,
}

pub(crate) type EventListIndex = c_int;

/// The longest a batch is held for the writers of its files to close them.
const CLOSE_WAIT_CAP: core::time::Duration = core::time::Duration::from_millis(50);

/// The files that the events of the watcher thread show as open for writing.
#[derive(Default)]
struct Writers {
    /// The files whose last event in the batch that is read now is a write.
    open: Vec<EventListIndex>,
    /// The files that `CLOSE_WAIT_CAP` ran out for. One waits again only after it reports a close.
    no_close: Vec<EventListIndex>,
}

impl Writers {
    fn note(&mut self, events: EventIterator<'_>) {
        use bun_sys::linux::IN;
        for event in events {
            // `watch_dir` does not ask for closes, so only the watch on the file itself counts.
            if !event.padded_name.is_empty() {
                continue;
            }
            let wd = event.watch_descriptor;
            if (event.mask & IN::MODIFY) > 0 {
                if !self.no_close.contains(&wd) && !self.open.contains(&wd) {
                    self.open.push(wd);
                }
            } else if (event.mask & (IN::CLOSE_WRITE | IN::IGNORED)) > 0 {
                self.open.retain(|&open| open != wd);
                self.no_close.retain(|&open| open != wd);
            } else if (event.mask & IN::Q_OVERFLOW) > 0 {
                // The kernel dropped events, and a close can be one of them.
                self.open.clear();
                self.no_close.clear();
            }
        }
    }

    /// The kernel keeps the watch of a file that the consumer took off its list.
    fn forget_unwatched(&mut self, watched: &[EventListIndex]) {
        self.open.retain(|wd| watched.contains(wd));
    }

    fn give_up(&mut self) {
        self.no_close.append(&mut self.open);
    }
}

/// An `inotify_event`.
pub struct Event<'a> {
    pub watch_descriptor: EventListIndex,
    pub mask: u32,
    padded_name: &'a [u8],
}

impl<'a> Event<'a> {
    const HEADER_SIZE: usize = size_of::<libc::inotify_event>();
    const LARGEST_SIZE: usize = Self::HEADER_SIZE + MAX_PATH_BYTES;

    /// Only an event for a file inside a watched directory has one.
    pub fn name(&self) -> Option<&'a [u8]> {
        (!self.padded_name.is_empty()).then(|| bun_core::slice_to_nul(self.padded_name))
    }
}

/// The events in the bytes read from an inotify descriptor.
pub struct EventIterator<'a>(pub &'a [u8]);

impl<'a> Iterator for EventIterator<'a> {
    type Item = Event<'a>;

    fn next(&mut self) -> Option<Event<'a>> {
        let bytes = core::mem::take(&mut self.0);
        let [wd, mask, _cookie, name_len]: [u32; 4] = bun_core::read_prefix(bytes)?;
        let (padded_name, rest) =
            bytes[Event::HEADER_SIZE..].split_at_checked(name_len as usize)?;
        self.0 = rest;
        Some(Event {
            watch_descriptor: wd as EventListIndex,
            mask,
            padded_name,
        })
    }
}

impl INotifyWatcher {
    pub(crate) fn watch_path(&self, pathname: &ZStr) -> bun_sys::Result<EventListIndex> {
        use bun_sys::linux::IN;
        let mut watch_file_mask =
            IN::EXCL_UNLINK | IN::MOVE_SELF | IN::DELETE_SELF | IN::MOVED_TO | IN::MODIFY;
        if self.wait_for_close {
            // `IN::MODIFY` still starts a batch. The close only ends it, and no consumer gets it.
            watch_file_mask |= IN::CLOSE_WRITE;
        }
        let rc =
            bun_sys::linux::inotify_add_watch(self.fd.fd().native(), pathname, watch_file_mask);
        bun_core::scoped_log!(watcher, "inotify_add_watch({}) = {}", self.fd.fd(), rc);
        if rc < 0 {
            Err(
                bun_sys::Error::from_code_int(bun_sys::last_errno(), bun_sys::Tag::watch)
                    .with_path(pathname.as_bytes()),
            )
        } else {
            Ok(rc)
        }
    }

    pub(crate) fn watch_dir(&self, pathname: &ZStr) -> bun_sys::Result<EventListIndex> {
        use bun_sys::linux::IN;
        let watch_dir_mask = IN::EXCL_UNLINK
            | IN::DELETE
            | IN::DELETE_SELF
            | IN::CREATE
            | IN::MOVE_SELF
            | IN::ONLYDIR
            | IN::MOVED_TO
            | IN::MODIFY;
        let rc = bun_sys::linux::inotify_add_watch(self.fd.fd().native(), pathname, watch_dir_mask);
        bun_core::scoped_log!(watcher, "inotify_add_watch({}) = {}", self.fd.fd(), rc);
        if rc < 0 {
            Err(
                bun_sys::Error::from_code_int(bun_sys::last_errno(), bun_sys::Tag::watch)
                    .with_path(pathname.as_bytes()),
            )
        } else {
            Ok(rc)
        }
    }

    pub(crate) fn new(_root: &[u8]) -> crate::Result<Self> {
        use bun_sys::linux::IN;

        let raw = bun_sys::linux::inotify_init1(IN::CLOEXEC);
        let errno = bun_sys::get_errno(raw);
        if errno != bun_sys::E::SUCCESS {
            // Surface the errno name (e.g. EMFILE) instead of a generic
            // init-failed tag.
            return Err(crate::Error::Sys(errno));
        }
        let fd = CloseOnDrop::new(Fd::from_native(raw));
        bun_core::scoped_log!(watcher, "{} init", fd.fd());
        Ok(Self {
            fd,
            eventfd: CloseOnDrop::new(bun_sys::eventfd(0, libc::EFD_CLOEXEC)?),
            coalesce_interval: env_var::BUN_INOTIFY_COALESCE_INTERVAL
                .get()
                .and_then(|v| isize::try_from(v).ok())
                .unwrap_or(100_000),
            wait_for_close: true,
        })
    }

    pub(crate) fn with_wait_for_close(mut self, wait_for_close: bool) -> Self {
        self.wait_for_close = wait_for_close;
        self
    }

    /// For an event, or for [`Watcher::wake`].
    fn wait(&self) {
        use bun_sys::linux::{pollfd, ppoll};
        let mut fds = [&self.fd, &self.eventfd].map(|file| pollfd {
            fd: file.fd().native(),
            events: libc::POLLIN,
            revents: 0,
        });
        while bun_sys::get_errno(ppoll(&mut fds, None, None)) == bun_sys::E::EINTR {}
    }

    /// Returns how many bytes it read.
    fn read(&self, bytes: &mut [u8]) -> bun_sys::Result<usize> {
        // This is what replit does as of Jaunary 2023.
        // 1) CREATE .http.ts.3491171321~
        // 2) OPEN .http.ts.3491171321~
        // 3) ATTRIB .http.ts.3491171321~
        // 4) MODIFY .http.ts.3491171321~
        // 5) CLOSE_WRITE,CLOSE .http.ts.3491171321~
        // 6) MOVED_FROM .http.ts.3491171321~
        // 7) MOVED_TO http.ts
        // We still don't correctly handle MOVED_FROM && MOVED_TO it seems.
        use bun_sys::linux as system;
        use bun_sys::{E, get_errno};
        loop {
            let rc = system::read(self.fd.fd().native(), bytes);
            let errno = get_errno(rc);
            match errno {
                E::SUCCESS => {
                    let mut read_len = usize::try_from(rc).expect("int cast");
                    bun_core::scoped_log!(watcher, "{} read {} bytes", self.fd.fd(), read_len);
                    if read_len == 0 {
                        return Ok(0);
                    }

                    // IN_MODIFY is very noisy
                    // we do a 0.1ms sleep to try to coalesce events better
                    if has_room(bytes, read_len) {
                        let timespec = libc::timespec {
                            tv_sec: 0,
                            tv_nsec: self.coalesce_interval as _,
                        };
                        self.read_more(bytes, &mut read_len, &timespec)?;
                    }

                    return Ok(read_len);
                }
                E::EAGAIN | E::EINTR => continue,
                E::EINVAL => {
                    if cfg!(debug_assertions) {
                        Output::err(
                            "EINVAL",
                            "inotify read({}, {})",
                            (self.fd.fd(), bytes.len()),
                        );
                    }
                    return Err(bun_sys::Error {
                        errno: errno as u32 as _,
                        syscall: bun_sys::Tag::read,
                        ..Default::default()
                    });
                }
                _ => {
                    return Err(bun_sys::Error {
                        errno: errno as u32 as _,
                        syscall: bun_sys::Tag::read,
                        ..Default::default()
                    });
                }
            }
        }
    }

    /// Appends the events of the next `timeout` at `read_len`. False after [`Watcher::wake`].
    fn read_more(
        &self,
        bytes: &mut [u8],
        read_len: &mut usize,
        timeout: &libc::timespec,
    ) -> bun_sys::Result<bool> {
        use bun_sys::linux as system;
        use bun_sys::{E, get_errno};
        let mut fds = [&self.fd, &self.eventfd].map(|file| system::pollfd {
            fd: file.fd().native(),
            events: libc::POLLIN,
            revents: 0,
        });
        if system::ppoll(&mut fds, Some(timeout), None) <= 0 {
            return Ok(true);
        }
        if fds[1].revents != 0 {
            return Ok(false);
        }
        loop {
            let rc = system::read(self.fd.fd().native(), &mut bytes[*read_len..]);
            match get_errno(rc) {
                E::SUCCESS => {
                    *read_len += usize::try_from(rc).expect("int cast");
                    return Ok(true);
                }
                E::EAGAIN | E::EINTR => {}
                errno => {
                    return Err(bun_sys::Error {
                        errno: errno as u32 as _,
                        syscall: bun_sys::Tag::read,
                        ..Default::default()
                    });
                }
            }
        }
    }
}

/// `read` fails with EINVAL when the next event does not fit in the rest of the buffer.
fn has_room(bytes: &[u8], read_len: usize) -> bool {
    bytes.len() - read_len >= Event::LARGEST_SIZE
}

impl Watcher {
    pub(crate) fn wake(&self) {
        let _ = self.platform.eventfd.write_all(&1u64.to_ne_bytes());
    }

    /// A save is a truncation, writes and a close. Reads on until each written file has its close.
    fn wait_for_writers_to_close(
        &self,
        bytes: &mut [u8],
        read_len: &mut usize,
        writers: &mut Writers,
        watched: &mut Vec<EventListIndex>,
    ) -> bun_sys::Result<()> {
        let mut scanned: usize = 0;
        let mut deadline: Option<std::time::Instant> = None;
        let mut polled_at_cap = false;
        writers.open.clear();
        loop {
            writers.note(EventIterator(&bytes[scanned..*read_len]));
            scanned = *read_len;
            if writers.open.is_empty() {
                return Ok(());
            }
            // A file can come onto the list while the batch waits.
            if deadline.is_none() || !writers.open.iter().all(|wd| watched.contains(wd)) {
                watched.clear();
                watched.extend_from_slice(self.state.lock().watchlist.items_eventlist_index());
            }
            writers.forget_unwatched(watched);
            if writers.open.is_empty() {
                return Ok(());
            }
            let now = std::time::Instant::now();
            let left = deadline
                .get_or_insert(now + CLOSE_WAIT_CAP)
                .saturating_duration_since(now);
            // A writer that fills the 50 ms or the buffer is not a save.
            if polled_at_cap || !has_room(bytes, *read_len) {
                writers.give_up();
                return Ok(());
            }
            // At the cap one poll with no wait takes a close that is already queued.
            polled_at_cap = left.is_zero();
            let timespec = libc::timespec {
                tv_sec: 0,
                tv_nsec: left.subsec_nanos() as _,
            };
            if !self.platform.read_more(bytes, read_len, &timespec)? {
                return Ok(());
            }
        }
    }
}

pub(crate) fn watch_loop(this: &Watcher, thread: &mut WatcherThread) -> bun_sys::Result<()> {
    this.platform.wait();
    let mut bytes = vec![0u8; EVENTLIST_BYTES_SIZE].into_boxed_slice();
    let mut eventlist_index_scratch = Vec::new();
    let mut writers = Writers::default();
    while this.running.load() {
        let mut len = this.platform.read(&mut bytes)?;
        if this.platform.wait_for_close {
            let watched = &mut eventlist_index_scratch;
            this.wait_for_writers_to_close(&mut bytes, &mut len, &mut writers, watched)?;
        }
        let mut events = EventIterator(&bytes[..len]);
        // More than one batch only under load, see `watch-many-dirs.test.ts`.
        while !events.0.is_empty() && this.running.load() {
            process_inotify_event_batch(this, thread, &mut events, &mut eventlist_index_scratch);
        }
        this.platform.wait();
    }
    Ok(())
}

fn process_inotify_event_batch(
    this: &Watcher,
    thread: &mut WatcherThread,
    events: &mut EventIterator<'_>,
    eventlist_index_scratch: &mut Vec<EventListIndex>,
) {
    let _flush = Output::flush_guard();

    eventlist_index_scratch.clear();
    eventlist_index_scratch.extend_from_slice(this.state.lock().watchlist.items_eventlist_index());

    let mut event_count: usize = 0;
    let mut temp_name_list: [&[u8]; max_count] = [b""; max_count];
    let mut temp_name_off: u8 = 0;

    for event in next_changes(events) {
        let Some(idx) = eventlist_index_scratch
            .iter()
            .position(|&x| x == event.watch_descriptor)
        else {
            continue;
        };
        let watch_event = &mut thread.watch_events[event_count];
        *watch_event =
            watch_event_from_inotify_event(&event, WatchItemIndex::try_from(idx).unwrap());
        watch_event.name_off = temp_name_off;
        if let Some(name) = event.name() {
            temp_name_list[temp_name_off as usize] = name;
            watch_event.name_len = 1;
            temp_name_off += 1;
        }
        event_count += 1;
    }
    if event_count == 0 {
        return;
    }

    let mut changed_filepaths: [&[u8]; max_count] = [b""; max_count];
    let mut name_off: u8 = 0;
    let watch_events = &mut thread.watch_events[..event_count];
    index_sort::sort_slice_unstable_by(watch_events, |a, b| WatchEvent::sort_by_index(*a, *b));

    let mut last_event_index: usize = 0;
    let mut last_event_id: WatchItemIndex = WatchItemIndex::MAX;

    for i in 0..watch_events.len() {
        if watch_events[i].name_len > 0 {
            changed_filepaths[name_off as usize] =
                temp_name_list[watch_events[i].name_off as usize];
            watch_events[i].name_off = name_off;
            name_off += 1;
        }

        if watch_events[i].index == last_event_id {
            // reshaped for borrowck — split_at_mut to get two disjoint &mut.
            let (head, tail) = watch_events.split_at_mut(i);
            head[last_event_index].merge(tail[0]);
            continue;
        }
        last_event_index = i;
        last_event_id = watch_events[i].index;
    }

    this.dispatch_file_updates(
        thread,
        last_event_index + 1,
        &changed_filepaths[..name_off as usize],
    );
}

/// The events of one batch. A close carries no change, and some consumers act on every event of a file.
fn next_changes<'a, 'b>(
    events: &'b mut EventIterator<'a>,
) -> impl Iterator<Item = Event<'a>> + use<'a, 'b> {
    events
        .filter(|event| (event.mask & bun_sys::linux::IN::CLOSE_WRITE) == 0)
        .take(max_count)
}

fn watch_event_from_inotify_event(event: &Event<'_>, index: WatchItemIndex) -> WatchEvent {
    use bun_sys::linux::IN;
    let mut op = Op::empty();
    if (event.mask & IN::DELETE_SELF) > 0 || (event.mask & IN::DELETE) > 0 {
        op |= Op::DELETE;
    }
    if (event.mask & IN::MOVE_SELF) > 0 {
        op |= Op::RENAME;
    }
    if (event.mask & IN::MOVED_TO) > 0 {
        op |= Op::MOVE_TO;
    }
    if (event.mask & IN::MODIFY) > 0 {
        op |= Op::WRITE;
    }
    if (event.mask & IN::CREATE) > 0 {
        op |= Op::CREATE;
    }
    WatchEvent {
        op,
        index,
        ..Default::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use bun_sys::linux::IN;

    /// An `inotify_event` as the kernel writes it. Only an event of a directory has a name.
    fn record(wd: EventListIndex, mask: u32, name: &[u8]) -> Vec<u8> {
        let padded = if name.is_empty() {
            0
        } else {
            (name.len() + 1).next_multiple_of(Event::HEADER_SIZE)
        };
        let mut bytes = Vec::new();
        for field in [wd as u32, mask, 0, padded as u32] {
            bytes.extend_from_slice(&field.to_ne_bytes());
        }
        bytes.extend_from_slice(name);
        bytes.resize(Event::HEADER_SIZE + padded, 0);
        bytes
    }

    fn note(writers: &mut Writers, records: &[Vec<u8>]) {
        writers.note(EventIterator(&records.concat()));
    }

    #[test]
    fn a_write_opens_a_file_until_its_close() {
        let mut writers = Writers::default();
        note(
            &mut writers,
            &[
                record(1, IN::MODIFY, b""),
                record(2, IN::MODIFY, b""),
                record(1, IN::MODIFY, b""),
            ],
        );
        assert_eq!(writers.open, [1, 2]);
        note(&mut writers, &[record(1, IN::CLOSE_WRITE, b"")]);
        assert_eq!(writers.open, [2]);
        note(&mut writers, &[record(2, IN::IGNORED, b"")]);
        assert!(writers.open.is_empty());
    }

    #[test]
    fn a_write_after_the_close_opens_the_file_again() {
        let mut writers = Writers::default();
        note(
            &mut writers,
            &[
                record(1, IN::MODIFY, b""),
                record(1, IN::CLOSE_WRITE, b""),
                record(1, IN::MODIFY, b""),
            ],
        );
        assert_eq!(writers.open, [1]);
    }

    #[test]
    fn an_event_of_a_directory_opens_nothing_and_closes_nothing() {
        let mut writers = Writers::default();
        note(&mut writers, &[record(1, IN::MODIFY, b"main.js")]);
        assert!(writers.open.is_empty());
        note(
            &mut writers,
            &[
                record(2, IN::MODIFY, b""),
                record(2, IN::CLOSE_WRITE, b"main.js"),
            ],
        );
        assert_eq!(writers.open, [2]);
    }

    #[test]
    fn other_events_of_a_file_leave_it_open() {
        let mut writers = Writers::default();
        note(
            &mut writers,
            &[record(1, IN::MODIFY, b""), record(1, IN::MOVE_SELF, b"")],
        );
        assert_eq!(writers.open, [1]);
    }

    #[test]
    fn a_file_that_ran_out_the_cap_waits_again_only_after_a_close() {
        let mut writers = Writers::default();
        note(
            &mut writers,
            &[record(1, IN::MODIFY, b""), record(2, IN::MODIFY, b"")],
        );
        writers.give_up();
        assert!(writers.open.is_empty());
        assert_eq!(writers.no_close, [1, 2]);

        note(
            &mut writers,
            &[record(1, IN::MODIFY, b""), record(3, IN::MODIFY, b"")],
        );
        assert_eq!(writers.open, [3]);

        note(
            &mut writers,
            &[record(1, IN::CLOSE_WRITE, b""), record(1, IN::MODIFY, b"")],
        );
        assert_eq!(writers.open, [3, 1]);
        assert_eq!(writers.no_close, [2]);

        note(&mut writers, &[record(2, IN::IGNORED, b"")]);
        assert!(writers.no_close.is_empty());
    }

    #[test]
    fn a_queue_overflow_forgets_every_file() {
        let mut writers = Writers::default();
        note(&mut writers, &[record(1, IN::MODIFY, b"")]);
        writers.give_up();
        note(
            &mut writers,
            &[record(2, IN::MODIFY, b""), record(-1, IN::Q_OVERFLOW, b"")],
        );
        assert!(writers.open.is_empty());
        assert!(writers.no_close.is_empty());
        note(&mut writers, &[record(1, IN::MODIFY, b"")]);
        assert_eq!(writers.open, [1]);
    }

    #[test]
    fn a_file_off_the_watch_list_is_not_open() {
        let mut writers = Writers::default();
        note(
            &mut writers,
            &[record(1, IN::MODIFY, b""), record(2, IN::MODIFY, b"")],
        );
        writers.forget_unwatched(&[2, 3]);
        assert_eq!(writers.open, [2]);
    }

    #[test]
    fn every_file_of_a_batch_is_open_until_its_own_close() {
        let mut writers = Writers::default();
        let files: Vec<EventListIndex> = (1..=100).collect();
        let writes: Vec<_> = files
            .iter()
            .map(|&wd| record(wd, IN::MODIFY, b""))
            .collect();
        note(&mut writers, &writes);
        assert_eq!(writers.open, files);
        let closes: Vec<_> = files[..99]
            .iter()
            .map(|&wd| record(wd, IN::CLOSE_WRITE, b""))
            .collect();
        note(&mut writers, &closes);
        assert_eq!(writers.open, [100]);
    }

    #[test]
    fn a_batch_is_128_changes_and_a_close_is_not_one() {
        let save = [
            record(1, IN::MODIFY, b"main.js"),
            record(2, IN::MODIFY, b""),
            record(1, IN::MODIFY, b"main.js"),
            record(2, IN::MODIFY, b""),
            record(2, IN::CLOSE_WRITE, b""),
        ]
        .concat();
        let saves = save.repeat(max_count / 4);
        let mut events = EventIterator(&saves);
        assert_eq!(next_changes(&mut events).count(), max_count);
        assert_eq!(next_changes(&mut events).count(), 0);
        assert!(events.0.is_empty());
    }

    #[test]
    fn a_second_read_needs_room_for_the_largest_event() {
        let bytes = vec![0u8; EVENTLIST_BYTES_SIZE];
        assert!(has_room(&bytes, 0));
        assert!(has_room(&bytes, bytes.len() - Event::LARGEST_SIZE));
        assert!(!has_room(&bytes, bytes.len() - Event::LARGEST_SIZE + 1));
        assert!(!has_room(&bytes, bytes.len()));
    }
}
